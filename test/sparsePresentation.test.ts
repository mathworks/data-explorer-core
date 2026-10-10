// Copyright 2026 The MathWorks, Inc.
//
// How a sparse array is presented, on the shapes MATLAB's fixtures do not hold
// (test/sparseFixtures.test.ts grades the ones they do, in all four venues):
//
//   * always its summary, `<RxC sparse class>`, never a dense literal — at 1x1, empty, and
//     inside a cell's literal;
//   * one element row per non-zero, labelled `name(r,c)`, a vector's too, in MATLAB's
//     column-major order, and none past the row budget;
//   * no Variable Editor grid: its rows are its non-zeros, and its elements are not held;
//   * nothing in the tree that adds or removes an element.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { buildOtherRows } from '../src/datamodel/node/piOther.js';
import { encodeCdata, encodeMatVariable } from '../src/datamodel/parser/MatWriter.js';
import { parseMatrix } from '../src/datamodel/parser/MatParser.js';
import { subscriptLabel, subscriptsLabel } from '../src/datamodel/display/Subscript.js';
import { MAX_EXPANDED_ELEMENTS } from '../src/datamodel/display/DisplayConvention.js';
import { cellVar, CLASS, matFile, numericVar, sparseVar } from './tools/matBytes.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const open = (elements: Uint8Array[]): any => createSession().addMatSource('s.mat', matFile(elements));
const decode = (bytes: Uint8Array): any => parseMatrix(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 8, bytes.length - 8);
const rows = (node: any): [string, string][] => node.children.map((c: any) => [c.displayName, c.displayValue]);

describe('a 1x1 sparse array', () => {
  it('is its summary, with its one non-zero as a row of its own, editable as an element is', () => {
    // sparse(5). A 1x1 is otherwise a scalar, shown inline with no rows: shown as a
    // summary instead, a scalar's value would be nowhere on screen.
    const node = open([sparseVar({ name: 'x', dimensions: [1, 1], ir: [0], jc: [0, 1], real: [5] })]).children[0];
    expect([node.displayValue, node.className, node.dims, node.isSparse]).toEqual(['<1x1 sparse double>', 'double', [1, 1], true]);
    expect(rows(node)).toEqual([['x(1,1)', '5']]);
    expect(node.children[0].valueEditable).toBe(true);
    expect(node.children[0].setProperty('Value', '9')).toBe(true);
    const written = decode(encodeMatVariable(node._var));
    expect([written.isSparse, written.className, written.dimensions, [...written.sparse.re]]).toEqual([true, 'double', [1, 1], [9]]);
  });

  it('holding a zero, has no row', () => {
    const node = open([sparseVar({ name: 'z', dimensions: [1, 1], ir: [], jc: [0, 0], real: [], nzmax: 1 })]).children[0];
    expect([node.displayValue, node.children.length]).toEqual(['<1x1 sparse double>', 0]);
  });

  it('complex, is one complex row', () => {
    const node = open([sparseVar({ name: 'c', dimensions: [1, 1], ir: [0], jc: [0, 1], real: [1], imag: [2] })]).children[0];
    expect([node.displayValue, rows(node)]).toEqual(['<1x1 sparse double>', [['c(1,1)', '1+2i']]]);
  });
});

