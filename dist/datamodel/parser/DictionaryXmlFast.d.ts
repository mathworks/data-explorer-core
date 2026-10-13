/**
 * Where each entry of a chunk sits, as `readDictionaryXmlFast` records it when asked: the
 * `[start, end)` of each entry's `<Object Class="DD.ENTRY">…</Object>` in document order,
 * whether the spans can be trusted for more than that (`clean`), and whether this reader read
 * the document and the spans are its (`read`).
 */
export interface ReadEntrySpans {
    spans: Array<readonly [number, number]>;
    clean: boolean;
    read: boolean;
}
/** MATLAB's open tag of an entry, the only one whose span is recorded. */
export declare const ENTRY_OPEN = "<Object Class=\"DD.ENTRY\">";
/**
 * Whether an object's open tag, not MATLAB's, could be an entry's: one that spells `DD.ENTRY`,
 * or holds an entity reference that could. Past one, the entries could no longer be counted off
 * against the spans. Shared with `BinarySlddParser.entrySpans`, so both stop at the same tag.
 */
export declare function spellsEntry(openTag: string): boolean;
/**
 * Read a dictionary XML part, or decline.
 *
 * `null` means "I did not read this" — never "this is broken". The caller must fall back to the
 * general engine, which owns every judgement about damaged input.
 *
 * HOW THE STATE IS HELD, and why it is seven arrays instead of a stack of objects.
 *
 * The obvious shape is a `Frame` object per open element, pushed and popped. It works and it
 * was the first version, and it cost one object plus one attribute array for every element in
 * the file — 13.8 M allocations on the corpus's largest dictionary, all of them dying
 * immediately. Dictionaries nest shallowly (single digits), so the arrays below are indexed by
 * DEPTH and reused: a `<P>` at depth 3 writes over the state of the previous `<P>` at depth 3.
 * The element's own object (`kids[d]`) is of course fresh each time, because it is the output.
 *
 * WHERE EACH ENTRY SITS, for the save that writes an unedited entry back as its bytes
 * (`BinarySlddParser`, `parser/EntrySource`). Given `entries`, this reader also records the
 * text span of every `<Object Class="DD.ENTRY">` it reads as an entry, from its open tag to the
 * `</Object>` that closes it, at the input's own offsets. It is the reader's own reading, so
 * each span is the element the entry was read from by construction: no text that spells a tag
 * is taken for one, because this reader takes nothing for a tag that it did not read as one.
 * The spans are the ones `BinarySlddParser.entrySpans` finds by scanning the markup, which it
 * does for a chunk this reader declines, and the two are held to each other over every binary
 * fixture; that scan is the stricter about a tag's syntax, and refuses some this reader reads.
 * As there, `clean` is false for an object nested in an entry and for an entry closed other
 * than by `</Object>`, and an object tag at the top that is not MATLAB's entry tag but could be
 * an entry's (`spellsEntry`) stops the recording there. `read` is set only when this reader
 * read the whole document and its offsets are the input's — not after a line-end
 * normalization, which moves them — so a span that is not recorded is never mistaken for one
 * that is. Recording costs a comparison per tag, where scanning the chunk separately made a
 * read of the largest dictionary measured (207 MB, 140,000 entries) 0.29 s slower: 2.28-2.33 s
 * against 1.99-2.02 s, over three runs.
 */
export declare function readDictionaryXmlFast(input: string, entries?: ReadEntrySpans): Record<string, unknown> | null;
//# sourceMappingURL=DictionaryXmlFast.d.ts.map