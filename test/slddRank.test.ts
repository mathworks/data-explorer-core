// Copyright 2026 The MathWorks, Inc.
//
// MATLAB's binary dictionary writes Dimension="2*3*2" with a flat column-major
// body. We used to fold that to [2,6] on read, reporting a shape MATLAB never
// had and writing Matrix(2,6) back on save.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDims, transposeColumnMajor } from '../src/datamodel/parser/BinarySlddParser.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import { loadFile, findEntry } from './parity/loadFile.js';

describe('parseDims', () => {
  it('keeps every extent', () => {
    expect(parseDims('2*3*2')).toEqual([2, 3, 2]);
    expect(parseDims('2*2*2*2')).toEqual([2, 2, 2, 2]);
  });

  it('is unchanged at rank 2 and below', () => {
    expect(parseDims('2*3')).toEqual([2, 3]);
    expect(parseDims('1*5')).toEqual([1, 5]);
    expect(parseDims('5')).toEqual([1, 5]);
    expect(parseDims('')).toEqual([1, 1]);
    expect(parseDims('junk')).toEqual([1, 1]);
  });

  it('drops a trailing singleton, as MATLAB size() does', () => {
    expect(parseDims('2*3*1')).toEqual([2, 3]);
  });
});

describe('transposeColumnMajor', () => {
  it('transposes EVERY page of a rank-3 array, not just the first', () => {
    // MATLAB: A = reshape(1:12,[2 3 2]); A(:)' is 1..12 column-major.
    // Page 1 is [1 3 5; 2 4 6], page 2 is [7 9 11; 8 10 12].
    const got = transposeColumnMajor([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [2, 3, 2]);
    expect(got).toEqual([1, 3, 5, 2, 4, 6, 7, 9, 11, 8, 10, 12]);
  });

  it('is unchanged at rank 2', () => {
    expect(transposeColumnMajor([1, 2, 3, 4, 5, 6], [2, 3])).toEqual([1, 3, 5, 2, 4, 6]);
  });

  it('leaves a vector alone', () => {
    expect(transposeColumnMajor([1, 2, 3], [1, 3])).toEqual([1, 2, 3]);
    expect(transposeColumnMajor([1, 2, 3], [3, 1])).toEqual([1, 2, 3]);
  });
});

describe('Matrix(...) serial string', () => {
  it('parses a rank-3 header and gives the node all three extents', () => {
    const raw = {
      _type: 'double',
      _value: 'Matrix(2,3,2)\n[[1, 3, 5]; [2, 4, 6]; [7, 9, 11]; [8, 10, 12]]',
    };
    const node = MatlabVariableNode.parseTypedArray(raw, 'A', null) as any;
    expect(node._dims).toEqual([2, 3, 2]);
    expect(node.children.length).toBe(12);
    expect(node.children.map((c: any) => c.displayName)).toEqual([
      'A(1,1,1)', 'A(1,2,1)', 'A(1,3,1)', 'A(2,1,1)', 'A(2,2,1)', 'A(2,3,1)',
      'A(1,1,2)', 'A(1,2,2)', 'A(1,3,2)', 'A(2,1,2)', 'A(2,2,2)', 'A(2,3,2)',
    ]);
  });

  it('still parses a rank-2 header exactly as before', () => {
    const raw = { _type: 'double', _value: 'Matrix(2,3)\n[[1, 2, 3]; [4, 5, 6]]' };
    const node = MatlabVariableNode.parseTypedArray(raw, 'B', null) as any;
    expect(node._dims).toEqual([2, 3]);
    expect(node._elements).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('re-renders every extent and every page after an edit', () => {
    // _buildMatrixString is what _syncArraySerial calls once anything in the
    // variable is touched. Under a Matrix(r,c) header it emitted rows*cols groups,
    // so the second page of a 2x3x2 was gone from the file on the first edit.
    const raw = { _type: 'double', _value: 'Matrix(2,3,2)\n[[1, 2, 3]; [4, 5, 6]; [7, 8, 9]; [10, 11, 12]]' };
    const node = MatlabVariableNode.parseTypedArray(raw, 'A', null) as any;
    // The re-rendered body is the same bracketed-group form it was read from, which
    // matters twice over: MATLAB reads only that form (the line-per-row spelling this
    // used to expect comes back as a 1x0 empty — test/parity/matlab/probe_matrix_serial.m),
    // and an edit that changed the SPELLING as well as the shape would diff every
    // untouched neighbour in the file.
    expect(node._buildMatrixString(node._dims, node._elements)).toBe(
      'Matrix(2,3,2)\n[[1.0, 2.0, 3.0]; [4.0, 5.0, 6.0]; [7.0, 8.0, 9.0]; [10.0, 11.0, 12.0]]',
    );
  });
});

describe('the .slx XML writer carries the rank too', () => {
  it('writes an N-D array with every extent and every element', () => {
    // Measured before the fix on nd2x3x2 from cases.mat: the writer emitted
    // `Dimension="2*3">1.0 4.0 2.0 5.0 3.0 6.0      ` — the wrong shape, six of
    // twelve values, and six holes where the rank-2 transpose never wrote.
    // A(:,:,1) = [1 2 3; 4 5 6], A(:,:,2) = [7 8 9; 10 11 12], so MATLAB's own
    // column-major body is 1 4 2 5 3 6 7 10 8 11 9 12 — which is exactly what
    // MATLAB itself writes into a binary dictionary for this array.
    const raw = { _type: 'double', _value: 'Matrix(2,3,2)\n[[1, 2, 3]; [4, 5, 6]; [7, 8, 9]; [10, 11, 12]]' };
    const node = MatlabVariableNode.parseTypedArray(raw, 'A', null) as any;
    expect(node.serializeXml('P', { Name: 'A' }, 0)).toBe(
      '<P Name="A" Class="double" Dimension="2*3*2">1.0 4.0 2.0 5.0 3.0 6.0 7.0 10.0 8.0 11.0 9.0 12.0</P>',
    );
  });

  it('still writes a rank-2 array exactly as before', () => {
    const raw = { _type: 'double', _value: 'Matrix(2,3)\n[[1, 2, 3]; [4, 5, 6]]' };
    const node = MatlabVariableNode.parseTypedArray(raw, 'B', null) as any;
    expect(node.serializeXml('P', { Name: 'B' }, 0)).toBe(
      '<P Name="B" Class="double" Dimension="2*3">1.0 4.0 2.0 5.0 3.0 6.0</P>',
    );
  });
});

// MATLAB's own answers for this fixture, from test/parity/matlab/probe_ndarray.m.
// A(:,:,1) = [1 2 3; 4 5 6] and A(:,:,2) = [7 8 9; 10 11 12], so size(A) is
// [2 3 2] and A(:)' is 1 4 2 5 3 6 7 10 8 11 9 12.
const ndTruth = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/nd_truth.json', import.meta.url)), 'utf8'),
);

describe('a MATLAB-authored 2x3x2 in both .sldd formats', () => {
  // The two formats reach the same shape by different routes, which is the point
  // of testing both: the binary dictionary writes `Dimension="2*3*2"` with a flat
  // column-major body, while the text dictionary writes the whole array as a
  // uuencoded MAT byte stream under `_type: 'cdata'`.
  for (const [label, file] of [['text', 'nd_text.sldd'], ['binary', 'nd_binary.sldd']] as const) {
    it('reports the shape MATLAB reports (' + label + ')', () => {
      const a = findEntry(loadFile('../fixtures/' + file), 'A');
      expect((a as any)._dims).toEqual(ndTruth.A_size);
      expect(a.children.length).toBe(12);
      // truth.A_linear is MATLAB's column-major 1..12; our children are row-major
      // within each page, so map label -> value and compare against the subscript
      // MATLAB itself assigned.
      const byLabel = new Map(a.children.map((c: any) => [c.displayName, Number(c.displayValue)]));
      expect(byLabel.get('A(1,1,1)')).toBe(1);
      expect(byLabel.get('A(2,1,1)')).toBe(4);
      expect(byLabel.get('A(1,1,2)')).toBe(7);
      expect(byLabel.get('A(2,3,2)')).toBe(12);
      // Every label MATLAB's own ind2sub produces for this size, and no other.
      expect([...byLabel.keys()].sort()).toEqual(
        ndTruth.s_linear_subs.map((s: string) => s.replace('s(', 'A(')).sort(),
      );
    });
  }

  it('keeps the 2x3x2 struct array MATLAB wrote, in the binary format', () => {
    // Same fixture, struct flavour: Class="struct" Dimension="2*3*2" with twelve
    // <Element>s. structValue passes parseDims straight through, so this is the
    // read path's rank check for a container rather than a numeric.
    const s = findEntry(loadFile('../fixtures/nd_binary.sldd'), 's');
    // StructNode keeps its shape on serial._dimensions; a typed `dims` accessor is
    // Phase 8's job, so read the raw key here.
    expect((s as any).serial._dimensions).toEqual(ndTruth.s_size);
    expect(s.children.length).toBe(12);
    expect(s.children.map((c: any) => c.displayName)).toEqual(ndTruth.s_linear_subs);
  });
});
