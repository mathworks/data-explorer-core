// Copyright 2026 The MathWorks, Inc.
//
// The subscript rule, in isolation. The two orders are the crux: numeric, cell
// and string element lists reach the node layer ROW-major (MatParser transposes
// each page on the way in), while object and struct element lists reach it
// COLUMN-major (MATLAB's own order, which the MCOS decoder and both SLDD paths
// preserve). One helper, told which it is holding.
import { describe, it, expect } from 'vitest';
import { subscriptLabel, ind2sub } from '../src/datamodel/display/Subscript.js';

describe('ind2sub', () => {
  it('matches MATLAB ind2sub on a 0-based column-major index', () => {
    // MATLAB: [r,c] = ind2sub([2 3], 1:6) -> (1,1)(2,1)(1,2)(2,2)(1,3)(2,3)
    const got = [0, 1, 2, 3, 4, 5].map((i) => ind2sub(i, [2, 3]).join(','));
    expect(got).toEqual(['1,1', '2,1', '1,2', '2,2', '1,3', '2,3']);
  });

  it('extends to rank 3', () => {
    expect(ind2sub(0, [2, 3, 2]).join(',')).toBe('1,1,1');
    expect(ind2sub(6, [2, 3, 2]).join(',')).toBe('1,1,2');
    expect(ind2sub(11, [2, 3, 2]).join(',')).toBe('2,3,2');
  });
});

describe('subscriptLabel — vectors take a single linear subscript', () => {
  it('numbers a row vector, a column vector and a scalar-ish list linearly', () => {
    for (const dims of [[1, 3], [3, 1]]) {
      expect([0, 1, 2].map((i) => subscriptLabel('v', i, dims, 'row-major', '()'))).toEqual([
        'v(1)', 'v(2)', 'v(3)',
      ]);
    }
  });

  it('uses braces for cells', () => {
    expect(subscriptLabel('c', 1, [1, 3], 'row-major', '{}')).toBe('c{2}');
  });
});

describe('subscriptLabel — row-major lists (numeric, cell, string)', () => {
  it('labels a 2x3 across the rows, which is what the existing tests pin', () => {
    const got = [0, 1, 2, 3, 4, 5].map((i) => subscriptLabel('v', i, [2, 3], 'row-major', '()'));
    expect(got).toEqual(['v(1,1)', 'v(1,2)', 'v(1,3)', 'v(2,1)', 'v(2,2)', 'v(2,3)']);
  });

  it('labels a 2x2 cell across the rows', () => {
    const got = [0, 1, 2, 3].map((i) => subscriptLabel('c', i, [2, 2], 'row-major', '{}'));
    expect(got).toEqual(['c{1,1}', 'c{1,2}', 'c{2,1}', 'c{2,2}']);
  });

  it('emits a THREE-part subscript for rank 3 — never a row index past the row count', () => {
    // MatParser hands us pages in order, each page row-major.
    const got = Array.from({ length: 12 }, (_, i) => subscriptLabel('A', i, [2, 3, 2], 'row-major', '()'));
    expect(got).toEqual([
      'A(1,1,1)', 'A(1,2,1)', 'A(1,3,1)', 'A(2,1,1)', 'A(2,2,1)', 'A(2,3,1)',
      'A(1,1,2)', 'A(1,2,2)', 'A(1,3,2)', 'A(2,1,2)', 'A(2,2,2)', 'A(2,3,2)',
    ]);
    expect(got.some((s) => /\(3,|\(4,/.test(s))).toBe(false);
  });
});

describe('subscriptLabel — column-major lists (object, struct)', () => {
  it('labels a 2x3 in MATLAB linear order, so label i names element i', () => {
    const got = [0, 1, 2, 3, 4, 5].map((i) => subscriptLabel('w', i, [2, 3], 'column-major', '()'));
    expect(got).toEqual(['w(1,1)', 'w(2,1)', 'w(1,2)', 'w(2,2)', 'w(1,3)', 'w(2,3)']);
  });

  it('labels a 2x2 in column order — the square case that hid the transpose', () => {
    const got = [0, 1, 2, 3].map((i) => subscriptLabel('m', i, [2, 2], 'column-major', '()'));
    expect(got).toEqual(['m(1,1)', 'm(2,1)', 'm(1,2)', 'm(2,2)']);
  });

  it('extends to rank 3', () => {
    const got = Array.from({ length: 12 }, (_, i) => subscriptLabel('v', i, [2, 3, 2], 'column-major', '()'));
    expect(got[0]).toBe('v(1,1,1)');
    expect(got[11]).toBe('v(2,3,2)');
    expect(got.some((s) => /\(3,|\(4,/.test(s))).toBe(false);
  });
});

describe('subscriptLabel — shape normalization', () => {
  it('treats a trailing singleton as rank 2', () => {
    expect(subscriptLabel('A', 1, [2, 3, 1], 'row-major', '()')).toBe('A(1,2)');
  });

  it('falls back to a linear subscript when dims are missing', () => {
    expect(subscriptLabel('v', 0, undefined, 'row-major', '()')).toBe('v(1)');
  });
});
