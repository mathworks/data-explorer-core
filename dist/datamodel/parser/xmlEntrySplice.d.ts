import { type EntrySelector } from './entrySelector.js';
export interface XmlSpan {
    offset: number;
    length: number;
}
/**
 * Byte span of the <Object Class="DD.ENTRY">…</Object> the selector identifies
 * (a bare string means "whichever entry has this name").
 *
 * Names are matched first and the UUID breaks a tie, exactly as on the JSON side
 * — a binary .sldd has the same per-namespace name scoping, so `Kp` in Design and
 * `Kp` in Other Data are two entries the name alone cannot tell apart. Without
 * the tiebreak the linear scan returned the FIRST `Kp`, so deleting the second
 * spliced out the first. A selector with no uuid, or one no candidate matches,
 * keeps the historical first-match behaviour.
 */
export declare function findEntryObjectSpan(xml: string, target: string | EntrySelector): XmlSpan | null;
/**
 * Span to REMOVE to delete an entry: its <Object> plus the leading whitespace of
 * its line (so the line is removed cleanly) through the newline after </Object>.
 * Removing this leaves the surrounding entries/dictionary well-formed.
 */
export declare function findEntryElementSpan(xml: string, target: string | EntrySelector): XmlSpan | null;
/**
 * Offset just before the trailing structural objects (DD.DICTIONARYREFERENCE, then
 * DD.Dictionary) where a new entry should be inserted. Falls back to the
 * DD.Dictionary if no reference object is present. Returns null if neither is found.
 */
export declare function findEntryInsertionPoint(xml: string): number | null;
//# sourceMappingURL=xmlEntrySplice.d.ts.map