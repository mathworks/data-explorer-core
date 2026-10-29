import { type ChunkEntries } from '../datamodel/parser/chunkEntries.js';
/** A key in a document's set of edited entries that stands for every entry: see `changedEntryKeys`. */
export declare const EVERY_ENTRY = "*";
/** The chunk as a document last read or wrote it, scanned once, when a save first needs it. */
export declare class SavedChunk {
    readonly xml: string;
    private scanned;
    constructor(xml: string);
    get scan(): ChunkEntries;
}
/**
 * The keys (chunkEntries.entryKey) of the entries whose text differs between two chunks, or
 * that only one of them holds: what an edit that could not say what it changed has changed.
 * EVERY_ENTRY when either chunk cannot be scanned.
 */
export declare function changedEntryKeys(before: string, after: string): Set<string>;
/**
 * The entries of `model` an edit has just changed (`changed`, by entryKey) that the check cannot
 * be held to, each as every key it goes by across the edit, for the document to record (see the
 * header, ASKED WHEN THE EDIT IS MADE). `keyBefore` maps the row id that an entry the edit
 * rebuilt in its slot has after it to the key it had before it, which a rename of an entry with
 * no UUID changes. Null when the edit stated no ops: then all the keys it changed go together,
 * since nothing says which of them was such an entry's before.
 */
export declare function uncheckableEntries(model: any, changed: ReadonlySet<string>, keyBefore: ReadonlyMap<string, string> | null): string[][];
/**
 * Why `chunk` may not be saved over the file `saved` was read from or written as, or null when
 * it may. `edited` holds the keys of the entries the edits since then have changed; `model` is
 * the dictionary node they were made on (null when none is registered). `unchecked` maps the key
 * of each entry those edits changed while the check could not be held to it to every key that
 * entry has gone by (uncheckableEntries).
 */
export declare function savedChunkRefusal(saved: SavedChunk, chunk: string, edited: ReadonlySet<string>, model: any, unchecked?: ReadonlyMap<string, ReadonlySet<string>>): string | null;
//# sourceMappingURL=binarySaveGate.d.ts.map