describe('a sparse array\'s rows', () => {
  it('are labelled with both subscripts, a vector\'s too, as MATLAB\'s display of one has them', () => {
    // sparse([0 0 9]) displays `(1,3)        9` in MATLAB; a full row vector's element is x(3).
    const node = open([sparseVar({ name: 'v', dimensions: [1, 3], ir: [0], jc: [0, 0, 0, 1], real: [9] })]).children[0];
    expect(rows(node)).toEqual([['v(1,3)', '9']]);
    expect(subscriptLabel('v', 2, [1, 3], 'column-major', '()')).toBe('v(3)');
    expect(subscriptsLabel('v', [1, 3], '()')).toBe('v(1,3)');
  });

  it('follow a rename of the array above them', () => {
    const node = open([sparseVar({ name: 'v', dimensions: [3, 1], ir: [1], jc: [0, 1], real: [4] })]).children[0];
    expect(node.setProperty('Name', 'w')).toBe(true);
    expect(rows(node)).toEqual([['w(2,1)', '4']]);
  });

  it('stop at the row budget, counted in non-zeros, and there is no grid to list them instead', () => {
    // A 1x20000 holding 10001 non-zeros: over the budget in rows, not in elements.
    const nnz = MAX_EXPANDED_ELEMENTS + 1;
    const ir = Array.from({ length: nnz }, () => 0);
    const jc = Array.from({ length: 20001 }, (_, c) => Math.min(c, nnz));
    const real = Array.from({ length: nnz }, (_, k) => k + 1);
    const node = open([sparseVar({ name: 'big', dimensions: [1, 20000], ir, jc, real })]).children[0];
    expect([node.displayValue, node.children.length, node.displayElements()]).toEqual(['<1x20000 sparse double>', 0, null]);
    // What it holds is still every non-zero, for the writers.
    expect([node._sparse.row.length, node._sparse.re[nnz - 1]]).toEqual([nnz, nnz]);
    // One under the budget is all rows.
    const under = open([sparseVar({ name: 'u', dimensions: [1, 20000], ir: ir.slice(1), jc: jc.map((j) => Math.min(j, nnz - 1)), real: real.slice(1) })])
      .children[0];
    expect(under.children.length).toBe(MAX_EXPANDED_ELEMENTS);
  });
});

describe('a sparse array in a cell', () => {
  it('is its summary inside the cell\'s literal, beside a full one\'s literal', () => {
    const sp = sparseVar({ name: '', dimensions: [1, 3], ir: [0], jc: [0, 0, 0, 1], real: [9] });
    const full = numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 2], real: [9, 10] });
    const cell = open([cellVar('c', [sp, full], [1, 2])]).children[0];
    expect(cell.displayValue).toBe('{<1x3 sparse double>, [9 10]}');
    expect(rows(cell.children[0])).toEqual([['c{1}(1,3)', '9']]);
    expect(cell.displayElements().map((e: any) => e.value)).toEqual(['<1x3 sparse double>', '[9 10]']);
  });
});

describe('nothing in the tree adds or removes an element of a sparse array', () => {
  it('a vector, an empty one and a matrix alike', () => {
    // A full vector takes Add and Remove; an empty full one turns into a struct on Add.
    const mat = open([
      sparseVar({ name: 'row', dimensions: [1, 5], ir: [0, 0], jc: [0, 0, 1, 1, 2, 2], real: [2, 4] }),
      sparseVar({ name: 'empty', dimensions: [0, 0], ir: [], jc: [0], real: [], nzmax: 1 }),
      sparseVar({ name: 'm', dimensions: [2, 2], ir: [0], jc: [0, 1, 1], real: [3] }),
    ]);
    for (const node of mat.children) {
      expect([node.name, node.canAddChild(), node.canRemoveChild(), node.execAddChild()], node.name).toEqual([node.name, false, false, null]);
    }
    expect(mat.children[1].displayValue).toBe('<0x0 sparse double>');
  });
});

describe('the Property Inspector\'s Other group shows a sparse value as its summary', () => {
  const shows = (Value: unknown) => buildOtherRows({ Table: { _object_class: 'T', _properties: { Value } } }, new Set())[0].value;

  it('a text dictionary\'s stream of one', () => {
    const value = { _type: 'cdata', _value: encodeCdata({ name: '', className: 'double', dimensions: [2, 3], isComplex: false, isLogical: false, isSparse: true, value: [1, 0, 2, 0, 3, 0], fields: null }) };
    expect(shows(value)).toBe('<2x3 sparse double>');
    const logical = { _type: 'cdata', _value: encodeCdata({ name: '', className: 'logical', dimensions: [1, 2], isComplex: false, isLogical: true, isSparse: true, value: [1, 0], fields: null }) };
    expect(shows(logical)).toBe('<1x2 sparse logical>');
  });

  it('this package\'s own `sparse` literal', () => {
    expect(shows({ _type: 'sparse', _value: 'Matrix(2,2)\n[[42, 0]; [0, 5]]' })).toBe('<2x2 sparse double>');
    expect(shows({ _type: 'sparse', _value: '[0, 7, 0]' })).toBe('<1x3 sparse double>');
  });
});

