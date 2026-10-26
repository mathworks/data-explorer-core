// Copyright 2026 The MathWorks, Inc.
//
// A number typed over a value of an integer class or single keeps that class (the D11 ruling,
// 2026-10-26): whatever the text, a scalar, an array, an empty, NaN, Inf, -0, an exponent, a row of
// any length, a complex number or array, the value is MATLAB's cast(<text>, class(old)) — each
// part rounded half away from zero and saturated under an integer class, NaN made 0, and under
// single the single MATLAB makes of it. As an element edit in MATLAB's Variable Editor keeps the
// class. double(...) is the way to a double (typedClassConversion.test.ts).
//
// It did not hold for a complex value of an integer class, int8(3+4i), whose class its node holds
// apart: every text over it made a double. Nor for complex text over a real one, which made a complex
// double. `[]` typed over an empty of another size, a 1x0 int8 or a 0x3 double, is the 0x0 of its
// class. (`[ ]`, the text every empty shows, committed unchanged, is no edit: the C-040 ruling.)
import { describe, it, expect } from 'vitest';
import { EDIT_BASH_FORMATS, openEditBash, redo, reopened, typeInto, undo, valueAt } from './tools/editBash.js';

const ROW500 = '[' + Array.from({ length: 500 }, (_, k) => k % 10).join(' ') + ']';

// [the value, the text, its class, size, complexity, and what it shows]
const CASES: [string, string, string, number[], boolean, string][] = [
  ['zInt8', '-0', 'int8', [1, 1], false, '0'],
  ['zInt8', '7.6', 'int8', [1, 1], false, '8'],
  ['zInt8', '1e3', 'int8', [1, 1], false, '127'],
  ['zInt8', '[NaN Inf -0]', 'int8', [1, 3], false, '[0 127 0]'],
  ['zInt8', '[1, 2, 3]', 'int8', [1, 3], false, '[1 2 3]'],
  ['zInt8', '[]', 'int8', [0, 0], false, '[ ]'],
  ['zInt8', ROW500, 'int8', [1, 500], false, '<1x500 int8>'],
  ['zInt8', '3.5-4.5i', 'int8', [1, 1], true, '4-5i'],
  ['sLeaves.zInt8', '1e3', 'int8', [1, 1], false, '127'],
  ['sLeaves.zInt8', '[NaN Inf -0]', 'int8', [1, 3], false, '[0 127 0]'],
  ['cLeaves{11}', '[1, 2, 3]', 'int8', [1, 3], false, '[1 2 3]'],
  ['cLeaves{11}', '[]', 'int8', [0, 0], false, '[ ]'],
  ['i8', '3.5+4.5i', 'int8', [1, 1], true, '4+5i'],
  ['i8', '[1+2i 300]', 'int8', [1, 2], true, '[1+2i 127+0i]'],
  ['u16', '-3+70000i', 'uint16', [1, 1], true, '0+65535i'],
  ['sgl', '1+3.14159265358979i', 'single', [1, 1], true, '1+3.14159274i'],
  ['sLeaves.sgl', '[1+2i 3]', 'single', [1, 2], true, '[1+2i 3+0i]'],
];

describe.each(EDIT_BASH_FORMATS)('a number typed over an integer or single value keeps its class, %s', (format) => {
  it.each(CASES)('%s typed %s', (path, text, cls, dims, complex, shown) => {
    const o = openEditBash(format);
    const before = valueAt(o, path);
    expect(typeInto(o, path, 'Value', text)).toBe(true);
    expect(valueAt(o, path)).toEqual({ cls, dims, complex, shown });
    expect(valueAt(reopened(o), path)).toEqual(valueAt(o, path));
    undo(o);
    expect(valueAt(o, path)).toEqual(before);
    redo(o);
    expect(valueAt(o, path)).toEqual({ cls, dims, complex, shown });
  });

  // A text dictionary holds both as 0x0 already (MATLAB reads them back so), so there it is no edit.
  it.each([
    ['i8Empty1x0', 'int8'],
    ['dEmpty0x3', 'double'],
    ['sLeaves.i8Empty1x0', 'int8'],
  ])('%s typed [] is the 0x0 %s MATLAB makes', (path, cls) => {
    const o = openEditBash(format);
    const before = valueAt(o, path);
    expect(typeInto(o, path, 'Value', '[]')).toBe(true);
    expect(valueAt(o, path)).toEqual({ cls, dims: [0, 0], complex: false, shown: '[ ]' });
    expect(valueAt(reopened(o), path)).toEqual(valueAt(o, path));
    if (format !== 'json') {
      expect(before.dims).not.toEqual([0, 0]);
      undo(o);
      expect(valueAt(o, path)).toEqual(before);
    }
  });
});
