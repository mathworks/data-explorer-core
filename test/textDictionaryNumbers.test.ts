// Copyright 2026 The MathWorks, Inc.
//
// A text dictionary's numbers are written as MATLAB writes them (textDictionaryJson). JSON.stringify
// spelled a double with no fraction as an integer literal, and MATLAB's reader takes an integer
// literal for an integer: a double typed as 18446744073709551615 went out as 18446744073709552000,
// one typed as -9223372036854775808 as -9223372036854776000, past what a 64-bit integer holds, and
// MATLAB R2027a could not open the dictionary at all (SLDD:sldd:OpenFailed). MATLAB writes such a
// double with a fraction of zero from a magnitude of a million up, and an exponent with no plus sign;
// the spellings below are what R2027a saved of each value in a text dictionary of its own.
//
// Then, over every kind of place a double stands in the parity fixtures' text dictionary, each edge
// value typed in: the saved text holds no number MATLAB would read otherwise, and the file read again
// holds the very double typed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { jsonNumberText, textDictionaryJson } from '../src/datamodel/parser/TextDictionaryJson.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

// Each value as MATLAB R2027a writes it in a text dictionary (measured: Simulink.data.dictionary,
// FileFormat 'uncompressed-text', one entry per value, saveChanges).
const MATLAB_SPELLS: [number, string][] = [
  [1, '1'], [99, '99'], [65536, '65536'], [999999, '999999'], [1e6, '1000000.0'], [9999999, '9999999.0'], [16777216, '16777216.0'],
  [2147483647, '2147483647.0'], [2147483648, '2147483648.0'], [4294967296, '4294967296.0'], [-1, '-1'], [-2147483648, '-2147483648.0'],
  [-1e6, '-1000000.0'], [2.5, '2.5'], [100000.5, '100000.5'], [123456789012, '123456789012.0'], [1e15, '1000000000000000.0'],
  [2 ** 53, '9007199254740992.0'], [2 ** 53 + 2, '9007199254740994.0'], [2 ** 63, '9223372036854776000.0'], [2 ** 64, '18446744073709552000.0'],
  [-(2 ** 63), '-9223372036854776000.0'], [1e20, '100000000000000000000.0'], [1e21, '1e21'], [1e22, '1e22'], [1e300, '1e300'], [-1e300, '-1e300'],
  [1.7976931348623157e308, '1.7976931348623157e308'], [2.2250738585072014e-308, '2.2250738585072014e-308'], [5e-324, '5e-324'],
  [1 / 3, '0.3333333333333333'], [0.1, '0.1'], [-0, '0'], [2 ** 60, '1152921504606847000.0'],
];

describe("a text dictionary's numbers", () => {
  it('are spelled as MATLAB spells them', () => {
    expect(MATLAB_SPELLS.map(([x]) => jsonNumberText(x))).toEqual(MATLAB_SPELLS.map(([, s]) => s));
  });

  it('in the JSON of a record, but for the extents of a size, which are counts', () => {
    const record = { value: { _array_type: 'Cell', _dimensions: [1, 1000000], _elements: [2 ** 64, [1e6, 2], { a: -1e21 }] } };
    const text = textDictionaryJson(record, '\t');
    expect(text).toContain('"_dimensions": [\n\t\t\t1,\n\t\t\t1000000\n\t\t]');
    expect(text).toContain('18446744073709552000.0');
    expect(text).toContain('1000000.0,');
    expect(text).toContain('"a": -1e21');
    expect(JSON.parse(text)).toEqual(record);
    // A string is written as it is.
    expect(textDictionaryJson({ s: '1e+21 and 1000000' })).toBe('{\n\t"s": "1e+21 and 1000000"\n}');
  });
});

// Every number token of a JSON text, outside its strings.
function numbersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
    if (m[0][0] !== '"') out.push(m[0]);
  }
  return out;
}
// A token MATLAB reads as other than the double it spells: an integer literal of a million or more,
// or an exponent with a plus sign, which MATLAB never writes.
const misread = (token: string) => (/^-?\d+$/.test(token) && Math.abs(Number(token)) >= 1e6) || /e\+/i.test(token);

const FILE = 'test/fixtures/edit-bash/r2027a/values_text.sldd';
// One place of each kind a double stands in it: an entry, an element of a row and of a matrix, a
// member of a cell, a field of a struct, deeper, a Simulink.Parameter's Value and an element of it,
// an element of an N-D array (a MAT stream there), a struct field in a cell.
const SITES = ['dScalar', 'dRow(2)', 'd2x3(2,1)', 'cLeaves{1}', 'sLeaves.dScalar', 'deep4.a.b{1}.c.d', 'pMatrix', 'pMatrix.Value(1,2)', 'nd2x2x2(2,1,2)', 'sArr(2).a'];
const VALUES = ['18446744073709551615', '-9223372036854775808', '9223372036854775808', '9007199254740993', '1e6', '999999', '123456789012', '1e15', '1e20',
  '1e21', '1e300', '-1e300', '1.7976931348623157e308', '2.2250738585072014e-308', '5e-324', '0.1', '-2147483649'];

describe('a double typed into a text dictionary', () => {
  it('is saved as a number MATLAB reads as that double, at every kind of place, and read back exactly', () => {
    const bytes = new Uint8Array(readFileSync(FILE));
    const wrong: string[] = [];
    let saved = 0;
    for (const site of SITES) {
      for (const typed of VALUES) {
        const session = createSession();
        const root: Any = ingest(session, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { filename: 'values_text.sldd' });
        const node = (root.flatten() as Any[]).find((n) => n.matlabPath === site && !n.isContainer);
        expect(node, site).toBeDefined();
        session.setActive(root, node);
        const r = session.editProperty(node.id, 'Value', typed);
        if (r !== true) {
          wrong.push(`${site} = ${typed}: refused ${JSON.stringify(r)}`);
          continue;
        }
        const text = (session.serializeSource(root.name) as Any).text as string;
        saved++;
        const bad = numbersIn(text).filter(misread);
        if (bad.length > 0) wrong.push(`${site} = ${typed}: written as ${bad.join(', ')}`);
        const back = (ingest(createSession(), new TextEncoder().encode(text).buffer as ArrayBuffer, { filename: 'values_text.sldd' }) as Any).flatten()
          .find((n: Any) => n.matlabPath === site && !n.isContainer);
        const value = Number(back?.displayValue);
        if (!Object.is(value, Number(typed))) {
          wrong.push(`${site} = ${typed}: read back as ${back?.displayValue}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(saved).toBe(SITES.length * VALUES.length);
  });
});
