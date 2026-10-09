// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { buildOtherRows } from '../src/datamodel/node/piOther.js';
import { encodeCdata } from '../src/datamodel/parser/MatWriter.js';

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

// A `cdata` value is never display text as it stands: complex text is MATLAB's storage
// (column-major) order with no shape, and a text dictionary's MAT stream is six-bit
// characters. The Inspector showed both as they were — a LookupTable's Table.Value
// [1+2i 3+4i; 5+6i 7+8i] read `1+2i 5+6i 3+4i 7+8i` out of a .mat, and the stream's own
// characters out of a text dictionary. Each is laid out as the same channel shows a real
// value of its shape: a real row arrives as a bare list (`[1, 2, 3]`) and a real matrix as
// its typed `Matrix(r,c)` literal.
describe('buildOtherRows — a cdata value is read, not printed', () => {
  const shows = (Value: unknown) => buildOtherRows({ Table: { _object_class: 'T', _properties: { Value } } }, new Set())[0].value;
  const stream = (v: Record<string, unknown>) => ({
    _type: 'cdata',
    _value: encodeCdata({ name: '', isLogical: false, fields: null, isComplex: false, ...v } as any),
  });

  it('complex text, as the binary dictionary and the MCOS decoder hold it', () => {
    expect(shows({ _type: 'cdata', _value: '3+4i' })).toBe('3+4i');
    // MATLAB's own text, `.0` and all, as the node layer reads it.
    expect(shows({ _type: 'cdata', _value: '3.0+4.0i' })).toBe('3+4i');
    expect(shows({ _type: 'cdata', _value: '1+2i 3+4i 5+6i', _dimensions: [1, 3] })).toBe('[1+2i, 3+4i, 5+6i]');
    expect(shows({ _type: 'cdata', _value: '1+2i 3+4i 5+6i', _dimensions: [3, 1] })).toBe('Matrix(3,1)\n[1+2i]\n[3+4i]\n[5+6i]');
    // Column-major text, rows in row order.
    expect(shows({ _type: 'cdata', _value: '1+2i 5+6i 3+4i 7+8i', _dimensions: [2, 2] })).toBe(
      'Matrix(2,2)\n[1+2i, 3+4i]\n[5+6i, 7+8i]',
    );
    expect(shows({ _type: 'cdata', _value: '1+1i 2+2i 3+3i 4+4i 5+5i 6+6i 7+7i 8+8i', _dimensions: [2, 2, 2] })).toBe('<2x2x2 double>');
    expect(shows({ _type: 'cdata', _value: '1+1i 2+2i', _dimensions: [1, 1, 2], _class: 'int16' })).toBe('<1x1x2 int16>');
    expect(shows({ _type: 'cdata', _value: '', _dimensions: [1, 0] })).toBe('[]');
  });

  it('a text dictionary\'s MAT stream, laid out the same way', () => {
    const c = (re: number, im: number) => ({ re, im });
    // [1+2i 3+4i; 5+6i 7+8i]: a MatVariable is row-major.
    expect(shows(stream({ className: 'double', dimensions: [2, 2], isComplex: true, value: [c(1, 2), c(3, 4), c(5, 6), c(7, 8)] }))).toBe(
      'Matrix(2,2)\n[1+2i, 3+4i]\n[5+6i, 7+8i]',
    );
    expect(shows(stream({ className: 'double', dimensions: [1, 3], isComplex: true, value: [c(1, 2), c(3, 4), c(5, 6)] }))).toBe(
      '[1+2i, 3+4i, 5+6i]',
    );
    expect(shows(stream({ className: 'double', dimensions: [1, 1], isComplex: true, value: [c(1, Infinity)] }))).toBe('1+Infi');
    // A real one, as its real siblings show: the stream is what a text dictionary holds
    // for an N-D value of any kind.
    expect(shows(stream({ className: 'double', dimensions: [2, 2], value: [1, 2, 3, 4] }))).toBe('Matrix(2,2)\n[1, 2]\n[3, 4]');
    expect(shows(stream({ className: 'int8', dimensions: [2, 3, 2], value: Array.from({ length: 12 }, (_, k) => k) }))).toBe(
      '<2x3x2 int8>',
    );
    // Not a number: its summary.
    expect(shows(stream({ className: 'char', dimensions: [2, 2, 2], value: 'abcdefgh' }))).toBe('<2x2x2 char>');
  });

  it('a stream that does not decode shows nothing rather than its characters; other text shows as it is', () => {
    expect(shows({ _type: 'cdata', _value: '  %)30 not a stream' })).toBe('');
    expect(shows({ _type: 'cdata', _value: 'not complex text' })).toBe('not complex text');
    // A count the shape does not hold is not that value.
    expect(shows({ _type: 'cdata', _value: '1+2i 3+4i', _dimensions: [1, 3] })).toBe('1+2i 3+4i');
  });
});
