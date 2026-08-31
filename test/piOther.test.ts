// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { buildOtherRows } from '../src/datamodel/node/piOther.js';

describe('buildOtherRows — PI "Other" catch-all', () => {
  it('returns [] for a non-object bag', () => {
    expect(buildOtherRows(undefined, new Set())).toEqual([]);
    expect(buildOtherRows(null, new Set())).toEqual([]);
    expect(buildOtherRows('nope', new Set())).toEqual([]);
    expect(buildOtherRows([1, 2], new Set())).toEqual([]);
  });

  it('emits primitive top-level keys not already shown', () => {
    const rows = buildOtherRows({ DataScope: 'Auto', HeaderFile: '' }, new Set());
    expect(rows).toEqual([
      { name: 'DataScope', value: 'Auto' },
      { name: 'HeaderFile', value: '' },
    ]);
  });

  it('skips keys already shown by the curated/schema layout', () => {
    const rows = buildOtherRows({ Value: 9.81, DataScope: 'Auto' }, new Set(['Value']));
    expect(rows).toEqual([{ name: 'DataScope', value: 'Auto' }]);
  });

  it('skips serialization-envelope keys', () => {
    const rows = buildOtherRows(
      { _id: '1', _object_class: 'X', _array_class: 'Y', Real: 'kept' },
      new Set(),
    );
    expect(rows).toEqual([{ name: 'Real', value: 'kept' }]);
  });

  it('flattens a nested object ONE level using its sub-properties', () => {
    const rows = buildOtherRows(
      {
        CoderInfo: {
          _id: '2',
          _object_class: 'Simulink.CoderInfo',
          _properties: { CSCPackageName: 'Simulink', StorageClass: 'Auto' },
        },
      },
      new Set(),
    );
    expect(rows).toEqual([
      { name: 'CoderInfo.CSCPackageName', value: 'Simulink' },
      { name: 'CoderInfo.StorageClass', value: 'Auto' },
    ]);
  });

  it('renders a doubly-nested object as its [ClassName] (one-level rule)', () => {
    const rows = buildOtherRows(
      {
        CoderInfo: {
          _object_class: 'Simulink.CoderInfo',
          _properties: {
            CustomAttributes: {
              _object_class: 'SimulinkCSC.AttribClass_Simulink_Default',
              _properties: { HeaderFile: 'x.h' },
            },
          },
        },
      },
      new Set(),
    );
    expect(rows).toEqual([
      { name: 'CoderInfo.CustomAttributes', value: '[SimulinkCSC.AttribClass_Simulink_Default]' },
    ]);
  });

  it('keeps an empty nested object visible by its class name', () => {
    const rows = buildOtherRows(
      { CustomAttributes: { _object_class: 'SimulinkCSC.AttribClass_Simulink_Default', _properties: {} } },
      new Set(),
    );
    expect(rows).toEqual([
      { name: 'CustomAttributes', value: '[SimulinkCSC.AttribClass_Simulink_Default]' },
    ]);
  });

  it('unwraps a typed scalar { _type, _value }', () => {
    const rows = buildOtherRows({ Alignment: { _type: 'int32', _value: '8' } }, new Set());
    expect(rows).toEqual([{ name: 'Alignment', value: '8' }]);
  });

  it('renders an array value as [a, b, c]', () => {
    const rows = buildOtherRows({ Dimensions: [1, 3] }, new Set());
    expect(rows).toEqual([{ name: 'Dimensions', value: '[1, 3]' }]);
  });

  it('renders null / undefined sub-properties of a nested object as empty strings', () => {
    // A nested MATLAB object may have sparse sub-properties (e.g. a CoderInfo
    // where CSCPackageName is null). formatOther must not throw on these; an
    // empty cell is correct (no data to show).
    const rows = buildOtherRows(
      {
        CoderInfo: {
          _object_class: 'Simulink.CoderInfo',
          _properties: { CSCPackageName: null, CustomAttributes: undefined },
        },
      },
      new Set(),
    );
    expect(rows).toEqual([
      { name: 'CoderInfo.CSCPackageName', value: '' },
      { name: 'CoderInfo.CustomAttributes', value: '' },
    ]);
  });

  it('unwraps a typed scalar inside a nested object sub-property', () => {
    // A sub-property of a nested object may itself be a typed-scalar envelope
    // (e.g. { _type: 'int32', _value: '8' }). formatOther must unwrap it
    // instead of rendering it as an opaque object, or the PI would show a
    // blank cell for a value that has meaningful data.
    const rows = buildOtherRows(
      {
        Info: {
          _object_class: 'X',
          _properties: { Alignment: { _type: 'int32', _value: '8' } },
        },
      },
      new Set(),
    );
    expect(rows).toEqual([{ name: 'Info.Alignment', value: '8' }]);
  });

  it('renders a nested-object sub-property with no class name as [object]', () => {
    // A sub-property that is an { _properties } bag without _object_class must
    // still be distinguishable from a primitive empty value — '[object]' is the
    // fallback that tells the user something is there even though the class is
    // unknown.
    const rows = buildOtherRows(
      {
        Info: {
          _object_class: 'X',
          _properties: { Unknown: { _properties: { a: 1 } } },
        },
      },
      new Set(),
    );
    expect(rows).toEqual([{ name: 'Info.Unknown', value: '[object]' }]);
  });

  it('does not mutate the input bag', () => {
    const bag = { CoderInfo: { _object_class: 'C', _properties: { A: 1 } }, X: 2 };
    const before = JSON.stringify(bag);
    buildOtherRows(bag, new Set());
    expect(JSON.stringify(bag)).toBe(before);
  });
});
