import { type EntrySelector } from './entrySelector.js';
export interface XmlSpan {
    offset: number;
    length: number;
}
/**
 * The text of the first P-node that `open` begins, exactly as
 * `fragment.match(/<P Name="Name"[^>]*>([^<]*)<\/P>/)?.[1] ?? null` read it for
 * `open` = `<P Name="Name"`, and the same pattern with `UUID` for `<P Name="UUID"`,
 * on every input.
 *
 * The regex retried at every `open` in the fragment, and each retry walked to the
 * next `>` and the `<` after it, so a fragment holding many `open`s that no `>`
 * follows soon cost their count times that walk: the square of a run that the
 * file's bytes decide.
 *
 * At one start the regex can match only one way. `[^>]*` cannot pass a `>`, so its
 * `>` is the first one after `open`; `[^<]*` cannot pass a `<`, so the text ends at
 * the first `<` after that, where `</P>` either is or is not. `open` starts with its
 * only `<` and holds no `>`, so a later start either lies before that `>` (and meets
 * the same `>`, the same `<` and the same answer) or lies at or after that `<`. So
 * the next start worth trying is the next `open` from there, and no character is
 * read more than a bounded number of times.
 */
export declare function pNodeText(fragment: string, open: string): string | null;
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