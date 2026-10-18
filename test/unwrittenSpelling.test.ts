// Copyright 2026 The MathWorks, Inc.
//
// A typed value spelled in a way MATLAB never writes it, put into a dictionary by a hand edit:
// LENIENT, under the maintainer's ruling of 2026-10-18 on malformed or hand-edited input (theme
// 1: "warn and show what was read; never refuse the file, never crash"). The item's own ruling:
// stay strict (no spelling gains a new reading), and make serialize() agree with the display.
//
// MATLAB writes a logical as 0 or 1, an integer as an optional '-' and digits, and a double or
// single as a number (every typed body in the corpus and the fixtures, graded token by token).
// A binary dictionary holding logical `1.0`, int16 `1e2` or int16 `007` was read without a word:
// `1.0` showed false, `1e2` showed 100, and an int16 `007`, shown as 7, was handed to a paste or a
// copy as the text `'007'`, so the value a copy wrote was not the value the table showed. MATLAB's
// own reader of a binary dictionary takes such text its own, C-like way (measured, R2027a, quoted
// under MATLAB_READS below): `1.0` is true, `1e2` is 1, `2.5` is 2. Following it would be a new
// ruling; the warning is what makes the difference visible.
//
// Now each such spelling is shown as before, the value a binary dictionary's entry hands on is the
// one shown, and the file read warns once for each entry holding one, naming it, the class, the
// text and the value shown.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import type { ParseWarning } from '../src/datamodel/parser/ParseWarning.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
const metadata = (i: number) => ({
  uuid: uuid(i),
  namespace: 'dacaf35e-55a5-454d-a7c1-93db038a210e',
  lastmod: '20261018T000000.000000',
  modifiedby: 'host',
  isderived: '0',
});
const open = (session: any, bytes: Uint8Array, filename: string): any => ingest(session, buffer(bytes), { filename });
const entryOf = (root: any, name: string): any => root.getSection('design').children.find((e: any) => e.name === name);
/** This change's warnings: the ones about a spelling MATLAB does not write. */
const unwritten = (warnings: ParseWarning[] | undefined): ParseWarning[] =>
  (warnings ?? []).filter((w) => /MATLAB does not write/.test(w.message));

interface Spelled {
  name: string;
  /** The entry's `<P Name="Value">`, as the hand edit left it. */
  xml: string;
  /** What the table shows, which this change does not move (stay strict). */
  shown: string;
  /** What the entry hands a paste or a copy: serialize().value. */
  value: unknown;
  /** The one warning naming the entry, or null for a spelling MATLAB writes. */
  warning: string | null;
}

const said = (name: string, cls: string, text: string, shown: string) =>
  `"${name}" holds the ${cls} text '${text}', which MATLAB does not write; it is shown as ${shown}.`;

/**
 * The scoping's lenient_binary.sldd and lenient2_binary.sldd, entry for entry, and what MATLAB
 * R2027a reads for each (measure1.log and measure2.log, `Simulink.data.dictionary.open` then
 * `getValue`), followed by the vector, cell and struct sites, which the scoping did not measure.
 */
