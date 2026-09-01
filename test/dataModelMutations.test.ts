// Copyright 2026 The MathWorks, Inc.
// Unit tests for the session mutation actions — editProperty / addEntry /
// addChild / deleteNode. These are the four entry points a UI calls to change a
// document, and each one both mutates the tree and records an undo step, so the
// contract under test is: the tree changed, the node index tracks it, the
// selection lands somewhere sensible, and undo puts everything back.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

function loadFixture(name: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

// A session with numeric_json.sldd loaded and the source as active context.
function loadedSession() {
  const s = createSession();
  const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
  s.setActiveContext(src);
  return { s, src };
}

// A session with model_with_refs.slx loaded. A model is read-only but still counts
// as an active document (it carries a `dirty` flag), so the delete path runs all
// the way to the section and is refused there — see the tests below.
function modelSession() {
  const path = fileURLToPath(new URL('./fixtures/model_with_refs.slx', import.meta.url));
  const b = readFileSync(path);
  const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const s = createSession();
  const src = s.addModelSource('model_with_refs.slx', buf) as any;
  s.setActiveContext(src);
  return { s, src };
}

const sectionOf = (src: any, name: string) => src.children.find((c: any) => c.name === name);
const firstEntry = (src: any) => (src.flatten() as any[]).find((n) => n.isEntry);

describe('addEntry', () => {
  it('adds a named entry to the requested section and selects it', () => {
    const { s, src } = loadedSession();
    const node = s.addEntry('design', 'Simulink.Signal', 'mySig') as any;
    expect(node).toBeTruthy();
    expect(node.name).toBe('mySig');
    expect(node.parent).toBe(sectionOf(src, 'design'));
    expect(s.getEntryNode()).toBe(node);
    expect(s.findNodeById(node.id)).toBe(node);
  });

  it('publishes node/added', () => {
    const { s } = loadedSession();
    let added: any = null;
    s.bus.subscribe('node/added', (p: any) => { added = p; });
    const node = s.addEntry('design', 'Simulink.Signal', 'mySig');
    expect(added.node).toBe(node);
    expect(added.sectionKey).toBe('design');
  });

  it('infers the section from the class when given the root key', () => {
    // The root has no section named 'sldd', so the class decides which section
    // accepts the new entry.
    const { s, src } = loadedSession();
    const node = s.addEntry('sldd', 'Simulink.Parameter') as any;
    expect(node).toBeTruthy();
    expect(node.parent).toBe(sectionOf(src, 'design'));
  });

  it('undo removes the entry and de-indexes it; redo restores it', () => {
    const { s, src } = loadedSession();
    const design = sectionOf(src, 'design');
    const before = design.children.length;
    const node = s.addEntry('design', 'Simulink.Signal', 'mySig') as any;
    expect(design.children.length).toBe(before + 1);
    expect(s.canUndo()).toBe(true);

    s.undo();
    expect(design.children.length).toBe(before);
    expect(s.findNodeById(node.id)).toBeNull();
    expect(s.getEntryNodes()).toEqual([]);

    s.redo();
    expect(design.children.length).toBe(before + 1);
    expect(s.findNodeById(node.id)).toBe(node);
    expect(s.getEntryNode()).toBe(node);
  });

  it('returns null with no active source', () => {
    const s = createSession();
    expect(s.addEntry('design', 'Simulink.Signal')).toBeNull();
  });

  it('returns null for a class no section accepts', () => {
    const { s } = loadedSession();
    expect(s.addEntry('sldd', 'No.Such.Class')).toBeNull();
  });

  // The two refusals are distinct: 'sldd' means "find me a section that takes
  // this", so an unknown class finds none; naming a section that exists but does
  // not allow the class has to fail too, rather than forcing the entry in.
  it('returns null when the named section refuses the class', () => {
    const { s, src } = loadedSession();
    const design = sectionOf(src, 'design');
    const before = design.children.length;
    expect(s.addEntry('design', 'Simulink.ConfigSet')).toBeNull();
    expect(design.children.length).toBe(before);
    expect(s.canUndo()).toBe(false);
  });

  // The ADD-side twin of 'refuses to delete an entry out of a read-only model
  // section'. A .slx model's ModelSectionNode implements neither getAllowedTypes
  // nor execAddEntry, so it is found by name (skipping the class-inference loop
  // entirely) and then refused for having no add hook — which is what keeps a
  // read-only model read-only from this direction too.
  it('returns null for a section of a read-only model, by name or by inference', () => {
    const { s, src } = modelSession();
    const ws = sectionOf(src, 'workspace');
    const before = ws.children.length;
    expect(s.addEntry('workspace', 'MatlabVariable')).toBeNull();
    // And from the root, where no model section claims the class either.
    expect(s.addEntry('sldd', 'MatlabVariable')).toBeNull();
    expect(ws.children.length).toBe(before);
    expect(s.canUndo()).toBe(false);
  });
});

describe('editProperty', () => {
  it('applies the edit and reports success', () => {
    const { s, src } = loadedSession();
    const entry = firstEntry(src);
    s.setActive(src, entry);
    expect(s.editProperty(entry.id, 'Name', 'renamed', entry.name)).toBe(true);
    expect(entry.name).toBe('renamed');
  });

  it('publishes node/edited with the rename kind for a Name change', () => {
    const { s, src } = loadedSession();
    const entry = firstEntry(src);
    s.setActive(src, entry);
    const kinds: string[] = [];
    s.bus.subscribe('node/edited', (p: any) => { kinds.push(p.kind); });
    s.editProperty(entry.id, 'Name', 'renamed', entry.name);
    expect(kinds).toEqual(['rename']);
  });

  it('re-indexes under the new id after a rename', () => {
    // A node's id embeds its name, so renaming changes the id; the index has to
    // follow or findNodeById stops resolving the node the user just renamed.
    const { s, src } = loadedSession();
    const entry = firstEntry(src);
    const oldId = entry.id;
    s.setActive(src, entry);
    s.editProperty(entry.id, 'Name', 'renamed', entry.name);
    expect(entry.id).not.toBe(oldId);
    expect(s.findNodeById(entry.id)).toBe(entry);
    expect(s.findNodeById(oldId)).toBeNull();
  });

  it('undo restores the previous value; redo reapplies it', () => {
    const { s, src } = loadedSession();
    const entry = firstEntry(src);
    const original = entry.name;
    s.setActive(src, entry);
    s.editProperty(entry.id, 'Name', 'renamed', original);

    s.undo();
    expect(entry.name).toBe(original);
    s.redo();
    expect(entry.name).toBe('renamed');
  });

  it('undo restores the previous value even when the caller omits oldValue', () => {
    // `oldValue` is optional and README's own example omits it, so undo cannot rely
    // on the caller supplying it. It used to: undo called setProperty(prop,
    // undefined), which wiped the prior value rather than restoring it — and redo
    // could not bring it back either, so one undo silently destroyed the old text.
    const { s, src } = loadedSession();
    const entry = firstEntry(src);
    const original = entry.name;
    s.setActive(src, entry);

    expect(s.editProperty(entry.id, 'Name', 'renamed')).toBe(true);
    expect(entry.name).toBe('renamed');

    s.undo();
    expect(entry.name).toBe(original);
    s.redo();
    expect(entry.name).toBe('renamed');
  });

  it('refuses an edit aimed at a node that is not the active one', () => {
    const { s, src } = loadedSession();
    s.setActive(src, firstEntry(src));
    expect(s.editProperty('no-such-node', 'Name', 'x')).toBe(false);
  });

  it('refuses an edit while the synthetic root is selected', () => {
    const { s } = loadedSession();
    s.setActiveContext(s.allNode);
    expect(s.editProperty(s.allNode.id, 'Name', 'x')).toBe(false);
  });

  it('refuses an edit on a node that has no setProperty', () => {
    // Section nodes are structure, not data — they expose no editable props.
    const { s, src } = loadedSession();
    const section = sectionOf(src, 'design');
    s.setActive(src, section);
    expect(s.editProperty(section.id, 'Name', 'x')).toBe(false);
  });

  it('hands a rejected value’s reason back to the caller unchanged', () => {
    // A rejection is not the same as a refusal: `false` means the edit never
    // reached the node, whereas the node's own error object carries the message and
    // the value to restore, which is what the property inspector shows. Collapsing
    // it to false would leave the UI with a failed edit and nothing to say about it.
    const { s, src } = loadedSession();
    const param = sectionOf(src, 'design').children[0];
    s.setActive(src, param);
    const before = param.displayValue;

    expect(s.editProperty(param.id, 'Value', '((((')).toEqual({
      error: true,
      reason: 'Invalid MATLAB expression',
      invalidValue: '((((',
      validValue: before,
    });
    expect(param.displayValue).toBe(before);
    // A rejected edit changed nothing, so it must not leave an undo step behind.
    expect(s.canUndo()).toBe(false);
  });

  it('forwards a rejected rename the same way', () => {
    const { s, src } = loadedSession();
    const param = sectionOf(src, 'design').children[0];
    const original = param.name;
    s.setActive(src, param);

    expect(s.editProperty(param.id, 'Name', '')).toMatchObject({
      error: true,
      reason: 'Name cannot be empty',
      validValue: original,
    });
    expect(param.name).toBe(original);
    expect(s.canUndo()).toBe(false);
  });
});

describe('addChild', () => {
  it('appends a child, indexes it, and records undo', () => {
    const { s, src } = loadedSession();
    const parent = (src.flatten() as any[]).find((n) => typeof n.execAddChild === 'function');
    const before = parent.children.length;
    s.setActive(src, parent);

    const child = s.addChild() as any;
    expect(child).toBeTruthy();
    expect(parent.children.length).toBe(before + 1);
    expect(s.findNodeById(child.id)).toBe(child);

    s.undo();
    expect(parent.children.length).toBe(before);
    expect(s.findNodeById(child.id)).toBeNull();

    s.redo();
    expect(parent.children.length).toBe(before + 1);
    expect(s.getEntryNode()).toBe(child);
  });

  it('publishes node/children-changed for the parent', () => {
    const { s, src } = loadedSession();
    const parent = (src.flatten() as any[]).find((n) => typeof n.execAddChild === 'function');
    s.setActive(src, parent);
    const parents: unknown[] = [];
    s.bus.subscribe('node/children-changed', (p: any) => { parents.push(p.parent); });
    s.addChild();
    expect(parents).toContain(parent);
  });

  it('returns null unless exactly one node is selected', () => {
    const { s, src } = loadedSession();
    const flat = src.flatten() as any[];
    s.setActive(src, [flat[1], flat[2]]);
    expect(s.addChild()).toBeNull();
    s.setActive(src, null);
    expect(s.addChild()).toBeNull();
  });

  it('returns null for a node that cannot take children', () => {
    const { s, src } = loadedSession();
    const section = sectionOf(src, 'design');
    s.setActive(src, section);
    expect(s.addChild()).toBeNull();
  });

  // A node CAN define execAddChild and still refuse: a 2-D matrix would stop being
  // rectangular if one element were appended, so its own canAddChild says no. The
  // session has to honour that refusal — this is a different guard from the one
  // above, where the node has no execAddChild at all.
  it('returns null when the node defines execAddChild but refuses', () => {
    const { s, src } = loadedSession();
    const matrix = (src.flatten() as any[]).find(
      (n) => typeof n.execAddChild === 'function' && n.canAddChild && !n.canAddChild(),
    );
    expect(matrix).toBeTruthy();
    const before = matrix.children.length;
    s.setActive(src, matrix);
    expect(s.addChild()).toBeNull();
    expect(matrix.children.length).toBe(before);
    expect(s.canUndo()).toBe(false);
  });
});

describe('deleteNode', () => {
  it('removes a single entry, clears the selection, and de-indexes it', () => {
    const { s, src } = loadedSession();
    const design = sectionOf(src, 'design');
    const entry = design.children[0];
    const before = design.children.length;
    s.setActive(src, entry);

    expect(s.deleteNode()).toBe(true);
    expect(design.children.length).toBe(before - 1);
    expect(s.findNodeById(entry.id)).toBeNull();
    expect(s.getEntryNodes()).toEqual([]);

    s.undo();
    expect(design.children.length).toBe(before);
    expect(s.findNodeById(entry.id)).toBe(entry);
    expect(s.getEntryNode()).toBe(entry);
  });

  it('publishes node/deleted with the owning section', () => {
    const { s, src } = loadedSession();
    const design = sectionOf(src, 'design');
    const entry = design.children[0];
    s.setActive(src, entry);
    let payload: any = null;
    s.bus.subscribe('node/deleted', (p: any) => { payload = p; });
    s.deleteNode();
    expect(payload.node).toBe(entry);
    expect(payload.section).toBe(design);
  });

  it('removes several entries in one undoable step', () => {
    const { s, src } = loadedSession();
    const design = sectionOf(src, 'design');
    const doomed = design.children.slice(0, 2);
    const before = design.children.length;
    s.setActive(src, doomed);

    expect(s.deleteNode()).toBe(true);
    expect(design.children.length).toBe(before - 2);
    for (const n of doomed) { expect(s.findNodeById(n.id)).toBeNull(); }

    // One undo step, not two — the batch is recorded as a single command.
    s.undo();
    expect(design.children.length).toBe(before);
    expect(s.getEntryNodes()).toEqual(doomed);
    expect(s.canUndo()).toBe(false);
  });

  it('removes a non-entry child and selects its parent', () => {
    const { s, src } = loadedSession();
    const child = (src.flatten() as any[]).find(
      (n) => !n.isEntry && n.parent && typeof n.parent.execRemoveChild === 'function',
    );
    const parent = child.parent;
    const before = parent.children.length;
    s.setActive(src, child);

    expect(s.deleteNode()).toBe(true);
    expect(parent.children.length).toBe(before - 1);
    expect(s.getEntryNode()).toBe(parent);

    s.undo();
    expect(parent.children.length).toBe(before);
    expect(s.getEntryNode()).toBe(child);
  });

  it('returns false with nothing selected', () => {
    const { s } = loadedSession();
    s.setActiveEntry(null);
    expect(s.deleteNode()).toBe(false);
  });

  it('returns false without an active source', () => {
    const s = createSession();
    const src = s.addDataSource('n.sldd', loadFixture('numeric_json.sldd')) as any;
    // Entry selected but no context, so there is no source to record undo against.
    s.setActiveEntry(firstEntry(src));
    expect(s.deleteNode()).toBe(false);
  });

  it('refuses to delete a section, which is structure rather than data', () => {
    // Sections are neither entries nor removable children — the source node has no
    // execRemoveChild — so deleting one has to be a no-op rather than a tree that
    // loses a whole section it can never get back.
    const { s, src } = loadedSession();
    const design = sectionOf(src, 'design');
    s.setActive(src, design);
    expect(s.deleteNode()).toBe(false);
    expect(src.children.length).toBe(4);
    expect(s.canUndo()).toBe(false);
  });

  it('deletes only the entries out of a mixed multi-selection', () => {
    // A batch delete handles entries alone; a non-entry caught up in the selection
    // is skipped rather than dragging its whole parent down with it.
    const { s, src } = loadedSession();
    const design = sectionOf(src, 'design');
    const entry = design.children[0];
    const other = design.children.slice(1).find((e: any) => e.children.length > 0);
    const child = other.children[0];
    const before = design.children.length;
    const otherKids = other.children.length;
    s.setActive(src, [entry, child]);

    expect(s.deleteNode()).toBe(true);
    expect(design.children.length).toBe(before - 1);
    expect(s.findNodeById(entry.id)).toBeNull();
    expect(s.findNodeById(child.id)).toBe(child);
    expect(other.children.length).toBe(otherKids);
  });

  // A .slx model is read-only: its ModelSectionNode deliberately implements no
  // execRemoveEntry. But the model DOES carry a `dirty` flag, so it reads as an
  // active document and the delete runs all the way to the section before being
  // refused — this is the guard that keeps a read-only file read-only.
  it('refuses to delete an entry out of a read-only model section', () => {
    const { s, src } = modelSession();
    const refs = sectionOf(src, 'references');
    const entry = refs.children[0];
    expect(entry.isEntry).toBe(true);
    s.setActive(src, entry);

    expect(s.deleteNode()).toBe(false);
    expect(refs.children).toContain(entry);
    expect(s.canUndo()).toBe(false);
  });

  it('refuses a whole multi-selection of read-only model entries', () => {
    const { s, src } = modelSession();
    const refs = sectionOf(src, 'references');
    const ds = sectionOf(src, 'dataSources');
    const doomed = [refs.children[0], ds.children[0]];
    s.setActive(src, doomed);

    expect(s.deleteNode()).toBe(false);
    expect(refs.children).toContain(doomed[0]);
    expect(ds.children).toContain(doomed[1]);
    expect(s.canUndo()).toBe(false);
  });

  // The parent implements execRemoveChild but its canRemoveChild says no: dropping
  // one element of a 2-D matrix would leave it non-rectangular. deleteNode has to
  // treat a null result as a refusal, not push an undo step for a removal that
  // never happened.
  it('returns false when the parent defines execRemoveChild but refuses', () => {
    const { s, src } = loadedSession();
    const child = (src.flatten() as any[]).find(
      (n) =>
        !n.isEntry &&
        n.parent &&
        typeof n.parent.execRemoveChild === 'function' &&
        n.parent.canRemoveChild &&
        !n.parent.canRemoveChild(),
    );
    expect(child).toBeTruthy();
    const parent = child.parent;
    const before = parent.children.length;
    s.setActive(src, child);

    expect(s.deleteNode()).toBe(false);
    expect(parent.children.length).toBe(before);
    expect(s.findNodeById(child.id)).toBe(child);
    expect(s.canUndo()).toBe(false);
  });

  // The section HAS execRemoveEntry, but the node is no longer among its children,
  // so the hook reports the removal it could not perform. This is the stale-selection
  // case: a host still holding a node the tree already dropped (a second delete of
  // the same node, or a selection surviving a reload). deleteNode has to treat the
  // null as a refusal — pushing an undo step here would let undo re-attach a node
  // the document deliberately no longer has.
  it('returns false for an entry its section no longer contains', () => {
    const { s, src } = loadedSession();
    const design = sectionOf(src, 'design');
    const entry = design.children[0];
    design.children.splice(0, 1);
    // Still reads as an entry: `parent` is untouched, which is exactly why the
    // section, not the node, is the one that can tell this is a no-op.
    expect(entry.isEntry).toBe(true);
    expect(entry.parent).toBe(design);
    s.setActive(src, entry);

    expect(s.deleteNode()).toBe(false);
    expect(s.canUndo()).toBe(false);
  });

  it('returns false for a multi-selection holding no entries at all', () => {
    const { s, src } = loadedSession();
    const child = (src.flatten() as any[]).find(
      (n) => !n.isEntry && n.parent && typeof n.parent.execRemoveChild === 'function',
    );
    const parent = child.parent;
    const before = parent.children.length;
    s.setActive(src, [child, parent.children[1]]);

    expect(s.deleteNode()).toBe(false);
    expect(parent.children.length).toBe(before);
    expect(s.canUndo()).toBe(false);
  });
});

// deleteNode records its undo step with a closure that re-runs the removal, and
// that closure re-reads the node's id AFTER the tree changed — ids are path-derived,
// so a detached node's id is not the one it had when it was deleted. Undo alone
// never runs those closures, so without these the redo leg is untested and a stale
// index key would leave a removed node still resolvable by id.
describe('deleteNode — redo re-applies the removal', () => {
  it('re-deletes a single entry and de-indexes it again', () => {
    const { s, src } = loadedSession();
    const design = sectionOf(src, 'design');
    const entry = design.children[0];
    const before = design.children.length;
    s.setActive(src, entry);

    s.deleteNode();
    s.undo();
    expect(design.children.length).toBe(before);
    expect(s.canRedo()).toBe(true);

    s.redo();
    expect(design.children.length).toBe(before - 1);
    expect(s.findNodeById(entry.id)).toBeNull();
    expect(s.getEntryNodes()).toEqual([]);
  });

  it('re-deletes a whole multi-entry batch in one step', () => {
    const { s, src } = loadedSession();
    const design = sectionOf(src, 'design');
    const doomed = design.children.slice(0, 2);
    const before = design.children.length;
    s.setActive(src, doomed);

    s.deleteNode();
    s.undo();
    s.redo();

    expect(design.children.length).toBe(before - 2);
    for (const n of doomed) { expect(s.findNodeById(n.id)).toBeNull(); }
    // One command, so one redo empties the batch and nothing is left to redo.
    expect(s.canRedo()).toBe(false);
  });

  it('re-deletes a non-entry child and re-selects its parent', () => {
    const { s, src } = loadedSession();
    const child = (src.flatten() as any[]).find(
      (n) => !n.isEntry && n.parent && typeof n.parent.execRemoveChild === 'function',
    );
    const parent = child.parent;
    const before = parent.children.length;
    s.setActive(src, child);

    s.deleteNode();
    s.undo();
    s.redo();

    expect(parent.children.length).toBe(before - 1);
    expect(s.findNodeById(child.id)).toBeNull();
    // Selection lands on the surviving parent, not the node just removed.
    expect(s.getEntryNode()).toBe(parent);
  });

  it('takes a deleted entry’s descendants out of the index too, and puts them back', () => {
    // A removed entry takes its whole subtree out of the tree, so the index has to
    // lose and regain the children as well — not just the entry itself.
    const { s, src } = loadedSession();
    const entry = (src.flatten() as any[]).find((n) => n.isEntry && n.children.length > 0);
    const child = entry.children[0];
    expect(s.findNodeById(child.id)).toBe(child);

    s.setActive(src, entry);
    s.deleteNode();
    expect(s.findNodeById(child.id)).toBeNull();

    s.undo();
    expect(s.findNodeById(child.id)).toBe(child);

    s.redo();
    expect(s.findNodeById(child.id)).toBeNull();
  });
});
