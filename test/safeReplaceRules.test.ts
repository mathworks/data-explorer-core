// Copyright 2026 The MathWorks, Inc.
//
// The rules of a save's replace that no single outcome shows (src/folder/safeReplace.ts), each held
// on its own: the ORDER the calls are made in, which is where a crash-safe write and a lossy one
// differ while producing the same file; what the user is told for a read-only file, word for word;
// the units of the stamp a host compares; and the failures between the temporary file and the
// rename, which must leave the user's file exactly as it was. Then the same rules through the Node
// binding a host calls (src/node/save.ts), over a real directory.
//
// test/safeReplace.test.ts and test/safeReplaceEdges.test.ts hold the outcomes (which came here
// from the vscode extension with the replace); this file holds what they rest on.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { replaceFile, type SaveFs } from '../src/index.js';
import { writeAndStamp, writeFileSafely } from '../src/node/save.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const bytes = (s: string) => new TextEncoder().encode(s);
const posix = process.platform !== 'win32';
const notRoot = posix && process.getuid?.() !== 0;
const fail = (code: string) => Object.assign(new Error(code), { code });

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dex-safereplace-rules-'));
  path = join(dir, 'data.mat');
  writeFileSync(path, 'old bytes');
  chmodSync(path, 0o644);
});
afterEach(() => {
  chmodSync(dir, 0o755);
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Node's fs, recording every call it and its handles take, by name, with the handle's flags. The
 * temporary file's path is recorded as `temp` and the directory's as `dir`, so the sequence reads
 * the same whatever the random part of the name was.
 */
function recording(over: (h: fs.FileHandle, flags: string) => Partial<Record<string, any>> = () => ({})) {
  const calls: string[] = [];
  const name = (p: string) => (p === path ? 'path' : p === dir ? 'dir' : p.endsWith('.dex-tmp') ? 'temp' : p);
  const wrap = (fn: string) => async (...args: any[]) => {
    calls.push(`${fn}(${args.filter((a) => typeof a === 'string').map(name).join(', ')})`);
    return (fs as any)[fn](...args);
  };
  const recorded: SaveFs = {
    constants: fs.constants,
    lstat: wrap('lstat'),
    stat: wrap('stat'),
    realpath: wrap('realpath'),
    readlink: wrap('readlink'),
    access: wrap('access'),
    readdir: wrap('readdir'),
    unlink: wrap('unlink'),
    rename: wrap('rename'),
    open: async (p: string, flags: string, mode?: number) => {
      calls.push(`open(${name(p)}, ${flags})`);
      const h = await fs.open(p, flags, mode);
      const replaced = over(h, flags);
      return new Proxy(h, {
        get(target, key) {
          const value = replaced[key as string] ?? (target as any)[key];
          if (typeof value !== 'function') return value;
          return (...args: any[]) => {
            calls.push(`${name(p)}.${String(key)}`);
            return value.apply(target, args);
          };
        },
      }) as any;
    },
  };
  return { fs: recorded, calls };
}

describe('the order of a replace', () => {
  it('stats, checks, sweeps, writes and flushes the temporary file, stamps it, and only then renames', async () => {
    const { fs: recorded, calls } = recording();
    const written = await replaceFile(recorded, path, bytes('new'));
    expect(written.mode).toBe('replaced');
    expect(calls).toEqual([
      'lstat(path)',
      'stat(path)',
      'access(path)',
      'readdir(dir)',
      'open(temp, wx)',
      'temp.writeFile',
      'temp.chmod',
      'temp.stat',
      'temp.sync',
      // The stamp, off the written file before it takes the name: never a stat of the path after.
      'temp.stat',
      'temp.close',
      'rename(temp, path)',
      // And the rename itself flushed, where the platform lets a directory be.
      'open(dir, r)',
      'dir.sync',
      'dir.close',
    ]);
    expect(calls.lastIndexOf('stat(path)')).toBeLessThan(calls.indexOf('rename(temp, path)'));
  });

  it.runIf(posix)('writes in place over the old bytes first, and cuts the file to length only after', async () => {
    linkSync(path, join(dir, 'other.mat'));
    const { fs: recorded, calls } = recording();
    expect((await replaceFile(recorded, path, bytes('ab'))).mode).toBe('in-place');
    const inPlace = calls.slice(calls.indexOf('open(path, r+)'));
    expect(inPlace).toEqual(['open(path, r+)', 'path.write', 'path.truncate', 'path.sync', 'path.stat', 'path.close']);
    expect(readFileSync(path, 'utf8')).toBe('ab');
  });
});

describe('what a read-only file is told', () => {
  it.runIf(notRoot)('is refused, in these words, with nothing written', async () => {
    chmodSync(path, 0o444);
    await expect(replaceFile(fs, path, bytes('new'))).rejects.toThrow(
      new Error('Cannot save "data.mat": the file is read-only. Nothing was written.'),
    );
    expect(readFileSync(path, 'utf8')).toBe('old bytes');
    expect(readdirSync(dir)).toEqual(['data.mat']);
  });
});

describe('the stamp', () => {
  it('is whole milliseconds, the units a host compares stamps in', async () => {
    // `mtime.getTime()`, not `mtimeMs`, which carries a fraction on most file systems: a host that
    // compares the stamp with VS Code's `workspace.fs.stat` (whole milliseconds) would otherwise
    // take every save for another program's write.
    const { stamp } = await replaceFile(fs, path, bytes('new'));
    expect(Number.isInteger(stamp!.mtime)).toBe(true);
    expect(stamp).toEqual({ mtime: statSync(path).mtime.getTime(), size: 3 });
  });
});

describe('a failure between the temporary file and the rename', () => {
  for (const [what, at] of [
    ['writing', 'writeFile'],
    ['flushing', 'sync'],
    ['stamping', 'stat'],
  ] as const) {
    it(`while ${what} it leaves the file byte for byte as it was, and nothing beside it`, async () => {
      const before = readFileSync(path);
      let calls = 0;
      const { fs: failing } = recording((_h, flags) =>
        flags === 'wx'
          ? {
              [at]: async () => {
                // keepsAccess stats the temporary file once before the flush; the stamp is the second.
                if (at === 'stat' && calls++ === 0) return _h.stat();
                throw fail('EIO');
              },
            }
          : {},
      );
      await expect(replaceFile(failing, path, bytes('new and longer'))).rejects.toThrow('EIO');
      expect(readFileSync(path).equals(before)).toBe(true);
      expect(readdirSync(dir)).toEqual(['data.mat']);
    });
  }

  it('an owner it cannot give the replacement is kept by writing in place', async () => {
    // The uid half of keepsAccess (test/safeReplace.test.ts has the gid): the temporary file would
    // belong to someone else, and the chown that would fix it is refused.
    const st = statSync(path);
    const { fs: otherOwner } = recording((h, flags) =>
      flags === 'wx'
        ? {
            stat: async () => Object.assign(await h.stat(), { uid: st.uid + 1 }),
            chown: async () => Promise.reject(fail('EPERM')),
          }
        : {},
    );
    expect((await replaceFile(otherOwner, path, bytes('new'))).mode).toBe('in-place');
    expect(readFileSync(path, 'utf8')).toBe('new');
    expect(statSync(path).ino).toBe(st.ino);
    expect(readdirSync(dir)).toEqual(['data.mat']);
  });
});

describe('the Node binding, over a real directory', () => {
  it.runIf(posix)('keeps the mode, follows a link and a dangling one, and writes a hard link in place', async () => {
    chmodSync(path, 0o640);
    expect((await writeFileSafely(path, bytes('one'))).mode).toBe('replaced');
    expect(statSync(path).mode & 0o777).toBe(0o640);

    const link = join(dir, 'link.mat');
    symlinkSync(path, link);
    await writeFileSafely(link, bytes('two'));
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('two');

    const dangling = join(dir, 'dangling.mat');
    symlinkSync('made.mat', dangling);
    await writeFileSafely(dangling, bytes('three'));
    expect(lstatSync(dangling).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(dir, 'made.mat'), 'utf8')).toBe('three');

    linkSync(path, join(dir, 'hard.mat'));
    expect((await writeFileSafely(path, bytes('four'))).mode).toBe('in-place');
    expect(readFileSync(join(dir, 'hard.mat'), 'utf8')).toBe('four');
  });

  it.runIf(notRoot)('refuses a read-only file', async () => {
    chmodSync(path, 0o444);
    await expect(writeFileSafely(path, bytes('new'))).rejects.toThrow(/read-only/);
    expect(readFileSync(path, 'utf8')).toBe('old bytes');
  });

  it('answers the stamp the write left, and refuses a file whose folder is gone when there is no provider', async () => {
    const stamp = await writeAndStamp(path, bytes('new'));
    expect(stamp).toEqual({ mtime: statSync(path).mtime.getTime(), size: 3 });
    await expect(writeAndStamp(join(dir, 'gone', 'data.mat'), bytes('new'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