const MATLAB_READS: Spelled[] = [
  // logical [1 1] [1]
  { name: 'lgDot', xml: '<P Name="Value" Class="logical">1.0</P>', shown: 'false', value: false, warning: said('lgDot', 'logical', '1.0', 'false') },
  // logical [1 1] [0]
  { name: 'lgTrue', xml: '<P Name="Value" Class="logical">true</P>', shown: 'true', value: true, warning: said('lgTrue', 'logical', 'true', 'true') },
  // logical [1 1] [1]
  { name: 'lgTwo', xml: '<P Name="Value" Class="logical">2</P>', shown: 'false', value: false, warning: said('lgTwo', 'logical', '2', 'false') },
  // logical [1 1] [0]
  { name: 'lgZeroDot', xml: '<P Name="Value" Class="logical">0.0</P>', shown: 'false', value: false, warning: said('lgZeroDot', 'logical', '0.0', 'false') },
  // logical [1 2] [1 0]
  {
    name: 'lgRow',
    xml: '<P Name="Value" Class="logical" Dimension="1*2">1.0 0</P>',
    shown: '[false false]',
    value: { _type: 'logical', _value: '[0, 0]' },
    warning: said('lgRow', 'logical', '1.0', 'false'),
  },
  // uint8 [1 1] [1]
  { name: 'u8exp', xml: '<P Name="Value" Class="uint8">1e2</P>', shown: '1', value: { _type: 'uint8', _value: '1U' }, warning: said('u8exp', 'uint8', '1e2', '1') },
  // uint8 [1 1] [2]
  { name: 'u8half', xml: '<P Name="Value" Class="uint8">2.5</P>', shown: '2', value: { _type: 'uint8', _value: '2U' }, warning: said('u8half', 'uint8', '2.5', '2') },
  // int16 [1 1] [7]
  { name: 'i16lead', xml: '<P Name="Value" Class="int16">007</P>', shown: '7', value: { _type: 'int16', _value: '7' }, warning: null },
  // int32 [1 1] [7]
  { name: 'i32lead', xml: '<P Name="Value" Class="int32">007</P>', shown: '7', value: { _type: 'int32', _value: '7' }, warning: null },
  // uint16 [1 1] [7]
  { name: 'u16lead', xml: '<P Name="Value" Class="uint16">007</P>', shown: '7', value: { _type: 'uint16', _value: '7U' }, warning: null },
  // int16 [1 1] [1]
  { name: 'i16exp', xml: '<P Name="Value" Class="int16">1e2</P>', shown: '100', value: { _type: 'int16', _value: '100' }, warning: said('i16exp', 'int16', '1e2', '100') },
  // int16 [1 1] [2]
  { name: 'i16half', xml: '<P Name="Value" Class="int16">2.5</P>', shown: '3', value: { _type: 'int16', _value: '3' }, warning: said('i16half', 'int16', '2.5', '3') },
  // int8 [1 1] [-7]
  { name: 'i8neg', xml: '<P Name="Value" Class="int8">-7.9</P>', shown: '-8', value: { _type: 'int8', _value: '-8' }, warning: said('i8neg', 'int8', '-7.9', '-8') },
  // double [1 1] [0]
  { name: 'dblHex', xml: '<P Name="Value" Class="double">0x1F</P>', shown: '0', value: 0, warning: said('dblHex', 'double', '0x1F', '0') },
  // double [1 1] [7]
  { name: 'dblLead', xml: '<P Name="Value" Class="double">007</P>', shown: '7', value: 7, warning: null },
  // single [1 1] [100]
  { name: 'sglExp', xml: '<P Name="Value" Class="single">1e2</P>', shown: '100', value: { _type: 'single', _value: '100F' }, warning: null },
  // int8 [1 1] [7]
  { name: 'i8ok', xml: '<P Name="Value" Class="int8">7</P>', shown: '7', value: { _type: 'int8', _value: '7' }, warning: null },
  // Not measured from here on.
  // Read as parseInt reads it, -1, and shown converted to the class (F1-17), as it was.
  { name: 'u8negHalf', xml: '<P Name="Value" Class="uint8">-1.5</P>', shown: '0', value: { _type: 'uint8', _value: '0U' }, warning: said('u8negHalf', 'uint8', '-1.5', '0') },
  {
    name: 'i16row',
    xml: '<P Name="Value" Class="int16" Dimension="1*3">1e2 007 -7.9</P>',
    shown: '[100 7 -8]',
    value: { _type: 'int16', _value: '[100, 7, -8]' },
    warning: '"i16row" holds 2 values in text MATLAB does not write; the first is the int16 text \'1e2\', shown as 100.',
  },
  {
    name: 'dblRow',
    xml: '<P Name="Value" Class="double" Dimension="1*2">1.5 0x1F</P>',
    shown: '[1.5 0]',
    value: [1.5, 0],
    warning: said('dblRow', 'double', '0x1F', '0'),
  },
  {
    name: 'cellLg',
    xml: '<P Name="Value" Class="cell"><Element Class="logical">1.0</Element></P>',
    shown: '{false}',
    value: { _array_type: 'Cell', _dimensions: [1, 1], _elements: [false], _mw_element_type: 'MATLABArray' },
    warning: said('cellLg', 'logical', '1.0', 'false'),
  },
  {
    name: 'structLg',
    xml: '<P Name="Value" Class="struct"><Element><P Name="c" Class="logical">2</P></Element></P>',
    shown: '<1x1 struct>',
    value: { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ c: false }], _fields: ['c'], _mw_element_type: 'MATLABArray' },
    warning: said('structLg', 'logical', '2', 'false'),
  },
];

