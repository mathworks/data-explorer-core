// Copyright 2026 The MathWorks, Inc.
//
// ParameterNode holds a Simulink.Parameter, the most common class in a Design
// Data dictionary. The uncovered paths exercised here are the setProperty
// branches for complex values and string-array values, both of which store a
// child node for the non-scalar value. These are on the save path: a wrong
// serializeValue result is silent data corruption in the user's .sldd.
import { describe, it, expect } from 'vitest';
import ParameterNode from '../src/datamodel/node/data/ParameterNode.js';
import '../src/datamodel/node/NodeClassMap.js';

describe('ParameterNode.setProperty — complex value', () => {
  it('accepts a complex literal, stores a cdata child, and serializes it back', () => {
    // A complex Parameter value (e.g. impedance) must round-trip: the user
    // types "3+4i", the display shows "3+4i", and the saved .sldd carries
    // { _type: 'cdata', _value: '3+4i' } under .Value.
    const p = ParameterNode.createDefault('p', null);
    expect(p.setProperty('Value', '3+4i')).toBe(true);
    expect(p.displayValue).toBe('3+4i');
    expect(p.children.length).toBe(1);

    const serialized = (p as any).serializeValue() as any;
    expect(serialized._elements[0]._properties.Value).toEqual({
      _type: 'cdata',
      _value: '3+4i',
    });
  });

  it('replaces a previous child node when switching to a complex value', () => {
    const p = ParameterNode.createDefault('p', null);
    p.setProperty('Value', '[1 2 3]');
    expect(p.children.length).toBe(1);
    p.setProperty('Value', '5+6i');
    // The old array child must be gone — keeping both would produce a broken
    // tree and a serializeValue that writes the wrong type.
    expect(p.children.length).toBe(1);
    expect(p.displayValue).toBe('5+6i');
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
