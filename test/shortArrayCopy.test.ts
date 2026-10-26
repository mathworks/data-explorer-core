// Copyright 2026 The MathWorks, Inc.
//
// B-26 (group H). A .mat file's struct array or cell whose bytes hold fewer elements than it
// declares (a 1x3 struct holding 2, a 1x3 cell holding 1) opens with a warning, `"v" declares 3
// element(s) and only 2 could be read.`, and a row for each element held. Its copy is the
// declared size beside only the elements held: a struct bag `_dimensions [1,3]` with 2
// `_elements`, in a binary dictionary `Class="struct" Dimension="1*3"` with two `<Element>`s;
// an N-D one, the stream MatWriter writes for it. The maintainer's group F ruling (group 2:
// measure MATLAB first; theme 1: a save the writer cannot spell is refused rather than written
// wrong) asks whether MATLAB reads that copy as the padded value core shows, and refuses the
// copy if not.
//
// MATLAB R2027a was asked (test/parity/matlab/probe_short_array_copy_readback.m, the copies
// written by short_array_copy_readback.mjs). It reads each copy of an array holding SOME of its
// elements back at its declared size, its field names kept, the elements held as they are and
// the rest `[]`: in a text and in a binary dictionary, at rank 2 and N-D, for a struct cut inside
// an element too. Those copies are kept, and pinned here. It does not read back the copy of a
// rank-2 array holding NONE of them: a struct array's bag names no field (its field names come
// from its element rows), and MATLAB reads a 1x3 struct with no fields in both formats; a cell's
// is `Dimension="0*0"` in a binary dictionary, which MATLAB reads as a 0x0 cell. Those are
// refused, finally, as a value the reader did not decode is (F1-10): its copy, its save, and the
// copy or the save of what holds it, naming the entry and the path. `load` refuses every one of
// the damaged files; core opens each with its warning, as before.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { uuencode } from '../src/datamodel/parser/CdataCodec.js';
import { encodeMatStream } from '../src/datamodel/parser/MatWriter.js';
import { MatBudgetError, createSession, ingest } from '../src/index.js';
import * as matBytes from './tools/matBytes.js';
import { CLASS, cellVar, matFile, numericVar, structVar } from './tools/matBytes.js';
import { BINARY, TEXT, copyOf, pasteSaveReopen, sparseFixture, thrownBy } from './tools/pasteVenues.js';
import { shortArrayCopyReadback } from './parity/matlab/short_array_copy_readback.mjs';

const testFile = (path: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(`./${path}`, import.meta.url))));
const arrayBufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const one = (n: number) => numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [n] });
const opened = (...variables: Uint8Array[]): any => createSession().addMatSource('v.mat', matFile(variables));

/** What `f` threw, as a host meets it: its class, whether it is final, its reason, entry and path, and its message. */
function thrown(f: () => unknown): unknown[] {
  const [e] = thrownBy(f);
  const b = e as MatBudgetError | null;
  return [e?.name, e instanceof MatBudgetError, b?.reason, b?.entry, b?.at, e?.message];
}

/** The refusal of a write of `path`, `what`, in entry `entry`. */
const refused = (entry: string, path: string, what: string) => [
  'MatBudgetError',
  true,
  'not-decoded',
  entry,
  path,
  `Cannot write "${entry}": ${path} is ${what}, so there is no value of it to write. Nothing was written.`,
];

type Item = { class: string; size: number[]; value?: number | number[] };
type Read = { class?: string; size?: number[]; fields?: string[]; elements?: (Item | Record<string, Item>)[]; error?: string };
type Row = { id: string; full: boolean; mat: string; file: string; format: string; fragment: string; loaded: Read; matlab: Read };

/** Each case's declared size and fields, and the elements its bytes hold. */
const HELD: Record<string, { cls: 'struct' | 'cell'; size: number[]; fields?: string[]; held: (number | Record<string, number>)[] }> = {
  struct_short: { cls: 'struct', size: [1, 3], fields: ['a'], held: [{ a: 1 }, { a: 2 }] },
  struct_none: { cls: 'struct', size: [1, 3], fields: ['a'], held: [] },
  struct_partial: { cls: 'struct', size: [2, 2], fields: ['a', 'b'], held: [{ a: 1, b: 2 }, { a: 3, b: 4 }, { a: 5 }] },
  cell_short: { cls: 'cell', size: [1, 3], held: [7] },
  cell_none: { cls: 'cell', size: [1, 3], held: [] },
  cell_2x2_short: { cls: 'cell', size: [2, 2], held: [7, 8, 9] },
  struct_nd_short: { cls: 'struct', size: [1, 1, 3], fields: ['a'], held: [{ a: 1 }, { a: 2 }] },
  struct_nd_none: { cls: 'struct', size: [1, 1, 3], fields: ['a'], held: [] },
  cell_nd_short: { cls: 'cell', size: [1, 1, 3], held: [7] },
  cell_nd_none: { cls: 'cell', size: [1, 1, 3], held: [] },
  struct_full: { cls: 'struct', size: [1, 3], fields: ['a'], held: [{ a: 1 }, { a: 2 }, { a: 3 }] },
  cell_full: { cls: 'cell', size: [1, 3], held: [7, 8, 9] },
};

