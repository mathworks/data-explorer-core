// Copyright 2026 The MathWorks, Inc.
//
// ParameterNode holds a Simulink.Parameter, the most common class in a Design
// Data dictionary. The uncovered paths exercised here are the setProperty
// branches for complex values and string-array values, both of which store a
// child node for the non-scalar value. These are on the save path: a wrong
// serializeValue result is silent data corruption in the user's .sldd.
import { describe, it, expect } from 'vitest';
import ParameterNode from '../src/datamodel/node/data/ParameterNode.js';
import NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import { isMatCdata } from '../src/datamodel/parser/CdataCodec.js';
import * as NodeClassMap from '../src/datamodel/node/data/NodeClassMap.js';

// The raw shape the sldd parsers hand ParameterNode.parse: a 1x1
// Simulink.Parameter whose _properties carry the on-disk values.
function parseParam(props: Record<string, unknown>): ParameterNode {
  const rawVal = {
    _array_class: 'Simulink.Parameter',
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [{ _id: '1', _properties: Object.assign({ Complexity: 'real', Dimensions: [1, 1] }, props) }],
  };
  return ParameterNode.parse(rawVal as unknown as Record<string, unknown>, 'p', null);
}

function parseParamValue(value: unknown): ParameterNode {
  return parseParam({ Value: value });
}

function serializedValue(p: ParameterNode): unknown {
  return ((p as any).serializeValue() as any)._elements[0]._properties.Value;
}

/**
 * The complex number inside a serialized Value, read back out of the MAT byte
 * stream it now goes out as.
 *
 * `_type: 'cdata'` is worn by two different things, and for a complex value the
 * difference is the whole value: the byte stream is what MATLAB's own TEXT
 * dictionary carries, while the plain text '3+4i' is what a BINARY dictionary
 * carries for the same property — and MATLAB reads that plain text back out of a
 * text dictionary as an empty 1x0 double (probe_writeback, defect 24). isMatCdata is
 * the discriminator the writers themselves use. The assertions read the stream
 * rather than pinning its characters, because it is the number that has to survive.
 */
function complexFromStream(v: unknown): string {
  const w = v as { _type: string; _value: string };
  expect(w._type).toBe('cdata');
  expect(isMatCdata(w), 'expected a MAT byte stream, got ' + JSON.stringify(w._value)).toBe(true);
  return String((NodeRegistry.parseValue(w, 'Value', null) as any)._scalarValue);
}

