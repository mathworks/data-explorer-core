// Copyright 2026 The MathWorks, Inc.
//
// A number its integer class cannot hold, written into a dictionary by hand or by a host:
// F1-17, under the maintainer's ruling of 2026-10-18 on malformed or hand-edited input
// (theme 1: "warn and show what was read; never refuse the file, never crash").
//
// A text dictionary holding `{"_type": "int8", "_value": "300"}` showed 300, which no int8
// is, and said nothing. MATLAB R2027a reads the same file as int8 127: it converts each
// number to the class as int8() does, rounding a tie away from zero and saturating at the
// range, with NaN as 0. Measured on this file's entries (the MATLAB reads quoted under
// MATLAB_READS below). So the table showed a value MATLAB never holds, and a copy into a
// binary dictionary, whose writer converts, showed 300 until the dictionary was reopened.
//
// Now the node holds the number as MATLAB reads it, and the file read warns once for each
// entry holding one. The literal itself is kept: an untouched save writes it back as it was
// read, and MATLAB then reads the value the table shows.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import type { ParseWarning } from '../src/datamodel/parser/ParseWarning.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
const metadata = (i: number) => ({
  uuid: uuid(i),
  namespace: 'dacaf35e-55a5-454d-a7c1-93db038a210e',
  lastmod: '20261018T000000.000000',
  modifiedby: 'host',
  isderived: '0',
});

/**
 * The entries of f117_text.sldd and f117b_text.sldd that hold a number their class cannot
 * hold, as the files spell them, and what MATLAB R2027a reads for each (measure1.log and
 * measure2.log of the group F scoping, `Simulink.data.dictionary.open` then `getValue`):
 * `shown` is that reading, as this package shows the value, and `at` the node it is shown on.
 */
const MATLAB_READS: { name: string; value: unknown; at: string; shown: string }[] = [
  // int8 [1 5] [127 -128 3 -3 0]
  { name: 'i8row', value: { _type: 'int8', _value: '[70000, -70000, 2.5, -2.5, NaN]' }, at: '', shown: '[127 -128 3 -3 0]' },
  // int8 [1 1] [127]
  { name: 'i8sc', value: { _type: 'int8', _value: '300' }, at: '', shown: '127' },
  // int8 [1 1] [3]
  { name: 'i8half', value: { _type: 'int8', _value: '2.5' }, at: '', shown: '3' },
  // uint8 [1 1] [0]
  { name: 'u8neg', value: { _type: 'uint8', _value: '-5U' }, at: '', shown: '0' },
  // uint8 [1 1] [255]
  { name: 'u8big', value: { _type: 'uint8', _value: '300U' }, at: '', shown: '255' },
  // int16 [1 2] [2 -2]
  { name: 'i16frac', value: { _type: 'int16', _value: '[1.5, -1.5]' }, at: '', shown: '[2 -2]' },
  // int32 [1 1] [2147483647]
  { name: 'i32big', value: { _type: 'int32', _value: '1e10' }, at: '', shown: '2147483647' },
  // int8 [1 1] [127]
  { name: 'i8inf', value: { _type: 'int8', _value: 'Inf' }, at: '', shown: '127' },
  // cell [1 1] {int8 [1 1] [127]}
  {
    name: 'i8cell',
    value: { _array_type: 'Cell', _dimensions: [1, 1], _elements: [{ _type: 'int8', _value: '300' }], _mw_element_type: 'MATLABArray' },
    at: '{1}',
    shown: '127',
  },
  // int8 [2 1] [127 1]
  { name: 'i8matCol', value: { _type: 'int8', _value: 'Matrix(2,1)\n[300, 1]' }, at: '', shown: '[127; 1]' },
  // uint64 [1 1], intmax('uint64') (measure3.log: 18446744073709551615)
  { name: 'u64big', value: { _type: 'uint64', _value: '18446744073709551616U' }, at: '', shown: '18446744073709551615' },
  // int64 [1 1] [9223372036854775807]
  { name: 'i64big', value: { _type: 'int64', _value: '9223372036854775808' }, at: '', shown: '9223372036854775807' },
  // struct [1 1] [f=int8 [1 1] [127]]
  {
    name: 'i8field',
    value: { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ f: { _type: 'int8', _value: '300' } }], _fields: ['f'], _mw_element_type: 'MATLABArray' },
    at: 'f',
    shown: '127',
  },
];

/** f117_text.sldd's entry that its class holds, read as written: int8 [1 2] [1 2]. */
const HELD = { name: 'i8ok', value: { _type: 'int8', _value: '[1, 2]' }, at: '', shown: '[1 2]' };

