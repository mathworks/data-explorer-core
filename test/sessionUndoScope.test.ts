// Copyright 2026 The MathWorks, Inc.
//
// An edit is undone in the document it changed, whatever document the selection's context is.
//
// A host may hold the context on one open file and the entry it edits in another (setActive(a,
// node of b)). editProperty, the retype of a MAT-file variable, addChild and deleteNode filed
// their undo step under the context's file: undo in the file that changed did nothing, and undo in
// the other replayed a change it never made. Each files it under the edited node's own document
// now (editableOwnerOf), as the explicit forms (addChildTo, deleteNodeById) always did; and a
// selection spanning two files is not deleted as one step, as deleteNodesById refuses one.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { CLASS, matFile, numericVar } from './tools/matBytes.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const dictionary = (): Record<string, unknown> => JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/numeric_json.sldd', import.meta.url)), 'utf8'));
const scalar = (name: string, value: number) => numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, 1], real: [value] });

/** Two open files: `a`, which holds the context, and `b`, whose node is edited. */
function twoFiles(b: 'sldd' | 'mat' = 'sldd') {
  const session = createSession();
  const a: any = session.addDataSource('a.sldd', dictionary());
  const other: any = b === 'mat' ? session.addMatSource('b.mat', matFile([scalar('x', 1), scalar('y', 2)])) : session.addDataSource('b.sldd', dictionary());
  const entry = (root: any, name: string): any => root.flatten().find((n: any) => n.isEntry && n.name === name);
  /** What can be undone in `root`, asked as a host asks: with the context on it. */
  const undoable = (root: any) => {
    const context = session.getContextNode();
    session.setActiveContext(root);
    const can = session.canUndo();
    session.setActiveContext(context as any);
    return can;
  };
  const undoIn = (root: any) => {
    session.setActiveContext(root);
    session.undo();
  };
  return { session, a, b: other, entry, undoable, undoIn };
}

describe('an edit of a node of one file under the context of another', () => {
  it("is undone in the node's file, and is nothing to undo in the other", () => {
    const { session, a, b, entry, undoable, undoIn } = twoFiles();
    const number = entry(b, 'Number');
    const was = number.displayValue;
    session.setActive(a, number);
    expect(session.editProperty(number.id, 'Value', '42')).toBe(true);
    expect([undoable(a), undoable(b)]).toEqual([false, true]);
    undoIn(b);
    expect(number.displayValue).toBe(was);
  });

  it("a MAT-file variable retyped, is undone in the MAT-file", () => {
    const { session, a, b, undoable, undoIn } = twoFiles('mat');
    const y = b.children.find((c: any) => c.name === 'y');
    session.setActive(a, y);
    expect(session.editProperty(y.id, 'Value', '"abc"')).toBe(true);
    expect([undoable(a), undoable(b)]).toEqual([false, true]);
    undoIn(b);
    expect([b.children[1], b.children[1].className]).toEqual([y, 'double']);
  });

  it('a child added, is undone in the parent\'s file', () => {
    const { session, a, b, undoable, undoIn } = twoFiles();
    const parent = b.flatten().find((n: any) => typeof n.execAddChild === 'function' && n.canAddChild?.());
    const before = parent.children.length;
    session.setActive(a, parent);
    expect(session.addChild()).toBeTruthy();
    expect([undoable(a), undoable(b)]).toEqual([false, true]);
    undoIn(b);
    expect(parent.children.length).toBe(before);
  });

  it("an entry deleted, is undone in the entry's file", () => {
    const { session, a, b, entry, undoable, undoIn } = twoFiles();
    const number = entry(b, 'Number');
    session.setActive(a, number);
    expect(session.deleteNode()).toBe(true);
    expect([undoable(a), undoable(b)]).toEqual([false, true]);
    undoIn(b);
    expect(entry(b, 'Number')).toBe(number);
  });

  it('entries of two files selected are not deleted as one step', () => {
    const { session, a, b, entry, undoable } = twoFiles();
    const inA = entry(a, 'Number');
    const inB = entry(b, 'Number');
    session.setActive(a, [inA, inB]);
    expect(session.deleteNode()).toBe(false);
    expect([entry(a, 'Number'), entry(b, 'Number'), undoable(a), undoable(b)]).toEqual([inA, inB, false, false]);
  });
});
