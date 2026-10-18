// Copyright 2026 The MathWorks, Inc.
//
// A complex value whose imaginary part is -0 shows that part with a `+`: complex(1, -0) is
// `1+0i`. The maintainer's ruling of 2026-10-18 (group G, follow-up 5 of group F's reviews),
// which is about the display alone: the value, its copy and its save keep the -0.
//
// A binary dictionary holds a complex value as text, and the node layer keeps that text as the
// value (MatlabVariableNode._parseCdataText), dropping only MATLAB's `.0`. So complex(1, -0),
// which this package's writer spells `1.0-0.0i` (XmlUtils.formatComplexBodyXml) and MATLAB's
// spells the same way (a -0 is `-0.0`, test/numbers/negzero.truth.json; MATLAB's own
// complex(-0, -3) is `-0.0-3.0i`, test/sparseFixtures.test.ts), showed `1-0i`, which reads as a
// negative imaginary part. The same value read out of MAT bytes, a .mat's or a text dictionary's
// stream, showed `1+0i` (formatComplexNum), and MATLAB shows `1.0000 + 0.0000i`.
//
// The text stays the value, because an edit of one element writes the whole array from it: an
// untouched element's -0 is written `-0.0i` only because its text says `-0`. What changed is
// what is shown of it (XmlUtils.shownComplexText): a complex scalar's own text, so every element
// row, cell member, struct field and Parameter Value, a complex array's one-line literal, the
// Variable Editor's cells, and the Property Inspector's Other group.
//
// A REAL part of -0 is shown as it is, `-0+2i`: the ruling is about the imaginary part, and
// test/sparseFixtures.test.ts records the real part's difference between venues on a value
// MATLAB wrote (SPELLED_DIFFERENTLY.dComplex).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { parseComplexNum, shownComplexText } from '../src/datamodel/parser/XmlUtils.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import { MAX_EXPANDED_ELEMENTS } from '../src/datamodel/display/DisplayConvention.js';
import { uudecode } from '../src/datamodel/parser/CdataCodec.js';
import { decodeMatStream } from '../src/datamodel/parser/MatParser.js';
import { encodeCdata } from '../src/datamodel/parser/MatWriter.js';
import { CLASS, cellVar, matFile, numericVar, sparseVar } from './tools/matBytes.js';
import { BINARY, TEXT, copyOf, pasted, pasteSaveReopen } from './tools/pasteVenues.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const FIXTURE = new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/mcos/complex_binary.sldd', import.meta.url))));

/** One entry's `<Object>` block in `xml`, as [start, end]. */
function blockAt(xml: string, name: string): [number, number] {
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(at, name).toBeGreaterThan(-1);
  return [xml.lastIndexOf('<Object ', at), xml.indexOf('</Object>', at)];
}

// A numeric cell, {complex(1, -0), [complex(2, 1) complex(3, -0)], 4}, in the spelling MATLAB
// writes a complex member in (`<Element Class="double" IsComplex="1">`, test/cellComplexMember).
const NUMERIC_CELL =
  '<P Name="Value" Class="cell" Dimension="1*3">\n' +
  '            <Element Class="double" IsComplex="1">1.0-0.0i</Element>\n' +
  '            <Element Class="double" IsComplex="1" Dimension="1*2">2.0+1.0i 3.0-0.0i</Element>\n' +
  '            <Element Class="double">4.0</Element>\n' +
  '        </P>\n    ';

// MATLAB's complex_binary.sldd with values made to hold a -0 part. Each text replaced occurs
// once in its entry; `c`'s Value, the last property of its entry, is replaced whole.
const EDITS: [entry: string, from: string, to: string][] = [
  ['z', '>3.0+4.0i<', '>1.0-0.0i<'],
  ['zRow', '>1.0+2.0i 3.0+4.0i 5.0+6.0i<', '>1.0-0.0i 3.0+4.0i -0.0-0.0i<'],
  ['pScalar', '>3.0+4.0i<', '>2.5-0.0i<'],
  ['pSingle', '>2.5-0.5i<', '>2.5-0.0i<'],
  ['pStruct', '>1.0+2.0i<', '>1.0-0.0i<'],
  ['pStruct', '>3.0+4.0i 5.0-6.0i<', '>3.0-0.0i 5.0-6.0i<'],
  ['lut', '>1.0+2.0i 3.0+4.0i 5.0+6.0i<', '>1.0-0.0i 3.0+4.0i 5.0+6.0i<'],
];

