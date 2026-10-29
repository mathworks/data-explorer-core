// Copyright 2026 The MathWorks, Inc.
//
// Which files a folder shows, in which order, and where it stops (src/node/listFolder.ts) — over
// real directory trees in a temp dir, because a walk of a filesystem is what is being checked and a
// hand-written listing would assert this test's own idea of one.
//
// The ORDER gets the most cases, because it is the choice that shows least and matters most:
// folder order decides which of two same-named dictionaries wins a name in a usage answer, and two
// hosts that list one folder differently answer the same question differently. The Electron app's
// own walk (its src/main/folder.ts) is what this replaces, and its rules — core's
// `isSupportedPath`, hidden folders, `node_modules` and `slprj` passed over, 10 000 files — are
// kept; its order is made exact under a cap, which a sort after a capped walk is not.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { FOLDER_FILE_LIMIT, listFolder, skipDirectory } from '../src/node/folder.js';

let root: string;
const at = (...parts: string[]): string => join(root, ...parts);
/** The listing as `/`-separated paths relative to the root, which is how its order is defined. */
const rel = (files: string[]): string[] => files.map((f) => relative(root, f).split(sep).join('/'));
const touch = (...parts: string[]): void => {
  mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
  writeFileSync(join(root, ...parts), '');
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dex-listfolder-'));
  // Every supported kind, in both cases, and the files that must not count.
  touch('models', 'engine.slx');
  touch('models', 'legacy.MDL');
  touch('data', 'params.sldd');
  touch('data', 'Shouted.SLDD');
  touch('data', 'signals.mat');
  touch('MyProj.prj');
  touch('TomlProj', 'matlab.toml');
  touch('Cargo.toml');
  touch('notes.txt');
  touch('model.mdl.bak');
  // The directories the walk does not enter, each holding a file that would otherwise count.
  touch('.git', 'objects.sldd');
  touch('node_modules', 'pkg', 'fixture.slx');
  touch('slprj', 'sim', 'cache.slx');
  touch('models', 'slprj', 'nested.slx');
  // A hidden FILE does count: only directories are skipped.
  touch('.hidden.sldd');
  // The order's hard cases: a file whose name sorts before a sibling directory's `/`, and a
  // capital before a small letter.
  touch('a-b.slx');
  touch('a', 'x.slx');
  touch('Z.sldd');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('listFolder', () => {
  it('lists every supported file, by its name, and nothing else', async () => {
    const { files, truncated } = await listFolder(root);
    expect(truncated).toBe(false);
    expect(new Set(rel(files))).toEqual(
      new Set([
        '.hidden.sldd',
        'MyProj.prj',
        'TomlProj/matlab.toml',
        'Z.sldd',
        'a-b.slx',
        'a/x.slx',
        'data/Shouted.SLDD',
        'data/params.sldd',
        'data/signals.mat',
        'models/engine.slx',
        'models/legacy.MDL',
      ]),
    );
  });

  it('orders by code unit of the path relative to the root, with / between segments', async () => {
    // `a-b.slx` before `a/x.slx` because `-` sorts before `/`; `Z.sldd` before `a-b.slx` because
    // capitals sort before small letters; a dot-led name first of all. The order a filesystem
    // lists a directory in plays no part.
    const { files } = await listFolder(root);
    const listed = rel(files);
    expect(listed).toEqual([...listed].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(listed.indexOf('a-b.slx')).toBeLessThan(listed.indexOf('a/x.slx'));
    expect(listed[0]).toBe('.hidden.sldd');
  });

  it('hands back absolute paths, joined with the platform’s separator', async () => {
    const { files } = await listFolder(root);
    expect(files).toContain(at('models', 'engine.slx'));
  });

  it('does not enter hidden folders, node_modules or slprj, at any depth', async () => {
    const listed = rel((await listFolder(root)).files);
    for (const skipped of ['.git/objects.sldd', 'node_modules/pkg/fixture.slx', 'slprj/sim/cache.slx', 'models/slprj/nested.slx']) {
      expect(listed, skipped).not.toContain(skipped);
    }
    expect(['.git', '.vscode', 'node_modules', 'slprj'].every(skipDirectory)).toBe(true);
    expect(['models', 'Slprj2', 'node'].some(skipDirectory)).toBe(false);
  });

  it('takes another rule for which folders to skip', async () => {
    const listed = rel((await listFolder(root, { skipDirectory: (name) => name === 'data' })).files);
    expect(listed).toContain('slprj/sim/cache.slx');
    expect(listed).toContain('node_modules/pkg/fixture.slx');
    expect(listed.some((f) => f.startsWith('data/'))).toBe(false);
  });

  it('keeps the FIRST files in that order under a cap, and says it stopped', async () => {
    // Which files a capped listing holds must be as stable as its order. A walk that collected
    // in the filesystem's order and sorted afterwards would keep whichever files the disk
    // happened to list first.
    const all = (await listFolder(root)).files;
    const capped = await listFolder(root, { limit: 4 });
    expect(capped.files).toEqual(all.slice(0, 4));
    expect(capped.truncated).toBe(true);
  });

  it('is not truncated at a cap the folder exactly fills, and is at a cap of 0', async () => {
    const all = (await listFolder(root)).files;
    expect(await listFolder(root, { limit: all.length })).toEqual({ files: all, truncated: false });
    expect(await listFolder(root, { limit: 0 })).toEqual({ files: [], truncated: true });
  });

  it('defaults to 10 000 files, and refuses a cap that is not a count', async () => {
    expect(FOLDER_FILE_LIMIT).toBe(10_000);
    await expect(listFolder(root, { limit: -1 })).rejects.toThrow(RangeError);
    await expect(listFolder(root, { limit: 1.5 })).rejects.toThrow(RangeError);
    await expect(listFolder(root, { limit: Number.NaN })).rejects.toThrow(RangeError);
  });

  it('lists nothing, without throwing, for a root that is missing or a file', async () => {
    expect(await listFolder(at('nowhere'))).toEqual({ files: [], truncated: false });
    expect(await listFolder(at('notes.txt'))).toEqual({ files: [], truncated: false });
  });
});

describe('listFolder over links and unreadable folders', () => {
  let linked: string;
  beforeAll(() => {
    linked = mkdtempSync(join(tmpdir(), 'dex-listfolder-links-'));
    mkdirSync(join(linked, 'elsewhere'));
    writeFileSync(join(linked, 'elsewhere', 'real.slx'), '');
    mkdirSync(join(linked, 'folder'));
    // A linked FILE counts as the file; a linked DIRECTORY is not entered (a loop, or a way out
    // of the folder, is one link away); a dangling link is nothing.
    symlinkSync(join(linked, 'elsewhere', 'real.slx'), join(linked, 'folder', 'alias.slx'));
    symlinkSync(join(linked, 'elsewhere'), join(linked, 'folder', 'linkdir'));
    symlinkSync(join(linked, 'folder'), join(linked, 'folder', 'loop'));
    symlinkSync(join(linked, 'gone.sldd'), join(linked, 'folder', 'dangling.sldd'));
    mkdirSync(join(linked, 'folder', 'locked'));
    writeFileSync(join(linked, 'folder', 'locked', 'secret.sldd'), '');
    writeFileSync(join(linked, 'folder', 'plain.mat'), '');
  });
  afterAll(() => {
    chmodSync(join(linked, 'folder', 'locked'), 0o755);
    rmSync(linked, { recursive: true, force: true });
  });

  it('counts a linked file, enters no linked directory, and skips a dangling link', async () => {
    const { files } = await listFolder(join(linked, 'folder'));
    expect(files.map((f) => relative(join(linked, 'folder'), f).split(sep).join('/'))).toEqual([
      'alias.slx',
      'locked/secret.sldd',
      'plain.mat',
    ]);
  });

  // Root reads any directory whatever its mode, so the case cannot be made as root.
  it.skipIf(process.getuid?.() === 0)('passes over a folder it cannot read, and lists the rest', async () => {
    chmodSync(join(linked, 'folder', 'locked'), 0o000);
    try {
      const { files } = await listFolder(join(linked, 'folder'));
      expect(files.map((f) => relative(join(linked, 'folder'), f))).toEqual(['alias.slx', 'plain.mat']);
    } finally {
      chmodSync(join(linked, 'folder', 'locked'), 0o755);
    }
  });
});
