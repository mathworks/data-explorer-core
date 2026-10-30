import type { EntryOp, EntryPatch, EntryRecord } from './entryOps.js';
/** The one entry a change touched, and the record the text now spells for it. */
export interface EntrySyncPlan {
    /** The live node in the model the caller passed. */
    entry: any;
    /** Its element re-parsed — exactly what `SectionNode.parseEntry` takes. */
    record: EntryRecord;
    /**
     * Always true: the record is the document's own text, so the replace op built from this plan
     * says so (EntryOp's `fromDocumentText`) and core reads it as the file's read does.
     */
    fromDocumentText: true;
}
/** A single `vscode.TextDocumentContentChangeEvent`, as much of it as matters here. */
export interface TextChange {
    /** Offset in the text BEFORE the change. */
    rangeOffset: number;
    /** The text that replaced that range. */
    text: string;
}
/**
 * A whole range replacement — what the host SUBMITS to the document, and what a change event
 * reports back.
 *
 * The plan above needs only where the new text starts and what it says (it reads the entry
 * back out of the document either way). Recognising an edit needs the length too, because
 * that is the difference between "the same text was written here" and "the same text
 * replaced the same bytes".
 */
export interface RangeReplacement extends TextChange {
    /** How many characters of the old text the replacement covered. */
    rangeLength: number;
}
/**
 * Whether a change event is the echo of `submitted` — the edit THIS host just made.
 *
 * The table's edit path mutates the model, serializes the entry, and splices it into the
 * text; the change event that splice fires carries nothing the host does not already know.
 * So it repaints from the node it changed, and the whole recovery the text-view path needs —
 * scan the array, re-parse the element, rebuild the entry a second time — is skipped.
 *
 * What makes that safe is asking the event to prove it is the same edit, byte for byte,
 * rather than trusting a flag set beforehand. A submitted edit whose event never arrives (or
 * arrives changed, e.g. line endings normalized on the way in) leaves the expectation
 * behind; spending it on the NEXT change — a keystroke in the text view, an undo, a save
 * fixup — would repaint one entry and leave stale rows for whatever really changed. Refusing
 * costs the wide repaint the user has always had.
 *
 * A batch is refused outright: only a lone change has an offset that means anything in the
 * text after it, which is the same reason planEntrySync's caller refuses one.
 */
export declare function isEchoOfEdit(changes: readonly RangeReplacement[], submitted: RangeReplacement): boolean;
/**
 * A write the host painted AHEAD of: its rows went out before a byte was written, so the change
 * event the write fires has nothing left to repaint — as long as those rows are still the ones
 * on screen.
 *
 * `epoch` is what says they are. It counts the wide repaints the view has begun, read when the
 * paint went out; a wide repaint begun since has replaced every row, and it read the text as it
 * was before this write landed, because nothing waits for a write. See isPaintedEcho.
 */
export interface PaintedWrite {
    /** The range replacement handed to the document. */
    submitted: RangeReplacement;
    /** How many wide repaints the view had begun when this write's rows were painted. */
    epoch: number;
}
/**
 * Whether a change event is the echo of a write whose rows are still on screen — the one case
 * where the event can be skipped.
 *
 * Byte for byte, as isEchoOfEdit asks, AND with no wide repaint begun since the paint. A save, a
 * webview asking for its rows (`ready`) and a clipboard broadcast over rows out of step each
 * repaint the whole table without waiting for a write in flight, and each reads the text as it
 * stands, which until the write lands is the text from BEFORE the edit: the screen goes back to
 * the old rows and the model is rebuilt from the old text. Skipped then, the echo left both
 * saying what the file no longer does. Refused, it is a change like any other, applied to the
 * tree that repaint built — the price is the repaint, never a wrong row.
 */
export declare function isPaintedEcho(changes: readonly RangeReplacement[], painted: PaintedWrite, epoch: number): boolean;
/**
 * An edit the host wrote, kept AFTER its own event has come and gone — because VS Code can
 * hand it back again, in either direction, whenever the user asks.
 *
 * An undo of a range replacement writes the replaced bytes back over the replacement, at the
 * same offset; a redo writes the replacement again. So the pair is all it takes to recognise
 * either one, and recognising it is what turns an undo from a stranger's change (find the
 * entry: `getText()` + a full structural walk, 35 ms + 138 ms on a 47.8 MB dictionary) into an
 * element already in hand.
 */
export interface KnownEdit {
    /** The range replacement handed to the document. */
    submitted: RangeReplacement;
    /** The text it wrote over — what an undo of it writes back. */
    replaced: string;
    /**
     * The model ops that restore either side of it, for a STRUCTURAL edit — one whose meaning
     * cannot be read back out of the bytes it writes (see planKnownOps). A cell edit needs none:
     * the bytes it writes are one element, and re-parsing that element says everything.
     */
    patch?: EntryPatch;
}
/**
 * What the host remembers about the edit it just submitted, until the change event arrives.
 *
 * Set immediately before the WorkspaceEdit and spent by the very next change event, once.
 *
 * ONE id, because the edit has painted by the time this is set: the model holds the entry under
 * the name the edit gave it, and so do the rows on screen. It used to carry the pre-rename id as
 * well, for the rows — from when the echo was the paint, and the table still held the entry under
 * its old name. Once the paint came first, that id named a run the table no longer had, every
 * rename's confirmation missed it, and the table asked for the whole payload to recover.
 */
