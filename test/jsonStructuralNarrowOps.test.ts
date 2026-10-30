// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/jsonStructuralNarrow.test.ts at c73da3c (the cases C2
// deferred): a structural edit of a JSON .sldd — delete an entry, add or delete a nested child,
// paste, move — and its undo and redo, applied as entry ops, narrow === wide; and entryOps'
// findEntryBySelector and findEntryByName. What changed in setup:
//   - the model is a core session's read of the document text (createSession + ingest) where vscode
//     used view's registered SlddModel and the global DataModel; a wide repaint re-reads the text
//     into a fresh session and makes that the live one, as vscode's getModel re-registers the tree;
//   - entryOps' applyEntryOps, mutateEntry and opsOfPastedEntries are given that session, and
//     deleteEntry the section header's row-id spelling (view's buildSectionRowId), as core takes them;
//   - "narrow === wide" compares core's rows (test/tools/entryRows.ts: each node's toRow(), and the
//     entry's Last Modified columns) of the live model after the ops against those of the re-read,
//     where vscode spliced view's rows over the run on screen (spliceEntryRows / insertEntryRows,
//     the webview's half). The Status ("Modified") marks are vscode's slddBaseline and are not
//     ported: they are no model fact.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession, entrySelectorOf, minimalReplacement, planDeletion } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import {
  applyEntryOps,
  findEntryByName,
  findEntryBySelector,
  insertOp,
  mutateEntry,
  opsOfPastedEntries,
  patchOfPairs,
  removeOp,
  replaceOp,
  type AppliedOp,
  type EntryOpPair,
} from '../src/edit/entryOps.js';
import { planKnownOps, type KnownEdit, type RangeReplacement } from '../src/edit/jsonEntrySync.js';
import {
  addChild,
  applyTextPatch,
  deleteChild,
  deleteChildren,
  deleteEntriesByName,
  deleteEntry,
  pasteEntries,
  pasteEntry,
  type TextPatch,
} from '../src/edit/structuralEdit.js';
import { rowsOf } from './tools/entryRows.js';

type Any = any;

const FIXTURE = 'numeric_json.sldd';
// vscode's test/fixtures/numeric_json.sldd, byte for byte.
const text = readFileSync('test/fixtures/numeric_json.sldd', 'utf8');
// What view's buildSectionRowId spells, which the caller passes deleteEntry.
const sectionRowId = (name: string): string => `section:${name}`;

/** One open document, with the narrow path and the wide re-read side by side. */
function open() {
  const doc = { text };
  let session: Any;
  let live: Any;
  const build = () => {
    session = createSession();
    live = ingest(session, new TextEncoder().encode(doc.text).buffer as ArrayBuffer, { filename: FIXTURE });
    return live;
  };
  build();
  // The wide repaint: re-read the whole text, rebuild every row; the re-read is now the live tree.
  const widePaint = () => rowsOf(build());
  // What the table holds after the narrow path: the live model's rows.
  const narrow = () => rowsOf(live);
  const model = () => live;
  const write = (patch: TextPatch | undefined) => {
    expect(patch, 'the transform named the region it changed').toBeTruthy();
    doc.text = applyTextPatch(doc.text, patch!);
  };
  const entryNamed = (name: string) => (live.children as Any[]).flatMap((s: Any) => s.children).find((e: Any) => e.name === name);
  return { doc, widePaint, narrow, model, write, entryNamed, session: () => session };
}

const submittedOf = (patch: TextPatch): RangeReplacement => ({ rangeOffset: patch.offset, rangeLength: patch.length, text: patch.text });
const rememberOf = (before: string, patch: TextPatch, pairs: EntryOpPair[]): KnownEdit => ({
  submitted: submittedOf(patch),
  replaced: before.slice(patch.offset, patch.offset + patch.length),
  patch: patchOfPairs(pairs),
});
const undoOf = (known: KnownEdit): RangeReplacement => ({
  rangeOffset: known.submitted.rangeOffset,
  rangeLength: known.submitted.text.length,
  text: known.replaced,
});
const redoOf = (known: KnownEdit): RangeReplacement => ({ ...known.submitted });
const applyChange = (doc: { text: string }, change: RangeReplacement) => {
  doc.text = applyTextPatch(doc.text, { offset: change.rangeOffset, length: change.rangeLength, text: change.text });
};

