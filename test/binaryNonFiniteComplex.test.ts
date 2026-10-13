// Copyright 2026 The MathWorks, Inc.
//
// A binary dictionary's complex value with an Inf or NaN part reads as the numbers it holds,
// the way one with finite parts does.
//
// MatlabVariableNode.parseCdata read complex text as numbers only when every character was
// a digit, `.`, `e`, `E`, a sign, `i` or a space. Any `Inf` or `NaN` sent the whole value
// to the fallback for text it cannot read, a quoted char. So MATLAB's own complex_binary.sldd
// opened with pNonFinite, [complex(Inf,-Inf) complex(NaN,1) complex(1,NaN) complex(-Inf,2)],
// as the text `'Inf-Infi NaN+1.0i 1.0NaNi -Inf+2.0i'`, and pMixedNF, [1+2i NaN 3-4i], as
// `'1.0+2.0i NaN+0.0i 3.0-4.0i'`: no element rows, class char. And since #82 an element of a
// complex array takes `1+Infi`, so typing one into a binary dictionary, saving and opening
// the file again turned the value into text: `'1.0+Infi 2.5-3.5i'`.
//
// The spellings are MATLAB's, as it writes them into that file (pNonFinite): `Inf` and
// `-Inf` for either part, `NaN` for a real part, and an imaginary NaN unsigned, `1.0NaNi`,
// which this package's writer signs, `1.0+NaNi` (XmlUtils.formatComplexBodyXml). The value
// is the one MATLAB wrote, which the text twin complex.sldd holds as its MAT stream.
// MATLAB's own reader (R2027a) does not read `1.0NaNi` back as that value
// (complex_binary_sldd.truth.json, and test/complexMcosFixtures.test.ts pins it).
//
// What a save writes is unchanged: complex text nobody edited is written back from the text
// it was read from, as it was when the reader showed it as a char.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { regenerateChunkXml, serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import { parseComplexNum } from '../src/datamodel/parser/XmlUtils.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const fixture = (name: string): ArrayBuffer => {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/mcos/${name}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
};
const chunkOf = (zip: Uint8Array): string => new TextDecoder().decode(unzipSync(zip)['data/chunk0.xml']);

const BINARY = 'complex_binary.sldd';
const TEXT = 'complex.sldd';

function open(file: string, session = createSession()): any {
  return ingest(session, fixture(file), { filename: file });
}

function nodeAt(root: any, path: string[]): any {
  let node = root.getSection('design');
  for (const name of path) {
    node = node?.children.find((c: any) => c.name === name);
  }
  expect(node, path.join('/')).toBeDefined();
  return node;
}

/** One element's two parts, exactly: NaN is NaN and -0 is -0. */
function parts(text: string): [number, number] {
  const pair = parseComplexNum(text);
  expect(pair, text).not.toBeNull();
  return [Number(pair!.re), Number(pair!.im)];
}

/** A complex array's elements as numbers, in its rows' order, and its class. */
function numbersOf(node: any): { className: string; elements: [number, number][] } {
  expect(node.children.length, node.id).toBeGreaterThan(0);
  for (const el of node.children) {
    expect(el._scalarType, el.id).toBe('complex');
  }
  return { className: node.className, elements: node.children.map((el: any) => parts(el.displayValue)) };
}

/** One entry's `<Object>` block, found by its Name. */
function entryBlock(xml: string, name: string): string {
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(at, name).toBeGreaterThan(-1);
  const from = xml.lastIndexOf('<Object ', at);
  return xml.slice(from, xml.indexOf('</Object>', at));
}

const complexTags = (xml: string): string[] =>
  [...xml.matchAll(/<(P|Element)\b[^>]*IsComplex="1"[^>]*(?:\/>|>[^<]*<\/\1>)/g)].map((m) => m[0]);

const NON_FINITE: [name: string, value: [number, number][]][] = [
  ['pNonFinite', [[Infinity, -Infinity], [NaN, 1], [1, NaN], [-Infinity, 2]]],
  ['pMixedNF', [[1, 2], [NaN, 0], [3, -4]]],
];