// A Parameter's Value gets a child row only when the value has internal
// structure the row can expand into — more than one element, or struct fields.
// A scalar of ANY class shows inline in the Parameter's own Value column, so a
// child row would be an expander that reveals a single restatement of it. The
// on-disk spelling must not decide this: int16(500), Inf, and 3+4i all arrive as
// { _type, _value } wrapper objects while a plain double arrives as a bare
// number, and before this rule the wrapper alone produced a row — so two scalars
// a user sees as identical rendered differently, and the same Inf parameter was
// expandable in a JSON dictionary but not in a binary one.
describe('ParameterNode.parse — Value child row', () => {
  it('gives a typed integer scalar no child row', () => {
    const p = parseParamValue({ _type: 'int16', _value: '500' });
    expect(p.children.length).toBe(0);
    expect(p.displayValue).toBe('500');
  });

  it('keeps the typed-scalar wrapper on serialize with no child to hold it', () => {
    // Nothing may fall back to a bare 500: the wrapper is what carries int16
    // through both serializers, so dropping it silently retypes the value.
    const p = parseParamValue({ _type: 'int16', _value: '500' });
    expect(serializedValue(p)).toEqual({ _type: 'int16', _value: '500' });
  });

  it('gives a non-finite double scalar no child row', () => {
    const p = parseParamValue({ _type: 'double', _value: 'Inf' });
    expect(p.children.length).toBe(0);
    expect(p.displayValue).toBe('Inf');
    expect(serializedValue(p)).toEqual({ _type: 'double', _value: 'Inf' });
  });

  it('gives a complex scalar no child row', () => {
    const p = parseParamValue({ _type: 'cdata', _value: '3+4i' });
    expect(p.children.length).toBe(0);
    expect(p.displayValue).toBe('3+4i');
    // The plain text comes back out unchanged, and here that is right: this is the
    // spelling a BINARY dictionary carries for the property, it arrived that way, and
    // an untouched value is round-tripped byte for byte rather than re-rendered. Only
    // a value the USER typed is re-serialized — see the setProperty suite below,
    // where the same complex number has to become a MAT byte stream because it is
    // bound for a text dictionary that reads the plain text as an empty 1x0.
    expect(serializedValue(p)).toEqual({ _type: 'cdata', _value: '3+4i' });
  });

  it('gives a plain double scalar no child row', () => {
    const p = parseParamValue(7);
    expect(p.children.length).toBe(0);
    expect(p.displayValue).toBe('7');
  });

  it('gives an empty value no child row', () => {
    const p = parseParamValue([]);
    expect(p.children.length).toBe(0);
  });

  it('keeps a child row for a multi-element vector', () => {
    const p = parseParamValue([1, 2, 3]);
    expect(p.children.length).toBe(1);
    expect(p.children[0].name).toBe('Value');
    expect(p.displayValue).toBe('[1 2 3]');
  });

  it('keeps a child row for a typed vector', () => {
    const p = parseParamValue({ _type: 'int32', _value: '[100, 200, 300, 400]' });
    expect(p.children.length).toBe(1);
  });

  it('keeps a child row for a matrix', () => {
    const p = parseParamValue({ _type: 'double', _value: 'Matrix(2,3)\n[[1.0, 2.0, 3.0]; [4.0, 5.0, 6.0]]' });
    expect(p.children.length).toBe(1);
  });

  it('keeps a child row for a struct', () => {
    const p = parseParamValue({
      _array_type: 'Struct',
      _dimensions: [1, 1],
      _elements: [{ Kd: 0.1, Ki: 0.5, Kp: 1 }],
      _fields: ['Kp', 'Ki', 'Kd'],
    });
    expect(p.children.length).toBe(1);
    expect(p.children[0].name).toBe('Value');
  });

  it('keeps a child row for a string array', () => {
    const p = parseParamValue({ _array_type: 'String', _dimensions: [1, 2], _elements: ['hello', 'world'] });
    expect(p.children.length).toBe(1);
  });

  it('does not apply the rule to another class that has a Value property', () => {
    // Scoping guard. The inline-scalar rule above is a Simulink.Parameter
    // presentation choice, not a statement about values named "Value": a custom
    // class is a property bag whose rows ARE its properties, so its Value row must
    // survive even when it holds a typed scalar — the shape that loses its row on a
    // Parameter. Making the rule general would empty that object's tree.
    const custom = NodeClassMap.parseValue(
      {
        _array_class: 'MyPkg.MyGain',
        _dimensions: [1, 1],
        _elements: [{ _properties: { Value: { _type: 'int16', _value: '500' }, Notes: 'tuned' } }],
      },
      'g',
      null,
    );
    expect(custom.children.map((c) => c.name)).toEqual(['Value', 'Notes']);
  });
});

