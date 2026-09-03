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
import * as NodeClassMap from '../src/datamodel/node/NodeClassMap.js';
import { CLASS, MI, arrayFlags, dims, matrix, numericData, varName } from './tools/matBytes.js';

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

  // MATLAB writes `[]` for an empty numeric into a text dictionary, and
  // `size([])` is 0x0 — the binary dictionary, the .slx and the .mat all report
  // 0x0 for the same value. 1x0 would be the shape of `x=1; x(1)=[]`, which is a
  // different value and is what the REMOVAL path produces (see
  // _updateArrayAfterRemove). A stored bare `[]` has no removal behind it.
  it('reads a bare empty array as 0x0, the shape MATLAB reports for []', () => {
    const n = parse([]);
    expect([n._kind, n._elements, n._dims, n.displayValue]).toEqual(['array', [], [0, 0], '[ ]']);
  });

  // `{_type: 'struct', _value: '[]'}` is how MATLAB spells struct([]) in a text
  // dictionary — the only _type:'struct' in the whole corpus, and its value is
  // always the empty literal. Routed on the leading '[' it went to
  // parseTypedVector, which read `[]` as one element of 0 and displayed the
  // 0x0 struct as `[0]` with dims 1x1.
  it('reads the typed struct literal as an empty struct, not a numeric vector', () => {
    const n = parse({ _type: 'struct', _value: '[]' });
    expect([n._kind, n._scalarType, n._dims, n.children.length]).toEqual([
      'scalar', 'struct', [0, 0], 0,
    ]);
    expect(n.displayValue).toBe('<0x0 struct>');
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

  it('shows an empty array as [ ] and an empty cell as { }', () => {
    // '[ ]' and '{ }', with the space, are the display convention's spellings
    // (DESIGN.md's normative table) and what the object-property path has always
    // emitted. They deviate from mat2str's '[]' on purpose: the old '[]'/'{}' here
    // made the same empty value read two ways depending on which parser produced it.
    expect(parse({ _type: 'double', _emptyDims: [0, 0] }).displayValue).toBe('[ ]');
    expect(parse({ _array_type: 'Cell', _dimensions: [0, 0], _elements: [] }).displayValue).toBe('{ }');
  });

  it('spells an empty numeric as the convention does', () => {
    const node = MatlabVariableNode.parseTypedArray({ _type: 'double', _value: 'nope' }, 'e', null);
    expect(node.displayValue).toBe('[ ]');
  });

  it('renders a 10-element array in full and summarizes at 11', () => {
    // The element budget (SUMMARY_MAX_ELEMENTS = 10) replaces "print whatever
    // you have": the variable path used to render a 10000-element array inline
    // while the identical value on the object-property path summarized at 50
    // characters.
    const ten = { _type: 'double', _value: 'Matrix(1,10)\n[' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].join(', ') + ']' };
    expect(MatlabVariableNode.parseTypedArray(ten, 'a', null).displayValue).toBe('[1 2 3 4 5 6 7 8 9 10]');
    const eleven = {
      _type: 'double',
      _value: 'Matrix(1,11)\n[' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].join(', ') + ']',
    };
    expect(MatlabVariableNode.parseTypedArray(eleven, 'a', null).displayValue).toBe('<1x11 double>');
  });

  it('summarizes a rank-3 array whatever its element count', () => {
    const raw = { _type: 'double', _value: 'Matrix(2,3,2)\n[[1, 3, 5]; [2, 4, 6]; [7, 9, 11]; [8, 10, 12]]' };
    expect(MatlabVariableNode.parseTypedArray(raw, 'A', null).displayValue).toBe('<2x3x2 double>');
  });

  it('renders a 2x3 as a MATLAB matrix literal', () => {
    const raw = { _type: 'double', _value: 'Matrix(2,3)\n[[1, 2, 3]; [4, 5, 6]]' };
    expect(MatlabVariableNode.parseTypedArray(raw, 'B', null).displayValue).toBe('[1 2 3; 4 5 6]');
  });

  it('renders an 8-element cell or string array in full — under the element budget', () => {
    // This used to expect '{1x8 cell}' and '<1x8 string>': the old rule was 50
    // display characters, and eight 'element_N' entries pass it. The rule is now
    // the ELEMENT count for anything with expandable child rows, and 8 <= 10, so
    // both render their literal. Two spellings ('{…}' vs '<…>') for one concept
    // is what the old code got wrong — only the angle form reads as a summary.
    const longs = Array.from({ length: 8 }, (_, i) => 'element_' + i);
    expect(parse({ _array_type: 'Cell', _dimensions: [1, 8], _elements: longs }).displayValue).toBe(
      "{'element_0', 'element_1', 'element_2', 'element_3', 'element_4', 'element_5', 'element_6', 'element_7'}",
    );
    expect(parse({ _array_type: 'String', _dimensions: [1, 8], _elements: longs }).displayValue).toBe(
      '["element_0" "element_1" "element_2" "element_3" "element_4" "element_5" "element_6" "element_7"]',
    );
  });

  it('summarizes an 11-element cell or string array in angle brackets', () => {
    const many = Array.from({ length: 11 }, (_, i) => String.fromCharCode(97 + i));
    expect(parse({ _array_type: 'Cell', _dimensions: [1, 11], _elements: many }).displayValue).toBe('<1x11 cell>');
    expect(parse({ _array_type: 'String', _dimensions: [1, 11], _elements: many }).displayValue).toBe(
      '<1x11 string>',
    );
  });

  it('summarizes a short cell or string array whose CONTENTS are huge', () => {
    // The element rule alone is not a bound on LENGTH. SUMMARY_MAX_CHARS is the
    // runaway guard: four 300-character entries are a 1200-character table cell.
    const long = 'x'.repeat(300);
    const four = [long, long, long, long];
    expect(parse({ _array_type: 'Cell', _dimensions: [1, 4], _elements: four }).displayValue).toBe('<1x4 cell>');
    expect(parse({ _array_type: 'String', _dimensions: [1, 4], _elements: four }).displayValue).toBe(
      '<1x4 string>',
    );
  });

  it('summarizes a char scalar past the char budget, at its real 1xN size', () => {
    // char has no child rows, so the char budget is the only rule that applies —
    // and MATLAB's size() for a char row vector is 1xN, not 1x1.
    const n = parse('x'.repeat(1500));
    expect(n.displayValue).toBe('<1x1500 char>');
    // One character under the budget (1000 chars + 2 quotes = 1002 > 1000, so
    // 998 characters is the last inline length) still shows in full.
    expect(parse('y'.repeat(998)).displayValue).toBe("'" + 'y'.repeat(998) + "'");
  });

  it('always summarizes a struct, at every size', () => {
    const scalar = parse(0);
    scalar._scalarType = 'struct';
    expect(scalar.displayValue).toBe('<1x1 struct>');
    const arr = parse(0);
    arr._scalarType = 'struct';
    arr._dims = [2, 3];
    expect(arr.displayValue).toBe('<2x3 struct>');
    // _dims never set: summaryForm normalizes through effectiveDims, so this is
    // '<1x1 struct>' rather than the '<... struct>' a raw join produced.
    const bare = parse(0);
    bare._scalarType = 'struct';
    bare._dims = [];
    expect(bare.displayValue).toBe('<1x1 struct>');
  });

  it('prefers the live children over _elements, so an edit is visible', () => {
    const n = parse([1, 2, 3]);
    n.children[1]._scalarValue = 99;
    expect(n.displayValue).toBe('[1 99 3]');
  });

  it('summarizes an opaque array in angle brackets, not square ones', () => {
    // '[1x2 string]' read as a MATLAB literal and the consumer table styled it as
    // ordinary editable text. Angle brackets are what keys the gray/italic form
    // and the no-editor rule.
    const node: Any = new MatlabVariableNode('o', null, {});
    node._isOpaque = true;
    node._opaqueClassName = 'string';
    node._mcosValue = ['a', 'b'];
    node._mcosDimensions = [1, 2];
    expect(node.displayValue).toBe('<1x2 string>');
  });

  it('keeps the opaque 1x1 placeholders on the shared summary form', () => {
    // Nothing in displayValue spells a summary by hand any more, so an empty
    // opaque string and an opaque value we could not read agree with everything
    // else in the tree.
    const empty: Any = new MatlabVariableNode('o', null, {});
    empty._isOpaque = true;
    empty._opaqueClassName = 'string';
    empty._mcosValue = '';
    expect(empty.displayValue).toBe('<1x1 string>');
    const unread: Any = new MatlabVariableNode('o', null, {});
    unread._isOpaque = true;
    unread._opaqueClassName = 'Simulink.Parameter';
    expect(unread.displayValue).toBe('<1x1 Simulink.Parameter>');
  });

  it('summarizes an unreadable opaque value at the shape the decoder recovered', () => {
    // A MATLAB `string` array is ONE MCOS object, so its object handle says [1,1]
    // however big the array is and the shape has to come from the decoded payload.
    // A hardcoded [1,1] here printed MATLAB's 1x3 as <1x1 string> — and there is no
    // value to print, so the summary is the whole answer.
    const arr: Any = new MatlabVariableNode('o', null, {});
    arr._isOpaque = true;
    arr._opaqueClassName = 'string';
    arr._mcosDimensions = [1, 3];
    expect(arr.displayValue).toBe('<1x3 string>');
    // …and the accessor agrees with the summary, rather than reporting the [1,1] the
    // constructor left on _dims (which no opaque path ever sets).
    expect(arr.dims).toEqual([1, 3]);
  });

  it('calls `string` a data type and every other opaque class not one', () => {
    // An opaque className is normally a CLASS name — 'Simulink.Parameter' is not a
    // type, so the DataType column stays blank for it. `string` is the exception:
    // MATLAB implements it as an MCOS object but it is a genuine data type, and a
    // string out of a .mat belongs in that column next to one out of a dictionary.
    const str: Any = new MatlabVariableNode('o', null, {});
    str._isOpaque = true;
    str._opaqueClassName = 'string';
    expect(str.dataType).toBe('string');
    const obj: Any = new MatlabVariableNode('o', null, {});
    obj._isOpaque = true;
    obj._opaqueClassName = 'Simulink.Parameter';
    expect(obj.dataType).toBe('');
  });

  it("REGRESSION: escapes a quote inside a char/string by doubling it", () => {
    // A concatenated "'" + value + "'" showed `it's` as 'it's', which is not a
    // MATLAB literal. That matters beyond looks: the table seeds its in-place
    // editor with the DISPLAYED text, so committing the cell unchanged re-parsed
    // a different, shorter value — a silent edit of the user's data.
    expect(parse("it's").displayValue).toBe("'it''s'");
    expect(parse("'").displayValue).toBe("''''");
    expect(parse({ _array_type: 'String', _dimensions: [1, 1], _elements: ['say "hi"'] }).displayValue).toBe(
      '"say ""hi"""',
    );
    // A string ARRAY element gets the same treatment as a string scalar.
    expect(
      parse({ _array_type: 'String', _dimensions: [1, 2], _elements: ['a"b', 'c'] }).displayValue,
    ).toBe('["a""b" "c"]');
  });

  it('REGRESSION: a displayed char/string round-trips through a Value edit', () => {
    // format and parse have to be inverses, since the editor is seeded with
    // format's output. This is the whole point of the escaping above.
    for (const text of ["it's", "'", 'a;b', 'plain']) {
      const n = parse(text);
      const shown = n.displayValue;
      expect(n.setProperty('Value', shown)).toBe(true);
      expect([n._scalarType, n._scalarValue]).toEqual(['char', text]);
      expect(n.displayValue).toBe(shown);
    }
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

// A value reaches the reader as `_type: 'cdata'` in one of two spellings: plain
// text ('1+2i') for a complex value the writer could spell out, or a 6-bit
// packing (uuencode) of raw MAT bytes for the rest. The binary form is an 8-byte
// preamble followed by ONE miMATRIX element, which MatParser reads — see
// test/cdataParse.test.ts for the MATLAB-authored proof of that layout and for
// the classes other than complex double that appear there.
//
// The fixture below builds a real miMATRIX with test/tools/matBytes.ts. It used
// to hand-place rows at byte 40 and cols at 44 with offsets 0-39 left zero,
// which is not a MAT element at all — it was reverse-engineered from the reader
// this suite was testing. MATLAB's own bytes for `cplxScalar` are
// `00 01 49 4d 00 00 00 00` then `0e 00 00 00 48 00 00 00` (miMATRIX, 72 bytes)
// then array flags, dims, name, real, imag. Dims data happens to land at 40/44
// in that layout, which is exactly why the old reader worked for a 2-D complex
// double and for nothing else.
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

  // MATLAB's preamble ahead of the element: two version bytes then 'IM'.
  const PREAMBLE = [0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00];

  /** The 8-byte preamble plus one complex-double miMATRIX, as a cdata payload. */
  function cdataOf(nameSub: Uint8Array, re: number, im: number): Uint8Array {
    const el = matrix([
      arrayFlags(CLASS.DOUBLE, { complex: true }),
      dims([1, 1]),
      nameSub,
      numericData(MI.DOUBLE, [re]),
      numericData(MI.DOUBLE, [im]),
    ]);
    const out = new Uint8Array(8 + el.length);
    out.set(PREAMBLE, 0);
    out.set(el, 8);
    return out;
  }

  /**
   * A name subelement in the SMALL-element form: byte count in the tag word's
   * high half, type in its low half, payload in the tag word's own upper 4 bytes.
   * matBytes only writes the long form, and both forms shift every later
   * subelement by a different amount.
   */
  function smallName(s: string): Uint8Array {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setUint32(0, (s.length << 16) | MI.INT8, true);
    out.set(new TextEncoder().encode(s), 4);
    return out;
  }

  it('reads the binary spelling, whichever way the name was stored', () => {
    // The name is either packed into the tag word (small-element form) or written
    // as a sized, 8-byte-padded block; each shifts the data blocks by a different
    // amount. Reading the wrong one lands mid-double and yields garbage.
    // MATLAB itself writes the long form with a zero-length name here.
    expect(parse({ _type: 'cdata', _value: encodeCdata(cdataOf(varName(''), 1.5, -2.5)) })._scalarValue).toBe('1.5-2.5i');
    expect(parse({ _type: 'cdata', _value: encodeCdata(cdataOf(varName('abc'), 3, 4)) })._scalarValue).toBe('3+4i');
    expect(parse({ _type: 'cdata', _value: encodeCdata(cdataOf(smallName('ab'), 3, 4)) })._scalarValue).toBe('3+4i');
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
    // Typed '[]' still parses; it DISPLAYS as the convention's '[ ]'.
    expect([empty._kind, empty._elements, empty.displayValue]).toEqual(['array', [], '[ ]']);
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

  it('reports a fully emptied numeric array as 1x0', () => {
    // An `array` node only builds child rows when it has more than one element
    // (parseFlatArray/parseTypedArray both guard on that), so removeChildNode
    // always lands on the collapse-to-scalar arm and the only route to zero
    // elements is the update helper directly — the same shape the string side
    // tests at 'reports a fully emptied string array as 1x0'.
    const n = parse([1, 2]);
    n._elements = [];
    n._rawInput = undefined;
    n._updateArrayAfterRemove();
    expect([n._dims, n.serializeValue()]).toEqual([[1, 0], []]);
  });
});

// MATLAB's numeric classes are part of the value: an int32 written back as a
// double is silent corruption, not a display nit — MATLAB reads the .sldd and gets
// a differently-typed variable. JSON has one number type and MatlabValueParser
// reports every bare number as 'double', so the class survives only if the node
// asserts it. These pin the four places that used to hardcode 'double' and drop it.
describe('MatlabVariableNode — a typed numeric class survives every edit', () => {
  const typed = (t: string, v: string): Any => parse({ _type: t, _value: v });

  it('keeps the class when a Value edit re-states the number', () => {
    // The number inside a `_value` body is a MATLAB LITERAL, so it wears the suffix
    // MATLAB gives that class there: 'U' on an unsigned integer, 'F' on a single,
    // nothing on a signed one. Read off MATLAB's own cases.sldd, which writes `7U` for
    // a uint8, `255U`, `3.14159274F` for a single, and a bare `7`/`-128` for the signed
    // classes. The array path already spelled it this way (formatNumLiteral, and the
    // append test below); the scalar path used the bare number, so the same value
    // spelled itself two ways depending only on whether it had siblings.
    //
    // XML is a different grammar and is unaffected: there the class lives in the Class
    // attribute, so the body is a plain number — with the '.0' a single/double gets.
    for (const [t, literal] of [
      ['int32', '7'],
      ['uint8', '7U'],
      ['int8', '7'],
      ['single', '7F'],
    ]) {
      const n = typed(t, '5');
      expect(n.setProperty('Value', '7')).toBe(true);
      expect([t, n._scalarType, n.serializeValue()]).toEqual([t, t, { _type: t, _value: literal }]);
      expect(n.serializeXml('P', {}, 0)).toBe('<P Class="' + t + '">' + (t === 'single' ? '7.0' : '7') + '</P>');
    }
  });

  it('lets a non-numeric edit retype the variable, as the user asked', () => {
    // Only the parser's 'double' default is overridden. Typing text, a logical, or
    // a complex is an explicit request for that class and must go through.
    const n = typed('int32', '5');
    n.setProperty('Value', "'text'");
    expect([n._scalarType, n._scalarValue]).toEqual(['char', 'text']);
    const b = typed('int32', '5');
    b.setProperty('Value', 'true');
    expect([b._scalarType, b._scalarValue]).toEqual(['logical', true]);
  });

  it('retypes a logical to double when a number is typed into it', () => {
    // Unlike the integer classes, 'logical' cannot hold 7 — MATLAB rejects it — so
    // the parser's double wins here.
    const n = typed('logical', '1');
    n.setProperty('Value', '7');
    expect([n._scalarType, n.serializeValue()]).toEqual(['double', 7]);
  });

  it('keeps the class when an element is appended', () => {
    // The body is bare — a 1xN typed array states no shape, which is MATLAB's own
    // spelling for it (defect 21). Only a column or a matrix carries the Matrix()
    // header, because there the shape is the only thing the reader could not infer.
    for (const t of ['int32', 'logical']) {
      const n = typed(t, t === 'logical' ? '[1, 0]' : '[5, 6]');
      n.addChildNode();
      expect([t, n._scalarType, n.serializeValue()]).toEqual([
        t,
        t,
        { _type: t, _value: '[' + (t === 'logical' ? '1, 0, 0' : '5, 6, 0') + ']' },
      ]);
    }
  });

  it('keeps the class when a removal collapses the array to a scalar, and on undo', () => {
    // `serial` is spelled per class rather than reused from `v` because MATLAB spells
    // the literal's numbers with a class suffix: its own uncompressed-text dictionary
    // writes a single as '3.14159274F' and a uint64 as '18446744073709551615U', while
    // int32 and logical are bare. The old expectation reused `v` for every class and
    // so read as correct — but a suffixless body is one MATLAB reads back as DOUBLE,
    // silently retyping the entry the test claims keeps its class.
    for (const spec of [
      { t: 'int32', v: '[5, 6]', serial: '[5, 6]', collapsed: '5', display: '[5 6]' },
      { t: 'logical', v: '[1, 0]', serial: '[1, 0]', collapsed: '1', display: '[true false]' },
      // The collapsed scalar keeps the suffix too: it is the same literal grammar with
      // one number in it, and a collapse that dropped the 'F' would retype the entry to
      // double on the way out — the very thing this test is about.
      { t: 'single', v: '[5, 6]', serial: '[5F, 6F]', collapsed: '5F', display: '[5 6]' },
    ]) {
      const n = typed(spec.t, spec.v);
      const op: Any = n.execRemoveChild(n.children[1]);
      expect([spec.t, n._scalarType, n.serializeValue()]).toEqual([
        spec.t,
        spec.t,
        { _type: spec.t, _value: spec.collapsed },
      ]);
      op.undo();
      expect([spec.t, n._scalarType, n.displayValue]).toEqual([spec.t, spec.t, spec.display]);
      // Bare again after the undo: the restored value is a 1x2 row (defect 21).
      expect(n.serializeValue()).toEqual({ _type: spec.t, _value: spec.serial });
    }
  });

  it('still writes a plain double as a bare JSON value', () => {
    // The typed literal is for values a bare JSON scalar cannot carry. Tagging a
    // double too would add a wrapper MATLAB never wrote, diffing every save.
    const n = parse(5);
    n.setProperty('Value', '7');
    expect(n.serializeValue()).toBe(7);
    const arr = parse([1, 2]);
    arr.addChildNode();
    expect(arr.serializeValue()).toEqual([1, 2, 0]);
  });

  it('still writes a logical scalar as a bare JSON boolean', () => {
    // A logical scalar travels as a JS boolean, which JSON carries losslessly. Only
    // an element lifted out of a logical ARRAY (stored as 1/0) needs the tag.
    const n = parse(true);
    n.setProperty('Value', 'false');
    expect(n.serializeValue()).toBe(false);
  });
});

// One MATLAB array is one class, so an element of an int32 array IS an int32.
// The element rows hardcoded 'double', which put 'int32' in the array's Data Type
// column and 'double' in the column of every row under it — the same value
// described two ways, one of them wrong. For the integer/single classes here this
// moves the Data Type column and nothing else, since they format exactly as a double
// does; the logical case, which also changes the row's text and icon, is the next
// describe. Elements of a CELL or a struct are independent values and keep their own.
describe("MatlabVariableNode — an array element's data type follows the array", () => {
  const typed = (t: string, v: string): Any => parse({ _type: t, _value: v });
  // Every numeric class a MATLAB array can carry, not a sample of them: the rule is
  // one regex, so a class left untested is a class one edit to that regex can drop.
  // 'logical' is the same rule and has its own describe (its rows also change text
  // and icon); 'double' is the identity case, asserted separately below.
  const CLASSES = ['int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64', 'single'];

  // MATLAB's own suffix for a number inside a typed `_value` literal, read off its
  // uncompressed-text dictionary in test/parity/artifacts/text/cases.sldd: the
  // unsigned classes take 'U' ('[18446744073709551615U, 1U, 0U]'), single takes 'F'
  // ('3.14159274F'), the signed integers are bare ('[1, 2, 3]' for int16). Spelled
  // out here rather than imported from XmlUtils so the expectation does not merely
  // restate the implementation.
  const suffixOf = (t: string): string => (t === 'single' ? 'F' : t.startsWith('u') ? 'U' : '');

  it('gives every element of a typed vector the array class', () => {
    for (const t of CLASSES) {
      const n = typed(t, '[100, 200, 300]');
      expect([t, n.dataType, n.children.map((c: Any) => c.dataType)]).toEqual([t, t, [t, t, t]]);
    }
  });

  it('leaves the elements displaying exactly what they displayed as doubles', () => {
    // The integer/single classes format through formatMatlabNum, same as double, so
    // asserting the text pins that this change is invisible outside the Data Type
    // column — and that an element cell still shows something re-typeable.
    for (const t of CLASSES) {
      expect([t, typed(t, '[100, 200, 300]').children.map((c: Any) => c.displayValue)]).toEqual([
        t,
        ['100', '200', '300'],
      ]);
    }
  });

  it('gives every element of a typed matrix the array class', () => {
    // A matrix arrives through parseTypedArray, a different builder from the vector's
    // parseTypedVector, so it needs its own pass over the classes.
    for (const t of CLASSES) {
      const n = typed(t, 'Matrix(2,2)\n[1, 2]\n[3, 4]');
      expect([t, n.children.map((c: Any) => c.dataType)]).toEqual([t, [t, t, t, t]]);
    }
  });

  it('leaves a plain double array alone', () => {
    expect(parse([1, 2, 3]).children.map((c: Any) => c.dataType)).toEqual(['double', 'double', 'double']);
  });

  it('keeps the class on an element that was edited', () => {
    // _setConstrainedValue rewrote the element's class on every commit, so the
    // column flipped back to 'double' the moment a user touched a cell.
    for (const t of CLASSES) {
      const n = typed(t, '[100, 200]');
      expect(n.children[0].setProperty('Value', '150')).toBe(true);
      expect([t, n.children.map((c: Any) => c.dataType), n.serializeValue()]).toEqual([
        t,
        [t, t],
        // Suffixed per class: a suffixless body is one MATLAB reads back as double,
        // which would undo the very class this test is about. Bare of a Matrix()
        // header, because a 1xN row states no shape (defect 21).
        { _type: t, _value: '[150' + suffixOf(t) + ', 200' + suffixOf(t) + ']' },
      ]);
    }
  });

  it('gives an appended element the array class', () => {
    for (const t of CLASSES) {
      const n = typed(t, '[100, 200]');
      n.addChildNode();
      expect([t, n.children.map((c: Any) => c.dataType)]).toEqual([t, [t, t, t]]);
    }
  });

  it('gives the survivor of an undone collapse the array class', () => {
    // The collapse drops the last element row and undo rebuilds it, so the rebuilt
    // survivor is a third place the class has to be re-asserted.
    for (const t of CLASSES) {
      const n = typed(t, '[100, 200]');
      const op: Any = n.execRemoveChild(n.children[1]);
      op.undo();
      expect([t, n.children.map((c: Any) => c.dataType)]).toEqual([t, [t, t]]);
    }
  });

  it('leaves a cell array\'s elements with their own classes', () => {
    // A cell holds unrelated values — {int32(5), 'text'} is one cell of two
    // classes — so there is no container class to inherit.
    const n = parse({
      _array_type: 'Cell',
      _dimensions: [1, 2],
      _mw_element_type: 'MATLABCell',
      _elements: [{ _type: 'int32', _value: '5' }, 'text'],
    });
    expect([n._kind, n.children.map((c: Any) => c.dataType)]).toEqual(['cell', ['int32', 'char']]);
  });

  it('leaves a struct\'s fields with their own classes', () => {
    const n = NodeClassMap.parseValue(
      {
        _array_type: 'Struct',
        _dimensions: [1, 1],
        _elements: [{ a: { _type: 'int32', _value: '5' }, b: 'text' }],
        _fields: ['a', 'b'],
      },
      's',
      null,
    ) as Any;
    expect(n.children.map((c: Any) => c.dataType)).toEqual(['int32', 'char']);
  });

});

// A logical array's elements are logicals too, and unlike the integer classes that
// changes what the row LOOKS like: 'logical' in the Data Type column, true/false as
// the text, and the checkbox icon a logical scalar has always had. The rows used to
// read 'double' and show 1/0 — the array's own cell said [true false true] while
// every row under it said 1 or 0, the storage representation leaking into the UI.
// Making them logical is also what closes the editor hole below: the element editor
// took any scalar number, so typing 7 into a logical array wrote
// {_type:'logical', _value:'[7, 0, 1]'} — a logical array holding 7.
describe("MatlabVariableNode — a logical array's elements are logicals", () => {
  const logicals = (): Any => parse({ _type: 'logical', _value: '[1, 0, 1]' });

  it('gives the array itself the checkbox icon, like the logical scalar', () => {
    // The container is a logical too — one MATLAB array is one class — so the row a
    // user sees first should say so. Arrays showed the generic wsDefault whatever
    // they held, which put the checkbox on every element row under an array row that
    // looked like a plain double vector.
    expect([logicals().icon, parse(true).icon, parse([1, 2]).icon]).toEqual(['wsCheck', 'wsCheck', 'wsDefault']);
  });

  it('keeps the checkbox icon when the array collapses to a scalar and on undo', () => {
    const n = parse({ _type: 'logical', _value: '[1, 0]' }) as Any;
    const op: Any = n.execRemoveChild(n.children[1]);
    expect([n._kind, n.icon]).toEqual(['scalar', 'wsCheck']);
    op.undo();
    expect([n._kind, n.icon]).toEqual(['array', 'wsCheck']);
  });

  it('gives each element the logical class, true/false text, and the checkbox icon', () => {
    const n = logicals();
    expect(n.children.map((c: Any) => [c.dataType, c.displayValue, c.icon])).toEqual([
      ['logical', 'true', 'wsCheck'],
      ['logical', 'false', 'wsCheck'],
      ['logical', 'true', 'wsCheck'],
    ]);
  });

  it('accepts true/false typed into an element and stores it as 1/0', () => {
    // What the row displays has to be what the row accepts. The stored element stays
    // numeric because that is the one representation the whole class agrees on — the
    // container's display, _var, and the typed literal all read _elements.
    const n = logicals();
    expect(n.children[0].setProperty('Value', 'false')).toBe(true);
    expect([n.children[0].displayValue, n.children[0].dataType]).toEqual(['false', 'logical']);
    expect([n._elements, n.displayValue]).toEqual([[0, 0, 1], '[false false true]']);
    expect(n.serializeValue()).toEqual({ _type: 'logical', _value: '[0, 0, 1]' });
  });

  it('accepts 1 and 0 as shorthand for true and false', () => {
    // MATLAB's own L(1) = 1 keeps the array logical, and a user who sees a numeric
    // array everywhere else should not have to learn which cells refuse digits.
    const n = logicals();
    expect(n.children[1].setProperty('Value', '1')).toBe(true);
    expect([n.children[1].dataType, n.children[1].displayValue]).toEqual(['logical', 'true']);
    expect(n.serializeValue()).toEqual({ _type: 'logical', _value: '[1, 1, 1]' });
  });

  it('rejects a number a logical cannot hold, instead of writing it into the array', () => {
    const n = logicals();
    expect(n.children[0].setProperty('Value', '7')).toEqual({
      error: true,
      reason: 'Logical array elements must be true or false',
      invalidValue: '7',
      validValue: 'true',
    });
    expect([n._elements, n.serializeValue()]).toEqual([
      [1, 0, 1],
      { _type: 'logical', _value: '[1, 0, 1]' },
    ]);
  });

  it('gives an appended element the logical class', () => {
    const n = logicals();
    n.addChildNode();
    expect(n.children.map((c: Any) => [c.dataType, c.displayValue])[3]).toEqual(['logical', 'false']);
  });

  it('gives the survivor of an undone collapse the logical class', () => {
    const n = parse({ _type: 'logical', _value: '[1, 0]' }) as Any;
    const op: Any = n.execRemoveChild(n.children[1]);
    op.undo();
    expect(n.children.map((c: Any) => [c.dataType, c.displayValue])).toEqual([
      ['logical', 'true'],
      ['logical', 'false'],
    ]);
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
    // COLUMN-major element list, as MATLAB writes it: ['a','b','c','d'] at 2x2 is
    // (1,1)=a (2,1)=b (1,2)=c (2,2)=d. Was ["a" "b"; "c" "d"], a row-major
    // reading -- see test/cellElementOrder.test.ts, where MATLAB's own 2x3 strMat
    // pins the order. The add/remove refusal this test exists for is unaffected.
    expect(n.displayValue).toBe('["a" "c"; "b" "d"]');
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

  it('goes to 0x0 and { } when the last element is removed', () => {
    // Not [1,0]: an emptied cell is 0x0 in MATLAB, and displayValue reads the
    // child count rather than the dims, so the two must not disagree.
    // '{ }', with the space, is the convention's empty-cell spelling.
    const n = cellArray([1]);
    n.removeChildNode(n.children[0]);
    expect([n._dims, n.children.length]).toEqual([[0, 0], 0]);
    expect(n.displayValue).toBe('{ }');
  });

  it('REGRESSION: a cell holding a quote survives its own displayed form', () => {
    // The data-loss case, and it changed the cell's SHAPE with no error reported.
    // The element was shown as 'it's' (unescaped), and re-reading that text ended
    // the first element after `it` — so committing the cell unchanged turned a 1x2
    // cell into a 1x3 one holding "it", "s'" and "ok", and setProperty returned
    // true. The saved file then had the wrong dimensions AND mangled text.
    const n = cellArray(["it's", 'ok']);
    const shown = n.displayValue;
    expect(shown).toBe("{'it''s', 'ok'}");
    expect(n.setProperty('Value', shown)).toBe(true);
    expect(n._dims).toEqual([1, 2]);
    expect(n.children.map((c: Any) => c._scalarValue)).toEqual(["it's", 'ok']);
    expect(n.displayValue).toBe(shown);
    expect(n.serializeValue()).toMatchObject({
      _array_type: 'Cell',
      _dimensions: [1, 2],
      _elements: ["it's", 'ok'],
    });
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

  it('writes a scalar string as a one-element array and a complex as a cdata byte stream', () => {
    const s = parse(0);
    s._scalarType = 'string';
    s._scalarValue = 'hi';
    s._rawInput = undefined;
    expect(s.serializeValue()).toEqual(['hi']);
    // A complex scalar goes out as the MAT byte stream, not as the plain text
    // '1+2i'. Both wear the `_type: 'cdata'` tag, and the difference is the whole
    // value: the plain text is what a BINARY dictionary carries for the property,
    // and MATLAB reads it back out of a TEXT dictionary as an empty 1x0 double —
    // measured, not inferred (probe_writeback, defect 24). MATLAB's own text
    // dictionary stores a complex scalar as a stream, and our stream for
    // cases.sldd's cplxScalar is byte-identical to the one MATLAB wrote there.
    s._scalarType = 'complex';
    s._scalarValue = '1+2i';
    const out = s.serializeValue() as { _type: string; _value: string };
    expect(out._type).toBe('cdata');
    expect(out._value.startsWith('  %)')).toBe(true);
    // The stream is the value: read it back and the number has to survive whole.
    expect(parse(out)._scalarValue).toBe('1+2i');
  });

  it('writes a matrix back as a Matrix(r,c) literal', () => {
    // Input keeps the newline-joined spelling on purpose — our own older writer
    // emitted it, so files in the wild carry it and the reader must still take it.
    // The OUTPUT is MATLAB's spelling: bracketed groups joined '; ', with each double
    // carrying the '.0' MATLAB writes. The old expectation echoed the input form and
    // so looked symmetrical, but MATLAB reads a newline-joined body as a 1x0 EMPTY
    // matrix (probed in test/parity/matlab/probe_matrix_serial.m:
    // 'Matrix(2,3)\n[1, 2, 3]\n[4, 5, 6]' -> double [1 0]), so every matrix we wrote
    // back into an uncompressed-text dictionary was destroyed on the next open.
    const n = parse({ _type: 'double', _value: 'Matrix(2,2)\n[1, 2]\n[3, 4]' });
    n.children[0].setProperty('Value', '9');
    expect(n.serializeValue()).toEqual({
      _type: 'double',
      _value: 'Matrix(2,2)\n[[9.0, 2.0]; [3.0, 4.0]]',
    });
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

  it('offers no editor for a summarized value, and does for an inline one', () => {
    // valueEditable keys on the angle-bracket form, so moving summaries onto
    // <mxn class> deliberately makes summarized cells read-only: a 2x3x2 cannot
    // be typed into a one-line box, and the box would be seeded with the summary
    // text — committing it unchanged would replace the value with garbage.
    // Assert it rather than let it drift.
    const inline = MatlabVariableNode.parseTypedArray(
      { _type: 'double', _value: 'Matrix(1,3)\n[1, 2, 3]' },
      'a',
      null,
    );
    expect(inline.displayValue).toBe('[1 2 3]');
    expect(inline.valueEditable).toBe(true);

    const summarized = MatlabVariableNode.parseTypedArray(
      { _type: 'double', _value: 'Matrix(2,3,2)\n[[1, 3, 5]; [2, 4, 6]; [7, 9, 11]; [8, 10, 12]]' },
      'A',
      null,
    );
    expect(summarized.displayValue).toBe('<2x3x2 double>');
    expect(summarized.valueEditable).toBe(false);

    // The element budget has the same consequence: an 11-element vector is a
    // summary, so it loses its editor too.
    const eleven = MatlabVariableNode.parseTypedArray(
      { _type: 'double', _value: 'Matrix(1,11)\n[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]' },
      'b',
      null,
    );
    expect([eleven.displayValue, eleven.valueEditable]).toEqual(['<1x11 double>', false]);
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
    // '<1x3 …>', not the old '[1x3 …]'. Square brackets looked right because they
    // are how MATLAB spells a literal — which is the problem: the consumer table
    // reads a bracketed string as ordinary editable text, so only the summaries
    // that happened to use angle brackets rendered gray/italic and read-only.
    expect(opaque('Simulink.Parameter', { value: [1, 2, 3], properties: {}, dimensions: [1, 3] }).displayValue).toBe(
      '<1x3 Simulink.Parameter>',
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