describe('JSON .sldd structural edit — narrow === wide', () => {
  it('delete: the entry’s run leaves the table and no other row moves', () => {
    const d = open();
    const before = d.widePaint();
    const entry = d.entryNamed('Number');
    const entryRowId = entry.id;
    const pairs: EntryOpPair[] = [{ redo: removeOp(entryRowId), undo: insertOp(entry) }];
    const result = deleteEntry(d.doc.text, entry, sectionRowId);
    applyEntryOps(d.model(), [removeOp(entryRowId)], d.session());
    d.write(result.patch);

    const narrow = d.narrow();
    expect(narrow.some((r: Any) => r.ID === entryRowId), 'the deleted run is gone').toBe(false);
    expect(narrow.length).toBe(before.length - 1);
    expect(d.session().findNodeById(entryRowId)).toBeNull();
    expect(pairs).toHaveLength(1);
    expect(narrow).toEqual(d.widePaint());
  });

  it('add child: only the owning entry’s rows are rebuilt, and the new child resolves', () => {
    const d = open();
    const before = d.widePaint();
    const entry = d.entryNamed('Struct');
    const entryRowId = entry.id;
    const result = mutateEntry(entry, () => addChild(d.doc.text, entry), d.session());
    d.write(result.patch);

    const narrow = d.narrow();
    expect(result.selectId, 'the new child is the row to select').toBeTruthy();
    expect(narrow.some((r: Any) => r.ID === result.selectId), 'its row is on screen').toBe(true);
    expect(d.session().findNodeById(result.selectId!), 'and it resolves for the next edit').toBeTruthy();
    const others = (rows: Any[]) => rows.filter((r) => !String(r.ID).startsWith(entryRowId));
    expect(others(narrow)).toEqual(others(before));
    expect(narrow).toEqual(d.widePaint());
  });

  it('delete child: the owning entry’s rows, one row shorter', () => {
    const d = open();
    d.widePaint();
    const entry = d.entryNamed('Struct');
    const child = entry.children[0];
    expect(child, 'the fixture’s Struct has a field to delete').toBeTruthy();
    const childId = child.id;
    const result = mutateEntry(entry, () => deleteChild(d.doc.text, child), d.session());
    d.write(result.patch);

    const narrow = d.narrow();
    expect(narrow.some((r: Any) => r.ID === childId), 'the deleted field’s row is gone').toBe(false);
    expect(d.session().findNodeById(childId), 'and its id no longer resolves').toBeNull();
    expect(narrow).toEqual(d.widePaint());
  });

  it('delete of MANY rows: one write, and narrow === wide', () => {
    const d = open();
    d.widePaint();
    const struct = d.entryNamed('Struct');
    const number = d.entryNamed('Number');
    const child = struct.children[0];
    expect(child, 'the fixture’s Struct has a field').toBeTruthy();
    const goneIds = [number.id, child.id];

    const plan = planDeletion([number.id, child.id], (id: string) => d.session().findNodeById(id));
    expect(plan.entries.map((e: Any) => e.name)).toEqual(['Number']);
    expect(plan.childGroups.map((g: Any) => g.entry.name)).toEqual(['Struct']);

    const selectors = plan.entries.map((e: Any) => entrySelectorOf(e));
    const textBefore = d.doc.text;
    const pairs: EntryOpPair[] = plan.entries.map((e: Any) => ({ redo: removeOp(e.id), undo: insertOp(e) }));

    let working = textBefore;
    for (const group of plan.childGroups) {
      working = mutateEntry(group.entry, () => deleteChildren(working, group.children), d.session()).newText;
    }
    working = deleteEntriesByName(working, selectors);
    applyEntryOps(d.model(), pairs.map((p) => p.redo), d.session());
    d.write(minimalReplacement(textBefore, working));

    const narrow = d.narrow();
    for (const id of goneIds) {
      expect(narrow.some((r: Any) => r.ID === id), `${id} is gone from the table`).toBe(false);
    }
    expect(narrow).toEqual(d.widePaint());
  });

  it('paste: the new entry’s rows are inserted where a re-parse would put them', () => {
    const d = open();
    const before = d.widePaint();
    const section = d.model().children[0];
    const payload = d.entryNamed('Number').serialize();
    const addedFrom = section.children.length;
    const pasted = pasteEntry(d.doc.text, section, payload);
    const { pairs, applied } = opsOfPastedEntries(section, addedFrom, d.session());
    d.write(pasted.patch);

    expect(applied).toHaveLength(1);
    expect(pairs).toHaveLength(1);
    const fresh = (applied[0] as Any).entry;
    expect(fresh.name, 'the copy is renamed within the namespace').toBe('Number1');
    expect(d.session().findNodeById(fresh.id), 'the pasted entry is indexed').toBe(fresh);

    const narrow = d.narrow();
    expect(narrow.length).toBe(before.length + 1);
    expect(narrow).toEqual(d.widePaint());
  });

  it('a same-document move: the source’s rows leave, the copy’s arrive under its own name', () => {
    const d = open();
    const before = d.widePaint();
    const section = d.model().children[0];
    const source = d.entryNamed('PI');
    const payload = source.serialize();
    const selector = entrySelectorOf(payload);

    const trimmed = deleteEntriesByName(d.doc.text, [selector]);
    const applied: AppliedOp[] = applyEntryOps(d.model(), [removeOp(source.id)], d.session());
    const addedFrom = section.children.length;
    const pasted = pasteEntry(trimmed, section, payload);
    const added = opsOfPastedEntries(section, addedFrom, d.session());
    applied.push(...added.applied);
    d.doc.text = pasted.newText;

    expect((added.applied[0] as Any).entry.name, 'the copy keeps the moved name').toBe('PI');
    const narrow = d.narrow();
    expect(narrow.length).toBe(before.length);
    expect(narrow).toEqual(d.widePaint());
  });

  it('a TWO-source move: both sources leave, both copies arrive, and undo puts them back', () => {
    const d = open();
    const before = d.widePaint();
    const textBefore = d.doc.text;
    const section = d.model().children[0];

    const sources = ['PI', 'Number'].map((n) => d.entryNamed(n));
    const payloads = sources.map((s: Any) => s.serialize());
    const selectors = payloads.map((p: Any) => entrySelectorOf(p));

    const trimmed = deleteEntriesByName(d.doc.text, selectors);
    const pairs: EntryOpPair[] = [];
    for (const source of sources) {
      const pair: EntryOpPair = { redo: removeOp(source.id), undo: insertOp(source) };
      pairs.push(pair);
      applyEntryOps(d.model(), [pair.redo], d.session());
    }
    const addedFrom = section.children.length;
    const pasted = pasteEntries(trimmed, section, payloads);
    const added = opsOfPastedEntries(section, addedFrom, d.session());
    pairs.push(...added.pairs);
    d.doc.text = pasted.newText;

    expect(added.applied.map((op: Any) => op.entry.name), 'both copies keep their names').toEqual(['PI', 'Number']);
    const moved = d.narrow();
    expect(moved.length).toBe(before.length);
    expect(moved, 'the narrow paint of a two-source move').toEqual(d.widePaint());

    // Cmd+Z: the text comes back as it was, and the REVERSED inverses replay over the model (as in
    // vscode, the tree the wide repaint above re-read).
    d.doc.text = textBefore;
    applyEntryOps(d.model(), patchOfPairs(pairs).undo, d.session());
    expect(d.narrow(), 'undo of a two-source move').toEqual(d.widePaint());
  });
});