describe('a cell whose literal shows an element as a summary offers no in-cell editor', () => {
  // `{<1x3 sparse double>, [9 10]}` is not the cell's value written out: the token is a
  // summary, and read back as text it is three char cells. Committed in the cell's
  // editor, or restored by undo (which restores the text the cell displayed), the sparse
  // element was gone from the saved file. A sparse value has no in-cell editor, and
  // neither does a cell that shows one, or any other summary — a large array, a struct,
  // an object — inside its literal. Its elements edit as before.
  const textFixture = new URL('./fixtures/sparse/sparse_text.sldd', import.meta.url);
  const openText = () => {
    const s = createSession();
    const src: any = s.addDataSource('sparse_text.sldd', JSON.parse(readFileSync(fileURLToPath(textFixture), 'utf8')));
    s.setActiveContext(src);
    return { s, src, c: src.getSection('design').children.find((e: any) => e.name === 'c') };
  };

  it('in every venue that edits: no editor, and the value cannot be set as text', () => {
    const venues: [string, any][] = [
      ['mat', createSession().addMatSource('v.mat', new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/sparse/sparse_values.mat', import.meta.url)))).slice().buffer)],
      ['text', openText().src.getSection('design')],
    ];
    for (const [venue, root] of venues) {
      const c = root.children.find((e: any) => e.name === 'c');
      expect([c.displayValue, c.valueEditable], venue).toEqual(['{<1x3 sparse double>, [9 10]}', false]);
      const result = c.setProperty('Value', c.displayValue);
      expect(result, venue).toMatchObject({ error: true });
      expect([c.children[0].isSparse, c.children.map((e: any) => e.className)], venue).toEqual([true, ['double', 'double']]);
      // Its elements still edit, the sparse one through its row.
      expect(c.children[1].valueEditable, venue).toBe(true);
      expect(c.children[1].setProperty('Value', '[9 11]'), venue).toBe(true);
      expect(c.children[0].children[0].setProperty('Value', '4'), venue).toBe(true);
      expect(c.displayValue, venue).toBe('{<1x3 sparse double>, [9 11]}');
    }
  });

  it('through the session: the cell is not edited, so there is no undo to restore its text', () => {
    const { s, src, c } = openText();
    s.setActive(src, c);
    expect(s.editProperty(c.id, 'Value', '{1, 2}')).toMatchObject({ error: true });
    expect(c.children[0].isSparse).toBe(true);
    // An element's edit undoes as it did, and the cell is as it was.
    const el = c.children[1];
    s.setActive(src, el);
    expect(s.editProperty(el.id, 'Value', '[1 2 3]')).toBe(true);
    s.undo();
    expect([el.displayValue, c.children[0].isSparse, rows(c.children[0])]).toEqual(['[9 10]', true, [['c{1}(1,3)', '9']]]);
    const saved = JSON.parse(s.serializeSource(src.name)!.text!);
    const entry = saved.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'c');
    expect(entry.value._elements[0]._type).toBe('cdata');
  });

  it('any summary in the literal, at any depth; a cell of plain values still edits', () => {
    const big = { _type: 'double', _value: 'Matrix(4,3)\n[1, 2, 3]\n[4, 5, 6]\n[7, 8, 9]\n[10, 11, 12]' };
    const design = openText().src.getSection('design');
    const cellOf = (name: string, elements: unknown[]) =>
      design.parseEntry({ name, metadata: { uuid: `00000000-0000-4000-e000-${name.length}0000000000` }, value: { _array_type: 'Cell', _dimensions: [1, elements.length], _elements: elements } });
    const sparse = design.children.find((e: any) => e.name === 'c').serialize().value._elements[0];
    const cases: [string, unknown[], boolean][] = [
      ['plain', [1, 'a', [2, 3]], true],
      ['bigDense', [big, 1], false],
      ['struct', [{ _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ a: 1 }] }], false],
      ['nested', [{ _array_type: 'Cell', _dimensions: [1, 1], _elements: [sparse] }], false],
    ];
    for (const [name, elements, editable] of cases) {
      const node = cellOf(name, elements);
      expect([node.displayValue.startsWith('{'), node.valueEditable], name).toEqual([true, editable]);
    }
  });
});

