// Copyright 2026 The MathWorks, Inc.
//
// MatlabVariableNode is the workhorse leaf of every .sldd/.mat/.slx tree: the
// node behind a plain MATLAB variable of any shape. It is really a small state
// machine over `_kind` ('scalar' | 'array' | 'cell' | 'string'), and each kind
// has its own display formatter, JSON serializer, XML serializer, and mutation
// path. That fan-out is what this suite pins: what a given raw value parses to,
// what the table then shows, and what comes back out on save.
//
// Two invariants recur and are worth stating once:
//
//   • `_elements` and the child nodes are two copies of the same data. The
//     children back the table rows; `_elements` backs displayValue, the `Value`
//     getter, `_var`, and the value that survives a collapse or an undo. A
//     mutation that updates one and not the other shows the user a value that
//     is not the value that gets saved.
//   • MATLAB spells the non-finite numbers Inf/-Inf/NaN, never JavaScript's
//     'Infinity'. MatlabValueParser rejects the JS spelling by design, so a cell
//     displayed as 'Infinity' is also an uneditable one, and 'Infinity' written
//     to a .sldd is a value MATLAB cannot evaluate.
import { describe, it, expect } from 'vitest';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import '../src/datamodel/node/NodeClassMap.js';

// These tests reach into the node's internal state (_kind, _elements, _dims) on
// purpose: that state is the contract each mutation path has to keep consistent,
// and asserting only on the public surface would let a stale copy slip through.
type Any = any;

const parse = (raw: unknown, name = 'v'): Any => MatlabVariableNode.parse(raw, name, null);

describe('MatlabVariableNode.parse — raw shape to _kind', () => {
  it('reads a bare JS primitive as a scalar of the matching MATLAB type', () => {
    expect([parse(3.14)._kind, parse(3.14)._scalarType]).toEqual(['scalar', 'double']);
    expect(parse(true)._scalarType).toBe('logical');
    expect(parse('hello')._scalarType).toBe('char');
  });

  it('substitutes 0 for a null or undefined value rather than carrying it', () => {
    // A missing value must still be an editable numeric cell, not a hole that
    // formats as 'null' and fails to parse back.
    expect([parse(null)._scalarValue, parse(undefined)._scalarValue]).toEqual([0, 0]);
  });

  it('reads a flat JS array as a row-vector array with one child per element', () => {
    const n = parse([1, 2, 3]);
    expect([n._kind, n._dims, n.children.length]).toEqual(['array', [1, 3], 3]);
  });

  it('leaves a single-element array childless, since one row would be noise', () => {
    const n = parse([7]);
    expect([n._kind, n._elements, n.children.length]).toEqual(['array', [7], 0]);
  });

  it('reads an all-strings array as a string array', () => {
    const n = parse(['a', 'b']);
    expect([n._kind, n._scalarType, n._dims, n.children.length]).toEqual(['string', 'string', [1, 2], 2]);
  });

  it('reads a typed scalar literal, stripping the F/U type suffix', () => {
    expect(parse({ _type: 'single', _value: '1.5F' })._scalarValue).toBe(1.5);
    expect(parse({ _type: 'uint8', _value: '200U' })._scalarValue).toBe(200);
    expect(parse({ _type: 'logical', _value: '1' })._scalarValue).toBe(true);
  });

  it('reads a bracketed typed literal as a vector', () => {
    const n = parse({ _type: 'int32', _value: '[1, 2, 3]' });
    expect([n._kind, n._elements, n._dims]).toEqual(['array', [1, 2, 3], [1, 3]]);
  });

  it('reads a logical vector as 1/0 elements', () => {
    expect(parse({ _type: 'logical', _value: '[1, 0, true, false]' })._elements).toEqual([1, 0, 1, 0]);
  });

  it('reads a Matrix(r,c) literal, keeping the row/column shape', () => {
    const n = parse({ _type: 'double', _value: 'Matrix(2,2)\n[1, 2]\n[3, 4]' });
    expect([n._kind, n._dims, n._elements]).toEqual(['array', [2, 2], [1, 2, 3, 4]]);
  });

  it('falls back to an empty array when a Matrix header is malformed', () => {
    const n = parse({ _type: 'double', _value: 'Matrix(bogus)\n[1]' });
    expect([n._kind, n._elements, n._dims]).toEqual(['array', [], [0, 0]]);
  });

  it('reads the _emptyDims form as a shaped empty array', () => {
    const n = parse({ _type: 'double', _emptyDims: [0, 3] });
    expect([n._kind, n._elements, n._dims]).toEqual(['array', [], [0, 3]]);
  });

  it('reads a Cell container into per-element children of their own types', () => {
    const n = parse({ _array_type: 'Cell', _dimensions: [1, 2], _elements: [1, 'two'] });
    expect(n._kind).toBe('cell');
    expect(n.children.map((c: Any) => c._scalarType)).toEqual(['double', 'char']);
  });

  it('reads a String container into string-kind children', () => {
    const n = parse({ _array_type: 'String', _dimensions: [1, 2], _elements: ['a', 'b'] });
    expect([n._kind, n._elements]).toEqual(['string', ['a', 'b']]);
    expect(n.children.map((c: Any) => c._kind)).toEqual(['string', 'string']);
  });
});

