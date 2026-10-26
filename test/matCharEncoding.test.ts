// Copyright 2026 The MathWorks, Inc.
//
// A char's data written as MATLAB writes it: miUTF8 where every character is below U+0080, and
// miUTF16 otherwise (measured, R2023b and R2027a, save -v7 compressed and not, at the top, in a
// struct field, in a cell and in an object's property, and getByteStreamFromArray). This package
// wrote every char as miUTF8, which R2023b fails to load where a character takes three UTF-8 bytes
// ('日本語' typed into a variable or a cell: MATLAB:load:cantReadFile), and which has no spelling of
// a surrogate on its own (it wrote U+FFFD). Nor did it read one: a surrogate on its own in MATLAB's
// miUTF16 read as U+FFFD, and a leading U+FEFF not at all, so an edit beside it wrote the text
// changed. test/fixtures/mat-char holds MATLAB's own files (make_mat_chars.m,
// make_mat_surrogates.m).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { encodeMatStream } from '../src/datamodel/parser/MatWriter.js';
import { checkMatFile } from '../src/datamodel/parser/MatFileCheck.js';
import type { MatVariable } from '../src/datamodel/parser/MatParser.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));
const read = (rel: string) => new Uint8Array(readFileSync(join(TEST_ROOT, rel)));
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

function opened(bytes: Uint8Array) {
  const session = createSession();
  const root: any = session.addMatSource('f.mat', bytes.slice().buffer);
  const at = (path: string) => root.flatten().find((n: any) => n.matlabPath === path);
  const edit = (path: string, key: string, text: string) => {
    const node = at(path);
    session.setActive(root, node);
    return session.editProperty(node.id, key, text);
  };
  const save = (): Uint8Array => (session.serializeSource('f.mat') as { bytes: Uint8Array }).bytes;
  return { session, root, at, edit, save };
}

const char = (value: string, dimensions: number[]): MatVariable => ({ name: '', className: 'char', dimensions, isComplex: false, isLogical: false, value, fields: null });

describe('a char value, as a stream', () => {
  // MATLAB R2027a's getByteStreamFromArray of each value, as hex.
  const MATLAB: [string, MatVariable, string][] = [
    ['abc', char('abc', [1, 3]), '0001494d000000000e00000030000000060000000800000004000000000000000500000008000000010000000300000001000000000000001000030061626300'],
    ['°C', char('°C', [1, 2]), '0001494d000000000e000000300000000600000008000000040000000000000005000000080000000100000002000000010000000000000011000400b0004300'],
    ['日本語', char('日本語', [1, 3]), '0001494d000000000e00000038000000060000000800000004000000000000000500000008000000010000000300000001000000000000001100000006000000e5652c679e8a0000'],
    ["cat(3, '日本', 'cd')", char('日本cd', [1, 2, 2]), '0001494d000000000e0000004000000006000000080000000400000000000000050000000c0000000100000002000000020000000000000001000000000000001100000008000000e5652c6763006400'],
    ['a😀', char('a😀', [1, 3]), '0001494d000000000e0000003800000006000000080000000400000000000000050000000800000001000000030000000100000000000000110000000600000061003dd800de0000'],
    ['a surrogate on its own', char('\ud83d', [1, 1]), '0001494d000000000e0000003000000006000000080000000400000000000000050000000800000001000000010000000100000000000000110002003dd80000'],
  ];
  for (const [label, value, hex] of MATLAB) {
    it(`${label} is MATLAB's, byte for byte`, () => {
      expect(Buffer.from(encodeMatStream(value)).toString('hex')).toBe(hex);
    });
  }
});

