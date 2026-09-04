// Copyright 2026 The MathWorks, Inc.
//
// The tree shape: does every container expand into exactly the elements MATLAB
// says it has, labelled with MATLAB's own subscripts, each holding MATLAB's value
// for THAT subscript? The label->value mapping is the assertion that catches a
// transpose, which a count-only check cannot see.
//
// Element values come from truth's `linearElems`, which measures each element the
// same way an entry is measured — so an element goes through the SAME
// expectedDisplay() as an entry, and a cell element that is itself a cell gets the
// same honest "MATLAB has no spelling" answer.
//
// NOT `linearValues`: that is formattedDisplayText, MATLAB's command-window
// format, which prints `1` for a logical, `1.0000 + 2.0000i` for a complex and
// `3     4` for [3 4]. A table cell follows mat2str. Both are MATLAB's output;
// only one is the convention the cell claims to match.
import { describe, it, expect } from 'vitest';
import {
  truth, loadArtifact, hasArtifact, entry, elementsByLabel, verdict, refused,
  ARTIFACT_KINDS, type Artifact, type VarTruth,
} from './loadTruth.js';
import { expectedDisplay, literalMatches } from './expect.js';

const T = truth();
const ALL: Record<string, VarTruth> = { ...T.vars, ...T.objArr };

/** Every entry MATLAB gave per-element truth for: 1 < numel <= 64, and not char. */
const CONTAINERS = Object.entries(ALL).filter(
  ([, v]) => v.linearElems !== undefined && v.linearElems.length > 1,
);

for (const fmt of ARTIFACT_KINDS) {
  describe('structure parity — ' + fmt, () => {
    if (!hasArtifact(fmt)) {
      it.skip('artifact not generated — run gen_truth.m', () => {});
      return;
    }
    const root = loadArtifact(fmt);

    for (const [name, v] of CONTAINERS) {
      if (refused(T, fmt as Artifact, name)) {
        it.skip(name + ' — MATLAB refused: ' + verdict(T, fmt as Artifact, name), () => {});
        continue;
      }

      it(name + ' expands into MATLAB-labelled elements holding MATLAB values', () => {
        const node = entry(root, name);
        expect(node.children.length, name + ' child count').toBe(v.numel);
        const byLabel = elementsByLabel(node);
        for (let k = 0; k < v.linearElems!.length; k++) {
          // Cross-check our independently computed label against MATLAB's own, so a
          // bug in subLabelFor cannot hide one in the data model.
          const label = subLabelFor(name, k, v.size, v.class === 'cell');
          expect(label, 'subLabelFor disagrees with MATLAB').toBe(v.linearSubs![k]);
          const child = byLabel.get(label);
          expect(child, 'no element row labelled ' + label).toBeTruthy();
          const e = v.linearElems![k];
          const want = expectedDisplay(e);
          // A cell inside a cell: MATLAB has no one-line spelling for it either, and
          // its own elements are checked when the child row is expanded. Nothing to
          // assert here rather than something invented.
          if (want === null) { continue; }
          expect(
            literalMatches(child.displayValue, e),
            label + ': MATLAB ' + JSON.stringify(want) +
              ', model ' + JSON.stringify(child.displayValue),
          ).toBe(true);
        }
      });

      // Labels alone do not pin the ORDER the rows appear in. MATLAB linearizes
      // column-major, so that is the order its own element list is in, and the order
      // every consumer that walks `children` will show.
      //
      // A numeric MATRIX is the one kind that does not: its child rows come out in
      // `_elements` storage order, which the parsers make row-major-within-page, so
      // a 2x3 lists (1,1) (1,2) (1,3) (2,1) (2,2) (2,3). Cell, string, struct and
      // object arrays are all column-major. The labels and values are right either
      // way — this is the order the ROWS appear in. Recorded as DESIGN.md defect 36
      // and asserted EXACTLY, in both directions, so the day it is fixed this test
      // goes red and gets moved to the other arm rather than quietly agreeing.
      if (listsInStorageOrder(v)) {
        it(name + ' lists elements in storage order, not MATLAB\'s — defect 36', () => {
          const node = entry(root, name);
          expect(node.children.map((c: { displayName: string }) => c.displayName))
            .toEqual(storageOrderLabels(v));
        });
      } else {
        it(name + ' lists its elements in MATLAB linear order', () => {
          const node = entry(root, name);
          expect(node.children.map((c: { displayName: string }) => c.displayName))
            .toEqual(v.linearSubs);
        });
      }
    }
  });
}

/** MATLAB's size() with trailing singletons dropped, never below rank 2. */
function dimsOf(size: number[]): number[] {
  const d = size.slice();
  while (d.length > 2 && d[d.length - 1] === 1) { d.pop(); }
  while (d.length < 2) { d.push(1); }
  return d;
}

/**
 * True for the one kind whose child rows are NOT in MATLAB's linear order: a
 * numeric (or logical, or complex) MATRIX. Derived from MATLAB's own class and
 * size, not a list of entry names, so a new fixture is classified automatically.
 * A vector is excluded because there the two orders coincide.
 */
function listsInStorageOrder(v: VarTruth): boolean {
  if (v.class === 'cell' || v.class === 'struct' || v.class === 'string' || v.isobject) {
    return false;
  }
  const d = dimsOf(v.size);
  return d[0] > 1 && d[1] > 1;
}

/**
 * The order the data model actually lists numeric elements in: storage order,
 * row-major within each page. Element i of that list is MATLAB's element at
 * column-major index (page-preserving transpose of i) — so this is MATLAB's own
 * label list, permuted by the transpose the parsers apply on the way in.
 */
function storageOrderLabels(v: VarTruth): string[] {
  const d = dimsOf(v.size);
  const [rows, cols] = d;
  const page = rows * cols;
  return v.linearSubs!.map((_, i) => {
    const p = Math.floor(i / page);
    const within = i % page;
    const r = Math.floor(within / cols);
    const c = within % cols;
    return v.linearSubs![p * page + c * rows + r];
  });
}

/**
 * MATLAB's subscript label for linear index k — ind2sub, spelled out. Written
 * here rather than imported from src/ for the same reason expect.ts is: an
 * independent statement of the rule.
 */
function subLabelFor(name: string, k: number, size: number[], isCell: boolean): string {
  const d = size.slice();
  while (d.length > 2 && d[d.length - 1] === 1) { d.pop(); }
  const [open, close] = isCell ? ['{', '}'] : ['(', ')'];
  // One spread dimension or fewer: MATLAB indexes it linearly, v(4), not v(1,4).
  if (d.filter((n) => n > 1).length <= 1) {
    return name + open + (k + 1) + close;
  }
  const subs: number[] = [];
  let rest = k;
  for (let i = 0; i < d.length; i++) {
    subs.push((rest % d[i]) + 1);
    rest = Math.floor(rest / d[i]);
  }
  return name + open + subs.join(',') + close;
}
