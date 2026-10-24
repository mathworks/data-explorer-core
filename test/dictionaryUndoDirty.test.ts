// Copyright 2026 The MathWorks, Inc.
//
// The undo and the redo of an entry added to a dictionary, or deleted from it, leave the dictionary
// dirty, as the add and the delete do: each changes what a save writes. Their undo and redo only
// put the entry back or took it out again (SectionNode.execAddEntry, execRemoveEntry), so a
// dictionary saved after the add and then undone said it held nothing to save. A MAT-file's
// (MatNode) has always marked its file dirty.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const dictionary = (): Record<string, unknown> => JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/numeric_json.sldd', import.meta.url)), 'utf8'));

function opened() {
  const session = createSession();
  const root: any = session.addDataSource('d.sldd', dictionary());
  session.setActiveContext(root);
  /** The dictionary's dirty flag after `step`, the flag cleared before it as a save clears it. */
  const dirtyAfter = (step: () => void) => {
    root.dirty = false;
    step();
    return root.dirty;
  };
  return { session, root, dirtyAfter };
}

describe('a dictionary entry added, or deleted, undone and redone', () => {
  it('an add, its undo and its redo each leave the dictionary dirty', () => {
    const { session, dirtyAfter } = opened();
    expect(dirtyAfter(() => session.addEntry('design', 'Simulink.Parameter', 'P'))).toBe(true);
    expect(dirtyAfter(() => session.undo())).toBe(true);
    expect(dirtyAfter(() => session.redo())).toBe(true);
  });

  it('a delete, its undo and its redo each leave the dictionary dirty', () => {
    const { session, root, dirtyAfter } = opened();
    const entry = root.flatten().find((n: any) => n.isEntry);
    expect(dirtyAfter(() => session.deleteNodeById(entry.id))).toBe(true);
    expect(dirtyAfter(() => session.undo())).toBe(true);
    expect(dirtyAfter(() => session.redo())).toBe(true);
  });
});