describe('MatlabVariableNode — displayValue per kind', () => {
  it('shows a char in single quotes and a string in double quotes', () => {
    expect(parse('hi').displayValue).toBe("'hi'");
    expect(parse({ _array_type: 'String', _dimensions: [1, 1], _elements: ['hi'] }).displayValue).toBe('"hi"');
  });

  it('shows a logical as true/false, not 1/0', () => {
    expect(parse(true).displayValue).toBe('true');
    expect(parse(false).displayValue).toBe('false');
  });

  it('shows a row vector space-separated and a matrix semicolon-separated', () => {
    expect(parse([1, 2, 3]).displayValue).toBe('[1 2 3]');
    expect(parse({ _type: 'double', _value: 'Matrix(2,2)\n[1, 2]\n[3, 4]' }).displayValue).toBe('[1 2; 3 4]');
  });

  it('shows a logical array as true/false elements', () => {
    expect(parse({ _type: 'logical', _value: '[1, 0]' }).displayValue).toBe('[true false]');
  });

  it('shows an empty array as [] and an empty cell as {}', () => {
    expect(parse({ _type: 'double', _emptyDims: [0, 0] }).displayValue).toBe('[]');
    expect(parse({ _array_type: 'Cell', _dimensions: [0, 0], _elements: [] }).displayValue).toBe('{}');
  });

  it('summarizes a long cell or string array by its dimensions', () => {
    // A cell that would render longer than the column can show becomes a
    // {RxC cell} summary rather than truncated garbage.
    const longs = Array.from({ length: 8 }, (_, i) => 'element_' + i);
    expect(parse({ _array_type: 'Cell', _dimensions: [1, 8], _elements: longs }).displayValue).toBe('{1x8 cell}');
    expect(parse({ _array_type: 'String', _dimensions: [1, 8], _elements: longs }).displayValue).toBe('<1x8 string>');
  });

  it('shows a struct by its dimensions, since it has no inline value', () => {
    const n = parse(0);
    n._scalarType = 'struct';
    expect(n.displayValue).toBe('<1x1 struct>');
  });

  it('prefers the live children over _elements, so an edit is visible', () => {
    const n = parse([1, 2, 3]);
    n.children[1]._scalarValue = 99;
    expect(n.displayValue).toBe('[1 99 3]');
  });
});

describe('MatlabVariableNode — non-finite values survive display and save', () => {
  // MatlabValueParser accepts 'Inf'/'-Inf'/'NaN' and deliberately rejects
  // 'Infinity'. Showing the JS spelling therefore makes a real value uneditable:
  // the user cannot type back what the table shows them.
  it('reads a non-finite typed scalar and shows it the MATLAB way', () => {
    for (const [literal, value, shown] of [
      ['Inf', Infinity, 'Inf'],
      ['-Inf', -Infinity, '-Inf'],
    ] as const) {
      const n = parse({ _type: 'double', _value: literal });
      expect(n._scalarValue).toBe(value);
      expect(n.displayValue).toBe(shown);
    }
    const nan = parse({ _type: 'double', _value: 'NaN' });
    expect(nan._scalarValue).toBeNaN();
    expect(nan.displayValue).toBe('NaN');
  });

  it('reads a non-finite element of a typed vector without zeroing it', () => {
    // `parseFloat('Inf') || 0` is 0 — the reader must recognise the spelling.
    const n = parse({ _type: 'double', _value: '[1, Inf, -Inf]' });
    expect(n._elements).toEqual([1, Infinity, -Infinity]);
    expect(n.displayValue).toBe('[1 Inf -Inf]');
  });

  it('reads a non-finite element of a matrix without dropping it', () => {
    // A digits-only element pattern would skip 'Inf' entirely, shifting every
    // later element one slot left and corrupting the whole matrix.
    const n = parse({ _type: 'double', _value: 'Matrix(2,2)\n[1, Inf]\n[NaN, 4]' });
    expect(n._elements[0]).toBe(1);
    expect(n._elements[1]).toBe(Infinity);
    expect(n._elements[2]).toBeNaN();
    expect(n._elements[3]).toBe(4);
  });

  it('round-trips a non-finite scalar back out as a typed literal, not JSON null', () => {
    // JSON.stringify(Infinity) is `null`, which reads back as 0. The typed form
    // is the format's own escape hatch for a value a bare number cannot carry.
    const n = parse(0);
    n._scalarValue = Infinity;
    n._rawInput = undefined;
    expect(n.serializeValue()).toEqual({ _type: 'double', _value: 'Inf' });
    n._scalarValue = NaN;
    expect(n.serializeValue()).toEqual({ _type: 'double', _value: 'NaN' });
  });

  it('round-trips a non-finite array element as a typed vector', () => {
    const n = parse([1, 2]);
    n.children[1]._scalarValue = -Infinity;
    n._rawInput = undefined;
    expect(n.serializeValue()).toEqual({ _type: 'double', _value: '[1, -Inf]' });
  });

  it('emits the MATLAB spelling into XML, which MATLAB can read back', () => {
    const n = parse({ _type: 'double', _value: 'Inf' });
    expect(n.serializeXml('P', {}, 0)).toBe('<P Class="double">Inf</P>');
    expect(parse({ _type: 'double', _value: '[1, NaN]' }).serializeXml('P', {}, 0)).toBe(
      '<P Class="double" Dimension="1*2">1.0 NaN</P>',
    );
  });

  it('accepts a typed edit of Inf, so the shown value is also a valid input', () => {
    const n = parse(1);
    expect(n.setProperty('Value', 'Inf')).toBe(true);
    expect(n._scalarValue).toBe(Infinity);
    expect(n.displayValue).toBe('Inf');
  });
});

