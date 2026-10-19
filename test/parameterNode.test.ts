// Copyright 2026 The MathWorks, Inc.
//
// ParameterNode holds a Simulink.Parameter, the most common class in a Design
// Data dictionary. The uncovered paths exercised here are the setProperty
// branches for complex values and string-array values, both of which store a
// child node for the non-scalar value. These are on the save path: a wrong
// serializeValue result is silent data corruption in the user's .sldd.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ParameterNode from '../src/datamodel/node/data/ParameterNode.js';
import NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import { isMatCdata } from '../src/datamodel/parser/CdataCodec.js';
import * as NodeClassMap from '../src/datamodel/node/data/NodeClassMap.js';
import MatlabValueParser from '../src/datamodel/parser/MatlabValueParser.js';
import type { SetPropertyResult } from '../src/datamodel/node/DataNode.js';

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
    // DataType="auto" explicitly (verified on a matched pair of MATLAB-written
    // dictionaries, one text and one binary, whose P01_Default came from
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
  it('refuses a string-array literal, as MATLAB does, and keeps one a file holds', () => {
    // MATLAB refuses a string ARRAY as a Parameter's Value: `p.Value = ["a" "b"]` raises
    // Simulink:Data:Param_Invalid_Value, the cell's error, because the text it accepts is a
    // string SCALAR (top_string_row in fixtures/parameter_value_truth.json). This test pinned
    // the opposite, on the belief that string arrays serve multi-valued string parameters,
    // until the maintainer's 2026-10-15 ruling on C-042 flipped it to MATLAB's answer.
    const p = ParameterNode.createDefault('p', null);
    expect(p.setProperty('Value', '["hello" "world"]')).toEqual({
      error: true,
      reason:
        'Invalid value specified for parameter. Value must be a numeric array, fi object, enumerated value, structure whose fields contain valid values, string scalar, or an expression.',
      invalidValue: '["hello" "world"]',
      validValue: p.displayValue,
    });
    expect(serializedValue(p)).toBeUndefined();

    // Only the edit is refused. A file's String wrapper still reads, shows and saves as it
    // was, `_mw_element_type` included, which is MATLAB's own key on this wrapper (cases.sldd's
    // strArray and strMat).
    const held = {
      _array_type: 'String',
      _dimensions: [1, 2],
      _elements: ['hello', 'world'],
      _mw_element_type: 'MATLABArray',
    };
    const read = parseParamValue(held);
    expect(read.displayValue).toBe('["hello" "world"]');
    expect(serializedValue(read)).toEqual(held);
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

// The 2026-10-15 ruling on C-160 and C-042: "mirror the matlab edit-time checking, and yes,
// the Simulink.Parameter Value has more constraints than normal struct variable." So an edit
// that would give a Parameter a Value MATLAB refuses to assign is refused, with MATLAB's
// message, and a struct inside the Value is held to the Parameter's rules. What MATLAB refuses
// is not written down here: every expectation below is read from
// fixtures/parameter_value_truth.json, which test/parity/matlab/probe_parameter_value.m wrote by
// assigning each value to a Simulink.Parameter in MATLAB. Each row names the case it mirrors.
describe('ParameterNode — a Value edit gets the answer MATLAB gives on assignment', () => {
  interface ProbeCase { id: string; expr: string; accepted: boolean; identifier: string; message: string }
  const PROBE = JSON.parse(
    readFileSync(fileURLToPath(new URL('./fixtures/parameter_value_truth.json', import.meta.url)), 'utf8'),
  ) as { release: string; cases: ProbeCase[] };

  function matlab(id: string): { accepted: boolean; message: string } {
    const c = PROBE.cases.find((x) => x.id === id);
    if (!c) {
      throw new Error('no probe case ' + id);
    }
    return { accepted: c.accepted, message: c.message };
  }

  function outcome(r: true | SetPropertyResult): { accepted: boolean; message: string } {
    return r === true ? { accepted: true, message: '' } : { accepted: false, message: r.reason };
  }

  const struct = (fields: Record<string, unknown>, dims: number[] = [1, 1]) => ({
    _array_type: 'Struct',
    _dimensions: dims,
    _elements: [fields],
    _fields: Object.keys(fields),
  });
  const structArray = (elements: Record<string, unknown>[], dims: number[] = [1, elements.length]) => ({
    _array_type: 'Struct',
    _dimensions: dims,
    _elements: elements,
    _fields: Object.keys(elements[0]),
  });

  // The node at `path` under the Parameter's Value row: a field by name, an element by index.
  function at(p: ParameterNode, path: Array<string | number>): any {
    let n: any = p.children[0];
    for (const step of path) {
      n = typeof step === 'number' ? n.children[step] : n.children.find((c: any) => c.name === step);
    }
    return n;
  }

  it('reads the truth MATLAB wrote', () => {
    expect(PROBE.release).toBe('2027a');
    expect(PROBE.cases.length).toBe(78);
  });

  // Every top-level case whose expression the Value editor can parse. The list is spelled out
  // so that a probe edit dropping one is a red here, not a row that silently stops being run.
  const TOP = [
    'top_empty_double', 'top_empty_char', 'top_empty_string', 'top_empty_cell', 'top_char',
    'top_char_matrix', 'top_string_scalar', 'top_string_bracketed', 'top_string_array',
    'top_string_row', 'top_cell', 'top_logical', 'top_logical_array', 'top_complex', 'top_nan',
    'top_matrix',
  ];

  it('covers every top-level case the editor can type', () => {
    const typeable = PROBE.cases.filter((c) => c.id.startsWith('top_') && MatlabValueParser.parse(c.expr)).map((c) => c.id);
    expect(typeable).toEqual(TOP);
  });

  for (const id of TOP) {
    const expr = PROBE.cases.find((c) => c.id === id)!.expr;

    it(`${id}: ${expr} typed into the Parameter's own Value`, () => {
      const p = ParameterNode.createDefault('p', null);
      expect(outcome(p.setProperty('Value', expr))).toEqual(matlab(id));
    });

    // The Value ROW is a node of its own, with a setter of its own, and it is the Parameter's
    // Value just the same: typed there, a cell was taken where the Parameter's own cell refused it.
    it(`${id}: ${expr} typed into the Parameter's Value row`, () => {
      const p = parseParamValue([1, 2, 3]);
      const before = JSON.stringify(serializedValue(p));
      const result = at(p, []).setProperty('Value', expr);
      expect(outcome(result)).toEqual(matlab(id));
      if (result !== true) {
        expect(JSON.stringify(serializedValue(p))).toBe(before);
      }
    });
  }

  // [case, the Value before the edit, the node edited, what is typed]. The Value before is one
  // MATLAB accepts, and the edit makes it the case's expression.
  const FIELD: Array<[string, unknown, Array<string | number>, string]> = [
    ['field_empty_double', struct({ a: 1 }), ['a'], '[]'],
    ['field_empty_char', struct({ a: 1 }), ['a'], "''"],
    ['field_empty_string', struct({ a: 1 }), ['a'], '""'],
    ['field_char', struct({ a: 1 }), ['a'], "'abc'"],
    ['field_char_matrix', struct({ a: 1 }), ['a'], "['ab'; 'cd']"],
    ['field_string_scalar', struct({ a: 1 }), ['a'], '"abc"'],
    ['field_string_array', struct({ a: 1 }), ['a'], '["a" "b"]'],
    ['field_string_column', struct({ a: 1 }), ['a'], '["ab"; "cd"]'],
    ['field_cell', struct({ a: 1 }), ['a'], '{1, 2}'],
    ['field_empty_cell', struct({ a: 1 }), ['a'], '{}'],
    ['field_logical', struct({ a: 1 }), ['a'], 'true'],
    ['field_logical_array', struct({ a: 1 }), ['a'], '[true false]'],
    ['field_complex', struct({ a: 1 }), ['a'], '1+2i'],
    ['field_nan', struct({ a: 1 }), ['a'], 'NaN'],
    ['field_matrix', struct({ a: 1 }), ['a'], '[1 2; 3 4]'],
    ['field_nested_ok', struct({ a: struct({ b: 2 }) }), ['a', 'b'], '1'],
    ['field_nested_empty', struct({ a: struct({ b: 1 }) }), ['a', 'b'], '[]'],
    ['field_nested_char', struct({ a: struct({ b: 1 }) }), ['a', 'b'], "'x'"],
    ['field_nested_string', struct({ a: struct({ b: 1 }) }), ['a', 'b'], '"x"'],
    ['field_nested_cell', struct({ a: struct({ b: 1 }) }), ['a', 'b'], '{1}'],
    ['two_fields_one_empty', struct({ a: 1, b: 1 }), ['b'], '[]'],
    // A struct ARRAY Value, MATLAB's other message: its elements also have to agree with one
    // another, field by field, in class, complexity and size.
    ['struct_array_1x2', structArray([{ a: 1 }, { a: 1 }]), [1, 'a'], '2'],
    ['struct_array_one_empty', structArray([{ a: 1 }, { a: 1 }]), [1, 'a'], '[]'],
    ['struct_array_one_char', structArray([{ a: 1 }, { a: 1 }]), [1, 'a'], "'x'"],
    ['sa_dims_differ', structArray([{ a: 1 }, { a: 1 }]), [1, 'a'], '[1 2]'],
    ['sa_complex_differ', structArray([{ a: 1 }, { a: 1 }]), [1, 'a'], '1+2i'],
    ['sa_logical_vs_double', structArray([{ a: 1 }, { a: 1 }]), [0, 'a'], 'true'],
    ['sa_cell_element', structArray([{ a: 1 }, { a: 1 }]), [1, 'a'], '{2}'],
    ['sa_logical_same', structArray([{ a: true }, { a: true }]), [1, 'a'], 'false'],
    ['sa_matrix_same', structArray([{ a: [1, 2] }, { a: [1, 2] }]), [1, 'a'], '[3 4]'],
    ['sa_char_same', structArray([{ a: 'x' }, { a: 'x' }]), [1, 'a'], "'y'"],
    ['sa_char_len_differ', structArray([{ a: 'x' }, { a: 'x' }]), [1, 'a'], "'yz'"],
    ['sa_string_same', structArray([{ a: ['x'] }, { a: ['x'] }]), [1, 'a'], '"y"'],
    ['sa_string_len_differ', structArray([{ a: ['x'] }, { a: ['x'] }]), [1, 'a'], '"yz"'],
    ['sa_char_vs_string', structArray([{ a: 'x' }, { a: 'x' }]), [1, 'a'], '"x"'],
    ['sa_two_fields_char', structArray([{ a: 1, b: 'x' }, { a: 2, b: 'x' }]), [1, 'b'], "'y'"],
    ['sa_nested_same', structArray([{ a: struct({ b: 1 }) }, { a: struct({ b: 1 }) }]), [1, 'a', 'b'], '2'],
    ['sa_nested_dims_differ', structArray([{ a: struct({ b: 1 }) }, { a: struct({ b: 1 }) }]), [1, 'a', 'b'], '[1 2]'],
    ['sa_nested_empty', structArray([{ a: struct({ b: 1 }) }, { a: struct({ b: 1 }) }]), [1, 'a', 'b'], '[]'],
    ['sa_column_2x1', structArray([{ a: 1 }, { a: 1 }], [2, 1]), [1, 'a'], '2'],
    ['sa_column_one_empty', structArray([{ a: 1 }, { a: 1 }], [2, 1]), [1, 'a'], '[]'],
    // A struct array INSIDE a scalar struct: the inner elements have to agree too, and the
    // message is the scalar struct's.
    ['field_sa_ok', struct({ a: structArray([{ b: 1 }, { b: 1 }]) }), ['a', 1, 'b'], '2'],
    ['field_sa_one_empty', struct({ a: structArray([{ b: 1 }, { b: 1 }]) }), ['a', 1, 'b'], '[]'],
    ['field_sa_dims_differ', struct({ a: structArray([{ b: 1 }, { b: 1 }]) }), ['a', 1, 'b'], '[1 2]'],
    ['field_sa_one_char', struct({ a: structArray([{ b: 1 }, { b: 1 }]) }), ['a', 1, 'b'], "'x'"],
  ];

  for (const [id, value, path, text] of FIELD) {
    it(`${id}: ${text} typed into ${path.join('.')} of a struct Value`, () => {
      const p = parseParamValue(value);
      const before = JSON.stringify(serializedValue(p));
      const node = at(p, path);
      expect(node.constructor.name).toBe('MatlabVariableNode');
      const result = node.setProperty('Value', text);
      expect(outcome(result)).toEqual(matlab(id));
      if (result === true) {
        expect(JSON.stringify(serializedValue(p))).not.toBe(before);
      } else {
        expect(JSON.stringify(serializedValue(p))).toBe(before);
        expect(result.invalidValue).toBe(text);
        expect(result.validValue).toBe(node.displayValue);
      }
    });
  }

  // The other half of the ruling: the rules are the Parameter's, not a struct's. A plain struct
  // variable takes every one of the values a Parameter's struct Value refuses.
  it('leaves a plain struct variable taking what a Parameter refuses', () => {
    for (const [id, value, path, text] of FIELD) {
      if (matlab(id).accepted) {
        continue;
      }
      const s = NodeRegistry.parseValue(value, 's', null) as any;
      let n: any = s;
      for (const step of path) {
        n = typeof step === 'number' ? n.children[step] : n.children.find((c: any) => c.name === step);
      }
      expect(n.setProperty('Value', text), id).toBe(true);
    }
  });
});

// The 2026-10-15 evening ruling A2: "structural edits follow the same policy as value edits.
// Removing or adding a field or an element inside a Simulink.Parameter's Value is refused where
// MATLAB refuses the resulting Value. The cases are added to the MATLAB probe and mirrored
// exactly." Each case below is a `structural` row of fixtures/parameter_value_truth.json, which
// probe_parameter_value.m wrote by making the edit in MATLAB and assigning the Value it left.
describe('ParameterNode — a structural edit in the Value gets the answer MATLAB gives on assignment', () => {
  interface StructuralCase { id: string; edit: string; baseAccepted: boolean; accepted: boolean; message: string }
  const STRUCTURAL = (
    JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/parameter_value_truth.json', import.meta.url)), 'utf8')) as {
      structural: StructuralCase[];
    }
  ).structural;
  const matlab = (id: string): { accepted: boolean; message: string } => {
    const c = STRUCTURAL.find((x) => x.id === id);
    if (!c) {
      throw new Error('no structural probe case ' + id);
    }
    expect(c.baseAccepted, `${id}: MATLAB takes the Value it starts from`).toBe(true);
    return { accepted: c.accepted, message: c.message };
  };

  const struct = (fields: Record<string, unknown>) => ({ _array_type: 'Struct', _dimensions: [1, 1], _elements: [fields], _fields: Object.keys(fields) });
  const structArray = (elements: Record<string, unknown>[], dims: number[] = [1, elements.length]) => ({
    _array_type: 'Struct',
    _dimensions: dims,
    _elements: elements,
    _fields: Object.keys(elements[0]),
  });
  const col = (a: number, b: number) => ({ _type: 'double', _value: `Matrix(2,1)\n[${a}, ${b}]` });
  const lgl = (a: number, b: number) => ({ _type: 'logical', _value: `[${a}, ${b}]` });

  // [case, the Value before the edit, the node edited (under the Value row), the edit: 'add', or
  // the name or index of the child removed]. Each is the probe row's edit, as the tree makes it:
  // Add gives a struct a field `field` holding 0 and an array a 0 of its class.
  const CASES: Array<[string, unknown, Array<string | number>, 'add' | string | number]> = [
    ['sx_remove_field', struct({ a: 1, b: 2 }), [], 'b'],
    ['sx_remove_last_field', struct({ a: 1 }), [], 'a'],
    ['sx_add_field', struct({ a: 1 }), [], 'add'],
    ['sx_nested_remove_field', struct({ a: struct({ b: 1, c: 2 }) }), ['a'], 'c'],
    ['sx_nested_remove_last_field', struct({ a: struct({ b: 1 }) }), ['a'], 'b'],
    ['sx_nested_add_field', struct({ a: struct({ b: 1 }) }), ['a'], 'add'],
    ['sx_deep_remove_last_field', struct({ a: struct({ b: struct({ c: 1 }) }) }), ['a', 'b'], 'c'],
    ['sx_array_add_element', struct({ c: [1, 2] }), ['c'], 'add'],
    ['sx_array_remove_element', struct({ c: [1, 2, 3] }), ['c'], 1],
    ['sx_array_remove_to_scalar', struct({ c: [1, 2] }), ['c'], 1],
    ['sx_column_add_element', struct({ c: col(1, 2) }), ['c'], 'add'],
    ['sx_logical_add_element', struct({ c: lgl(1, 0) }), ['c'], 'add'],
    ['sx_int8_add_element', struct({ c: { _type: 'int8', _value: '[1, 2]' } }), ['c'], 'add'],
    ['sx_complex_add_element', struct({ c: { _type: 'cdata', _value: '1+2i 3+4i', _dimensions: [1, 2] } }), ['c'], 'add'],
    ['sx_nested_array_add_element', struct({ a: struct({ c: [1, 2] }) }), ['a', 'c'], 'add'],
    ['sa_array_add_element', structArray([{ v: [1, 2] }, { v: [3, 4] }]), [1, 'v'], 'add'],
    ['sa_array_remove_element', structArray([{ v: [1, 2] }, { v: [3, 4] }]), [1, 'v'], 1],
    ['sa_column_add_element', structArray([{ v: col(1, 2) }, { v: col(3, 4) }]), [0, 'v'], 'add'],
    ['sa_logical_remove_element', structArray([{ v: lgl(1, 0) }, { v: lgl(0, 1) }]), [0, 'v'], 1],
    ['sa_2x1_add_element', structArray([{ v: [1, 2] }, { v: [3, 4] }], [2, 1]), [1, 'v'], 'add'],
    ['sa_two_fields_add_element', structArray([{ a: 1, v: [1, 2] }, { a: 2, v: [3, 4] }]), [0, 'v'], 'add'],
    ['sa_nested_remove_field', structArray([{ a: struct({ b: 1, c: 2 }) }, { a: struct({ b: 3, c: 4 }) }]), [1, 'a'], 'c'],
    ['sa_nested_add_field', structArray([{ a: struct({ b: 1 }) }, { a: struct({ b: 2 }) }]), [1, 'a'], 'add'],
    ['sa_nested_remove_last_field', structArray([{ a: struct({ b: 1 }) }, { a: struct({ b: 2 }) }]), [1, 'a'], 'b'],
    ['sa_nested_array_add_element', structArray([{ a: struct({ c: [1, 2] }) }, { a: struct({ c: [3, 4] }) }]), [1, 'a', 'c'], 'add'],
    ['fsa_array_add_element', struct({ a: structArray([{ v: [1, 2] }, { v: [3, 4] }]) }), ['a', 1, 'v'], 'add'],
    ['fsa_array_remove_element', struct({ a: structArray([{ v: [1, 2] }, { v: [3, 4] }]) }), ['a', 1, 'v'], 0],
    ['fsa_nested_remove_field', struct({ a: structArray([{ b: struct({ c: 1, d: 2 }) }, { b: struct({ c: 3, d: 4 }) }]) }), ['a', 1, 'b'], 'd'],
    ['top_array_add_element', [1, 2], [], 'add'],
    ['top_array_remove_element', [1, 2, 3], [], 1],
    ['top_array_remove_to_scalar', [1, 2], [], 1],
    ['top_logical_add_element', lgl(1, 0), [], 'add'],
  ];

  function at(root: any, path: Array<string | number>): any {
    let n: any = root;
    for (const step of path) {
      n = typeof step === 'number' ? n.children[step] : n.children.find((c: any) => c.name === step);
    }
    return n;
  }
  const childOf = (node: any, edit: string | number) => (typeof edit === 'number' ? node.children[edit] : node.children.find((c: any) => c.name === edit));

  it('covers every structural case the probe measured', () => {
    expect(CASES.map(([id]) => id)).toEqual(STRUCTURAL.map((c) => c.id));
  });

  for (const [id, value, path, edit] of CASES) {
    it(`${id}: ${edit === 'add' ? 'Add' : `removing ${edit}`} at ${path.join('.') || 'the Value'}`, () => {
      const want = matlab(id);
      const p = parseParamValue(value);
      const before = JSON.stringify(serializedValue(p));
      const node = at(p.children[0], path);
      expect(node, `${id}: the node edited`).toBeDefined();
      const op = edit === 'add' ? 'add' : 'remove';
      const gate = op === 'add' ? node.canAddChild() : node.canRemoveChild();
      expect({ gate, refusal: node._structuralRefusal(op) }).toEqual({ gate: want.accepted, refusal: want.accepted ? null : want.message });
      const result = op === 'add' ? node.execAddChild() : node.execRemoveChild(childOf(node, edit));
      if (want.accepted) {
        expect(result, id).not.toBeNull();
        expect(JSON.stringify(serializedValue(p))).not.toBe(before);
      } else {
        expect(result, id).toBeNull();
        expect(JSON.stringify(serializedValue(p))).toBe(before);
      }
    });
  }

  // The rules are the Parameter's: a plain struct variable takes every edit refused here.
  it('leaves a plain struct variable taking every structural edit a Parameter refuses', () => {
    for (const [id, value, path, edit] of CASES) {
      if (matlab(id).accepted || !path.length) {
        continue;
      }
      const s = NodeRegistry.parseValue(value, 's', null) as any;
      const node = at(s, path);
      expect([id, edit === 'add' ? node.canAddChild() : node.canRemoveChild()]).toEqual([id, true]);
    }
  });
});