// The Data Type column and the PI's Data Type label read node.dataType. A
// Parameter's data type is a real, user-visible property stored in the dictionary
// ('int16', 'boolean', 'SensorReading', 'auto', a typedef name), but DataNode's
// dataType returns '' for object classes — so the column was blank for every
// Parameter in every dictionary, and with scalar values now shown inline (no
// Value child row to carry the type) the type had no other place to appear.
describe('ParameterNode.dataType', () => {
  it('reports the DataType stored in the dictionary', () => {
    const p = parseParam({ DataType: 'int16', Value: { _type: 'int16', _value: '500' } });
    expect(p.dataType).toBe('int16');
  });

  it('reports a non-builtin data type verbatim', () => {
    // A Parameter can be typed by a Simulink.AliasType/ValueType/enum defined
    // elsewhere in the dictionary, or by a hand-written typedef name. There is
    // nothing to map or validate here — MATLAB stores free-form text.
    const p = parseParam({ DataType: 'SensorReading', Value: 0 });
    expect(p.dataType).toBe('SensorReading');
  });

  it('reports auto when the dictionary stores no DataType', () => {
    // An absent DataType is MATLAB's default, 'auto' — not "unknown". A text sldd
    // omits the key for a default-typed Parameter while a binary one writes
    // DataType="auto" explicitly (verified on the matched pair
    // ~/delite/mix/param_json.sldd and param_bin.sldd, whose P01_Default came from
    // the same MATLAB script), so reading absence literally showed the SAME
    // parameter as blank in one format and 'auto' in the other.
    const p = parseParam({ Value: 7 });
    expect(p.dataType).toBe('auto');
  });

  it('reports auto for a freshly created Parameter', () => {
    expect(ParameterNode.createDefault('p', null).dataType).toBe('auto');
  });
});

