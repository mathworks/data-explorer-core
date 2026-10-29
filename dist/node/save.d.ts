import { replaceFile, sameFile, type SaveFs, type Written } from '../folder/safeReplace.js';
/** Node's `fs/promises`, as the file system a save writes through. */
export declare const nodeSaveFs: SaveFs;
/**
 * Write `bytes` as the file at `path`, replacing it whole where the file system lets us and
 * writing it in place where it does not (see folder/safeReplace.ts). `provider` is the caller's
 * own write, for a file whose folder is gone; without one, such a save is refused.
 */
export declare function writeFileSafely(path: string, bytes: Uint8Array, provider?: () => PromiseLike<void>): Promise<Written>;
/** What a save asks of the caller where Node's fs does not make the write itself. */
export interface ProviderWrite {
    /** Write the bytes over the file, making the folders it needs. */
    write(): PromiseLike<void>;
    /** The file's mtime+size afterwards, in whole milliseconds, or undefined. */
    stat(): PromiseLike<{
        mtime: number;
        size: number;
    } | undefined>;
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
export declare function writeAndStamp(path: string, bytes: Uint8Array, provider?: ProviderWrite): Promise<{
    mtime: number;
    size: number;
} | undefined>;
export { replaceFile, sameFile };
export type { SaveFs, SaveFileHandle, SaveStat, Written } from '../folder/safeReplace.js';
//# sourceMappingURL=save.d.ts.map