// Copyright 2026 The MathWorks, Inc.
//
// mutateSubtree(root, mutate) — the bookkeeping a host gets when it edits nodes in
// place instead of calling editProperty/addChildTo/deleteNodeById.
//
// What is under test is the NODE INDEX, not the mutation: every case here mutates the
// tree the same way a host with its own undo stack does (setProperty / addChildNode /
// removeChildNode, called straight on the node) and then asks findNodeById the question
// that host asks a moment later, when the row it just painted comes back as an edit.
//
// The rename cases are the reason this exists. A node id is a PATH (BaseNode.id walks
// parents), so renaming one node rekeys it AND everything under it — which is exactly
// the case a per-node index patch gets wrong.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function loadFixture(name: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

function session() {
  const s = createSession();
  const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
  return { s, src };
}

// arch.sldd's DataInterface bus: children keyed by NAME, so a removed element's id
// belongs to nothing afterwards. numeric_json's array elements are keyed by POSITION
// instead, which is a different (and also tested) shape of the same question.
function busSession() {
  const s = createSession();
  const src = s.addDataSource('arch.sldd', loadFixture('arch.sldd')) as any;
  const bus = (src.flatten() as any[]).find((n) => n.name === 'DataInterface');
  if (!bus) throw new Error('no DataInterface bus in arch.sldd');
  return { s, src, bus };
}

const entryNamed = (src: any, name: string) =>
  (src.flatten() as any[]).find((n) => n.isEntry && n.name === name);
// An entry that HAS children, so a rename has descendants to rekey.
const parentEntry = (src: any) => (src.flatten() as any[]).find((n) => n.isEntry && n.children.length > 0);
const addable = (src: any) => (src.flatten() as any[]).find((n) => typeof n.addChildNode === 'function' && n.canAddChild?.());

describe('mutateSubtree — rename', () => {
  it('rekeys the renamed node: findable at its new id, gone from the old one', () => {
    const { s, src } = session();
    const entry = entryNamed(src, 'Array');
    const oldId = entry.id;

    s.mutateSubtree(entry, () => entry.setProperty('Name', 'Renamed'));

    expect(entry.id).not.toBe(oldId);
    expect(s.findNodeById(entry.id)).toBe(entry);
    // The half that matters most: a stale id must not keep resolving, or an edit
    // routed at it lands on whatever node has since taken that path.
    expect(s.findNodeById(oldId)).toBeNull();
  });

  it('rekeys the DESCENDANTS of the renamed node too', () => {
    // The whole reason the repair is subtree-wide. `id` is the parent chain plus the
    // name, so renaming a parent silently changes every id beneath it — none of which
    // the mutation itself touched.
    const { s, src } = session();
    const entry = parentEntry(src);
    expect(entry).toBeTruthy();
    const child = entry.children[0];
    const oldChildId = child.id;

    s.mutateSubtree(entry, () => entry.setProperty('Name', 'RenamedParent'));

    expect(child.id).not.toBe(oldChildId);
    expect(s.findNodeById(child.id)).toBe(child);
    expect(s.findNodeById(oldChildId)).toBeNull();
  });

  it('leaves the rest of the document indexed exactly as it was', () => {
    // Scope: the subtree, and nothing else. A repair that over-reached (clear the
    // index, re-index the source) would also work for the assertions above.
    const { s, src } = session();
    const entry = entryNamed(src, 'Array');
    const other = entryNamed(src, 'Array1');
    const otherId = other.id;

    s.mutateSubtree(entry, () => entry.setProperty('Name', 'Renamed'));

    expect(s.findNodeById(otherId)).toBe(other);
  });

  it('keeps the selection: the nodes are the same nodes', () => {
    const { s, src } = session();
    const entry = parentEntry(src);
    s.setActiveEntry(entry.children[0]);

    s.mutateSubtree(entry, () => entry.setProperty('Name', 'RenamedParent'));

    expect(s.getEntryNodes()).toEqual([entry.children[0]]);
  });
});

describe('mutateSubtree — add and remove', () => {
  it('indexes a child added in place', () => {
    const { s, src } = session();
    const parent = addable(src);
    expect(parent).toBeTruthy();
    const owner = parent.isEntry ? parent : parent.parent;

    const child = s.mutateSubtree(owner, () => parent.addChildNode());

    expect(child).toBeTruthy();
    expect(s.findNodeById(child.id)).toBe(child);
  });

  it('deindexes a child removed in place', () => {
    const { s, bus } = busSession();
    const element = bus.children[0];
    const elementId = element.id;
    expect(s.findNodeById(elementId)).toBe(element);

    s.mutateSubtree(bus, () => bus.removeChildNode(element));

    // Worse than unfindable if this fails: the index would keep handing out a
    // detached node, and an edit routed there mutates an orphan.
    expect(s.findNodeById(elementId)).toBeNull();
  });

  it('stops handing out a removed POSITIONAL child, whose id a sibling inherits', () => {
    // An array element's id is its index, so removing the first one renumbers the rest
    // and that id resolves again immediately — to a different node. What has to hold is
    // the thing the index is for: no id resolves to the node that left the tree.
    const { s, src } = session();
    const entry = parentEntry(src);
    const child = entry.children[0];
    const childId = child.id;

    s.mutateSubtree(entry, () => entry.removeChildNode(child));

    expect(s.findNodeById(childId)).not.toBe(child);
    expect(entry.flatten()).not.toContain(child);
  });

  it('releases a selection pointing at a node it removed', () => {
    const { s, bus } = busSession();
    const element = bus.children[0];
    s.setActiveEntry(element);

    s.mutateSubtree(bus, () => bus.removeChildNode(element));

    expect(s.getEntryNodes()).toEqual([]);
  });
});

describe('mutateSubtree — contract', () => {
  it('returns what the mutation returned', () => {
    // The host reads setProperty's result to tell a rejected edit from an applied one,
    // so the wrapper has to be transparent.
    const { s, src } = session();
    const entry = entryNamed(src, 'Array');
    const result = s.mutateSubtree(entry, () => entry.setProperty('Name', ''));
    expect(result).toEqual(entry.setProperty('Name', ''));
  });

  it('repairs the index even when the mutation throws', () => {
    // A mutation that renames and then fails leaves the tree in the renamed state, so
    // the index has to describe the tree as it now STANDS, not as the caller hoped.
    const { s, src } = session();
    const entry = entryNamed(src, 'Array');
    const oldId = entry.id;

    expect(() =>
      s.mutateSubtree(entry, () => {
        entry.setProperty('Name', 'Renamed');
        throw new Error('half-way');
      }),
    ).toThrow('half-way');

    expect(s.findNodeById(oldId)).toBeNull();
    expect(s.findNodeById(entry.id)).toBe(entry);
  });
});
