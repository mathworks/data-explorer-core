// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.Parameter's Value edited where it shows, as MATLAB's `p.Value = v` makes it (R2027a):
//
//   - a Value typed into the Value row is made as one typed into the Parameter's own Value cell is, so
//     that the two agree: a number is a double there (`[4 5 6]` over int8([1 2 3]), DataType 'auto'
//     where the source says it follows), where the row kept int8, as a plain member does (D11);
//   - text typed into the Value row is made as text typed into the Parameter's own Value cell is:
//     MATLAB's Value setter makes a string scalar of any char, ['ab'; 'cd'] the 1x1 "acbd". In a
//     MAT-file, whose save writes the char row MATLAB loads so, the row's 'abc' was held as a char
//     and shown 'abc' until the file was opened again as the string "abc", and its "abc" and
//     ['ab'; 'cd'] were refused where the Parameter's own Value took them. In a dictionary, which
//     keeps a char Parameter Value a char, the row held ['ab'; 'cd'] as the 2x2 char, where the
//     Parameter's own Value holds 'acbd' (MATLAB reads both as "acbd");
//   - text typed as the Value clears the Parameter's Min, Max and Unit, as MATLAB's setter does when
//     it makes the Value a string; they were kept, which no assignment in MATLAB leaves;
//   - an empty Value keeps the Complexity the Parameter had: [] typed over [1+2i 3-4i] leaves it
//     'complex', as MATLAB keeps it, and a MAT-file is saved so. Its save wrote 'real'.
//
// The row after the edit is what the saved file shows opened again; an undo puts back what was there.
import { describe, it, expect } from 'vitest';
import { EDIT_BASH_FORMATS, nodeAt, openEditBash, redo, reopened, shownCell, typeInto, undo, type Opened } from './tools/editBash.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const isMat = (format: string) => format.startsWith('mat');

/** The Parameter row as a table shows it, and its Value row's, where it has one. */
function shownParameter(o: Opened, name: string) {
  const p = nodeAt(o, name);
  const valueRow = nodeAt(o, name + '.Value');
  const v = p._valueNode;
  return {
    Value: shownCell(p, 'Value'),
    // The Value's class, a bare one's (a number, a logical, a char) as it is held.
    cls: v ? (v._isComplexValue?.() ? v._complexClass() : v.className) : typeof p.Value === 'number' || Array.isArray(p.Value) ? 'double' : typeof p.Value,
    DataType: shownCell(p, 'DataType'),
    complexity: shownCell(p, 'complexity'),
    row: valueRow ? shownCell(valueRow, 'Value') : null,
  };
}

const LONG = 'x'.repeat(2000);

// [what is typed, the text, what the Parameter shows in a MAT-file, and in a dictionary]
const TEXTS: [string, string, string, string][] = [
  ["'abc'", "'abc'", '"abc"', "'abc'"],
  ['"abc"', '"abc"', '"abc"', '"abc"'],
  ["['ab'; 'cd']", "['ab'; 'cd']", '"acbd"', "'acbd'"],
  ['a char of 2000', `'${LONG}'`, '<1x1 string>', `'${LONG}'`],
  // A number is a double, as MATLAB's p.Value = [4 5 6] makes it over an int8 Value; int8([4 5 6]) keeps int8.
  ['[4 5 6]', '[4 5 6]', '[4 5 6]', '[4 5 6]'],
  ['[1+2i 3]', '[1+2i 3]', '[1+2i 3+0i]', '[1+2i 3+0i]'],
  ['int8([4 5 6])', 'int8([4 5 6])', '[4 5 6]', '[4 5 6]'],
];

describe.each(EDIT_BASH_FORMATS)('a Parameter Value typed as text, %s', (format) => {
  it.each(TEXTS)('%s into the Value row is what it is typed into the Parameter', (_label, text, mat, dict) => {
    const byRow = openEditBash(format);
    const before = shownParameter(byRow, 'pInt8');
    expect(typeInto(byRow, 'pInt8.Value', 'Value', text)).toBe(true);
    const byParameter = openEditBash(format);
    expect(typeInto(byParameter, 'pInt8', 'Value', text)).toBe(true);
    const shown = shownParameter(byRow, 'pInt8');
    expect(shown.Value).toBe(isMat(format) ? mat : dict);
    expect(shown).toEqual(shownParameter(byParameter, 'pInt8'));
    expect(shownParameter(reopened(byRow), 'pInt8')).toEqual(shown);
    undo(byRow);
    expect(shownParameter(byRow, 'pInt8')).toEqual(before);
    expect(shownParameter(reopened(byRow), 'pInt8')).toEqual(before);
    // And a redo makes it again, the Parameter's Value with it.
    redo(byRow);
    expect(shownParameter(byRow, 'pInt8')).toEqual(shown);
    expect(shownParameter(reopened(byRow), 'pInt8')).toEqual(shown);
  });

  it.each(["'abc'", '"abc"', "['ab'; 'cd']"])('clears the Min, the Max and the Unit of a Parameter whose Value is typed %s, as MATLAB does', (text) => {
    const o = openEditBash(format);
    const bounds = (x: Opened) => {
      const p = nodeAt(x, 'pProps');
      return { Min: p.Min, Max: p.Max, Unit: p.Unit };
    };
    expect(bounds(o)).toEqual({ Min: 0, Max: 10, Unit: 'm' });
    expect(typeInto(o, 'pProps', 'Value', text)).toBe(true);
    expect(bounds(o)).toEqual({ Min: undefined, Max: undefined, Unit: '' });
    expect(bounds(reopened(o))).toEqual(bounds(o));
    undo(o);
    expect(bounds(o)).toEqual({ Min: 0, Max: 10, Unit: 'm' });
    expect(bounds(reopened(o))).toEqual({ Min: 0, Max: 10, Unit: 'm' });
  });

  it('keeps the Complexity of a Parameter whose Value is typed empty', () => {
    const o = openEditBash(format);
    expect(shownParameter(o, 'pComplex').complexity).toBe('complex');
    expect(typeInto(o, 'pComplex', 'Value', '[]')).toBe(true);
    expect(shownParameter(o, 'pComplex')).toMatchObject({ Value: '[ ]', complexity: 'complex' });
    expect(shownParameter(reopened(o), 'pComplex')).toEqual(shownParameter(o, 'pComplex'));
    // And follows a Value that is not empty again.
    expect(typeInto(o, 'pComplex', 'Value', '5')).toBe(true);
    expect(shownParameter(reopened(o), 'pComplex').complexity).toBe('real');
  });
});
