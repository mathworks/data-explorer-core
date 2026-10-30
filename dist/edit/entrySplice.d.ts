import { type EntrySelector } from '../datamodel/parser/entrySelector.js';
/**
 * Locate the `{...}` span of the entry object the selector identifies (see
 * core's entrySelector.ts — a bare string means "whichever entry has this name").
 *
 * Returns the element's offset/length, or null if the entries array cannot be
 * scanned or no element matches. Never throws.
 */
export declare function findEntrySpan(text: string, target: string | EntrySelector): {
    offset: number;
    length: number;
} | null;
/**
 * Locate the text span to REMOVE to delete the entry the selector identifies
 * from the entries array — the element object plus the one comma that joins it
 * to its siblings (the preceding comma when it's the last element, otherwise the
 * following comma), and the whitespace between. Removing this span leaves valid
 * JSON. Returns null if the array or element is not found.
 */
export declare function findEntryElementSpan(text: string, target: string | EntrySelector): {
    offset: number;
    length: number;
} | null;
/**
 * The whitespace immediately before `offset` — for normally formatted text, the indent of
 * the line `offset` sits on.
 *
 * Deliberately NOT "everything between the line start and `offset`". An entries element is
 * not guaranteed to begin its line: a minified dictionary puts every element on one line,
 * and our own insert into an EMPTY array used to leave the first element on the `[` line.
 * Slicing the whole line prefix then treated `"entries": [` as indentation and copied it
 * into the file verbatim, producing a document that no longer parsed as JSON — so the
 * second add to a freshly emptied dictionary corrupted it. Taking only the whitespace run
 * degrades to `''` on a minified file instead, which is the right answer there.
 */
export declare function indentBefore(text: string, offset: number): string;
/**
 * Compute where to INSERT a new element in the entries array and how the array
 * is indented, so paste and add can append a uniquely-named entry. Returns:
 *  - `offset`: text offset to insert at (just after the last element, or just
 *    inside `[` for an empty array),
 *  - `needsLeadingComma`: whether a `,` must precede the inserted element,
 *  - `elementIndent`: the whitespace the new element's `{` should sit behind,
 *  - `trailingBreak`: text that must follow the element — the line break and array
 *    indent that put the closing `]` back on its own line when the array was empty,
 *    and `''` when an existing element already established that layout.
 * Returns null if the entries array can't be found.
 */
export declare function findEntriesArrayInsertion(text: string): {
    offset: number;
    needsLeadingComma: boolean;
    elementIndent: string;
    trailingBreak: string;
} | null;
/**
 * Detect the indent unit used by the source text.
 *
 * Returns the leading whitespace of the first indented line: "\t" for tabs, or
 * the run of spaces for a space-indented file. Falls back to two spaces when no
 * indented line is found.
 */
export declare function detectIndent(text: string): string;
//# sourceMappingURL=entrySplice.d.ts.map