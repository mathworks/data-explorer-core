// Copyright 2026 The MathWorks, Inc.
//
// MATLAB writes a char that holds a control character, a surrogate or a byte order mark as its
// CODES: `Format="decimal"`, a Dimension whatever the shape, and each UTF-16 code unit in
// storage order as a decimal number — char(1) is `Dimension="1*1" Format="decimal">1`. The
// binary reader never asked for the attribute, so it read the body as the char's text: char(1)
// opened as '1', the 2x3x4 char of codes 1:24 as the 60 characters of '1 2 3 … 24' (and so as
// a 1x60), and a save wrote that text back as the value, dropping the Format and the shape.
//
// The ground truth is MATLAB's bytes: the eight Value lines below are copied verbatim from a
// test dictionary R2027a wrote, outside this repository, and custom_object_binary.sldd's
// widget.Ctrl is the fixture's own. Each has to read as the characters its codes are, at its
// shape, and go back out as the line MATLAB wrote.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest } from '../src/index.js';
import { regenerateChunkXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { flatten } from './parity/loadFile.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const bytesAt = (rel: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));
const chunkOf = (zip: Uint8Array) => strFromU8(unzipSync(zip)['data/chunk0.xml']);
const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => from + k);

/** name, MATLAB's Value line, the code units in storage order, MATLAB's size(). */
const MATLAB: [string, string, number[], number[]][] = [
  [
    'varStr3D',
    '<P Name="Value" Class="char" Dimension="2*3*4" Format="decimal">1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24</P>',
    range(1, 24),
    [2, 3, 4],
  ],
  [
    'varStrAscii',
    '<P Name="Value" Class="char" Dimension="1*99" Format="decimal">9 10 13 ' + range(32, 127).join(' ') + '</P>',
    [9, 10, 13, ...range(32, 127)],
    [1, 99],
  ],
  ['varStrBOM', '<P Name="Value" Class="char" Dimension="1*1" Format="decimal">65279</P>', [0xfeff], [1, 1]],
  ['varStrBOM_CR', '<P Name="Value" Class="char" Dimension="1*2" Format="decimal">65279 13</P>', [0xfeff, 13], [1, 2]],
  ['varStrCtrlA', '<P Name="Value" Class="char" Dimension="1*1" Format="decimal">1</P>', [1], [1, 1]],
  ['varStrLeadSurrogate', '<P Name="Value" Class="char" Dimension="1*1" Format="decimal">55348</P>', [0xd834], [1, 1]],
  ['varStrSurrogatePair', '<P Name="Value" Class="char" Dimension="1*2" Format="decimal">55348 56606</P>', [0xd834, 0xdd1e], [1, 2]],
  ['varStrTrailSurrogate', '<P Name="Value" Class="char" Dimension="1*1" Format="decimal">56606</P>', [0xdd1e], [1, 1]],
];

const text = (codes: number[]) => String.fromCharCode(...codes);

/** char_binary.sldd (MATLAB's) with the eight entries added, each with MATLAB's Value line verbatim. */
function dictionaryChunk(): string {
  const xml = chunkOf(bytesAt('./fixtures/char_binary.sldd'));
  const tail = '    <Object Class="DD.Dictionary">';
  expect(xml).toContain(tail);
  const entries = MATLAB.map(
    ([name, line], k) =>
      '    <Object Class="DD.ENTRY">\n' +
      '        <P Name="Name" Class="char">' + name + '</P>\n' +
      '        <P Name="UUID" Class="char">00000000-0000-4000-8000-0000000000' + String(k).padStart(2, '0') + '</P>\n' +
      '        <P Name="Namespace" Class="char">dacaf35e-55a5-454d-a7c1-93db038a210e</P>\n' +
      '        <P Name="LastMod" Class="char">20260917T175257.039945</P>\n' +
      '        <P Name="LastModBy" Class="char">weiwang</P>\n' +
      '        <P Name="IsDerived" Class="char">0</P>\n' +
      '        ' + line + '\n' +
      '    </Object>\n',
  ).join('');
  return xml.replace(tail, entries + tail);
}

