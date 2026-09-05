// Copyright 2026 The MathWorks, Inc.
//
// Mutation by node id, for a caller that has no selection to mutate through — a CLI,
// an RPC server, a test. The selection-driven forms (`addChild()`, `deleteNode()`)
// are covered by test/dataModelMutations.test.ts and are unchanged; what is under
// test here is everything the explicit forms have to get right INSTEAD of reading
// the selection:
//
//   - the mutation lands on the node named, with no setActiveEntry beforehand;
//   - the undo step is recorded against the document the TARGET belongs to, not
//     whatever document happens to be selected — the two are not the same session
//     state, and getActiveSlddNode() cannot answer for a caller with no context;
//   - the selection is left alone, EXCEPT that removing the node a selection points
//     at (or a node inside it) must release that selection, or the session keeps
//     handing out a node from a subtree the document no longer has. That is the same
//     detached-node hazard releaseSelection exists for, one subtree wide.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function loadFixture(name: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

function bytes(name: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// A session holding one dictionary and NO selection of any kind — the state a
// headless caller is actually in.
function headlessSession(srcId = 'numeric_json.sldd') {
  const s = createSession();
  const src = s.addDataSource(srcId, loadFixture('numeric_json.sldd')) as any;
  return { s, src };
}

const sectionOf = (src: any, name: string) => src.children.find((c: any) => c.name === name);
const addable = (src: any) => (src.flatten() as any[]).find((n) => typeof n.execAddChild === 'function');

describe('addChildTo(nodeId)', () => {
  it('appends a child to the named node with no selection at all', () => {
    const { s, src } = headlessSession();
    const parent = addable(src);
    const before = parent.children.length;
    expect(s.getEntryNodes()).toEqual([]);
    expect(s.getContextNode()).toBeNull();

    const child = s.addChildTo(parent.id) as any;
    expect(child).toBeTruthy();
    expect(parent.children.length).toBe(before + 1);
    expect(child.parent).toBe(parent);
    // Indexed, so the caller can name the node it just made in its next call.
    expect(s.findNodeById(child.id)).toBe(child);
  });

  it('records undo against the document the target belongs to', () => {
    // The selection-driven form scopes its undo to getActiveSlddNode(). With no
    // context there is no such node, so the scope has to come from the target.
    const { s, src } = headlessSession();
    const parent = addable(src);
    const before = parent.children.length;
    const child = s.addChildTo(parent.id) as any;

    // Undo is still selection-driven (out of this item's scope), so point the
    // session at the document to drive it — which is also the assertion that the
    // step was filed under THIS document's name.
    s.setActiveContext(src);
    expect(s.canUndo()).toBe(true);
    s.undo();
    expect(parent.children.length).toBe(before);
    expect(s.findNodeById(child.id)).toBeNull();

    s.redo();
    expect(parent.children.length).toBe(before + 1);
    expect(s.findNodeById(child.id)).toBe(child);
  });

  it('does not disturb a selection the caller never mentioned', () => {
    // The zero-arg form selects the new child, because a UI click should. A caller
    // that named a node by id asked for a mutation and nothing else — moving the
    // selection under a host that has its own would fight it for control.
    const { s, src } = headlessSession();
    const parent = addable(src);
    const elsewhere = sectionOf(src, 'design');
    s.setActive(src, elsewhere);

    const child = s.addChildTo(parent.id) as any;
    expect(child).toBeTruthy();
    expect(s.getContextNode()).toBe(src);
    expect(s.getEntryNodes()).toEqual([elsewhere]);
  });

  it('publishes node/children-changed for the parent', () => {
    const { s, src } = headlessSession();
    const parent = addable(src);
    const parents: unknown[] = [];
    s.bus.subscribe('node/children-changed', (p: any) => { parents.push(p.parent); });
    s.addChildTo(parent.id);
    expect(parents).toContain(parent);
  });

  it('returns null for an id the session does not hold', () => {
    const { s } = headlessSession();
    expect(s.addChildTo('no-such-node')).toBeNull();
  });

  it('returns null for a node that cannot take children, and for one that refuses', () => {
    // Two distinct guards, exactly as for the zero-arg form: a section has no
    // execAddChild at all, while a 2-D matrix has one and its own canAddChild says
    // no because appending an element would leave it non-rectangular.
    const { s, src } = headlessSession();
    expect(s.addChildTo(sectionOf(src, 'design').id)).toBeNull();

    const matrix = (src.flatten() as any[]).find(
      (n) => typeof n.execAddChild === 'function' && n.canAddChild && !n.canAddChild(),
    );
    expect(matrix).toBeTruthy();
    const before = matrix.children.length;
    expect(s.addChildTo(matrix.id)).toBeNull();
    expect(matrix.children.length).toBe(before);
    s.setActiveContext(src);
    expect(s.canUndo()).toBe(false);
  });
});

describe('deleteNodeById(nodeId)', () => {
  it('removes an entry with no selection at all, and de-indexes its subtree', () => {
    const { s, src } = headlessSession();
    const design = sectionOf(src, 'design');
    const entry = (src.flatten() as any[]).find((n) => n.isEntry && n.children.length > 0);
    const child = entry.children[0];
    const before = design.children.length;

    expect(s.deleteNodeById(entry.id)).toBe(true);
    expect(design.children).not.toContain(entry);
    expect(s.findNodeById(entry.id)).toBeNull();
    expect(s.findNodeById(child.id)).toBeNull();
  });

  it('records undo against the target’s document, not the selected one', () => {
    // The sharpest form of the item: with a selection pointing into a DIFFERENT
    // file, the selection-driven form would have filed this step under that file —
    // so undoing in the file that actually changed would do nothing, and undoing in
    // the untouched one would replay a change it never made.
    const s = createSession();
    const a = s.addDataSource('a.sldd', loadFixture('numeric_json.sldd')) as any;
    const b = s.addDataSource('b.sldd', loadFixture('numeric_json.sldd')) as any;
    const bEntry = (b.flatten() as any[]).find((n) => n.isEntry);
    const bSection = bEntry.parent;
    const before = bSection.children.length;
    s.setActive(a, (a.flatten() as any[]).find((n) => n.isEntry));

    expect(s.deleteNodeById(bEntry.id)).toBe(true);
    expect(bSection.children.length).toBe(before - 1);

    // Nothing was recorded against a.sldd, which is where the selection is.
    expect(s.canUndo()).toBe(false);

    s.setActiveContext(b);
    expect(s.canUndo()).toBe(true);
    s.undo();
    expect(bSection.children.length).toBe(before);
    expect(s.findNodeById(bEntry.id)).toBe(bEntry);
  });

  it('releases a selection that pointed at the deleted node', () => {
    // The one case where the explicit form MUST touch the selection. A selection
    // left on a removed node is a node the session no longer owns: getActiveSlddNode
    // walks up a detached tree, and an edit routed there mutates an orphan that
    // vanishes on save.
    const { s, src } = headlessSession();
    const entry = (src.flatten() as any[]).find((n) => n.isEntry);
    s.setActive(entry, entry);
    s.setPreviewNode(entry);

    expect(s.deleteNodeById(entry.id)).toBe(true);
    expect(s.getEntryNodes()).toEqual([]);
    expect(s.getContextNode()).toBeNull();
    expect(s.getPreviewNode()).toBeNull();
    expect(s.getActiveSlddNode()).toBeNull();
  });

  it('releases a selection that pointed INSIDE the deleted node', () => {
    // A descendant is detached just as thoroughly as the node named, and it is the
    // likelier selection in a tree view: the user expands an entry, clicks a field,
    // and a CLI or an RPC call deletes the entry above it.
    const { s, src } = headlessSession();
    const entry = (src.flatten() as any[]).find((n) => n.isEntry && n.children.length > 0);
    const inside = entry.children[0];
    s.setActive(inside, inside);

    expect(s.deleteNodeById(entry.id)).toBe(true);
    expect(s.getEntryNodes()).toEqual([]);
    expect(s.getContextNode()).toBeNull();
  });

  it('leaves a selection elsewhere in the same document alone', () => {
    // The release is one subtree wide, not one document wide. Deleting entry A must
    // not deselect entry B, or every headless delete would clear a host's selection.
    const { s, src } = headlessSession();
    const entries = (src.flatten() as any[]).filter((n) => n.isEntry);
    const doomed = entries[0];
    const keep = entries[1];
    s.setActive(src, keep);
    let activeHits = 0;
    s.bus.subscribe('active/changed', () => { activeHits++; });

    expect(s.deleteNodeById(doomed.id)).toBe(true);
    expect(s.getEntryNodes()).toEqual([keep]);
    expect(s.getContextNode()).toBe(src);
    expect(activeHits).toBe(0);
  });

  it('removes a non-entry child without selecting its parent', () => {
    const { s, src } = headlessSession();
    const child = (src.flatten() as any[]).find(
      (n) => !n.isEntry && n.parent && typeof n.parent.execRemoveChild === 'function',
    );
    const parent = child.parent;
    const before = parent.children.length;

    expect(s.deleteNodeById(child.id)).toBe(true);
    expect(parent.children.length).toBe(before - 1);
    // The zero-arg form selects the surviving parent; this one was not asked to.
    expect(s.getEntryNodes()).toEqual([]);

    s.setActiveContext(src);
    s.undo();
    expect(parent.children.length).toBe(before);
  });

  it('returns false for an unknown id, a section, and a source root', () => {
    const { s, src } = headlessSession();
    expect(s.deleteNodeById('no-such-node')).toBe(false);
    expect(s.deleteNodeById(sectionOf(src, 'design').id)).toBe(false);
    // A source root has no parent to remove it from; closing a file is
    // removeDataSource, not a delete.
    expect(s.deleteNodeById(src.id)).toBe(false);
    expect(src.children.length).toBe(4);
  });

  it('returns false for an entry of a read-only model, and for a project source', () => {
    // A .slx model carries a `dirty` flag, so it counts as an editable document and
    // the delete runs all the way to the section before that section refuses it. A
    // .prj has no dirty flag at all, so it is refused one step earlier — there is no
    // document to record an undo step against.
    const s = createSession();
    const model = s.addModelSource('model_with_refs.slx', bytes('model_with_refs.slx')) as any;
    const ref = model.children.find((c: any) => c.name === 'references').children[0];
    expect(ref.isEntry).toBe(true);
    expect(s.deleteNodeById(ref.id)).toBe(false);

    const prj = s.addProjectSource('MyProj.prj', {
      'resources/project/root/FILESHASHp.xml':
        '<?xml version="1.0" encoding="UTF-8"?>\n<Info location="Root" type="Files"/>',
      'resources/project/FILESHASH/AAAp.xml':
        '<?xml version="1.0" encoding="UTF-8"?>\n<Info location="helper.m" type="File"/>',
      'resources/project/FILESHASH/AAAd.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<Info/>',
    }) as any;
    const file = (prj.flatten() as any[]).find((n) => n.isEntry);
    expect(file).toBeTruthy();
    expect(s.deleteNodeById(file.id)).toBe(false);
  });
});

describe('deleteNodesById(nodeIds)', () => {
  it('removes several entries in one undoable step, with no selection', () => {
    const { s, src } = headlessSession();
    const design = sectionOf(src, 'design');
    const doomed = design.children.slice(0, 2);
    const before = design.children.length;

    expect(s.deleteNodesById(doomed.map((n: any) => n.id))).toBe(true);
    expect(design.children.length).toBe(before - 2);
    for (const n of doomed) { expect(s.findNodeById(n.id)).toBeNull(); }

    // One command, not two.
    s.setActiveContext(src);
    s.undo();
    expect(design.children.length).toBe(before);
    expect(s.canUndo()).toBe(false);
  });

  it('releases only the selections that pointed into the batch', () => {
    const { s, src } = headlessSession();
    const design = sectionOf(src, 'design');
    const doomed = design.children.slice(0, 2);
    const keep = design.children[2];
    s.setActive(src, [doomed[0], keep, doomed[1]]);

    expect(s.deleteNodesById(doomed.map((n: any) => n.id))).toBe(true);
    expect(s.getEntryNodes()).toEqual([keep]);
    expect(s.getContextNode()).toBe(src);
  });

  it('refuses a batch spanning two documents rather than half-recording it', () => {
    // An undo command is scoped to ONE document's stack, so a cross-file batch would
    // file a single step under one of them: undo in that file would half-restore two
    // files, and the other file would hold a change with no step to undo it. A caller
    // that wants both loops per source, which is what it wants anyway.
    const s = createSession();
    const a = s.addDataSource('a.sldd', loadFixture('numeric_json.sldd')) as any;
    const b = s.addDataSource('b.sldd', loadFixture('numeric_json.sldd')) as any;
    const aEntry = (a.flatten() as any[]).find((n) => n.isEntry);
    const bEntry = (b.flatten() as any[]).find((n) => n.isEntry);

    expect(s.deleteNodesById([aEntry.id, bEntry.id])).toBe(false);
    // Refused means nothing happened, in either file.
    expect(s.findNodeById(aEntry.id)).toBe(aEntry);
    expect(s.findNodeById(bEntry.id)).toBe(bEntry);
  });

  it('returns false for an empty list, and for one holding no resolvable id', () => {
    const { s } = headlessSession();
    expect(s.deleteNodesById([])).toBe(false);
    expect(s.deleteNodesById(['no-such-node', 'nor-this-one'])).toBe(false);
  });

  it('takes the single-node path for a one-id list, so a non-entry still deletes', () => {
    // The batch branch handles entries only. A list of one has to behave like
    // deleteNodeById or the same id would succeed or fail depending on which call
    // the caller reached for.
    const { s, src } = headlessSession();
    const child = (src.flatten() as any[]).find(
      (n) => !n.isEntry && n.parent && typeof n.parent.execRemoveChild === 'function',
    );
    const parent = child.parent;
    const before = parent.children.length;
    expect(s.deleteNodesById([child.id])).toBe(true);
    expect(parent.children.length).toBe(before - 1);
  });
});
