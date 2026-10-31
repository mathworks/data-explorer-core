// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/binaryEntryScopedEdit.test.ts at c73da3c: the global
// DataModel is a core session the document is registered in (and that every entryOps call is given);
// deleteEntryXml is given view's section row-id spelling. vscode compared the ROWS view builds
// (buildRows / buildEntryRows / spliceEntryRows / insertEntryRows, with slddBaseline's Modified
// marks); core has no row builder, so "narrow === wide" is held of a MODEL SNAPSHOT instead: per node
// its id, name, class, displayValue and child count, and each entry's serialize(), of the live tree
// the edit or the ops changed, against a re-parse of the chunk the edit wrote. A row still resolving
// is each node of the entry's subtree resolving by its id. The records are compared without the
// `_id` key a freshly added bus element's carries (a re-read has none). Dropped, as facts of view's rows and of
// vscode's slddBaseline: the whole "the Modified mark" describe (5 cases), and the per-op check that
// a fold of the rows on screen lands.
//
// The entry-scoped repaint for a compressed-binary .sldd: an edit paints ONE entry's
// rows from the model it just mutated, instead of re-parsing the whole dictionary and
// rebuilding every row. On a real customer file (75 MB of data/chunk0.xml, 31k entries)
// the old path spent ~7.5 s per keystroke-commit — two full parses of the same XML, one
// before the mutation and one to repaint — to express a one-cell change.
//
// Two invariants, and they are the whole point:
//
//  1. NARROW === WIDE. The entry's tree as the edit left it must be, node for node, what a full
//     re-parse would have produced. Anything the fast path gets wrong here is a table that
//     disagrees with the file until something else forces a full repaint.
//
//  2. The ids it paints must still RESOLVE. Skipping the re-parse means skipping the
//     re-registration that used to rebuild the session's node index — and a node id is a
//     path, so a rename rekeys the entry and everything under it. Get this wrong and the
//     edit looks fine; it is the NEXT edit on that row that fails with "could not locate
//     the edited item in the model".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { createSession, parseBinarySlddParts, spliceEntryObject, entrySelectorOf, planDeletion } from '../src/index.js';
import {
  addChildXml,
  deleteChildXml,
  deleteChildrenXml,
  deleteEntriesByNameXml,
  deleteEntryXml,
  pasteEntryXml,
} from '../src/edit/xmlStructuralEdit.js';
import {
  applyEntryOps,
  entryRecord,
  insertAnchorOf,
  insertOp,
  mutateEntry,
  patchOfPairs,
  removeOp,
  replaceOp,
  type AppliedOp,
  type EntryOp,
  type EntryOpPair,
} from '../src/edit/entryOps.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// What view's buildSectionRowId spells, which a host passes deleteEntryXml.
const sectionRowId = (name: string): string => `section:${name}`;

const bytes = readFileSync('test/parity/artifacts/binary/params.sldd');

function loadFixture() {
  const zip = unzipSync(new Uint8Array(bytes));
  const xml = new TextDecoder().decode(zip['data/chunk0.xml']);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;
  return { xml, meta };
}

// Every node of `model`, and every entry's record: what both repaint paths must agree on.
function snapshot(model: any): string[] {
  const out: string[] = [];
  const walk = (n: any): void => {
    out.push([n.id, n.name, n.className, String(n.displayValue ?? ''), (n.children ?? []).length].join(' | '));
    for (const c of n.children ?? []) walk(c);
  };
  for (const section of model.children) {
    walk(section);
    // Without `_id`: a bus element just added carries it in its record (`"_id": "1"`) and the
    // same element re-read does not; vscode's rows never showed it.
    for (const entry of section.children) out.push(`record ${entry.id} ${JSON.stringify(entry.serialize(), (k, v) => (k === '_id' ? undefined : v))}`);
  }
  return out;
}