describe('MatlabVariableNode — editing an element of an array', () => {
  it('keeps _elements in step with the edited child', () => {
    // The children back the table rows but _elements backs displayValue, .Value,
    // and the value that survives a collapse — a stale slot silently reverts the
    // edit later.
    const n = parse([1, 2, 3]);
    expect(n.children[1].setProperty('Value', '99')).toBe(true);
    expect(n._elements).toEqual([1, 99, 3]);
    expect(n.displayValue).toBe('[1 99 3]');
    expect(n.Value).toEqual([1, 99, 3]);
  });

  it('keeps a string array in step too, where the display reads from _elements', () => {
    const n = parse({ _array_type: 'String', _dimensions: [1, 2], _elements: ['a', 'b'] });
    expect(n.children[0].setProperty('Value', '"z"')).toBe(true);
    expect(n._elements).toEqual(['z', 'b']);
    expect(n.displayValue).toBe('["z" "b"]');
  });

  it('rejects a non-scalar-number for an array element', () => {
    const n = parse([1, 2]);
    const res: Any = n.children[0].setProperty('Value', "'text'");
    expect(res).toMatchObject({ error: true, reason: 'Array elements must be scalar numbers', invalidValue: "'text'" });
    expect(n._elements).toEqual([1, 2]);
  });

  it('rejects a non-string for a string-array element', () => {
    const n = parse({ _array_type: 'String', _dimensions: [1, 2], _elements: ['a', 'b'] });
    const res: Any = n.children[0].setProperty('Value', '42');
    expect(res).toMatchObject({ error: true, reason: 'String elements must be character or string values' });
    expect(n._elements).toEqual(['a', 'b']);
  });

  it('rejects an unparseable expression on a free-standing variable', () => {
    const n = parse(1);
    expect(n.setProperty('Value', '((')).toMatchObject({ error: true, reason: 'Invalid MATLAB expression' });
  });

  it('retypes a free-standing variable to match whatever was typed', () => {
    const n = parse(1);
    n.setProperty('Value', '[1 2; 3 4]');
    expect([n._kind, n._dims]).toEqual(['array', [2, 2]]);
    n.setProperty('Value', "'now text'");
    expect([n._kind, n._scalarType, n._scalarValue]).toEqual(['scalar', 'char', 'now text']);
    n.setProperty('Value', '{1, 2}');
    expect([n._kind, n.children.length]).toEqual(['cell', 2]);
  });

  it('collapses a one-element bracketed edit to a scalar, not a 1x1 array', () => {
    const n = parse([1, 2, 3]);
    n.setProperty('Value', '[5]');
    expect([n._kind, n._scalarValue, n.children.length]).toEqual(['scalar', 5, 0]);
  });
});