describe('JSON .sldd structural edit — undo and redo, from the ops the host kept', () => {
  it('undo of a delete puts the entry back where it was — narrow === wide', () => {
    const d = open();
    const before = d.widePaint();
    const entry = d.entryNamed('Number');
    const entryRowId = entry.id;
    const textBefore = d.doc.text;
    const pairs: EntryOpPair[] = [{ redo: removeOp(entryRowId), undo: insertOp(entry) }];
    const result = deleteEntry(textBefore, entry, sectionRowId);
    applyEntryOps(d.model(), [removeOp(entryRowId)], d.session());
    d.write(result.patch);
    const known = rememberOf(textBefore, result.patch!, pairs);

    const change = undoOf(known);
    applyChange(d.doc, change);
    const ops = planKnownOps([change], [known]);
    expect(ops, 'the host recognises its own delete coming back').not.toBeNull();
    applyEntryOps(d.model(), ops!, d.session());

    const narrow = d.narrow();
    expect(narrow, 'the table is what it was before the delete').toEqual(before);
    expect(d.session().findNodeById(entryRowId), 'and the restored id resolves again').toBeTruthy();
    expect(narrow).toEqual(d.widePaint());
  });

  it('redo of a delete takes the entry away again — narrow === wide', () => {
    const d = open();
    d.widePaint();
    const entry = d.entryNamed('Number');
    const entryRowId = entry.id;
    const textBefore = d.doc.text;
    const pairs: EntryOpPair[] = [{ redo: removeOp(entryRowId), undo: insertOp(entry) }];
    const result = deleteEntry(textBefore, entry, sectionRowId);
    applyEntryOps(d.model(), [removeOp(entryRowId)], d.session());
    d.write(result.patch);
    const deleted = d.narrow();
    const known = rememberOf(textBefore, result.patch!, pairs);

    const undo = undoOf(known);
    applyChange(d.doc, undo);
    applyEntryOps(d.model(), planKnownOps([undo], [known])!, d.session());
    const redo = redoOf(known);
    applyChange(d.doc, redo);
    const ops = planKnownOps([redo], [known]);
    expect(ops, 'the redo is the same edit forwards').not.toBeNull();
    applyEntryOps(d.model(), ops!, d.session());

    const narrow = d.narrow();
    expect(narrow).toEqual(deleted);
    expect(narrow).toEqual(d.widePaint());
  });

  it('undo of a many-row delete restores every row in one step', () => {
    const d = open();
    const before = d.widePaint();
    const a = d.entryNamed('Number');
    const b = d.entryNamed('Struct');
    const textBefore = d.doc.text;
    const pairs: EntryOpPair[] = [
      { redo: removeOp(b.id), undo: insertOp(b) },
      { redo: removeOp(a.id), undo: insertOp(a) },
    ];
    const working = deleteEntriesByName(textBefore, [entrySelectorOf(a), entrySelectorOf(b)]);
    applyEntryOps(d.model(), pairs.map((p) => p.redo), d.session());
    const patch = minimalReplacement(textBefore, working);
    d.write(patch);
    const known = rememberOf(textBefore, patch, pairs);

    const change = undoOf(known);
    applyChange(d.doc, change);
    const ops = planKnownOps([change], [known]);
    expect(ops, 'the host recognises its own multi-row delete coming back').not.toBeNull();
    applyEntryOps(d.model(), ops!, d.session());

    const narrow = d.narrow();
    expect(narrow, 'the table is what it was before the delete').toEqual(before);
    expect(narrow).toEqual(d.widePaint());
  });

  it('undo of a MIXED many-row delete brings the nested child back too', () => {
    const d = open();
    const before = d.widePaint();
    const struct = d.entryNamed('Struct');
    const number = d.entryNamed('Number');
    const child = struct.children[0];
    const childId = child.id;
    const textBefore = d.doc.text;

    const pairs: EntryOpPair[] = [{ redo: removeOp(number.id), undo: insertOp(number) }];
    const childUndo = replaceOp(struct, struct.id);
    let working = mutateEntry(struct, () => deleteChildren(textBefore, [child]), d.session()).newText;
    pairs.push({ redo: replaceOp(struct, struct.id), undo: childUndo });
    working = deleteEntriesByName(working, [entrySelectorOf(number)]);
    applyEntryOps(d.model(), [pairs[0].redo], d.session());
    const patch = minimalReplacement(textBefore, working);
    d.write(patch);
    expect(d.narrow().some((r: Any) => r.ID === childId), 'the field is gone').toBe(false);
    const known = rememberOf(textBefore, patch, pairs);

    const change = undoOf(known);
    applyChange(d.doc, change);
    expect(d.doc.text, 'the undo restores the text exactly').toBe(textBefore);
    const ops = planKnownOps([change], [known]);
    expect(ops, 'the host recognises its own mixed delete coming back').not.toBeNull();
    applyEntryOps(d.model(), ops!, d.session());

    const narrow = d.narrow();
    expect(narrow, 'the table is what it was before the delete').toEqual(before);
    expect(d.session().findNodeById(childId), 'and the field resolves for the next edit').toBeTruthy();
    expect(narrow).toEqual(d.widePaint());
  });

  it('undo of a paste takes the pasted entry away — narrow === wide', () => {
    const d = open();
    const before = d.widePaint();
    const section = d.model().children[0];
    const payload = d.entryNamed('Number').serialize();
    const textBefore = d.doc.text;
    const addedFrom = section.children.length;
    const pasted = pasteEntry(textBefore, section, payload);
    const { pairs } = opsOfPastedEntries(section, addedFrom, d.session());
    d.write(pasted.patch);
    const known = rememberOf(textBefore, pasted.patch!, pairs);

    const change = undoOf(known);
    applyChange(d.doc, change);
    const ops = planKnownOps([change], [known]);
    expect(ops, 'the host recognises its own paste coming back').not.toBeNull();
    applyEntryOps(d.model(), ops!, d.session());

    const narrow = d.narrow();
    expect(narrow).toEqual(before);
    expect(narrow).toEqual(d.widePaint());
  });

  it('undo of a MOVE undoes its two halves in reverse — narrow === wide', () => {
    const d = open();
    const before = d.widePaint();
    const section = d.model().children[0];
    const source = d.entryNamed('PI');
    const payload = source.serialize();
    const textBefore = d.doc.text;
    const pairs: EntryOpPair[] = [{ redo: removeOp(source.id), undo: insertOp(source) }];
    applyEntryOps(d.model(), [removeOp(source.id)], d.session());
    const addedFrom = section.children.length;
    const pasted = pasteEntry(deleteEntriesByName(textBefore, [entrySelectorOf(payload)]), section, payload);
    const added = opsOfPastedEntries(section, addedFrom, d.session());
    pairs.push(...added.pairs);
    d.doc.text = pasted.newText;

    const known = rememberOf(textBefore, minimalReplacement(textBefore, d.doc.text), pairs);
    const change = undoOf(known);
    applyChange(d.doc, change);
    expect(d.doc.text, 'the undo restores the text exactly').toBe(textBefore);
    const ops = planKnownOps([change], [known]);
    expect(ops, 'the host recognises the move coming back').not.toBeNull();
    applyEntryOps(d.model(), ops!, d.session());

    const narrow = d.narrow();
    expect(narrow).toEqual(before);
    expect(narrow).toEqual(d.widePaint());
  });
});

