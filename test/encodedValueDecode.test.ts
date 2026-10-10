// Copyright 2026 The MathWorks, Inc.
//
// Reading a binary dictionary's encoded values (parser/EncodedValue,
// MatlabVariableNode.parseEncoded), on synthesized bytes: what each malformation the
// text or the stream can carry reads as, at every site the reader asks, and that none of
// them is ever a number read out of the hex text. MATLAB's own encoded values are
// test/encodedValueWriteBack.test.ts's and sparseFixtures.test.ts's subject; this is the
// part MATLAB cannot be asked to write.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import {
  encodedBytes,
  encodedStream,
  encodedValueOf,
  hexText,
  type EncodedValue,
} from '../src/datamodel/parser/EncodedValue.js';
import type { ParseWarning } from '../src/datamodel/parser/ParseWarning.js';
import { CLASS, MI, arrayFlags, dims, element, matrix, mxArrayFile, numericVar, sparseVar, u32le, varName } from './tools/matBytes.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const DECL = '<?xml version="1.0" encoding="UTF-8"?>';

/** A MAT stream as getByteStreamFromArray writes one: preamble, then one unnamed miMATRIX. */
function stream(matrixElement: Uint8Array): Uint8Array {
  // mxArrayFile wants the body without the outer tag; matrix() wrote one, so strip it.
  return new Uint8Array(mxArrayFile(matrixElement.slice(8)));
}

// sparse([1 0 2; 0 3 0]): non-zeros (1,1)=1, (2,2)=3, (1,3)=2, column-major.
const SPARSE_2x3 = stream(
  sparseVar({ name: '', dimensions: [2, 3], ir: [0, 1, 0], jc: [0, 1, 2, 3], real: [1, 3, 2] }),
);

const hexOf = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');

/**
 * A one-entry dictionary whose Value element is `valueXml`. One warnings list for the
 * reader and the node layer, as ingest hands them.
 */
function dictionary(valueXml: string, warnings?: ParseWarning[]): any {
  const xml =
    `${DECL}\n<DataSource FormatVersion="1" MinRelease="R2014a">\n    <Object Class="DD.ENTRY">\n` +
    `        <P Name="Name" Class="char">v</P>\n        <P Name="UUID" Class="char">u</P>\n` +
    `${valueXml}\n    </Object>\n</DataSource>`;
  return createSession().addDataSource(
    'mem://encoded-' + Math.random(),
    parseBinarySlddParts(xml, {}, warnings),
    { path: 'e.sldd' },
    warnings,
  );
}

/** A Value element in MATLAB's layout for `bytes`, with whatever attributes are given. */
const hexElement = (bytes: Uint8Array, attrs = `Class="double" Encoding="hex" EncodedLength="${bytes.length}"`) =>
  `        <P Name="Value" ${attrs}>${hexText(bytes, 2)}</P>`;

const entryOf = (valueXml: string, warnings?: ParseWarning[]): any => dictionary(valueXml, warnings).getSection('design').children[0];

const subtree = (node: any): any[] => [node, ...node.children.flatMap(subtree)];

/** The entry's Value element as serializeEntryToXml writes it. */
const writtenValue = (entry: any): string => {
  const xml = serializeEntryToXml(entry);
  const at = xml.indexOf('<P Name="Value"');
  return xml.slice(at, xml.indexOf('</P>', at) + 4);
};

describe('the envelope keeps what the element said', () => {
  it('every attribute but the positional ones, in the order the file gave them, and the text verbatim', () => {
    const v = encodedValueOf(
      { '@_Name': 'Value', '@_EncodedLength': '3', '@_Class': 'double', '@_Encoding': 'hex', '@_Source': 'saveobj', '@_PropertyType': 'any' },
      '\n  0A0B0C',
    )!;
    expect(v).toEqual({ _type: 'encoded', _attrs: { EncodedLength: '3', Class: 'double', Encoding: 'hex' }, _value: '\n  0A0B0C' });
    expect(Object.keys(v._attrs)).toEqual(['EncodedLength', 'Class', 'Encoding']);
  });

  it('is only made for an element that carries an Encoding', () => {
    expect(encodedValueOf({ '@_Class': 'double' }, '0001494D')).toBeNull();
  });
});

