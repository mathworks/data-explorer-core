// Copyright 2026 The MathWorks, Inc.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeMcosBlob, type OpaqueVarRef } from '../src/datamodel/parser/McosParser.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';

// A property triple with flag 0 carries a string-table index as its value. An index
// past the end of the table names no string, and the decoder made one up: the empty
// string, a value indistinguishable from a real '' property. Its sibling arms already
// leave such a property out — flag 1 with an index past the heap resolves to nothing,
// and an unknown flag is skipped ("never guess") — as the parser's header rule says:
// anything that cannot be resolved with confidence is left out rather than guessed.
// So a flag-0 index past the table now drops the property, and the class default, if
// any, is what remains.
//
// The triple is patched in busArray.mat's MATLAB-written blob, as the "damaged
// property blocks" tests in mcosParser.test.ts do. Only a damaged or hand-edited file
// carries such an index.

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

describe('decodeMcosBlob — a flag-0 string index past the end of the string table', () => {
  // busArray.mat's metadata table starts at this blob offset. Asserted below, so
  // fixture drift fails loudly instead of silently patching the wrong bytes.
  const META = 304;
  // The busArray fixture's Bus object: 6 properties, 3 array elements. Triple 0 of
  // block 1 (the instance's own block) is PreserveElementDimensions, which has no
  // class default.
  const ALL_PROPS = ['Alignment', 'PreserveElementDimensions', 'Elements_internal', 'Description', 'DataScope', 'HeaderFile'];
  const TARGET = 'PreserveElementDimensions';

  // Block 1's offset in the table, and the string table's length counting the
  // synthetic '' at index 0 — both walked exactly as the parser walks them.
  function layout(raw: Uint8Array): { block1: number; stringCount: number } {
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const u32 = (byteOffset: number) => view.getUint32(byteOffset, true);
    const header = Array.from({ length: 10 }, (_, i) => u32(META + i * 4));
    expect(header[2]).toBeLessThanOrEqual(header[3]);
    expect(header[6]).toBeLessThanOrEqual(raw.length - META);
    let stringCount = 1;
    for (let p = 40; p < header[2]; ) {
      let e = p;
      while (e < header[2] && raw[META + e] !== 0) e++;
      stringCount++;
      p = e + 1;
    }
    const align8 = (n: number) => n + ((8 - (n % 8)) % 8);
    const block0 = header[5];
    expect(u32(META + block0)).toBe(0); // block 0 is the empty/default block
    const block1 = block0 + align8(4);
    expect(u32(META + block1)).toBe(5); // the Bus instance's own block
    return { block1, stringCount };
  }

  // Patch triple 0 of block 1 to (flag, value), keeping its name index.
  function withFlag0(raw: Uint8Array, block1: number, value: number): Uint8Array {
    return patchWords(raw, [
      [META + block1 + 8, 0],
      [META + block1 + 12, value],
    ]);
  }

  it('the fixture is laid out as these tests assume', () => {
    const { raw, vars } = blobParts('busArray.mat');
    layout(raw);
    expect(Object.keys(decodeMcosBlob(raw, vars).get('buses')!.properties)).toEqual(ALL_PROPS);
  });

  it('control: an in-range flag-0 index still resolves to its string', () => {
    // The triple's own name index is in range by construction, so a flag-0 value
    // equal to it must resolve to the property's name as text.
    const { raw, vars } = blobParts('busArray.mat');
    const { block1 } = layout(raw);
    const nameIdx = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(META + block1 + 4, true);
    const decoded = decodeMcosBlob(withFlag0(raw, block1, nameIdx), vars).get('buses')!;
    expect(decoded.properties[TARGET]).toBe(TARGET);
    expect(Object.keys(decoded.properties)).toEqual(ALL_PROPS);
  });

  it('drops the property, rather than inventing an empty string, for an index past the table', () => {
    const { raw, vars } = blobParts('busArray.mat');
    const { block1, stringCount } = layout(raw);
    // The first index past the end, and one far past it.
    for (const value of [stringCount, 99999]) {
      const decoded = decodeMcosBlob(withFlag0(raw, block1, value), vars).get('buses')!;
      expect(decoded.properties[TARGET], `index ${value}`).toBeUndefined();
      expect(Object.keys(decoded.properties), `index ${value}`).toEqual(ALL_PROPS.filter((p) => p !== TARGET));
      // One bad index costs one property; the object array is otherwise intact.
      expect(decoded.elements).toHaveLength(3);
    }
  });
});