/** MATLAB's typed_text.sldd with the entries above added, as the scoping's probe built f117_text.sldd. */
function textDictionary(): string {
  const json = JSON.parse(strFromU8(fixture('typed_text.sldd')));
  const content = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content;
  [...MATLAB_READS, HELD].forEach(({ name, value }, i) => content.entries.push({ name, metadata: metadata(i), value }));
  return JSON.stringify(json, null, '\t');
}

const open = (session: any, bytes: Uint8Array, filename: string): any => ingest(session, buffer(bytes), { filename });
const entryOf = (root: any, name: string): any => root.getSection('design').children.find((e: any) => e.name === name);
/** The node an entry's number is shown on: the entry, its cell's member or its struct's field. */
function shownOn(root: any, name: string, at: string): any {
  const entry = entryOf(root, name);
  expect(entry, name).toBeDefined();
  if (at === '') {
    return entry;
  }
  const child = at === '{1}' ? entry.children[0] : entry.children.find((c: any) => c.name === at);
  expect(child, `${name} ${at}`).toBeDefined();
  return child;
}

describe('a text dictionary holding a number its integer class cannot hold', () => {
  const text = textDictionary();

  it('shows each one as MATLAB reads the file', () => {
    const root = open(createSession(), strToU8(text), 'f117_text.sldd');
    for (const { name, at, shown } of [...MATLAB_READS, HELD]) {
      expect(shownOn(root, name, at).displayValue, name).toBe(shown);
    }
    // And each element of an array, which is a node of its own.
    expect(entryOf(root, 'i8row').children.map((c: any) => c.displayValue)).toEqual(['127', '-128', '3', '-3', '0']);
    expect(entryOf(root, 'i16frac').children.map((c: any) => c.displayValue)).toEqual(['2', '-2']);
    expect(entryOf(root, 'i8matCol').children.map((c: any) => c.displayValue)).toEqual(['127', '1']);
  });

  it('warns once for each entry holding one, naming it, and for no other entry', () => {
    const root = open(createSession(), strToU8(text), 'f117_text.sldd');
    const warnings: ParseWarning[] = root.warnings ?? [];
    expect(warnings.map((w) => [w.code, w.part])).toEqual(MATLAB_READS.map(({ name }) => ['part-unreadable', name]));
    const said = (name: string) => warnings.find((w) => w.part === name)!.message;
    expect(said('i8sc')).toBe('"i8sc" holds the int8 value 300, which an int8 cannot hold; it is shown as MATLAB reads it, 127.');
    expect(said('u8neg')).toBe('"u8neg" holds the uint8 value -5, which a uint8 cannot hold; it is shown as MATLAB reads it, 0.');
    expect(said('i64big')).toBe(
      '"i64big" holds the int64 value 9223372036854775808, which an int64 cannot hold; it is shown as MATLAB reads it, 9223372036854775807.',
    );
    expect(said('i8row')).toBe(
      '"i8row" holds 5 values its integer class cannot hold, each shown as MATLAB reads it; the first is the int8 value 70000, shown as 127.',
    );
    // The member of a cell and the field of a struct are their entry's.
    expect(said('i8field')).toBe('"i8field" holds the int8 value 300, which an int8 cannot hold; it is shown as MATLAB reads it, 127.');
  });

  it('warns about nothing in a dictionary MATLAB wrote', () => {
    const root = open(createSession(), fixture('typed_text.sldd'), 'typed_text.sldd');
    expect(root.warnings).toBeUndefined();
  });

  it('is saved untouched as the literal it was read as, which reads back as it is shown', () => {
    const session = createSession();
    const root = open(session, strToU8(text), 'f117_text.sldd');
    const saved = session.serializeSource(root.name);
    const entries = JSON.parse(saved.text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    for (const { name, value } of [...MATLAB_READS, HELD]) {
      expect(entries.find((e: any) => e.name === name).value, name).toEqual(value);
    }
    // The whole file, byte for byte: nothing else moved either.
    expect(saved.text).toBe(text);
    const reopened = open(createSession(), strToU8(saved.text), 'f117_text.sldd');
    for (const { name, at, shown } of [...MATLAB_READS, HELD]) {
      expect(shownOn(reopened, name, at).displayValue, name).toBe(shown);
    }
  });
});

describe('a binary dictionary holding a number its integer class cannot hold', () => {
  /** MATLAB's typed_binary.sldd with entries whose Value a hand edit put out of their class's range. */
  function binaryDictionary(): Uint8Array {
    const zip = unzipSync(fixture('typed_binary.sldd'));
    const values: [string, string][] = [
      ['i8sc', '<P Name="Value" Class="int8">300</P>'],
      ['i16row', '<P Name="Value" Class="int16" Dimension="1*3">70000 -2.5 1</P>'],
      ['i8ok', '<P Name="Value" Class="int8">7</P>'],
    ];
    const objects = values.map(([name, value], i) =>
      [
        '    <Object Class="DD.ENTRY">',
        `        <P Name="Name" Class="char">${name}</P>`,
        `        <P Name="UUID" Class="char">${uuid(i)}</P>`,
        '        <P Name="Namespace" Class="char">dacaf35e-55a5-454d-a7c1-93db038a210e</P>',
        '        <P Name="LastMod" Class="char">20261018T000000.000000</P>',
        '        <P Name="LastModBy" Class="char">host</P>',
        '        <P Name="IsDerived" Class="char">0</P>',
        `        ${value}`,
        '    </Object>',
      ].join('\n'),
    );
    const xml = strFromU8(zip['data/chunk0.xml']);
    const at = xml.indexOf('    <Object Class="DD.Dictionary">');
    expect(at).toBeGreaterThan(-1);
    zip['data/chunk0.xml'] = strToU8(xml.slice(0, at) + objects.join('\n') + '\n' + xml.slice(at));
    return zipSync(zip);
  }

  it('shows each one converted to its class, and says so', () => {
    const root = open(createSession(), binaryDictionary(), 'f117_binary.sldd');
    expect(entryOf(root, 'i8sc').displayValue).toBe('127');
    expect(entryOf(root, 'i16row').displayValue).toBe('[32767 -3 1]');
    expect(entryOf(root, 'i8ok').displayValue).toBe('7');
    // Not "as MATLAB reads it": MATLAB's reader of a binary dictionary takes this text its own
    // way (int8 300 as 44, measured), which is not this change's to follow. i16row's -2.5 is
    // text MATLAB does not write, which the binary reader warns about itself (LENIENT,
    // unwrittenSpelling.test.ts) and hands on as the -3 shown; its 70000 is spelled as MATLAB
    // writes a number, and is this warning's.
    expect(root.warnings).toEqual([
      {
        code: 'part-unreadable',
        message: '"i16row" holds the int16 text \'-2.5\', which MATLAB does not write; it is shown as -3.',
        part: 'i16row',
      },
      {
        code: 'part-unreadable',
        message: '"i8sc" holds the int8 value 300, which an int8 cannot hold; it is shown as MATLAB converts a number to its class, 127.',
        part: 'i8sc',
      },
      {
        code: 'part-unreadable',
        message: '"i16row" holds the int16 value 70000, which an int16 cannot hold; it is shown as MATLAB converts a number to its class, 32767.',
        part: 'i16row',
      },
    ]);
  });

  it('warns about nothing in a dictionary MATLAB wrote', () => {
    const root = open(createSession(), fixture('typed_binary.sldd'), 'typed_binary.sldd');
    expect(root.warnings).toBeUndefined();
  });
});

describe('a value pasted with a number its integer class cannot hold', () => {
  // A host's paste has no warning channel: the value is shown converted, and nothing is said.
  const pasted = [
    { name: 'i8row', value: { _type: 'int8', _value: '[70000, -70000, 2.5, -2.5, NaN]' }, shown: '[127 -128 3 -3 0]' },
    { name: 'i8sc', value: { _type: 'int8', _value: '300' }, shown: '127' },
    { name: 'i8matCol', value: { _type: 'int8', _value: 'Matrix(2,1)\n[300, 1]' }, shown: '[127; 1]' },
  ];
  const FORMATS = [
    { format: 'text', file: 'typed_text.sldd' },
    { format: 'binary', file: 'typed_binary.sldd' },
  ];
  for (const { format, file } of FORMATS) {
    it(`into a ${format} dictionary is shown converted at once, before any save`, () => {
      const session = createSession();
      const root = open(session, fixture(file), file);
      pasted.forEach(({ name, value }, i) => root.getSection('design').parseEntry({ name, metadata: metadata(100 + i), value }));
      for (const { name, shown } of pasted) {
        expect(entryOf(root, name).displayValue, name).toBe(shown);
      }
      // Nothing recorded by the paste is reported against the next dictionary read.
      expect(open(createSession(), fixture(file), file).warnings).toBeUndefined();
    });
  }
});
