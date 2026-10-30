/** One entry serialized the way `SectionNode.parseEntry` takes it back. */
export type EntryRecord = Record<string, unknown>;
/**
 * A change to WHICH entries a dictionary has, or to what one of them holds.
 *
 * Deliberately only three, and all at entry granularity: an edit inside an entry —
 * a value, a rename, a nested child added or deleted — is a `replace` of the whole
 * entry, which is why nothing here has to know how entries are built inside.
 */
export type EntryOp = 
/**
 * Rebuild the entry the table spells `rowId` from `record`, in its own slot.
 *
 * `fromDocumentText` says the record is the text dictionary's own text, re-read: the JSON
 * view's plans set it (jsonEntrySync.ts), and core then reads the record as the file's read
 * reads it (`parseEntry`'s `asRead`, mathworks/data-explorer-core#140). An undo or redo
 * record, a paste and an insert are not the file's text, and never set it.
 */
{
    kind: 'replace';
    rowId: string;
    record: EntryRecord;
    fragment?: EntryFragment;
    fromDocumentText?: boolean;
}
/** Build `record` into `sectionName` at `index` (clamped; < 0 or past the end = last). */
 | {
    kind: 'insert';
    sectionName: string;
    index: number;
    record: EntryRecord;
    fragment?: EntryFragment;
    place?: unknown;
}
/** Detach the entry the table spells `rowId`. */
 | {
    kind: 'remove';
    rowId: string;
};
/**
 * The entry's `<Object>…</Object>` in the chunk state its op restores, for a binary .sldd, or
 * null where it was looked for and not found. Absent until a host cuts it (the binary provider
 * does, from the chunk an undo or redo has just restored); the JSON provider never does.
 *
 * WHY. A node rebuilt from `record` has no bytes it was read from, so the next edit of it
 * writes the whole entry from the model, and every part the writers spell differently from
 * the file changes with it. Rebuilt from the fragment (core's readEntryFragment), it is read
 * as the file's own entries are, and given the place of the node it takes over (`place` for an
 * insert, which has no live node to take over), so it is written as those bytes while nothing
 * edits it and merged with them once something does. That is the maintainer's D12: undo and
 * redo keep the original-bytes provenance.
 *
 * The record stays the fallback, so a fragment that does not read as exactly the entry the
 * record names costs the provenance, never the undo.
 */
export type EntryFragment = string | null;
/**
 * The entry-level ops that restore one pushed edit's two states.
 *
 * What the host hands to its undo stack: `undo` is applied when the user undoes that
 * edit, `redo` when they redo it. Either may be empty, and an edit that could not
 * describe itself supplies no patch at all — the direction then repaints the old way,
 * from a re-parse of the text it just restored.
 */
export interface EntryPatch {
    undo: EntryOp[];
    redo: EntryOp[];
}
//# sourceMappingURL=entryOps.d.ts.map