// Copyright 2026 The MathWorks, Inc.
//
// MatlabVariableNode built from a .mat/.slx-workspace variable, and turned back
// into one for the save path. This is the `MatVariable` <-> node boundary, which
// is a different code path from the .sldd serial form covered by
// matlabVariableNode.test.ts: the statics here (_createFromMatNumeric,
// _createFromMatChar, _createFromMatStruct, _createFromMatCell, _createOpaque,
// createFromMcosDecoded) read a parsed binary variable, and `_var` writes one.
//
// What makes `_var` worth testing hard is that it is the ONLY thing the writers
// read: MatNode.getVariables() collects it for a .mat, and ModelNode.serialize()
// splices it into the .slx model workspace. Whatever it returns is what lands in
// the file, so a wrong answer here is silent data loss on save rather than a
// display glitch.
//
// Three real defects were found here and are pinned below, all marked REGRESSION:
//   1. `_var` served the parser's snapshot even after the user edited a CHILD, so
//      struct-field and cell-element edits were written back at their ORIGINAL
//      values. Numeric arrays escaped only by an aliasing accident.
//   2. Rebuilding a struct ARRAY's fields dropped every element after the first.
//   3. A cell slot the parser could not read was skipped rather than kept as a
//      hole, sliding every later element one position early in both the display
//      and the saved file.

import { describe, it, expect } from 'vitest';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import type { MatVariable } from '../src/datamodel/node/data/MatlabVariableNode.js';
import ModelNode from '../src/datamodel/node/container/ModelNode.js';
import type { ParsedSlx } from '../src/datamodel/node/container/ModelNode.js';
import { createSession } from '../src/index.js';
import { CLASS, MI, matFile, numericVar, structVar, charVar, matrix, arrayFlags, dims, varName } from './tools/matBytes.js';

// A MatVariable with the scalar-double defaults, overridden per test. Building
// these by hand (rather than always going through real .mat bytes) is what lets a
// test name one shape — complex, empty, logical, a cell hole — without also
// encoding a whole file.
function mv(over: Partial<MatVariable>): MatVariable {
  return {
    name: 'v',
    className: 'double',
    dimensions: [1, 1],
    isComplex: false,
    isLogical: false,
    value: null,
    fields: null,
    ...over,
  };
}

const parse = (over: Partial<MatVariable>) => MatlabVariableNode.parseMatVariable(mv(over), 'v', null);
const num = (value: number) => mv({ name: '', value });
const kids = (n: MatlabVariableNode) => n.children.map((c) => [c.name, c.displayValue]);

// _rawBytes is a Uint8Array of file bytes; it carries no information a value
// assertion wants and serializes to a 60-key object, so drop it.
const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, val) => (k === '_rawBytes' ? undefined : val)));

// ---- real-bytes helpers, for the tests that must go through the true parser ----
const dbl = (name: string, real: number[], dimensions: number[]) =>
  numericVar({ name, cls: CLASS.DOUBLE, dimensions, real });
const cellOf = (name: string, cells: Uint8Array[], d: number[]) =>
  matrix([arrayFlags(CLASS.CELL), dims(d), varName(name), ...cells]);

function matSource(elements: Uint8Array[]) {
  const session = createSession();
  return session.addMatSource('t.mat', matFile(elements)) as unknown as {
    children: MatlabVariableNode[];
    getVariables(): MatVariable[];
  };
}