describe('MatlabVariableNode — add and remove children', () => {
  it('allows add/remove on a vector but not on a 2-D matrix', () => {
    // Appending to or removing from a matrix would break its rectangular shape.
    const row = parse([1, 2]);
    const matrix = parse({ _type: 'double', _value: 'Matrix(2,2)\n[1, 2]\n[3, 4]' });
    expect([row.canAddChild(), row.canRemoveChild()]).toEqual([true, true]);
    expect([matrix.canAddChild(), matrix.canRemoveChild()]).toEqual([false, false]);
  });

  it('allows neither on a plain scalar, which has no elements', () => {
    const n = parse(5);
    expect([n.canAddChild(), n.canRemoveChild(), n.addChildNode()]).toEqual([false, false, null]);
  });

  it('appends an element and grows the dimensions along the vector axis', () => {
    const row = parse([1, 2]);
    row.addChildNode();
    expect([row._elements, row._dims, row.children.length]).toEqual([[1, 2, 0], [1, 3], 3]);
    const col = parse({ _type: 'double', _value: 'Matrix(2,1)\n[1, 2]' });
    col.addChildNode();
    expect(col._dims).toEqual([3, 1]);
  });

  it('turns an empty array into a struct on first add, since [] has no type yet', () => {
    const empty = parse({ _type: 'double', _emptyDims: [0, 0] });
    const child = empty.addChildNode();
    expect([empty._kind, empty._scalarType, child.name]).toEqual(['scalar', 'struct', 'field']);
  });

  it('gives each added struct field a unique name', () => {
    const s = parse({ _type: 'double', _emptyDims: [0, 0] });
    s.addChildNode();
    s.addChildNode();
    s.addChildNode();
    expect(s.children.map((c: Any) => c.name)).toEqual(['field', 'field1', 'field2']);
  });

  it('appends a string element as a string-kind node, not a nested array', () => {
    const n = parse({ _array_type: 'String', _dimensions: [1, 2], _elements: ['a', 'b'] });
    const child: Any = n.addChildNode();
    expect([child._kind, n._elements]).toEqual(['string', ['a', 'b', '']]);
    // A bare "" element, not [""] — the latter would nest an array in the cell.
    expect(child.serializeValue()).toBe('');
  });

  it('renumbers the surviving rows after a removal', () => {
    const n = parse([1, 2, 3, 4]);
    n.removeChildNode(n.children[1]);
    expect(n.children.map((c: Any) => [c.name, c._scalarValue])).toEqual([
      ['1', 1],
      ['2', 3],
      ['3', 4],
    ]);
    expect(n._elements).toEqual([1, 3, 4]);
  });

  it('ignores a removal of something that is not a child', () => {
    const n = parse([1, 2]);
    n.removeChildNode(parse(9));
    expect(n._elements).toEqual([1, 2]);
  });

  it('collapses to a scalar when the last-but-one element goes', () => {
    // One element is a scalar, not a 1x1 array: it should lose its child row.
    const n = parse([1, 2]);
    n.removeChildNode(n.children[1]);
    expect([n._kind, n._scalarValue, n.children.length, n._dims]).toEqual(['scalar', 1, 0, [1, 1]]);
  });
});

describe('MatlabVariableNode — undo of a removal', () => {
  it('restores the element, the value, and the row order', () => {
    const n = parse([1, 2, 3]);
    const op: Any = n.execRemoveChild(n.children[1]);
    expect(n.displayValue).toBe('[1 3]');
    op.undo();
    expect(n.displayValue).toBe('[1 2 3]');
    expect(n._elements).toEqual([1, 2, 3]);
    expect(n.children.map((c: Any) => [c.name, c._scalarValue])).toEqual([
      ['1', 1],
      ['2', 2],
      ['3', 3],
    ]);
  });

  it('rebuilds both elements when undoing the removal that collapsed the array', () => {
    // The survivor lost its child row on the way down to a scalar; undo has to
    // put that row back as well as the removed one, or the array returns one
    // element short with every row after the insert showing the wrong value.
    const n = parse([1, 2]);
    const op: Any = n.execRemoveChild(n.children[1]);
    expect(n._kind).toBe('scalar');
    op.undo();
    expect([n._kind, n._elements, n._dims]).toEqual(['array', [1, 2], [1, 2]]);
    expect(n.displayValue).toBe('[1 2]');
    expect(n.children.map((c: Any) => [c.name, c._scalarValue])).toEqual([
      ['1', 1],
      ['2', 2],
    ]);
  });

  it('restores the column orientation the collapse discarded', () => {
    // Coming back as a row vector would silently transpose the user's data.
    const n = parse({ _type: 'double', _value: 'Matrix(2,1)\n[1, 2]' });
    const op: Any = n.execRemoveChild(n.children[1]);
    op.undo();
    expect(n._dims).toEqual([2, 1]);
  });

  it('restores the removed element in its original position', () => {
    const n = parse([1, 2, 3]);
    const op: Any = n.execRemoveChild(n.children[0]);
    op.undo();
    expect(n._elements).toEqual([1, 2, 3]);
  });

  it('redoes a removal, and undoes an addition', () => {
    const n = parse([1, 2, 3]);
    const removal: Any = n.execRemoveChild(n.children[2]);
    removal.undo();
    removal.redo();
    expect(n._elements).toEqual([1, 2]);

    const addition: Any = n.execAddChild();
    expect(n._elements).toEqual([1, 2, 0]);
    addition.undo();
    expect(n._elements).toEqual([1, 2]);
  });

  it('undoes the empty-array-to-struct conversion back to an empty array', () => {
    const n = parse({ _type: 'double', _emptyDims: [0, 0] });
    const op: Any = n.execAddChild();
    expect(n._scalarType).toBe('struct');
    op.undo();
    expect([n._kind, n._scalarType, n._elements, n.children.length]).toEqual(['array', 'double', [], 0]);
  });

  it('returns no operation when the shape forbids the edit', () => {
    const matrix = parse({ _type: 'double', _value: 'Matrix(2,2)\n[1, 2]\n[3, 4]' });
    expect(matrix.execAddChild()).toBeNull();
    expect(matrix.execRemoveChild(matrix.children[0])).toBeNull();
    // A child of another node is not removable from this one.
    const row = parse([1, 2]);
    expect(row.execRemoveChild(parse(9))).toBeNull();
    expect(row.execRemoveChild(undefined)).toBeNull();
  });
});

