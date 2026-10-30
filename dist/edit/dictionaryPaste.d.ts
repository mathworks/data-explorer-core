import { type EntrySelector } from '../datamodel/parser/entrySelector.js';
import type { TextPatch } from './textPatch.js';
/**
 * A refusal that changed nothing: a message, and no repair.
 *
 * Thrown by an adapter (or the policy) only while the document, its model and its rows are all
 * still exactly as they were — the cut stays on the clipboard for another try, and no repaint
 * is spent putting back what was never moved.
 */
export declare class TransferRefused extends Error {
    constructor(message: string);
}
export interface StructuralResult {
    newText: string;
    selectId: string | null;
    /**
     * The ONE region of the input text this edit changed, when it is one region — which every
     * transform in this file is (see the header: an element spliced, dropped, or inserted).
     *
     * Reported so the host can write that region instead of the whole document: VS Code stores
     * an edit as what it was handed, so a full-text replace makes both the edit and its undo
     * cost a 47.8 MB rewrite to say a 1 KB thing. Optional because the multi-target paths
     * (deleteEntriesByName) change several regions and because the XML transforms share this
     * shape without reporting one — an absent patch simply means "write newText".
     */
    patch?: TextPatch;
}
/**
 * Refuse, before anything changes, a paste or drop the section's allow-list will not take.
 *
 * The same check foldPasteEntries makes for every payload before its fold, asked earlier: by
 * then a same-document move has already taken its sources out of the model, so a refusal there
 * has a tree to repair, and here it has none. Worded as it always was, so the message the user
 * sees for a refused class does not depend on which of the two caught it.
 */
export declare function refuseDisallowedPaste(section: any, payloads: readonly Record<string, unknown>[]): void;
/**
 * Refuse to write a NEW entry into a JSON dictionary with a `null` where its value holds a number.
 *
 * A binary dictionary, and a MAT-file, hold a scalar Inf, -Inf or NaN as the bare number, and so
 * does the record a copy of one carries. A text dictionary spells such a number as text
 * (`{"_type": "double", "_value": "Inf"}`, as MATLAB writes one), and core spells a bare one so as
 * it takes a pasted entry in (SectionNode.parseEntry), at an entry's value, a struct's field, a
 * cell's element and an object's property alike: so a paste never reaches this with one. This is
 * the safety net for a record core handed back as it was — a value it could not take apart, one
 * past its writer's budget — whose bare number this writer (textDictionaryJson, as JSON.stringify
 * does) would write as null:
 * the pasted entry would then read, and save, as another value, with nothing said. Refused
 * instead, naming the entry and where in it the number is; nothing is written.
 *
 * New entries only (a paste, a drop, an Add): the file's own entries are written as they read.
 */
export declare function refuseUnwrittenNumber(newNode: any, record: any): void;
/**
 * Deep-clone a clipboard payload so repeated pastes don't alias the same object.
 *
 * Through entryOps' recordCopy, which the undo records share, and not a JSON round trip: a
 * binary dictionary's payload holds an Inf, a NaN or a -0 as the bare number, which the round
 * trip turned into null or 0, so the pasted entry was another value.
 */
export declare function cloneForPaste(payload: Record<string, unknown>): Record<string, unknown>;
export declare function assertTypeAllowed(section: any, payload: Record<string, unknown>): void;
/**
 * The authoritative Variable→Constant gate, shared by the JSON and XML paste
 * paths. A plain MATLAB variable pasted into a DERIVED section (Architectural
 * Data) becomes a Constant, which must be scalar-numeric. `newNode` is the node
 * section.parseEntry already built — a derived plain variable is reclassed to a
 * ConstantNode, so we test its `isScalarNumeric`. Throws if it isn't, so both
 * keyboard/menu Paste and drop are gated (drop feedback alone is only advisory).
 * Non-variable entries (Bus, Signal, …) have no such flag and are unaffected.
 *
 * `isClassless` says the payload named no class, i.e. it is being MADE a Constant
 * here — such a node must PROVE it is scalar-numeric. Trusting the flag alone was
 * a hole: a struct payload parses to a StructNode, which exposes no
 * `isScalarNumeric` at all, and "no flag" read as "not a variable, exempt" — so a
 * struct landed in Architectural Data as an invalid Constant, even though the
 * webview's drag predictor had already said no-drop for the same gesture.
 */
