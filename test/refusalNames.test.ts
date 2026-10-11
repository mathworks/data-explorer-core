// Copyright 2026 The MathWorks, Inc.
//
// A refused write names the entry and the path to what was refused, in MATLAB's spelling,
// wherever the value is: a Simulink.Parameter's Value, a property of an object of a class
// this package does not model, a field of a struct a property holds, an element of a struct
// array. A binary dictionary writes an object's properties from their raw values, reading
// a MAT stream or a sparse literal back into a node of its own to write it
// (DataNode._detachedXml); that node had no parent, so a refusal under it named the
// property, or nothing, as the entry. And a struct array's elements are named from 0, so a
// path through one said `pasted(0).f` for MATLAB's `pasted(1).f`.
import { describe, it, expect } from 'vitest';
import { strFromU8 } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { BINARY, TEXT, sparseFixture, thrownBy } from './tools/pasteVenues.js';

const literals = (n: number) => ({
  _array_type: 'Cell',
  _dimensions: [1, n],
  _elements: Array.from({ length: n }, () => ({ _type: 'sparse', _value: 'Matrix(0,256)\n[]' })),
  _mw_element_type: 'MATLABArray',
});
const PAST = literals(16385);
const COLUMNS = 'a 0x256 sparse array whose data holds none of its 256 columns, and with it the value would add more than 16 MiB that its data does not hold, the most one value may add. Nothing was written.';
const textEntries = () => JSON.parse(strFromU8(new Uint8Array(sparseFixture(TEXT)))).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
// sparse_text.sldd's pSp, a Simulink.Parameter, with its Value replaced.
const parameterWith = (value: unknown) => {
  const raw = JSON.parse(JSON.stringify(textEntries().find((e: any) => e.name === 'pSp').value));
  raw._elements[0]._properties.Value = value;
  return raw;
};
const objectWith = (props: Record<string, unknown>) => ({ _array_class: 'dexsparse.Unmodelled', _dimensions: [1, 1], _elements: [{ _id: '1', _properties: props }] });

/** What saving `value`, pasted into a fresh binary dictionary as `pasted`, threw. */
function binarySave(value: unknown): Error | null {
  const session = createSession();
  const root: any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
  root.getSection('design').parseEntry({ name: 'pasted', metadata: { uuid: '00000000-0000-4000-ef00-000000000001' }, value });
  return thrownBy(() => session.serializeSource(root.name))[0];
}

// These paste and save a cell of 16,385 sparse arrays, some twice: up to 0.9 s here, 2.2 s on
// CI's runners, close to half vitest's 5 s default; give them headroom.
const HEAVY_TIMEOUT = 60_000;

describe('a refusal names the entry and the path, wherever the value is', () => {
  it('a Simulink.Parameter\'s Value', { timeout: HEAVY_TIMEOUT }, () => {
    expect(binarySave(parameterWith(PAST))?.message).toBe(`Cannot write "pasted": pasted.Value{16385} is ${COLUMNS}`);
  });

  it('a property of an object of a class this package does not model', { timeout: HEAVY_TIMEOUT }, () => {
    expect(binarySave(objectWith({ Data: PAST }))?.message).toBe(`Cannot write "pasted": pasted.Data{16385} is ${COLUMNS}`);
  });

  it('a field of a struct a property holds, and of the second element of a struct array one holds', { timeout: HEAVY_TIMEOUT }, () => {
    const struct = (elements: unknown[]) => ({ _array_type: 'Struct', _dimensions: [1, elements.length], _elements: elements, _fields: ['f'] });
    expect(binarySave(objectWith({ S: struct([{ f: PAST }]) }))?.message).toBe(`Cannot write "pasted": pasted.S.f{16385} is ${COLUMNS}`);
    expect(binarySave(objectWith({ S: struct([{ f: 1 }, { f: PAST }]) }))?.message).toBe(`Cannot write "pasted": pasted.S(2).f{16385} is ${COLUMNS}`);
  });

  it('an element of a struct array, by its MATLAB subscript', { timeout: HEAVY_TIMEOUT }, () => {
    const value = { _array_type: 'Struct', _dimensions: [1, 2], _elements: [{ f: 1 }, { f: PAST }], _fields: ['f'] };
    expect(binarySave(value)?.message).toBe(`Cannot write "pasted": pasted(2).f{16385} is ${COLUMNS}`);
  });

  it('a property\'s raw value whose dims are not a size', () => {
    const damaged = { _array_type: 'Cell', _dimensions: [1, 'x'], _elements: [[1, 2]], _mw_element_type: 'MATLABArray' };
    expect(binarySave(parameterWith(damaged))?.message).toBe(
      'Cannot write "pasted": pasted.Value is a cell declaring dimensions [1,"x"], a size that is not a count, so what it would add beyond its data cannot be held to the 16 MiB one value may add. Nothing was written.',
    );
  });
});