// The numeric-array mutation path above is well covered; a string array and a
// cell array go through the SAME entry points (removeChildNode /
// restoreChildNode / execAddChild) but branch to their own _update*AfterRemove
// and their own restore arm. Those arms were untested, and both string ones were
// wrong — see the two "used to" comments below. Each kind gets its own coverage
// here rather than being assumed equivalent to the numeric one.
describe('MatlabVariableNode — string-array children', () => {
  const strArray = (elements: string[], dims = [1, elements.length]): Any =>
    parse({ _array_type: 'String', _dimensions: dims, _elements: elements });

  it('parses into one string-kind child per element', () => {
    const n = strArray(['a', 'b', 'c']);
    expect(n._kind).toBe('string');
    expect(n.children.map((c: Any) => [c.name, c._kind, c._scalarValue])).toEqual([
      ['1', 'string', 'a'],
      ['2', 'string', 'b'],
      ['3', 'string', 'c'],
    ]);
    expect(n.displayValue).toBe('["a" "b" "c"]');
  });

  it('leaves a 1x1 string a leaf: no children, and nothing to add or remove', () => {
    const n = parse({ _array_type: 'String', _dimensions: [1, 1], _elements: ['only'] });
    expect([n.children.length, n.canAddChild(), n.canRemoveChild()]).toEqual([0, false, false]);
    expect(n.displayValue).toBe('"only"');
  });

  it('refuses add/remove on a 2-D string matrix, which cannot stay rectangular', () => {
    const n = strArray(['a', 'b', 'c', 'd'], [2, 2]);
    expect([n.canAddChild(), n.canRemoveChild()]).toEqual([false, false]);
    expect(n.displayValue).toBe('["a" "b"; "c" "d"]');
  });

  it('removes an element from the middle, keeping text and numbering aligned', () => {
    const n = strArray(['a', 'b', 'c']);
    n.removeChildNode(n.children[1]);
    expect(n._elements).toEqual(['a', 'c']);
    expect(n._dims).toEqual([1, 2]);
    expect(n.children.map((c: Any) => [c.name, c._scalarValue])).toEqual([
      ['1', 'a'],
      ['2', 'c'],
    ]);
    expect(n.displayValue).toBe('["a" "c"]');
  });

  it('restores the removed element WITH its text, not as an empty string', () => {
    // restoreChildNode read the element's value only when its _kind was 'scalar',
    // which is right for a numeric array's children but never true for a string
    // array's — those are string-KIND nodes. So the branch always fell to its ''
    // default and an undone element came back blank: the child row still showed
    // "b" while _elements (and so displayValue and the saved file) held "".
    const n = strArray(['a', 'b', 'c']);
    const op: Any = n.execRemoveChild(n.children[1]);
    expect(n.displayValue).toBe('["a" "c"]');
    op.undo();
    expect(n._elements).toEqual(['a', 'b', 'c']);
    expect(n.displayValue).toBe('["a" "b" "c"]');
    // Both copies of the data agree — the children and _elements.
    expect(n.children.map((c: Any) => c._scalarValue)).toEqual(['a', 'b', 'c']);
  });

  it('rebuilds both elements when undoing the removal that collapsed the array', () => {
    // A string array down to one element renders as a scalar string and drops the
    // survivor's child row — but unlike the numeric case it stays _kind 'string',
    // so restoreChildNode's `_kind === 'scalar'` rebuild never fired. Undo came
    // back with two elements but only ONE child row.
    const n = strArray(['a', 'b']);
    const op: Any = n.execRemoveChild(n.children[1]);
    expect([n._elements, n._dims, n.children.length]).toEqual([['a'], [1, 1], 0]);
    expect(n.displayValue).toBe('"a"');
    op.undo();
    expect(n._elements).toEqual(['a', 'b']);
    expect(n.children.map((c: Any) => [c.name, c._kind, c._scalarValue])).toEqual([
      ['1', 'string', 'a'],
      ['2', 'string', 'b'],
    ]);
    expect(n.displayValue).toBe('["a" "b"]');
  });

  it('restores the column orientation the collapse discarded', () => {
    // Coming back as a row would silently transpose the user's data — the same
    // guarantee the numeric path makes via _preCollapseDims.
    const n = strArray(['a', 'b'], [2, 1]);
    expect(n.displayValue).toBe('["a"; "b"]');
    const op: Any = n.execRemoveChild(n.children[1]);
    op.undo();
    expect(n._dims).toEqual([2, 1]);
    expect(n.displayValue).toBe('["a"; "b"]');
  });

  it('appends, undoes, and redoes an element without losing the others', () => {
    const n = strArray(['a', 'b']);
    const op: Any = n.execAddChild();
    expect(n._elements).toEqual(['a', 'b', '']);
    // A structured String container re-serializes as a container, with the grown
    // dimensions — the new element must reach the saved file, not just the tree.
    expect(n.serializeValue()).toEqual({
      _array_type: 'String',
      _mw_element_type: 'MATLABArray',
      _dimensions: [1, 3],
      _elements: ['a', 'b', ''],
    });
    op.undo();
    expect([n._elements, n._dims]).toEqual([['a', 'b'], [1, 2]]);
    op.redo();
    expect(n._elements).toEqual(['a', 'b', '']);
    expect(n.children.map((c: Any) => c._scalarValue)).toEqual(['a', 'b', '']);
  });

  it('reports a fully emptied string array as 1x0', () => {
    // A 1x1 string is a leaf with no removable child, so the only route to zero
    // elements is through the update helper directly. 1x0 (not 0x0) is what the
    // numeric path uses for an emptied vector, and the two must agree.
    const n = strArray(['a', 'b']);
    n._elements = [];
    n._updateStringAfterRemove();
    expect(n._dims).toEqual([1, 0]);
  });
});