describe('findEntryBySelector', () => {
  const model = (...names: Array<[string, string]>) => ({
    children: [{ children: names.map(([name, uuid]) => ({ name, metadata: { uuid } })) }],
  });

  it('names the one entry that answers to a name', () => {
    const m = model(['A', '1'], ['B', '2']);
    expect(findEntryBySelector(m, 'B')).toBe(m.children[0].children[1]);
    expect(findEntryBySelector(m, { name: 'A', uuid: '1' })).toBe(m.children[0].children[0]);
  });

  it('consults the uuid only when the name is ambiguous', () => {
    const m = model(['A', '1'], ['A', '2']);
    expect(findEntryBySelector(m, { name: 'A', uuid: '2' })).toBe(m.children[0].children[1]);
    expect(findEntryBySelector(m, 'A')).toBeNull();
  });

  it('answers nothing for a name the model does not hold', () => {
    expect(findEntryBySelector(model(['A', '1']), 'Z')).toBeNull();
  });
});

describe('findEntryByName', () => {
  const model = {
    children: [
      { name: 'design', children: [{ name: 'A' }, { name: 'B' }] },
      { name: 'coder', children: [{ name: 'A' }] },
    ],
  };

  it('scopes the name to its own section, because entry names are unique per section only', () => {
    expect(findEntryByName(model, 'design', 'A')).toBe(model.children[0].children[0]);
    expect(findEntryByName(model, 'coder', 'A')).toBe(model.children[1].children[0]);
    expect(findEntryByName(model, 'design', 'B')).toBe(model.children[0].children[1]);
  });

  it('answers nothing for a name, or a section, the model does not hold', () => {
    expect(findEntryByName(model, 'design', 'Z')).toBeNull();
    expect(findEntryByName(model, 'nope', 'A')).toBeNull();
    expect(findEntryByName(undefined, 'design', 'A')).toBeNull();
  });
});
