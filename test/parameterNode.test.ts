// Copyright 2026 The MathWorks, Inc.
//
// ParameterNode holds a Simulink.Parameter, the most common class in a Design
// Data dictionary. The uncovered paths exercised here are the setProperty
// branches for complex values and string-array values, both of which store a
// child node for the non-scalar value. These are on the save path: a wrong
// serializeValue result is silent data corruption in the user's .sldd.
import { describe, it, expect } from 'vitest';
import ParameterNode from '../src/datamodel/node/data/ParameterNode.js';
import * as NodeClassMap from '../src/datamodel/node/NodeClassMap.js';

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
    // A complex Parameter value (e.g. impedance) must round-trip: the user
    // types "3+4i", the display shows "3+4i", and the saved .sldd carries
    // { _type: 'cdata', _value: '3+4i' } under .Value. A complex SCALAR is one
    // element, so it gets no child row — the cdata wrapper still has to survive.
    const p = ParameterNode.createDefault('p', null);
    expect(p.setProperty('Value', '3+4i')).toBe(true);
    expect(p.displayValue).toBe('3+4i');
    expect(p.children.length).toBe(0);

    expect(serializedValue(p)).toEqual({
      _type: 'cdata',
      _value: '3+4i',
    });
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
    expect(serializedValue(p)).toEqual({ _type: 'cdata', _value: '5+6i' });
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

describe('ParameterNode.setProperty — string-array value', () => {
  it('accepts a string-array literal and serializes the String wrapper', () => {
    // String arrays are used in Simulink for multi-valued string parameters
    // (e.g. variant condition labels). The child carries the _array_type String
    // wrapper that both the JSON and binary serializers rely on.
    const p = ParameterNode.createDefault('p', null);
    expect(p.setProperty('Value', '["hello" "world"]')).toBe(true);
    expect(p.displayValue).toBe('["hello" "world"]');

    const serialized = (p as any).serializeValue() as any;
    expect(serialized._elements[0]._properties.Value).toEqual({
      _array_type: 'String',
      _dimensions: [1, 2],
      _elements: ['hello', 'world'],
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