describe('MatlabVariableNode from a .mat numeric variable', () => {
  it('reads a complex scalar as one signed a+bi value', () => {
    // MATLAB stores the real and imaginary parts as two separate payloads; the node
    // holds the assembled literal, which is also what the user types to edit it.
    expect(parse({ isComplex: true, value: [{ re: 1, im: 2 }] }).displayValue).toBe('1+2i');
    expect(parse({ isComplex: true, value: [{ re: 1, im: -2 }] }).displayValue).toBe('1-2i');
  });

  it('calls a complex scalar a numeric double, so a Constant will take it', () => {
    const node = parse({ isComplex: true, value: [{ re: 1, im: 2 }] });
    expect(node.className).toBe('double');
    expect(node.isScalarNumeric).toBe(true);
  });

  it('reads a complex array into one child per element', () => {
    const node = parse({ isComplex: true, dimensions: [1, 2], value: [{ re: 1, im: 2 }, { re: 3, im: -4 }] });
    expect(node.displayValue).toBe('[1+2i 3-4i]');
    expect(kids(node)).toEqual([['1', '1+2i'], ['2', '3-4i']]);
  });

  it('keeps an empty array shaped, and shows it as [ ]', () => {
    // The declared dimensions are the only record of a 0x3's orientation, so they
    // must survive even though there is no element to display.
    //
    // '[ ]', with the space, is the display convention's empty spelling. The old
    // '[]' looked right because that is what mat2str writes, but the identical
    // empty value on the object-property path has always shown '[ ]' — one value,
    // two spellings, depending on which parser produced it.
    const node = parse({ dimensions: [0, 3], value: [] });
    expect(node.dims).toEqual([0, 3]);
    expect(node.elements).toEqual([]);
    expect(node.displayValue).toBe('[ ]');
    expect(node.children).toHaveLength(0);
  });

  it('reads a logical scalar as a checkbox-icon true/false, not 1/0', () => {
    const node = parse({ isLogical: true, className: 'uint8', value: 1 });
    expect([node.icon, node.displayValue, node.Value]).toEqual(['wsCheck', 'true', true]);
    expect(node.arrayType).toBe('logical');
  });

  it('stores a logical array as 1/0 but displays it as true/false, rows included', () => {
    // The stored elements stay numeric — 1/0 is the representation the container's
    // display, its _var snapshot, and the typed literal all read — while the element
    // ROWS are logicals like the array itself, so they read true/false and carry the
    // checkbox icon rather than exposing the storage form.
    const node = parse({ isLogical: true, className: 'uint8', dimensions: [1, 3], value: [1, 0, 1] });
    expect(node.Value).toEqual([1, 0, 1]);
    expect([node.displayValue, node.icon]).toEqual(['[true false true]', 'wsCheck']);
    expect(kids(node)).toEqual([['1', 'true'], ['2', 'false'], ['3', 'true']]);
    expect(node.children.map((c) => [c.dataType, c.icon])).toEqual([
      ['logical', 'wsCheck'],
      ['logical', 'wsCheck'],
      ['logical', 'wsCheck'],
    ]);
  });

  it('keeps an integer class as the data type rather than widening to double', () => {
    const node = parse({ className: 'int16', dimensions: [1, 3], value: [1, 2, 3] });
    expect([node.className, node.dataType, node.arrayType]).toEqual(['int16', 'int16', 'int16']);
  });
});