describe('MatlabVariableNode — cell-array children', () => {
  const cellArray = (elements: unknown[], dims = [1, elements.length]): Any =>
    parse({ _array_type: 'Cell', _dimensions: dims, _mw_element_type: 'MATLABCell', _elements: elements });

  it('parses each element to a node of its own type', () => {
    const n = cellArray([1, 'two', 3]);
    expect(n._kind).toBe('cell');
    expect(n.displayValue).toBe("{1, 'two', 3}");
  });

  it('refuses add/remove on a 2-D cell matrix', () => {
    const n = cellArray([1, 2, 3, 4], [2, 2]);
    expect([n.canAddChild(), n.canRemoveChild()]).toEqual([false, false]);
  });

  it('removes an element, shrinking both _dims and the serialized dimensions', () => {
    // A cell's element data lives only in its children (there is no _elements
    // mirror), so the dimensions in `serial` are what must be kept in step —
    // a stale _dimensions would make the saved cell disagree with its contents.
    const n = cellArray([1, 'two', 3]);
    n.removeChildNode(n.children[1]);
    expect(n._dims).toEqual([1, 2]);
    expect(n.serial._dimensions).toEqual([1, 2]);
    expect(n.displayValue).toBe('{1, 3}');
  });

  it('restores a removed element with its value and position', () => {
    const n = cellArray([1, 'two', 3]);
    const op: Any = n.execRemoveChild(n.children[1]);
    op.undo();
    expect(n._dims).toEqual([1, 3]);
    expect(n.serial._dimensions).toEqual([1, 3]);
    expect(n.displayValue).toBe("{1, 'two', 3}");
    expect(n.children.map((c: Any) => c.name)).toEqual(['1', '2', '3']);
  });

  it('appends a numeric-zero element and undoes it', () => {
    const n = cellArray([1]);
    const op: Any = n.execAddChild();
    expect(n.children.length).toBe(2);
    expect(n._dims).toEqual([2, 1]);
    expect(n.serial._dimensions).toEqual([2, 1]);
    expect(n.displayValue).toBe('{1; 0}');
    op.undo();
    expect([n.children.length, n._dims]).toEqual([1, [1, 1]]);
  });

  it('goes to 0x0 and {} when the last element is removed', () => {
    // Not [1,0]: an emptied cell is 0x0 in MATLAB, and displayValue reads the
    // child count rather than the dims, so the two must not disagree.
    const n = cellArray([1]);
    n.removeChildNode(n.children[0]);
    expect([n._dims, n.children.length]).toEqual([[0, 0], 0]);
    expect(n.displayValue).toBe('{}');
  });
});