const CHUNK = ((): string => {
  let xml = strFromU8(unzipSync(FIXTURE)['data/chunk0.xml']);
  for (const [name, from, to] of EDITS) {
    const [start, end] = blockAt(xml, name);
    const block = xml.slice(start, end);
    expect(block.split(from).length, `${name}: ${from}`).toBe(2);
    xml = xml.slice(0, start) + block.replace(from, to) + xml.slice(end);
  }
  const [start, end] = blockAt(xml, 'c');
  const block = xml.slice(start, end);
  const value = block.indexOf('<P Name="Value" Class="cell"');
  expect(value).toBeGreaterThan(-1);
  return xml.slice(0, start) + block.slice(0, value) + NUMERIC_CELL + xml.slice(end);
})();

const FILE = zipSync({ ...unzipSync(FIXTURE), 'data/chunk0.xml': strToU8(CHUNK) });
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

function opened(session = createSession()): { session: any; root: any } {
  return { session, root: ingest(session, buffer(FILE), { filename: 'complex_binary.sldd' }) };
}

const entryOf = (root: any, name: string): any => {
  const e = root.getSection('design').children.find((c: any) => c.name === name);
  expect(e, name).toBeDefined();
  return e;
};
const childOf = (node: any, name: string): any => {
  const c = node.children.find((x: any) => x.name === name);
  expect(c, name).toBeDefined();
  return c;
};

/** An entry's Value tag as a save wrote it. */
function savedValue(session: any, root: any, name: string): string {
  const xml = strFromU8(unzipSync(session.serializeSource(root.name).bytes)['data/chunk0.xml']);
  const [start, end] = blockAt(xml, name);
  const block = xml.slice(start, end);
  const at = block.indexOf('<P Name="Value"');
  return block.slice(at, block.indexOf('</P>', at) + 4);
}

/** Whether a MAT stream's first element has an imaginary part of -0. */
function streamImIsNegativeZero(cdata: any): boolean {
  const decoded: any = decodeMatStream(uudecode(cdata._value));
  expect(decoded.ok).toBe(true);
  const v = decoded.variable.value;
  return Object.is((Array.isArray(v) ? v[0] : v).im, -0);
}