describe('reading the bytes', () => {
  const env = (text: string, attrs: Record<string, string> = { Encoding: 'hex' }): EncodedValue => ({ _type: 'encoded', _attrs: attrs, _value: text });

  it('skips the layout — line breaks, indentation, tabs, CRLF — and reads either case', () => {
    const want = [0x00, 0x01, 0x49, 0x4d, 0xab];
    for (const text of ['0001494DAB', '0001494dab', '\n                0001\n                494DAB', '\r\n\t0001494D\r\n\tAB  ']) {
      expect(Array.from(encodedBytes(env(text)).bytes!), JSON.stringify(text)).toEqual(want);
    }
  });

  it('honours EncodedLength: the declared count is read, a surplus is not the value', () => {
    expect(Array.from(encodedBytes(env('0102030405', { Encoding: 'hex', EncodedLength: '3' })).bytes!)).toEqual([1, 2, 3]);
    expect(Array.from(encodedBytes(env('0102030405', { Encoding: 'hex', EncodedLength: '5' })).bytes!)).toEqual([1, 2, 3, 4, 5]);
    expect(Array.from(encodedBytes(env('0102', { Encoding: 'hex' })).bytes!)).toEqual([1, 2]);
  });

  it('refuses, with a reason, what it cannot trust', () => {
    const reason = (text: string, attrs?: Record<string, string>) => encodedBytes(env(text, attrs)).reason;
    expect(reason('0102030', undefined)).toBe('its hex text has an odd number of digits (7)');
    expect(reason('01020G')).toBe('its hex text holds a character that is not a hex digit');
    expect(reason('0102', { Encoding: 'hex', EncodedLength: '3' })).toBe('it declares 3 bytes and holds 2');
    expect(reason('0102', { Encoding: 'hex', EncodedLength: 'many' })).toBe('its EncodedLength "many" is not a byte count');
    expect(reason('AQI=', { Encoding: 'base64' })).toBe('its Encoding is "base64", which this reader does not decode');
  });

  it('a stream has to be a MAT stream, and as long as its array says', () => {
    const streamReason = (bytes: Uint8Array) => encodedStream(env(hexOf(bytes))).reason;
    expect(streamReason(SPARSE_2x3)).toBeUndefined();
    expect(streamReason(SPARSE_2x3.slice(0, 12))).toBe("it holds 12 bytes, fewer than a MAT stream's header");
    const notMat = SPARSE_2x3.slice();
    notMat[2] = 0x58;
    expect(streamReason(notMat)).toBe('its bytes are not a MAT stream (they do not open with 00 01 49 4D)');
    const notArray = SPARSE_2x3.slice();
    notArray[8] = MI.UINT8;
    expect(streamReason(notArray)).toBe('its MAT stream does not hold an array');
    expect(streamReason(SPARSE_2x3.slice(0, SPARSE_2x3.length - 8))).toBe(
      `its MAT array declares ${SPARSE_2x3.length - 16} bytes and the stream holds ${SPARSE_2x3.length - 24}`,
    );
  });

  it('hexText is MATLAB\'s layout: a line break, then lines of 128 digits two levels in', () => {
    const bytes = new Uint8Array(100).map((_, i) => i);
    const text = hexText(bytes, 2);
    const lines = text.split('\n');
    expect(lines[0]).toBe('');
    expect(lines.slice(1).map((l) => l.length)).toEqual([16 + 128, 16 + 72]);
    expect(lines.slice(1).every((l) => l.startsWith(' '.repeat(16)) && !l.startsWith(' '.repeat(17)))).toBe(true);
    expect(text.replace(/\s+/g, '')).toBe(hexOf(bytes));
  });
});

