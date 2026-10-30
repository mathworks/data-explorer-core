import { type EntrySelector } from '../datamodel/parser/entrySelector.js';
/**
 * What the ops ask of the session whose tree they change: core's Session has each (createSession(),
 * and the default DataModel). Required of every call that reaches it, so an engine that forgot to
 * pass its own session cannot edit another's model without the compiler saying so.
 */
export interface EntryOpsSession {
    mutateSubtree<T>(root: any, mutate: () => T): T;
    isUnchangedEdit(nodeId: string, key: string, text: string): boolean;
    indexSubtree(root: any): void;
    unindexSubtree(root: any, detach?: () => void): void;
    findNodeById(nodeId: string): any;
}
/** One entry serialized the way `SectionNode.parseEntry` takes it back. */
export type EntryRecord = Record<string, unknown>;
/**
 * Mutate `entry`'s subtree in place, with the session's node index repaired around it.
 *
 * The ops below describe a change to an entry by REBUILDING it from a record; this is the
 * other shape, and the one every cell edit takes — the node the user typed into is changed
 * where it stands. It belongs here because it carries the same obligation, for the same
 * reason: a node id is a PATH, so renaming an entry (or a nested child) rekeys everything
 * beneath it, and the wide re-parse used to repair that as a side effect. An edit that keeps
 * the model it already has must say so explicitly, or findNodeById stops resolving the very
 * row ids the repaint is about and the NEXT edit on one of them fails with "could not locate
 * the edited item".
 *
 * Both providers mutate through here, which is what makes a cell edit mean the same thing in
 * a binary .sldd and a JSON one. Returns whatever the mutation returned, so a setProperty
 * refusal reaches the caller unchanged.
 */
export declare function mutateEntry<T>(entry: any, mutate: () => T, session: EntryOpsSession): T;
/**
 * A cell edit: `columnId` of `node` (in `entry`) set to `newValue` through mutateEntry, answering
 * the setter's result; or `unchanged`, with the setter not called, where core says the text is
 * the cell's own.
 *
 * Core takes a cell's own text, set back, as no edit (isUnchangedEdit, the rule of the session's
 * editProperty, which the MAT-file editor edits through and which writes nothing for it). A
 * dictionary's editor that wrote the entry anyway rewrote it, in core's spelling, and dirtied the
 * document, for an edit the user never made. Asked of core, and before the setter rather than read
 * off its `true`: a setter can change the model for the text the cell shows (an object given the
 * empty Description it had none of), and what it changed must then be written.
 */
export declare function cellEdit(entry: any, node: any, columnId: string, newValue: string, session: EntryOpsSession): {
    result: any;
    unchanged: boolean;
};
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
 * What an applied op leaves for the views to repaint — one per op, in order.
 *
 * The model change happens once per document; the row repaint happens once per view,
 * so the two are separate steps and this is what passes between them. It names nodes
 * rather than rows because rows are per-view work (each view stamps its own Modified
 * and clipboard marks), and the row ids it does carry are the ones the TABLE spells,
 * which is not always what the model now says (see `entryRowId`).
 */
export type AppliedOp = 
/**
 * Repaint `entry`'s rows over the run the table holds under `entryRowId`. On a
 * rename that id is the entry's OLD one: the rows on screen still carry it.
 */
{
    kind: 'replace';
    entryRowId: string;
    entry: any;
}
/** Add `entry`'s rows before `beforeRowId`, or last in its section when absent. */
 | {
    kind: 'insert';
    entry: any;
    beforeRowId?: string;
}
/** Drop the run the table holds under `entryRowId`. */
 | {
    kind: 'remove';
    entryRowId: string;
};
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
/** One forward change and its inverse, collected in the order the changes happen. */
export interface EntryOpPair {
    redo: EntryOp;
    undo: EntryOp;
}
/**
 * Fold ordered forward/inverse pairs into a patch.
 *
 * The undo list comes out REVERSED, which is the whole reason this is a function rather
 * than two array literals per call site: a same-document move is [remove source, insert
 * copy], and undoing it is [remove copy, insert source]. Replaying the inverses in the
 * forward order would insert the source while the copy still holds the name it inherited
 * from it — two entries answering to one name, hence to one id.
 */
