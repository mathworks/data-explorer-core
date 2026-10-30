import { type EntrySelector } from '../datamodel/parser/entrySelector.js';
import { type StructuralResult } from './dictionaryPaste.js';
export type { StructuralResult };
export declare function reserializeEntryXml(entry: any): string;
/**
 * Delete a top-level entry by removing its <Object> element span.
 *
 * `sectionRowId` spells a section header's row id from its name (data-explorer-view's
 * buildSectionRowId), where the selection lands when the entry was its section's last, as the JSON
 * path's deleteEntry takes it.
 */
export declare function deleteEntryXml(text: string, entry: any, sectionRowId: (name: string) => string): StructuralResult;
/** Delete a nested child: mutate model, reserialize the owning entry, splice it. */
export declare function deleteChildXml(text: string, node: any): StructuralResult;
/** Delete several nested children of one entry: mutate model, reserialize that entry once. */
export declare function deleteChildrenXml(text: string, nodes: readonly any[]): StructuralResult;
/** Add a child to a container node, reserialize its owning entry, splice it. */
export declare function addChildXml(text: string, node: any): StructuralResult;
/**
 * Paste a serialized entry payload as a new entry. Every rule about what the
 * pasted entry BECOMES (allow-check, unique name, section rebind, fresh uuid,
 * Constant value gate) is prepareEntryForPaste, shared with the JSON path; only
 * the fragment insert below is XML-specific.
 */
export declare function pasteEntryXml(text: string, section: any, payload: Record<string, unknown>): StructuralResult;
/**
 * Add a new default entry of `className` to `section`. Every rule about what the new entry
 * BECOMES is `createEntry` — really core's `addEntry` — shared with the JSON path; only the
 * fragment insert below is XML-specific.
 */
export declare function addNewEntryXml(text: string, section: any, className: string): StructuralResult;
/** Multi-paste for a binary .sldd (multi-select drop). See foldPasteEntries. */
export declare function pasteEntriesXml(text: string, section: any, payloads: Record<string, unknown>[]): {
    newText: string;
    selectIds: string[];
};
/**
 * Remove many entries, each identified by a selector or a bare name (see
 * core's entrySelector.ts). Each span is re-found against the text the previous removal
 * produced, mirroring the JSON path: a target listed twice (the same entry
 * reaching the move list from two selected rows) would otherwise be spliced twice
 * from stale offsets, deleting an innocent neighbouring entry's fragment and
 * leaving unbalanced <Object> tags. Absent targets are skipped.
 */
export declare function deleteEntriesByNameXml(text: string, targets: (string | EntrySelector)[]): string;
//# sourceMappingURL=xmlStructuralEdit.d.ts.map