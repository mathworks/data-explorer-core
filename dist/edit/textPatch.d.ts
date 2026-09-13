/** One byte-scoped replacement of a document's text: `length` bytes at `offset` become `text`. */
export interface TextPatch {
    offset: number;
    length: number;
    text: string;
}
/** The text a patch produces. The one applier, so nothing can apply one differently. */
export declare function applyTextPatch(text: string, patch: TextPatch): string;
/**
 * The one region to replace in `oldText` to make it read exactly `newText`.
 *
 * Trims the common prefix and suffix, which is all the safety argument this needs: replacing
 * the middle with the corresponding middle of the new text yields the new text, whatever the
 * two texts are. There is no attempt to find several regions — one is what a WorkspaceEdit
 * range replacement is, and for these callers the change is one contiguous stretch anyway.
 *
 * SURROGATE PAIRS are why the boundaries are nudged. An offset that falls between the two
 * code units of an emoji is not a position VS Code will honour — it validates a range out to
 * the pair boundary, which would move the write and leave the document holding half a
 * character. A real dictionary carries emoji in Description strings, so this is reachable.
 *
 * Identical texts answer with the whole-document replacement rather than an empty edit: that
 * is the edit these callers made before this function existed, and an empty one would not
 * mark the document dirty. No caller reaches it (each of them changed something), but the
 * answer should not depend on that.
 */
export declare function minimalReplacement(oldText: string, newText: string): TextPatch;
//# sourceMappingURL=textPatch.d.ts.map