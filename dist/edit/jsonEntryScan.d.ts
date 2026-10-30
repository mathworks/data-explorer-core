/** One element of the entries array, as text. */
export interface EntryElementSpan {
    offset: number;
    length: number;
    /** Position in the entries array, counting from 0. */
    index: number;
    /**
     * The element's OWN top-level `"name"` value, or null when it declares none or one
     * that is not a string (which no selector can match — see core's entrySelector.ts).
     */
    name: string | null;
}
/** Every element of the entries array, and where the array opens. */
export interface EntriesIndex {
    /** Offset of the `[` that opens the entries array — where an insert into an empty one goes. */
    arrayStart: number;
    /** The elements, in array order. */
    elements: EntryElementSpan[];
}
/** What the scan found. `hit` is null when the change fell outside every element. */
export interface EntryScan {
    /** Elements in the entries array — ALL of them, not just up to the hit. */
    count: number;
    hit: EntryElementSpan | null;
}
/** The half-open text range a single content change occupies in the NEW text. */
export interface ChangeRegion {
    start: number;
    end: number;
}
/**
 * The offset of the `[` that opens the entries array, or -1 when the text does not spell
 * the path to it (a file of another shape, or one mid-edit).
 */
export declare function findEntriesArrayStart(text: string): number;
/**
 * Count the entries array's elements and find the one containing `region`.
 *
 * Returns null when the array cannot be walked to its end — a truncated or malformed
 * document, which the caller answers with the full repaint that reports the parse error.
 *
 * CONTAINMENT. The region must lie within one element's `{...}` span AND touch its
 * interior. Both halves matter:
 *   - Within, inclusive of the braces, because a table cell edit arrives as a range
 *     replace of the whole element (see SlddTextEditorProvider.applyEdit) and is exactly
 *     as safe as a change inside it: everything outside the span is byte-identical, so
 *     the array's structure is whatever it was, and the element itself is re-parsed.
 *   - Touching the interior, so that a zero-width change AT a brace — the caret left
 *     after deleting the comma that separates two elements — is refused. That deletion
 *     is outside every element, and calling it "inside this one" would report an
 *     unchanged entry while the document silently stopped being valid JSON.
 */
export declare function scanEntries(text: string, arrayStart: number, region: ChangeRegion): EntryScan | null;
/**
 * Every element of the entries array, and where the array opens — or null when the text does
 * not spell the path to it, or the array cannot be walked to its end.
 *
 * This is the index the splice finders (entrySplice.ts) resolve a selector against, and the
 * one a repaint locates a change in. Callers that hold it hold the whole account of the
 * array's shape; nobody has to walk the document twice to ask a second question about it.
 */
export declare function indexEntries(text: string): EntriesIndex | null;
/**
 * The entries array element a single content change landed in, and how many elements the
 * array holds — or null when the text does not answer both.
 */
export declare function locateChangedEntry(text: string, region: ChangeRegion): EntryScan | null;
//# sourceMappingURL=jsonEntryScan.d.ts.map