// Copyright 2026 The MathWorks, Inc.
//
// A non-finite number pasted into a text dictionary is written as MATLAB writes it there, at every
// place a value stands, and reads back as itself.
//
// A binary dictionary's reader holds a double scalar as a bare number, Inf, -Inf and NaN included,
// and an entry copied out of one carries it so (serialize). JSON has no spelling for any of the
// three: a text dictionary given one held it bare (MatWriter.textDictionaryForm), and the save's
// JSON.stringify wrote `null`, the value lost. Measured against MATLAB R2027a, a text
// dictionary holds each as the typed literal of its class, `{"_type": "double", "_value": "Inf"}`
// (`"-Inf"`, `"NaN"`), alike at an entry, a struct field, a cell's element and an object's
// property, and a row holding one as one literal of the whole row, `"[1.0, Inf, NaN, -Inf]"`, a
// column under its `Matrix(2,1)` header (test/parity/matlab/probe_text_nonfinite.m, which wrote
// test/fixtures/nonfinite_text.sldd). So it is written now, and reads back as Inf, -Inf, NaN.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest } from '../src/index.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const read = (rel: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));
const bufferOf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const TEXT_HOST = () => new TextDecoder().decode(read('./fixtures/numeric_json.sldd'));
const NS_DESIGN = 'dacaf35e-55a5-454d-a7c1-93db038a210e';
const metadata = (i: number) => ({ uuid: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, namespace: NS_DESIGN, lastmod: '20261023T000000.000000', modifiedby: 'u', isderived: '0' });

// What MATLAB wrote for each entry of the probe (nonfinite_text.sldd).
const MATLAB_WROTE: Record<string, any> = Object.fromEntries(
  JSON.parse(new TextDecoder().decode(read('./fixtures/nonfinite_text.sldd'))).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.map((e: any) => [e.name, e.value]),
);

const INF = { _type: 'double', _value: 'Inf' };
const NINF = { _type: 'double', _value: '-Inf' };
const NAN = { _type: 'double', _value: 'NaN' };
const struct = (fields: Record<string, unknown>) => ({ _array_type: 'Struct', _dimensions: [1, 1], _elements: [fields], _mw_element_type: 'MATLABArray' });
const cell = (elements: unknown[]) => ({ _array_type: 'Cell', _dimensions: [1, elements.length], _elements: elements, _mw_element_type: 'MATLABArray' });

// Each value as a paste hands it in, what MATLAB writes for the same value in a text dictionary
// (R2027a, Simulink.data.dictionary with FileFormat 'uncompressed-text'), and what it shows.
const CASES: [string, unknown, unknown, string][] = [
  ['a', Infinity, INF, 'Inf'],
  ['b', -Infinity, NINF, '-Inf'],
  ['c', NaN, NAN, 'NaN'],
  ['d', [1, Infinity, NaN, -Infinity], { _type: 'double', _value: '[1.0, Inf, NaN, -Inf]' }, '[1 Inf NaN -Inf]'],
  ['e', struct({ f: Infinity }), struct({ f: INF }), '<1x1 struct>'],
  ['k', cell([Infinity, NaN]), cell([INF, NAN]), '{Inf, NaN}'],
  ['m', struct({ f: [NaN, -Infinity], g: 2 }), struct({ f: { _type: 'double', _value: '[NaN, -Inf]' }, g: 2 }), '<1x1 struct>'],
];

/** A text dictionary open in a session, a host's paste into its Design Data, and its save. */
function textDictionary(text = TEXT_HOST()) {
  const session = createSession();
  const root: any = ingest(session, text, { filename: 'host.sldd' });
  const design = root.getSection('design');
  const entry = (name: string): any => design.children.find((e: any) => e.name === name);
  const save = (): string => (session.serializeSource(root.name) as { text: string }).text;
  const written = (text: string, name: string): unknown =>
    JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === name).value;
  return { session, root, design, entry, save, written };
}

/** What a node and every node under it shows, by name. */
const shown = (n: any): unknown => [n.name, n.displayValue, n.children.map(shown)];

describe('a non-finite number pasted into a text dictionary', () => {
  for (const [name, value, matlab, display] of CASES) {
    it(`${name}: is written as MATLAB writes it, and reads back as itself`, () => {
      const host = textDictionary();
      expect(host.design.parseEntry({ name, metadata: metadata(0), value }), name).toBeTruthy();
      expect(host.entry(name).displayValue).toBe(display);
      const text = host.save();
      expect(host.written(text, name)).toEqual(matlab);
      expect(matlab).toEqual(MATLAB_WROTE[name]);
      const again = textDictionary(text);
      expect(shown(again.entry(name))).toEqual(shown(host.entry(name)));
    });
  }

  it("in a Simulink.Parameter's Value: is written as MATLAB writes it, and reads back as itself", () => {
    const host = textDictionary();
    const p = { _array_class: 'Simulink.Parameter', _dimensions: [1, 1], _elements: [{ _id: '1', _properties: { Value: Infinity } }], _mw_element_type: 'MATLABArray' };
    expect(host.design.parseEntry({ name: 'p', metadata: metadata(0), value: p })).toBeTruthy();
    expect(host.entry('p').displayValue).toBe('Inf');
    const text = host.save();
    expect((host.written(text, 'p') as any)._elements[0]._properties.Value).toEqual(INF);
    expect(MATLAB_WROTE.p._elements[0]._properties.Value).toEqual(INF);
    expect(shown(textDictionary(text).entry('p'))).toEqual(shown(host.entry('p')));
  });

  it('copied out of a binary dictionary, as a host copies one: written as MATLAB writes it, never null', () => {
    const binary: any = ingest(createSession(), bufferOf(read('./parity/artifacts/binary/cases.sldd')), { filename: 'cases.sldd' });
    const host = textDictionary();
    const names = ['infP', 'infN', 'nanV', 'nonFinVec'];
    names.forEach((name, i) => {
      // The record as the copy hands it over, its value a bare number: not through JSON, which would make it null.
      const copy = binary.getSection('design').children.find((e: any) => e.name === name).serialize();
      expect(host.design.parseEntry({ ...copy, metadata: metadata(i) }), name).toBeTruthy();
    });
    const text = host.save();
    expect(names.map((n) => host.written(text, n))).toEqual([INF, NINF, NAN, { _type: 'double', _value: '[1.0, Inf, -Inf, NaN, 5.0]' }]);
    const again = textDictionary(text);
    expect(names.map((n) => again.entry(n).displayValue)).toEqual(names.map((n) => host.entry(n).displayValue));
    expect(names.map((n) => again.entry(n).displayValue).slice(0, 3)).toEqual(['Inf', '-Inf', 'NaN']);
  });
});
