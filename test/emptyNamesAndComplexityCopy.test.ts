// Copyright 2026 The MathWorks, Inc.
//
// A struct array of no element keeps its field names, and an empty array its complexity,
// wherever a value read out of MAT bytes goes: copied into a text or a binary dictionary, at
// rank 2 and N-D, alone and as a member of a cell or a struct, edited or not, and written again
// as a text dictionary's own stream.
//
// `struct('a', {})` is a 0x0 struct with a field `a`, and its names are all there is of it.
// MatParser held `fields: {}` for a struct array of no element, so every writer wrote a struct
// of no field: a .mat save (MATLAB R2027a loaded it with fieldnames {}, the live gate's
// sibling_struct_field), a copy's MAT stream (cdata in a text dictionary), and a copy's bag,
// which named its fields from its element rows, of which it has none (`<P Class="struct"
// Dimension="0*0"/>` in a binary dictionary). And a complex empty is complex only by what it was
// read as (MatlabVariableNode._elementType), which the writers did not ask: an edited N-D one's
// stream was real, and a copy of a rank-2 one was the literal `[]`, which a binary dictionary
// wrote as `Class="double" Dimension="0*0"`, losing its complexity, and a single's class and its
// 0x3 with it.
//
// Where MATLAB has a spelling that keeps them, the copy is held to MATLAB's own bytes: a binary
// dictionary's `<Field Name="a"/>` of an empty struct and `IsComplex="1"` of an empty
// (dispcat_bin.sldd, written by MATLAB from the variables of dispcat.mat). MATLAB's own text
// dictionary spells both as what loses them (`{"_type": "struct", "_value": "[]"}`, `[]`;
// dispcat_text.sldd), so there a struct's copy is the bag of its names and an empty's its MAT
// stream, which hold them. MATLAB R2027a reads each back, in both, as `load` reads the .mat
// variable (test/emptyCopiesReadback.test.ts, parity/matlab/probe_empty_copies_readback.m).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { uudecode } from '../src/datamodel/parser/CdataCodec.js';
import { CLASS, cellVar, matFile, numericVar, sparseVar, structVar } from './tools/matBytes.js';
import { elementValue, type ElementValue } from './tools/matElements.js';
import { BINARY, TEXT, copyOf, sparseFixture } from './tools/pasteVenues.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (rel: string) => new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/' + rel, import.meta.url))));
const arrayBufferOf = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

const es = (dims: number[]) => structVar('', ['a', 'bb'], [], dims);
const cx = (dims: number[], cls: number = CLASS.DOUBLE) => numericVar({ name: '', cls, dimensions: dims, real: [], imag: [] });
const one = numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [1] });
const sp = sparseVar({ name: '', dimensions: [1, 1], ir: [0], jc: [0, 1], real: [5] });

// Every place a struct of no element and a complex empty can stand in a .mat.
const FILE = matFile([
  structVar('es00', ['a', 'bb'], [], [0, 0]),
  structVar('es10', ['a', 'bb'], [], [1, 0]),
  structVar('esNd', ['a', 'bb'], [], [0, 0, 2]),
  numericVar({ name: 'cx00', cls: CLASS.DOUBLE, dimensions: [0, 0], real: [], imag: [] }),
  numericVar({ name: 'cx03s', cls: CLASS.SINGLE, dimensions: [0, 3], real: [], imag: [] }),
  numericVar({ name: 'cxNd', cls: CLASS.DOUBLE, dimensions: [0, 0, 2], real: [], imag: [] }),
  cellVar('cNd', [es([0, 0]), cx([1, 0])], [1, 1, 2]),
  cellVar('cSp', [es([0, 0]), cx([1, 0]), sp], [1, 3]),
  structVar('s', ['es', 'cx', 'x', 'sp'], [{ es: es([0, 0]), cx: cx([0, 0]), x: one, sp }]),
  structVar('sNd', ['es', 'cx'], [{ es: es([0, 0]), cx: cx([0, 0]) }, { es: es([1, 0]), cx: cx([0, 0], CLASS.INT16) }], [1, 1, 2]),
]);

/** The variable `name` of FILE, opened as a host opens it, marked edited first when `edited`. */
function variable(name: string, edited = false): any {
  const root: any = createSession().addMatSource('v.mat', FILE);
  const node = root.children.find((c: any) => c.name === name);
  if (edited) {
    // The mark an edit and its undo leave (DataNode._valueEdited): the value rebuilt from its rows.
    node._markModified();
  }
  return node;
}

/** What a MAT stream (a cdata `_value`) holds, read by the test's own walker. */
const streamOf = (cdata: { _value: string }): ElementValue => elementValue(uudecode(cdata._value).subarray(8));

let seq = 0;

/**
 * `value` pasted into a fresh `file`, saved and opened again: the entry's value as written (the
 * JSON of a text dictionary's entry; a binary one's `<P Name="Value" …>` block, whitespace
 * folded) and the entry reopened.
 */