function open(host: string, chunk: string, filename: string): { session: ReturnType<typeof createSession>; root: any } {
  const files = unzipSync(bytesAt(host));
  files['data/chunk0.xml'] = strToU8(chunk);
  const session = createSession();
  const root: any = ingest(session, buffer(zipSync(files)), { filename });
  return { session, root };
}

const entryOf = (root: any, name: string) => flatten(root).find((n: any) => n?.isEntry && n.name === name);
const saveOf = (o: { session: any; root: any }) => chunkOf(o.session.serializeSource(o.root.name)!.bytes!);
// A save writes an unedited entry as the bytes it was read from, so each check of what is
// written is made of the writer too: every entry written from the model.
const writtenBoth = (o: { session: any; root: any }): [string, string][] => [
  ['saved', saveOf(o)],
  ['written from the model', regenerateChunkXml(o.root)],
];

describe('a Format="decimal" char MATLAB wrote reads as the characters its codes are', () => {
  for (const [name, , codes, dims] of MATLAB) {
    it(name, () => {
      const n = entryOf(open('./fixtures/char_binary.sldd', dictionaryChunk(), 'char_binary.sldd').root, name);
      expect([n._kind, n._scalarType]).toEqual(['scalar', 'char']);
      // Code unit by code unit: MATLAB's char is UTF-16, so a surrogate pair is two of them.
      const text: string = n._scalarValue;
      expect(Array.from({ length: text.length }, (_, i) => text.charCodeAt(i))).toEqual(codes);
      expect(n.dims).toEqual(dims);
    });
  }

  it('so char(1) no longer shows as the digit 1, and the 2x3x4 is not a 1x60', () => {
    const root = open('./fixtures/char_binary.sldd', dictionaryChunk(), 'char_binary.sldd').root;
    expect(entryOf(root, 'varStrCtrlA').displayValue).not.toBe("'1'");
    expect(entryOf(root, 'varStr3D').displayValue).toBe('<2x3x4 char>');
  });

  it('and so does a property of an object (custom_object_binary.sldd widget.Ctrl)', () => {
    const { root } = open('./fixtures/custom_object_binary.sldd', chunkOf(bytesAt('./fixtures/custom_object_binary.sldd')), 'custom_object_binary.sldd');
    const ctrl = flatten(entryOf(root, 'widget')).find((n: any) => n.name === 'Ctrl');
    expect(ctrl._scalarValue).toBe('\t\n\r\x07\x01');
    expect(ctrl.dims).toEqual([1, 5]);
  });

  it('a body that is not code units is read as the text it is, as before', () => {
    // The guard on the decode: a hand-made Format="decimal" whose body holds anything but
    // numbers a code unit can be would otherwise read as NULs.
    const chunk = dictionaryChunk().replace(MATLAB[4][1], '<P Name="Value" Class="char" Dimension="1*3" Format="decimal">abc</P>');
    const n = entryOf(open('./fixtures/char_binary.sldd', chunk, 'char_binary.sldd').root, 'varStrCtrlA');
    expect(n._scalarValue).toBe('abc');
  });
});

