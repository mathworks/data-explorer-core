// Copyright 2026 The MathWorks, Inc.
//
// A conversion typed as a value, `int8(5)`, `single(2.5)`, `uint16([1 2])`, `int8(3+4i)`,
// `double(42)`, `logical([1 0 2])`, is the value MATLAB makes of it (R2027a), wherever a value is
// typed: a variable, a struct field, a cell's member or literal, a Simulink.Parameter's Value, in
// every format. Its class is the one it spells, not the one the value it is typed over had (a number
// typed bare keeps that one, typedValueKeepsClass.test.ts), so double(42) is the way to make an int8
// member a double. Typed into an element of an array, it is the number it converts to, held in the
// array's class, as MATLAB's x(k) = int8(300) is. Only a cell's literal took one, `int8` to `single`;
// as a whole value each was "Invalid MATLAB expression", and so was every `double(...)`.
import { describe, it, expect } from 'vitest';
import { EDIT_BASH_FORMATS, nodeAt, openEditBash, redo, reopened, shownCell, shownRow, typeInto, undo, valueAt, type Opened } from './tools/editBash.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// [the value, the text, its class, size, complexity, and what it shows]
const WHOLE: [string, string, string, number[], boolean, string][] = [
  ['dScalar', 'single(2.5)', 'single', [1, 1], false, '2.5'],
  ['dScalar', 'single(3.14159265358979)', 'single', [1, 1], false, '3.14159274'],
  ['dScalar', 'int8(5)', 'int8', [1, 1], false, '5'],
  ['dScalar', 'int8(300)', 'int8', [1, 1], false, '127'],
  ['dScalar', 'int8([1.5 2; NaN -Inf])', 'int8', [2, 2], false, '[2 2; 0 -128]'],
  ['dScalar', 'int8([])', 'int8', [0, 0], false, '[ ]'],
  ['dScalar', 'int8(3.5+4.5i)', 'int8', [1, 1], true, '4+5i'],
  ['dScalar', 'int8(3+0i)', 'int8', [1, 1], false, '3'],
  ['dScalar', 'logical([1 0 2])', 'logical', [1, 3], false, '[true false true]'],
  ['lArray', 'uint16(7)', 'uint16', [1, 1], false, '7'],
  ['i8', 'double(42)', 'double', [1, 1], false, '42'],
  ['i8', 'double([1 2; 3 4])', 'double', [2, 2], false, '[1 2; 3 4]'],
  ['zInt8', 'double(3+4i)', 'double', [1, 1], true, '3+4i'],
  ['sLeaves.dScalar', 'uint8(-3)', 'uint8', [1, 1], false, '0'],
  ['sLeaves.i8', 'double(-2.5)', 'double', [1, 1], false, '-2.5'],
  ['cLeaves{1}', 'int8(5)', 'int8', [1, 1], false, '5'],
  ['cLeaves{12}', 'double(7)', 'double', [1, 1], false, '7'],
  // A 64-bit integer past 2^53 is exact only as the bare literal, a minus at most (R2027a).
  ['dScalar', 'int64(9007199254740993)', 'int64', [1, 1], false, '9007199254740993'],
  ['dScalar', 'int64(- 9007199254740993)', 'int64', [1, 1], false, '-9007199254740993'],
  ['dScalar', 'int64(+9007199254740993)', 'int64', [1, 1], false, '9007199254740992'],
  ['dScalar', 'int64([9007199254740993 1])', 'int64', [1, 2], false, '[9007199254740992 1]'],
  ['dScalar', 'uint64(18446744073709551614)', 'uint64', [1, 1], false, '18446744073709551614'],
  ['dScalar', 'uint64([18446744073709551614 1])', 'uint64', [1, 2], false, '[18446744073709551615 1]'],
];

// [the element, the text, what its array then shows]
const ELEMENTS: [string, string, string][] = [
  ['pInt8.Value(2)', 'int8(300)', '[1 127 3]'],
  ['dRow(1)', 'single(0.1)', '[0.10000000149011612 2 3]'],
  ['dRow(2)', 'int8(2.5)', '[1 3 3]'],
  ['dRow(2)', 'int8(3+4i)', '[1+0i 3+4i 3+0i]'],
  ['sglRow(1)', 'int8(7)', '[7 -2.5]'],
];

// A text dictionary's refusal of a shaped empty (the D15 ruling).
const lostEmpty = (path: string, verb: string, what: string) => `Cannot edit "${path}": ${path} ${verb} ${what}, which a text dictionary holds only as a 0x0 one.`;

