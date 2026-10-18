import type { ZipMemberStamp } from './Inflate.js';
/** A `[start, end)` character range in the chunk text. */
export type Span = readonly [number, number];
/** The chunk an entry was read from, as the reader found it. */
export interface ChunkFrame {
    /** The whole text of `data/chunk0.xml`. */
    readonly xml: string;
    /** Every entry's `<Object Class="DD.ENTRY">…</Object>`, in document order. */
    readonly spans: readonly Span[];
    /**
     * For a chunk with no entries: where a first entry goes, just past the `<DataSource …>`
     * open tag. -1 when there is no such place (a self-closed `<DataSource/>`), and
     * unused when the chunk has entries.
     */
    readonly insertAt: number;
    /** The dictionary-level fields as read, so a save can tell whether they changed. */
    readonly allowAccessBWS: boolean;
    readonly dictionaryReferences: readonly string[];
    readonly dataSourceAttrs: Readonly<Record<string, string>>;
}
/** The bytes one entry was read from. */
export interface EntrySource {
    readonly frame: ChunkFrame;
    /** Its position among the frame's spans. */
    readonly index: number;
    /**
     * Its `<Object Class="DD.ENTRY">…</Object>` text, exactly as read; null for an entry that
     * no longer says what it was read as, which keeps its place and is written from the model.
     */
    readonly fragment: string | null;
}
/**
 * The metadata keys the entry writer (BinarySlddSerializer.regenerateEntryXml) writes an
 * entry's lines outside its Value from: `uuid`, `namespace` and `isderived` for the UUID,
 * Namespace and IsDerived lines, `_rawLastMod` or else `lastmod` for LastMod, and
 * `lastModifiedBy` or else `modifiedby` for LastModBy. An entry is held to every one of them,
 * so a change to any field the writer would write is a change to the entry.
 * test/binarySaveKeepsUnedited.test.ts holds the writer to this list.
 */
export declare const WRITTEN_METADATA: readonly string[];
/** An entry node as far as its kept bytes are concerned: what it is called, where, and its metadata. */
export interface EntryIdentity {
    readonly name: unknown;
    readonly parent: unknown;
    readonly metadata: unknown;
}
/** Record, on the content the reader returns, the frame it verified. */
export declare function recordReadFrame(content: object, frame: ChunkFrame): void;
/** Record, on one raw entry the reader returns, the bytes it was read from. */
export declare function recordReadSource(rawEntry: Record<string, unknown>, source: EntrySource): void;
/** The frame the reader recorded on this exact content object, if any. */
export declare function readFrameOf(content: object): ChunkFrame | undefined;
/**
 * The source the reader recorded on this exact raw entry, if any. When the entry no longer
 * says what it said when it was read — the same Name, the same value object, and the same
 * value in every WRITTEN_METADATA key — it is its place alone, with no fragment.
 */
export declare function readSourceOf(rawEntry: Record<string, unknown>): EntrySource | undefined;
/** Give a dictionary node the frame it was read from. */
export declare function attachChunkFrame(dictionary: object, frame: ChunkFrame): void;
/**
 * Give an entry node the bytes it was read from, and record what the node says as they are
 * attached — its name, the section it is in, and its WRITTEN_METADATA — for keptFragmentOf
 * to hold it to.
 */
export declare function attachEntrySource(entry: EntryIdentity & object, source: EntrySource): void;
/** The frame a dictionary node was read from, if a verified one was. */
export declare function chunkFrameOf(dictionary: object): ChunkFrame | undefined;
/**
 * The bytes an entry node was read from, if verified ones were: its place among the frame's
 * spans, whatever the node says now. Whether the fragment may still be written as the node is
 * keptFragmentOf's to say.
 */
export declare function entrySourceOf(entry: object): EntrySource | undefined;
/**
 * The text an entry node was read from, when the node still says what it said when that text
 * was attached: the same name, in the same section object, and the same value in every
 * WRITTEN_METADATA key. Otherwise null, and the node is written from the model: each of those is
 * a line of the entry, or the section it is filed in, and a node changed around the API that
 * would have marked it would otherwise show the change and save the bytes it was read from.
 */
export declare function keptFragmentOf(entry: EntryIdentity & object): string | null;
/** Record how the archive a member bag was read from listed its members. */
export declare function recordPackageStamps(zipMetadata: object, stamps: readonly ZipMemberStamp[]): void;
/** How the archive this member bag was read from listed its members, if it is known. */
export declare function packageStampsOf(zipMetadata: object | null | undefined): readonly ZipMemberStamp[] | undefined;
/** Record, on an `_elements` array the binary reader built, that its element k is the k-th `<Element>` it read. */
export declare function recordReadElements(elements: readonly unknown[]): void;
/** Record, on an `_elements` array built to be written, the origin of each element (undefined for one with none). */
export declare function recordElementOrigins(elements: readonly unknown[], origins: readonly (number | undefined)[]): void;
/**
 * The origin of element `k` of an `_elements` array, if one was recorded on it. An array whose
 * length is not what it was when its origins were recorded has none: an element spliced in or
 * out since would shift every origin after it.
 */
export declare function elementOriginAt(elements: unknown, k: number): number | undefined;
/** Record the origin of an element node (or of whatever object stands for one element); undefined records none. */
export declare function recordOrigin(holder: object, origin: number | undefined): void;
/** The origin recorded on an element node, if any. */
export declare function originOf(holder: unknown): number | undefined;
/** Record the origin of the one element a scalar value's node writes for itself. */
export declare function recordOwnElementOrigin(node: object, origin: number | undefined): void;
/** The origin of the one element a scalar value's node writes for itself, if one was recorded. */
export declare function ownElementOriginOf(node: object): number | undefined;
/**
 * The attribute an element's open tag carries its origin in while a merge asks for one. Not a
 * name MATLAB writes, and a name EntryMerge refuses to find in what it writes.
 */
export declare const ORIGIN_ATTR = "dex-core-origin";
/** Whether the writers are to spell origins now (inside withOriginTags). */
export declare function taggingOrigins(): boolean;
/** Run `write` with the writers spelling each element's origin, where it has one. */
export declare function withOriginTags<T>(write: () => T): T;
/** The origin attribute, with its leading space, for an open tag: '' unless origins are being spelled and there is one. */
export declare function originAttr(origin: number | undefined): string;
/**
 * `xml`, one element a writer wrote (`<Element …`, after its indentation), with its origin
 * spelled on its open tag; `xml` itself when origins are not being spelled, there is none, or
 * the text is not an element's.
 */
export declare function withOrigin(xml: string, origin: number | undefined): string;
//# sourceMappingURL=EntrySource.d.ts.map