describe("MATLAB's non-finite complex text reads as the numbers MATLAB wrote", () => {
  for (const [name, value] of NON_FINITE) {
    it(`${BINARY}: ${name}`, () => {
      const param = nodeAt(open(BINARY), [name]);
      expect(param.children.map((c: any) => c.name), name).toEqual(['Value']);
      expect(numbersOf(param.children[0])).toEqual({ className: 'double', elements: value });
    });

    it(`${BINARY}: ${name} holds what its text twin holds`, () => {
      expect(numbersOf(nodeAt(open(BINARY), [name, 'Value']))).toEqual(numbersOf(nodeAt(open(TEXT), [name, 'Value'])));
    });
  }

  it('shows each element as this package spells it, without MATLAB\'s `.0`', () => {
    const value = nodeAt(open(BINARY), ['pNonFinite', 'Value']);
    expect(value.children.map((el: any) => el.displayValue)).toEqual(['Inf-Infi', 'NaN+1i', '1NaNi', '-Inf+2i']);
    expect(value.displayValue).toBe('[Inf-Infi NaN+1i 1NaNi -Inf+2i]');
    expect(nodeAt(open(BINARY), ['pMixedNF']).displayValue).toBe('[1+2i NaN+0i 3-4i]');
  });

  it('as an entry of its own, and its element signed as this package writes it', () => {
    // MATLAB's body for pNonFinite, as an entry's value rather than a Parameter's, once as
    // MATLAB writes it and once with the NaN imaginary part signed, as a save writes it.
    for (const body of ['Inf-Infi NaN+1.0i 1.0NaNi -Inf+2.0i', 'Inf-Infi NaN+1.0i 1.0+NaNi -Inf+2.0i']) {
      const tag = `<P Name="Value" Class="double" IsComplex="1" Dimension="1*4">${body}</P>`;
      const xml =
        '<?xml version="1.0" encoding="UTF-8"?>\n<DataSource FormatVersion="1" MinRelease="R2014a">\n    <Object Class="DD.ENTRY">\n' +
        `        <P Name="Name" Class="char">zNonFinite</P>\n        ${tag}\n    </Object>\n</DataSource>`;
      const root: any = createSession().addDataSource('mem://nonFinite', parseBinarySlddParts(xml, {}), { path: 'q.sldd' });
      const entry = root.getSection('design').children[0];
      expect(numbersOf(entry), body).toEqual({ className: 'double', elements: NON_FINITE[0][1] });
      expect(entry.children.map((el: any) => el.displayValue), body).toEqual(['Inf-Infi', 'NaN+1i', '1NaNi', '-Inf+2i']);
    }
  });

  it('text that is no complex number is still shown as the text it is', () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<DataSource FormatVersion="1" MinRelease="R2014a">\n    <Object Class="DD.ENTRY">\n' +
      '        <P Name="Name" Class="char">zText</P>\n        <P Name="Value" Class="double" IsComplex="1" Dimension="1*2">Inf NaN</P>\n    </Object>\n</DataSource>';
    const entry: any = createSession().addDataSource('mem://notComplex', parseBinarySlddParts(xml, {}), { path: 'q.sldd' }).getSection('design').children[0];
    expect([entry.displayValue, entry.className, entry.children.length]).toEqual(["'Inf NaN'", 'char', 0]);
  });
});

describe('a save that edits nothing writes them as it did', () => {
  it('writes each non-finite complex value from the text it was read from', () => {
    const session = createSession();
    const root = open(BINARY, session);
    const saved = chunkOf(session.serializeSource(root.name).bytes);
    // Written from the model, as the save wrote them while the reader showed them as chars:
    // MATLAB's text, the NaN imaginary part signed (test/complexBinaryWriteBack.test.ts).
    const regenerated = regenerateChunkXml(root);
    expect(complexTags(entryBlock(regenerated, 'pNonFinite'))).toEqual([
      '<P Name="Value" Class="double" IsComplex="1" Dimension="1*4">Inf-Infi NaN+1.0i 1.0+NaNi -Inf+2.0i</P>',
    ]);
    expect(complexTags(entryBlock(regenerated, 'pMixedNF'))).toEqual([
      '<P Name="Value" Class="double" IsComplex="1" Dimension="1*3">1.0+2.0i NaN+0.0i 3.0-4.0i</P>',
    ]);
    // The save itself writes each unedited entry as the bytes it was read from: MATLAB's
    // own unsigned `1.0NaNi` included.
    expect(complexTags(entryBlock(saved, 'pNonFinite'))).toEqual([
      '<P Name="Value" Class="double" IsComplex="1" Dimension="1*4">Inf-Infi NaN+1.0i 1.0NaNi -Inf+2.0i</P>',
    ]);
    expect(complexTags(entryBlock(saved, 'pMixedNF'))).toEqual([
      '<P Name="Value" Class="double" IsComplex="1" Dimension="1*3">1.0+2.0i NaN+0.0i 3.0-4.0i</P>',
    ]);
    // And a rename, which leaves the value as it was, written from the model.
    const entry = nodeAt(root, ['pNonFinite']);
    expect(entry.setProperty('Name', 'pNonFiniteRenamed')).toBe(true);
    expect(complexTags(serializeEntryToXml(entry))).toEqual(complexTags(entryBlock(regenerated, 'pNonFinite')));
  });
});

