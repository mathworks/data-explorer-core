import { applyTextPatch, type TextPatch } from './textPatch.js';
import { type EntrySelector } from '../datamodel/parser/entrySelector.js';
import { type StructuralResult } from './dictionaryPaste.js';
export type { TextPatch, StructuralResult };
export { applyTextPatch };
export declare function findOwningEntry(node: any): any;
/**
 * A dictionary's section by core's own key (`design`, `arch`, `config`, `other`), or null.
 *
 * One spelling, because two callers now ask the same question for different reasons: a paste
 * into an empty section, which has only its header row to aim at, and the Add gallery, whose
 * tiles name their destination outright and so never had a row to resolve from. A section is
 * a direct child of the dictionary node, so this is a lookup and not a walk.
 */
export declare function sectionByName(model: any, sectionName: string): any;
export declare function reserializeEntry(entry: any, indent: string, elementIndent?: string): string;
export declare function reselectAfterRemoval(siblings: any[], node: any, fallbackId: string): string;
/** Delete a top-level entry by removing its element (and one comma) from the array. */
export declare function deleteEntry(text: string, entry: any): StructuralResult;
/**
 * Remove a nested child from the in-memory model, reporting the entry whose text
 * has to be reserialized and where the selection should land. This is the part of
 * a nested delete that decides what the edit MEANS — which nodes may be removed,
 * which entry owns the row, where the selection goes — so both .sldd formats
 * share it and only the splicing differs (see the header of xmlStructuralEdit.ts).
 */
export declare function removeChildFromModel(node: any): {
    entry: any;
    selectId: string;
};
/**
 * Add a child to a container node in the in-memory model, reporting the owning
 * entry and the new child's id (which the caller selects). Shared by both .sldd
 * formats, for the same reason as removeChildFromModel.
 */
export declare function addChildToModel(node: any): {
    entry: any;
    selectId: string;
};
/** Delete a nested child: remove it from its parent, reserialize the owning entry. */
export declare function deleteChild(text: string, node: any): StructuralResult;
/**
 * Remove SEVERAL nested children of ONE entry from the model, reporting the entry to
 * reserialize and where the selection should land.
 *
 * `removeChildFromModel` is this with a list of one; what N adds is a single splice
 * afterwards, which is the bug this exists to prevent. Calling deleteChild twice for two
 * fields of one struct splices the entry twice, and the second splice searches text the
 * first has already rewritten — the span it finds is the wrong length and its write lands
 * over the entry's neighbour. Same reason foldPasteEntries folds N pastes into one
 * insertion instead of writing N times.
 *
 * ALL the children must share one entry, and that is checked rather than assumed: one
 * splice can only rewrite one entry, so a mixed list would drop the other entry's
 * removals from the text while keeping them in the model — a table that disagrees with
 * its own file. The caller that groups them (core's planDeletion) guarantees it;
 * this is what makes the guarantee testable.
 *
 * Both checks run over the WHOLE group before anything is removed, so a group this
 * refuses leaves the model exactly as it found it. Validating as it went would half-apply
 * a gesture that then threw, and the live model would keep those removals until the next
 * re-parse — a table showing a delete the file never received.
 *
 * The selection is the last removal's answer, but only if it survived: reselectAfterRemoval
 * answers per removal, so an earlier one may have taken away the sibling a later one
 * chose. Falling back to the entry keeps the selection on a row that still exists.
 *
 * Both .sldd formats share this and differ only in the splice that follows — see
 * deleteChildren below and deleteChildrenXml in xmlStructuralEdit.ts.
 */
export declare function removeChildrenFromModel(nodes: readonly any[]): {
    entry: any;
    selectId: string;
};
/** Delete several nested children of one entry, reserializing that entry once. */
export declare function deleteChildren(text: string, nodes: readonly any[]): StructuralResult;
/** Add a child to a container node (struct/bus/enum), reserialize its owning entry. */
export declare function addChild(text: string, node: any): StructuralResult;
/**
 * Create a NEW default entry of `className` in `section`, attached to the model.
 *
 * The Add gallery's counterpart to prepareEntryForPaste, and it is one line for the same
 * reason that one is long: core's `addEntry` already IS the rule. It re-tests the section's
 * allow-list (the one gate — see SectionNode), builds the class's own default value, makes
 * the name unique across the whole shared namespace, and stamps uuid, namespace, isderived
 * and status for the section it was handed. Nothing here may re-derive any of that.
 *
 * Shared by both .sldd formats, like prepareEntryForPaste, so a JSON add and a binary add
 * cannot produce differently-classed or differently-stamped entries.
 */
export declare function createEntry(section: any, className: string): any;
/**
 * Paste a serialized entry as a NEW top-level entry in `section`, inserting the
 * element into the entries array and preserving sibling bytes. See
 * prepareEntryForPaste for every rule about what the pasted entry becomes.
 */
export declare function pasteEntry(text: string, section: any, payload: Record<string, unknown>): StructuralResult;
/** Add a new default entry of `className` to `section`. See createEntry. */
export declare function addNewEntry(text: string, section: any, className: string): StructuralResult;
/**
 * Source-side of a MOVE drop: remove the dragged entries from the SOURCE text.
 * Works purely on text so it applies to any document (the move source may differ
 * from the paste target). Targets are selectors — `entrySelectorOf(payload)` when
 * the caller has the serialized entry, or a bare name when it only has that (see
 * core's entrySelector.ts). Targets not present are silently skipped, so an already-
 * absent entry never throws (and an all-absent list returns the text unchanged,
 * byte-identical).
 *
 * Each span is re-found against the text produced by the previous removal rather
 * than all being computed up front. Element spans DO overlap, so no ordering of
 * pre-computed spans is safe: the last element's span starts at the END of its
 * predecessor (to absorb the preceding comma), while the predecessor's own span
 * runs forward to the next element's start — the comma between them belongs to
 * both. Removing both stale spans deleted that overlap twice and ate the array's
 * closing bracket, so moving the last two entries out of a document corrupted it
 * into unparseable JSON. Re-finding also makes a duplicated target a no-op on the
 * second pass instead of splicing out an innocent neighbour.
 */
export declare function deleteEntriesByName(text: string, targets: (string | EntrySelector)[]): string;
/** Multi-paste for a JSON .sldd. See foldPasteEntries. */
export declare function pasteEntries(text: string, section: any, payloads: Record<string, unknown>[]): {
    newText: string;
    selectIds: string[];
    patch?: TextPatch;
};
//# sourceMappingURL=structuralEdit.d.ts.map