/** One that F1-17's warning names (a number its class cannot hold, spelled as MATLAB writes one). */
const UNHELD = { name: 'i8big', xml: '<P Name="Value" Class="int8">300</P>', shown: '127' };
// MATLAB reads i8big as int8 44 (measure2.log): its binary reader wraps.

/** MATLAB's typed_binary.sldd with the entries above (or `entries`) added, as the scoping's probe built its files. */
function binaryDictionary(entries: { name: string; xml: string }[] = [...MATLAB_READS, UNHELD]): Uint8Array {
  const zip = unzipSync(fixture('typed_binary.sldd'));
  const objects = entries.map(({ name, xml }, i) =>
    [
      '    <Object Class="DD.ENTRY">',
      `        <P Name="Name" Class="char">${name}</P>`,
      `        <P Name="UUID" Class="char">${uuid(i)}</P>`,
      '        <P Name="Namespace" Class="char">dacaf35e-55a5-454d-a7c1-93db038a210e</P>',
      '        <P Name="LastMod" Class="char">20261018T000000.000000</P>',
      '        <P Name="LastModBy" Class="char">host</P>',
      '        <P Name="IsDerived" Class="char">0</P>',
      `        ${xml}`,
      '    </Object>',
    ].join('\n'),
  );
  const chunk = strFromU8(zip['data/chunk0.xml']);
  const at = chunk.indexOf('    <Object Class="DD.Dictionary">');
  expect(at).toBeGreaterThan(-1);
  zip['data/chunk0.xml'] = strToU8(chunk.slice(0, at) + objects.join('\n') + '\n' + chunk.slice(at));
  return zipSync(zip);
}

/** Each entry's value pasted into a fresh copy of `file`, as a host's copy and paste hands it over. */
function pasteInto(source: any, file: string): { session: any; root: any } {
  const session = createSession();
  const root = open(session, fixture(file), file);
  MATLAB_READS.forEach(({ name }, i) =>
    root.getSection('design').parseEntry({ name, metadata: metadata(200 + i), value: entryOf(source, name).serialize().value }),
  );
  return { session, root };
}