describe('a hex value shows what it holds', () => {
  it('a sparse array: its size, its class, its summary, and its non-zeros, which are all it holds', () => {
    const entry = entryOf(hexElement(SPARSE_2x3));
    expect(entry.dims).toEqual([2, 3]);
    expect(entry.displayValue).toBe('<2x3 sparse double>');
    expect([entry.isSparse, [...entry._sparse.row], [...entry._sparse.col], [...entry._sparse.re]]).toEqual([true, [0, 1, 0], [0, 1, 2], [1, 3, 2]]);
    // One row per non-zero, in MATLAB's order.
    expect(entry.children.map((c: any) => [c.displayName, c.displayValue])).toEqual([
      ['v(1,1)', '1'],
      ['v(2,2)', '3'],
      ['v(1,3)', '2'],
    ]);
  });

  it('whatever the layout of its text', () => {
    const digits = hexOf(SPARSE_2x3);
    const layouts = [
      digits,
      '\r\n' + digits.replace(/(.{40})/g, '$1\r\n'),
      '\n\t' + digits.toLowerCase() + '\n',
    ];
    for (const text of layouts) {
      const entry = entryOf(`        <P Name="Value" Class="double" Encoding="hex" EncodedLength="${SPARSE_2x3.length}">${text}</P>`);
      expect(entry.displayValue, JSON.stringify(text.slice(0, 8))).toBe('<2x3 sparse double>');
    }
  });

  it('a dense array MATLAB would not write this way reads as itself too: the reader keys on the stream, not on sparsity', () => {
    const dense = stream(numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 3], real: [4, 5, 6] }));
    expect(entryOf(hexElement(dense)).displayValue).toBe('[4 5 6]');
  });

  it('at every site a value is read: a struct field, a cell element, an object property', () => {
    const body = hexText(SPARSE_2x3, 4);
    const attrs = `Class="double" Encoding="hex" EncodedLength="${SPARSE_2x3.length}"`;
    const struct = entryOf(
      `        <P Name="Value" Class="struct">\n            <Element>\n                <P Name="f" ${attrs}>${body}</P>\n` +
        `                <P Name="g" Class="double">7.0</P>\n            </Element>\n        </P>`,
    );
    const cell = entryOf(
      `        <P Name="Value" Class="cell" Dimension="1*2">\n            <Element ${attrs}>${body}</Element>\n` +
        `            <Element Class="double">7.0</Element>\n        </P>`,
    );
    const param = entryOf(
      `        <P Name="Value">\n            <Element Class="Simulink.Parameter">\n                <P Name="Value" ${attrs}>${body}</P>\n` +
        `                <P Name="Description" Class="char">d</P>\n            </Element>\n        </P>`,
    );
    const field = struct.children.find((c: any) => c.name === 'f');
    expect([field.displayValue, field.dims]).toEqual(['<2x3 sparse double>', [2, 3]]);
    expect([cell.children[0].displayValue, cell.children[0].dims]).toEqual(['<2x3 sparse double>', [2, 3]]);
    const value = param.children.find((c: any) => c.name === 'Value');
    expect([value.displayValue, value.dims]).toEqual(['<2x3 sparse double>', [2, 3]]);

    // Each nested value is read-only and written back as read, and its siblings are not.
    for (const [entry, holder] of [[struct, field], [cell, cell.children[0]], [param, value]]) {
      for (const n of subtree(holder)) {
        expect(n.valueEditable, n.id).toBe(false);
      }
      expect(serializeEntryToXml(entry)).toContain(body);
    }
    expect(struct.children.find((c: any) => c.name === 'g').valueEditable).toBe(true);
    expect(param.toRow()._descriptionEditable).toBe(true);
    expect(param.setProperty('Description', 'edited')).toBe(true);
    const out = serializeEntryToXml(param);
    expect(out).toContain('<P Name="Description" Class="char">edited</P>');
    expect(out).toContain(`<P Name="Value" ${attrs}>${body}</P>`);
  });
});