describe('and is written back as MATLAB wrote it', () => {
  for (const edit of ['untouched', 'renamed'] as const) {
    it(`an entry, ${edit}`, () => {
      const o = open('./fixtures/char_binary.sldd', dictionaryChunk(), 'char_binary.sldd');
      if (edit === 'renamed') {
        for (const [name] of MATLAB) {
          expect(entryOf(o.root, name).setProperty('Name', name + '_r')).toBe(true);
        }
      }
      for (const [how, saved] of writtenBoth(o)) {
        for (const [name, line] of MATLAB) {
          const at = saved.indexOf('<P Name="Name" Class="char">' + name + (edit === 'renamed' ? '_r' : '') + '</P>');
          expect(at, `${name}, ${how}`).toBeGreaterThanOrEqual(0);
          const value = saved.slice(saved.indexOf('<P Name="Value"', at), saved.indexOf('</Object>', at)).trimEnd();
          expect(value, `${name}, ${how}`).toBe(line);
        }
      }
    });
  }

  const HOST = './fixtures/custom_object_binary.sldd';
  const CTRL = '                <P Name="Ctrl" Class="char" Dimension="1*5" Format="decimal">9 10 13 7 1</P>';
  // MATLAB's plain spellings beside it, which have to stay plain: a tab and a newline are
  // characters MATLAB writes as themselves.
  const PLAIN = ['                <P Name="Tab" Class="char">a\tb</P>', '                <P Name="Lf" Class="char">a\nb</P>'];
  for (const edit of ['untouched', 'with another property edited'] as const) {
    it(`an object property, ${edit}`, () => {
      const chunk = chunkOf(bytesAt(HOST));
      for (const line of [CTRL, ...PLAIN]) {
        expect(chunk).toContain(line);
      }
      const o = open(HOST, chunk, 'custom_object_binary.sldd');
      if (edit !== 'untouched') {
        expect(entryOf(o.root, 'widget').children.find((c: any) => c.name === 'Scalar').setProperty('Value', '2.5')).toBe(true);
      }
      for (const [how, saved] of writtenBoth(o)) {
        for (const line of [CTRL, ...PLAIN]) {
          expect(saved, `${line}, ${how}`).toContain(line);
        }
      }
    });
  }

  it('in a cell and in a struct field, at any shape', () => {
    // No file MATLAB wrote holds one there, so the reader is the ground truth: MATLAB's
    // spelling at a <P>, at the two other sites a char is read, with a shaped one each.
    const CELL =
      '                <P Name="Cells" Class="cell" Dimension="1*3">\n' +
      '                    <Element Class="char" Dimension="1*1" Format="decimal">1</Element>\n' +
      '                    <Element Class="char" Dimension="2*3*4" Format="decimal">' + range(1, 24).join(' ') + '</Element>\n' +
      '                    <Element Class="char">two</Element>\n' +
      '                </P>';
    const FIELDS =
      '                                <P Name="leaf" Class="double">7.0</P>\n' +
      '                                <P Name="bom" Class="char" Dimension="1*2" Format="decimal">65279 13</P>\n' +
      '                                <P Name="grid" Class="char" Dimension="2*2" Format="decimal">1 2 3 4</P>';
    const chunk = chunkOf(bytesAt(HOST))
      .replace(/ {16}<P Name="Cells" Class="cell" Dimension="1\*3">[\s\S]*?\n {16}<\/P>/, CELL)
      .replace('                                <P Name="leaf" Class="double">7.0</P>', FIELDS);
    expect(chunk).toContain(CELL);
    expect(chunk).toContain(FIELDS);
    const o = open(HOST, chunk, 'custom_object_binary.sldd');
    const widget = entryOf(o.root, 'widget');
    const cells = widget.children.find((c: any) => c.name === 'Cells');
    expect(cells.children.map((c: any) => [c._scalarValue, c.dims])).toEqual([
      ['\x01', [1, 1]],
      [text(range(1, 24)), [2, 3, 4]],
      ['two', [1, 3]],
    ]);
    const inner = flatten(widget).find((n: any) => n.name === 'inner');
    expect(inner.children.map((c: any) => [c.name, c._scalarValue, c.dims])).toEqual([
      ['leaf', 7, [1, 1]],
      ['bom', '﻿\r', [1, 2]],
      ['grid', text([1, 2, 3, 4]), [2, 2]],
    ]);
    for (const [how, saved] of writtenBoth(o)) {
      expect(saved, how).toContain(CELL);
      expect(saved, how).toContain(FIELDS);
    }
  });
});