describe('MatlabVariableNode from a .mat char, struct or cell', () => {
  it('reads a char row as a single quoted string keeping its declared width', () => {
    const node = parse({ className: 'char', dimensions: [1, 5], value: 'hello' });
    expect([node.icon, node.displayValue, node.dims]).toEqual(['wsCharacter', "'hello'", [1, 5]]);
    // A char is text, not a number, so it must not satisfy the Constant gate.
    expect(node.isScalarNumeric).toBe(false);
  });

  it('substitutes empty text for a char with no payload', () => {
    // A 0x0 char parses with a null value; carrying that through would render the
    // word "null" in the table.
    expect(parse({ className: 'char', dimensions: [0, 0], value: null }).displayValue).toBe("''");
  });

  it('reads a struct as a tree of its fields, with no value of its own', () => {
    const node = parse({ className: 'struct', fields: { a: num(1), b: num(2) } });
    expect([node.icon, node.displayValue]).toEqual(['wsTree', '<1x1 struct>']);
    expect(kids(node)).toEqual([['a', '1'], ['b', '2']]);
    // A struct has no scalar to type into, so the Value cell offers no editor.
    expect(node.valueEditable).toBe(false);
  });

  it('models a struct ARRAY as one row per ELEMENT, each holding its own fields', () => {
    // Each field of a 1xN struct parses as N variables. This used to show one row
    // per FIELD, which could speak for element 1 alone: st(2).a was invisible in
    // the tree and replayed from the parse snapshot on save. Now the elements are
    // the rows, subscript-labelled, and the fields hang beneath them.
    const node = parse({ className: 'struct', dimensions: [1, 2], fields: { a: [num(1), num(2)] } });
    expect(kids(node)).toEqual([['1', '<1x1 struct>'], ['2', '<1x1 struct>']]);
    expect(node.children.map((c) => c.displayName)).toEqual(['v(1)', 'v(2)']);
    expect(node.children.map((c) => kids(c as MatlabVariableNode))).toEqual([[['a', '1']], [['a', '2']]]);
    expect(node.displayValue).toBe('<1x2 struct>');
  });

  it('reads a fieldless struct as an empty tree rather than failing', () => {
    const node = parse({ className: 'struct', fields: null });
    expect(node.children).toHaveLength(0);
    expect(node.displayValue).toBe('<1x1 struct>');
  });

  it('reads a cell into per-element children of their own types', () => {
    const node = parse({
      className: 'cell',
      dimensions: [1, 2],
      value: [num(1), mv({ name: '', className: 'char', value: 'x', dimensions: [1, 1] })],
    });
    expect([node.icon, node.displayValue]).toEqual(['wsBrackets', "{1, 'x'}"]);
    expect(kids(node)).toEqual([['1', '1'], ['2', "'x'"]]);
  });

  it('shows a cell whose value is not an array as { }', () => {
    const node = parse({ className: 'cell', dimensions: [0, 0], value: null });
    // '{ }' is the convention's empty-cell spelling; see DESIGN.md.
    expect(node.displayValue).toBe('{ }');
    expect(node.children).toHaveLength(0);
  });

  it('REGRESSION: keeps an unreadable cell slot as a hole, so later elements stay put', () => {
    // A slot MatParser could not read comes through as null. Dropping it compacted
    // the children while _dims kept the declared 1x3, so `{[], 2, 3}` rendered as
    // `{2, 3, []}` — every element one position early, in the display AND in the
    // cell rebuilt for the save path.
    const node = parse({ className: 'cell', dimensions: [1, 3], value: [null, num(2), num(3)] });
    // '[ ]' not '[]': the empty slot renders through the display convention now.
    expect(node.displayValue).toBe('{[ ], 2, 3}');
    expect(kids(node)).toEqual([['1', '[ ]'], ['2', '2'], ['3', '3']]);
  });

  it('REGRESSION: keeps a hole in the middle of a 2-D cell in its own slot', () => {
    // The element list is COLUMN-major, which is what MatParser's cell branch
    // produces: [1, null, 3, 4] at 2x2 is (1,1)=1 (2,1)=[] (1,2)=3 (2,2)=4, so
    // the literal reads {1, 3; [], 4}. This used to expect {1, []; 3, 4}, a
    // row-major reading -- invisible on a square fixture until you check WHICH
    // slot the hole lands in. MATLAB's own non-square cell2x3 settles the order
    // (see test/cellElementOrder.test.ts). The point of the test is unchanged:
    // the hole stays in exactly one slot instead of shifting its neighbours.
    const node = parse({ className: 'cell', dimensions: [2, 2], value: [num(1), null, num(3), num(4)] });
    expect(node.displayValue).toBe('{1, 3; [ ], 4}');
  });
});

