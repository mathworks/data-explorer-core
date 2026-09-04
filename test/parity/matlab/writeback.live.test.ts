// Copyright 2026 The MathWorks, Inc.
//
// Edit -> serialize -> MATLAB reopens it -> MATLAB agrees. This is the only tier that can
// prove a write is CORRECT, because a value we write wrongly and then read back with the
// same wrong assumption looks fine from inside. Every other tier in this suite reads a
// file MATLAB authored; this one asks MATLAB to read a file WE authored.
//
// That asymmetry is not theoretical. Defect 42 was found here: the reader had been carrying
// a 64-bit integer exactly since defect 29, and the display was right, and the in-process
// round trip was green — and typing back the very digits the cell showed still stored
// 18446744073709552000, because the EDIT path put the literal through a double. Nothing
// short of MATLAB reopening the file could say so.
//
// One case per thing a write can get wrong, not one per data type. The value classes below
// are the ones whose write path this project changed: the exact 64-bit integers (defects
// 29/30/42), shape (defect 25 and Phase 6), element order (Phase 11), and the non-finites.
//
// Skipped wholesale when DEX_MATLAB_CMD is unset, so CI and external contributors stay
// green. Set it to the launcher plus its fixed args, e.g.
//   env DEX_MATLAB_CMD="mw -using Bmain matlab" npx vitest run test/parity/matlab/writeback.live.test.ts
import { describe, it, expect } from 'vitest';
import {
  loadModel,
  entryByName,
  serializeModel,
  reparseEntry,
  matlabAvailable,
  matlabAssertRoundTrip,
} from '../fidelity/roundTripHarness.js';

// `__value__` + `__size__` + `__class__` pin a value completely; see verify_roundtrip.m for
// why that takes three keys and not one (isequal ignores class, and JSON has no
// row-vs-column, no 64-bit integer and no Inf).
const CASES: Array<{ entry: string; set: string; expect: Record<string, unknown>; why: string }> = [
  {
    entry: 'kp',
    set: '42',
    expect: { __value__: 42, __class__: 'double' },
    why: 'the baseline: a scalar double, so a failure anywhere else is not the harness',
  },
  {
    entry: 'maxU64',
    // A string, because JSON cannot carry this exactly either — the same limit that caused
    // defect 1, now inside the gate meant to catch it.
    set: '18446744073709551615',
    expect: { __value__: '18446744073709551615', __class__: 'uint64' },
    why: 'defect 42: intmax(uint64) typed back into its own cell',
  },
  {
    entry: 'i64Unsafe',
    set: '9007199254740993',
    expect: { __value__: '9007199254740993', __class__: 'int64' },
    why: 'defect 42: 2^53 + 1 — inside int64, outside a double, and signed',
  },
  {
    entry: 'u64Vec',
    set: '[18446744073709551615 2 3]',
    expect: { __value__: '[18446744073709551615 2 3]', __size__: [1, 3], __class__: 'uint64' },
    why: 'defect 42 in an ARRAY, where an out-of-range token also destroyed its neighbours',
  },
  {
    entry: 'rowVec',
    set: '[7 8 9]',
    expect: { __value__: [7, 8, 9], __size__: [1, 3], __class__: 'double' },
    why: 'a vector keeps its orientation: [7 8 9] must not come back 3x1',
  },
  {
    entry: 'colVec',
    set: '[7; 8; 9]',
    expect: { __value__: [7, 8, 9], __size__: [3, 1], __class__: 'double' },
    why: 'the other orientation, which the row case cannot distinguish on its own',
  },
  {
    entry: 'mat2x3',
    set: '[9 8 7; 6 5 4]',
    // __value__ is compared column-major, so a transposed write shows up here and not only
    // in __size__: this list is 9 6 8 5 7 4, and the transpose linearizes 9 8 7 6 5 4.
    expect: { __value__: [9, 6, 8, 5, 7, 4], __size__: [2, 3], __class__: 'double' },
    why: 'a matrix keeps its shape AND its element order',
  },
  {
    entry: 'nonFinVec',
    set: '[1 Inf -Inf NaN 5]',
    // mat2str's spelling, because Inf is not a JSON number and mixing it with numbers makes
    // jsondecode hand back a cell — so this is the only form in which it is assertable.
    expect: { __value__: '[1 Inf -Inf NaN 5]', __size__: [1, 5], __class__: 'double' },
    why: 'the non-finites, whose JavaScript spelling (Infinity) is not a MATLAB literal',
  },
  {
    entry: 'charStr',
    set: "'hello'",
    // Quoted, because that is what the cell shows and what the editor is seeded with. A bare
    // `hello` is correctly refused as an invalid MATLAB expression.
    expect: { __value__: 'hello', __size__: [1, 5], __class__: 'char' },
    why: 'text stays char and keeps its length',
  },
  {
    entry: 'boolVec',
    set: '[true false true]',
    expect: { __value__: [1, 0, 1], __size__: [1, 3], __class__: 'logical' },
    why: 'defect 43: mat2str\'s own logical spelling, typed back into its own cell',
  },
  {
    entry: 'boolVec',
    set: '[true true; false false]',
    // Column-major again: this list is 1 0 1 0, and the transpose linearizes 1 1 0 0.
    expect: { __value__: [1, 0, 1, 0], __size__: [2, 2], __class__: 'logical' },
    why: 'defect 44: a logical MATRIX keeps its shape, which the binary reader dropped',
  },
];