function pasteSaved(file: string, value: unknown): { written: any; entry: any } {
  const session = createSession();
  const root: any = ingest(session, sparseFixture(file), { filename: file });
  root.getSection('design').parseEntry({ name: 'pasted', metadata: { uuid: `00000000-0000-4000-e900-${String(++seq).padStart(12, '0')}` }, value });
  const out = session.serializeSource(root.name)!;
  const bytes = out.kind === 'text' ? strToU8(out.text!) : out.bytes!;
  let written: any;
  if (out.kind === 'text') {
    const find = (x: any): any => (x && typeof x === 'object' ? (x.name === 'pasted' && 'value' in x ? x : Object.values(x).map(find).find(Boolean)) : null);
    written = find(JSON.parse(out.text!)).value;
  } else {
    written = valueBlock(strFromU8(unzipSync(bytes)['data/chunk0.xml']), 'pasted');
  }
  const reopened: any = ingest(createSession(), arrayBufferOf(bytes), { filename: file });
  return { written, entry: reopened.getSection('design').children.find((e: any) => e.name === 'pasted') };
}

/** An entry's `<P Name="Value" …>` block in a binary dictionary's chunk, whitespace folded. */
function valueBlock(xml: string, entry: string): string {
  const at = xml.indexOf('<P Name="Name" Class="char">' + entry + '</P>');
  expect(at, entry).toBeGreaterThan(-1);
  const from = xml.indexOf('<P Name="Value"', at);
  return xml.slice(from, xml.indexOf('</Object>', from)).replace(/\s+/g, ' ').trim();
}

describe("a .mat's struct array of no element and complex empty, copied into a text dictionary", () => {
  for (const edited of [false, true]) {
    const as = edited ? ', edited' : '';

    it(`a rank-2 struct of no element is the bag of its field names${as}`, () => {
      for (const [name, dims] of [['es00', [0, 0]], ['es10', [1, 0]]] as const) {
        const copy = copyOf(variable(name, edited));
        // The bag the binary reader makes of MATLAB's `<Field Name="…"/>` (BinarySlddParser.structValue).
        expect(copy, name).toEqual({ _array_type: 'Struct', _dimensions: dims, _elements: [], _fields: ['a', 'bb'], _mw_element_type: 'MATLABArray' });
        const { written, entry } = pasteSaved(TEXT, copy);
        expect(written, name).toEqual(copy);
        expect([entry.className, entry.dims, entry.serial._fields, entry.children.length], name).toEqual(['struct', dims, ['a', 'bb'], 0]);
      }
    });

    it(`an N-D one, and one in an N-D cell or struct, is a stream holding its names${as}`, () => {
      const esNd = copyOf(variable('esNd', edited)) as any;
      expect(streamOf(esNd)).toMatchObject({ cls: CLASS.STRUCT, dims: [0, 0, 2], fields: ['a', 'bb'], members: [] });
      const cNd = streamOf(copyOf(variable('cNd', edited)) as any);
      expect(cNd.members!.map((m) => [m.cls, m.dims, m.fields, m.complex])).toEqual([
        [CLASS.STRUCT, [0, 0], ['a', 'bb'], false],
        [CLASS.DOUBLE, [1, 0], undefined, true],
      ]);
      const sNd = streamOf(copyOf(variable('sNd', edited)) as any);
      expect(sNd.fields).toEqual(['es', 'cx']);
      expect(sNd.members!.map((m) => [m.cls, m.dims, m.fields, m.complex])).toEqual([
        [CLASS.STRUCT, [0, 0], ['a', 'bb'], false],
        [CLASS.DOUBLE, [0, 0], undefined, true],
        [CLASS.STRUCT, [1, 0], ['a', 'bb'], false],
        [CLASS.INT16, [0, 0], undefined, true],
      ]);
      // Written as pasted, and read back so.
      const { written, entry } = pasteSaved(TEXT, esNd);
      expect(written).toEqual(esNd);
      expect([entry.className, entry.dims, entry._emptyStructFields]).toEqual(['struct', [0, 0, 2], ['a', 'bb']]);
    });

    it(`a complex empty is a stream that says complex, at every rank and class${as}`, () => {
      for (const [name, cls, dims, column] of [
        ['cx00', CLASS.DOUBLE, [0, 0], 'double (complex)'],
        ['cx03s', CLASS.SINGLE, [0, 3], 'single (complex)'],
        ['cxNd', CLASS.DOUBLE, [0, 0, 2], 'double (complex)'],
      ] as const) {
        const copy = copyOf(variable(name, edited)) as any;
        expect(copy._type, name).toBe('cdata');
        expect(streamOf(copy), name).toMatchObject({ cls, dims, complex: true, re: [], im: [] });
        const { written, entry } = pasteSaved(TEXT, copy);
        expect(written, name).toEqual(copy);
        expect([entry.className, entry.dims, entry._classColumn()], name).toEqual([cls === CLASS.SINGLE ? 'single' : 'double', dims, column]);
      }
    });

    it(`and as a member of a rank-2 cell or struct, each as itself${as}`, () => {
      const cSp = copyOf(variable('cSp', edited)) as any;
      expect(cSp._elements[0]).toEqual({ _array_type: 'Struct', _dimensions: [0, 0], _elements: [], _fields: ['a', 'bb'], _mw_element_type: 'MATLABArray' });
      expect(streamOf(cSp._elements[1])).toMatchObject({ cls: CLASS.DOUBLE, dims: [1, 0], complex: true });
      const s = copyOf(variable('s', edited)) as any;
      expect(s._elements[0].es._fields).toEqual(['a', 'bb']);
      expect(streamOf(s._elements[0].cx)).toMatchObject({ cls: CLASS.DOUBLE, dims: [0, 0], complex: true });
    });
  }
});

