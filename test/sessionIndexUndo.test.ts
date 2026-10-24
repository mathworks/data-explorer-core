// Copyright 2026 The MathWorks, Inc.
//
// The node index follows every add and removal the session makes, and their undo and redo: each
// node of what joins the tree is found by its id, and none of what leaves it, from the moment the
// change is announced.
//
// An id is a node's path, so a node out of the tree answers a shorter one. The undo of an add
// deleted the id the node answered once detached, and left the one it was indexed under; and every
// removal, and the undo of one, (un)indexed the node alone, so whatever was under it stayed found
// while out of the tree. Only the announcement of the change (node/added, node/deleted,
// node/children-changed) rebuilt the index whole, and the selection's change is announced before
// it: a subscriber to active/changed was handed nodes no longer in the tree. The session now reads
// a leaving subtree's ids while it is in the tree, takes all of them out, indexes the whole of a
// subtree that joins, and only then moves the selection and announces the change.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const dictionary = (): Record<string, unknown> => JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/numeric_json.sldd', import.meta.url)), 'utf8'));

function opened() {
  const session = createSession();
  const root: any = session.addDataSource('n.sldd', dictionary());
  session.setActiveContext(root);
  const entry = (name: string): any => root.flatten().find((n: any) => n.isEntry && n.name === name);
  /** Each node of `node`'s subtree, by the id it answers in the tree now. */
  const subtree = (node: any): [string, any][] => node.flatten().map((n: any) => [n.id, n]);
  /** For each of `held`, whether the session finds its id as the node it was. */
  const found = (held: [string, any][]) => held.map(([id, n]) => session.findNodeById(id) === n);
  // What the index says of `held` at each announcement of a change.
  const atEvents: boolean[][] = [];
  let watching: [string, any][] = [];
  for (const topic of ['active/changed', 'node/added', 'node/deleted', 'node/children-changed'] as const) {
    session.bus.subscribe(topic, () => { if (watching.length > 0) atEvents.push(found(watching)); });
  }
  const watch = (held: [string, any][]) => { watching = held; atEvents.length = 0; };
  return { session, root, entry, subtree, found, watch, atEvents };
}

const all = (xs: boolean[], v: boolean) => xs.length > 0 && xs.every((x) => x === v);

describe('the index across an entry added, and its undo and redo', () => {
  it('finds the entry while it is in the tree, and not after its add is undone', () => {
    const o = opened();
    const added = o.session.addEntry('design', 'Simulink.Bus', 'B') as any;
    const held = o.subtree(added);
    expect(all(o.found(held), true)).toBe(true);
    o.watch(held);
    o.session.undo();
    expect([added.parent, o.found(held)]).toEqual([null, [false]]);
    expect(o.atEvents.every((f) => all(f, false))).toBe(true);
    o.watch(held);
    o.session.redo();
    expect(all(o.found(held), true)).toBe(true);
    expect(o.atEvents.every((f) => all(f, true))).toBe(true);
  });
});

describe('the index across a child added, and its undo and redo', () => {
  it('finds the child while it is in the tree, and not after its add is undone', () => {
    const o = opened();
    const struct = o.entry('Struct');
    const child = o.session.addChildTo(struct.id) as any;
    const held = o.subtree(child);
    expect(all(o.found(held), true)).toBe(true);
    o.watch(held);
    o.session.undo();
    expect([child.parent, all(o.found(held), false)]).toEqual([null, true]);
    expect(o.atEvents.every((f) => all(f, false))).toBe(true);
    o.session.redo();
    expect(all(o.found(held), true)).toBe(true);
  });
});

describe('the index across a removal, and its undo and redo', () => {
  const removals: [string, (o: ReturnType<typeof opened>) => any, (o: ReturnType<typeof opened>, node: any) => boolean][] = [
    ['an entry deleted by id', (o) => o.entry('NestedStruct'), (o, node) => o.session.deleteNodeById(node.id)],
    ['an entry deleted through the selection', (o) => (o.session.setActive(o.root, o.entry('NestedStruct')), o.entry('NestedStruct')), (o) => o.session.deleteNode()],
    ['entries deleted as one step', (o) => o.entry('NestedStruct'), (o, node) => o.session.deleteNodesById([node.id, o.entry('Struct').id])],
    ['a struct field holding a struct deleted', (o) => o.entry('NestedStruct').children[0], (o, node) => o.session.deleteNodeById(node.id)],
    // The selection in what leaves is released, and announced, as it goes.
    ['an entry deleted by id with a node under it selected', (o) => (o.session.setActive(o.root, o.entry('NestedStruct').children[0].children[0]), o.entry('NestedStruct')), (o, node) => o.session.deleteNodeById(node.id)],
    ['a struct field deleted by id with a node under it selected', (o) => (o.session.setActive(o.root, o.entry('NestedStruct').children[0].children[0]), o.entry('NestedStruct').children[0]), (o, node) => o.session.deleteNodeById(node.id)],
  ];
  for (const [what, pick, remove] of removals) {
    it(`${what}: finds none of what left, and all of it once the removal is undone`, () => {
      const o = opened();
      const node = pick(o);
      const held = o.subtree(node);
      expect(held.length).toBeGreaterThan(1);
      o.watch(held);
      expect(remove(o, node)).toBe(true);
      expect(all(o.found(held), false)).toBe(true);
      expect(o.atEvents.length).toBeGreaterThan(0);
      expect(o.atEvents.every((f) => all(f, false))).toBe(true);
      o.session.setActiveContext(o.root);
      o.watch(held);
      o.session.undo();
      expect(all(o.found(held), true)).toBe(true);
      expect(o.atEvents.every((f) => all(f, true))).toBe(true);
      o.watch(held);
      o.session.redo();
      expect(all(o.found(held), false)).toBe(true);
      expect(o.atEvents.every((f) => all(f, false))).toBe(true);
    });
  }
});

// A batch delete whose removal of one entry throws takes back the entries it had removed before
// the throw, and lets the throw through: it left them removed, with no step to undo them by.
describe('a batch delete that throws part-way', () => {
  it('leaves every entry where it was, records no step and announces nothing', () => {
    const o = opened();
    const first = o.entry('Struct');
    const second = o.entry('NestedStruct');
    const section = second.parent;
    const order = section.children.slice();
    const held = [...o.subtree(first), ...o.subtree(second)];
    const real = section.execRemoveEntry;
    let calls = 0;
    section.execRemoveEntry = function (this: any, node: any) {
      if (++calls === 2) {
        throw new Error('refused for the test');
      }
      return real.call(this, node);
    };
    const announced: string[] = [];
    for (const topic of ['node/deleted', 'node/added', 'undo/changed'] as const) {
      o.session.bus.subscribe(topic, () => { announced.push(topic); });
    }
    try {
      expect(() => o.session.deleteNodesById([first.id, second.id])).toThrow('refused for the test');
    } finally {
      section.execRemoveEntry = real;
    }
    expect(section.children.length === order.length && section.children.every((c: any, i: number) => c === order[i])).toBe(true);
    expect(all(o.found(held), true)).toBe(true);
    expect([o.session.canUndo(), announced]).toEqual([false, []]);
  });
});