describe('MatlabVariableNode from an opaque MCOS variable', () => {
  it('shows the class name as Class, and leaves the DataType column empty', () => {
    // className here is an object class ('Simulink.Parameter'), not a data type, so
    // it must not leak into the type-only column.
    const node = parse({ isOpaque: true, className: 'Simulink.Parameter' });
    expect([node.className, node.dataType]).toEqual(['Simulink.Parameter', '']);
    expect(node.icon).toBe('wsParameters');
    // Nothing about an undecoded object is editable through the value cell.
    expect(node.valueEditable).toBe(false);
    expect(node.isScalarNumeric).toBe(false);
  });

  it('falls back to the default icon for a class it does not know', () => {
    expect(parse({ isOpaque: true, className: 'Some.Other.Class' }).icon).toBe('wsDefault');
  });

  it('shows a dimension summary when the object has no decoded value', () => {
    expect(parse({ isOpaque: true, className: 'C' }).displayValue).toBe('<1x1 C>');
  });

  const decoded = (value: unknown, dimensions: number[] | null) =>
    MatlabVariableNode.createFromMcosDecoded(
      mv({ name: 'm', className: 'C', isOpaque: true }),
      { value, properties: {}, dimensions: dimensions as number[] },
      null,
    ).displayValue;

  it('shows a decoded scalar value bare, and decoded text quoted', () => {
    expect(decoded(42, [1, 1])).toBe('42');
    expect(decoded('txt', [1, 1])).toBe("'txt'");
  });

  it('falls back to the dimension summary for an empty or absent decoded value', () => {
    // Empty text would otherwise render as a pair of bare quotes, which reads as a
    // real (empty) value rather than "nothing was recovered".
    expect(decoded('', [1, 1])).toBe('<1x1 C>');
    expect(decoded(null, [1, 1])).toBe('<1x1 C>');
  });

  it('summarizes a decoded object array by its extent and class', () => {
    // Angle brackets, not the old '[3x1 C]'. Square brackets read as a MATLAB
    // literal, so the consumer table styled this summary as ordinary editable
    // text while the '<1x1 C>' placeholder two tests up came out gray and
    // read-only — one concept, two renderings.
    expect(decoded([1, 2, 3], [3, 1])).toBe('<3x1 C>');
    // With no decoded dimensions, the element count stands in for the shape.
    expect(decoded([1, 2], null)).toBe('<1x2 C>');
  });

  it('reports the object class rather than the MATLAB storage class in _var', () => {
    const node = parse({ isOpaque: true, className: 'Simulink.Parameter' });
    expect(plain(node._var)).toEqual({
      name: 'v',
      className: 'Simulink.Parameter',
      dimensions: [1, 1],
      isComplex: false,
      isLogical: false,
      value: null,
      fields: null,
      isOpaque: true,
    });
  });
});

describe('MatlabVariableNode._var — rebuilding the variable for the save path', () => {
  // Each case drops the parsed snapshot so _buildVarObject has to reconstruct the
  // variable from the live tree alone — which is exactly what happens after an edit.
  function rebuilt(node: MatlabVariableNode): unknown {
    node._matVar = null;
    return plain(node._var);
  }

  it('re-splits a complex scalar back into re/im parts', () => {
    expect(rebuilt(parse({ isComplex: true, value: [{ re: 1, im: 2 }] }))).toMatchObject({
      className: 'double',
      isComplex: true,
      value: [{ re: 1, im: 2 }],
    });
  });

  it('re-splits every element of a complex array, keeping the signs', () => {
    const node = parse({ isComplex: true, dimensions: [1, 2], value: [{ re: 1, im: 2 }, { re: 3, im: -4 }] });
    expect(rebuilt(node)).toMatchObject({ isComplex: true, value: [{ re: 1, im: 2 }, { re: 3, im: -4 }] });
  });

  it('writes a logical back as uint8 with the logical flag set', () => {
    // MATLAB has no 'logical' storage class: the flag is what makes it logical, and
    // losing it would turn true/false into a numeric 1/0 column on reload. The
    // value goes out as a JS boolean, which is what the node holds — note this
    // differs from a logical ARRAY, whose elements normalize to 1/0
    // (_createFromMatNumeric). Both are accepted by the writers; pinned here so a
    // future attempt to unify them is a deliberate change rather than a surprise.
    expect(rebuilt(parse({ isLogical: true, className: 'uint8', value: 1 }))).toMatchObject({
      className: 'uint8',
      isLogical: true,
      value: true,
    });
  });

  it('re-measures a char from the text actually held, not the parsed width', () => {
    const node = parse({ className: 'char', dimensions: [1, 5], value: 'hello' });
    expect(rebuilt(node)).toMatchObject({ className: 'char', value: 'hello', dimensions: [1, 5] });
  });

  it('rebuilds a struct from its field children', () => {
    const node = parse({ className: 'struct', fields: { a: num(1) } });
    expect(rebuilt(node)).toMatchObject({ className: 'struct', fields: { a: { value: 1 } } });
  });

  it('rebuilds a cell from its element children', () => {
    const node = parse({ className: 'cell', dimensions: [1, 1], value: [num(7)] });
    expect(rebuilt(node)).toMatchObject({ className: 'cell', value: [{ value: 7 }] });
  });

  it('collapses a one-element array back to a bare value', () => {
    const node = parse({ dimensions: [1, 3], value: [1, 2, 3] });
    expect(rebuilt(node)).toMatchObject({ value: [1, 2, 3] });
  });
});

