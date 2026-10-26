// Copyright 2026 The MathWorks, Inc.
//
// An element of an array edited, or added, as MATLAB's indexed assignment makes it (R2027a):
//
//   - a complex number typed into an element of a real array makes the whole array complex, of its
//     class: x(2) = 3+4i of [1 2 3] is [1 3+4i 3], of int8([1 2 3]) int8([1 3+4i 3]), each part
//     converted to the class (3.6+4.4i is 4+4i, 300-400i 127-128i), of single([1 2]) a complex
//     single. A logical array takes none: "Complex values cannot be converted to logicals.". It was
//     refused, "Array elements must be scalar numbers";
//   - a real number typed into an element of a complex array, or an Add on one, leaves the array
//     complex while any element has an imaginary part that is not 0, and the element is x+0i, as
//     the file shows it opened again: the edit showed `70000` and `0`, of class double, which the
//     reopen showed `70000+0i` and `0+0i`, complex;
//   - once no element has an imaginary part that is not 0, the array is real: [1+2i 3-4i] with
//     x(1) = 5 and x(2) = 6 is the real [5 6].
//
// The same in every format, an array in a struct, in a cell and a Simulink.Parameter's Value
// included, the row after the edit what the saved file shows opened again; and an undo puts back
// what was there.
import { describe, it, expect } from 'vitest';
import {
  EDIT_BASH_FORMATS,
  addTo,
  nodeAt,
  openEditBash,
  reopened,
  shownCell,
  shownRow,
  typeInto,
  undo,
  type Opened,
} from './tools/editBash.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The rows of the node at `path` and of every node under it, and of a Parameter it is the Value of. */
function rowsAt(o: Opened, path: string): Record<string, unknown> {
  const node = nodeAt(o, path);
  const rows: Record<string, unknown> = {};
  const visit = (n: any) => {
    rows[n.matlabPath] = shownRow(o, n.matlabPath);
    n.children?.forEach(visit);
  };
  visit(node);
  const holder = node.parent;
  if (holder?.className === 'Simulink.Parameter') {
    rows[holder.matlabPath] = { ...shownRow(o, holder.matlabPath), complexity: shownCell(holder, 'complexity') };
  }
  return rows;
}

type Step = [path: string, text: string];

// [what, the array, the edits made in turn, what the array then shows, and its Class]
const EDITS: [string, string, Step[], string, string][] = [
  ['a real number into a complex array', 'zArray', [['zArray(2)', '70000']], '[1+2i 70000+0i]', 'double (complex)'],
  ['a real number into a complex field', 'sLeaves.zArray', [['sLeaves.zArray(2)', '0']], '[1+2i 0+0i]', 'double (complex)'],
  ['a real number into a complex cell member', 'cLeaves{9}', [['cLeaves{9}(1)', '-7']], '[-7+0i 3-4i]', 'double (complex)'],
  ['a real number into a complex Parameter Value', 'pComplex.Value', [['pComplex.Value(2)', '70000']], '[1+2i 70000+0i]', 'double (complex)'],
  ['real numbers into every element of a complex array', 'zArray', [['zArray(1)', '5'], ['zArray(2)', '6']], '[5 6]', 'double'],
  ['real numbers into every element of a complex Parameter Value', 'pComplex.Value', [['pComplex.Value(1)', '7'], ['pComplex.Value(2)', '70000']], '[7 70000]', 'double'],
  ['a complex number into a real row', 'dRow', [['dRow(2)', '3+4i']], '[1+0i 3+4i 3+0i]', 'double (complex)'],
  ['a complex number into a real field', 'sLeaves.dRow', [['sLeaves.dRow(1)', '-2-0.5i']], '[-2-0.5i 2+0i 3+0i]', 'double (complex)'],
  ['a complex number into a real cell member', 'cLeaves{2}', [['cLeaves{2}(3)', '1i']], '[1+0i 2+0i 0+1i]', 'double (complex)'],
  ['a complex number into a real matrix', 'd2x3', [['d2x3(1,2)', '1i']], '[1+0i 0+1i 3+0i; 4+0i 5+0i 6+0i]', 'double (complex)'],
  ['a complex number into a real N-D array', 'nd2x2x2', [['nd2x2x2(1,1,2)', '2-1i']], '<2x2x2 complex double>', 'double (complex)'],
  ['a complex number into a row of non-finite numbers', 'dNonFinite', [['dNonFinite(1)', '1i']], '[0+1i -Inf+0i NaN+0i]', 'double (complex)'],
  ['a complex number into a single row', 'sglRow', [['sglRow(1)', '0.1+3.14159265358979i']], '[0.1+3.14159274i -2.5+0i]', 'single (complex)'],
  ['a complex number into an int8 Parameter Value', 'pInt8.Value', [['pInt8.Value(2)', '3.6+4.4i']], '[1+0i 4+4i 3+0i]', 'int8 (complex)'],
  ['a complex number into an int8 field of a Parameter struct Value', 'pStruct.Value.b', [['pStruct.Value.b(1)', '300-400i']], '[127-128i 2+0i]', 'int8 (complex)'],
  ['a complex number, and then a real one, into a real row', 'dRow', [['dRow(2)', '3+4i'], ['dRow(2)', '5']], '[1 5 3]', 'double'],
];