describe('MatlabVariableNode — serializeValue', () => {
  it('returns the untouched raw input while the node is unmodified', () => {
    // Round-tripping the original bytes is lossless; re-deriving them is not.
    const raw = { _type: 'int32', _value: '[1, 2]' };
    expect(parse(raw).serializeValue()).toBe(raw);
  });

  it('re-derives the value once the node is modified', () => {
    const n = parse([1, 2, 3]);
    n.children[0].setProperty('Value', '9');
    expect(n.serializeValue()).toEqual([9, 2, 3]);
  });

  it('writes a scalar string as a one-element array and a complex as cdata', () => {
    const s = parse(0);
    s._scalarType = 'string';
    s._scalarValue = 'hi';
    s._rawInput = undefined;
    expect(s.serializeValue()).toEqual(['hi']);
    s._scalarType = 'complex';
    s._scalarValue = '1+2i';
    expect(s.serializeValue()).toEqual({ _type: 'cdata', _value: '1+2i' });
  });

  it('writes a matrix back as a Matrix(r,c) literal', () => {
    const n = parse({ _type: 'double', _value: 'Matrix(2,2)\n[1, 2]\n[3, 4]' });
    n.children[0].setProperty('Value', '9');
    expect(n.serializeValue()).toEqual({ _type: 'double', _value: 'Matrix(2,2)\n[9, 2]\n[3, 4]' });
  });

  it('writes an empty array as []', () => {
    const n = parse({ _type: 'double', _emptyDims: [0, 0] });
    expect(n.serializeValue()).toEqual([]);
  });

  it('writes a cell and a string array back in their container forms', () => {
    const cell = parse({ _array_type: 'Cell', _dimensions: [1, 2], _elements: [1, 'two'] });
    cell._rawInput = undefined;
    expect(cell.serializeValue()).toEqual({
      _array_type: 'Cell',
      _dimensions: [1, 2],
      _elements: [1, 'two'],
      _mw_element_type: 'MATLABArray',
    });
    const str = parse({ _array_type: 'String', _dimensions: [1, 2], _elements: ['a', 'b'] });
    str._rawInput = undefined;
    expect(str.serializeValue()).toEqual({
      _array_type: 'String',
      _dimensions: [1, 2],
      _elements: ['a', 'b'],
      _mw_element_type: 'MATLABArray',
    });
  });
});

describe('MatlabVariableNode — serializeXml', () => {
  it('appends .0 to an integral double so MATLAB does not read it as an integer', () => {
    expect(parse(2).serializeXml('P', {}, 0)).toBe('<P Class="double">2.0</P>');
  });

  it('emits a char, an empty char, and a logical', () => {
    expect(parse('a & b').serializeXml('P', {}, 0)).toBe('<P Class="char">a &amp; b</P>');
    expect(parse('').serializeXml('P', {}, 0)).toBe('<P Class="char"/>');
    expect(parse(true).serializeXml('P', {}, 0)).toBe('<P Class="logical">1</P>');
    expect(parse(false).serializeXml('P', {}, 0)).toBe('<P Class="logical">0</P>');
  });

  it('rounds an integer-typed value rather than truncating it', () => {
    const n = parse({ _type: 'int32', _value: '2' });
    n._scalarValue = 2.6;
    expect(n.serializeXml('P', {}, 0)).toBe('<P Class="int32">3</P>');
  });

  it('emits an array in MATLAB column-major order', () => {
    // [1 2; 3 4] is stored by MATLAB as 1 3 2 4.
    const n = parse({ _type: 'double', _value: 'Matrix(2,2)\n[1, 2]\n[3, 4]' });
    expect(n.serializeXml('P', {}, 0)).toBe('<P Class="double" Dimension="2*2">1.0 3.0 2.0 4.0</P>');
  });

  it('emits an empty array as a self-closing tag carrying its dimensions', () => {
    expect(parse({ _type: 'double', _emptyDims: [0, 3] }).serializeXml('P', {}, 0)).toBe(
      '<P Class="double" Dimension="0*3"/>',
    );
  });

  it('marks a complex value with IsComplex and makes each part a double', () => {
    const n = parse(0);
    n._scalarType = 'complex';
    n._scalarValue = '1+2i';
    expect(n.serializeXml('P', {}, 0)).toBe('<P Class="double" IsComplex="1">1.0+2.0i</P>');
  });

  it('escapes and carries a Name attribute when one is given', () => {
    expect(parse(1).serializeXml('P', { Name: 'a"b' }, 0)).toBe('<P Name="a&quot;b" Class="double">1.0</P>');
  });

  it('indents by four spaces per level', () => {
    expect(parse(1).serializeXml('P', {}, 2)).toBe('        <P Class="double">1.0</P>');
  });

  it('nests a cell as Element children', () => {
    const n = parse({ _array_type: 'Cell', _dimensions: [1, 2], _elements: [1, 'two'] });
    expect(n.serializeXml('P', {}, 0)).toBe(
      '<P Class="cell" Dimension="1*2">\n' +
        '    <Element Class="double">1.0</Element>\n' +
        '    <Element Class="char">two</Element>\n' +
        '</P>',
    );
  });

  it('emits an empty cell as a self-closing 0*0 tag', () => {
    expect(parse({ _array_type: 'Cell', _dimensions: [0, 0], _elements: [] }).serializeXml('P', {}, 0)).toBe(
      '<P Class="cell" Dimension="0*0"/>',
    );
  });

  it('wraps a string array in the saveobj cell the string class expects', () => {
    const n = parse({ _array_type: 'String', _dimensions: [1, 2], _elements: ['a', 'b'] });
    expect(n.serializeXml('P', {}, 0)).toBe(
      '<P>\n' +
        '    <Element Class="string">\n' +
        '        <P Source="saveobj" PropertyType="any" Class="cell" Dimension="1*2">\n' +
        '            <Element Class="char">a</Element>\n' +
        '            <Element Class="char">b</Element>\n' +
        '        </P>\n' +
        '    </Element>\n' +
        '</P>',
    );
  });

  it('routes a scalar string through the string path without changing its kind', () => {
    // The scalar formatter borrows the string serializer; leaving _kind switched
    // afterwards would corrupt every later read of the node.
    const n = parse(0);
    n._scalarType = 'string';
    n._scalarValue = 'hi';
    const xml = n.serializeXml('P', {}, 0);
    expect(xml).toContain('<Element Class="char">hi</Element>');
    // A 1x1 string carries no Dimension attribute.
    expect(xml).not.toContain('Dimension');
    expect(n._kind).toBe('scalar');
  });
});

