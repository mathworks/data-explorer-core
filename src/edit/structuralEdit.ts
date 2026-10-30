// Copyright 2026 The MathWorks, Inc.
//
// Copied from data-explorer-vscode src/host/structuralEdit.ts at c73da3c, which keeps its own until it
// adopts this (view-split step 6b): its text half, the transforms below. Its paste rules are core's
// dictionaryPaste.ts (step 6a C1), which this imports; its clipboard and drag snapshots and its
// row-id resolution of a paste's target stay with the host, as they speak in the table's rows.
// Otherwise only the imports differ, and a section header's row id is spelled here (see below).
//
// Pure (VS-Code-free) text transforms for STRUCTURAL edits — delete, add-child,
// and paste — that keep untouched entries byte-identical. Each takes already-
// resolved model nodes (the host locates them via findNode) plus the current
// document text, and returns the new text and the row id to re-select.
//
// Two shapes of edit:
//  - Whole-entry array changes (delete a top-level entry, paste a new one) →
//    splice the `entries` array element via entrySplice helpers.
//  - Within-entry changes (delete a nested child, add a child) → mutate the
//    model, reserialize JUST the owning entry, and replace its span — the exact
//    byte-scoped pattern applyEdit uses for value edits, so siblings are
//    untouched for free.

import {
  findEntrySpan,
  findEntryElementSpan,
  findEntriesArrayInsertion,
  detectIndent,
  indentBefore,
} from './entrySplice.js';
import { applyTextPatch, type TextPatch } from './textPatch.js';
import { entrySelectorOf, type EntrySelector } from '../datamodel/parser/entrySelector.js';
import { owningEntryOf } from '../datamodel/node/DataNode.js';
import { textDictionaryJson } from '../datamodel/parser/TextDictionaryJson.js';
import { foldPasteEntries, prepareEntryForPaste, refuseUnwrittenNumber, type StructuralResult } from './dictionaryPaste.js';

// A section header's row id, as data-explorer-view spells it (src/model/ids/sectionRowId.ts,
// buildSectionRowId): where a delete of a section's last entry puts the selection. Spelled here
// because core imports nothing of view, which is downstream of it.
const buildSectionRowId = (name: string): string => `section:${name}`;

// One byte-scoped replacement of a document's text, and the one applier — both now core's
// (`src/edit/textPatch.ts`), because WHICH REGION a text edit covers is a property of the two
// strings and not of anything that renders them. Re-exported from here rather than imported at
// each use site: this is where the transforms below report a patch from, so it is where every
// other file in the host already names the type, and a re-export keeps all of them reading the
// same specifier they always did.
export type { TextPatch, StructuralResult };
export { applyTextPatch };

/**
 * The result of a one-region edit, with `newText` DERIVED from the patch.
 *
 * Which is the whole reason it is a function: a patch that disagreed with the text beside it
 * would write a document neither the model nor the user asked for, and the only way two
 * accounts of one edit cannot drift is for there to be one account. Every transform below
 * that changes a single region goes through here.
 */
function patchResult(text: string, patch: TextPatch, selectId: string | null): StructuralResult {
  return { newText: applyTextPatch(text, patch), selectId, patch };
}

// Walk up from any node to its owning top-level entry (the node where
// `isEntry` is true), or null if there is none. Section rows and detached
// nodes have no owning entry.
//
// The walk itself is core's now (`owningEntryOf`, beside the `isEntry` it reads): both
// members belong to core's node classes, so "which entry does this row belong to" is a
// question about the MODEL, and this file's named copy of it was the second of two
// spellings — core walked the same chain inline inside DataNode._markModified.
//
// Kept as a name here, and kept `any` in and `any` out, because ~15 call sites in this
// host read the result as a live node and pass it straight to another `any` seam. Typing
// this at core's node class would push a cast onto every one of them to say nothing new.
export function findOwningEntry(node: any): any {
  return owningEntryOf(node);
}