// Each case launches MATLAB, so every `it` below needs an explicit timeout: vitest's
// default is 5s and reports the whole tier as timeouts, which hides whatever MATLAB was
// about to say. Measured over a full run of this file, 24 launches took 516s — ~21s each
// in the steady state, and the FIRST launch of a session took over 65s, because a cold
// start pays for the licence checkout and MATLAB's own startup on top of the work. Hence
// 120s and not the 60s the other live suites use: they make one or two launches, this one
// makes two dozen, and only its first is slow.
const MATLAB_TIMEOUT = 120_000;

// Both flavours: the two writers spell a typed value independently, which is how defect 30
// survived the fix for defect 29.
for (const format of ['json', 'binary'] as const) {
  describe('live write-back — ' + format, () => {
    if (!matlabAvailable()) {
      it.skip('DEX_MATLAB_CMD unset — live gate skipped', () => {});
      return;
    }
    CASES.forEach((c, i) => {
      it(`MATLAB reads back our edit to ${c.entry} — ${c.why}`, { timeout: MATLAB_TIMEOUT }, () => {
        // The index keeps the uri unique: two cases edit the same entry (boolVec, as a
        // row and as a matrix), and DataModel keys its sources by uri.
        const uri = 'test://wb-' + format + '-' + i + '-' + c.entry + '.sldd';
        // loadModel resolves ../artifacts/{text|binary}/<fixture>, which is where Phase 2
        // wrote the corpus — hence the same 'cases.sldd' for both formats.
        const model = loadModel(format, 'cases.sldd', uri);
        const node = entryByName(model, uri, c.entry);
        expect(node.setProperty('Value', c.set), c.entry).toBe(true);
        const bytes = serializeModel(model, format);
        // In-process first: a failure here is ours, not MATLAB's, and says so.
        const reparsed = reparseEntry(bytes, format, 'cases.sldd', c.entry);
        expect(reparsed.displayValue, c.entry).toBeTruthy();
        // Then the gate that actually matters.
        const out = matlabAssertRoundTrip(bytes, c.entry, c.expect);
        expect(out).toMatch(/RESULT PASS/);
      });
    });

    // The element editor is its own write path (_setConstrainedValue), and the class it must
    // consult belongs to the CONTAINER — an element has none of its own. Kept separate
    // because the case is a different mutation, not a different value.
    it('MATLAB reads back an edit to one ELEMENT of a uint64 vector', { timeout: MATLAB_TIMEOUT }, () => {
      const uri = 'test://wb-el-' + format + '.sldd';
      const model = loadModel(format, 'cases.sldd', uri);
      const node = entryByName(model, uri, 'u64Vec');
      expect(node.children[1].setProperty('Value', '18446744073709551615')).toBe(true);
      const bytes = serializeModel(model, format);
      const out = matlabAssertRoundTrip(bytes, 'u64Vec', {
        __value__: '[18446744073709551615 18446744073709551615 0]',
        __size__: [1, 3],
        __class__: 'uint64',
      });
      expect(out).toMatch(/RESULT PASS/);
    });
  });
}