describe('a binary dictionary holding a spelling MATLAB does not write', () => {
  const bytes = binaryDictionary();

  it('shows each one as it was shown before: no spelling gains a new reading', () => {
    const root = open(createSession(), bytes, 'lenient_binary.sldd');
    for (const { name, shown } of [...MATLAB_READS, UNHELD]) {
      expect(entryOf(root, name).displayValue, name).toBe(shown);
    }
    expect(entryOf(root, 'cellLg').children[0].displayValue).toBe('false');
    expect(entryOf(root, 'structLg').children.find((c: any) => c.name === 'c').displayValue).toBe('false');
  });

  it('hands a paste or a copy the value it shows', () => {
    const root = open(createSession(), bytes, 'lenient_binary.sldd');
    const handed = Object.fromEntries(MATLAB_READS.map(({ name }) => [name, entryOf(root, name).serialize().value]));
    expect(handed).toEqual(Object.fromEntries(MATLAB_READS.map(({ name, value }) => [name, value])));
    // A number its class cannot hold, spelled in digits, keeps its digits: F1-17 shows it
    // converted, and an untouched copy writes it as read.
    expect(entryOf(root, 'i8big').serialize().value).toEqual({ _type: 'int8', _value: '300' });
  });

  it('warns once for each entry holding one, naming it, and for no other entry', () => {
    const root = open(createSession(), bytes, 'lenient_binary.sldd');
    const warnings: ParseWarning[] = root.warnings ?? [];
    const named = (name: string) => warnings.filter((w) => w.part === name).map((w) => [w.code, w.message]);
    expect(Object.fromEntries(MATLAB_READS.map(({ name }) => [name, named(name)]))).toEqual(
      Object.fromEntries(MATLAB_READS.map(({ name, warning }) => [name, warning === null ? [] : [['part-unreadable', warning]]])),
    );
    // F1-17's number, spelled as MATLAB writes one, is F1-17's alone.
    expect(warnings.filter((w) => w.part === 'i8big').map((w) => w.message)).toEqual([
      '"i8big" holds the int8 value 300, which an int8 cannot hold; it is shown as MATLAB converts a number to its class, 127.',
    ]);
    const parts = new Set([...MATLAB_READS.filter((s) => s.warning !== null).map((s) => s.name), 'i8big']);
    expect(warnings.filter((w) => !parts.has(w.part!))).toEqual([]);
  });

  it('pasted into a text dictionary, writes the value shown, which reads back as shown', () => {
    const source = open(createSession(), bytes, 'lenient_binary.sldd');
    const { session, root } = pasteInto(source, 'typed_text.sldd');
    const saved = session.serializeSource(root.name).text as string;
    const entries = JSON.parse(saved).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const written = Object.fromEntries(MATLAB_READS.map(({ name }) => [name, entries.find((e: any) => e.name === name).value]));
    expect(written).toEqual(Object.fromEntries(MATLAB_READS.map(({ name, value }) => [name, value])));
    const reopened = open(createSession(), strToU8(saved), 'typed_text.sldd');
    for (const { name, shown } of MATLAB_READS) {
      expect(entryOf(reopened, name).displayValue, name).toBe(shown);
    }
    expect(unwritten(reopened.warnings)).toEqual([]);
  });

  it('pasted into a binary dictionary, writes the value shown, which reads back as shown and warns nothing', () => {
    const source = open(createSession(), bytes, 'lenient_binary.sldd');
    const { session, root } = pasteInto(source, 'typed_binary.sldd');
    const saved = session.serializeSource(root.name).bytes as Uint8Array;
    const chunk = strFromU8(unzipSync(saved)['data/chunk0.xml']);
    expect(chunk).toContain('<P Name="Value" Class="int16">7</P>');
    expect(chunk).toContain('<P Name="Value" Class="logical" Dimension="1*2">0 0</P>');
    const reopened = open(createSession(), saved, 'typed_binary.sldd');
    for (const { name, shown } of MATLAB_READS) {
      expect(entryOf(reopened, name).displayValue, name).toBe(shown);
    }
    expect(reopened.warnings).toBeUndefined();
  });
});

interface Empty {
  name: string;
  xml: string;
  shown: string;
  /** What the entry's children show. */
  kids: string[];
  value: unknown;
}

/**
 * A typed body holding nothing, under a Dimension that counts elements: a hand edit's or a damaged
 * file's, since MATLAB writes no such body. It holds no token at all, so no spelling MATLAB does not
 * write, and it is read exactly as it was before LENIENT (f9acdf9): a logical row as 0x0, with no
 * false made up for it, a numeric one as [0], and none of them warned about.
 */
const EMPTY_BODY: Empty[] = [
  { name: 'lgRowE', xml: '<P Name="Value" Class="logical" Dimension="1*2"></P>', shown: '<0x0 logical>', kids: [], value: { _type: 'logical', _value: '[]' } },
  {
    name: 'lgColE',
    xml: '<P Name="Value" Class="logical" Dimension="2*1"></P>',
    shown: '<2x1 logical>',
    kids: [],
    value: { _type: 'logical', _value: 'Matrix(2,1)\n[]' },
  },
  {
    name: 'cellLgE',
    xml: '<P Name="Value" Class="cell"><Element Class="logical" Dimension="1*2"></Element></P>',
    shown: '{<0x0 logical>}',
    kids: ['<0x0 logical>'],
    value: { _array_type: 'Cell', _dimensions: [1, 1], _elements: [{ _type: 'logical', _value: '[]' }], _mw_element_type: 'MATLABArray' },
  },
  { name: 'i16RowE', xml: '<P Name="Value" Class="int16" Dimension="1*2"></P>', shown: '[0]', kids: [], value: { _type: 'int16', _value: '[0]' } },
  { name: 'dblRowE', xml: '<P Name="Value" Class="double" Dimension="1*2"> </P>', shown: '[0]', kids: [], value: [0] },
];

