// Copyright 2026 The MathWorks, Inc.
//
// An EMPTY logical of rank 3 or more, held by an MCOS object's property (a .mat, a model
// workspace), keeps its class and its shape: McosParser.resolveValue hands it over in the
// typed logical literal, `{_type: 'logical', _value: 'Matrix(2,0,2)\n[[]; []]'}`, which the
// node layer shows as a <2x0x2 logical>. It always did, until C-033's logical arm returned
// `[]` for every empty logical before reading the shape, and `[]` reads as a double 0x0.
//
// An empty logical of rank 2, and a numeric empty of another class than double or another size
// than 0x0, keep both too, in the binary reader's spelling of one, `{_type: 'int16', _value:
// 'Matrix(2,0,2)'}`; each was `[]`, a double 0x0, before (R3 of the 2026-10-26 edit bash).
//
// typed_objects.mat is MATLAB's (test/fixtures/mcos/make_typed_fixtures.m). Its pInt16Nd is
// a Simulink.Parameter whose Value is int16(reshape(1:8, 2, 2, 2)); that cell's dims
// subelement is respelled, same length, to 2x0x2, and its array-flags logical bit is set,
// as mcosColumnVector.test.ts does to ParamMat.mat's 2x3. No MATLAB-written file in the
// fixtures or the corpus holds an empty logical of rank 3 in an MCOS object.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeMcosBlob, type OpaqueVarRef } from '../src/datamodel/parser/McosParser.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import * as NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import '../src/datamodel/node/data/NodeClassMap.js';

function blobParts(file: string): { raw: Uint8Array; vars: OpaqueVarRef[] } {
  const buf = readFileSync(fileURLToPath(new URL(`./fixtures/mcos/${file}`, import.meta.url)));
  const { variables } = parseMat(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const anon = variables.find((v) => (v as unknown as { _anonymous?: boolean })._anonymous)!;
  const opaque = variables.filter((v) => v.isOpaque && v.name);
  return { raw: anon._rawBytes!, vars: opaque.map((v) => ({ name: v.name, className: v.className, rawBytes: v._rawBytes })) };
}

function findAll(raw: Uint8Array, needle: number[]): number[] {
  const at: number[] = [];
  for (let i = 0; i + needle.length <= raw.length; i++) {
    if (needle.every((b, k) => raw[i + k] === b)) at.push(i);
  }
  return at;
}

const LOGICAL_FLAG = 0x02;

/** A cell's dims subelement: miINT32, its byte count, and each extent. */
const dimsSubelement = (extents: number[]): number[] => [
  5, 0, 0, 0, extents.length * 4, 0, 0, 0,
  ...extents.flatMap((n) => [n & 0xff, (n >> 8) & 0xff, 0, 0]),
];

/**
 * The Value of `name` in `file`, its dims subelement (`from`, which must be the only one in the
 * blob) respelled as `to`, of the same rank, and the cell made logical where `logical` is set.
 */
function respelledValue(file: string, name: string, from: number[], to: number[], logical: boolean): unknown {
  const { raw, vars } = blobParts(file);
  const hits = findAll(raw, dimsSubelement(from));
  expect(hits).toHaveLength(1);
  const at = hits[0];
  // The array-flags subelement just before it, whose class byte is at `at - 8` and whose
  // flags byte is at `at - 7` (miUINT32, 8 bytes).
  expect(Array.from(raw.slice(at - 16, at - 8))).toEqual([6, 0, 0, 0, 8, 0, 0, 0]);
  expect(raw[at - 7] & LOGICAL_FLAG).toBe(0);
  const patched = raw.slice();
  const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength);
  to.forEach((n, k) => view.setUint32(at + 8 + k * 4, n, true));
  if (logical) patched[at - 7] |= LOGICAL_FLAG;
  return decodeMcosBlob(patched, vars).get(name)!.properties.Value;
}

// What the host shows for the value, and the shape it holds.
function shown(value: unknown): { className: string; dims: number[]; display: string } {
  const node: any = NodeRegistry.parseValue(value, 'Value', null);
  return { className: node.className, dims: node._dims, display: node.displayValue };
}

const ND = ['typed_objects.mat', 'pInt16Nd', [2, 2, 2]] as const;
const MAT = ['ParamMat.mat', 'ParamMat', [2, 3]] as const;

describe('decodeMcosBlob: an empty logical of rank 3 keeps its class and its shape', () => {
  it('precondition: pInt16Nd is the int16 2x2x2 MATLAB wrote', () => {
    const [file, name, dims] = ND;
    const value = respelledValue(file, name, [...dims], [...dims], false);
    expect(value).toEqual({ _type: 'int16', _value: 'Matrix(2,2,2)\n[[1, 3]; [2, 4]; [5, 7]; [6, 8]]' });
  });

  it('a logical 2x0x2 is the typed logical Matrix(2,0,2), and shows as a <2x0x2 logical>', () => {
    const [file, name, dims] = ND;
    const value = respelledValue(file, name, [...dims], [2, 0, 2], true);
    expect(value).toEqual({ _type: 'logical', _value: 'Matrix(2,0,2)\n[[]; []]' });
    expect(shown(value)).toEqual({ className: 'logical', dims: [2, 0, 2], display: '<2x0x2 logical>' });
  });

  it('a logical 0x2x2 and 2x2x0 are typed alike', () => {
    const [file, name, dims] = ND;
    expect(shown(respelledValue(file, name, [...dims], [0, 2, 2], true))).toMatchObject({ className: 'logical', dims: [0, 2, 2] });
    expect(shown(respelledValue(file, name, [...dims], [2, 2, 0], true))).toMatchObject({ className: 'logical', dims: [2, 2, 0] });
  });

  it('control: a logical 2x2x2 is the typed logical it was', () => {
    const [file, name, dims] = ND;
    const value = respelledValue(file, name, [...dims], [...dims], true);
    expect(value).toMatchObject({ _type: 'logical' });
    expect(shown(value)).toMatchObject({ className: 'logical', dims: [2, 2, 2] });
  });

  it('an int16 2x0x2 is the typed int16 Matrix(2,0,2), as the binary reader holds one, and shows as an int16 2x0x2', () => {
    const [file, name, dims] = ND;
    const value = respelledValue(file, name, [...dims], [2, 0, 2], false);
    expect(value).toEqual({ _type: 'int16', _value: 'Matrix(2,0,2)', _binary_empty: true });
    expect(shown(value)).toMatchObject({ className: 'int16', dims: [2, 0, 2] });
  });

  it('a logical 0x0, 1x0, 0x1, 2x0 and 0x3 are the typed logical of their size, as the binary reader holds one', () => {
    const [file, name, dims] = MAT;
    for (const to of [[0, 0], [1, 0], [0, 1], [2, 0], [0, 3]]) {
      const value = respelledValue(file, name, [...dims], to, true);
      expect(value, to.join('x')).toEqual({ _type: 'logical', _value: 'Matrix(' + to.join(',') + ')', _binary_empty: true });
      expect(shown(value), to.join('x')).toEqual({ className: 'logical', dims: to, display: '<' + to.join('x') + ' logical>' });
    }
  });
});
