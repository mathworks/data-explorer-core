export interface EntrySelector {
    name: string;
    /** The entry's metadata uuid, when the caller has one. */
    uuid?: string;
}
/**
 * The selector for a live model node OR a serialized payload — both spell the
 * two fields the same way (`name`, `metadata.uuid`), which is what lets a
 * clipboard/drag payload captured in one document delete the right entry in
 * another. A missing or non-string uuid is simply omitted, leaving a name-only
 * selector.
 */
export declare function entrySelectorOf(entry: unknown): EntrySelector;
/**
 * Accept a bare name as a selector. Callers that only know a name (a name index,
 * a test, a user-typed target) mean "whichever entry answers to this name", which
 * is exactly a selector with no uuid.
 */
export declare function toEntrySelector(target: string | EntrySelector): EntrySelector;
//# sourceMappingURL=entrySelector.d.ts.map