describe('a stream that does not read is a placeholder, never a number, and is written back as it was', () => {
  const sparseText = hexText(SPARSE_2x3, 2);
  const cases: [string, string, string, string][] = [
    // [what, attributes, text, display]
    ['odd number of digits', `Class="double" Encoding="hex"`, sparseText + '0', '<double, not decoded>'],
    ['a character that is not a digit', `Class="double" Encoding="hex"`, sparseText.replace(/0(?=001494D)/, 'Z'), '<double, not decoded>'],
    ['shorter than its EncodedLength', `Class="double" Encoding="hex" EncodedLength="${SPARSE_2x3.length + 8}"`, sparseText, '<double, not decoded>'],
    ['a truncated stream', `Class="double" Encoding="hex"`, hexText(SPARSE_2x3.slice(0, 40), 2), '<double, not decoded>'],
    ['bytes that are not a MAT stream', `Class="Simulink.Parameter" Encoding="hex" EncodedLength="16"`, hexText(new Uint8Array(16).fill(0x31), 2), '<Simulink.Parameter, not decoded>'],
    ['an encoding this reader has no decoder for', `Class="double" Encoding="base64"`, 'AAFJTQAAAAA=', '<double, not decoded>'],
    // The placeholder displays as itself whatever class the element names: not `true`
    // for a logical, not a quoted string for a char.
    ['a logical whose text does not read', `Class="logical" Encoding="hex"`, sparseText + '0', '<logical, not decoded>'],
    ['a char whose text does not read', `Class="char" Encoding="hex"`, '\n                0', '<char, not decoded>'],
    [
      'an array class MatParser does not model (a function handle)',
      `Class="function_handle" Encoding="hex"`,
      hexText(stream(matrix([arrayFlags(16), dims([1, 1]), varName('')])), 2),
      '<1x1 function_handle, not decoded>',
    ],
  ];

  for (const [what, attrs, text, display] of cases) {
    it(what, () => {
      const tag = `        <P Name="Value" ${attrs}>${text}</P>`;
      const warnings: ParseWarning[] = [];
      const entry = entryOf(tag, warnings);
      expect(entry.displayValue).toBe(display);
      expect(entry.children).toHaveLength(0);
      expect(entry.valueEditable).toBe(false);
      expect(entry.setProperty('Value', '1')).toMatchObject({ error: true });
      expect(writtenValue(entry)).toBe(tag.trim());
      // The ones whose bytes never read are reported, naming the entry; the function
      // handle's stream read fine and only its class is not modelled.
      if (display.includes('function_handle')) {
        expect(warnings).toEqual([]);
      } else {
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatchObject({ code: 'part-unreadable', part: 'v' });
        expect(warnings[0].message).toMatch(/^"v" holds a value stored encoded that could not be read, because /);
      }
    });
  }

  it('none of them displays the number parseFloat reads out of its text', () => {
    for (const [what, attrs, text] of cases) {
      const fromText = String(parseFloat(text.trim()));
      for (const n of subtree(entryOf(`        <P Name="Value" ${attrs}>${text}</P>`))) {
        expect(n.displayValue, what).not.toBe(fromText);
      }
    }
  });

  it('an empty element is a placeholder too', () => {
    const entry = entryOf(`        <P Name="Value" Class="double" Encoding="hex" EncodedLength="0"></P>`);
    expect(entry.displayValue).toBe('<double, not decoded>');
  });
});

describe('an MCOS object whose subsystem is missing is the opaque object it is everywhere else', () => {
  it('shows its class and nothing it cannot know, and is written back as read', () => {
    // A class-17 element with no trailing subsystem: the handle reads, the properties cannot.
    const words = new Uint8Array(24);
    [0xdd000000, 2, 1, 1, 1, 1].forEach((n, i) => words.set(u32le(n), i * 4));
    const handle = matrix([arrayFlags(CLASS.UINT32), dims([6, 1]), varName(''), element(MI.UINT32, words)]);
    const opaque = matrix([
      arrayFlags(17),
      varName(''),
      element(MI.INT8, new TextEncoder().encode('MCOS')),
      element(MI.INT8, new TextEncoder().encode('my.Thing')),
      handle,
    ]);
    const tag = hexElement(stream(opaque), `Class="my.Thing" Encoding="hex"`);
    const entry = entryOf(tag);
    expect([entry.displayValue, entry.className, entry.valueEditable]).toEqual(['<1x1 my.Thing>', 'my.Thing', false]);
    expect(writtenValue(entry)).toBe(tag.trim());
  });
});

describe('no binary dictionary in the repo shows a number read out of hex text', () => {
  // Every compressed-binary .sldd under test/, MATLAB's own and synthesized, and every
  // encoded element in each: no node under its entry may display what parseFloat reads
  // out of the element's text, which is what every one of them used to show (1494 for
  // every MAT stream, since they all open 0001494D).
  const root = fileURLToPath(new URL('./', import.meta.url));
  const files = (function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(join(dir, d.name)) : d.name.endsWith('.sldd') ? [join(dir, d.name)] : [],
    );
  })(root).filter((f) => readFileSync(f).subarray(0, 2).toString('latin1') === 'PK');

  it('the sweep reaches the dictionaries that hold encoded values', () => {
    expect(files.some((f) => f.endsWith('sparse_binary.sldd'))).toBe(true);
  });

  for (const file of files) {
    const chunk = new TextDecoder().decode(unzipSync(new Uint8Array(readFileSync(file)))['data/chunk0.xml'] ?? new Uint8Array());
    const encoded = [...chunk.matchAll(/<Object Class="DD.ENTRY">[\s\S]*?<\/Object>/g)]
      .map((m) => m[0])
      .filter((block) => / Encoding="/.test(block));
    if (encoded.length === 0) {
      continue;
    }
    it(file.slice(root.length), () => {
      const dict: any = ingest(createSession(), new Uint8Array(readFileSync(file)).slice().buffer, { filename: 'x.sldd' });
      const entries = dict.children.flatMap((s: any) => s.children);
      for (const block of encoded) {
        const name = /<P Name="Name" Class="char">([^<]*)<\/P>/.exec(block)![1];
        const entry = entries.find((e: any) => e.name === name);
        expect(entry, name).toBeDefined();
        const numbers = [...block.matchAll(/ Encoding="[^"]*"[^>]*>([^<]*)</g)].map((m) => String(parseFloat(m[1].trim())));
        for (const n of subtree(entry)) {
          expect(numbers, `${name}: ${n.id} shows ${n.displayValue}`).not.toContain(n.displayValue);
        }
      }
    });
  }
});