describe("MATLAB's own MAT-files of chars of every width", () => {
  for (const release of ['r2027a', 'r2023b']) {
    // Every char of the file, at the top, in a struct field, in a cell and deeper; but the 1x0
    // char, which shows as '' and is typed back as the 0x0 that text makes.
    const original = read(`fixtures/mat-char/${release}/chars.mat`);
    const paths = opened(original)
      .root.flatten()
      .filter((n: any) => n._scalarType === 'char' && n.matlabPath !== 'e10')
      .map((n: any) => n.matlabPath);

    it(`${release}: each char written fresh is MATLAB's record, byte for byte`, () => {
      expect(paths.length).toBe(15);
      for (const path of paths) {
        const o = opened(original);
        const text = o.at(path).displayValue;
        expect(o.edit(path, 'Value', "'x'"), path).toBe(true);
        expect(o.edit(path, 'Value', text), path).toBe(true);
        expect(same(o.save(), original), path).toBe(true);
      }
    });

    it(`${release}: a compressed file's chars written fresh read back as they were, as MATLAB loads them`, () => {
      const zipped = read(`fixtures/mat-char/${release}/chars_compressed.mat`);
      const o = opened(zipped);
      const before = paths.map((p: string) => o.at(p)._scalarValue);
      for (const path of paths) {
        const text = o.at(path).displayValue;
        expect(o.edit(path, 'Value', "'x'"), path).toBe(true);
        expect(o.edit(path, 'Value', text), path).toBe(true);
      }
      const saved = o.save();
      expect(checkMatFile(saved)).toEqual([]);
      const back = opened(saved);
      expect(paths.map((p: string) => back.at(p)._scalarValue)).toEqual(before);
    });
  }
});

describe("MATLAB's own MAT-files of a surrogate on its own", () => {
  // The UTF-16 units MATLAB R2023b and R2027a load each char of surrogates.mat as (column-major).
  const UNITS: Record<string, number[]> = {
    hi: [0xd83d],
    lo: [0xde00],
    tail: [97, 0xd83d],
    lead: [0xde00, 98],
    rev: [0xde00, 0xd83d],
    two: [0xd83d, 121, 120, 0xde00],
    bom: [0xfeff, 97],
    'sur.t': [97, 0xd83d],
    'cc{1}': [97, 0xde00, 98],
  };
  const unitsOf = (text: string) => Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));
  const held = (o: ReturnType<typeof opened>) => ({
    ...Object.fromEntries(Object.keys(UNITS).map((p) => [p, unitsOf(o.at(p)._scalarValue)])),
    'p.Description': unitsOf(o.at('p').Description),
  });
  const WANT = { ...UNITS, 'p.Description': [97, 0xd83d] };

  for (const release of ['r2027a', 'r2023b']) {
    const original = read(`fixtures/mat-char/${release}/surrogates.mat`);

    it(`${release}: reads each as the units MATLAB wrote, high or low, first or last, and a leading U+FEFF`, () => {
      expect(held(opened(original))).toEqual(WANT);
    });

    it(`${release}: each written fresh is MATLAB's record, byte for byte, or in a struct or a cell reads back as MATLAB wrote it`, () => {
      // A struct or a cell is written fresh whole, and its double 1 as a double, which MATLAB
      // writes in a byte.
      for (const path of Object.keys(UNITS)) {
        const o = opened(original);
        const text = o.at(path).displayValue;
        expect(o.edit(path, 'Value', "'x'"), path).toBe(true);
        expect(o.edit(path, 'Value', text), path).toBe(true);
        const saved = o.save();
        if (/[.{]/.test(path)) {
          expect(checkMatFile(saved), path).toEqual([]);
          expect(held(opened(saved)), path).toEqual(WANT);
        } else {
          expect(same(saved, original), path).toBe(true);
        }
      }
    });

    it(`${release}: an edit beside one writes it back as MATLAB wrote it`, () => {
      // 'a' and the high surrogate, miUTF16 in a small element, as sur.t and p.Description hold it.
      const sur = Buffer.from('1100040061003dd8', 'hex');
      for (const [path, key, there, back] of [
        ['sur.d', 'Value', '2', '1'],
        ['cc{2}', 'Value', '2', '1'],
        ['p', 'Value', '2', '1'],
        ['p', 'Unit', 'm', ''],
      ]) {
        const o = opened(original);
        expect(o.edit(path, key, there), path).toBe(true);
        expect(o.edit(path, key, back), path).toBe(true);
        const saved = o.save();
        expect(checkMatFile(saved), path).toEqual([]);
        expect(held(opened(saved)), path).toEqual(WANT);
        expect(Buffer.from(saved).indexOf(sur), path).toBeGreaterThan(0);
      }
    });
  }
});