export declare function patchOfPairs(pairs: EntryOpPair[]): EntryPatch;
/**
 * Snapshot one live entry as a record.
 *
 * DEEP-COPIED on purpose. `serialize()` shares sub-objects with the node it came from
 * (the stored value bag is copied one level), and a record captured for the undo stack
 * has to describe the entry as it was at capture time no matter what later edits do to
 * that node — the same reason a paste clones its clipboard payload. Through recordCopy,
 * which a paste's clone shares, and not a JSON round trip: see there.
 */
export declare function entryRecord(entry: any): EntryRecord;
/**
 * A deep copy of a serialized entry record, as a JSON round trip would make it — except that
 * every number is kept as the number it is.
 *
 * A binary dictionary's reader holds a scalar double as a bare JS number: a scalar entry's
 * value, a struct's field, an object's property. So an Inf, a NaN or a -0 is one in the record,
 * and JSON has no spelling for any of them — the round trip both copies used turned Infinity,
 * -Infinity and NaN into null and -0 into 0. A pasted entry, and an entry an undo rebuilt from
 * its record, came back as another value, with nothing said.
 *
 * Everything else is what the round trip did, on purpose, so that the only change is the one
 * that was a loss: an undefined, a function or a symbol is dropped from an object and is null
 * in an array, a `toJSON` is asked (a Date is its text), and a `__proto__` key stays a key.
 * structuredClone would be the other answer, and it keeps `undefined` members a writer would
 * then meet, and throws on a function.
 *
 * And a BigInt is refused, as JSON.stringify refuses one, with a TypeError — naming where it
 * stands, which JSON's does not. Core's MAT reader can hold a 64-bit integer as one, and a record
 * that holds one is a record neither writer here can write: the refusal is what made the entry
 * capture behind a removal (removeEntries) and an undo record refuse BEFORE anything changed,
 * and passing it through would move that failure to a later write, after the model has moved.
 */
export declare function recordCopy(value: unknown): unknown;
/** The op that restores `entry` as it stands now, over the row id the table shows. */
export declare function replaceOp(entry: any, rowId: string): EntryOp;
/**
 * The op that puts `entry` back where it stands now — section and position included.
 *
 * `place` is the entry node itself, held only for the bytes it was read from: an entry
 * rebuilt from a fragment takes its place in the file (see EntryFragment). It is never read
 * for anything the record says.
 *
 * `record` is for a caller that captured it earlier (removeEntries does, so a record that will
 * not serialize refuses before anything is removed); the position is read now either way.
 */
export declare function insertOp(entry: any, record?: EntryRecord): EntryOp;
/** The op that takes away the entry the table shows under `rowId`. */
export declare function removeOp(rowId: string): EntryOp;
/**
 * The row a newly-attached entry's rows go BEFORE — the next entry in its section, or
 * nothing at all when it is that section's last (which is where a paste lands).
 *
 * Exported because two callers need this answer and it has to be the SAME answer: the
 * insert op below, and the host's paste/drop, which attach their new entry themselves
 * (prepareEntryForPaste does it) and so describe the row insert without going through an
 * op. Two copies of the rule is how the narrow insert and the wide rebuild end up
 * disagreeing about where an entry sits.
 */
export declare function insertAnchorOf(entry: any): string | undefined;
/**
 * The live entry a clipboard or drag selector means, or nothing.
 *
 * A move deletes its source by NAME (that is all a payload carries across documents), and
 * both providers need the model node behind that name to state the removal as an op. Same
 * rule as the text splices in `deleteEntriesByName`: match on name, and consult the uuid only
 * when more than one entry answers to it — because a .sldd holds several namespaces, so two
 * entries legitimately share a name.
 *
 * Answers null rather than guessing when the name is ambiguous and the uuid cannot settle it.
 * The caller's fallback is the wide repaint, which is slow; moving an entry the user did not
 * touch is wrong.
 */
export declare function findEntryBySelector(model: any, target: string | EntrySelector): any;
/**
 * The single live entry a section+name pair names, or null.
 *
 * Used where the thing to be found is known by SECTION AND NAME rather than by row id: a
 * clipboard mark travels that way, because it may have been captured in another document and
 * a row id is a path into this one. Which also settles the ambiguity findEntryBySelector has
 * to consult a uuid for — a .sldd holds several namespaces, so two entries legitimately share
 * a name, but only one per section can.
 */
