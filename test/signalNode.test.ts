// Copyright 2026 The MathWorks, Inc.
//
// Coverage for SignalNode's serialization and static identity. A Signal round-trips
// through serializeValue; the key subtlety is the Unit/DocUnits alias: the source
// may spell the unit key as either, and the serializer must use the same spelling
// on output so a load/save cycle does not produce a spurious diff.

import { describe, it, expect } from 'vitest';
import SignalNode from '../src/datamodel/node/data/SignalNode.js';

function rawVal(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    _array_class: 'Simulink.Signal',
    _array_type: 'MATLABArray',
    _dimensions: [1, 1],
    _mw_element_type: 'MATLABArray',
    _elements: [{ _properties: properties }],
  };
}

describe('SignalNode.defaultName', () => {
  it('returns "Signal" (seed for new-entry naming)', () => {
    expect(SignalNode.defaultName).toBe('Signal');
  });
});

describe('SignalNode serializeValue — Unit/Description overrides', () => {
  it('writes Unit and Description when the instance values differ from the source', () => {
    // When a user edits the Unit or Description in the PI, serializeValue must
    // include them in the output; if they are dropped the edit is silently lost
    // on save.
    const node = SignalNode.parse(rawVal({}), 'sig', null);
    node.Unit = 'km';
    node.Description = 'distance';
    const sv = node.serializeValue() as any;
    const props = sv._elements[0]._properties;
    // No DocUnits in the source, so the serializer uses 'Unit' as the output key.
    expect(props.Unit).toBe('km');
    expect(props.Description).toBe('distance');
    expect('DocUnits' in props).toBe(false);
  });

  it('preserves the DocUnits key when the source used that spelling', () => {
    // A load/save cycle must not rename DocUnits → Unit; that would produce a
    // diff in the file even though nothing changed, confusing source control.
    const node = SignalNode.parse(rawVal({ DocUnits: 'm/s', Description: 'speed' }), 'sig', null);
    const sv = node.serializeValue() as any;
    const props = sv._elements[0]._properties;
    expect(props.DocUnits).toBe('m/s');
    expect(props.Description).toBe('speed');
    expect('Unit' in props).toBe(false);
  });
});
