// src/node/folderReads.ts
// Copyright 2026 The MathWorks, Inc.
//
// The folder reads a host makes, over `node:fs` — for an Electron main process, a command line,
// or a test that wants the reads a real host makes rather than a hand-written stub.
//
// Both adapters supply the filesystem half of something whose rules live in the main barrel: the
// shared source cache reads through a `SourceReader` (src/folder/sourceCache.ts), and a project's
// definition is walked through a `StoreFs` (src/folder/projectStore.ts). What is kept here is
// only what a filesystem has to answer, plus the two rules a reader owes the cache, which every
// host has to get right the same way (the vscode extension's sourceReads.ts makes the same two):
//
//   - it answers only for the files it was GIVEN. A reader built for one folder pass that
//     answered for any path would let a stale `SourceFile` from another pass read a file the
//     pass never listed.
//   - the version is taken from a `stat`, before and without the bytes, and a file past
//     `MAX_SCAN_BYTES` is refused from that `stat` alone: checking after the read is checking
//     after the cost.
import { readFile, readdir, stat } from 'node:fs/promises';
import { MAX_SCAN_BYTES, scanVersionOf } from '../folder/scanVersion.js';
import type { SourceFile, SourceReader } from '../folder/sourceCache.js';
import { readProjectStore, type StoreEntry, type StoreFs } from '../folder/projectStore.js';

export interface NodeSourceReaderOptions {
  /**
   * The disk path of a file, when its `SourceFile.path` is not one. Defaults to `file.path`. For
   * a host that names files by something other than where they are — a test whose sources carry
   * fake paths, so that what it records does not depend on where the checkout sits.
   */
  pathOf?: (file: SourceFile) => string;
}

/**
 * A `SourceReader` over `node:fs`, for exactly `files`.
 *
 * `version` is `scanVersionOf` of the file's `stat` (`mtimeMs:size`), or `null` for a file it
 * was not given, one whose `stat` fails, or one past `MAX_SCAN_BYTES`. `bytes` is the whole file,
 * or `null` for the same three — the size checked from a `stat` before anything is read.
 */
export function nodeSourceReader(
  files: readonly SourceFile[],
  options: NodeSourceReaderOptions = {},
): SourceReader {
  const known = new Set(files.map((f) => f.uriString));
  const pathOf = options.pathOf ?? ((file: SourceFile) => file.path);
  return {
    version: async (file) => {
      if (!known.has(file.uriString)) return null;
      try {
        const s = await stat(pathOf(file));
        return scanVersionOf({ mtime: s.mtimeMs, size: s.size });
      } catch {
        return null;
      }
    },
    bytes: async (file) => {
      if (!known.has(file.uriString)) return null;
      try {
        const path = pathOf(file);
        if ((await stat(path)).size > MAX_SCAN_BYTES) return null;
        const b = await readFile(path);
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      } catch {
        // Unreadable (permissions, deleted mid-scan): the same answer as oversized. The file is
        // still a node; it just has nothing to say.
        return null;
      }
    },
  };
}

/**
 * `StoreFs` over `node:fs`. A listing's entries are typed by `stat`, which follows a symbolic
 * link, so a linked store directory or document is walked like any other; an entry whose `stat`
 * fails (a dangling link) is `'other'` and skipped.
 */
export const nodeStoreFs: StoreFs = {
  readText: async (path) => new TextDecoder().decode(await readFile(path)),
  list: async (path) => {
    const names = await readdir(path);
    return Promise.all(
      names.map(async (name): Promise<StoreEntry> => {
        try {
          const s = await stat(`${path}/${name}`);
          return { name, type: s.isDirectory() ? 'directory' : s.isFile() ? 'file' : 'other' };
        } catch {
          return { name, type: 'other' };
        }
      }),
    );
  },
};

/** Code-unit order, which is the same on every machine — unlike `localeCompare`. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `readProjectStore` for the marker at disk path `markerPath`, over `node:fs` — and sorted.
 *
 * Sorted by key because the order a directory lists in is the filesystem's, not the project's:
 * the same checkout walks in one order on APFS and another on ext4, and a host (or a golden) that
 * shows what it read should not depend on which disk wrote it. A TOML marker has one key anyway.
 */
export async function readProjectStoreFromDisk(
  markerPath: string,
): Promise<Record<string, string>> {
  const files = await readProjectStore(markerPath, nodeStoreFs);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => byCodeUnit(a, b)));
}