/** Controls: the empties MATLAB writes, whose extents count no element, which LENIENT never reached. */
const WRITTEN_EMPTY: Empty[] = [
  {
    name: 'lg10',
    xml: '<P Name="Value" Class="logical" Dimension="1*0"></P>',
    shown: '<1x0 logical>',
    kids: [],
    value: { _type: 'logical', _value: 'Matrix(1,0)', _binary_empty: true },
  },
  {
    name: 'i16_00',
    xml: '<P Name="Value" Class="int16" Dimension="0*0"></P>',
    shown: '[ ]',
    kids: [],
    value: { _type: 'int16', _value: 'Matrix(0,0)', _binary_empty: true },
  },
  {
    name: 'cellLg10',
    xml: '<P Name="Value" Class="cell"><Element Class="logical" Dimension="1*0"></Element></P>',
    shown: '{<1x0 logical>}',
    kids: ['<1x0 logical>'],
    value: {
      _array_type: 'Cell',
      _dimensions: [1, 1],
      _elements: [{ _type: 'logical', _value: 'Matrix(1,0)', _binary_empty: true }],
      _mw_element_type: 'MATLABArray',
    },
  },
];

describe('a binary dictionary holding an empty typed body', () => {
  const bytes = binaryDictionary([...EMPTY_BODY, ...WRITTEN_EMPTY]);

  const readsAsBefore = ({ name, shown, kids, value }: Empty) => {
    const root = open(createSession(), bytes, 'empty_binary.sldd');
    const entry = entryOf(root, name);
    expect([entry.displayValue, entry.children.map((c: any) => c.displayValue)], name).toEqual([shown, kids]);
    expect(entry.serialize().value, name).toEqual(value);
    expect((root.warnings ?? []).filter((w: ParseWarning) => w.part === name), name).toEqual([]);
  };

  for (const empty of EMPTY_BODY) {
    it(`reads ${empty.xml} as before, and warns nothing`, () => readsAsBefore(empty));
  }

  it('reads each empty MATLAB writes as before, and warns nothing (a control)', () => {
    for (const empty of WRITTEN_EMPTY) {
      readsAsBefore(empty);
    }
  });
});

/** The text twins: f117b_text.sldd's three (measure2.log), and the arms the scoping did not measure. */
const TEXT: { name: string; value: unknown; shown: string; warning: string | null }[] = [
  // logical [1 2] [1 0]
  { name: 'lgTwoT', value: { _type: 'logical', _value: '[2, 0]' }, shown: '[false false]', warning: said('lgTwoT', 'logical', '2', 'false') },
  // int16 [1 1] [100]
  { name: 'i16expT', value: { _type: 'int16', _value: '1e2' }, shown: '100', warning: said('i16expT', 'int16', '1e2', '100') },
  // int16 [1 1] [7]
  { name: 'i16leadT', value: { _type: 'int16', _value: '007' }, shown: '7', warning: null },
  // Not measured from here on.
  { name: 'lgSc', value: { _type: 'logical', _value: 'true' }, shown: 'true', warning: said('lgSc', 'logical', 'true', 'true') },
  { name: 'dblHexT', value: { _type: 'double', _value: '[1.5, 0x1F]' }, shown: '[1.5 0]', warning: said('dblHexT', 'double', '0x1F', '0') },
  {
    name: 'i16matT',
    value: { _type: 'int16', _value: 'Matrix(2,1)\n[1e2, 7]' },
    shown: '[100; 7]',
    warning: said('i16matT', 'int16', '1e2', '100'),
  },
  {
    name: 'lgFieldT',
    value: {
      _array_type: 'Struct',
      _dimensions: [1, 1],
      _elements: [{ c: { _type: 'logical', _value: '[1.0, 0]' } }],
      _fields: ['c'],
      _mw_element_type: 'MATLABArray',
    },
    shown: '<1x1 struct>',
    warning: said('lgFieldT', 'logical', '1.0', 'false'),
  },
  { name: 'u8okT', value: { _type: 'uint8', _value: '[7U, 0U]' }, shown: '[7 0]', warning: null },
];