describe('MatlabVariableNode — presentation and editability', () => {
  it('picks an icon from the kind and scalar type', () => {
    const icon = (raw: unknown) => parse(raw).icon;
    expect(icon(1)).toBe('wsDefault');
    expect(icon(true)).toBe('wsCheck');
    expect(icon('c')).toBe('wsCharacter');
    expect(icon([1, 2])).toBe('wsDefault');
    expect(icon({ _array_type: 'Cell', _dimensions: [1, 1], _elements: [1] })).toBe('wsBrackets');
    expect(icon({ _array_type: 'String', _dimensions: [1, 1], _elements: ['a'] })).toBe('wsString');
  });

  it('reports a complex value as class double, since complex is not a type name', () => {
    const n = parse(0);
    n._scalarType = 'complex';
    expect(n.className).toBe('double');
  });

  it('mirrors className into the DataType column for a primitive', () => {
    expect(parse(1).dataType).toBe('double');
  });

  it('fixes the name of an element, which is its index', () => {
    const n = parse([1, 2]);
    expect([n.nameEditable, n.children[0].nameEditable]).toEqual([true, false]);
  });

  it('refuses to edit a struct, whose value lives in its fields', () => {
    const n = parse(0);
    n._scalarType = 'struct';
    expect(n.valueEditable).toBe(false);
  });

  it('treats only a non-opaque numeric 1x1 as scalar-numeric', () => {
    // The shape a Constant requires; the Variable-to-Constant paste gate uses it.
    expect(parse(1).isScalarNumeric).toBe(true);
    expect(parse(true).isScalarNumeric).toBe(true);
    expect(parse('c').isScalarNumeric).toBe(false);
    expect(parse([1, 2]).isScalarNumeric).toBe(false);
    expect(parse({ _array_type: 'Cell', _dimensions: [1, 1], _elements: [1] }).isScalarNumeric).toBe(false);
  });

  it('offers the four table properties and one General group in the inspector', () => {
    const n = parse(1);
    expect(n.getProperties().map((p: Any) => p.key)).toEqual(['Name', 'Value', 'DataType', 'Description']);
    const layout = n.getPILayout();
    expect(layout.length).toBe(1);
    expect(layout[0].group).toBe('General');
    expect(layout[0].items.map((p: Any) => p.key)).toEqual([
      'Name',
      'Value',
      'DataType',
      'Kind',
      'Class',
      'Description',
    ]);
  });
});

describe('MatlabVariableNode._var — the .mat variable projection', () => {
  it('maps a logical to uint8 with the isLogical flag, as the MAT format does', () => {
    const v = parse(true)._var;
    expect([v.className, v.isLogical, v.value]).toEqual(['uint8', true, true]);
  });

  it('sizes a char by its length', () => {
    const v = parse('hello')._var;
    expect([v.className, v.dimensions]).toEqual(['char', [1, 5]]);
  });

  it('splits a complex literal into real and imaginary parts', () => {
    const n = parse(0);
    n._scalarType = 'complex';
    n._scalarValue = '1.5-2i';
    const v = n._var;
    expect([v.className, v.isComplex, v.value]).toEqual(['double', true, [{ re: 1.5, im: -2 }]]);
  });

  it('projects a struct as named fields', () => {
    const s = parse({ _type: 'double', _emptyDims: [0, 0] });
    s.addChildNode();
    const v = s._var;
    expect([v.className, Object.keys(v.fields!)]).toEqual(['struct', ['field']]);
  });

  it('projects an array, and unwraps a one-element array to a bare value', () => {
    expect(parse([1, 2, 3])._var.value).toEqual([1, 2, 3]);
    expect(parse([7])._var.value).toBe(7);
  });

  it('projects a cell as per-element variables and a string array as joined char', () => {
    const cell = parse({ _array_type: 'Cell', _dimensions: [1, 2], _elements: [1, 2] });
    expect((cell._var.value as Any[]).map((v) => v.value)).toEqual([1, 2]);
    const str = parse({ _array_type: 'String', _dimensions: [1, 2], _elements: ['ab', 'cd'] });
    expect([str._var.className, str._var.value, str._var.dimensions]).toEqual(['char', 'abcd', [1, 4]]);
  });
});
