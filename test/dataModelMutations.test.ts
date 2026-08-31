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
});