export interface HostEdit {
    /** The edited entry as the MODEL and the ROWS ON SCREEN now spell it — after any rename. */
    entryId: string;
    /** The range replacement handed to the document. */
    submitted: RangeReplacement;
    /**
     * How many wide repaints the view had begun when this was set — the same stamp, for the same
     * reason, as PaintedWrite's: a wide repaint begun since has replaced the rows `entryId` names
     * (see hintFor).
     */
    epoch: number;
}
/**
 * The expectation a change event may use, or null.
 *
 * The hint names the rows the edit painted and the entry as the edit left the model. A wide
 * repaint begun since has rebuilt both from the text before the write landed, so neither is
 * true any more, and the event is a change like any other to the tree that repaint built —
 * which the recovery path plans by itself (planEntrySync), from the rows that are on screen.
 */
export declare function hintFor(hint: HostEdit | null, epoch: number): HostEdit | null;
/** The op the host's own edit amounts to, and the run of rows to paint it over. */
export interface OwnEditPlan {
    op: EntryOp;
    /** The row id the table is holding the entry under (see HostEdit.entryId). */
    entryRowId: string;
}
/**
 * The entry op the host's OWN edit amounts to — no scanning, no re-parse of the document.
 *
 * The table's edit path mutates the model, serializes the entry, and splices it into the text.
 * The change event that splice fires carries nothing the host does not already know, so the
 * whole recovery the text-view path needs — scan the array, find the element the change is in,
 * re-parse it, check the entry count still matches — is skipped: the changed element IS the
 * text that was submitted.
 *
 * WHY THE ENTRY IS REBUILT FROM THAT TEXT rather than repainted from the node the edit mutated,
 * which is what the binary provider does and is cheaper still. A mutation is not a re-parse, and
 * where the two disagree the repaint would show something the next wide repaint takes away. The
 * three disagreements this path was written around have since been fixed at the model layer — a
 * rename now moves the systemComposer catalog with it, and the two cells whose text serialize()
 * dropped (a Description a node has nowhere to write, the Name of an object's Value row) are
 * refused instead of accepted. Reading the bytes back is what made this path correct BEFORE they
 * were, and what keeps it from depending on the next one being found: "the table says what the
 * file says" holds by construction, and still costs a fraction of finding the entry again (7 ms
 * against 290 ms on a 46 MB dictionary).
 *
 * A change that does not prove itself to be the echo is refused (see isEchoOfEdit), and the
 * caller falls back to the recovery path, which reads the same bytes the slow way.
 */
export declare function planOwnEdit(changes: readonly RangeReplacement[], hint: HostEdit): OwnEditPlan | null;
/**
 * The entry op an undo or a redo of one of the host's OWN edits amounts to — no
 * `document.getText()`, no scan.
 *
 * This is the third and last of the "table → text → table" round trip. A cell edit paints from
 * the model immediately (applyEdit) and its echo is recognised (planOwnEdit); the undo of that
 * same edit used to arrive as a stranger and pay the full recovery — pull the whole document
 * out as a string (35 ms on 47.8 MB) and walk it structurally to find the element the change
 * is in (138 ms) — to learn something the host wrote down when it made the edit.
 *
 * `known` is the ring of edits the host still remembers, newest last; it is searched
 * newest-first because that is the order undo works in. The plan is built from the CHANGE's
 * own text, not from the remembered copy: the match has just proved the two are the same
 * bytes, and planning from what the document actually now says is the version of that
 * statement that cannot drift.
 *
 * Every guard that matters is inherited: recognition is byte-exact at an exact offset (an edit
 * elsewhere shifts the offset and the match simply fails), a batch is refused because its
 * later offsets are stated against the text before it, and the element still has to parse and
 * still has to name an entry this model holds in the same section. A miss costs the scan,
 * which is what every undo used to cost.
 */
export declare function planKnownChange(model: any, changes: readonly RangeReplacement[], known: readonly KnownEdit[]): EntrySyncPlan | null;
/**
 * The model ops an undo or a redo of one of the host's own STRUCTURAL edits amounts to.
 *
 * planKnownChange above recovers a cell edit's undo by re-parsing the bytes that came back,
 * which works because those bytes are one element and an element says everything about the
 * entry it names. A structural edit's bytes do not. A delete writes back an element AND the
 * comma that separated it; a paste's undo writes back nothing at all; a move's write spans two
 * places at once. There is no element to read, so what the change MEANS is not in its text — it
 * is in what the host knew when it made the edit, which is why the ops are remembered with it.
 *
 * Recognition is the same byte-exact test in both directions (isEchoOfEdit for a redo,
 * isUndoOfEdit for an undo), against the same newest-first ring, and inherits the same guards:
 * an edit anywhere else shifts the offset and the match fails, and a batch is refused because
 * its later offsets are stated against the text before it. An edit remembered without ops
 * answers null and is left to the paths that read bytes.
 *
 * A miss costs the wide repaint, which is what every structural undo used to cost.
 */
export declare function planKnownOps(changes: readonly RangeReplacement[], known: readonly KnownEdit[]): EntryOp[] | null;
/**
 * The entry op one text change amounts to, or null when it does not amount to one.
 *
 * `model` is the tree already built for this document, in the state the text was in
 * BEFORE the change; `newText` is the document as it now reads.
 */
export declare function planEntrySync(model: any, newText: string, change: TextChange): EntrySyncPlan | null;
//# sourceMappingURL=jsonEntrySync.d.ts.map