describe("a binary dictionary's imaginary -0 shows with a +", () => {
  it("an entry's scalar", () => {
    const z = entryOf(opened().root, 'z');
    expect([z.displayValue, z.className]).toEqual(['1+0i', 'double']);
  });

  it("an entry's row: its one-line text, its element rows and the Variable Editor's cells", () => {
    const zRow = entryOf(opened().root, 'zRow');
    // The third element is complex(-0, -0): its imaginary part shows `+0`, its real part `-0`,
    // which the ruling does not change.
    expect(zRow.displayValue).toBe('[1+0i 3+4i -0+0i]');
    expect(zRow.children.map((c: any) => c.displayValue)).toEqual(['1+0i', '3+4i', '-0+0i']);
    expect(zRow.displayElements().map((e: any) => e.value)).toEqual(['1+0i', '3+4i', '-0+0i']);
  });

  it("a Parameter's Value, double and single", () => {
    const { root } = opened();
    expect(entryOf(root, 'pScalar').displayValue).toBe('2.5+0i');
    expect(entryOf(root, 'pSingle').displayValue).toBe('2.5+0i');
  });

  it('a struct field, scalar and row', () => {
    const value = childOf(entryOf(opened().root, 'pStruct'), 'Value');
    expect(childOf(value, 'a').displayValue).toBe('1+0i');
    const b = childOf(value, 'b');
    expect(b.displayValue).toBe('[3+0i 5-6i]');
    expect(b.children.map((c: any) => c.displayValue)).toEqual(['3+0i', '5-6i']);
  });

  it("a cell's members, its literal and its Variable Editor cells", () => {
    const c = entryOf(opened().root, 'c');
    expect(c.displayValue).toBe('{1+0i, [2+1i 3+0i], 4}');
    expect(c.children.map((m: any) => m.displayValue)).toEqual(['1+0i', '[2+1i 3+0i]', '4']);
    expect(c.children[1].children.map((m: any) => m.displayValue)).toEqual(['2+1i', '3+0i']);
    expect(c.displayElements().map((e: any) => e.value)).toEqual(['1+0i', '[2+1i 3+0i]', '4']);
  });

  it("the Variable Editor's cells of an array too long to have element rows", () => {
    // displayElements reads such an array's elements through a scratch element node, not rows.
    const n = MAX_EXPANDED_ELEMENTS + 1;
    const body = Array.from({ length: n }, (_, k) => (k === n - 1 ? '1.0-0.0i' : `${k}.0+1.0i`)).join(' ');
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<DataSource FormatVersion="1" MinRelease="R2014a">\n    <Object Class="DD.ENTRY">\n' +
      '        <P Name="Name" Class="char">zLong</P>\n' +
      `        <P Name="Value" Class="double" IsComplex="1" Dimension="1*${n}">${body}</P>\n    </Object>\n</DataSource>`;
    const entry: any = createSession().addDataSource('mem://zLong', parseBinarySlddParts(xml, {}), { path: 'q.sldd' }).getSection('design').children[0];
    expect(entry.children).toHaveLength(0);
    const cells = entry.displayElements();
    expect([cells.length, cells[0].value, cells[n - 1].value]).toEqual([n, '0+1i', '1+0i']);
  });

  it("the Property Inspector's Other group (a LookupTable's Table.Value)", () => {
    const lut = entryOf(opened().root, 'lut');
    expect(lut.toPIObject().objects[0]['Other.Table.Value']).toBe('[1+0i, 3+4i, 5+6i]');
  });
});

describe('every venue shows complex(1, -0) as 1+0i', () => {
  it('a binary dictionary, a .mat, a text dictionary, a cell member, an array element and a sparse row', () => {
    const { root } = opened();
    const z = entryOf(root, 'z');
    const mat: any = createSession().addMatSource(
      't.mat',
      matFile([
        numericVar({ name: 'z', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [1], imag: [-0] }),
        numericVar({ name: 'row', cls: CLASS.DOUBLE, dimensions: [1, 2], real: [1, 3], imag: [-0, 4] }),
        cellVar('c', [numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [1], imag: [-0] })]),
        sparseVar({ name: 'sp', dimensions: [1, 2], ir: [0, 0], jc: [0, 1, 2], real: [1, 3], imag: [-0, 4] }),
      ]),
    );
    const matVar = (name: string): any => childOf(mat, name);
    const stream = {
      _type: 'cdata',
      _value: encodeCdata({ name: '', className: 'double', dimensions: [1, 1], isComplex: true, isLogical: false, value: [{ re: 1, im: -0 }], fields: null }),
    };
    const shown: Record<string, string> = {
      'binary entry': z.displayValue,
      'binary row element': entryOf(root, 'zRow').children[0].displayValue,
      'binary cell member': entryOf(root, 'c').children[0].displayValue,
      '.mat scalar': matVar('z').displayValue,
      '.mat row element': matVar('row').children[0].displayValue,
      '.mat cell member': matVar('c').children[0].displayValue,
      '.mat sparse row': matVar('sp').children[0].displayValue,
      'text dictionary stream': pasted(TEXT, stream).displayValue,
      'the binary copy, pasted into a text dictionary': pasted(TEXT, copyOf(z)).displayValue,
      'the binary copy, pasted into a binary dictionary': pasted(BINARY, copyOf(z)).displayValue,
    };
    expect(shown).toEqual(Object.fromEntries(Object.keys(shown).map((k) => [k, '1+0i'])));
  });
});