describe('MatlabVariableNode — the Value accessor', () => {
  it('sets a scalar, and refuses to reshape an array through the same door', () => {
    // The setter exists for scalars only; an array's values live in its children,
    // so a bare assignment has nothing coherent to do and must not half-apply.
    const scalar = parse({ value: 5 });
    scalar.Value = 9;
    expect(scalar.Value).toBe(9);

    const array = parse({ dimensions: [1, 2], value: [1, 2] });
    array.Value = 99;
    expect(array.Value).toEqual([1, 2]);
  });

  it('reads an array through its children, so an edited element is what it returns', () => {
    const node = parse({ dimensions: [1, 3], value: [1, 2, 3] });
    (node.children[1] as MatlabVariableNode).setProperty('Value', '42');
    expect(node.Value).toEqual([1, 42, 3]);
  });
});

// The bug that motivated most of this file. `_var` is what the writers read, and
// it used to return the parser's snapshot forever — so an edit to anything BELOW
// the variable node was written back at its original value. These go through real
// .mat bytes and the real session API, because the point is what the save path
// actually collects.
describe('MatlabVariableNode._var — REGRESSION: an edit below the variable must reach the save path', () => {
  it('writes an edited struct FIELD back with its new value', () => {
    const mat = matSource([structVar('st', ['a'], [{ a: dbl('', [1], [1, 1]) }])]);
    const struct = mat.children[0];
    expect(struct.children[0].setProperty('Value', '77')).toBe(true);
    expect(struct.children[0].displayValue).toBe('77');
    // Before the fix this was still 1: the display showed the edit, the file did not.
    expect(plain(mat.getVariables()[0].fields)).toMatchObject({ a: { value: 77 } });
  });

  it('writes an edited CELL element back with its new value', () => {
    const mat = matSource([cellOf('c', [dbl('', [1], [1, 1]), dbl('', [2], [1, 1])], [1, 2])]);
    const cell = mat.children[0];
    expect(cell.children[0].setProperty('Value', '55')).toBe(true);
    expect(cell.displayValue).toBe('{55, 2}');
    expect((plain(mat.getVariables()[0].value) as { value: unknown }[]).map((c) => c.value)).toEqual([55, 2]);
  });

  it('writes an edit nested two levels down — a field of a struct inside a cell', () => {
    const mat = matSource([cellOf('c', [structVar('', ['a'], [{ a: dbl('', [1], [1, 1]) }])], [1, 1])]);
    const field = mat.children[0].children[0].children[0] as MatlabVariableNode;
    expect(field.setProperty('Value', '88')).toBe(true);
    const saved = plain(mat.getVariables()[0].value) as { fields: { a: { value: unknown } } }[];
    expect(saved[0].fields.a.value).toBe(88);
  });

  it('marks the variable modified so the writer knows to re-encode it', () => {
    // The .slx workspace splice is gated on _modified: an edit that leaves it false
    // is dropped even when the value is right.
    const mat = matSource([dbl('v', [1, 2, 3], [1, 3])]);
    (mat.children[0].children[1] as MatlabVariableNode).setProperty('Value', '99');
    expect(mat.getVariables()[0]._modified).toBe(true);
  });

  it('still hands back the untouched parsed variable when nothing was edited', () => {
    // The snapshot is what lets an untouched variable round-trip through its own
    // bytes, so invalidating it unconditionally would be its own regression.
    const mat = matSource([dbl('v', [1, 2, 3], [1, 3])]);
    const node = mat.children[0];
    expect(node._var).toBe(node._matVar);
    expect(mat.getVariables()[0]._modified).toBeFalsy();
  });

  it('REGRESSION: keeps the later elements of a struct ARRAY when one is edited', () => {
    // A naive rebuild spoke for one element alone and turned a 1x2 struct into a
    // 1x1 — losing st(2) entirely on the first edit anywhere. The edited field now
    // sits under an ELEMENT row (st(1).a rather than st.a), which is the shape that
    // let the replay-from-snapshot compensation go; the claim is unchanged.
    const mat = matSource([
      structVar('st', ['a'], [{ a: dbl('', [1], [1, 1]) }, { a: dbl('', [2], [1, 1]) }], [1, 2]),
    ]);
    const struct = mat.children[0];
    struct.children[0].children[0].setProperty('Value', '11');
    const fields = plain(mat.getVariables()[0].fields) as { a: { value: unknown }[] };
    expect(fields.a).toHaveLength(2);
    expect(fields.a.map((el) => el.value)).toEqual([11, 2]);
    expect(mat.getVariables()[0].dimensions).toEqual([1, 2]);
  });

  it('rebuilds a char variable after a whole-value edit', () => {
    const mat = matSource([charVar('t', 'ab', MI.UINT16)]);
    expect(mat.children[0].setProperty('Value', "'zz'")).toBe(true);
    expect(plain(mat.getVariables()[0])).toMatchObject({ className: 'char', value: 'zz', dimensions: [1, 2] });
  });
});

