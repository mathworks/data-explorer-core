// Copyright 2026 The MathWorks, Inc.
//
// One region of a document's text, and the smallest single replacement that turns one text
// into another.
//
// Every structural edit produces the new text; WHICH REGION changed is a separate question,
// and its answer is a property of the two strings rather than of whatever renders them. So the
// three things here are: `TextPatch`, the region; `applyTextPatch`, the one applier, so nothing
// can apply one differently; and `minimalReplacement`, which derives the region for the writes
// that cannot say what they changed.
//
// Those writes exist. A same-document move (delete the sources, paste the copies — two
// transforms folded through one text) and a cross-document source delete both hand back whole
// text. Written as a full-document replace, that is all 47.8 MB of a real dictionary rewritten
// to say a 1 KB thing, and a host that stores an edit as what it was handed stores the rewrite
// too, so the undo costs the same again. That is a fact about LARGE DOCUMENTS, not about any
// one editor: a TUI, an LSP server and a VS Code extension writing the same dictionary back
// all pay it, and would each otherwise reimplement the surrogate rule below — the subtle part.
//
// The transforms that CAN name their region report it themselves and never come through here.
/** The text a patch produces. The one applier, so nothing can apply one differently. */
export function applyTextPatch(text, patch) {
    return text.slice(0, patch.offset) + patch.text + text.slice(patch.offset + patch.length);
}
const isHigh = (unit) => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit) => unit >= 0xdc00 && unit <= 0xdfff;
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
export function minimalReplacement(oldText, newText) {
    const shorter = Math.min(oldText.length, newText.length);
    let prefix = 0;
    while (prefix < shorter && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix))
        prefix++;
    if (prefix === oldText.length && oldText.length === newText.length) {
        return { offset: 0, length: oldText.length, text: newText };
    }
    if (prefix > 0 && isHigh(oldText.charCodeAt(prefix - 1)) && isLow(oldText.charCodeAt(prefix)))
        prefix--;
    // Bounded by what the prefix did not already claim, so the two never overlap — otherwise
    // "aaaa" → "aa" would trim four units off a two-unit change.
    const room = shorter - prefix;
    let suffix = 0;
    while (suffix < room &&
        oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)) {
        suffix++;
    }
    const end = oldText.length - suffix;
    if (suffix > 0 && isLow(oldText.charCodeAt(end)) && isHigh(oldText.charCodeAt(end - 1)))
        suffix--;
    return {
        offset: prefix,
        length: oldText.length - suffix - prefix,
        text: newText.slice(prefix, newText.length - suffix),
    };
}
//# sourceMappingURL=textPatch.js.map