/**
 * The padded value of a case, as the probe describes a value: its declared size and fields, the
 * elements held as they are and every other element, or field of one, `[]`.
 */
function padded(id: string): Read {
  const { cls, size, fields, held } = HELD[id];
  const item = (n: number | undefined): Item => (n === undefined ? { class: 'double', size: [0, 0], value: [] } : { class: 'double', size: [1, 1], value: n });
  const count = size.reduce((a, b) => a * b, 1);
  const elements = Array.from({ length: count }, (_, k) => {
    const e = held[k];
    if (cls === 'cell') {
      return item(e as number | undefined);
    }
    return Object.fromEntries(fields!.map((f) => [f, item((e as Record<string, number> | undefined)?.[f])]));
  });
  return cls === 'cell' ? { class: 'cell', size, elements } : { class: 'struct', size, fields, elements };
}

const TRUTH: { release: string; cases: Row[] } = JSON.parse(readFileSync(fileURLToPath(new URL('./parity/matlab/short_array_copy_readback.truth.json', import.meta.url)), 'utf8'));
const { files, cases } = shortArrayCopyReadback({ createSession, ingest, uuencode, encodeMatStream }, matBytes, (rel: string) => testFile('fixtures/' + rel));
/** The rows that the copy of a rank-2 array holding none of its elements gave. */
const HELD_NONE = ['struct_none', 'cell_none'];

describe('MATLAB reads the copy of a struct array or a cell holding fewer elements than it declares as the padded value, unless it holds none (B-26)', () => {
  it('each copy is the one MATLAB was asked about: a control as it is copied, each other as core copied it', () => {
    expect(TRUTH.release).toBe('2027a');
    expect(cases.length).toBe(24);
    expect(cases.map((c: any) => [c.file, c.fragment])).toEqual(TRUTH.cases.map((c) => [c.file, c.fragment]));
  });

  it('load refuses each damaged file, and reads each control as its padded value, which is the value', () => {
    for (const c of TRUTH.cases) {
      expect([c.file, c.loaded], c.file).toEqual([c.file, c.full ? padded(c.id) : { error: `Unable to open file "${c.mat}".` }]);
    }
  });

  it('every copy reads back as the padded value but a rank-2 struct array\'s holding none, and a rank-2 cell\'s holding none in a binary dictionary', () => {
    const differs = TRUTH.cases.filter((c) => JSON.stringify(c.matlab) !== JSON.stringify(padded(c.id)));
    expect(differs.map((c) => c.file)).toEqual(['struct_none_text.sldd', 'struct_none_binary.sldd', 'cell_none_binary.sldd']);
    // The struct's copy names no field: a 1x3 struct with none, in both formats. The cell's is
    // `Dimension="0*0"` in a binary dictionary: a 0x0 cell. In a text one it is the padded value.
    expect(differs[0].fragment).toBe('{"_array_type":"Struct","_dimensions":[1,3],"_elements":[],"_fields":[],"_mw_element_type":"MATLABArray"}');
    expect(differs.map((c) => c.matlab)).toEqual([
      { class: 'struct', size: [1, 3], fields: [], elements: [{}, {}, {}] },
      { class: 'struct', size: [1, 3], fields: [], elements: [{}, {}, {}] },
      { class: 'cell', size: [0, 0], elements: [] },
    ]);
    expect(differs[2].fragment).toBe('<P Name="Value" Class="cell" Dimension="0*0"/>');
    // An N-D one holding none is copied as its stream, which MatWriter writes padded: read back
    // as the padded value, field names and all.
    expect(TRUTH.cases.filter((c) => c.id.endsWith('nd_none')).map((c) => c.fragment.startsWith('{"_type":"cdata"') || c.fragment.includes('Dimension="1*1*3"'))).toEqual([true, true, true, true]);
  });

  it('so each such .mat value is copied as MATLAB was asked about it, but the two holding none, which are refused', () => {
    for (const c of cases.filter((r: any) => r.format === 'text')) {
      const v: any = createSession().addMatSource(c.mat, arrayBufferOf(files[c.mat])).children[0];
      if (HELD_NONE.includes(c.id)) {
        const what = c.id === 'cell_none' ? 'a 1x3 cell none of whose 3 elements could be read' : 'a 1x3 struct none of whose 3 elements could be read';
        expect(thrown(() => v.serialize()), c.id).toEqual(refused('v', 'v', what));
      } else {
        expect(JSON.stringify(copyOf(v)), c.id).toBe(c.fragment);
      }
    }
  });
});