// A Parameter's Value row exists only while the value node has something to
// expand into, so a structural edit INSIDE that node can cross the line in either
// direction and the row has to follow. Deleting elements of [1 2] down to one
// collapses the value to the scalar 1 — the row's own children are gone and it
// serializes as 1 — but the row itself stayed behind, empty, until the file was
// reloaded.
describe('ParameterNode — Value row follows a structural edit', () => {
  it('drops the row when the array collapses to a single element', () => {
    const p = parseParamValue([1, 2]);
    const valueNode = p.children[0] as any;
    expect(valueNode.execRemoveChild(valueNode.children[1])).toBeTruthy();
    expect(p.children.length).toBe(0);
    expect(p.displayValue).toBe('1');
    expect(serializedValue(p)).toBe(1);
  });

  it('brings the row back when the collapsing removal is undone', () => {
    const p = parseParamValue([1, 2]);
    const valueNode = p.children[0] as any;
    const edit = valueNode.execRemoveChild(valueNode.children[1]);
    edit.undo();
    expect(p.children.length).toBe(1);
    // The SAME node, not a rebuilt one: it is still this Parameter's _valueNode,
    // which is what formats and serializes the value.
    expect(p.children[0]).toBe(valueNode);
    expect(p.displayValue).toBe('[1 2]');
  });

  it('keeps the row when the array still has more than one element', () => {
    const p = parseParamValue([1, 2, 3]);
    const valueNode = p.children[0] as any;
    valueNode.execRemoveChild(valueNode.children[2]);
    expect(p.children.length).toBe(1);
    expect(p.displayValue).toBe('[1 2]');
  });

  it('drops the row when a string array collapses to a single element', () => {
    const p = parseParamValue({ _array_type: 'String', _dimensions: [1, 2], _elements: ['hello', 'world'] });
    const valueNode = p.children[0] as any;
    valueNode.execRemoveChild(valueNode.children[1]);
    expect(p.children.length).toBe(0);
    expect(p.displayValue).toBe('"hello"');
  });

  // The other way to cross that line: not adding or removing an element, but
  // restating the whole value. The table's Value cell on the Value row commits
  // through MatlabVariableNode.setProperty, which rebuilds the node's children from
  // the text — and used to tell nobody, so a matrix retyped as a scalar left the
  // Parameter holding a childless Value row. The consumer that repaints from the
  // node it mutated (rather than from a re-read of the file) then paints a row a
  // re-read would not: an expander onto nothing, under a scalar.
  it('drops the row when the value row itself is retyped as a scalar', () => {
    const p = parseParamValue([1, 2]);
    const valueNode = p.children[0] as any;
    expect(valueNode.setProperty('Value', '42')).toBe(true);
    expect(valueNode.children.length).toBe(0);
    expect(p.children.length).toBe(0);
    expect(p.displayValue).toBe('42');
    expect(serializedValue(p)).toBe(42);
  });

  it('keeps the row when the value row is retyped as another array', () => {
    const p = parseParamValue([1, 2]);
    const valueNode = p.children[0] as any;
    expect(valueNode.setProperty('Value', '[7 8 9]')).toBe(true);
    // The SAME node: it is still this Parameter's _valueNode.
    expect(p.children).toEqual([valueNode]);
    expect(p.displayValue).toBe('[7 8 9]');
  });

  it('brings the row back when a hidden scalar value node becomes an array', () => {
    // The inverse, and the reason the notification is not a one-way "drop it". A
    // TYPED scalar keeps its value node with no row of its own (the node is what
    // writes int32 back out), so the row has to appear when that node grows
    // children. Reached by a caller holding the value node itself rather than by the
    // table, which has no row to double-click — but it is the same hook, and a
    // one-way version of it would be a latent half-fix.
    const p = parseParamValue({ _type: 'int32', _value: '5' });
    expect(p.children.length).toBe(0);
    const valueNode = (p as any)._valueNode;
    expect(valueNode.setProperty('Value', '[1 2]')).toBe(true);
    expect(p.children).toEqual([valueNode]);
    expect(p.displayValue).toBe('[1 2]');
  });

  it('adds the row when the ENTRY\'s own value is retyped as an array', () => {
    // The path the table actually takes for a scalar Parameter — there is no Value
    // row to edit, so the edit lands on the entry and goes through
    // ParameterNode.setProperty, which re-adopts the value node and so decides the
    // row itself. Pinned beside the others because a consumer repainting from the
    // mutated node needs BOTH spellings of "the value changed shape" to leave the
    // same tree a re-read would build.
    const p = parseParamValue(5);
    expect(p.setProperty('Value', '[1 2]')).toBe(true);
    expect(p.children.map((c) => c.name)).toEqual(['Value']);
    expect(p.children[0].children.length).toBe(2);
    expect(p.displayValue).toBe('[1 2]');
  });

  it('does not drop another class\'s Value row when its array collapses', () => {
    // Scoping guard, the counterpart of the parse-time one: a property bag's rows
    // ARE its properties, so MyGain.Value must survive becoming a scalar. Only
    // Simulink.Parameter ties the row's existence to the value's shape.
    const custom = NodeClassMap.parseValue(
      {
        _array_class: 'MyPkg.MyGain',
        _dimensions: [1, 1],
        _elements: [{ _properties: { Value: { _type: 'int32', _value: '[1, 2]' }, Notes: 'tuned' } }],
      },
      'g',
      null,
    );
    const valueNode = custom.children[0] as any;
    valueNode.execRemoveChild(valueNode.children[1]);
    expect(custom.children.map((c) => c.name)).toEqual(['Value', 'Notes']);
  });
});

