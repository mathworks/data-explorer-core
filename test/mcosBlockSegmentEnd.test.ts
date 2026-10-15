// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeMcosBlob, type OpaqueVarRef } from '../src/datamodel/parser/McosParser.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';

// A property-block segment that ends within four bytes of the metadata cell's end.
// Each block opens with a uint32 property count, and the block reader read that count
// for any offset inside the segment without asking whether four bytes remained. When
// the segment end is also the cell's end, the read runs off the DataView and throws a
// RangeError — and since nothing between the decoder and the host catches it, the
// throw failed the whole open (the failure readSubelement's comment in McosParser.ts
// describes, and which it fixed for the subelement walk). A count we cannot read is a
// block we cannot read: the reader stops, exactly as it already stops on a count that
// overruns its segment, and the object keeps only its class defaults.
//
// The two header words are patched in busArray.mat's MATLAB-written blob. Only a
// damaged or hand-edited file has a segment end that is not 8-byte aligned.

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

function patchWords(raw: Uint8Array, words: [number, number][]): Uint8Array {
  const copy = raw.slice();
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  for (const [byteOffset, value] of words) view.setUint32(byteOffset, value, true);
  return copy;
}

describe('decodeMcosBlob — a block segment ending inside the last property count', () => {
  // busArray.mat's metadata table (the uint8 cell[0]) starts at this blob offset,
  // right after its 8-byte miUINT8 tag. Asserted below, so fixture drift fails loudly
  // instead of silently patching the wrong bytes.
  const META = 304;
  const MI_UINT8 = 2;
  const word = (raw: Uint8Array, byteOffset: number) =>
    new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(byteOffset, true);
  // Header word i of the metadata table.
  const w = (i: number) => META + i * 4;

  function metadataLength(raw: Uint8Array): number {
    expect(word(raw, META - 8)).toBe(MI_UINT8);
    const len = word(raw, META - 4);
    // The header's own last segment end sits inside the cell, so this is the table.
    expect(word(raw, w(6))).toBeLessThanOrEqual(len);
    return len;
  }

  it('control: a type-2 segment ending exactly four bytes short of the cell decodes', () => {
    const { raw, vars } = blobParts('busArray.mat');
    const len = metadataLength(raw);
    const patched = patchWords(raw, [[w(5), len - 4], [w(6), len]]);
    const decoded = decodeMcosBlob(patched, vars).get('buses')!;
    expect(Object.keys(decoded.properties)).toEqual(['Alignment']);
    expect(decoded.elements).toHaveLength(3);
  });

  it('does not throw when a type-2 segment ends 1-3 bytes into a property count', () => {
    const { raw, vars } = blobParts('busArray.mat');
    const len = metadataLength(raw);
    for (const short of [1, 2, 3]) {
      const patched = patchWords(raw, [[w(5), len - short], [w(6), len]]);
      expect(() => decodeMcosBlob(patched, vars), `w[5] = len - ${short}`).not.toThrow();
      // The unreadable count costs its blocks, so only the class defaults remain —
      // the result the sibling "stops reading blocks" test pins for a bad count.
      const decoded = decodeMcosBlob(patched, vars).get('buses')!;
      expect(Object.keys(decoded.properties), `w[5] = len - ${short}`).toEqual(['Alignment']);
      expect(decoded.elements).toHaveLength(3);
    }
  });

  it('does not throw when the type-1 segment ends 1-3 bytes into a property count', () => {
    // The type-1 segment [w[3], w[4]) is read by the same reader. For it to end at
    // the cell's end, every later segment end has to sit there too.
    const { raw, vars } = blobParts('busArray.mat');
    const len = metadataLength(raw);
    for (const short of [1, 2, 3]) {
      const patched = patchWords(raw, [[w(3), len - short], [w(4), len], [w(5), len], [w(6), len]]);
      expect(() => decodeMcosBlob(patched, vars), `w[3] = len - ${short}`).not.toThrow();
    }
  });
});
