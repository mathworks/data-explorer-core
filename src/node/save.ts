// src/node/save.ts
// Copyright 2026 The MathWorks, Inc.
//
// The `data-explorer-core/node/save` entry: a save over the user's own file, over `node:fs`, and
// nothing of the data model.
//
// For the process that holds the files — an Electron main process saving what a sandboxed page
// edited — which must not load the parsers to write bytes it was handed. The rules are
// folder/safeReplace.ts's (on the main barrel, with the file system handed in); this binds them to
// Node's `fs/promises`, and adds the stamp a save records, which is what lets a host tell its own
// write from another program's. test/nodeSaveEntry.test.ts fails if this entry reaches anything but
// that module and `node:` builtins.
//
// The same values are on `data-explorer-core/node` too.
import * as fsPromises from 'node:fs/promises';
import { replaceFile, sameFile, type SaveFs, type Written } from '../folder/safeReplace.js';

/** Node's `fs/promises`, as the file system a save writes through. */
export const nodeSaveFs: SaveFs = fsPromises;

/**
 * Write `bytes` as the file at `path`, replacing it whole where the file system lets us and
 * writing it in place where it does not (see folder/safeReplace.ts). `provider` is the caller's
 * own write, for a file whose folder is gone; without one, such a save is refused.
 */
export function writeFileSafely(
  path: string,
  bytes: Uint8Array,
  provider?: () => PromiseLike<void>,
): Promise<Written> {
  return replaceFile(nodeSaveFs, path, bytes, provider);
}

/** What a save asks of the caller where Node's fs does not make the write itself. */
export interface ProviderWrite {
  /** Write the bytes over the file, making the folders it needs. */
  write(): PromiseLike<void>;
  /** The file's mtime+size afterwards, in whole milliseconds, or undefined. */
  stat(): PromiseLike<{ mtime: number; size: number } | undefined>;
}

/**
 * Write the user's file through `writeFileSafely`, and answer its mtime+size as this write left
 * them: what a save records, so that a watcher's event for the save's own write, and the next
 * save's check, find the disk matching.
 *
 * Read off the written file itself wherever the write could: a stat after the write would take an
 * outside write landing in between for this one, and the next save would then write over that
 * without asking. Only a write handed to `provider` (a folder that is gone), which reads no stamp,
 * is stat'd after it. The vscode host keeps its own of this (diskFollow's `writeUserFile`), over a
 * uri and `workspace.fs`.
 */
export async function writeAndStamp(
  path: string,
  bytes: Uint8Array,
  provider?: ProviderWrite,
): Promise<{ mtime: number; size: number } | undefined> {
  const written = await writeFileSafely(path, bytes, provider ? () => provider.write() : undefined);
  return written.stamp ?? (await provider?.stat());
}

// The rules themselves, the same values the main barrel has, for a host that brings another fs.
export { replaceFile, sameFile };
export type { SaveFs, SaveFileHandle, SaveStat, Written } from '../folder/safeReplace.js';
