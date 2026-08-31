// test/node-loader.test.ts
// Copyright 2026 The MathWorks, Inc.
//
// src/node/ is the ONLY part of the package that touches the filesystem: it turns
// `path -> bytes` and hands off to the universal ingest(). Everything about format
// sniffing and parsing is covered by ingest.test.ts and the parser suites, so what
// is left to test here is the filesystem behaviour itself — which extensions a
// directory scan picks up, and what a directory containing one unreadable file
// does to the other files in it.
//
// That last point is the reason loadDirectory has a try/catch: a CLI pointed at a
// folder must not lose every file because one is corrupt.
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { loadFromPath, loadDirectory, createSession as nodeCreateSession } from '../src/node/index.js';

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));

describe('node loader', () => {
  it('loadFromPath reads a textual .sldd and adds a source', () => {
    const s = createSession();
    const node = loadFromPath(s, fixturesDir + 'object_array_text.sldd');
    expect(node).toBeTruthy();
    expect(s.getDataSourceCount()).toBe(1);
    expect(node.meta?.path).toContain('object_array_text.sldd');
  });

  it('loadFromPath reads a binary .slx', () => {
    const s = createSession();
    const node = loadFromPath(s, fixturesDir + 'model_with_refs.slx');
    expect(node.flatten().length).toBeGreaterThan(0);
  });

  it('loadFromPath stamps the file stats onto the source meta', () => {
    // The host uses size/lastModified to decide whether to re-read a file, and
    // `path` is what the tree shows as the source label. A missing stat would make
    // every open look like a fresh file.
    const s = createSession();
    const node = loadFromPath(s, fixturesDir + 'object_array_text.sldd');
    expect(node.meta!.size).toBeGreaterThan(0);
    expect(node.meta!.lastModified).toBeGreaterThan(0);
    expect(node.meta!.fileHandle).toBeNull();
  });

  it('re-exports createSession so a Node consumer needs only this subpath', () => {
    // The subpath is fenced out of the browser bundle, so a CLI importing only
    // 'data-explorer-core/node' must still be able to make a session.
    expect(nodeCreateSession).toBe(createSession);
  });

  it('loadDirectory loads all supported files into one session', () => {
    const s = createSession();
    const loaded = loadDirectory(s, fixturesDir);
    expect(loaded.length).toBeGreaterThan(1);
    expect(loaded.length).toBeGreaterThanOrEqual(5); // fixtures dir has several supported files
    expect(s.getDataSourceCount()).toBe(loaded.length);
  });

  it('loadDirectory skips an unreadable file and keeps loading the rest', () => {
    // The whole point of the try/catch: one corrupt file in a folder must cost that
    // file and nothing else. Without it, a CLI pointed at a real project directory
    // would abort on the first bad file and report nothing at all.
    const dir = mkdtempSync(join(tmpdir(), 'dex-loaddir-'));
    copyFileSync(fixturesDir + 'object_array_text.sldd', join(dir, 'good.sldd'));
    writeFileSync(join(dir, 'bad.mat'), 'not a mat file');
    writeFileSync(join(dir, 'notes.txt'), 'unsupported extension, never attempted');
    // A DIRECTORY named like a model: readFileSync throws EISDIR, which is a
    // different failure from a parse error and must be swallowed the same way.
    mkdirSync(join(dir, 'sub.slx'));

    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.join(' '));
    });
    const s = createSession();
    const loaded = loadDirectory(s, dir);
    spy.mockRestore();

    expect(loaded).toHaveLength(1);
    expect(s.getDataSourceCount()).toBe(1);
    // Each skip is reported by name on stderr — silence would make a CLI look as
    // though the folder simply held fewer files.
    expect(errors).toHaveLength(2);
    expect(errors.join('\n')).toContain('loadDirectory: skipped bad.mat:');
    expect(errors.join('\n')).toContain('loadDirectory: skipped sub.slx:');
    // The unsupported extension is filtered out before any read, so it produces
    // no error line at all.
    expect(errors.join('\n')).not.toContain('notes.txt');
  });

  it('loadDirectory takes only the four supported extensions, case-insensitively', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dex-exts-'));
    copyFileSync(fixturesDir + 'object_array_text.sldd', join(dir, 'upper.SLDD'));
    writeFileSync(join(dir, 'readme.md'), '# ignored');
    writeFileSync(join(dir, 'noext'), 'ignored');

    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.join(' '));
    });
    const loaded = loadDirectory(createSession(), dir);
    spy.mockRestore();

    expect(loaded.map((n) => n.name)).toEqual(['upper.SLDD']);
    expect(errors).toEqual([]);
  });
});