describe('a .mat struct array or cell holding none of the elements it declares (B-26)', () => {
  const cellNone = (name: string) => cellVar(name, [], [1, 3]);
  const structNone = (name: string) => structVar(name, ['a'], [], [1, 3]);
  const NONE_CELL = 'a 1x3 cell none of whose 3 elements could be read';
  const NONE_STRUCT = 'a 1x3 struct none of whose 3 elements could be read';

  it('opens as before, with the reader\'s warning, and its copy is refused, naming it; nothing is pasted', () => {
    const mat = opened(cellNone('c'), structNone('s'), numericVar({ name: 'ok', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [5] }));
    const [c, s, ok] = mat.children;
    expect([c.displayValue, c.children.length, s.displayValue, s.children.length]).toEqual(['{}', 0, '<1x3 struct>', 0]);
    expect(mat.warnings.map((w: any) => w.message)).toEqual(['"c" declares 3 cell(s) and only 0 could be read.', '"s" declares 3 element(s) and only 0 could be read.']);
    expect(thrown(() => c.serialize())).toEqual(refused('c', 'c', NONE_CELL));
    expect(thrown(() => s.serialize())).toEqual(refused('s', 's', NONE_STRUCT));
    // A value beside them copies as before.
    expect(copyOf(ok)).toBe(5);
  });

  it('held in a cell or a struct, refuses the copy of what holds it, at its own path', () => {
    const [c, s] = opened(cellVar('c', [one(7), cellNone('')], [1, 2]), structVar('s', ['f', 'g'], [{ f: structNone(''), g: one(2) }])).children;
    expect(c.displayValue).toBe('{7, {}}');
    expect(thrown(() => c.serialize())).toEqual(refused('c', 'c{2}', NONE_CELL));
    expect(thrown(() => s.serialize())).toEqual(refused('s', 's.f', NONE_STRUCT));
  });

  it('read out of a text dictionary\'s value and pasted into a binary one, is refused at the save, not written as 0*0 or a struct of no field', () => {
    // A text dictionary holds such a value as the cdata of its stream; copied, it is that cdata,
    // and a binary dictionary writes the value it decodes to as XML: a 1x3 cell holding none was
    // `Dimension="0*0"` (a 0x0 cell), and a 1x3 struct holding none `Dimension="1*3"` with no
    // `<Element>` (a 1x3 struct with no field), each saved with nothing to say so.
    const PREAMBLE = [0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00];
    const cdataOf = (el: Uint8Array) => ({ _type: 'cdata', _value: uuencode(Uint8Array.from([...PREAMBLE, ...el])) });
    const cases: [Uint8Array, string, string][] = [
      [cellNone(''), 'pasted', NONE_CELL],
      [structNone(''), 'pasted', NONE_STRUCT],
      [cellVar('', [one(7), cellNone('')], [1, 2]), 'pasted{2}', NONE_CELL],
      [cellVar('', [one(7), structNone('')], [1, 2]), 'pasted{2}', NONE_STRUCT],
    ];
    for (const [el, path, what] of cases) {
      const session = createSession();
      const root: any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
      const design = root.getSection('design');
      design.parseEntry({ name: 'pasted', metadata: { ...design.children[0].metadata, uuid: '00000000-0000-4000-eb26-000000000001' }, value: cdataOf(el) });
      expect(thrown(() => session.serializeSource(root.name)), path).toEqual(refused('pasted', path, what));
      // In a text dictionary it is its own cdata, saved as it was read.
      const { entry } = pasteSaveReopen(TEXT, cdataOf(el));
      expect((copyOf(entry) as any)._value, path).toBe(cdataOf(el)._value);
    }
  });

  it('1x1, a cell holding none of its one element is refused too, named as that, as a copy, held in a cell, and pasted into a binary dictionary', () => {
    // Its copy was `_dimensions [1,1]` with no `_elements`, and its XML `Class="cell"
    // Dimension="0*0"`, the spelling MATLAB reads as a 0x0 cell (cell_none_binary.sldd above).
    const ONE_CELL = 'a 1x1 cell whose one element could not be read';
    const mat = opened(cellVar('c', [], [1, 1]), cellVar('h', [one(7), cellVar('', [], [1, 1])], [1, 2]));
    const [c, h] = mat.children;
    expect([c.displayValue, c.children.length, h.displayValue]).toEqual(['{}', 0, '{7, {}}']);
    expect(mat.warnings.map((w: any) => w.message)).toEqual(['"c" declares 1 cell(s) and only 0 could be read.', '"h{2}" declares 1 cell(s) and only 0 could be read.']);
    expect(thrown(() => c.serialize())).toEqual(refused('c', 'c', ONE_CELL));
    expect(thrown(() => h.serialize())).toEqual(refused('h', 'h{2}', ONE_CELL));
    // A text dictionary's cdata of it, pasted into a binary one: refused at the save.
    const PREAMBLE = [0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00];
    const session = createSession();
    const root: any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
    const design = root.getSection('design');
    design.parseEntry({ name: 'pasted', metadata: { ...design.children[0].metadata, uuid: '00000000-0000-4000-eb26-000000000003' }, value: { _type: 'cdata', _value: uuencode(Uint8Array.from([...PREAMBLE, ...cellVar('', [], [1, 1])])) } });
    expect(thrown(() => session.serializeSource(root.name))).toEqual(refused('pasted', 'pasted', ONE_CELL));
  });

  it('control: a cell declaring no element (0x0, 1x0, 0x3) holds all it declares, so it copies and saves as before, alone, in a cell and in a struct', () => {
    // An empty cell is not one holding none of the elements it declares: it declares none. It
    // opens with no warning, copies as its empty bag, and a binary dictionary writes it with its
    // extents, as MATLAB writes a shaped empty cell (emptyCellEntry.test.ts).
    const DIMS = [[0, 0], [1, 0], [0, 3]];
    // A cell of an empty shape but 0x0 is shown as MATLAB makes it (the D12 ruling).
    const SHOWN = ['{}', 'cell(1,0)', 'cell(0,3)'];
    const empty = (name: string, k: number) => cellVar(name, [], DIMS[k]);
    const bag = (dims: number[]) => ({ _array_type: 'Cell', _dimensions: dims, _elements: [], _mw_element_type: 'MATLABArray' });
    const inCell = (name: string) => cellVar(name, [one(7), empty('', 0), empty('', 1), empty('', 2)], [1, 4]);
    const inStruct = (name: string) => structVar(name, ['a', 'b', 'c'], [{ a: empty('', 0), b: empty('', 1), c: empty('', 2) }]);
    const mat = opened(empty('c0', 0), empty('c1', 1), empty('c3', 2), inCell('h'), inStruct('s'));
    expect(mat.warnings).toBeUndefined();
    const [c0, c1, c3, h, s] = mat.children;
    expect([c0, c1, c3, h].map((v: any) => v.displayValue)).toEqual([...SHOWN, '{7, {}, cell(1,0), cell(0,3)}']);
    expect([c0, c1, c3].map(copyOf)).toEqual(DIMS.map(bag));
    expect(copyOf(h)).toEqual({ _array_type: 'Cell', _dimensions: [1, 4], _elements: [7, ...DIMS.map(bag)], _mw_element_type: 'MATLABArray' });
    expect(copyOf(s)).toEqual({ _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ a: bag([0, 0]), b: bag([1, 0]), c: bag([0, 3]) }], _fields: ['a', 'b', 'c'], _mw_element_type: 'MATLABArray' });
    // MATLAB's own empty cells, in a file it wrote, copy as their bags too.
    const disp: any = createSession().addMatSource('dispcat.mat', arrayBufferOf(testFile('fixtures/display/dispcat.mat')));
    expect(['dx_cell_0x0', 'dx_cell_1x0', 'dx_cell_0x3'].map((n) => copyOf(disp.children.find((v: any) => v.name === n)))).toEqual(DIMS.map(bag));
    // A text dictionary's cdata of each, pasted into a binary one, is saved with its extents, and
    // the saved file reopens as it.
    const PREAMBLE = [0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00];
    const cdataOf = (el: Uint8Array) => ({ _type: 'cdata', _value: uuencode(Uint8Array.from([...PREAMBLE, ...el])) });
    const cases: [Uint8Array, string, string, string[]][] = [
      [empty('', 0), '<P Name="Value" Class="cell" Dimension="0*0"/>', SHOWN[0], []],
      [empty('', 1), '<P Name="Value" Class="cell" Dimension="1*0"/>', SHOWN[1], []],
      [empty('', 2), '<P Name="Value" Class="cell" Dimension="0*3"/>', SHOWN[2], []],
      [
        inCell(''),
        '<P Name="Value" Class="cell" Dimension="1*4"> <Element Class="double">7.0</Element> <Element Class="cell" Dimension="0*0"/> <Element Class="cell" Dimension="1*0"/> <Element Class="cell" Dimension="0*3"/> </P>',
        '{7, {}, cell(1,0), cell(0,3)}',
        ['7', ...SHOWN],
      ],
      [
        inStruct(''),
        '<P Name="Value" Class="struct"> <Element> <P Name="a" Class="cell" Dimension="0*0"/> <P Name="b" Class="cell" Dimension="1*0"/> <P Name="c" Class="cell" Dimension="0*3"/> </Element> </P>',
        '<1x1 struct>',
        SHOWN,
      ],
    ];
    for (const [el, written, shown, rows] of cases) {
      const session = createSession();
      const root: any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
      const design = root.getSection('design');
      design.parseEntry({ name: 'pasted', metadata: { ...design.children[0].metadata, uuid: '00000000-0000-4000-eb26-000000000004' }, value: cdataOf(el) });
      const xml = strFromU8(unzipSync(session.serializeSource(root.name).bytes)['data/chunk0.xml']);
      const at = xml.indexOf('<P Name="Value"', xml.indexOf('<P Name="Name" Class="char">pasted</P>'));
      const open = xml.slice(at, xml.indexOf('>', at) + 1);
      expect((open.endsWith('/>') ? open : xml.slice(at, xml.indexOf('</P>', at) + 4)).replace(/\s+/g, ' '), shown).toBe(written);
      const { entry } = pasteSaveReopen(BINARY, cdataOf(el));
      expect([entry.displayValue, entry.children.map((e: any) => e.displayValue)], shown).toEqual([shown, rows]);
    }
  });

  it('N-D, is copied as its stream, which MatWriter writes padded, and pastes as the padded value', () => {
    for (const el of [cellVar('n', [], [1, 1, 3]), structVar('n', ['a'], [], [1, 1, 3])]) {
      const [n] = opened(el).children;
      const copied = copyOf(n) as { _type: string };
      expect(copied._type).toBe('cdata');
      for (const file of [TEXT, BINARY]) {
        const { entry } = pasteSaveReopen(file, copied);
        const rows = entry.children.map((e: any) => (e.children.length ? e.children.map((f: any) => [f.name, f.displayValue]) : e.displayValue));
        expect([file, entry.displayValue, rows], file).toEqual([file, '<1x1x3 ' + (n._kind === 'cell' ? 'cell' : 'struct') + '>', n._kind === 'cell' ? ['[ ]', '[ ]', '[ ]'] : [[['a', '[ ]']], [['a', '[ ]']], [['a', '[ ]']]]]);
      }
    }
  });

  it('a binary dictionary save of what MATLAB reads padded is written as it was: one holding some of its elements', () => {
    // The pinned spelling, through the XML writer of a value read from a MAT stream: a text
    // dictionary's cdata of a 1x3 cell holding 1, pasted into a binary dictionary.
    const PREAMBLE = [0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00];
    const el = cellVar('', [one(7)], [1, 3]);
    const session = createSession();
    const root: any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
    const design = root.getSection('design');
    design.parseEntry({ name: 'pasted', metadata: { ...design.children[0].metadata, uuid: '00000000-0000-4000-eb26-000000000002' }, value: { _type: 'cdata', _value: uuencode(Uint8Array.from([...PREAMBLE, ...el])) } });
    const xml = strFromU8(unzipSync(session.serializeSource(root.name).bytes)['data/chunk0.xml']);
    const at = xml.indexOf('<P Name="Value"', xml.indexOf('<P Name="Name" Class="char">pasted</P>'));
    expect(xml.slice(at, xml.indexOf('</P>', at) + 4).replace(/\s+/g, ' ')).toBe('<P Name="Value" Class="cell" Dimension="1*3"> <Element Class="double">7.0</Element> </P>');
  });
});