describe('an MCOS object whose class the subsystem does not name', () => {
  it('is <1x1 object>, read-only, never the bag printed as text', async () => {
    // What McosParser.buildObjectValue answers for one; the dictionary that carried it is
    // Simulink.loadsave.ArrayPlaceholder's ArrayElements, MATLAB's stand-in for a value
    // whose class it could not load. It showed `[object Object]`.
    const NodeRegistry = (await import('../src/datamodel/node/NodeRegistry.js')).default;
    const bag = { _object_class: '', _properties: {} };
    const node: any = NodeRegistry.parseValue(bag, 'ArrayElements', null);
    expect([node.className, node.displayValue, node.valueEditable, node.children.length]).toEqual(['object', '<1x1 object>', false, 0]);
    expect(node.serializeValue()).toBe(bag);
  });
});

describe('the Property Inspector\'s Other group shows an encoded value as what it holds', () => {
  it('its elements, or its summary — never its hex text', async () => {
    const { buildOtherRows } = await import('../src/datamodel/node/piOther.js');
    const env = (bytes: Uint8Array, cls = 'double') => encodedValueOf({ '@_Class': cls, '@_Encoding': 'hex', '@_EncodedLength': String(bytes.length) }, hexText(bytes, 4))!;
    const rows = buildOtherRows(
      {
        Payload: env(SPARSE_2x3),
        Broken: env(SPARSE_2x3.slice(0, 20), 'single'),
      },
      new Set(),
    );
    expect(rows).toEqual([
      { name: 'Payload', value: '<2x3 sparse double>' },
      { name: 'Broken', value: '<single, not decoded>' },
    ]);
  });
});

// ---- Damage MATLAB's own streams can carry -----------------------------------------

/** The bytes of one of MATLAB's hex values in test/fixtures/sparse/sparse_binary.sldd. */
function matlabHex(name: string): { bytes: Uint8Array; cls: string } {
  const file = fileURLToPath(new URL('./fixtures/sparse/sparse_binary.sldd', import.meta.url));
  const chunk = new TextDecoder().decode(unzipSync(new Uint8Array(readFileSync(file)))['data/chunk0.xml']);
  const at = chunk.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  const tag = chunk.slice(chunk.indexOf('<P Name="Value"', at), chunk.indexOf('</P>', chunk.indexOf('<P Name="Value"', at)));
  const digits = tag.slice(tag.indexOf('>') + 1).replace(/\s+/g, '');
  return { bytes: Uint8Array.from(digits.match(/../g)!.map((h) => parseInt(h, 16))), cls: /Class="([^"]+)"/.exec(tag)![1] };
}

const withWord = (bytes: Uint8Array, at: number, word: number): Uint8Array => {
  const out = bytes.slice();
  new DataView(out.buffer).setUint32(at, word >>> 0, true);
  return out;
};