/** MATLAB's typed_text.sldd with the entries above added. */
function textDictionary(extra: { name: string; value: unknown }[] = []): string {
  const json = JSON.parse(strFromU8(fixture('typed_text.sldd')));
  const content = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content;
  [...TEXT, ...extra].forEach(({ name, value }, i) => content.entries.push({ name, metadata: metadata(i), value }));
  return JSON.stringify(json, null, '\t');
}

describe('a text dictionary holding a spelling MATLAB does not write', () => {
  // int8 2.5 is F1-17's: a number an int8 cannot hold, which MATLAB reads as 3 (measure1.log).
  const text = textDictionary([{ name: 'i8halfT', value: { _type: 'int8', _value: '2.5' } }]);

  it('shows each one as it was shown before', () => {
    const root = open(createSession(), strToU8(text), 'lenient_text.sldd');
    for (const { name, shown } of TEXT) {
      expect(entryOf(root, name).displayValue, name).toBe(shown);
    }
    expect(entryOf(root, 'lgFieldT').children.find((c: any) => c.name === 'c').displayValue).toBe('[false false]');
  });

  it('warns once for each entry holding one, naming it, and for no other entry', () => {
    const root = open(createSession(), strToU8(text), 'lenient_text.sldd');
    const warnings: ParseWarning[] = root.warnings ?? [];
    const named = (name: string) => warnings.filter((w) => w.part === name).map((w) => [w.code, w.message]);
    expect(Object.fromEntries(TEXT.map(({ name }) => [name, named(name)]))).toEqual(
      Object.fromEntries(TEXT.map(({ name, warning }) => [name, warning === null ? [] : [['part-unreadable', warning]]])),
    );
    expect(warnings.filter((w) => w.part === 'i8halfT').map((w) => w.message)).toEqual([
      '"i8halfT" holds the int8 value 2.5, which an int8 cannot hold; it is shown as MATLAB reads it, 3.',
    ]);
    const parts = new Set([...TEXT.filter((s) => s.warning !== null).map((s) => s.name), 'i8halfT']);
    expect(warnings.filter((w) => !parts.has(w.part!))).toEqual([]);
  });

  it('is saved untouched as it was read', () => {
    const session = createSession();
    const root = open(session, strToU8(text), 'lenient_text.sldd');
    expect(session.serializeSource(root.name).text).toBe(text);
  });

  // A host's paste has no warning channel: what the paste records is not reported against the
  // next dictionary read, of either format.
  for (const file of ['typed_text.sldd', 'typed_binary.sldd']) {
    it(`pasted into ${file}, warns nothing against the next dictionary read`, () => {
      const session = createSession();
      const root = open(session, fixture(file), file);
      TEXT.forEach(({ name, value }, i) => root.getSection('design').parseEntry({ name, metadata: metadata(300 + i), value }));
      expect(entryOf(root, 'lgTwoT').displayValue).toBe('[false false]');
      expect(open(createSession(), fixture(file), file).warnings).toBeUndefined();
    });
  }
});

describe('a dictionary MATLAB wrote', () => {
  // The guard against a noisy warning: every typed body of every dictionary among the fixtures is
  // spelled as MATLAB writes it (and so is every one in the local corpus, graded the same way).
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.sldd') ? [p] : [];
    });
  const files = walk(FIXTURES);

  it('warns about no spelling, in any dictionary among the fixtures', () => {
    expect(files.length).toBeGreaterThan(40);
    for (const file of files) {
      const u8 = new Uint8Array(readFileSync(file));
      let root: any;
      try {
        root = open(createSession(), u8, file.split('/').pop()!);
      } catch {
        continue;
      }
      expect(unwritten(root.warnings), file).toEqual([]);
    }
  });
});
