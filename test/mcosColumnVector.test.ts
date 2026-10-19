// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeMcosBlob, type OpaqueVarRef } from '../src/datamodel/parser/McosParser.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import * as NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import '../src/datamodel/node/data/NodeClassMap.js';
import { CLASS } from './tools/matBytes.js';

// An Nx1 real or logical MCOS property keeps its column shape. The decoder handed the
// node layer any numeric or logical VECTOR as a bare list, and a bare list is a row
// (XmlUtils.formatMatrixSerial: "a bare list read back is a row"), so a
// Simulink.Parameter whose Value is [10; 20; 30] showed, and copied out, as
// [10 20 30] — a different MATLAB value. The text dictionary's twin states a column as
// Matrix(3,1), as MATLAB itself writes it, and the binary dictionary's reader keeps
// it; a complex value and a logical MATRIX already kept their shape in this decoder.
// Now a rank-2 column takes the typed Matrix(r,1) literal too. A double 1xN row is still
// the bare list it was, and rank > 2 is unchanged. (A row of any other class, a logical
// one included, is typed since C-033: see the second describe below.)
//
// ParamMat.mat (MATLAB-written) holds a Simulink.Parameter whose Value is the 2x3
// [1 2 3; 4 5 6]. Its dims subelement in the MCOS blob is respelled, same length, so
// the six doubles MATLAB stored column-major (1 4 2 5 3 6) are read as another shape;
// setting the array-flags logical bit, as the Bp.mat tests in mcosParser.test.ts do,
// makes the same cell logical, and respelling its class byte makes it another class.

function blobParts(file: string): { raw: Uint8Array; vars: OpaqueVarRef[] } {
  const path = fileURLToPath(new URL(`./fixtures/mcos/${file}`, import.meta.url));
  const buf = readFileSync(path);
  const { variables } = parseMat(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const anon = variables.find((v) => (v as unknown as { _anonymous?: boolean })._anonymous);
  const opaque = variables.filter((v) => v.isOpaque && v.name);
  return {
    raw: anon!._rawBytes!,
    vars: opaque.map((v): OpaqueVarRef => ({ name: v.name, className: v.className, rawBytes: v._rawBytes })),
  };
}

// miINT32, 8 bytes, [2, 3]: the Value cell's dims subelement.
const DIMS_2X3 = [5, 0, 0, 0, 8, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0];
const LOGICAL_FLAG = 0x02;

function findAll(raw: Uint8Array, needle: number[]): number[] {
  const at: number[] = [];
  for (let i = 0; i + needle.length <= raw.length; i++) {
    if (needle.every((b, k) => raw[i + k] === b)) at.push(i);
  }
  return at;
}

/**
 * ParamMat.mat's Value respelled as rows x cols, optionally logical, and optionally of
 * another class: `cls` is the array-flags class byte (matBytes.ts CLASS), which leaves the
 * six stored elements as they were, so only the class the cell declares changes.
 */
function paramMatValue(rows: number, cols: number, logical = false, cls?: number): unknown {
  const { raw, vars } = blobParts('ParamMat.mat');
  // Exactly one such subelement, so fixture drift fails loudly instead of silently
  // patching the wrong bytes.
  const hits = findAll(raw, DIMS_2X3);
  expect(hits).toHaveLength(1);
  const dimsAt = hits[0];
  // The array-flags subelement just before it: miUINT32, 8 bytes, class 6 (double).
  expect(Array.from(raw.slice(dimsAt - 16, dimsAt - 7))).toEqual([6, 0, 0, 0, 8, 0, 0, 0, 6]);
  const patched = raw.slice();
  const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength);
  view.setUint32(dimsAt + 8, rows, true);
  view.setUint32(dimsAt + 12, cols, true);
  if (logical) patched[dimsAt - 7] |= LOGICAL_FLAG;
  if (cls !== undefined) patched[dimsAt - 8] = cls;
  return decodeMcosBlob(patched, vars).get('ParamMat')!.properties.Value;
}

// What the host shows for the value, and the shape it holds.
function shown(value: unknown): { className: string; dims: number[]; display: string } {
  const node: any = NodeRegistry.parseValue(value, 'Value', null);
  return { className: node.className, dims: node._dims, display: node.displayValue };
}

