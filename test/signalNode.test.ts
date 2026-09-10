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

describe('the Data Type a Signal shows', () => {
  // `DataType` has the same two-spelling problem the unit key has: a dictionary may
  // store a Signal's declared type as `DataType` or as the resolved `DataType_internal`,
  // and this column was blank for every Signal in every format until the node read both
  // (DESIGN.md item 37). One spelling working and the other not is invisible until a
  // dictionary written by a different release shows a whole column of blanks, so both
  // spellings are pinned, along with which one wins when a file carries the two.
  const dataTypeCell = (props: Record<string, unknown>) =>
    SignalNode.parse(rawVal(props), 'sig', null).toRow()!.DataType;

  it('reads the type out of either spelling the file may have used', () => {
    expect(dataTypeCell({ DataType: 'single' })).toBe('single');
    expect(dataTypeCell({ DataType_internal: 'int32' })).toBe('int32');
  });

  it('prefers the resolved DataType_internal when the file carries both', () => {
    // The two disagree in a dictionary where a type alias was resolved on save;
    // `_internal` is the answer Simulink itself computed, so it is the one to show.
    expect(dataTypeCell({ DataType_internal: 'int32', DataType: 'single' })).toBe('int32');
  });

  it("says 'auto' rather than nothing when the file declares no type", () => {
    // Not a missing value: a Signal with no DataType key IS auto, and MATLAB shows it
    // that way. A blank cell would read as "unknown" for the commonest Signal there is.
    expect(dataTypeCell({})).toBe('auto');
    expect(dataTypeCell({ DataType: '' })).toBe('auto');
  });

  it('does not write that default back into a file that never declared a type', () => {
    // The default is a display answer only. Writing `DataType: "auto"` into a dictionary
    // that omitted the key would turn opening and saving a file into a diff, and both
    // save paths have to agree about staying quiet.
    const node = SignalNode.parse(rawVal({}), 'sig', null);
    expect(node._getSerializedProperties()).not.toHaveProperty('DataType');
    const sv = node.serializeValue() as { _elements: { _properties: Record<string, unknown> }[] };
    expect(sv._elements[0]._properties).not.toHaveProperty('DataType');
  });
});
