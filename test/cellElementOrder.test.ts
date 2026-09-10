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
//
// TWO blocks below, one per path. The first is the read path (defect 14). The second is
// the EDIT path (defect 50), which had the identical transpose and stayed green through
// all of the first — see its own header for why, and for why it is the second block of
// this file rather than a file of its own.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFile, findEntry } from './parity/loadFile.js';
import MatlabValueParser from '../src/datamodel/parser/MatlabValueParser.js';
import {
  loadModel,
  entryByName,
  serializeModel,
  reparseEntry,
  type SlddFormat,
} from './parity/fidelity/roundTripHarness.js';

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

// Defect 50 — everything above is the READ path, and the WRITE path disagreed with it.
//
// `MatlabValueParser` built the element list of a cell and of a string array ROW-major,
// so committing a multi-row one TRANSPOSED it: `{1 2 3; 4 5 6}` came back
// `{1, 4, 2; 5, 3, 6}`, and `saveChanges` wrote that. Retyping the displayed text
// transposed it again, so the value never settled. MATLAB's own file agrees with the
// readers rather than with the parser — `probe_cell_shapes.m` measures `{1 2; 3 4}` as
// `"_elements": [1, 3, 2, 4]`.
//
// This is the same bug as the one the header describes, on the other path, and it stayed
// green through the whole of the read-path fix — because that fix pinned the READ path's
// answer rather than the invariant BETWEEN the two paths. That is what this block does
// instead:
// it never states an order of its own. It retypes each fixture's OWN displayed text and
// demands MATLAB's subscript->value pairs back, so the read path is the write path's
// expected answer and neither can drift without a failure here.
//
// It hid for as long as it did because a 1xN and an Nx1 flatten to the same list either
// way, and every editable cell fixture in the corpus is a vector.
describe('defect 50: the edit path stores its elements in the same order the readers do', () => {
  let seq = 0;

  /** Retype `name`'s own displayed text, then report the pairs, before and after a save. */
  function retypeOwnText(format: SlddFormat, name: string) {
    // A fresh uri per edit: the uri is the model's key, so a repeated one edits the
    // PREVIOUS edit's node instead of a fresh copy of the fixture.
    const uri = `test://order-${format}-${seq++}.sldd`;
    const model = loadModel(format, 'cases.sldd', uri);
    const node = entryByName(model, uri, name);
    const text = String(node.displayValue);
    expect(node.setProperty('Value', text), `${name} must accept its own displayed text`).toBe(true);
    const fresh = reparseEntry(serializeModel(model, format), format, 'cases.sldd', name);
    const pairs = (n: { children: { displayName: string; displayValue: unknown }[] }) => {
      const m = new Map<string, string>();
      for (const child of n.children) {
        m.set(child.displayName, String(child.displayValue).replace(/^["']|["']$/g, ''));
      }
      return m;
    };
    return { text, display: String(node.displayValue), edited: pairs(node), saved: pairs(fresh) };
  }

  for (const format of ['json', 'binary'] as SlddFormat[]) {
    // cell2x3 and strMat are the only non-square, non-vector fixtures of their kinds:
    // on a square one a transpose moves the off-diagonal elements only, and on a vector
    // it moves nothing at all. mat2x3 is the control — it must stay row-major.
    for (const name of ['cell2x3', 'strMat', 'mat2x3']) {
      it(`${name} — ${format} — every MATLAB subscript still holds MATLAB's value`, () => {
        const want = matlabPairs(name);
        const { text, display, edited, saved } = retypeOwnText(format, name);

        // The literal itself is unchanged, which is the symptom a user sees: what the
        // table shows has to be text that means what the table shows.
        expect(display, `${name} display after retyping ${text}`).toBe(text);

        expect(edited.size).toBe(want.size);
        for (const [label, value] of want) {
          expect(edited.get(label) ?? '(no such label)', `edited ${label}`).toBe(value);
          expect(saved.get(label) ?? '(no such label)', `saved ${label}`).toBe(value);
        }
      });
    }
  }

  // The rule at the unit level, with no fixture in the way, so a failure points at the
  // parser rather than at a container. `flatten(matrix, cols, order)` is the one place
  // that decides this, and these are its two orders.
  it('the parser flattens a cell and a string array down the COLUMNS', () => {
    expect(MatlabValueParser.parse('{1, 2, 3; 4, 5, 6}')).toEqual({
      type: 'cell', value: [1, 4, 2, 5, 3, 6], dims: [2, 3],
    });
    expect(MatlabValueParser.parse('["a" "b" "c"; "d" "e" "f"]')).toEqual({
      type: 'string-array', value: ['a', 'd', 'b', 'e', 'c', 'f'], dims: [2, 3],
    });
    // A char matrix already did this, one value type away and from the start —
    // charFromRows stores 'ab';'cd' as the column-major 'acbd'.
    expect(MatlabValueParser.parse("['ab'; 'cd']")).toEqual({
      type: 'char', value: 'acbd', dims: [2, 2],
    });
  });

  it('and a NUMERIC array across the rows, which is the difference', () => {
    // Not an inconsistency: formatMatrixSerial re-transposes the numeric list on the
    // way out, so row-major is what the numeric writer is owed. Making everything
    // column-major "for consistency" is the mistake this test exists to catch.
    expect(MatlabValueParser.parse('[1 2 3; 4 5 6]')).toEqual({
      type: 'double', value: [1, 2, 3, 4, 5, 6], dims: [2, 3],
    });
    expect(MatlabValueParser.parse('[true false; false true]')).toEqual({
      type: 'logical', value: [1, 0, 0, 1], dims: [2, 2],
    });
  });

  it('a vector is the same list in either order, which is why this hid', () => {
    for (const literal of ['{1, 2, 3}', '{1; 2; 3}']) {
      expect(MatlabValueParser.parse(literal)!.value, literal).toEqual([1, 2, 3]);
    }
    expect(MatlabValueParser.parse('["a" "b"]')!.value).toEqual(['a', 'b']);
    expect(MatlabValueParser.parse('["a"; "b"]')!.value).toEqual(['a', 'b']);
  });
});
