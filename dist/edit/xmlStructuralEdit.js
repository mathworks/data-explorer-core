// Copyright 2026 The MathWorks, Inc.
//
// Copied from data-explorer-vscode src/host/xmlStructuralEdit.ts at c73da3c, which keeps its own until
// it adopts this (view-split step 6b). What differs: the imports (the shared rules are structuralEdit.ts's
// and dictionaryPaste.ts's here), and deleteEntryXml takes the section header's row-id builder from
// its caller, as deleteEntry does.
//
// Pure (VS-Code-free) XML text transforms for structural edits on a binary .sldd's
// data/chunk0.xml — the XML analog of structuralEdit.ts. Each edit replaces the
// touched entry's <Object>…</Object> with what core's spliceEntryObject writes for it
// (its bytes, with what the edit changed written from the model, laid out as the chunk
// is), so untouched sibling entries, and every byte around the entry, stay as they were.
//
// Only the SPLICING is format-specific. Everything that decides what an edit MEANS
// — which node owns a row, what a section will accept, what a pasted entry becomes,
// where the selection goes after a delete, the all-or-nothing multi-paste fold — is
// imported from the JSON path, not duplicated. Those rules had been copied here
// once, each copy commented "mirrors the JSON path", and that is exactly the drift
// this repo has already shipped bugs from: a rule fixed on one side leaves the other
// .sldd format classifying entries differently.
import { serializeEntryToXml, spliceEntryObject } from '../datamodel/parser/BinarySlddSerializer.js';
import { findEntryElementSpan, findEntryInsertionPoint } from '../datamodel/parser/xmlEntrySplice.js';
import { entrySelectorOf } from '../datamodel/parser/entrySelector.js';
import { reselectAfterRemoval, removeChildFromModel, removeChildrenFromModel, addChildToModel, createEntry, } from './structuralEdit.js';
import { prepareEntryForPaste, foldPasteEntries } from './dictionaryPaste.js';
// Reserialize one entry to its <Object> fragment (no trailing newline), for an
// in-place span replacement.
export function reserializeEntryXml(entry) {
    return serializeEntryToXml(entry).replace(/\n$/, '');
}
// Replace the owning entry's <Object>…</Object> in place with what a save writes for it now.
// Core's splice, not a span of this module's own: the entry's line used to be spliced over a
// span that starts at `<Object`, so every edit put another four spaces in front of it.
function spliceEntry(text, entry, selectId) {
    const newText = spliceEntryObject(text, entry);
    if (newText === null)
        throw new Error(`Could not locate entry "${entry.name}" text.`);
    return { newText, selectId };
}
// Insert a freshly-created model entry's fragment before the trailing dictionary.
function insertNewEntry(text, node) {
    const frag = serializeEntryToXml(node); // keeps trailing newline for clean stacking
    const at = findEntryInsertionPoint(text);
    if (at === null)
        throw new Error('Could not locate the insertion point.');
    const newText = text.slice(0, at) + frag + text.slice(at);
    return { newText, selectId: node.id };
}
/**
 * Delete a top-level entry by removing its <Object> element span.
 *
 * `sectionRowId` spells a section header's row id from its name (data-explorer-view's
 * buildSectionRowId), where the selection lands when the entry was its section's last, as the JSON
 * path's deleteEntry takes it.
 */
export function deleteEntryXml(text, entry, sectionRowId) {
    const section = entry.parent;
    const siblings = (section?.children ?? []);
    const selectId = reselectAfterRemoval(siblings, entry, sectionRowId(section?.name ?? ''));
    // By selector, not name — see core's entrySelector.ts and the JSON path's deleteEntry.
    const span = findEntryElementSpan(text, entrySelectorOf(entry));
    if (!span)
        throw new Error(`Could not locate entry "${entry.name}" to delete.`);
    const newText = text.slice(0, span.offset) + text.slice(span.offset + span.length);
    return { newText, selectId };
}
/** Delete a nested child: mutate model, reserialize the owning entry, splice it. */
export function deleteChildXml(text, node) {
    const { entry, selectId } = removeChildFromModel(node);
    return spliceEntry(text, entry, selectId);
}
/** Delete several nested children of one entry: mutate model, reserialize that entry once. */
export function deleteChildrenXml(text, nodes) {
    const { entry, selectId } = removeChildrenFromModel(nodes);
    return spliceEntry(text, entry, selectId);
}
/** Add a child to a container node, reserialize its owning entry, splice it. */
export function addChildXml(text, node) {
    const { entry, selectId } = addChildToModel(node);
    return spliceEntry(text, entry, selectId);
}
/**
 * Paste a serialized entry payload as a new entry. Every rule about what the
 * pasted entry BECOMES (allow-check, unique name, section rebind, fresh uuid,
 * Constant value gate) is prepareEntryForPaste, shared with the JSON path; only
 * the fragment insert below is XML-specific.
 */
export function pasteEntryXml(text, section, payload) {
    return insertNewEntry(text, prepareEntryForPaste(section, payload));
}
/**
 * Add a new default entry of `className` to `section`. Every rule about what the new entry
 * BECOMES is `createEntry` — really core's `addEntry` — shared with the JSON path; only the
 * fragment insert below is XML-specific.
 */
export function addNewEntryXml(text, section, className) {
    return insertNewEntry(text, createEntry(section, className));
}
/** Multi-paste for a binary .sldd (multi-select drop). See foldPasteEntries. */
export function pasteEntriesXml(text, section, payloads) {
    return foldPasteEntries(text, section, payloads, pasteEntryXml);
}
/**
 * Remove many entries, each identified by a selector or a bare name (see
 * core's entrySelector.ts). Each span is re-found against the text the previous removal
 * produced, mirroring the JSON path: a target listed twice (the same entry
 * reaching the move list from two selected rows) would otherwise be spliced twice
 * from stale offsets, deleting an innocent neighbouring entry's fragment and
 * leaving unbalanced <Object> tags. Absent targets are skipped.
 */
export function deleteEntriesByNameXml(text, targets) {
    let out = text;
    for (const target of targets) {
        const span = findEntryElementSpan(out, target);
        if (span)
            out = out.slice(0, span.offset) + out.slice(span.offset + span.length);
    }
    return out;
}
//# sourceMappingURL=xmlStructuralEdit.js.map