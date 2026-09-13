// Copyright 2026 The MathWorks, Inc.
//
// How the splice helpers IDENTIFY a top-level .sldd entry.
//
// A name is not an identity. Entry names are unique only within a NAMESPACE, and
// one .sldd holds several: Design and Architectural Data share one, while
// Configurations and Other Data each have their own. So `Array` in Design Data
// and `Array` in Other Data are two different entries that legitimately carry
// the same name — the uniqueness check a paste runs (SectionNode._uniqueName)
// de-duplicates only within the target's namespace, so pasting one into the
// other's section keeps the name rather than renaming it to `Array1`.
//
// Every entry parsed from a real .sldd carries a metadata uuid, and a pasted
// entry is given a fresh one, so the uuid is what tells two same-named entries
// apart. It is a DISAMBIGUATOR, not the key: the finders match by name and
// consult the uuid only when more than one element answers to that name. An
// unambiguous lookup therefore behaves exactly as it did before, and an entry
// with no metadata at all (hand-added in the text view) is still findable.
/**
 * The selector for a live model node OR a serialized payload — both spell the
 * two fields the same way (`name`, `metadata.uuid`), which is what lets a
 * clipboard/drag payload captured in one document delete the right entry in
 * another. A missing or non-string uuid is simply omitted, leaving a name-only
 * selector.
 */
export function entrySelectorOf(entry) {
    const e = (entry ?? {});
    const md = (e.metadata ?? {});
    const name = typeof e.name === 'string' ? e.name : '';
    return typeof md.uuid === 'string' && md.uuid ? { name, uuid: md.uuid } : { name };
}
/**
 * Accept a bare name as a selector. Callers that only know a name (a name index,
 * a test, a user-typed target) mean "whichever entry answers to this name", which
 * is exactly a selector with no uuid.
 */
export function toEntrySelector(target) {
    return typeof target === 'string' ? { name: target } : target;
}
//# sourceMappingURL=entrySelector.js.map