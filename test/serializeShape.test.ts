// Copyright 2026 The MathWorks, Inc.
//
// serializeValue must not lose a struct's contents or an array's shape. Both
// holes are defect 15; both were invisible because no test round-tripped a
// .mat-sourced struct or an N-D numeric.
//
// The serialized forms asserted here are the ones the READERS already accept —
// `_array_type: 'Struct'` (NodeClassMap -> StructNode.parse) for a struct, and
// the typed `Matrix(d1,...,dn)` literal (NodeClassMap -> parseTypedArray) for a
// shaped numeric. There is no `_array_type: 'Matrix'` anywhere on the parse
// side, so emitting one would be a form only the writer understands.
//
// Both of those forms stop at RANK 2. MATLAB reads every candidate rank-3
// spelling of the literal back as an empty 1x0 and writes such a value as a
// `{"_type": "cdata"}` MAT byte stream instead, wherever it sits — as an entry
// value, an object property, a struct field or a cell element
// (test/parity/matlab/probe_rank3_serial.m, probe_nd_rich.m, probe_nd_nested.m;
// defect 22). So the rank-3 cases below assert the cdata form and read it back,
// while the rank-2 cases keep the literal they always had.
import { describe, it, expect } from 'vitest';
import { loadFile, findEntry } from './parity/loadFile.js';
import NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import DataNode from '../src/datamodel/node/DataNode.js';
import '../src/datamodel/node/NodeClassMap.js';

// loadFile resolves relative to test/parity/loadFile.ts.
const MAT = ['./artifacts/mat/cases.mat', 'cases.mat'] as const;

describe('serializeValue preserves struct contents (defect 15, hole 1)', () => {
  for (const name of ['structScalar', 'structNest', 'struct1x3', 'struct2x3']) {
    it(name + ' does not serialize to null', () => {
      const n = findEntry(loadFile(MAT[0], MAT[1]), name) as any;
      const out = n.serializeValue();
      expect(out, 'a null here wipes the entry on save').not.toBe(null);
      expect(out).not.toBe(undefined);
      expect((out as Record<string, unknown>)._array_type).toBe('Struct');
      // The shape must survive too, so the reader rebuilds the same array.
      expect((out as Record<string, unknown>)._dimensions).toEqual(n._dims);
    });
  }

  it('structNd keeps every element, in the form MATLAB uses at rank 3', () => {
    // `_array_type: 'Struct'` with `_dimensions: [2,3,2]` is a form OUR reader
    // rebuilds and MATLAB's reads as an empty struct, so the shape lives in the
    // cdata bytes here. Nothing may be lost on the way: twelve elements out,
    // twelve back.
    const n = findEntry(loadFile(MAT[0], MAT[1]), 'structNd') as any;
    const out = n.serializeValue() as Record<string, unknown>;
    expect(out, 'a null here wipes the entry on save').not.toBe(null);
    expect(out._type).toBe('cdata');
    const back = NodeRegistry.parseValue(out, 'structNd', null) as any;
    expect(back._dims).toEqual(n._dims);
    expect(back.children.length).toBe(12);
    expect(back.children.map((c: any) => c.children[0].displayValue)).toEqual(
      n.children.map((c: any) => c.children[0].displayValue),
    );
  });

  it('a 2x3 struct array round-trips every element and field back through the reader', () => {
    const n = findEntry(loadFile(MAT[0], MAT[1]), 'struct2x3') as any;
    const back = NodeRegistry.parseValue(n.serializeValue(), 'struct2x3', null) as any;
    expect(back.children.length).toBe(6);
    // MATLAB's own column-major element order and subscripts, values 1..6.
    expect(back.children.map((c: any) => c.displayName)).toEqual([
      'struct2x3(1,1)', 'struct2x3(2,1)', 'struct2x3(1,2)',
      'struct2x3(2,2)', 'struct2x3(1,3)', 'struct2x3(2,3)',
    ]);
    expect(back.children.map((c: any) => c.children[0].displayValue)).toEqual([
      '1', '2', '3', '4', '5', '6',
    ]);
  });

  it('a scalar struct round-trips its fields, nested struct included', () => {
    const n = findEntry(loadFile(MAT[0], MAT[1]), 'structNest') as any;
    const out = n.serializeValue() as Record<string, unknown>;
    expect(out._fields).toEqual(['a']);
    const back = NodeRegistry.parseValue(out, 'structNest', null) as any;
    expect(back.children.map((c: any) => c.name)).toEqual(['a']);
    expect(back.children[0].children.map((c: any) => c.name)).toEqual(['b']);
    expect(back.children[0].children[0].displayValue).toBe('2');
  });
});

