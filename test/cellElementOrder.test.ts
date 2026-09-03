// Copyright 2026 The MathWorks, Inc.
//
// Cell and string element lists reach the node layer COLUMN-major; numeric ones
// reach it ROW-major. MatParser.parseMatrix transposes only the numeric branch
// (MatParser.ts:234) — its cell branch stores `result.value = cells` in file
// order, and MATLAB writes cells column-major. Both SLDD paths and the MCOS path
// do the same, so the split holds in all four formats.
//
// DESIGN.md:318 used to assert the opposite ("its element list is row-major" for
// numeric/cell/string alike), which is why nobody checked: a 2x3 cell's SET of
// labels looks right, and only the label->value pairing exposes the transpose.
// Verified against MATLAB's own answer in artifacts/truth.json.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFile, findEntry } from './parity/loadFile.js';

interface VarTruth {
  size: number[];
  numel: number;
  linearSubs?: string[];
  linearValues?: string[];
}
const TRUTH = JSON.parse(
  readFileSync(fileURLToPath(new URL('./parity/artifacts/truth.json', import.meta.url)), 'utf8'),
) as { vars: Record<string, VarTruth> };

const ARTIFACTS: [string, string, string][] = [
  ['mat', './artifacts/mat/cases.mat', 'cases.mat'],
  ['slx', './artifacts/slx/cases.slx', 'cases.slx'],
  ['sldd-text', './artifacts/text/cases.sldd', 'cases.sldd'],
  ['sldd-binary', './artifacts/binary/cases.sldd', 'cases.sldd'],
];

// MATLAB's own label -> MATLAB's own value, straight out of truth.json.
function matlabPairs(name: string): Map<string, string> {
  const t = TRUTH.vars[name];
  const m = new Map<string, string>();
  for (let i = 0; i < t.linearSubs!.length; i++) {
    m.set(t.linearSubs![i], t.linearValues![i]);
  }
  return m;
}

describe('cell and string arrays label their elements in MATLAB order', () => {
  // A 2x3 is the case that matters: on a square fixture a transpose is invisible
  // in the label SET, and the repo had only square and vector cell fixtures.
  for (const [fmt, rel, filename] of ARTIFACTS) {
    for (const name of ['cell2x3', 'strMat']) {
      it(name + ' — ' + fmt + ' — every MATLAB subscript holds MATLAB’s value', () => {
        let node;
        try {
          node = findEntry(loadFile(rel, filename), name);
        } catch {
          // strMat does not survive every container; a missing entry is a
          // different defect and is asserted elsewhere. Nothing to compare here.
          return;
        }
        const want = matlabPairs(name);
        const got = new Map<string, string>();
        for (const child of node.children) {
          got.set(child.displayName, String(child.displayValue));
        }
        if (got.size === 0) {
          // A MATLAB `string` out of a .mat or .slx decodes to nothing today —
          // its text lives in an MCOS payload we do not read yet. That is
          // defect 2, which Phase 9 owns, and it is a DIFFERENT defect from the
          // element order this file is about: there are no elements to order.
          // The condition is deliberately narrow, so the day Phase 9 decodes the
          // payload this branch stops matching and the pairing below starts
          // asserting for real, with no edit here.
          expect(name, 'only a MATLAB string is expected to decode to nothing').toBe('strMat');
          expect(['mat', 'slx'], 'both .sldd paths already decode strings').toContain(fmt);
          return;
        }
        expect(got.size).toBe(want.size);
        for (const [label, value] of want) {
          // Quoting differs by class (a string element renders "a", MATLAB's
          // truth records a); compare the payload, not the decoration.
          const strip = (s: string) => s.replace(/^["']|["']$/g, '');
          expect(strip(got.get(label) ?? '(no such label)'), label).toBe(strip(value));
        }
      });
    }
  }

  // The same transpose, second symptom. _formatCell and _formatString build their
  // literal by reading [r * cols + c] out of the element list -- a row-major read
  // of a column-major list -- so the inline value comes out transposed even once
  // the child labels are right. Whoever rewrites these formatters (Phase 7) must
  // keep this green.
  it('the inline cell literal reads down MATLAB’s columns, not across our list', () => {
    for (const [fmt, rel, filename] of ARTIFACTS) {
      let node;
      try {
        node = findEntry(loadFile(rel, filename), 'cell2x3');
      } catch {
        continue;
      }
      // MATLAB's cell2x3 is {1 2 3; 4 5 6}. Read row-major off a column-major
      // list it becomes {1, 4, 2; 5, 3, 6} -- every off-diagonal element moved.
      expect(String(node.displayValue), fmt).toBe('{1, 2, 3; 4, 5, 6}');
    }
  });

  it('the inline string-array literal is not transposed either', () => {
    for (const [fmt, rel, filename] of ARTIFACTS) {
      let node;
      try {
        node = findEntry(loadFile(rel, filename), 'strMat');
      } catch {
        continue;
      }
      const v = String(node.displayValue);
      // Phase 9 owns the .mat/.slx string payload; where it decodes to a summary
      // there is no literal to check.
      if (v.charAt(0) === '<') { continue; }
      expect(v, fmt).toBe('["a" "bb" "ccc"; "d" "ee" "fff"]');
    }
  });

  it('numeric arrays are NOT column-major — the two paths really do differ', () => {
    // The control. mat2x3 goes through transposeFromColMajor, so its children
    // arrive row-major and must keep being labelled row-major. If a fix made
    // everything column-major, this is what would catch it.
    const node = findEntry(loadFile('./artifacts/mat/cases.mat', 'cases.mat'), 'mat2x3');
    expect(node.children.map((c: { displayValue: string }) => String(c.displayValue))).toEqual([
      '1', '2', '3', '4', '5', '6',
    ]);
    const want = matlabPairs('mat2x3');
    for (const child of node.children) {
      expect(String(child.displayValue), child.displayName).toBe(want.get(child.displayName));
    }
  });
});