describe('ParameterNode.setProperty — complex value', () => {
  it('accepts a complex literal, shows it inline, and serializes it back', () => {
    // A complex Parameter value (e.g. impedance) must round-trip: the user types
    // "3+4i", the display shows "3+4i", and the saved .sldd carries a value MATLAB
    // reads back as 3+4i. A complex SCALAR is one element, so it gets no child row —
    // the wrapper still has to survive.
    //
    // This used to save the plain text { _type: 'cdata', _value: '3+4i' }, and
    // MATLAB read it back as an empty 1x0 double: the most ordinary edit there is,
    // destroyed on the first save. The cause was not the writer — the writer had the
    // stream — but that _adoptValueNode left the value node unmodified, so
    // serializeValue replayed the raw value we had just synthesised and the writer
    // was never reached. MATLAB confirms the stream: probe_writeback's
    // paramedit/aParam[cplx] reopens as a 1x1 double equal to 3+4i.
    const p = ParameterNode.createDefault('p', null);
    expect(p.setProperty('Value', '3+4i')).toBe(true);
    expect(p.displayValue).toBe('3+4i');
    expect(p.children.length).toBe(0);

    expect(complexFromStream(serializedValue(p))).toBe('3+4i');
  });

  it('writes a typed matrix value with the body MATLAB reads, not the newline one', () => {
    // The same defect as the complex value above, in the branch next door, and the
    // reason to fix _adoptValueNode rather than the complex arm alone: setProperty
    // builds `Matrix(2,2)\n[1, 2]\n[3, 4]` as its intermediate, and MATLAB reads a
    // newline-joined body back as an empty 1x0 double (defect 19). The writer's
    // spelling joins the rows with '; ' and writes each double as MATLAB does, and
    // reaching it is the whole fix. probe_writeback's paramedit/aParam[mat] reopens
    // as a 2x2 double, column-major [1 3 2 4].
    const p = ParameterNode.createDefault('p', null);
    expect(p.setProperty('Value', '[1 2; 3 4]')).toBe(true);
    expect(serializedValue(p)).toEqual({ _type: 'double', _value: 'Matrix(2,2)\n[[1.0, 2.0]; [3.0, 4.0]]' });
  });

  it('drops a previous child node when switching to a complex value', () => {
    const p = ParameterNode.createDefault('p', null);
    p.setProperty('Value', '[1 2 3]');
    expect(p.children.length).toBe(1);
    p.setProperty('Value', '5+6i');
    // The old array child must be gone — keeping it would produce a broken tree
    // and a serializeValue that writes the wrong type.
    expect(p.children.length).toBe(0);
    expect(p.displayValue).toBe('5+6i');
    expect(complexFromStream(serializedValue(p))).toBe('5+6i');
  });

  it('drops the child row when switching from a vector to a scalar', () => {
    const p = ParameterNode.createDefault('p', null);
    p.setProperty('Value', '[1 2 3]');
    expect(p.children.length).toBe(1);
    p.setProperty('Value', '42');
    expect(p.children.length).toBe(0);
    expect(p.displayValue).toBe('42');
    expect(serializedValue(p)).toBe(42);
  });

  it('gives a single-element vector no child row', () => {
    // [5] IS 5 in MATLAB — the brackets are not structure.
    const p = ParameterNode.createDefault('p', null);
    expect(p.setProperty('Value', '[5]')).toBe(true);
    expect(p.children.length).toBe(0);
  });
});