describe('a stream that is framed right and does not decode is a placeholder, and the dictionary still opens', () => {
  // One corrupted value used to make the whole binary dictionary fail to open: ingest
  // threw out of the node builders (here "Cannot read properties of null (reading 'im')",
  // MATLAB's cell c with its sparse element's flags word overwritten), where 1.36.1
  // opened it and a text dictionary's cdata reader catches the same throw.
  const { bytes, cls } = matlabHex('c');
  const damaged = withWord(bytes, 72, 0xffffffff);
  const tag = hexElement(damaged, `Class="${cls}" Encoding="hex" EncodedLength="${damaged.length}"`);

  it('opens, shows the value as not decoded, and says why', () => {
    // The dictionary's own list, which the reader and the node layer both append to (the
    // reader cannot see this failure: the bytes are framed right).
    const warnings: ParseWarning[] = [];
    const xml =
      `${DECL}\n<DataSource FormatVersion="1" MinRelease="R2014a">\n    <Object Class="DD.ENTRY">\n` +
      `        <P Name="Name" Class="char">v</P>\n        <P Name="UUID" Class="char">u</P>\n${tag}\n    </Object>\n</DataSource>`;
    const root: any = createSession().addDataSource('mem://undecodable', parseBinarySlddParts(xml, {}, warnings), { path: 'e.sldd' }, warnings);
    const entry = root.getSection('design').children[0];
    expect([entry.displayValue, entry.children.length, entry.valueEditable]).toEqual(['<1x2 cell, not decoded>', 0, false]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'part-unreadable', part: 'v' });
    expect(warnings[0].message).toMatch(/^"v" holds a value stored encoded that could not be read, because its MAT stream did not decode \(/);
  });

  it('is written back as it was read', () => {
    expect(writtenValue(entryOf(tag))).toBe(tag.trim());
  });

  it('a decode failure is not reported against an entry it did not happen in', () => {
    // The failures are collected per entry; one recorded outside a dictionary's read (a
    // paste builds a node the same way) must not surface in the next dictionary opened.
    const host = entryOf(hexElement(SPARSE_2x3));
    host.parent.parseEntry({ name: 'pasted', metadata: { uuid: 'p' }, value: encodedValueOf({ '@_Class': cls, '@_Encoding': 'hex' }, hexText(damaged, 2)) });
    const warnings: ParseWarning[] = [];
    entryOf(hexElement(SPARSE_2x3), warnings);
    expect(warnings).toEqual([]);
  });

  it('a dimension word no bytes could hold is recorded, not materialized', () => {
    // MATLAB's struct st with its first extent set to 0x7FFFFFFF: the node layer built a
    // row per declared element and ran the heap out, taking the process with it.
    const st = matlabHex('st');
    const huge = withWord(st.bytes, 40, 0x7fffffff);
    const started = Date.now();
    const entry = entryOf(hexElement(huge, `Class="struct" Encoding="hex" EncodedLength="${huge.length}"`));
    expect(Date.now() - started).toBeLessThan(5000);
    expect([entry.displayValue, entry.children.length]).toEqual(['<2147483647x1 struct, not decoded>', 0]);
  });
});

describe('a stream whose subsystem is cut short is a placeholder, never a value with zeros where its values were', () => {
  // MATLAB's pSp is a Simulink.Parameter whose Value is sparse([0 5 0; 0 0 0; 6 0 0]): a
  // 144-byte miMATRIX and a 3168-byte subsystem holding the Value. Only the miMATRIX's
  // size was checked, so a stream cut inside the subsystem decoded into a Parameter whose
  // Value was all zeros, or zeros and a 6, with no warning.
  const { bytes } = matlabHex('pSp');

  it('cut by its EncodedLength', () => {
    for (const length of [1216, 1264]) {
      const warnings: ParseWarning[] = [];
      const tag = `        <P Name="Value" Class="Simulink.Parameter" Encoding="hex" EncodedLength="${length}">${hexText(bytes, 2)}</P>`;
      const entry = entryOf(tag, warnings);
      expect(entry.displayValue, String(length)).toBe('<Simulink.Parameter, not decoded>');
      expect(warnings[0]?.message, String(length)).toContain(`the element at byte 160 of its MAT stream declares 3168 bytes and the stream holds ${length - 168}`);
      expect(writtenValue(entry)).toBe(tag.trim());
    }
  });

  it('cut with its EncodedLength saying so', () => {
    for (let length = 176; length < bytes.length; length += 96) {
      const cut = bytes.slice(0, length);
      const entry = entryOf(hexElement(cut, `Class="Simulink.Parameter" Encoding="hex" EncodedLength="${length}"`));
      expect(entry.displayValue, String(length)).toBe('<Simulink.Parameter, not decoded>');
    }
  });

  it('the whole stream is still MATLAB\'s Parameter', () => {
    const entry = entryOf(hexElement(bytes, `Class="Simulink.Parameter" Encoding="hex" EncodedLength="${bytes.length}"`));
    expect(entry.children.find((c: any) => c.name === 'Value').displayValue).toBe('<3x3 sparse double>');
  });
});

