import type { SourceFile, SourceReader } from '../folder/sourceReader.js';
import { type StoreFs } from '../folder/projectStore.js';
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
export declare function nodeSourceReader(files: readonly SourceFile[], options?: NodeSourceReaderOptions): SourceReader;
/**
 * `StoreFs` over `node:fs`. A listing's entries are typed by `stat`, which follows a symbolic
 * link, so a linked store directory or document is walked like any other; an entry whose `stat`
 * fails (a dangling link) is `'other'` and skipped.
 */
export declare const nodeStoreFs: StoreFs;
/**
 * `readProjectStore` for the marker at disk path `markerPath`, over `node:fs` — and sorted.
 *
 * Sorted by key because the order a directory lists in is the filesystem's, not the project's:
 * the same checkout walks in one order on APFS and another on ext4, and a host (or a golden) that
 * shows what it read should not depend on which disk wrote it. A TOML marker has one key anyway.
 */
export declare function readProjectStoreFromDisk(markerPath: string): Promise<Record<string, string>>;
//# sourceMappingURL=folderReads.d.ts.map