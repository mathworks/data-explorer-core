// Copyright 2026 The MathWorks, Inc.
//
// One rule, two paths: the sparse array a node offers no editor for is the one the writer refuses.
//
// MatWriter.sparseWriteRefusal is asked of a sparse array before any edit of it is offered
// (MatlabVariableNode._sparseRefusal: its rows are read-only when it answers), and encodeSparse
// refuses the same arrays when a save writes one. The gate reads only the shape, the class and
// what backs the columns, never the non-zeros, so it can be asked of a node; the writer meets the
// same refusals on the way to the non-zeros. If the two came to disagree, an edit the editor took
// would be a save that throws, or a value the writer could write would show as read-only. So each
// case here is asked of both, and either both refuse it, in the same words where the refusal is
// not the budget's, or both write it.
//
// Then the refusals of a sparse array whose words a host could act on: one at the top of a write
// says "the value", the budget's columns are counted to the byte, and a non-zero at no row and
// column is refused before its shape is asked, as a refusal no other spelling may take.

import { describe, it, expect } from 'vitest';
import { encodeMatStream, MatBudgetError, MatWriteError, sparseWriteRefusal, UNBACKED_BYTES_BUDGET } from '../src/datamodel/parser/MatWriter.js';
import { decodeMatStream } from '../src/datamodel/parser/MatParser.js';
import type { MatVariable } from '../src/datamodel/parser/MatParser.js';
import type { SparseData } from '../src/datamodel/parser/SparseData.js';

interface NonZeros {
  row: number[];
  col: number[];
  re: number[];
  backedColumns?: number;
}

/** A sparse double as MatParser reads one: its non-zeros, and the columns its source backed. */
function sparse(dimensions: number[], s: NonZeros | null, extra: Partial<MatVariable> = {}): MatVariable {
  const data: SparseData | undefined = s ? { row: Int32Array.from(s.row), col: Int32Array.from(s.col), re: Float64Array.from(s.re), im: null, backedColumns: s.backedColumns } : undefined;
  return { name: '', className: 'double', dimensions, isComplex: false, isLogical: false, isSparse: true, value: null, fields: null, sparse: data, ...extra } as MatVariable;
}

/** One as a host may hand one in, its non-zeros plain numbers: a row of 0.5 is at no element. */
const hostSparse = (dimensions: number[], s: NonZeros, extra: Partial<MatVariable> = {}): MatVariable =>
  sparse(dimensions, null, { sparse: { im: null, ...s } as unknown as SparseData, ...extra });

/** What the writer says of `v`: null where it writes it, else its refusal. */
function writerRefusal(v: MatVariable): MatWriteError | null {
  try {
    encodeMatStream(v);
    return null;
  } catch (e) {
    if (e instanceof MatWriteError) return e;
    throw e;
  }
}

// Columns whose index a uint32 size word can still say, and the first it cannot.
const CAP = 2 ** 30 - 1;

const CASES: Record<string, MatVariable> = {
  'a 3x3 holding two non-zeros': sparse([3, 3], { row: [0, 2], col: [0, 2], re: [1, 2] }),
  'an all-zero 0x5': sparse([0, 5], { row: [], col: [], re: [] }),
  'a dense list its dims hold': sparse([2, 2], null, { value: [1, 0, 0, 2] }),
  'a dense list its dims do not hold': sparse([2, 2], null, { value: [1, 2, 3] }),
  'a class MATLAB stores no sparse array of': sparse([3, 3], { row: [0], col: [0], re: [1] }, { className: 'int8' }),
  'three dimensions': sparse([1, 2, 2], { row: [0], col: [0], re: [1] }),
  'a value the reader did not decode': sparse([3, 3], null, { undecoded: 'its index is damaged' }),
  'dims that are no size': sparse([1, 2.5], { row: [], col: [], re: [] }),
  'an extent past an int32': sparse([1, 2 ** 31], { row: [], col: [], re: [] }),
  // The budget's edge: 4 bytes a column past the backed ones, exactly all of it, then one more.
  'a column index unbacked for exactly the budget': sparse([1, 1 + UNBACKED_BYTES_BUDGET / 4], { row: [0], col: [0], re: [1], backedColumns: 1 }),
  'a column index unbacked for one column past the budget': sparse([1, 2 + UNBACKED_BYTES_BUDGET / 4], { row: [0], col: [0], re: [1], backedColumns: 1 }),
  // Backed, so the budget lets it through: the size word is what refuses it.
  'a column index no uint32 can say the size of': sparse([1, CAP], { row: [0], col: [CAP - 1], re: [1], backedColumns: CAP }),
};