describe('a Simulink.Parameter whose Value is an all-zero sparse array has no Value row', () => {
  // The Value row exists only while the value has rows to expand into, and an all-zero
  // sparse array has none. 1.36.2 kept the row anyway, for the Variable Editor's grid a
  // host offers on the Value row of a Parameter; a sparse array has no grid now, so the
  // row would reveal nothing, and the Parameter shows the value itself, as for any value
  // with no rows.
  const parameter = (value: unknown): any =>
    createSession()
      .addDataSource('p.sldd', JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/sparse/sparse_text.sldd', import.meta.url)), 'utf8')))
      .getSection('design')
      .parseEntry({
        name: 'pZero',
        metadata: { uuid: '00000000-0000-4000-e100-000000000001' },
        value: { _array_class: 'Simulink.Parameter', _dimensions: [1, 1], _elements: [{ _properties: { Value: value } }] },
      });
  const stream = (rows: number, cols: number, value: number[]) => ({
    _type: 'cdata',
    _value: encodeCdata({ name: '', className: 'double', dimensions: [rows, cols], isComplex: false, isLogical: false, isSparse: true, value, fields: null }),
  });

  it('and no grid: the Parameter shows the value, whose rows are none', () => {
    const p = parameter(stream(2, 2, [0, 0, 0, 0]));
    const value = p._valueNode;
    expect([p.displayValue, p.children, value.isSparse, value.children.length, value.displayElements()]).toEqual([
      '<2x2 sparse double>',
      [],
      true,
      0,
      null,
    ]);
    // And the structure-change hook, which re-decides the row, adds none.
    p.childStructureChanged(value);
    expect(p.children).toEqual([]);
    // One with a non-zero has its row, for that non-zero.
    const one = parameter(stream(2, 2, [0, 3, 0, 0]));
    expect(rows(one._valueNode)).toEqual([['Value(1,2)', '3']]);
    expect(one.children).toEqual([one._valueNode]);
  });

  it('a full scalar Value still has none', () => {
    expect(parameter(5).children).toEqual([]);
  });
});

describe('a sparse array typed over with a full value forgets where its rows were', () => {
  it('its element rows are its elements again, and an edit lands on the one it names', () => {
    // A whole value typed in is the full array MATLAB makes of the literal, whose rows are
    // every element. A sparse array's rows are its non-zeros (_sparse); left set, the first
    // row's edit went to the first NON-ZERO.
    const node = open([sparseVar({ name: 'r', dimensions: [1, 5], ir: [0, 0], jc: [0, 0, 1, 1, 2, 2], real: [2, 4] })]).children[0];
    expect(node.setProperty('Value', '[1 2 3]')).toBe(true);
    expect([node.isSparse, rows(node)]).toEqual([false, [['r(1)', '1'], ['r(2)', '2'], ['r(3)', '3']]]);
    expect(node.children[0].setProperty('Value', '9')).toBe(true);
    // `_elements` is the copy that outlives the rows: a removal collapses the array to
    // it, and undo restores from it.
    expect([node.Value, node._elements]).toEqual([
      [9, 2, 3],
      [9, 2, 3],
    ]);
  });
});
