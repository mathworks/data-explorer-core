// Copyright 2026 The MathWorks, Inc.
//
// A complex number whose imaginary part is 0, typed as a whole value, is the real number MATLAB
// makes of the literal: isreal(1+0i) is true, its arithmetic dropping an imaginary part that is 0
// (measured, R2027a and R2023b: 1+0i, 1-0i, 0i, NaN+0i, 1+0j, 0i+1, and -0-0i and -0i the real
// -0). So it is wherever a value is typed: a variable, a struct field, a cell member, a
// Simulink.Parameter's Value (its Complexity 'real') and its Value row, and under the class a
// number keeps (cast(1+0i, 'int8') is real). It was the complex 1+0i, saved so; an array literal and
// a cell's member, `[1+0i 2]` and `{1+0i}`, and a conversion, `int8(1+0i)`, were real already.
//
// Not an element of a complex array, which MATLAB's z(2) = 1+0i leaves complex; nor a value the
// file holds complex with an imaginary part of 0 (MATLAB's complex(1, 0)), shown 1+0i, whose text
// typed back is no edit (the C-040 ruling).
import { describe, it, expect } from 'vitest';
import { EDIT_BASH_FORMATS, nodeAt, openEditBash, reopened, shownCell, shownRow, typeInto, undo, valueAt, type Opened } from './tools/editBash.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// [where, a first edit or none, the text, its class]
const WHOLE: [string, string | null, string, string][] = [
  ['dScalar', null, '1+0i', 'double'],
  ['dScalar', null, '3.5-0i', 'double'],
  ['dScalar', null, 'NaN+0i', 'double'],
  ['i8', null, '1+0i', 'int8'],
  ['sgl', null, '2+0i', 'single'],
  ['zZeroImag', 'int8([1 2])', '1+0i', 'int8'],
  ['sLeaves.dScalar', null, '1+0i', 'double'],
  ['sLeaves.zZeroImag', 'int8([1 2])', '1+0i', 'int8'],
  ['cLeaves{1}', null, '1+0i', 'double'],
];

// The real part as the node holds it, a -0 told apart.
const scalarOf = (o: Opened, path: string) => {
  const v = nodeAt(o, path)._scalarValue;
  return Object.is(v, -0) ? '-0' : String(v);
};

describe.each(EDIT_BASH_FORMATS)('a zero-imaginary literal typed as a whole value, %s', (format) => {
  it.each(WHOLE)('%s (after %s) typed %s is real', (path, first, text, cls) => {
    const o = openEditBash(format);
    if (first) {
      expect(typeInto(o, path, 'Value', first)).toBe(true);
    }
    const before = valueAt(o, path);
    expect(typeInto(o, path, 'Value', text)).toBe(true);
    expect(valueAt(o, path)).toMatchObject({ cls, complex: false, dims: [1, 1] });
    expect(valueAt(reopened(o), path)).toEqual(valueAt(o, path));
    undo(o);
    expect(valueAt(o, path)).toEqual(before);
  });

  it.each([['-0-0i', '-0'], ['-0i', '-0'], ['-0+0i', '0'], ['0i', '0']])('%s keeps the sign MATLAB gives its real part (%s)', (text, sign) => {
    const o = openEditBash(format);
    expect(typeInto(o, 'dScalar', 'Value', text)).toBe(true);
    expect([valueAt(o, 'dScalar').complex, scalarOf(o, 'dScalar')]).toEqual([false, sign]);
    if (format !== 'json') {
      // A text dictionary holds -0 as 0, as MATLAB's own does (the 10-23 limit).
      expect(scalarOf(reopened(o), 'dScalar')).toBe(sign);
    }
  });

  it.each([['pProps', '1+0i'], ['pComplex', '1+0i'], ['pComplex.Value', '2-0i']])("%s typed %s is a real Value, its Complexity 'real'", (path, text) => {
    const o = openEditBash(format);
    expect(typeInto(o, path, 'Value', text)).toBe(true);
    const shape = (x: Opened) => {
      const p = nodeAt(x, path.replace(/\.Value$/, ''));
      return { complexity: shownCell(p, 'complexity'), dimensions: shownCell(p, 'dimensions'), complex: p._valueNode?._isComplexValue?.() ?? false };
    };
    expect(shape(o)).toEqual({ complexity: 'real', dimensions: '[1 1]', complex: false });
    expect(shape(reopened(o))).toEqual(shape(o));
  });

  it('an element of a complex array stays complex, as MATLAB leaves z(2) = 1+0i', () => {
    const o = openEditBash(format);
    expect(typeInto(o, 'zArray(2)', 'Value', '1+0i')).toBe(true);
    expect(valueAt(o, 'zArray')).toMatchObject({ complex: true, shown: '[1+2i 1+0i]' });
    expect(valueAt(reopened(o), 'zArray')).toEqual(valueAt(o, 'zArray'));
  });

  it("a value the file holds complex with an imaginary part of 0 keeps it: its text typed back is no edit", () => {
    const o = openEditBash(format);
    const shown = shownRow(o, 'zZeroImag')!.Value;
    expect([shown, valueAt(o, 'zZeroImag').complex]).toEqual(['1+0i', true]);
    expect(typeInto(o, 'zZeroImag', 'Value', shown)).toBe(true);
    expect(valueAt(o, 'zZeroImag').complex).toBe(true);
    expect(o.session.canUndo()).toBe(false);
  });
});