/**
 * A dictionary's section by core's own key (`design`, `arch`, `config`, `other`), or null.
 *
 * One spelling, because two callers now ask the same question for different reasons: a paste
 * into an empty section, which has only its header row to aim at, and the Add gallery, whose
 * tiles name their destination outright and so never had a row to resolve from. A section is
 * a direct child of the dictionary node, so this is a lookup and not a walk.
 */
export function sectionByName(model: any, sectionName: string): any {
  return ((model?.children ?? []) as any[]).find((s) => s.name === sectionName) ?? null;
}

// Reserialize one entry to text, lined up behind the element's own `{`, the same way
// applyEdit does. The first line stays un-indented (the splice target begins mid-line at
// that `{`); continuation lines get `elementIndent`.
//
// `elementIndent` is read from the text by the callers rather than assumed here. It used to
// be `indent.repeat(5)` — true of every dictionary MATLAB writes, since `entries` sits five
// levels down in all of them, but it made the element's first line and its remaining lines
// two separate accounts of one depth, and only one of them was derived from the file.
export function reserializeEntry(entry: any, indent: string, elementIndent = indent.repeat(5)): string {
  return recordText(entry.serialize(), indent, elementIndent);
}

// The text of one serialized record, laid out as reserializeEntry lays out an entry's: the one
// place this editor writes an entry's text (a cell edit, an Add or Delete in it, a paste, an Add).
// Its numbers are spelled as MATLAB spells them in a text dictionary, by core's own writer, which
// its save uses too (textDictionaryJson): JSON.stringify wrote a double of 2^64 - 1 or -2^63 as an
// integer literal past what a 64-bit integer holds, and MATLAB could not open the dictionary.
function recordText(record: unknown, indent: string, elementIndent: string): string {
  const lines = textDictionaryJson(record, indent).split('\n');
  return lines.map((line, i) => (i === 0 ? line : elementIndent + line)).join('\n');
}

// Replace the owning entry's text in-place with its reserialized form — the
// within-entry edit shape described at the top of this file. Both callers below
// had this same four-step body (detect indent, reserialize, find span, splice),
// and its XML counterpart is xmlStructuralEdit.spliceEntry, which the two XML
// callers already share.
function spliceEntry(text: string, entry: any, selectId: string | null): StructuralResult {
  const span = findEntrySpan(text, entrySelectorOf(entry));
  if (!span) throw new Error(`Could not locate entry "${entry.name}" text.`);
  const entryText = reserializeEntry(entry, detectIndent(text), indentBefore(text, span.offset));
  return patchResult(text, { offset: span.offset, length: span.length, text: entryText }, selectId);
}

// The row id to select after removing `node` from `siblings`: the previous
// sibling if any, else the next, else the fallback (parent/section) id. Shared
// with the XML path, so a delete leaves the selection in the same place whichever
// .sldd format the row came from.
export function reselectAfterRemoval(siblings: any[], node: any, fallbackId: string): string {
  const idx = siblings.indexOf(node);
  if (idx > 0) return siblings[idx - 1].id;
  if (idx >= 0 && idx < siblings.length - 1) return siblings[idx + 1].id;
  return fallbackId;
}

/** Delete a top-level entry by removing its element (and one comma) from the array. */
export function deleteEntry(text: string, entry: any): StructuralResult {
  const section = entry.parent;
  const siblings = (section?.children ?? []) as any[];
  const selectId = reselectAfterRemoval(siblings, entry, buildSectionRowId(section?.name ?? ''));
  // By selector, not name: the node the user right-clicked is a specific entry,
  // and another section's namespace may hold a different entry with the same
  // name. See core's entrySelector.ts.
  const span = findEntryElementSpan(text, entrySelectorOf(entry));
  if (!span) throw new Error(`Could not locate entry "${entry.name}" to delete.`);
  return patchResult(text, { offset: span.offset, length: span.length, text: '' }, selectId);
}