export declare function findEntryByName(model: any, sectionName: string, entryName: string): any;
/** Entries taken out of a model: the pairs an undo replays, and the rows to drop. */
export interface Removal {
    /** One per removed entry, in removal order — hand them to `patchOfPairs`. */
    pairs: EntryOpPair[];
    applied: AppliedOp[];
}
/**
 * Take `entries` out of `model`, stated as ops an undo can replay. The ONE way this host
 * removes several entries at once: a multi-row delete, a same-document move's sources, and a
 * cross-document move's originals all come through here.
 *
 * It used to be three techniques for one rule, and one of them was wrong. An insert op names
 * the index its entry held WHEN IT WAS CAPTURED, and `patchOfPairs` replays the inverses
 * reversed — so ops captured for every entry up front, then replayed reversed, put the
 * rightmost entry back first, counting its index past a gap no earlier insert had filled yet:
 * a section [P, Q, R] with P and Q deleted came back as [P, R, Q]. One path sorted descending
 * to dodge that, one interleaved, the binary delete did neither. Here every undo op is
 * captured against the model as it stands at that moment, then applied: [P,Q,R], remove P
 * (captures 0), remove Q (captures 0, it slid down), and the reversed replay inserts Q at 0
 * then P at 0 — [P,Q,R].
 *
 * FAIL BEFORE MUTATE. Everything that can refuse is asked before the first removal: each entry
 * must be the live node the index hands out for its id in THIS model, and each record must
 * serialize (captured up front — a record does not depend on order, only the index does). So a
 * throw from here has changed nothing, and the caller's fallback starts from the model it had.
 *
 * Deduped by node: two selected rows of one entry, or two selectors without a namespace to tell
 * them apart, name one entry, and removing it twice would throw on the second op.
 */
export declare function removeEntries(model: any, entries: readonly any[], session: EntryOpsSession): Removal;
/**
 * `removeEntries` for entries named by clipboard or drag selectors — or null, having changed
 * nothing, when any selector does not settle on one live entry (findEntryBySelector). Every
 * selector is resolved before anything is removed, so a move that names one entry the model
 * cannot find is answered whole by the caller's fallback, never half-applied.
 */
export declare function removalPairs(model: any, targets: readonly (string | EntrySelector)[], session: EntryOpsSession): Removal | null;
/**
 * The ops and the repaint for entries a paste has ALREADY attached to `section`.
 *
 * Paste is the one transform that runs ahead of its ops: `prepareEntryForPaste` has to attach
 * the new node before it can ask the section for a unique name, so by the time the caller
 * looks there is nothing left to apply — the model is already right, except for the session
 * index. Hence this shape, which does the two things that are still owed: index each new
 * subtree (a node id is a PATH, so an entry that joined the tree outside an op is in no
 * index, and the row the paste selects would not resolve for the next edit), and describe
 * what happened for the undo stack and the repaint.
 *
 * `addedFrom` is the section's child count read BEFORE the transform. Everything from there
 * on is new, in the order it was pasted, because parseEntry appends.
 *
 * Which is also why every one of these inserts is anchored at the END of the section rather
 * than on its own next sibling. The run is the section's tail, so with N > 1 an entry's next
 * sibling is the NEXT ENTRY OF THE SAME RUN — a row the table does not hold yet, because the
 * rows go out one message per op. `insertEntryRows` answers a place it cannot find with null,
 * and the webview answers null by asking for a full repaint, so a two-item paste would give
 * up the narrow path it had already half-taken. Appended in order, the run lands in order.
 */
export declare function opsOfPastedEntries(section: any, addedFrom: number, session: EntryOpsSession): {
    pairs: EntryOpPair[];
    applied: AppliedOp[];
};
/**
 * Apply ops to a model in order, returning what to repaint.
 *
 * Ops are applied left to right, so a caller inverting a list must also REVERSE it:
 * a same-document cut+paste is [remove source, insert copy], and undoing it is
 * [remove copy, insert source]. Order matters for name uniqueness — the copy may hold
 * the name the source is about to get back.
 */
export declare function applyEntryOps(model: any, ops: EntryOp[], session: EntryOpsSession): AppliedOp[];
//# sourceMappingURL=entryOps.d.ts.map