// A STRING scalar is the one text class MATLAB actually stores in a
// Simulink.Parameter's Value — its setter coerces all text to a 1x1 string
// (DESIGN.md, measured on R2027a) — and it is the one the edit path used to drop.
// `"abc"` parses to type 'string', which had no arm of its own here, so it fell
// through to the catch-all that stores the parser's bare JS string. A bare JS
// string is this model's spelling for a CHAR: PropValue.format quotes it with
// formatMatlabChar and both writers emit it as char. So typing a string literal
// displayed `'abc'` and saved a char.
//
// The read path never had the bug — a 1x1 string arrives as the one-element list
// `["abc"]` and displays `"abc"` — which is what made the round trip below lose
// data: the table seeds its in-place editor with the displayed text, so committing
// a string Parameter's own cell unchanged retyped it to char. Same defect shape as
// 25 (a char matrix retyped to string) and the `it''s` quoting note in PropValue,
// so the assertions pin the two paths AGAINST EACH OTHER rather than one each.
describe('ParameterNode.setProperty — string scalar value', () => {
  const STRING_SCALAR_RAW = ['abc'];

  it('keeps the string class of a value typed as a string literal', () => {
    const p = ParameterNode.createDefault('p', null);
    expect(p.setProperty('Value', '"abc"')).toBe(true);
    expect(p.displayValue).toBe('"abc"');
    // No child row: a 1x1 has nothing to expand into, the same rule every other
    // scalar class follows here.
    expect(p.children.length).toBe(0);
    expect(serializedValue(p)).toEqual(STRING_SCALAR_RAW);
  });

  it('stores what the read path stores for the same value', () => {
    // The invariant that matters is BETWEEN the paths: one MATLAB value, one stored
    // spelling, whichever way it got here. Asserting each path's output separately
    // is what let them drift.
    const read = parseParamValue(STRING_SCALAR_RAW);
    const edited = ParameterNode.createDefault('p', null);
    edited.setProperty('Value', '"abc"');
    expect(edited.displayValue).toBe(read.displayValue);
    expect(serializedValue(edited)).toEqual(serializedValue(read));
  });

  it('survives a commit of its own displayed text', () => {
    // The table's in-place editor opens seeded with the displayed text, so an
    // accidental Enter on a string Parameter runs exactly this. It used to change
    // the value's class and mark the file dirty.
    const p = parseParamValue(STRING_SCALAR_RAW);
    expect(p.setProperty('Value', p.displayValue)).toBe(true);
    expect(p.displayValue).toBe('"abc"');
    expect(serializedValue(p)).toEqual(STRING_SCALAR_RAW);
  });

  it('escapes an embedded double quote both ways', () => {
    // MATLAB doubles a quote inside a string literal, so the text `a"b` displays as
    // "a""b" — and that text has to parse back to the same three characters.
    const p = ParameterNode.createDefault('p', null);
    expect(p.setProperty('Value', '"a""b"')).toBe(true);
    expect(p.displayValue).toBe('"a""b"');
    expect(serializedValue(p)).toEqual(['a"b']);
  });

  it('leaves a char literal a char', () => {
    // The recorded divergence next door (DESIGN.md): MATLAB coerces `p.Value = 'abc'`
    // to string("abc") and we keep char. Unchanged deliberately — coercing would
    // retype every char Parameter in the corpus — and pinned here so the string fix
    // is visibly not that change.
    const p = ParameterNode.createDefault('p', null);
    expect(p.setProperty('Value', "'abc'")).toBe(true);
    expect(p.displayValue).toBe("'abc'");
    expect(serializedValue(p)).toBe('abc');
  });
});

describe('ParameterNode.setProperty — string-array value', () => {
  it('accepts a string-array literal and serializes the String wrapper', () => {
    // String arrays are used in Simulink for multi-valued string parameters
    // (e.g. variant condition labels). The child carries the _array_type String
    // wrapper that both the JSON and binary serializers rely on.
    //
    // `_mw_element_type` is part of that wrapper, and it appears here because the
    // typed value now reaches the writer instead of replaying the raw object
    // setProperty synthesised. It is MATLAB's own key, not ours: cases.sldd's
    // strArray and strMat, both written by MATLAB, carry
    // `"_mw_element_type": "MATLABArray"` on exactly this wrapper. The old
    // expectation pinned its ABSENCE.
    const p = ParameterNode.createDefault('p', null);
    expect(p.setProperty('Value', '["hello" "world"]')).toBe(true);
    expect(p.displayValue).toBe('["hello" "world"]');

    const serialized = (p as any).serializeValue() as any;
    expect(serialized._elements[0]._properties.Value).toEqual({
      _array_type: 'String',
      _dimensions: [1, 2],
      _elements: ['hello', 'world'],
      _mw_element_type: 'MATLABArray',
    });
  });
});

describe('ParameterNode._normalizeMinMax', () => {
  it('treats an empty array as undefined (MATLAB stores [] to mean "no bound")', () => {
    // On-disk Min/Max of [] (empty MATLAB array) parses to []. The node must
    // treat that as "unset", not as a truthy array, or the property inspector
    // would display "[]" as a meaningful constraint.
    expect(ParameterNode._normalizeMinMax([])).toBeUndefined();
  });

  it('passes through a number unchanged', () => {
    expect(ParameterNode._normalizeMinMax(42)).toBe(42);
  });

  it('passes through undefined unchanged', () => {
    expect(ParameterNode._normalizeMinMax(undefined)).toBeUndefined();
  });
});