describe('copied into a binary dictionary, as MATLAB spells each there', () => {
  // MATLAB's own spelling of dispcat.mat's variables, in the binary dictionary it wrote of them.
  const matlab = strFromU8(unzipSync(fixture('display/dispcat_bin.sldd'))['data/chunk0.xml']);
  const dispcat = () => createSession().addMatSource('dispcat.mat', arrayBufferOf(fixture('display/dispcat.mat'))) as any;

  for (const edited of [false, true]) {
    it(`each of dispcat.mat's empties is the Value block MATLAB wrote for it${edited ? ', edited' : ''}`, () => {
      for (const name of ['dx_struct_0x0', 'dx_struct_0x0_fields', 'dx_struct_1x0', 'dx_complex_0x0', 'dx_complex_1x0', 'dx_complex_int16_1x0', 'e_single_complex_1x0']) {
        const node = dispcat().children.find((c: any) => c.name === name);
        if (edited) {
          node._markModified();
        }
        const { written } = pasteSaved(BINARY, copyOf(node));
        expect(written, name).toBe(valueBlock(matlab, name));
      }
    });
  }

  it('and the empties a cell or a struct holds, read back as they were', () => {
    const { written: cell, entry: c } = pasteSaved(BINARY, copyOf(variable('cSp', true)));
    expect(cell).toContain('<Element Class="struct" Dimension="0*0"> <Field Name="a"/> <Field Name="bb"/> </Element>');
    expect(cell).toContain('<Element Class="double" IsComplex="1" Dimension="1*0"/>');
    expect([c.children[0].className, c.children[0].dims, c.children[0].serial._fields]).toEqual(['struct', [0, 0], ['a', 'bb']]);
    expect([c.children[1].dims, c.children[1]._classColumn()]).toEqual([[1, 0], 'double (complex)']);

    const { written: struct, entry: s } = pasteSaved(BINARY, copyOf(variable('s', true)));
    expect(struct).toContain('<P Name="es" Class="struct" Dimension="0*0"> <Field Name="a"/> <Field Name="bb"/> </P>');
    expect(struct).toContain('<P Name="cx" Class="double" IsComplex="1" Dimension="0*0"/>');
    const field = (n: string) => s.children.find((f: any) => f.name === n);
    expect([field('es').serial._fields, field('cx')._classColumn()]).toEqual([['a', 'bb'], 'double (complex)']);

    const { written: nd } = pasteSaved(BINARY, copyOf(variable('sNd', true)));
    expect(nd).toContain('<P Name="es" Class="struct" Dimension="1*0"> <Field Name="a"/> <Field Name="bb"/> </P>');
    expect(nd).toContain('<P Name="cx" Class="int16" IsComplex="1" Dimension="0*0"/>');
  });
});

describe("a text dictionary's own stream of them, written again", () => {
  it('keeps the names and the complexity, unedited and once rebuilt from its rows', () => {
    // A text dictionary holding cNd as the stream a copy writes for it, as one saved before.
    const { entry } = pasteSaved(TEXT, copyOf(variable('cNd')));
    const raw = entry._rawInput;
    expect(entry._readFromStream).toBe(true);
    // Unedited, it is written as the stream it was read from.
    expect(entry.serializeValue()).toBe(raw);
    // Rebuilt from its rows (what a value edit leaves, though the editor takes none here: a text
    // dictionary's stream is shown and not edited), the stream MatWriter writes holds them too.
    entry._markModified();
    const again = entry.serializeValue() as any;
    expect(again).not.toBe(raw);
    expect(streamOf(again).members!.map((m) => [m.cls, m.dims, m.fields, m.complex])).toEqual([
      [CLASS.STRUCT, [0, 0], ['a', 'bb'], false],
      [CLASS.DOUBLE, [1, 0], undefined, true],
    ]);
  });
});