describe('serializeValue preserves array shape (defect 15, hole 2)', () => {
  it('a 2x3x2 double does not flatten to a bare 12-element list', () => {
    const n = findEntry(loadFile(MAT[0], MAT[1]), 'nd2x3x2') as any;
    const out = n.serializeValue() as Record<string, unknown>;
    // Whatever form it takes, the rank must be recoverable from it.
    expect(Array.isArray(out), 'a bare array has nowhere to put [2,3,2]').toBe(false);
    // At rank 3 that form is the cdata MAT stream, because MATLAB reads the
    // `Matrix(2,3,2)` literal this used to assert — in every spelling, including
    // the bracketed-group one it accepts at rank 2 — back as an empty 1x0
    // (test/parity/matlab/probe_rank3_serial.m).
    expect(out._type).toBe('cdata');
    // And the reader gives the same shape, and the same values, back.
    const back = NodeRegistry.parseValue(out, 'nd2x3x2', null) as any;
    expect(back._dims).toEqual([2, 3, 2]);
    expect(back.children.length).toBe(12);
    expect(back.children.map((c: any) => c.displayValue)).toEqual(
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
    );
  });

  it('a 2x3 double keeps its two extents', () => {
    const n = findEntry(loadFile(MAT[0], MAT[1]), 'mat2x3') as any;
    const out = n.serializeValue() as Record<string, unknown>;
    expect(Array.isArray(out)).toBe(false);
    // Byte-for-byte what MATLAB itself wrote for mat2x3 in
    // test/parity/artifacts/text/cases.sldd, including the forced '.0' on each double.
    expect(out._value).toBe('Matrix(2,3)\n[[1.0, 2.0, 3.0]; [4.0, 5.0, 6.0]]');
    const back = NodeRegistry.parseValue(out, 'mat2x3', null) as any;
    expect(back._dims).toEqual([2, 3]);
  });

  it('a row and a column vector still serialize bare — they have no shape to lose', () => {
    // The bare JSON list is the format's own spelling for a vector and every
    // existing fixture uses it; only a value with two spread extents needs the
    // typed literal.
    const row = findEntry(loadFile(MAT[0], MAT[1]), 'rowVec') as any;
    expect(row.serializeValue()).toEqual([1, 2, 3]);
  });
});

describe('the XML writers spell every extent, as MATLAB does', () => {
  // MATLAB's own binary dictionary for a 2x3x2 struct array writes
  // `<P Name="Value" Class="struct" Dimension="2*3*2">` with twelve <Element>s --
  // see test/fixtures/nd_binary.sldd. Writing `Dimension="2*3"` beside twelve
  // elements is a file MATLAB cannot read back as the array it wrote.
  it('writes an N-D struct array as Dimension="2*3*2"', () => {
    const n = findEntry(loadFile(MAT[0], MAT[1]), 'structNd') as any;
    const xml = DataNode.serializePropertyXml('Value', n.serializeValue(), 0, null);
    expect(xml.split('\n')[0]).toBe('<P Name="Value" Class="struct" Dimension="2*3*2">');
    expect((xml.match(/<Element>/g) ?? []).length).toBe(12);
  });

  it('writes an N-D cell array as Dimension="2*3*2"', () => {
    // truth.json's cellNd is 2x3x2 — twelve subscripts cellNd{1,1,1}..cellNd{2,3,2}.
    const n = findEntry(loadFile(MAT[0], MAT[1]), 'cellNd') as any;
    expect(n._dims).toEqual([2, 3, 2]);
    const xml = DataNode.serializePropertyXml('Value', n.serializeValue(), 0, null);
    expect(xml.split('\n')[0]).toBe('<P Name="Value" Class="cell" Dimension="2*3*2">');
    // And the node's own .slx writer agrees with the .sldd one.
    expect(n.serializeXml('P', { Name: 'Value' }, 0).split('\n')[0]).toBe(
      '<P Name="Value" Class="cell" Dimension="2*3*2">',
    );
  });

  it('still writes a rank-2 container exactly as before', () => {
    const s = findEntry(loadFile(MAT[0], MAT[1]), 'struct2x3') as any;
    expect(DataNode.serializePropertyXml('Value', s.serializeValue(), 0, null).split('\n')[0]).toBe(
      '<P Name="Value" Class="struct" Dimension="2*3">',
    );
    const c = findEntry(loadFile(MAT[0], MAT[1]), 'cell2x3') as any;
    expect(DataNode.serializePropertyXml('Value', c.serializeValue(), 0, null).split('\n')[0]).toBe(
      '<P Name="Value" Class="cell" Dimension="2*3">',
    );
  });
});
