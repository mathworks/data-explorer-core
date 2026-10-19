// Copyright 2026 The MathWorks, Inc.
//
// C-033, its digits half: a SINGLE read out of MAT bytes shows MATLAB's digits, not the
// double it widens to. MatParser read each float32 with getFloat32, which hands back the
// double of the same value, and every number in this package prints as the shortest text
// that is that DOUBLE: single(3.3) is the double 3.299999952316284, and showed so — in a
// .mat, in an MCOS object's property (a .mat, a model workspace, a binary dictionary's
// hex) and in a text dictionary's MAT stream — where both dictionaries hold MATLAB's own
// text for the same value, 3.3 (a .mat and a text dictionary in the corpus that one MATLAB
// script wrote, P30_TypeMaxUnitDesc, and the plain SingleRowVec).
//
// The reader now keeps, for a value of class single, the decimal MATLAB spells it with,
// measured (R2027a, both dictionary formats): C's `%.6g` where that is the same float32,
// otherwise `%.9g` with an exact tie to the even digit, and `%.10g` for realmax('single').
// That is not the shortest decimal that is the same float32: single(1/3) is 0.333333343,
// where 0.33333334 would do. typedMcosFixtures.test.ts grades it against MATLAB's own text
// for 4,086 float32 bit patterns. It is lossless: it is the same float32, so a save writes
// the bits it read (MatWriter's setFloat32, a text dictionary's `3.3F`). A value of another
// class is read as it was, a double whose bytes happen to be stored as miSINGLE included:
// its value is the double, whatever its storage.
//
// Each value is built byte by byte (test/tools/matBytes.ts) and read through the real
// readers: a .mat by the session, and a MAT stream by decodeMatStream, the reader a text
// dictionary's cdata and a binary dictionary's hex go through.
import { describe, it, expect } from 'vitest';
import { decodeMatStream } from '../src/datamodel/parser/MatParser.js';
import { createSession } from '../src/index.js';
import { CLASS, MI, matFile, numericVar, sparseVar } from './tools/matBytes.js';

const opened = (variables: Uint8Array[]): any => createSession().addMatSource('t.mat', matFile(variables));
const single = (name: string, dimensions: number[], real: number[], imag?: number[]) =>
  numericVar({ name, cls: CLASS.SINGLE, dimensions, real, imag });
const child = (root: any, name: string): any => root.children.find((c: any) => c.name === name);

/** The value of a MAT stream holding the one variable `bytes`, as decodeMatStream reads it. */
function streamValue(bytes: Uint8Array): unknown {
  const decoded = decodeMatStream(Uint8Array.from([0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00, ...bytes]));
  if (!decoded.ok) throw new Error('the stream did not decode');
  return decoded.variable.value;
}