describe('display only: the value, its copy and its save keep the -0', () => {
  it('the value is the text read, and the copy is that text', () => {
    const z = entryOf(opened().root, 'z');
    expect(Object.is(parseComplexNum(z.Value as string)!.im, -0)).toBe(true);
    expect(copyOf(z)).toEqual({ _type: 'cdata', _value: '1.0-0.0i' });
  });

  it('a save that edits nothing writes it as it was read', () => {
    const { session, root } = opened();
    expect(savedValue(session, root, 'z')).toBe('<P Name="Value" Class="double" IsComplex="1">1.0-0.0i</P>');
    expect(savedValue(session, root, 'zRow')).toBe(
      '<P Name="Value" Class="double" IsComplex="1" Dimension="1*3">1.0-0.0i 3.0+4.0i -0.0-0.0i</P>',
    );
  });

  it('an edit of another element writes the -0 neighbours back with their sign', () => {
    const { session, root } = opened();
    const zRow = entryOf(root, 'zRow');
    expect(zRow.children[1].setProperty('Value', '7+8i')).toBe(true);
    expect(zRow.displayValue).toBe('[1+0i 7+8i -0+0i]');
    expect(savedValue(session, root, 'zRow')).toBe(
      '<P Name="Value" Class="double" IsComplex="1" Dimension="1*3">1.0-0.0i 7.0+8.0i -0.0-0.0i</P>',
    );
  });

  it('the copy pasted into either kind of dictionary, saved and opened again, still holds the -0', () => {
    const copy = copyOf(entryOf(opened().root, 'z'));
    const text = pasteSaveReopen(TEXT, copy).entry;
    expect(text.displayValue).toBe('1+0i');
    expect(streamImIsNegativeZero(copyOf(text))).toBe(true);
    const binary = pasteSaveReopen(BINARY, copy).entry;
    expect(binary.displayValue).toBe('1+0i');
    expect(copyOf(binary)).toEqual({ _type: 'cdata', _value: '1.0-0.0i' });
  });
});

describe('the shown text committed unchanged is no edit, so the -0 stays', () => {
  it("an entry's Value, set on the node", () => {
    const { session, root } = opened();
    const z = entryOf(root, 'z');
    expect(z.setProperty('Value', '1+0i')).toBe(true);
    expect(copyOf(z)).toEqual({ _type: 'cdata', _value: '1.0-0.0i' });
    expect(savedValue(session, root, 'z')).toBe('<P Name="Value" Class="double" IsComplex="1">1.0-0.0i</P>');
  });

  it("an element row's Value, committed through the session, records no undo step", () => {
    const { session, root } = opened();
    const zRow = entryOf(root, 'zRow');
    session.setActive(root, zRow.children[0]);
    expect(session.editProperty(zRow.children[0].id, 'Value', '1+0i')).toBe(true);
    expect(session.canUndo()).toBe(false);
    expect(savedValue(session, root, 'zRow')).toBe(
      '<P Name="Value" Class="double" IsComplex="1" Dimension="1*3">1.0-0.0i 3.0+4.0i -0.0-0.0i</P>',
    );
  });
});

describe('shownComplexText', () => {
  const SHOWN: [text: string, shown: string][] = [
    ['1-0i', '1+0i'],
    ['1.0-0.0i', '1.0+0.0i'],
    ['-0-0i', '-0+0i'],
    ['2.5-0e3i', '2.5+0e3i'],
    ['1-0.000i', '1+0.000i'],
    ['1-.0i', '1+.0i'],
    ['1-00i', '1+00i'],
    ['NaN-0i', 'NaN+0i'],
    ['-Inf-0i', '-Inf+0i'],
    ['9223372036854775807-0i', '9223372036854775807+0i'],
  ];
  for (const [text, shown] of SHOWN) {
    it(`${text} shows ${shown}`, () => {
      expect(shownComplexText(text)).toBe(shown);
    });
  }

  // A part that is not a zero, a zero with no sign or a `+`, a real part of -0, and text that is
  // not one element: each as it is.
  const AS_IS = ['1+0i', '1+0.0i', '3-4i', '1-0.5i', '1-0.01i', '1-01i', '1-0e5x', '-0+2i', '1NaNi', '1-NaNi', '1-Infi', '1-0i 2-0i', '1-0', '-0', 'abc', ''];
  for (const text of AS_IS) {
    it(`${JSON.stringify(text)} shows as it is`, () => {
      expect(shownComplexText(text)).toBe(text);
    });
  }
});
