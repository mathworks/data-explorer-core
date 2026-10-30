// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/jsonStructuralNarrow.test.ts at c73da3c: its planner cases,
// planKnownOps recognising (or refusing) an undo or redo of a remembered structural edit (jsonEntrySync,
// as core copied it). What changed in setup: the ops a remembered edit carries are written as the
// literals entryOps' removeOp builds (`{ kind: 'remove', rowId }`), since entryOps' functions come to
// core in step 6a C3. The file's other cases make structural edits and apply their ops
// (applyEntryOps, removalPairs, opsOfPastedEntries) to compare view's rows, need C3 and view, and stay
// in vscode until then; its findEntryBySelector cases are entryOps' too (core's copy of that function
// is tested in dictionaryPasteRules.test.ts), and findEntryByName comes with C3.
//
// A structural edit's bytes do not say what it means (a delete writes back an element and its comma;
// a paste's undo writes back nothing), so the ops are remembered with it, and an undo or redo is
// recognised by the same byte-exact test as a cell edit's, against the same newest-first ring.
import { describe, it, expect } from 'vitest';
import { planKnownOps, type KnownEdit } from '../src/edit/jsonEntrySync.js';
import type { EntryOp } from '../src/edit/entryOps.js';

// What entryOps' removeOp(rowId) answers.
const removeOp = (rowId: string): EntryOp => ({ kind: 'remove', rowId });

describe('JSON .sldd structural edit — undo and redo, from the ops the host kept', () => {
  it('refuses a change that is neither direction of a remembered edit', () => {
    const known: KnownEdit = {
      submitted: { rangeOffset: 100, rangeLength: 0, text: 'inserted' },
      replaced: '',
      patch: { undo: [removeOp('a')], redo: [] },
    };
    // Right shape, wrong offset: the bytes in hand describe some other part of the file.
    expect(planKnownOps([{ rangeOffset: 101, rangeLength: 8, text: '' }], [known])).toBeNull();
    // A batch, whose later offsets are stated against the text before it.
    expect(
      planKnownOps(
        [
          { rangeOffset: 100, rangeLength: 0, text: 'inserted' },
          { rangeOffset: 400, rangeLength: 1, text: 'x' },
        ],
        [known],
      ),
    ).toBeNull();
    // An edit remembered WITHOUT ops says nothing this path can apply.
    const noOps: KnownEdit = { submitted: known.submitted, replaced: known.replaced };
    expect(planKnownOps([{ rangeOffset: 100, rangeLength: 8, text: '' }], [noOps])).toBeNull();
  });

  it('recognises the older of two remembered edits, and answers with ITS ops', () => {
    const first: KnownEdit = {
      submitted: { rangeOffset: 10, rangeLength: 0, text: 'AAAA' },
      replaced: '',
      patch: { undo: [removeOp('first')], redo: [] },
    };
    const second: KnownEdit = {
      submitted: { rangeOffset: 90, rangeLength: 0, text: 'BBBB' },
      replaced: '',
      patch: { undo: [removeOp('second')], redo: [] },
    };
    const ops = planKnownOps([{ rangeOffset: 10, rangeLength: 4, text: '' }], [first, second]);
    expect(ops).toEqual([removeOp('first')]);
  });
});