export declare function assertConstantValueAllowed(section: any, newNode: any, isClassless?: boolean): void;
/**
 * Everything a paste does BEFORE it touches text: gate the payload, clone it,
 * rename it, rebind it to the target section, build the node, and gate its value.
 * Returns the new node, already added to the live `section`.
 *
 * Shared by the JSON and XML paste paths, which differ ONLY in how they splice
 * the resulting node into their document. This ran as two copies whose comments
 * each said "mirrors the other path" — the drift they were worried about is what
 * this removes, because every rule below decides where a pasted entry LANDS and a
 * one-sided fix would silently reclassify entries in one format only.
 *
 * The rules, in order:
 *  - The class must have a home in the target section (a Simulink.ServiceBus
 *    cannot go into Design), and a payload with no class is judged by the token it
 *    becomes here — see payloadAllowToken.
 *  - The payload is deep-cloned, so a repeated paste of one clipboard entry does
 *    not alias (and then mutate) the same object.
 *  - The name is made unique across the section's whole NAMESPACE, not just the
 *    section — Design and Architectural Data share one.
 *  - The entry is rebound to the target section UNCONDITIONALLY, creating the
 *    metadata object when the payload carries none. `metadata` is null for an
 *    entry whose source .sldd never declared one (e.g. hand-added in the text
 *    view), and skipping the rebind there left the pasted entry with no namespace
 *    at all — so getSectionKey fell through to its 'design' default and the
 *    reloaded file put the entry in Design Data no matter which section it was
 *    pasted into.
 *  - It gets a FRESH uuid rather than the source's, so it is a distinct object,
 *    matching the add-entry path (SectionNode). Pasting into Architectural Data
 *    is still allowed: the new uuid is simply one the ArchitecturePart /
 *    SystemComposer mapping does not reference yet, which leaves every existing
 *    (referenced) entry intact — the same benign desync already accepted for
 *    add-child. It never corrupts existing references.
 *  - Both metadata fields matter: `namespace` routes the entry, and `isderived`
 *    is what actually distinguishes Arch from Design (they share NS_DESIGN), so
 *    rewriting it is what declassifies an arch paste into a genuine, editable
 *    Design entry.
 */
export declare function prepareEntryForPaste(section: any, payload: Record<string, unknown>): any;
/**
 * Drop-completion transform: paste MANY payloads into `section` in one edit —
 * exactly what a multi-select drop needs. Shared by both .sldd formats, which
 * supply their own single-entry paste (`pasteOne`) and differ in nothing else.
 *
 * It is a fold: each paste re-inserts into the text produced by the previous one
 * AND adds the new node to the live `section`, so `_uniqueName` sees the growing
 * namespace and every dropped entry gets a distinct name (a first Bus becomes
 * Bus1, a second Bus2).
 *
 * The allow-check is all-or-nothing and runs BEFORE the fold: any disallowed
 * payload throws before any text changes, so a rejected multi-drop leaves the
 * document untouched rather than half-applied. That ordering is the whole reason
 * this is shared rather than written per format.
 *
 * A move deletes the sources separately (the host, via deleteEntry) — this side
 * is purely the paste, identical to how drop mirrors copy/cut + paste.
 */
export declare function foldPasteEntries(text: string, section: any, payloads: Record<string, unknown>[], pasteOne: (text: string, section: any, payload: Record<string, unknown>) => StructuralResult): {
    newText: string;
    selectIds: string[];
    patch?: TextPatch;
};
/** What a paste into a section made: the entries pasted, those taken out first, and the undo. */
export interface SectionPasteMade {
    /** The entries pasted, in the order the payloads were handed over. */
    nodes: any[];
    undo(): void;
    redo(): void;
}
/** A paste into a section refused, whole: why, in the rule's own words, and the entry's name. */
export interface SectionPasteRefused {
    error: true;
    reason: string;
    name?: string;
}
/**
 * The entries of `dictionary` that `targets` name, for a same-document move to take out before
 * it pastes (TransferCommit.removeFirst), each once, in the order named: by findEntryBySelector's
 * rule. A target that names no entry is passed by, as the text splices pass it by
 * (deleteEntriesByName): its entry is already gone. One that names two, which its uuid does not
 * tell apart, refuses the paste, since taking out either could take out the wrong one.
 */
export declare function entriesToRemoveFirst(dictionary: any, targets: readonly (string | EntrySelector)[]): any[] | SectionPasteRefused;
/**
 * Paste `payloads` into the dictionary section `section` as new entries, after taking `removeFirst`
 * (entries of the same dictionary, entriesToRemoveFirst) out of it, so that a moved entry keeps its
 * name. Every payload is judged by the section's allow-list before anything changes
 * (assertTypeAllowed, as foldPasteEntries judges them), then made by prepareEntryForPaste in turn,
 * so each sees the names of those before it. A new entry of a text dictionary is refused where its
 * record holds a number that dictionary would write as null (refuseUnwrittenNumber), as vscode's
 * JSON paste refuses it.
 *
 * All of it or none: where one payload is refused, every entry pasted before it is taken out, every
 * entry taken out is put back where it was, and the dictionary's dirty flag is what it was. The
 * answer then says why, in the words of the rule that refused it, naming the entry. Made, the
 * section's source is dirty, and `undo` and `redo` take the whole of it back and make it again.
 * Indexing, events and the undo stack are the session's.
 */
export declare function execPasteIntoSection(section: any, payloads: readonly Record<string, unknown>[], removeFirst?: readonly any[]): SectionPasteMade | SectionPasteRefused;
//# sourceMappingURL=dictionaryPaste.d.ts.map