// One open document, with the provider's two repaint paths side by side.
function openDoc(uri: string) {
  const session: any = createSession();
  const srcId = 'binedit:' + uri;
  const { xml, meta } = loadFixture();
  const doc = { chunkXml: xml };

  // buildModel(): re-parse chunkXml and re-register. What post() does, and what an
  // edit is no longer allowed to do.
  const build = () => {
    session.removeDataSource(srcId);
    return session.addDataSource(srcId, parseBinarySlddParts(doc.chunkXml, meta), { path: 'params.sldd' });
  };
  // liveModel(): the tree as it already stands.
  const live = () => session.getDataSource(srcId) ?? build();

  build();

  // post(): the wide repaint — re-parse, then every node of it.
  const widePaint = () => snapshot(build());
  // postEntry(): the narrow repaint — the tree as the edit left it, with no re-parse.
  const narrowPaint = () => snapshot(live());
  // The text half of an edit: core's splice of the owning entry's <Object>, addressed by
  // the selector the entry had BEFORE the mutation.
  const spliceEntryText = (entry: any, selector: ReturnType<typeof entrySelectorOf>) => {
    const after = spliceEntryObject(doc.chunkXml, entry, selector);
    expect(after, `the entry text for "${selector.name}" is locatable`).not.toBeNull();
    doc.chunkXml = after!;
  };

  const entryNamed = (name: string) =>
    (live() as any).children.flatMap((s: any) => s.children).find((e: any) => e.name === name);

  const dispose = () => {
    session.removeDataSource(srcId);
  };

  return { session, doc, build, live, widePaint, narrowPaint, spliceEntryText, entryNamed, dispose };
}

