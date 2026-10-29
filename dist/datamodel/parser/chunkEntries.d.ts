/** One entry of a chunk, where its `<Object>…</Object>` sits in the text it was scanned from. */
export interface ChunkEntry {
    /** The `<` of its `<Object` open tag. */
    readonly start: number;
    /** Just past its `</Object>`. */
    readonly end: number;
    /** The text of its own `<P Name="Name">`, as the bytes spell it; null when it has none. */
    readonly name: string | null;
    /** The text of its own `<P Name="UUID">`, as the bytes spell it; null when it has none. */
    readonly uuid: string | null;
}
export interface ChunkEntries {
    readonly entries: ChunkEntry[];
    /** Whether the scan read the whole chunk; see the header. */
    readonly clean: boolean;
}
/** Scan `xml` for its entries; see the header for what counts as one and what `clean` means. */
export declare function scanChunkEntries(xml: string): ChunkEntries;
/** The text an entry's Name or UUID bytes spell, with XML's character references decoded. */
export declare function decodeXmlText(raw: string): string;
/**
 * What an entry is known by across edits: its UUID, which a rename does not change, or its name
 * when it has none. The save gate pairs a chunk's entries with the last-saved chunk's by this,
 * and the edits record the entries they change by it.
 */
export declare function entryKey(name: string | null | undefined, uuid: string | null | undefined): string;
/** An entry's key from the bytes, decoded so that it matches the model's spelling. */
export declare function chunkEntryKey(entry: ChunkEntry): string;
//# sourceMappingURL=chunkEntries.d.ts.map