describe('a value read from hex is written back as read, not re-encoded', () => {
  it('a sparse array whose stream MatWriter would write differently', () => {
    // nzmax is capacity: spalloc reserves more than the non-zeros, and a stream that says
    // so is the same value. A writer that re-encoded the decoded array would write nzmax
    // as the count — a different stream — so a no-op save has to replay the element.
    const roomy = withWord(SPARSE_2x3, 28, 12);
    const tag = hexElement(roomy);
    const entry = entryOf(tag);
    expect(entry.displayValue).toBe('<2x3 sparse double>');
    expect(writtenValue(entry)).toBe(tag.trim());
  });
});

describe('an encoded value in an object\'s cell property is written back as read', () => {
  // The raw-bag writer's own encoded arm (DataNode._serializeCellElementXml): an object
  // this package does not model, and a Simulink.Parameter, write their property bags back
  // through it, and without the arm the element went out as `<Element Class="encoded">1494`.
  const body = hexText(SPARSE_2x3, 6);
  const element = `<Element Class="double" Encoding="hex" EncodedLength="${SPARSE_2x3.length}">${body}</Element>`;
  for (const cls of ['my.Thing', 'Simulink.Parameter']) {
    it(cls, () => {
      const tag =
        `        <P Name="Value">\n            <Element Class="${cls}">\n                <P Name="C" Class="cell" Dimension="1*2">\n` +
        `                    ${element}\n                    <Element Class="double">7.0</Element>\n                </P>\n` +
        `            </Element>\n        </P>`;
      const entry = entryOf(tag);
      const xml = serializeEntryToXml(entry);
      expect(xml, cls).toContain(element);
      expect(xml, cls).not.toContain('Class="encoded"');
    });
  }
});

describe('the two reader sites MATLAB has not been seen writing an encoded value at', () => {
  const attrs = `Class="double" Encoding="hex" EncodedLength="${SPARSE_2x3.length}"`;
  const body = hexText(SPARSE_2x3, 4);

  it('a property that also says IsComplex="1" is the stream, not complex text', () => {
    // Asked about before the complex-text arm: an encoded body is a byte stream whatever
    // else the element says.
    const tag =
      `        <P Name="Value" Class="struct">\n            <Element>\n` +
      `                <P Name="f" Class="double" IsComplex="1" ${attrs.replace('Class="double" ', '')}>${body}</P>\n` +
      `            </Element>\n        </P>`;
    const entry = entryOf(tag);
    expect(entry.children.find((c: any) => c.name === 'f').displayValue).toBe('<2x3 sparse double>');
    expect(serializeEntryToXml(entry)).toContain(body);
  });

  it('a saveobj property is the stream, not a number read out of its text', () => {
    const tag =
      `        <P Name="Value">\n            <Element Class="my.Saved">\n` +
      `                <P Source="saveobj" PropertyType="any" ${attrs}>${body}</P>\n            </Element>\n        </P>`;
    const xml = `${DECL}\n<DataSource FormatVersion="1" MinRelease="R2014a">\n    <Object Class="DD.ENTRY">\n        <P Name="Name" Class="char">v</P>\n${tag}\n    </Object>\n</DataSource>`;
    const parts: any = parseBinarySlddParts(xml, {}, []);
    const value = parts.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries[0].value;
    expect(value._elements[0]._properties._saveobj).toEqual(
      encodedValueOf({ '@_Source': 'saveobj', '@_PropertyType': 'any', '@_Class': 'double', '@_Encoding': 'hex', '@_EncodedLength': String(SPARSE_2x3.length) }, body),
    );
  });
});