// The .slx model workspace is the other writer, and it reads `_var` through a
// _modified gate rather than replacing the variable wholesale — so it can fail in
// a way the .mat path does not.
describe('ModelNode workspace — REGRESSION: an edited workspace variable reaches serialize()', () => {
  function wsModel(value: unknown, dimensions: number[]) {
    const workspace = [
      { name: 'v', className: 'double', dimensions, isComplex: false, isLogical: false, value, fields: null },
    ] as MatVariable[] & { _trailingElements: Uint8Array[] };
    workspace._trailingElements = [];
    const parsed = {
      name: 'm.slx', release: 'R2026b', creator: 'me', lastModified: '', uuid: 'u1',
      dataDictionary: null, modelReferences: [], externalDataSources: [], configSets: [],
      workspace, blockParamUsages: [], rawContents: null,
      zipEntries: { 'simulink/blockdiagram.xml': new Uint8Array([60, 120, 47, 62]) },
    } as unknown as ParsedSlx;
    const model = ModelNode.fromParsed(parsed, 'm.slx');
    return { model, workspace };
  }

  it('carries an edited element into the spliced workspace variable', () => {
    const { model, workspace } = wsModel([1, 2, 3], [1, 3]);
    const node = model.getSection('workspace')!.children[0] as MatlabVariableNode;
    expect(node.children[1].setProperty('Value', '99')).toBe(true);
    model.serialize();
    expect(workspace[0].value).toEqual([1, 99, 3]);
    // The splice is gated on this flag; false here means the new value never gets
    // re-encoded no matter what `value` holds.
    expect(workspace[0]._modified).toBe(true);
  });

  it('leaves an untouched workspace variable alone', () => {
    const { model, workspace } = wsModel([1, 2, 3], [1, 3]);
    model.serialize();
    expect(workspace[0].value).toEqual([1, 2, 3]);
    expect(workspace[0]._modified).toBeFalsy();
  });
});