describe('a single read out of MAT bytes shows MATLAB\'s digits for it', () => {
  it('a .mat: single(3.3) shows 3.3 and single([1.1 2.2 3.3]) shows [1.1 2.2 3.3]', () => {
    const root = opened([single('s', [1, 1], [3.3]), single('r', [1, 3], [1.1, 2.2, 3.3])]);
    // Before: 3.299999952316284, and [1.100000023841858 2.200000047683716 3.299999952316284].
    expect([child(root, 's').displayValue, child(root, 's').className]).toEqual(['3.3', 'single']);
    expect([child(root, 'r').displayValue, child(root, 'r').className]).toEqual(['[1.1 2.2 3.3]', 'single']);
    expect(child(root, 'r').children.map((c: any) => c.displayValue)).toEqual(['1.1', '2.2', '3.3']);
  });

  it('a MAT stream (a text dictionary\'s cdata, a binary dictionary\'s hex): the same numbers', () => {
    expect(streamValue(single('', [1, 1], [3.3]))).toBe(3.3);
    expect(streamValue(single('', [1, 3], [1.1, 2.2, 3.3]))).toEqual([1.1, 2.2, 3.3]);
    expect(streamValue(single('', [2, 1], [0.1, 1 / 3]))).toEqual([0.1, 0.333333343]);
  });

  it('a complex single: both parts', () => {
    const root = opened([single('z', [1, 1], [0.1], [0.2])]);
    // Before: 0.10000000149011612+0.20000000298023224i.
    expect(child(root, 'z').displayValue).toBe('0.1+0.2i');
  });

  it('a sparse single: its non-zeros', () => {
    const root = opened([
      sparseVar({ name: 'sp', cls: CLASS.SINGLE, sparseFlag: true, dataType: MI.SINGLE, dimensions: [2, 2], ir: [0, 1], jc: [0, 1, 2], real: [1.1, 2.2] }),
    ]);
    const sp = child(root, 'sp');
    expect(sp.className).toBe('single');
    expect(sp.children.map((c: any) => c.displayValue)).toEqual(['1.1', '2.2']);
  });

  it('MATLAB\'s digits: %.6g where that is the same single, %.9g where it is not', () => {
    const stored = [1 / 3, 3.4028234663852886e38, 1e-45, 12187.2695, 473.15, 0.01, 2.3023181].map(Math.fround);
    const values = streamValue(single('', [1, stored.length], stored)) as number[];
    // MATLAB's own text for each (R2027a, make_typed_fixtures.m, both dictionary formats):
    // single(1/3) is 0.333333343, though 0.33333334 is the same single; realmax('single') is
    // 3.402823466e+38, its %.9g being past it; the smallest subnormal is 1.4013e-45, though
    // 1e-45 is the same single. 12187.2695, 473.15, 0.01 and 2.3023181 are a customer
    // dictionary's text for the same singles.
    expect(values).toEqual([0.333333343, 3.402823466e38, 1.4013e-45, 12187.2695, 473.15, 0.01, 2.3023181]);
    // Lossless: each is the float32 that was stored.
    expect(values.map(Math.fround)).toEqual(stored);
  });

  it('a nine-digit tie goes to the even digit, as MATLAB writes it', () => {
    // 1000000.125 is halfway between 1000000.12 and 1000000.13; MATLAB writes 1000000.12
    // (typed_mcos.sldd's sSingleTies), where toPrecision gives 1000000.13.
    const stored = [1000000.125, 1000000.375, 1000000.625, -1000000.125, 2097151.875, 2 ** -13];
    const values = streamValue(single('', [1, stored.length], stored)) as number[];
    expect(values).toEqual([1000000.12, 1000000.38, 1000000.62, -1000000.12, 2097151.88, 0.000122070312]);
    expect(values.map(Math.fround)).toEqual(stored);
  });

  it('lossless over a sweep of float32 bit patterns: each shown number is the stored single', () => {
    // Every 1048577th pattern of the positive finite range, and its negation: the exponents
    // from subnormal to the largest, with mantissas that need from one digit to nine. The
    // same patterns as make_typed_fixtures.m's sSingleSweep, whose digits are graded against
    // MATLAB's own in typedMcosFixtures.test.ts.
    const stored: number[] = [];
    const bits = new DataView(new ArrayBuffer(4));
    for (let b = 1; b < 0x7f800000; b += 0x100001) {
      bits.setUint32(0, b);
      stored.push(bits.getFloat32(0), -bits.getFloat32(0));
    }
    const read = streamValue(single('', [1, stored.length], stored)) as number[];
    expect(read).toHaveLength(stored.length);
    expect(read.filter((v, k) => Math.fround(v) !== stored[k])).toEqual([]);
    // And none is the widened double, which takes up to seventeen digits: at most ten.
    expect(read.filter((v) => v.toPrecision(11) !== Number(v.toPrecision(10)).toPrecision(11))).toEqual([]);
  });

  it('control: a single that is exact is unchanged, and so are Inf, -Inf, NaN and -0', () => {
    const values = streamValue(single('', [1, 7], [0.5, 16777216, -2.25, Infinity, -Infinity, NaN, -0])) as number[];
    expect(values.slice(0, 6)).toEqual([0.5, 16777216, -2.25, Infinity, -Infinity, NaN]);
    expect(Object.is(values[6], -0)).toBe(true);
  });

  it('control: a DOUBLE stored as miSINGLE keeps the double it is', () => {
    // A writer may store a double whose values a float32 holds exactly as miSINGLE. Its
    // value is the double, so it shows every digit the double has.
    const bytes = numericVar({ name: 'd', cls: CLASS.DOUBLE, dataType: MI.SINGLE, dimensions: [1, 1], real: [1.1] });
    expect(streamValue(bytes)).toBe(Math.fround(1.1));
    const root = opened([bytes]);
    expect([child(root, 'd').displayValue, child(root, 'd').className]).toEqual(['1.100000023841858', 'double']);
  });

  it('control: a double is read as it was', () => {
    expect(streamValue(numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 2], real: [3.3, 1 / 3] }))).toEqual([3.3, 1 / 3]);
  });
});
