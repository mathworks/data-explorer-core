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
import { NOT_AVAILABLE } from '../src/datamodel/parser/McosParser.js';
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

// A complex value reaches the reader as `_type: 'cdata'` in one of two spellings:
// plain text ('1+2i') for values the writer could spell out, or a base-64-ish
// 6-bit packing of the raw MAT byte stream for the rest. The binary form carries
// its real and imaginary parts in separate blocks at offsets that depend on how
// the variable name was stored, so a misread offset silently returns the wrong
// number rather than failing.
describe('MatlabVariableNode — complex values from cdata', () => {
  // Inverse of the reader's 6-bit unpacking, so a test can hand it real bytes.
  function encodeCdata(bytes: Uint8Array): string {
    const bits: number[] = [];
    for (const b of bytes) {
      for (let i = 7; i >= 0; i--) {
        bits.push((b >> i) & 1);
      }
    }
    while (bits.length % 6 !== 0) {
      bits.push(0);
    }
    let s = '';
    for (let i = 0; i < bits.length; i += 6) {
      let v = 0;
      for (let b = 0; b < 6; b++) {
        v = (v << 1) | bits[i + b];
      }
      s += String.fromCharCode(v + 0x20);
    }
    return s;
  }

  it('reads the text spelling as a scalar complex', () => {
    const n = parse({ _type: 'cdata', _value: '1.5-2i' });
    expect([n._kind, n._scalarType, n._scalarValue]).toEqual(['scalar', 'complex', '1.5-2i']);
  });

  it('reads the binary spelling, whichever way the name was stored', () => {
    // The name is either packed into the tag word (small-data form) or written as
    // a sized, 8-byte-padded block; each shifts the data blocks by a different
    // amount. Reading the wrong one lands mid-double and yields garbage.
    const scalarBytes = (nameInline: boolean, re: number, im: number): Uint8Array => {
      const bytes = new Uint8Array(nameInline ? 88 : 96);
      const dv = new DataView(bytes.buffer);
      dv.setInt32(40, 1, true);
      dv.setInt32(44, 1, true);
      let off = 48;
      if (nameInline) {
        dv.setUint32(off, 0x0002_0001, true);
        off += 8;
      } else {
        dv.setUint32(off, 1, true);
        dv.setUint32(off + 4, 3, true);
        off += 16;
      }
      dv.setUint32(off, 9, true);
      dv.setUint32(off + 4, 8, true);
      dv.setFloat64(off + 8, re, true);
      dv.setUint32(off + 16, 9, true);
      dv.setUint32(off + 20, 8, true);
      dv.setFloat64(off + 24, im, true);
      return bytes;
    };
    expect(parse({ _type: 'cdata', _value: encodeCdata(scalarBytes(true, 1.5, -2.5)) })._scalarValue).toBe('1.5-2.5i');
    expect(parse({ _type: 'cdata', _value: encodeCdata(scalarBytes(false, 3, 4)) })._scalarValue).toBe('3+4i');
  });

  it('keeps an undecodable payload as text instead of losing it', () => {
    // Anything the decoder cannot make sense of still has to survive the round
    // trip: the node degrades to a char scalar and serializeValue replays the
    // original _rawInput, so an unreadable value is shown, not destroyed.
    const raw = { _type: 'cdata', _value: 'ABC' };
    const n = parse(raw);
    expect([n._kind, n._scalarType, n._scalarValue]).toEqual(['scalar', 'char', 'ABC']);
    expect(n.serializeValue()).toBe(raw);
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

  it('retypes a numeric array to a string array, rebuilding the element rows', () => {
    // The elements have to become string-KIND children, not string-typed scalars:
    // a scalar-typed one serializes as a nested [""] and would write an array of
    // one-element arrays back into the file.
    const n = parse([1, 2, 3]);
    expect(n.setProperty('Value', '["a" "b" "c"]')).toBe(true);
    expect([n._kind, n._scalarType, n._dims]).toEqual(['string', 'string', [1, 3]]);
    expect(n._elements).toEqual(['a', 'b', 'c']);
    expect(n.children.map((c: Any) => [c.name, c._kind, c._scalarValue])).toEqual([
      ['1', 'string', 'a'],
      ['2', 'string', 'b'],
      ['3', 'string', 'c'],
    ]);
    expect(n.serializeValue()).toEqual({
      _array_type: 'String',
      _dimensions: [1, 3],
      _elements: ['a', 'b', 'c'],
      _mw_element_type: 'MATLABArray',
    });
  });

  it('leaves a one-element string array childless, as the numeric path does', () => {
    // One element is a scalar string, so a child row would be noise — but the
    // value still has to reach _elements or the save writes an empty array.
    const n = parse([1, 2, 3]);
    n.setProperty('Value', '["only"]');
    expect([n._kind, n._dims, n.children.length]).toEqual(['string', [1, 1], 0]);
    expect(n.serializeValue()).toEqual({
      _array_type: 'String',
      _dimensions: [1, 1],
      _elements: ['only'],
      _mw_element_type: 'MATLABArray',
    });
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

  it('offers Add but not Remove on an empty array or a fresh struct', () => {
    // An edit to `[]` leaves nothing to remove, and the struct it becomes on the
    // first add is a scalar — Remove has to stay disabled through both states or
    // the command would run against a node with no removable element.
    const empty = parse([1, 2, 3]);
    empty.setProperty('Value', '[]');
    expect([empty._kind, empty._elements, empty.displayValue]).toEqual(['array', [], '[]']);
    expect([empty.canAddChild(), empty.canRemoveChild()]).toEqual([true, false]);
    empty.addChildNode();
    expect([empty.canAddChild(), empty.canRemoveChild()]).toEqual([true, false]);
    // A struct keeps taking fields, each with a distinct name.
    expect(empty.addChildNode().name).toBe('field1');
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

  it('redoes the empty-array-to-struct conversion around the same field node', () => {
    // Redo used to re-run the conversion, minting a SECOND 'field' rather than
    // putting back the one undo removed. That left the undo stack holding a node
    // no longer in the tree, so the next undo removed nothing and every extra
    // undo/redo cycle stranded one more duplicate field in the struct.
    const n = parse({ _type: 'double', _emptyDims: [0, 0] });
    const op: Any = n.execAddChild();
    op.undo();
    op.redo();
    expect([n._kind, n._scalarType]).toEqual(['scalar', 'struct']);
    expect(n.children).toEqual([op.node]);

    op.undo();
    expect(n.children.length).toBe(0);
    op.redo();
    expect(n.children).toEqual([op.node]);
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

  it('replays the untouched serial for a one-element typed vector', () => {
    // A 1-element array has no child rows to read values from, so there is
    // nothing to re-derive — the stored literal is the only copy of the value.
    const n = parse({ _type: 'int32', _value: '[5]' });
    n.status = 'Modified';
    n._rawInput = undefined;
    expect(n.serializeValue()).toEqual({ _type: 'int32', _value: '[5]' });
  });

  it('writes a bare string array as a plain element list when the source had no container', () => {
    // A JS array of strings parses to kind 'string' with no _array_type in
    // serial. Emitting the container form anyway would add a wrapper MATLAB
    // never wrote, showing up as a spurious diff on every save.
    const n = parse(['x', 'y']);
    n.status = 'Modified';
    n._rawInput = undefined;
    expect(n.serializeValue()).toEqual(['x', 'y']);
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

  it('brands a retyped scalar string with the string icon, not the char one', () => {
    // Typing "hi" produces a scalar of type 'string' rather than 'char'; the two
    // are different MATLAB types and the icon is what tells them apart in the tree.
    const n = parse(1);
    n.setProperty('Value', '"hi"');
    expect([n._scalarType, n.icon, n.displayValue]).toEqual(['string', 'wsString', '"hi"']);
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

  it('names the container kinds in the Class and DataType columns', () => {
    const cell = parse({ _array_type: 'Cell', _dimensions: [1, 2], _elements: [1, 2] });
    expect([cell.className, cell.dataType]).toEqual(['cell', 'cell']);
    const str = parse(['a', 'b']);
    expect([str.className, str.dataType]).toEqual(['string', 'string']);
  });

  it('reads a string array Value from _elements, which the children mirror', () => {
    // The .Value getter feeds the clipboard and the paste gate; a string array
    // has to hand back its text, not the child nodes that display it.
    expect(parse(['a', 'b']).Value).toEqual(['a', 'b']);
    // A 1x1 string container has no child rows, so _elements is the only copy.
    expect(parse({ _array_type: 'String', _dimensions: [1, 1], _elements: ['solo'] }).Value).toEqual(['solo']);
  });

  it('has no inline Value for a cell, whose entries are its children', () => {
    // Returning something here would put a value in a row that already has child
    // rows, and an edit of it would have nowhere to land.
    expect(parse({ _array_type: 'Cell', _dimensions: [1, 2], _elements: [1, 2] }).Value).toBeNull();
  });

  it('reports a plain variable as a MATLAB Variable but defers to a classification', () => {
    // In Architectural Data the same variable is a derived Constant, and a
    // catalog classification (set by the section parser) outranks both.
    const n = parse(5);
    expect(n.kind).toBe('MATLAB Variable');
    n.classification = 'StructType';
    expect(n.kind).toBe('Struct Type');
  });

  it('fixes the name of a class property, which the class definition owns', () => {
    const n = parse(1);
    n.parent = { isObjectPropertyBag: true } as Any;
    expect(n.nameEditable).toBe(false);
  });

  it('refuses to edit the unrecoverable-value placeholder, which is not real text', () => {
    // The MCOS decoder's sentinel renders unquoted so the table greys it out;
    // offering an editor would let the user "correct" a value that does not exist.
    const n = parse(0);
    n._scalarType = 'char';
    n._scalarValue = NOT_AVAILABLE;
    expect([n.displayValue, n.valueEditable]).toEqual([NOT_AVAILABLE, false]);
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

// An opaque node is an MCOS object the model has no typed class for: the .mat
// reader decoded its properties but nothing here understands them, so the node
// shows the object's class and a read-only summary rather than a fake value.
describe('MatlabVariableNode — opaque MCOS objects', () => {
  const opaque = (className: string, decoded: Record<string, unknown>): Any =>
    MatlabVariableNode.createFromMcosDecoded(
      {
        name: 'o',
        className,
        dimensions: [1, 1],
        isComplex: false,
        isLogical: false,
        value: null,
        fields: null,
      } as Any,
      decoded as Any,
      null,
    );

  it('shows the class name as Class but leaves DataType empty', () => {
    // The class of a Simulink.Parameter is not a data type; putting it in the
    // DataType column would mix the two concepts in one place.
    const n = opaque('Simulink.Parameter', { value: 7, properties: { Value: 7 }, dimensions: [1, 1] });
    expect([n.className, n.dataType]).toEqual(['Simulink.Parameter', '']);
  });

  it('brands a known Simulink class and falls back for an unknown one', () => {
    expect(opaque('Simulink.Parameter', { value: null, properties: {}, dimensions: [1, 1] }).icon).toBe('wsParameters');
    expect(opaque('Some.Unknown', { value: null, properties: {}, dimensions: [1, 1] }).icon).toBe('wsDefault');
  });

  it('summarizes the decoded value by type, or by class when there is none', () => {
    expect(opaque('Simulink.Parameter', { value: 7, properties: {}, dimensions: [1, 1] }).displayValue).toBe('7');
    expect(opaque('Simulink.Parameter', { value: 'txt', properties: {}, dimensions: [1, 1] }).displayValue).toBe(
      "'txt'",
    );
    expect(opaque('Simulink.Parameter', { value: [1, 2, 3], properties: {}, dimensions: [1, 3] }).displayValue).toBe(
      '[1x3 Simulink.Parameter]',
    );
    expect(opaque('Some.Unknown', { value: null, properties: {}, dimensions: [1, 1] }).displayValue).toBe(
      '<1x1 Some.Unknown>',
    );
  });

  it('offers no value editor and is never scalar-numeric', () => {
    // There is no round-trip for a class this model does not understand, so an
    // edit could only corrupt the object.
    const n = opaque('Simulink.Parameter', { value: 7, properties: {}, dimensions: [1, 1] });
    expect([n.valueEditable, n.isScalarNumeric]).toEqual([false, false]);
  });

  it('rebuilds the .mat projection as a 1x1 opaque variable', () => {
    // The rebuilt variable must keep isOpaque and 1x1 dims: the writer replays
    // the object's original bytes and would otherwise reshape the object.
    const n = opaque('Simulink.Parameter', { value: 7, properties: {}, dimensions: [1, 1] });
    n._varStale = true;
    const v = n._var;
    expect([v.className, v.isOpaque, v.dimensions]).toEqual(['Simulink.Parameter', true, [1, 1]]);
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