describe.each(EDIT_BASH_FORMATS)('a conversion typed as a value, %s', (format) => {
  it.each(WHOLE)('%s typed %s', (path, text, cls, dims, complex, shown) => {
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

  it.each(ELEMENTS)('%s typed %s is the number it converts to, in its array', (path, text, shown) => {
    const o = openEditBash(format);
    const array = path.replace(/\(\d+\)$/, '');
    const before = shownRow(o, array);
    expect(typeInto(o, path, 'Value', text)).toBe(true);
    expect(shownRow(o, array)?.Value).toBe(shown);
    expect(shownRow(reopened(o), array)).toEqual(shownRow(o, array));
    undo(o);
    expect(shownRow(o, array)).toEqual(before);
  });

  it("in a cell's literal, a double member shown bare and a logical one as true", () => {
    const o = openEditBash(format);
    expect(typeInto(o, 'cEmpty', 'Value', '{double(3), int8(4), logical(2)}')).toBe(true);
    expect(shownRow(o, 'cEmpty')?.Value).toBe('{3, int8(4), true}');
    expect(nodeAt(o, 'cEmpty').children.map((c: any) => c.className)).toEqual(['double', 'int8', 'logical']);
    expect(shownRow(reopened(o), 'cEmpty')).toEqual(shownRow(o, 'cEmpty'));
  });

  it("in a cell's literal, a conversion of an empty is the empty of its class and size", () => {
    const o = openEditBash(format);
    const text = '{int8(zeros(1,0)), double(zeros(0,3))}';
    // A text dictionary holds a shaped empty only as 0x0, as MATLAB's own does, and refuses one (D15).
    if (format === 'json') {
      expect(typeInto(o, 'cEmpty', 'Value', text)).toMatchObject({ error: true, reason: lostEmpty('cEmpty', 'would hold', 'a 1x0 int8') });
      return;
    }
    expect(typeInto(o, 'cEmpty', 'Value', text)).toBe(true);
    const members = (x: Opened) => nodeAt(x, 'cEmpty').children.map((c: any) => [c.className, c.dims]);
    expect(members(o)).toEqual([['int8', [1, 0]], ['double', [0, 3]]]);
    expect(members(reopened(o))).toEqual(members(o));
  });

  it("as a Simulink.Parameter's Value, of the class it spells", () => {
    for (const [name, text, cls, complex] of [
      ['pProps', 'int8(5)', 'int8', false],
      ['pInt8', 'double(4)', 'double', false],
      ['pInt8', 'single([1 2])', 'single', false],
      ['pComplex', 'int8(3+4i)', 'int8', true],
      ['pInt8', 'int64(9007199254740993)', 'int64', false],
      ['pInt8', 'uint64(18446744073709551614)', 'uint64', false],
    ] as const) {
      const o = openEditBash(format);
      expect(typeInto(o, name, 'Value', text), `${name} ${text}`).toBe(true);
      // A double scalar is held bare, with no value node.
      const held = (x: Opened) => {
        const p = nodeAt(x, name);
        const v = p._valueNode;
        const shown = shownCell(p, 'Value');
        return v ? { cls: v._isComplexValue() ? v._complexClass() : v.className, complex: v._isComplexValue(), shown } : { cls: typeof p.Value === 'number' ? 'double' : '?', complex: false, shown };
      };
      expect(held(o), `${name} ${text}`).toMatchObject({ cls, complex });
      // A 64-bit integer, every digit of it (it lost its last to the double it was made first).
      if (/64\(/.test(text)) {
        expect(held(o).shown).toBe(/\((\d+)\)/.exec(text)![1]);
      }
      expect(held(reopened(o)), `${name} ${text} reopened`).toEqual(held(o));
      // Its DataType as MATLAB's p.Value = v sets it: the Value's class, in every format (a
      // dictionary holding int8 under 'single' is opened with the Value made a double); and 'auto' of
      // a double one where the source says it follows (a MAT-file; a dictionary keeps its own, P5).
      const dataType = shownCell(nodeAt(o, name), 'DataType');
      if (cls !== 'double') {
        expect(dataType, `${name} ${text}`).toBe(cls);
      } else if (format.startsWith('mat')) {
        expect(dataType, `${name} ${text}`).toBe('auto');
      }
      expect(shownCell(nodeAt(reopened(o), name), 'DataType')).toBe(dataType);
    }
  });

  it('of an empty, int8(zeros(1,0)), keeps its class and size', () => {
    const o = openEditBash(format);
    if (format === 'json') {
      expect(typeInto(o, 'dScalar', 'Value', 'int8(zeros(1,0))')).toMatchObject({ error: true, reason: lostEmpty('dScalar', 'would be', 'a 1x0 int8') });
      return;
    }
    expect(typeInto(o, 'dScalar', 'Value', 'int8(zeros(1,0))')).toBe(true);
    expect(valueAt(o, 'dScalar')).toEqual({ cls: 'int8', dims: [1, 0], complex: false, shown: '[ ]' });
    expect(valueAt(reopened(o), 'dScalar')).toEqual(valueAt(o, 'dScalar'));
  });

  // A shaped empty typed as the whole value is the empty of its class (G2); a text dictionary, which
  // holds one only as 0x0, refuses it (D15), and takes the 0x0 of its class, saved as MATLAB saves its
  // own, the class's `[]`.
  it.each([
    ["zeros(1,0,'int8')", 'int8', [1, 0]],
    ["zeros(0,3,'single')", 'single', [0, 3]],
    ["zeros(1,0,'uint64')", 'uint64', [1, 0]],
    ['false(1,0)', 'logical', [1, 0]],
    ['false(0,3)', 'logical', [0, 3]],
    ['false(0)', 'logical', [0, 0]],
    ["zeros(0,0,'int16')", 'int16', [0, 0]],
  ])('%s typed as a whole value is the empty of its class, saved so', (text, cls, dims) => {
    const o = openEditBash(format);
    if (format === 'json' && dims.includes(0) && !(dims[0] === 0 && dims[1] === 0)) {
      expect(typeInto(o, 'dScalar', 'Value', text)).toMatchObject({ error: true, reason: lostEmpty('dScalar', 'would be', `a ${dims.join('x')} ${cls}`) });
      return;
    }
    expect(typeInto(o, 'dScalar', 'Value', text)).toBe(true);
    const held = (x: Opened) => [nodeAt(x, 'dScalar').className, nodeAt(x, 'dScalar').dims];
    expect(held(o)).toEqual([cls, dims]);
    expect(held(reopened(o))).toEqual([cls, dims]);
  });

  it.each(['logical(NaN)', 'logical(3+4i)', "int8('a')", 'int8(1, 2)'])('refuses %s', (text) => {
    const o = openEditBash(format);
    const before = valueAt(o, 'dScalar');
    expect(typeInto(o, 'dScalar', 'Value', text)).toMatchObject({ error: true });
    expect(valueAt(o, 'dScalar')).toEqual(before);
  });
});