describe.each(EDIT_BASH_FORMATS)('an element edited as MATLAB assigns it, %s', (format) => {
  it.each(EDITS)('%s', (_what, array, steps, shown, cls) => {
    const o = openEditBash(format);
    const before = rowsAt(o, array);
    for (const [path, text] of steps) {
      expect(typeInto(o, path, 'Value', text), `${path} = ${text}`).toBe(true);
    }
    expect(shownRow(o, array)).toEqual({ Value: shown, Class: cls });
    // Each element row is of the array's class and complexity, as MATLAB's x(k) is.
    for (const child of nodeAt(o, array).children) {
      expect(shownCell(child, 'Class'), child.matlabPath).toBe(cls);
    }
    expect(rowsAt(reopened(o), array)).toEqual(rowsAt(o, array));
    for (let k = 0; k < steps.length; k++) {
      undo(o);
    }
    expect(rowsAt(o, array)).toEqual(before);
    expect(rowsAt(reopened(o), array)).toEqual(before);
  });

  it('makes a Parameter whose Value an element made complex complex, and real again', () => {
    const o = openEditBash(format);
    expect(typeInto(o, 'pInt8.Value(1)', 'Value', '1i')).toBe(true);
    expect(shownCell(nodeAt(o, 'pInt8'), 'complexity')).toBe('complex');
    expect(shownCell(nodeAt(reopened(o), 'pInt8'), 'complexity')).toBe('complex');
    expect(typeInto(o, 'pInt8.Value(1)', 'Value', '1')).toBe(true);
    expect(shownCell(nodeAt(o, 'pInt8'), 'complexity')).toBe('real');
  });

  it('refuses a complex number in an element of a logical array, in MATLAB\'s words, the row named', () => {
    const o = openEditBash(format);
    const r = typeInto(o, 'lArray(1)', 'Value', '3+4i') as any;
    expect(r?.reason).toBe('Cannot edit "lArray(1)": Complex values cannot be converted to logicals.');
    expect(shownRow(o, 'lArray')).toEqual({ Value: '[true false true]', Class: 'logical' });
  });
});

// [the array, what it then shows]
const ADDS: [string, string][] = [
  ['zArray', '[1+2i 3-4i 0+0i]'],
  ['sLeaves.zArray', '[1+2i 3-4i 0+0i]'],
  ['cLeaves{9}', '[1+2i 3-4i 0+0i]'],
  ['pComplex.Value', '[1+2i 3-4i 0+0i]'],
];

describe.each(EDIT_BASH_FORMATS)('Add on a complex array, %s', (format) => {
  it.each(ADDS)('%s takes 0+0i, as x(end+1) = 0 keeps it complex', (array, shown) => {
    const o = openEditBash(format);
    const before = rowsAt(o, array);
    const added = addTo(o, array);
    expect(shownRow(o, added.matlabPath)).toEqual({ Value: '0+0i', Class: 'double (complex)' });
    expect(shownRow(o, array)).toEqual({ Value: shown, Class: 'double (complex)' });
    expect(rowsAt(reopened(o), array)).toEqual(rowsAt(o, array));
    undo(o);
    expect(rowsAt(o, array)).toEqual(before);
  });
});

describe('a complex number typed into a real sparse array, mat27 and mat23', () => {
  it.each(['mat27', 'mat23'] as const)('%s: makes it a complex sparse array, and an undo a real one again', (format) => {
    const o = openEditBash(format);
    const before = rowsAt(o, 'spMatrix');
    expect(typeInto(o, 'spMatrix(2,2)', 'Value', '2-5i')).toBe(true);
    expect(shownRow(o, 'spMatrix(2,2)')).toEqual({ Value: '2-5i', Class: 'double (complex)' });
    expect(shownRow(o, 'spMatrix')?.Class).toBe('double (sparse complex)');
    expect(shownRow(o, 'spMatrix(1,1)')?.Value).toBe('1+0i');
    expect(rowsAt(reopened(o), 'spMatrix')).toEqual(rowsAt(o, 'spMatrix'));
    undo(o);
    expect(rowsAt(o, 'spMatrix')).toEqual(before);
    expect(rowsAt(reopened(o), 'spMatrix')).toEqual(before);
  });
});