describe('decodeMcosBlob — an Nx1 MCOS property keeps its column shape', () => {
  it('control: the MATLAB-written 2x3 is unchanged', () => {
    const value = paramMatValue(2, 3);
    expect(value).toEqual({ _type: 'double', _value: 'Matrix(2,3)\n[[1.0, 2.0, 3.0]; [4.0, 5.0, 6.0]]' });
    expect(shown(value)).toMatchObject({ dims: [2, 3] });
  });

  it('a real 6x1 is a typed Matrix(6,1) and shows as a column', () => {
    const value = paramMatValue(6, 1);
    expect(value).toEqual({ _type: 'double', _value: 'Matrix(6,1)\n[1.0, 4.0, 2.0, 5.0, 3.0, 6.0]' });
    expect(shown(value)).toEqual({ className: 'double', dims: [6, 1], display: '[1; 4; 2; 5; 3; 6]' });
  });

  it('control: a real 1x6 is still the bare row it was', () => {
    const value = paramMatValue(1, 6);
    expect(value).toEqual([1, 4, 2, 5, 3, 6]);
    expect(shown(value)).toMatchObject({ dims: [1, 6], display: '[1 4 2 5 3 6]' });
  });

  it('a logical 6x1 is a typed logical column and shows as one', () => {
    const value = paramMatValue(6, 1, true);
    expect(value).toMatchObject({ _type: 'logical' });
    expect(shown(value)).toEqual({
      className: 'logical',
      dims: [6, 1],
      display: '[true; true; true; true; true; true]',
    });
  });

  // C-033: a bare list of booleans is read as a DOUBLE row by the node layer
  // (MatlabVariableNode.parseFlatArray, which also serves a text dictionary's bare list,
  // where double is right), so the row showed class double. It is the typed literal the
  // binary dictionary's reader gives a logical row (typed_binary.sldd's lglVec).
  it('a logical 1x6 is the typed logical row a binary dictionary gives, and shows as logical', () => {
    const value = paramMatValue(1, 6, true);
    expect(value).toEqual({ _type: 'logical', _value: '[1, 1, 1, 1, 1, 1]' });
    expect(shown(value)).toEqual({
      className: 'logical',
      dims: [1, 6],
      display: '[true true true true true true]',
    });
  });
});

// C-033: a REAL numeric property of a class other than double keeps its class. The
// decoder handed every numeric scalar and row over bare, and stamped `double` on every
// column and matrix, so a Simulink.Parameter whose Value is int32([1 2 3]) showed class
// double in a .mat and a model workspace, where both dictionaries show int32 (a .mat and a
// binary dictionary in the corpus that one MATLAB script wrote, P47_ValInt32Vec). Each is now the binary
// dictionary's spelling of the same value (BinarySlddParser formatTypedScalar,
// formatTypedVector, formatMatrix), which the node layer already reads. A double is
// unchanged: bare scalar and row, `_type: 'double'` column and matrix.
describe('decodeMcosBlob — a real non-double MCOS property keeps its class', () => {
  it('an int32 1x6 is a typed int32 row and shows as int32', () => {
    const value = paramMatValue(1, 6, false, CLASS.INT32);
    expect(value).toEqual({ _type: 'int32', _value: '[1, 4, 2, 5, 3, 6]' });
    expect(shown(value)).toEqual({ className: 'int32', dims: [1, 6], display: '[1 4 2 5 3 6]' });
  });

  it('an int16 6x1 is a typed int16 Matrix(6,1) and shows as an int16 column', () => {
    const value = paramMatValue(6, 1, false, CLASS.INT16);
    expect(value).toEqual({ _type: 'int16', _value: 'Matrix(6,1)\n[1, 4, 2, 5, 3, 6]' });
    expect(shown(value)).toEqual({ className: 'int16', dims: [6, 1], display: '[1; 4; 2; 5; 3; 6]' });
  });

  it('a uint8 1x1 is a typed uint8 scalar and shows as uint8', () => {
    const value = paramMatValue(1, 1, false, CLASS.UINT8);
    expect(value).toEqual({ _type: 'uint8', _value: '1U' });
    expect(shown(value)).toEqual({ className: 'uint8', dims: [1, 1], display: '1' });
  });

  it('a single 2x3 is a typed single matrix and shows as single', () => {
    const value = paramMatValue(2, 3, false, CLASS.SINGLE);
    expect(value).toEqual({ _type: 'single', _value: 'Matrix(2,3)\n[[1F, 2F, 3F]; [4F, 5F, 6F]]' });
    expect(shown(value)).toMatchObject({ className: 'single', dims: [2, 3] });
  });

  it('a uint64 1x3 is a typed uint64 row, each element with its U', () => {
    const value = paramMatValue(1, 3, false, CLASS.UINT64);
    // Three of the six stored elements are held: the dims say 1x3.
    expect(value).toEqual({ _type: 'uint64', _value: '[1U, 4U, 2U]' });
    expect(shown(value)).toEqual({ className: 'uint64', dims: [1, 3], display: '[1 4 2]' });
  });

  it('control: a double 1x1 is still the bare number it was', () => {
    const value = paramMatValue(1, 1, false, CLASS.DOUBLE);
    expect(value).toBe(1);
    expect(shown(value)).toEqual({ className: 'double', dims: [1, 1], display: '1' });
  });

  it('control: a double 1x6, 6x1 and 2x3 are exactly as they were', () => {
    expect(paramMatValue(1, 6, false, CLASS.DOUBLE)).toEqual([1, 4, 2, 5, 3, 6]);
    expect(paramMatValue(6, 1, false, CLASS.DOUBLE)).toEqual({ _type: 'double', _value: 'Matrix(6,1)\n[1.0, 4.0, 2.0, 5.0, 3.0, 6.0]' });
    expect(paramMatValue(2, 3, false, CLASS.DOUBLE)).toEqual({ _type: 'double', _value: 'Matrix(2,3)\n[[1.0, 2.0, 3.0]; [4.0, 5.0, 6.0]]' });
  });

  it('control: a logical 1x1 is still the boolean it was', () => {
    expect(paramMatValue(1, 1, true)).toBe(true);
  });
});