// Text of every width, typed into every kind of place a MAT-file holds a char, in a file of each
// release: read back as typed, and a file the checker finds nothing wrong with (which holds miUTF8
// past U+07FF to be a file R2023b fails to load). The same files, saved, were loaded in MATLAB
// R2023b and R2027a as MATLAB's own assignment of the text makes them.
const TEXTS: [string, string][] = [
  ["'abc'", 'abc'],
  ["'°C'", '°C'],
  ["'héllo wörld'", 'héllo wörld'],
  ["'Ā'", 'Ā'],
  ["'ߺ'", 'ߺ'],
  ["'ࠀ'", 'ࠀ'],
  ["'日本語'", '日本語'],
  ["'a😀b'", 'a😀b'],
  ["[char(0) 'a' char(9) char(127)]", '\u0000a\t\u007f'],
  ["['日本'; '語x']", '日語本x'],
  ["['ab'; 'cd']", 'acbd'],
  ["''", ''],
  // A surrogate on its own, and a leading U+FEFF, which the save's read-back once refused.
  ["['a' char(56832) 'b']", 'a\ude00b'],
  ["[char(55357)]", '\ud83d'],
  ["[char(65279) 'a']", '\ufeffa'],
];

// The same, typed as text where a property takes text. (A surrogate on its own there is refused,
// as it was when every char was written as miUTF8.)
const DESCRIPTIONS = [...TEXTS.filter(([typed]) => typed.startsWith("'") && typed.length > 2).map(([, text]) => text), '\ufeffa'];

describe('text of every width typed into a MAT-file', () => {
  for (const release of ['r2027a', 'r2023b']) {
    const plain = read(`fixtures/string-containers/${release}/plain.mat`);
    // A variable, a struct field, a cell element and a struct in a cell in a struct.
    const PLACES = ['st', 'st.a', 'ce{2}', 'nest.c{2}.g'];
    it(`${release}: in a variable, a struct field, a cell and deeper, reads back as typed`, () => {
      for (const place of PLACES) {
        for (const [typed, text] of TEXTS) {
          const o = opened(plain);
          expect(o.edit(place, 'Value', typed), place + ' = ' + typed).toBe(true);
          const saved = o.save();
          expect(checkMatFile(saved), place + ' = ' + typed).toEqual([]);
          expect(opened(saved).at(place)._scalarValue, place + ' = ' + typed).toBe(text);
        }
      }
    });

    it(`${release}: in an object's Description, reads back as typed`, () => {
      const objects = read(`fixtures/mat-char/${release}/objects.mat`);
      for (const text of DESCRIPTIONS) {
        const o = opened(objects);
        expect(o.edit('p', 'Description', text), text).toBe(true);
        const saved = o.save();
        expect(checkMatFile(saved), text).toEqual([]);
        expect(opened(saved).at('p').Description, text).toBe(text);
      }
    });
  }

  it('stored as miUTF8, as this package wrote it, opens as an edit takes it, and its edit is written as MATLAB writes it', () => {
    // Read as it is (R2027a loads it as read), so no guess the editor locks; R2023b fails the load.
    const stored = read('fixtures/mat-check/char-cjk-utf8.mat');
    expect(checkMatFile(stored).map((v) => v.code)).toEqual(['utf8-wide']);
    const o = opened(stored);
    const v = o.root.children[0];
    expect([v._scalarValue, v.valueEditable]).toEqual(['日本語', true]);
    expect(o.edit(v.matlabPath, 'Value', "'日本語x'")).toBe(true);
    const saved = o.save();
    expect(checkMatFile(saved)).toEqual([]);
    expect(opened(saved).root.children[0]._scalarValue).toBe('日本語x');
  });

  it('in a name is refused, as MATLAB loads none that is not an identifier', () => {
    const o = opened(read('fixtures/string-containers/r2027a/plain.mat'));
    for (const name of ['日本', 'café']) {
      expect(o.edit('st', 'Name', name)).toMatchObject({ error: true });
      expect(o.edit('st.a', 'Name', name)).toMatchObject({ error: true });
    }
  });
});
