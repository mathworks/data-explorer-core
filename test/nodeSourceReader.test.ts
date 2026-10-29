// Copyright 2026 The MathWorks, Inc.
//
// The ./node entry's `SourceReader` — the filesystem half of the shared source cache, for a host
// that reads with `node:fs` (src/node/folderReads.ts).
//
// The cache's own rules are tested over in-memory readers (test/sourceCache.test.ts and beside
// it); what is pinned here is what only a reader can get wrong, over a real directory: that it
// answers for its own files and no others, that its version is `scanVersionOf` of the `stat`,
// that it refuses a file past the scan cap from the `stat` alone, and that the cache reading
// through it gets exactly the artifacts it gets from the bytes directly.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_SCAN_BYTES,
  cheapAll,
  newSourceCache,
  scanVersionOf,
  type SourceFile,
  type SourceReader,
} from '../src/index.js';
import { nodeSourceReader } from '../src/node/index.js';

const at = (path: string): SourceFile => ({ uriString: `file://${path}`, path });

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dex-node-reader-'));
  writeFileSync(join(dir, 'params.sldd'), readFileSync(new URL('./folder-fixtures/params.sldd', import.meta.url)));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('nodeSourceReader', () => {
  it('versions a file as scanVersionOf its stat, and reads its bytes', async () => {
    const file = at(join(dir, 'params.sldd'));
    const reader = nodeSourceReader([file]);
    const s = statSync(file.path);
    expect(await reader.version(file)).toBe(scanVersionOf({ mtime: s.mtimeMs, size: s.size }));
    const bytes = await reader.bytes(file);
    expect(bytes && new Uint8Array(bytes)).toEqual(new Uint8Array(readFileSync(file.path)));
  });

  it('answers for the files it was given and no others', async () => {
    // A reader is made for one pass over one listing. A `SourceFile` from another listing is not
    // its to read, even when the file is right there on disk.
    const file = at(join(dir, 'params.sldd'));
    const reader = nodeSourceReader([]);
    expect(await reader.version(file)).toBeNull();
    expect(await reader.bytes(file)).toBeNull();
  });

  it('answers null, not a throw, for a file that is gone', async () => {
    const gone = at(join(dir, 'deleted.sldd'));
    const reader = nodeSourceReader([gone]);
    expect(await reader.version(gone)).toBeNull();
    expect(await reader.bytes(gone)).toBeNull();
  });

  it('moves the version when the file is written, and keeps it when nothing happened', async () => {
    const path = join(dir, 'moving.sldd');
    writeFileSync(path, 'one');
    const file = at(path);
    const reader = nodeSourceReader([file]);
    const before = await reader.version(file);
    expect(await reader.version(file)).toBe(before);
    writeFileSync(path, 'a longer two');
    // The size alone moves it here. A write that kept both the mtime and the size would not —
    // the gap a host's file watcher covers with `forgetSource`.
    expect(await reader.version(file)).not.toBe(before);
  });

  it('refuses a file past the scan cap from its stat, without reading it', async () => {
    // A sparse file: MAX_SCAN_BYTES + 1 bytes long and occupying almost nothing, so the refusal
    // is tested against a real stat rather than a stub. Reading it would take seconds and half a
    // gigabyte; the refusal takes neither, which is the point of making it from the stat.
    const path = join(dir, 'huge.sldd');
    writeFileSync(path, '');
    truncateSync(path, MAX_SCAN_BYTES + 1);
    const file = at(path);
    const reader = nodeSourceReader([file]);
    const started = Date.now();
    expect(await reader.version(file)).toBeNull();
    expect(await reader.bytes(file)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
    rmSync(path);
  });

  it('reads through pathOf when the source names a file by something else', async () => {
    // For a host (or a test) whose sources carry paths of their own: the cache keys by
    // `uriString` and summarises by `path`, and neither has to be where the file is.
    const file: SourceFile = { uriString: 'file:///fx/params.sldd', path: '/fx/params.sldd' };
    const reader = nodeSourceReader([file], { pathOf: (f) => join(dir, f.path.slice('/fx/'.length)) });
    expect(await reader.version(file)).not.toBeNull();
    expect((await reader.bytes(file))?.byteLength).toBe(statSync(join(dir, 'params.sldd')).size);
  });
});

describe('the cache, reading a folder through it', () => {
  it('derives exactly what it derives from the same bytes handed over directly', async () => {
    // The whole folder-scan workspace, through the real reader and through one that hands the
    // same bytes over from memory. Equal artifacts, file for file and in order, is what says the
    // adapter is a reader and nothing more.
    const folder = fileURLToPath(new URL('./folder-fixtures/', import.meta.url));
    const names = ['model_with_refs.slx', 'chain_model.slx', 'chain_top.sldd', 'chain_leaf.sldd', 'nd_numeric.mat'];
    const files = names.map((n) => at(join(folder, n)));
    const direct: SourceReader = {
      version: async () => 'v1',
      bytes: async (f) => {
        const b = readFileSync(f.path);
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      },
    };
    const viaDisk = await cheapAll(newSourceCache(), nodeSourceReader(files), files);
    const viaMemory = await cheapAll(newSourceCache(), direct, files);
    expect([...viaDisk.keys()]).toEqual(files.map((f) => f.uriString));
    expect([...viaDisk.values()].map((e) => e.cheap)).toEqual([...viaMemory.values()].map((e) => e.cheap));
  });
});