/**
 * The package with every entry written from the model, opened again: a save writes an
 * unedited entry as the bytes it was read from, so this is how the writers are asked for the
 * entries nobody edited.
 */
function regenerateAndReopen(root: any): any {
  const bytes = zipSync({ ...root._zipMetadata, 'data/chunk0.xml': new TextEncoder().encode(regenerateChunkXml(root)) });
  return ingest(createSession(), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { filename: root.name });
}

/** What a save writes, opened again in a session of its own. */
function saveAndReopen(session: any, root: any): any {
  const saved = session.serializeSource(root.name);
  return ingest(createSession(), saved.bytes.buffer.slice(saved.bytes.byteOffset, saved.bytes.byteOffset + saved.bytes.byteLength), {
    filename: root.name,
  });
}

describe('a non-finite part typed into a binary dictionary reopens as a number', () => {
  // The case that found this: `1+Infi` typed into pSingleCol(1), saved, reopened as
  // `'1.0+Infi 2.5-3.5i'`. And the same in an entry's own array, a Parameter's double one
  // and an int16 one, whose parts are integers and never Inf or NaN (int16(Inf) is 32767).
  const TYPED: [typed: string, re: number, im: number][] = [
    ['1+Infi', 1, Infinity],
    ['Inf+2i', Infinity, 2],
    ['-Inf-Infi', -Infinity, -Infinity],
    ['NaN-1i', NaN, -1],
    ['1+NaNi', 1, NaN],
    ['NaN+NaNi', NaN, NaN],
  ];
  const ARRAYS: [path: string[], cls: string][] = [
    [['pSingleCol', 'Value'], 'single'],
    [['zRow'], 'double'],
    [['pRow', 'Value'], 'double'],
    [['pInt16Row', 'Value'], 'int16'],
  ];
  const int16 = (x: number) => (Number.isNaN(x) ? 0 : x === Infinity ? 32767 : x === -Infinity ? -32768 : x);

  for (const [path, cls] of ARRAYS) {
    it(`${path.join('.')} (${cls})`, () => {
      for (const [typed, re, im] of TYPED) {
        const session = createSession();
        const root = open(BINARY, session);
        const array = nodeAt(root, path);
        const before = numbersOf(array);
        session.setActive(root, array.children[0]);
        expect(session.editProperty(array.children[0].id, 'Value', typed), typed).toBe(true);
        const want: [number, number] = cls === 'int16' ? [int16(re), int16(im)] : [re, im];
        const reopened = nodeAt(saveAndReopen(session, root), path);
        expect(numbersOf(reopened), `${path.join('.')} = ${typed}, reopened`).toEqual({
          className: cls,
          elements: [want, ...before.elements.slice(1)],
        });
      }
    });
  }

  it('and an edit undone reopens as an untouched save does', () => {
    const session = createSession();
    const root = open(BINARY, session);
    const fresh = createSession();
    const untouched = saveAndReopen(fresh, open(BINARY, fresh));
    for (const [name] of NON_FINITE) {
      const value = nodeAt(root, [name, 'Value']);
      for (const el of value.children) {
        session.setActive(root, el);
        expect(session.editProperty(el.id, 'Value', '5'), el.id).toBe(true);
        session.undo();
      }
    }
    const reopened = saveAndReopen(session, root);
    // And each written from the model, the untouched one too.
    const regenerated = regenerateAndReopen(root);
    const regeneratedUntouched = regenerateAndReopen(open(BINARY, createSession()));
    for (const [name, value] of NON_FINITE) {
      const rows = (r: any) => nodeAt(r, [name, 'Value']).children.map((el: any) => el.displayValue);
      expect(rows(reopened), name).toEqual(rows(untouched));
      expect(numbersOf(nodeAt(reopened, [name, 'Value'])).elements, name).toEqual(value);
      expect(rows(regenerated), `${name}, written from the model`).toEqual(rows(untouched));
      expect(rows(regeneratedUntouched), `${name}, untouched, written from the model`).toEqual(rows(untouched));
    }
  });
});