describe('the sparse gate and the sparse writer refuse the same arrays', () => {
  for (const [what, v] of Object.entries(CASES)) {
    it(what, () => {
      const gate = sparseWriteRefusal(v);
      const writer = writerRefusal(v);
      expect(gate === null, `gate: ${gate}; writer: ${writer?.message}`).toBe(writer === null);
      // The budget's refusal is the writer's own, said where the write stands; every other is the
      // gate's words.
      if (writer && !(writer instanceof MatBudgetError)) {
        expect(writer.message).toBe(gate);
      }
    });
  }

  it('and the ones both take, the writer writes as what they are', () => {
    const read = decodeMatStream(encodeMatStream(CASES['a 3x3 holding two non-zeros']));
    expect(read.ok).toBe(true);
    const v = (read as { variable: MatVariable }).variable;
    expect([v.className, v.isSparse, v.dimensions]).toEqual(['double', true, [3, 3]]);
    expect([...v.sparse!.row, ...v.sparse!.col, ...v.sparse!.re]).toEqual([0, 2, 0, 2, 1, 2]);
  });

  it('one column short of the size word is taken by the gate, which the writer can still say', () => {
    expect(sparseWriteRefusal(sparse([1, CAP - 1], { row: [0], col: [CAP - 2], re: [1], backedColumns: CAP - 1 }))).toBeNull();
    expect(sparseWriteRefusal(CASES['a column index no uint32 can say the size of'])).toBe('a sparse array of ' + CAP + ' columns has a column index no MAT stream can hold');
  });
});

describe('a sparse array refused, in words a host can act on', () => {
  it('a non-zero at no row and column is refused first, whatever the shape, as a refusal no other spelling may take', () => {
    // An int8 or an N-D one is refused for its shape too; asked after the shape, it let the array
    // through to the full form its caller writes, which dropped the non-zero.
    for (const v of [
      hostSparse([3, 3], { row: [0.5], col: [0], re: [1] }),
      hostSparse([3, 3], { row: [0.5], col: [0], re: [1] }, { className: 'int8' }),
      hostSparse([1, 2, 2], { row: [0], col: [Number.NaN], re: [1] }),
    ]) {
      const e = writerRefusal(v);
      expect(e).toBeInstanceOf(MatBudgetError);
      expect((e as MatBudgetError).reason).toBe('not-an-index');
      expect(e!.message).toMatch(/^the value, a [\dx]+ sparse (double|int8) whose non-zero 1 is at \(.+\), which is not a row and a column$/);
    }
  });

  it('and inside a value, says where it stands', () => {
    const one = { name: '', className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value: 1, fields: null } as MatVariable;
    const e = writerRefusal({ ...one, className: 'cell', dimensions: [1, 2], value: [one, hostSparse([3, 3], { row: [0.5], col: [0], re: [1] })] as never }) as MatBudgetError;
    expect([e.reason, e.at]).toEqual(['not-an-index', '{2}']);
    expect(e.message).toBe('{2}, a 3x3 sparse double whose non-zero 1 is at (0.5, 0), which is not a row and a column');
  });

  it("the budget's refusal names the columns the data holds of those declared", () => {
    const e = writerRefusal(CASES['a column index unbacked for one column past the budget']) as MatBudgetError;
    expect(e.reason).toBe('budget');
    expect(e.what).toBe('a 1x' + (2 + UNBACKED_BYTES_BUDGET / 4) + ' sparse array whose data holds 1 of its ' + (2 + UNBACKED_BYTES_BUDGET / 4) + ' columns');
    expect(e.message).toContain('would write ' + (4 + UNBACKED_BYTES_BUDGET) + ' bytes no data backs');
  });

  it('dims that are no size, and an extent past an int32, say they are a sparse array', () => {
    const noSize = writerRefusal(CASES['dims that are no size']) as MatBudgetError;
    expect([noSize.reason, noSize.what]).toEqual(['not-a-count', 'a sparse double declaring dimensions [1,2.5]']);
    const past = writerRefusal(CASES['an extent past an int32']) as MatBudgetError;
    expect([past.reason, past.what]).toEqual(['past-int32', 'a 1x2147483648 sparse double']);
    expect(past.message).toBe('the value, a 1x2147483648 sparse double, has an extent of 2147483648, past 2147483647');
  });
});