// Whether a node may be removed from its parent: a child of a container (Bus/Struct/
// Enum), never a top-level entry (a SECTION has no canRemoveChild) and never a detached
// node. One predicate because removeChildrenFromModel has to answer it for a whole group
// BEFORE it removes any of them, and a second copy of the condition is how the group
// check and the single check would come to disagree.
function removableChild(node: any): boolean {
  const parent = node?.parent;
  return !!parent && typeof parent.canRemoveChild === 'function' && parent.canRemoveChild();
}

/**
 * Remove a nested child from the in-memory model, reporting the entry whose text
 * has to be reserialized and where the selection should land. This is the part of
 * a nested delete that decides what the edit MEANS — which nodes may be removed,
 * which entry owns the row, where the selection goes — so both .sldd formats
 * share it and only the splicing differs (see the header of xmlStructuralEdit.ts).
 */
export function removeChildFromModel(node: any): { entry: any; selectId: string } {
  const parent = node.parent;
  if (!removableChild(node)) throw new Error('This item cannot be deleted.');
  // PRECONDITION (untested): the canRemoveChild guard above already restricts
  // `node` to a child of a container (Bus/Struct/Enum), and every container in a
  // parsed model sits under a top-level entry — a SECTION has no canRemoveChild,
  // so a section child can never reach here. Kept for a detached node.
  const entry = findOwningEntry(node);
  if (!entry) throw new Error('Could not locate the owning entry.');

  const selectId = reselectAfterRemoval(parent.children ?? [], node, parent.id);
  parent.removeChildNode(node);
  return { entry, selectId };
}

/**
 * Add a child to a container node in the in-memory model, reporting the owning
 * entry and the new child's id (which the caller selects). Shared by both .sldd
 * formats, for the same reason as removeChildFromModel.
 */
export function addChildToModel(node: any): { entry: any; selectId: string } {
  if (typeof node.canAddChild !== 'function' || !node.canAddChild()) {
    throw new Error('This item cannot have children added.');
  }
  // PRECONDITION (untested): as in removeChildFromModel, every container node in
  // a parsed model has an owning entry — a SECTION's canAddChild() returns false,
  // so the guard above already excludes the only node kind with no entry above it.
  const entry = findOwningEntry(node);
  if (!entry) throw new Error('Could not locate the owning entry.');

  // PRECONDITION (untested): every node type whose canAddChild() returns true
  // (Bus, ConnectionBus, ServiceBus, Struct, EnumType) builds and returns a child
  // unconditionally, so the guard above already excludes every node that could
  // yield null here. Kept as a belt-and-braces net for a future container type.
  const child = node.addChildNode();
  if (!child) throw new Error('Failed to add a child element.');
  return { entry, selectId: child.id };
}

/** Delete a nested child: remove it from its parent, reserialize the owning entry. */
export function deleteChild(text: string, node: any): StructuralResult {
  const { entry, selectId } = removeChildFromModel(node);
  return spliceEntry(text, entry, selectId);
}

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
export function removeChildrenFromModel(nodes: readonly any[]): { entry: any; selectId: string } {
  if (!nodes.length) throw new Error('Nothing to delete.');
  const entry = findOwningEntry(nodes[0]);
  if (!entry) throw new Error('Could not locate the owning entry.');
  for (const node of nodes) {
    if (findOwningEntry(node) !== entry) {
      throw new Error('These items are not all in the same entry.');
    }
    if (!removableChild(node)) throw new Error('This item cannot be deleted.');
  }
  // Removals first, one splice after: the text must be rewritten from the entry as it
  // ends up, not once per child.
  const selectIds: string[] = [];
  for (const node of nodes) {
    selectIds.push(removeChildFromModel(node).selectId);
  }
  // reselectAfterRemoval answers per removal, so a later answer can name a sibling an
  // earlier removal already took away. Checked against the tree rather than the node
  // index, because that index is mid-mutation here — mutateEntry re-keys the subtree only
  // after this returns, so findNodeById would still resolve a node that has left.
  const live = subtreeIds(entry);
  const survivor = selectIds.filter((id) => live.has(id)).pop();
  return { entry, selectId: survivor ?? entry.id };
}