// Every node of the entry's subtree must be what the session finds by its id — the question
// the NEXT edit on that row asks.
function expectSubtreeResolves(session: any, entry: any): void {
  const walk = (n: any): void => {
    expect(session.findNodeById(n.id), `${n.id} resolves to its node`).toBe(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(entry);
}

describe('binary .sldd entry-scoped repaint — narrow paint equals wide paint', () => {
  it('a value edit: the live tree is identical to a full rebuild', () => {
    const d = openDoc('test://scoped-value.sldd');
    d.widePaint();
    const entry = d.entryNamed('scalarD');

    const applied = d.session.mutateSubtree(entry, () => entry.setProperty('Value', '42'));
    expect(applied).toBe(true);
    d.spliceEntryText(entry, entrySelectorOf(entry));

    const narrow = d.narrowPaint();
    expect(narrow).toEqual(d.widePaint());
    d.dispose();
  });

  it('a rename: the live tree is identical to a full rebuild, and the new ids resolve', () => {
    const d = openDoc('test://scoped-rename.sldd');
    d.widePaint();
    const entry = d.entryNamed('scalarD');
    // Snapshotted BEFORE the mutation, both of them: the selector addresses the text as
    // it is still written, the row id addresses the run as it is still displayed.
    const selector = entrySelectorOf(entry);
    const entryRowId = entry.id;

    d.session.mutateSubtree(entry, () => entry.setProperty('Name', 'scalarRenamed'));
    d.spliceEntryText(entry, selector);

    expect(entry.id).not.toBe(entryRowId);
    expectSubtreeResolves(d.session, entry);
    // And the id the table used to show this entry under is gone, so a stale row id
    // cannot route an edit at a node that has since moved.
    expect(d.session.findNodeById(entryRowId)).toBeNull();

    const narrow = d.narrowPaint();
    expect(narrow).toEqual(d.widePaint());
    d.dispose();
  });

  it('a rename of an entry WITH children rekeys the children too', () => {
    // The case a per-node index patch gets wrong: nothing touched the bus elements, but
    // their ids are paths through the entry that was renamed.
    const d = openDoc('test://scoped-rename-children.sldd');
    d.widePaint();
    const bus = d.entryNamed('MyBus');
    expect(bus.children.length).toBeGreaterThan(0);
    const selector = entrySelectorOf(bus);
    const childIdsBefore = bus.children.map((c: any) => c.id);

    d.session.mutateSubtree(bus, () => bus.setProperty('Name', 'MyRenamedBus'));
    d.spliceEntryText(bus, selector);

    // The entry's rows, as vscode's case counted them (restored ahead of vscode's V4): the entry
    // and each of its children, so that a rename that loses child rows fails.
    const narrow = d.narrowPaint();
    const entryRows = narrow.filter((line) => line.startsWith(bus.id + ' |') || line.startsWith(bus.id + '/'));
    expect(entryRows.length).toBe(1 + bus.children.length);
    expectSubtreeResolves(d.session, bus);
    for (const stale of childIdsBefore) {
      expect(d.session.findNodeById(stale)).toBeNull();
    }

    expect(narrow).toEqual(d.widePaint());
    d.dispose();
  });

  it('an edit on a nested child paints the whole entry subtree', () => {
    // The user's design: the update unit is the ENTRY, whatever depth the change was at,
    // so nothing has to track which rows inside an entry a change could have touched.
    const d = openDoc('test://scoped-child-value.sldd');
    d.widePaint();
    const struct = d.entryNamed('myStruct');
    const field = struct.children[0];

    d.session.mutateSubtree(struct, () => field.setProperty('Value', '7'));
    d.spliceEntryText(struct, entrySelectorOf(struct));

    expectSubtreeResolves(d.session, struct);
    const narrow = d.narrowPaint();
    expect(narrow.some((line) => line.startsWith(field.id + ' | '))).toBe(true);
    expect(narrow).toEqual(d.widePaint());
    d.dispose();
  });

  it('adding a child grows the entry run and the new row resolves', () => {
    const d = openDoc('test://scoped-add-child.sldd');
    d.widePaint();
    const bus = d.entryNamed('MyBus');
    const runBefore = bus.children.length;

    const { newText } = d.session.mutateSubtree(bus, () => addChildXml(d.doc.chunkXml, bus));
    d.doc.chunkXml = newText;

    expect(bus.children.length).toBe(runBefore + 1);
    // The child the user is about to be selected on, and may edit next.
    expectSubtreeResolves(d.session, bus);
    const narrow = d.narrowPaint();
    expect(narrow).toEqual(d.widePaint());
    d.dispose();
  });

  it('deleting a nested child shrinks the entry run and drops its id', () => {
    const d = openDoc('test://scoped-delete-child.sldd');
    d.widePaint();
    const bus = d.entryNamed('MyBus');
    const element = bus.children[0];
    const elementId = element.id;

    const { newText } = d.session.mutateSubtree(bus, () => deleteChildXml(d.doc.chunkXml, element));
    d.doc.chunkXml = newText;

    expect(bus.children).not.toContain(element);
    // Not merely absent from the rows: gone from the index, so a row id left over in
    // some other view cannot route an edit into a detached node.
    expect(d.session.findNodeById(elementId)).toBeNull();
    const narrow = d.narrowPaint();
    expect(narrow).toEqual(d.widePaint());
    d.dispose();
  });
});

// The other half of the same problem, and the one the user actually hit: an EDIT was fast
// but its UNDO took 5-9 s, because restoring the text was the whole edit and the repaint
// that followed re-parsed the dictionary to catch the model up. Undo, redo, delete, paste
// and drop now each state the entries they change as ops (entryOps.ts), applied to the live
// model.
//
// Same two invariants as above — NARROW === WIDE, and every painted row still RESOLVES —
// plus the two that only ops can get wrong: a redo must restore what its undo took away
// (not re-run the edit that produced it), and inverses must be replayed in reverse order.
//
// NOTE on ordering: `widePaint()` re-parses and RE-REGISTERS, which throws away the live
// tree these ops were built against. Every comparison against it therefore comes last in
// its step, and anything read from the model afterwards is re-fetched by name.
describe('binary .sldd entry ops — undo, redo, delete, paste', () => {
  it('undo and redo of a value edit are one replace op each', () => {
    const d = openDoc('test://ops-undo-value.sldd');
    d.widePaint();
    const entry = d.entryNamed('scalarD');
    const entryRowId = entry.id;
    const beforeXml = d.doc.chunkXml;
    const originalValue = entry.toRow().Value;

    // The edit, as applyEdit performs it: the pre-edit record is snapshotted first,
    // because this is the only moment that state exists.
    const undoOps: EntryOp[] = [{ kind: 'replace', rowId: entryRowId, record: entryRecord(entry) }];
    d.session.mutateSubtree(entry, () => entry.setProperty('Value', '42'));
    d.spliceEntryText(entry, entrySelectorOf(entry));
    const redoOps: EntryOp[] = [replaceOp(entry, entryRowId)];
    const afterXml = d.doc.chunkXml;
    const edited = d.narrowPaint();
    expect(edited).toEqual(d.widePaint());

    // Undo: restore the text, then replay the inverse against the live model — no parse.
    d.doc.chunkXml = beforeXml;
    applyEntryOps(d.live(), undoOps, d.session);
    expect(d.entryNamed('scalarD').toRow().Value).toBe(originalValue);
    const undone = d.narrowPaint();
    expect(undone).toEqual(d.widePaint());

    // Redo: the recorded post-edit state, addressed by the id undo just put back.
    d.doc.chunkXml = afterXml;
    applyEntryOps(d.live(), redoOps, d.session);
    expect(d.entryNamed('scalarD').toRow().Value).toBe('42');
    const redone = d.narrowPaint();
    expect(redone).toEqual(d.widePaint());
    d.dispose();
  });

  it('undo of a rename addresses the POST-rename id and puts the old one back', () => {
    // The asymmetry that makes a rename its own case: each direction addresses the entry by
    // the id the OTHER one leaves behind. Get it backwards and the op resolves nothing, so
    // the undo silently falls back to the slow repaint it exists to avoid.
    const d = openDoc('test://ops-undo-rename.sldd');
    d.widePaint();
    const bus = d.entryNamed('MyBus');
    const oldId = bus.id;
    const selector = entrySelectorOf(bus);
    const beforeXml = d.doc.chunkXml;
    const undoRecord = entryRecord(bus);
    const childIds = bus.children.map((c: any) => c.id);
    expect(childIds.length).toBeGreaterThan(0);

    d.session.mutateSubtree(bus, () => bus.setProperty('Name', 'MyRenamedBus'));
    d.spliceEntryText(bus, selector);
    const newId = bus.id;
    expect(newId).not.toBe(oldId);
    const undoOps: EntryOp[] = [{ kind: 'replace', rowId: newId, record: undoRecord }];

    d.doc.chunkXml = beforeXml;
    const applied = applyEntryOps(d.live(), undoOps, d.session);
    // The rows on screen carry the renamed id, so that is the run the op replaces.
    expect(applied[0]).toMatchObject({ kind: 'replace', entryRowId: newId });
    // The rename's rekeying is undone for the entry AND for every descendant.
    expect(d.session.findNodeById(newId)).toBeNull();
    for (const id of [oldId, ...childIds]) expect(d.session.findNodeById(id), `${id} resolves`).toBeTruthy();
    const undone = d.narrowPaint();
    expect(undone).toEqual(d.widePaint());
    d.dispose();
  });

  it('deleting an entry and undoing it restores the same id at the same position', () => {
    // The user's bug, at entry granularity: a delete's undo has to put the entry back where
    // the restored TEXT says it is, or a later re-parse would reorder the table under them.
    const d = openDoc('test://ops-delete-undo.sldd');
    d.widePaint();
    const entry = d.entryNamed('gravity');
    const entryRowId = entry.id;
    const index = entry.parent.children.indexOf(entry);
    const beforeXml = d.doc.chunkXml;
    // Both directions are snapshotted while the entry is still attached: insertOp reads its
    // section and position from the tree.
    const patch = { undo: [insertOp(entry)], redo: [removeOp(entryRowId)] };

    const { newText } = deleteEntryXml(beforeXml, entry, sectionRowId);
    d.doc.chunkXml = newText;
    applyEntryOps(d.live(), patch.redo, d.session);
    expect(d.session.findNodeById(entryRowId)).toBeNull();
    const afterDelete = d.narrowPaint();
    expect(afterDelete).toEqual(d.widePaint());

    d.doc.chunkXml = beforeXml;
    applyEntryOps(d.live(), patch.undo, d.session);
    const back = d.entryNamed('gravity');
    expect(back.id).toBe(entryRowId);
    expect(back.parent.children.indexOf(back)).toBe(index);
    const restored = d.narrowPaint();
    expect(restored).toEqual(d.widePaint());
    d.dispose();
  });

  it('delete of MANY rows: one op list, and narrow === wide', () => {
    // The binary format's undo stack steps by pushEdit, so the whole gesture is one
    // push — one `after` string and one EntryPatch, exactly as applyDrop already does
    // for N payloads.
    const d = openDoc('test://ops-delete-many.sldd');
    d.widePaint();
    const struct = d.entryNamed('myStruct');
    const other = d.entryNamed('gravity');
    const child = struct.children[0];
    expect(child, 'the fixture’s struct has a field').toBeTruthy();

    const plan = planDeletion([other.id, child.id], (id: string) => d.session.findNodeById(id));
    const selectors = plan.entries.map((e: any) => entrySelectorOf(e));
    const pairs: EntryOpPair[] = plan.entries.map((e: any) => ({
      redo: removeOp(e.id),
      undo: insertOp(e),
    }));
    const childPairs: EntryOpPair[] = [];

    let working = d.doc.chunkXml;
    for (const group of plan.childGroups) {
      // The UNDO side is the entry as it stands BEFORE its children go; the redo side is
      // what the removal left. Captured after, the undo record would describe the entry the
      // delete produced, and undoing would restore the deletion.
      const undo = replaceOp(group.entry, group.entry.id);
      working = mutateEntry(group.entry, () => deleteChildrenXml(working, group.children), d.session).newText;
      childPairs.push({ redo: replaceOp(group.entry, group.entry.id), undo });
    }
    working = deleteEntriesByNameXml(working, selectors);

    const applied: AppliedOp[] = [
      ...plan.childGroups.map((g: any) => ({
        kind: 'replace' as const,
        entryRowId: g.entry.id,
        entry: g.entry,
      })),
      ...applyEntryOps(d.live(), pairs.map((p) => p.redo), d.session),
    ];
    expect(applied.map((a) => a.kind)).toEqual([...plan.childGroups.map(() => 'replace'), ...pairs.map(() => 'remove')]);
    d.doc.chunkXml = working;

    const narrow = d.narrowPaint();
    expect(narrow.some((line) => line.startsWith(other.id + ' | ')), 'the deleted entry’s run is gone').toBe(false);
    expect(narrow.some((line) => line.startsWith(child.id + ' | ')), 'the deleted field’s row is gone').toBe(false);
    expect(narrow).toEqual(d.widePaint());

    // And the whole thing undoes in ONE replay: the child replaces put their entries back
    // as they were, the entry inserts put theirs back where they were.
    const patch = patchOfPairs([...childPairs, ...pairs]);
    expect(patch.undo).toHaveLength(childPairs.length + pairs.length);
    d.dispose();
  });

  it('a paste inserts one entry run, and its redo keeps the pasted name and uuid', () => {
    // Why an op carries a RECORD and not the edit that made it: pasting again would mint
    // another uuid and another unique name, so a "redo" would add a third entry rather than
    // restore the one undo took away.
    const d = openDoc('test://ops-paste.sldd');
    d.widePaint();
    const model = d.live();
    const section = (model.children as any[]).find((s) => s.name === 'design');
    const payload = entryRecord(d.entryNamed('gravity')); // what a copy puts on the clipboard
    const beforeXml = d.doc.chunkXml;

    // Exactly applyPaste's shape: the paste attaches the new entry itself, appending, so
    // the tail past this count is what it added.
    const addedFrom = section.children.length;
    const { newText } = pasteEntryXml(beforeXml, section, payload);
    d.doc.chunkXml = newText;
    const pairs: EntryOpPair[] = [];
    const applied: AppliedOp[] = [];
    for (const fresh of (section.children as any[]).slice(addedFrom)) {
      d.session.indexSubtree(fresh);
      pairs.push({ redo: insertOp(fresh), undo: removeOp(fresh.id) });
      applied.push({ kind: 'insert', entry: fresh, beforeRowId: insertAnchorOf(fresh) });
    }
    expect(applied.length).toBe(1);
    const pasted = (applied[0] as any).entry;
    const pastedName = pasted.name;
    const pastedUuid = pasted.metadata.uuid;
    expect(pastedName).not.toBe('gravity'); // uniquified across the namespace
    expect(pastedUuid).not.toBe((payload.metadata as any).uuid); // and a distinct object
    // Appended, so it is its section's last entry and there is no row to insert before.
    expect((applied[0] as any).beforeRowId).toBeUndefined();

    expectSubtreeResolves(d.session, pasted);
    const withPaste = d.narrowPaint();
    expect(withPaste).toEqual(d.widePaint());

    const patch = patchOfPairs(pairs);
    d.doc.chunkXml = beforeXml;
    applyEntryOps(d.live(), patch.undo, d.session);
    expect(d.entryNamed(pastedName)).toBeUndefined();
    const undone = d.narrowPaint();
    expect(undone).toEqual(d.widePaint());

    d.doc.chunkXml = newText;
    applyEntryOps(d.live(), patch.redo, d.session);
    const again = d.entryNamed(pastedName);
    expect(again.metadata.uuid).toBe(pastedUuid);
    const redone = d.narrowPaint();
    expect(redone).toEqual(d.widePaint());
    d.dispose();
  });

  // A same-document move is [remove source, insert copy], and the copy keeps the name the
  // source gave up — so at the moment of the undo, that ONE name has two candidate owners.
  // Order is the only thing keeping them apart.
  describe('a move that reclaims a name', () => {
    // Remove `gravity`, then re-insert a copy of it that keeps the name but carries its own
    // uuid (what prepareEntryForPaste mints). Returns the pair list the provider would push.
    const setUp = (uri: string) => {
      const d = openDoc(uri);
      d.widePaint();
      const model = d.live();
      const src = d.entryNamed('gravity');
      const section = src.parent;
      const srcId = src.id;
      const srcUuid = src.metadata.uuid;
      const copyRecord = entryRecord(src);
      (copyRecord.metadata as any).uuid = 'copy-uuid';

      const pairs: EntryOpPair[] = [{ redo: removeOp(srcId), undo: insertOp(src) }];
      applyEntryOps(model, [pairs[0].redo], d.session);
      const insert: EntryOp = { kind: 'insert', sectionName: section.name, index: -1, record: copyRecord };
      const copy = (applyEntryOps(model, [insert], d.session)[0] as any).entry;
      pairs.push({ redo: insertOp(copy), undo: removeOp(copy.id) });
      // The point of the exercise: one id, and for now the copy is what answers to it.
      expect(copy.id).toBe(srcId);
      expect(d.session.findNodeById(srcId).metadata.uuid).toBe('copy-uuid');
      return { d, model, section, srcId, pairs, srcUuid };
    };

    const gravities = (section: any) =>
      (section.children as any[]).filter((e) => e.name === 'gravity').map((e) => e.metadata.uuid);

    it('undoes correctly with the inverses REVERSED, as patchOfPairs orders them', () => {
      const { d, model, section, srcId, pairs, srcUuid } = setUp('test://ops-reclaim-reverse.sldd');
      const patch = patchOfPairs(pairs);
      expect(patch.undo.map((o) => o.kind)).toEqual(['remove', 'insert']);

      applyEntryOps(model, patch.undo, d.session);
      // One owner of the name, and it is the original — indexed, so the next edit finds it.
      expect(gravities(section)).toEqual([srcUuid]);
      expect(d.session.findNodeById(srcId).metadata.uuid).toBe(srcUuid);
      d.dispose();
    });

    it('does NOT undo correctly with the inverses in forward order', () => {
      // Pinned as the reason patchOfPairs reverses: inserting the source while the copy is
      // still standing puts two entries under one id, and the remove that follows has no
      // one entry to resolve to. Core refuses an id that names two nodes (F1-50), so the
      // remove throws rather than taking whichever twin was indexed last, and the caller
      // falls back to a wide repaint from the text. Forward order is still wrong: it leaves
      // both entries standing, under one id that nothing can address.
      const { d, model, section, srcId, pairs, srcUuid } = setUp('test://ops-reclaim-forward.sldd');
      expect(() => applyEntryOps(model, pairs.map((p) => p.undo), d.session)).toThrow(/No entry is indexed/); // NOT reversed
      // The insert before the refused remove is not rolled back (applyEntryOps applies op by
      // op): the source is back at its own index and the copy still stands after it.
      expect(srcUuid).not.toBe('copy-uuid');
      expect(gravities(section)).toEqual([srcUuid, 'copy-uuid']);
      expect(d.session.findNodeById(srcId)).toBeNull();
      d.dispose();
    });
  });

  it('throws rather than guessing when an op cannot be resolved', () => {
    // The safety property the whole design rests on: a narrow path that cannot be sure
    // hands the caller a throw, and the caller repaints wide from the text — which is
    // already correct. Guessing would leave the table describing a file that does not exist.
    const d = openDoc('test://ops-unresolvable.sldd');
    d.widePaint();
    const model = d.live();
    const entry = d.entryNamed('scalarD');
    const record = entryRecord(entry);
    const inventory = () => (model.children as any[]).map((s) => s.children.map((e: any) => e.name));
    const before = inventory();

    expect(() => applyEntryOps(model, [{ kind: 'replace', rowId: 'no/such/row', record }], d.session)).toThrow(
      /No entry is indexed/,
    );
    // A row inside an entry is not an entry: only whole entries are op-addressable.
    expect(() => applyEntryOps(model, [removeOp(d.entryNamed('MyBus').children[0].id)], d.session)).toThrow(
      /not a top-level entry/,
    );
    // A section that this dictionary does not have.
    expect(() =>
      applyEntryOps(model, [{ kind: 'insert', sectionName: 'nope', index: 0, record }], d.session),
    ).toThrow(/no "nope" section/);
    expect(inventory()).toEqual(before);
    d.dispose();
  });

  it('refuses an op that resolves into ANOTHER tree of the same document', () => {
    // A wide repaint re-registers the source under the same srcId, so every id now names a
    // node in a brand-new object graph. An op applied to the tree it was BUILT against would
    // mutate something nothing paints — and the table would keep showing the old rows.
    const d = openDoc('test://ops-stale-tree.sldd');
    d.widePaint();
    const stale = d.live();
    const entry = d.entryNamed('scalarD');
    const op = replaceOp(entry, entry.id);

    d.build(); // what the wide path does
    expect(() => applyEntryOps(stale, [op], d.session)).toThrow(/belongs to another model/);
    // The same op against the tree that IS registered applies cleanly.
    expect(() => applyEntryOps(d.live(), [op], d.session)).not.toThrow();
    d.dispose();
  });
});