describe('an encoded value in Architectural Data stays the node that writes its stream back', () => {
  it('is not reclassed as a Constant, and is read-only and written back as read', async () => {
    // A plain variable in a derived entry becomes a ConstantNode (NodeClassMap's
    // wrapDerivedVariable), which is editable as a scalar. An encoded one must not: it is
    // written back from its stream, so an edit could not reach the file.
    const { getSectionMetadata } = await import('../src/datamodel/SectionConstants.js');
    const tag = hexElement(SPARSE_2x3);
    const xml =
      `${DECL}\n<DataSource FormatVersion="1" MinRelease="R2014a">\n    <Object Class="DD.ENTRY">\n` +
      `        <P Name="Name" Class="char">k</P>\n        <P Name="UUID" Class="char">u</P>\n` +
      `        <P Name="Namespace" Class="char">${getSectionMetadata('arch').namespace}</P>\n` +
      `        <P Name="IsDerived" Class="char">1</P>\n${tag}\n    </Object>\n</DataSource>`;
    const root: any = createSession().addDataSource('mem://arch-encoded', parseBinarySlddParts(xml, {}, []), { path: 'a.sldd' });
    const entry = root.getSection('arch').children[0];
    expect([entry.constructor.name, entry.displayValue, entry.valueEditable]).toEqual(['MatlabVariableNode', '<2x3 sparse double>', false]);
    expect(entry.children[0].setProperty('Value', '9')).toMatchObject({ error: true });
    expect(writtenValue(entry)).toBe(tag.trim());
    // And a plain one beside it still becomes a Constant: the exclusion is the stream's.
    const plain = root.getSection('arch').parseEntry({ name: 'k2', metadata: { uuid: 'v', isderived: '1' }, value: 4 });
    expect(plain.constructor.name).toBe('ConstantNode');
  });
});

describe('a value modified under a stream does not write the stream back', () => {
  // DataNode._markModified drops `_encoded` on every node from the one edited up to its
  // entry: a node holding a stream writes it and nothing else, so a stale one would
  // discard the edit on save. Everything under a stream is read-only, so no edit should
  // get there; this is the line behind that, for whatever does.
  it('at the node holding it, and at the entry', () => {
    const body = hexText(SPARSE_2x3, 4);
    const attrs = `Class="double" Encoding="hex" EncodedLength="${SPARSE_2x3.length}"`;
    const struct = entryOf(
      `        <P Name="Value" Class="struct">\n            <Element>\n                <P Name="f" ${attrs}>${body}</P>\n` +
        `                <P Name="g" Class="double">7.0</P>\n            </Element>\n        </P>`,
    );
    const field = struct.children.find((c: any) => c.name === 'f');
    expect(field._encoded).toBeDefined();
    field.children[0]._markModified();
    expect(field._encoded).toBeUndefined();
    expect(serializeEntryToXml(struct)).not.toContain(body);

    const entry = entryOf(hexElement(SPARSE_2x3));
    expect(entry._encoded).toBeDefined();
    entry.children[0]._markModified();
    expect([entry._encoded, entry.status]).toEqual([undefined, 'Modified']);
  });
});

describe('a text dictionary\'s stream of a value XML cannot spell goes into a binary one as hex', () => {
  // MATLAB writes a binary dictionary's value as hex when XML has no spelling for it
  // (MatlabVariableNode.needsHexInBinary): a sparse array, and an MCOS object or a value
  // of a class MatParser does not model (a function handle is one). A text dictionary's
  // cdata holding one of the last two goes in as its own bytes, which are the value.
  const cases: [string, Uint8Array][] = [
    ['a class MatParser does not model (16, a function handle\'s)', matrix([arrayFlags(16), dims([1, 1]), varName('')])],
    ['an MCOS object', matrix([arrayFlags(CLASS.OPAQUE), varName(''), element(MI.INT8, new TextEncoder().encode('MCOS')), element(MI.INT8, new TextEncoder().encode('my.Thing'))])],
  ];
  for (const [what, el] of cases) {
    it(what, async () => {
      const { uuencode } = await import('../src/datamodel/parser/CdataCodec.js');
      const bytes = stream(el);
      const cdata = { _type: 'cdata', _value: uuencode(bytes) };
      const binary: any = ingest(createSession(), new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/sparse/sparse_binary.sldd', import.meta.url)))).slice().buffer, { filename: 'b.sldd' });
      const pasted = binary.getSection('design').parseEntry({ name: 'v', metadata: { uuid: '00000000-0000-4000-9900-000000000001' }, value: cdata });
      const xml = serializeEntryToXml(pasted);
      const m = /<P Name="Value" Class="[^"]*" Encoding="hex" EncodedLength="(\d+)">([^<]*)<\/P>/.exec(xml);
      expect(m, what).not.toBeNull();
      expect(m![2].replace(/\s+/g, ''), what).toBe(hexOf(bytes));
    });
  }
});