// Every id in a subtree as it stands now. An id is a name-path, so a removal does not
// change what its surviving siblings answer to — which is what makes this comparable
// against ids captured before it.
function subtreeIds(node: any, out = new Set<string>()): Set<string> {
  out.add(node.id);
  for (const child of (node.children ?? []) as any[]) subtreeIds(child, out);
  return out;
}

/** Delete several nested children of one entry, reserializing that entry once. */
export function deleteChildren(text: string, nodes: readonly any[]): StructuralResult {
  const { entry, selectId } = removeChildrenFromModel(nodes);
  return spliceEntry(text, entry, selectId);
}

/** Add a child to a container node (struct/bus/enum), reserialize its owning entry. */
export function addChild(text: string, node: any): StructuralResult {
  const { entry, selectId } = addChildToModel(node);
  return spliceEntry(text, entry, selectId);
}

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
export function createEntry(section: any, className: string): any {
  const node = section.addEntry(className);
  if (!node) {
    // Reached when the section refuses the class. Worth a real message rather than a
    // silent no-op: the gallery only offers legal tiles (its guard test creates every
    // one), so a refusal here means the catalog and core have gone out of step.
    throw new Error(`${className} cannot be added to ${section.displayName || section.name}.`);
  }
  return node;
}

/**
 * Splice a freshly-created or freshly-pasted entry into the `entries` array.
 *
 * Shared by the paste and the add below so there is ONE answer to where a new entry goes in
 * a JSON dictionary. Two answers is the bug this repo has shipped before: the narrow insert
 * and the wide re-parse disagreeing about an entry's position, so the row order changed
 * under the user on the next full repaint.
 */
function insertNewEntry(text: string, newNode: any): StructuralResult {
  const insertion = findEntriesArrayInsertion(text);
  if (!insertion) throw new Error('Could not locate the entries array.');
  // Core spells what JSON has no number for (an Inf, a NaN copied out of a binary dictionary
  // or a MAT-file) as a text dictionary does, `{"_type": "double", "_value": "Inf"}`, as it
  // takes the entry in (parseEntry); a record it handed back as it was is refused rather than
  // written with a null (refuseUnwrittenNumber).
  const record = newNode.serialize();
  refuseUnwrittenNumber(newNode, record);
  const entryText = recordText(record, detectIndent(text), insertion.elementIndent);

  // The line break is unconditional: an element always starts its own line, whether it
  // follows a sibling or opens an empty array. Omitting it in the empty case left the first
  // element sitting on the `[` line, which is not what MATLAB writes AND made the next
  // insert read `"entries": [` as that element's indentation.
  const prefix = (insertion.needsLeadingComma ? ',' : '') + '\n' + insertion.elementIndent;
  const inserted = prefix + entryText + insertion.trailingBreak;
  return patchResult(text, { offset: insertion.offset, length: 0, text: inserted }, newNode.id);
}

/**
 * Paste a serialized entry as a NEW top-level entry in `section`, inserting the
 * element into the entries array and preserving sibling bytes. See
 * prepareEntryForPaste for every rule about what the pasted entry becomes.
 */
export function pasteEntry(
  text: string,
  section: any,
  payload: Record<string, unknown>,
): StructuralResult {
  return insertNewEntry(text, prepareEntryForPaste(section, payload));
}

/** Add a new default entry of `className` to `section`. See createEntry. */
export function addNewEntry(text: string, section: any, className: string): StructuralResult {
  return insertNewEntry(text, createEntry(section, className));
}

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
export function deleteEntriesByName(text: string, targets: (string | EntrySelector)[]): string {
  let out = text;
  for (const target of targets) {
    const span = findEntryElementSpan(out, target);
    if (span) out = out.slice(0, span.offset) + out.slice(span.offset + span.length);
  }
  return out;
}

/** Multi-paste for a JSON .sldd. See foldPasteEntries. */
export function pasteEntries(
  text: string,
  section: any,
  payloads: Record<string, unknown>[],
): { newText: string; selectIds: string[]; patch?: TextPatch } {
  return foldPasteEntries(text, section, payloads, pasteEntry);
}
