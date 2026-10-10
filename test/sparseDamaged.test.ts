// Copyright 2026 The MathWorks, Inc.
//
// A sparse array whose file is damaged, in every venue it can arrive through. One
// corrupted 4-byte word is enough: spTall's dims are 10000000 x 2, and with the cols word
// overwritten to 0x7FFFFFFF the array declares 2^31-1 columns while its column index (jc)
// still holds three column starts. The reader reads what the bytes hold (MatParser's
// readSparse walks the columns jc holds); what used to go wrong came after it:
//
//   * opening a binary dictionary or a .mat whose MCOS object held such an array
//     re-encoded the property on read, and the encoder sized its column index by the
//     declared count — `new Array(2^31)`, a fatal V8 out-of-memory no try/catch can stop.
//     At 2^24 columns it opened, in 3.3 s and 1 GB, for a 3 KB value;
//   * the same encoder ran on a save after an edit, and on a paste out of a .mat.
//
// 1.36.2 opened every one of these at once, showing the reader's placeholder. Now the
// array opens as what its bytes hold, its rows are read-only because nothing could write an
// edit of it, it is written back as the bytes it was read from, and the encoder refuses it
// with an error a caller can catch.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, parseMat } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { uudecode, uuencode } from '../src/datamodel/parser/CdataCodec.js';
import { encodeMatStream, matStreamOfElement, MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { matFile, sparseVar } from './tools/matBytes.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/sparse/${name}`, import.meta.url))));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

// spTall's dims, rows 10000000 and cols 2, as int32 words; and with cols damaged.
const DIMS = [0x80, 0x96, 0x98, 0x00, 0x02, 0x00, 0x00, 0x00];
const colsWord = (cols: number) => [cols & 0xff, (cols >>> 8) & 0xff, (cols >>> 16) & 0xff, cols >>> 24];
const DAMAGED = (cols: number) => [...DIMS.slice(0, 4), ...colsWord(cols)];
// The sparse array's own flags subelement: miUINT32, 8 bytes, class 5, flag 0x10.
const SPARSE_FLAGS = [0x06, 0, 0, 0, 0x08, 0, 0, 0, 0x05, 0x10];

/** `bytes` with the one occurrence of `from` replaced by `to`. */
function patchOnce(bytes: Uint8Array, from: number[], to: number[]): Uint8Array {
  const at: number[] = [];
  for (let i = 0; i + from.length <= bytes.length; i++) {
    if (from.every((b, k) => bytes[i + k] === b)) at.push(i);
  }
  expect(at, `one ${hex(from)}`).toHaveLength(1);
  const out = bytes.slice();
  out.set(to, at[0]);
  return out;
}

/** A binary dictionary with one entry's hex Value patched, wherever its line breaks fall. */
function patchBinaryEntry(entry: string, from: number[], to: number[]): Uint8Array {
  const files = unzipSync(fixture('hexobj_binary.sldd'));
  const xml = strFromU8(files['data/chunk0.xml']);
  const at = xml.indexOf(`<P Name="Name" Class="char">${entry}</P>`);
  const open = xml.indexOf('>', xml.indexOf('<P Name="Value"', at)) + 1;
  const close = xml.indexOf('</P>', open);
  const positions: number[] = [];
  for (let i = open; i < close; i++) if (/[0-9A-F]/.test(xml[i])) positions.push(i);
  const digits = positions.map((i) => xml[i]).join('');
  const k = digits.indexOf(hex(from));
  expect([k >= 0, digits.indexOf(hex(from), k + 1)], `one ${hex(from)} in ${entry}`).toEqual([true, -1]);
  const chars = xml.split('');
  hex(to).split('').forEach((c, j) => (chars[positions[k + j]] = c));
  files['data/chunk0.xml'] = strToU8(chars.join(''));
  return zipSync(files);
}

/** The value tag of an entry in a binary dictionary's chunk, exactly as written. */
function valueTag(zip: Uint8Array, entry: string): string {
  const xml = strFromU8(unzipSync(zip)['data/chunk0.xml']);
  const at = xml.indexOf(`<P Name="Name" Class="char">${entry}</P>`);
  const from = xml.indexOf('<P Name="Value"', at);
  return xml.slice(from, xml.indexOf('</P>', from) + 4);
}

/** hexobj_values.mat with its MCOS subsystem (the unnamed record) patched, and nothing else. */
function patchMatSubsystem(from: number[], to: number[]): Uint8Array {
  const bytes = fixture('hexobj_values.mat');
  const variables = parseMat(buffer(bytes)).variables;
  const out = bytes.slice();
  let offset = 128;
  let patched = 0;
  for (const v of variables) {
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(view.getUint32(offset, true), 'uncompressed records').toBe(14);
    const size = view.getUint32(offset + 4, true);
    if (v._anonymous) {
      out.set(patchOnce(out.subarray(offset, offset + 8 + size), from, to), offset);
      patched++;
    }
    offset += 8 + size;
  }
  expect(patched).toBe(1);
  return out;
}

const timed = <T>(f: () => T): [T, number] => {
  const t0 = performance.now();
  const out = f();
  return [out, performance.now() - t0];
};
const rowsOf = (node: any) => node.children.map((c: any) => [c.displayName, c.displayValue, c.valueEditable]);

describe('a damaged column count in an MCOS-held sparse array opens, as what its bytes hold', () => {
  for (const cols of [0x7fffffff, 0x01000000]) {
    it(`a binary dictionary, pTall's Value declaring ${cols} columns: at once, read-only, and saved as it was`, () => {
      const session = createSession();
      const damaged = patchBinaryEntry('pTall', DIMS, DAMAGED(cols));
      const [root, ms] = timed((): any => ingest(session, buffer(damaged), { filename: 'hexobj_binary.sldd' }));
      expect(ms).toBeLessThan(1000);
      const pTall = root.getSection('design').children.find((e: any) => e.name === 'pTall');
      expect([pTall.displayValue, rowsOf(pTall._valueNode)]).toEqual([
        `<10000000x${cols} sparse double>`,
        [
          ['Value(1,1)', '7', false],
          ['Value(9999999,2)', '8', false],
        ],
      ]);
      // Untouched, it is written back byte for byte: a save never re-encodes it.
      const [saved, saveMs] = timed(() => session.serializeSource(root.name)!.bytes!);
      expect(saveMs).toBeLessThan(1000);
      expect(valueTag(saved, 'pTall')).toBe(valueTag(damaged, 'pTall'));
    });
  }

  it('a .mat, pTall\'s Value in the MCOS subsystem: at once, said so, and copied as the bytes it was read from', () => {
    const damaged = patchMatSubsystem(DIMS, DAMAGED(0x7fffffff));
    const session = createSession();
    const [mat, ms] = timed((): any => ingest(session, buffer(damaged), { filename: 'hexobj_values.mat' }));
    expect(ms).toBeLessThan(1000);
    const pTall = mat.children.find((e: any) => e.name === 'pTall');
    const value = pTall._valueNode;
    expect([value.displayValue, rowsOf(value)]).toEqual([
      '<10000000x2147483647 sparse double>',
      [
        ['Value(1,1)', '7', false],
        ['Value(9999999,2)', '8', false],
      ],
    ]);
    expect(mat.warnings?.map((w: any) => w.part)).toEqual(['pTall.Value']);
    // A copy into a dictionary: its Value is the element it was read from.
    const copied = JSON.parse(JSON.stringify(pTall.serializeValue()))._elements[0]._properties.Value;
    expect(copied._type).toBe('cdata');
    expect(hex([...uudecode(copied._value)])).toContain(hex(DAMAGED(0x7fffffff)));
  });
});

describe('a damaged column count in a sparse array of its own, edited or copied', () => {
  // 2^24 columns is a column index of 64 MB, which a writer could make; 2^31-1, one no MAT
  // stream can hold. Neither is what the file's bytes hold.
  for (const cols of [0x7fffffff, 0x01000000]) {
    it(`a text dictionary's spTall declaring ${cols} columns: its rows refuse an edit, a save writes it back as it was`, () => {
      const json = JSON.parse(strFromU8(fixture('sparse_text.sldd')));
      const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
      const entry = entries.find((e: any) => e.name === 'spTall');
      const bytes = patchOnce(uudecode(entry.value._value), DIMS, DAMAGED(cols));
      entry.value._value = uuencode(bytes);
      const session = createSession();
      const root: any = session.addDataSource('sparse_text.sldd', json);
      const spTall = root.getSection('design').children.find((e: any) => e.name === 'spTall');
      expect([spTall.displayValue, rowsOf(spTall)]).toEqual([
        `<10000000x${cols} sparse double>`,
        [
          ['spTall(1,1)', '7', false],
          ['spTall(9999999,2)', '8', false],
        ],
      ]);
      // Nothing can write an edit of it, so none is taken.
      expect(spTall.children[1].setProperty('Value', '9')).toMatchObject({ error: true });
      // And what would write one says so, as an error to catch.
      expect(() => encodeMatStream(spTall._var)).toThrow(MatWriteError);
      // Saved after an edit beside it, and after a rename, it is the stream it was read as.
      const spRow = root.getSection('design').children.find((e: any) => e.name === 'spRow');
      expect(spRow.children[0].setProperty('Value', '5')).toBe(true);
      expect(spTall.setProperty('Name', 'spTallRenamed')).toBe(true);
      const [saved, ms] = timed(() => JSON.parse(session.serializeSource(root.name)!.text!));
      expect(ms).toBeLessThan(1000);
      const out = saved.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'spTallRenamed');
      expect(out.value).toEqual(entry.value);
      // Typed over in whole, it is a value like any other.
      expect(spTall.setProperty('Value', '[1 2 3]')).toBe(true);
      expect(spTall.serializeValue()).toEqual([1, 2, 3]);
    });

    it(`a .mat variable declaring ${cols} columns: copied into a dictionary as the element it was read from, at once`, () => {
      const element = sparseVar({ name: 'w', dimensions: [1, cols], ir: [0], jc: [0, 1], real: [5] });
      const mat: any = createSession().addMatSource('w.mat', matFile([element]));
      const w = mat.children[0];
      expect([w.displayValue, rowsOf(w)]).toEqual([`<1x${cols} sparse double>`, [['w(1,1)', '5', false]]]);
      expect(mat.warnings?.map((x: any) => x.part)).toEqual(['w']);
      const [value, ms] = timed(() => w.serializeValue() as any);
      expect(ms).toBeLessThan(1000);
      expect(value._type).toBe('cdata');
      expect([...uudecode(value._value).slice(0, matStreamOfElement(element)!.length)]).toEqual([...matStreamOfElement(element)!]);
      expect(() => encodeMatStream(w._var)).toThrow(MatWriteError);
    });
  }
});

describe('a sparse MCOS property of a class nothing writes sparse shows what its bytes hold', () => {
  // pTall's sparse array with its class byte made 8, int8, the sparse flag kept: MATLAB never
  // writes one, and MatWriter has no sparse storage for it. The property was dropped, and the
  // Parameter showed `[ ]`.
  const INT8 = [...SPARSE_FLAGS.slice(0, 8), 0x08, 0x10];

  it('in a binary dictionary', () => {
    const root: any = ingest(createSession(), buffer(patchBinaryEntry('pTall', SPARSE_FLAGS, INT8)), { filename: 'hexobj_binary.sldd' });
    const pTall = root.getSection('design').children.find((e: any) => e.name === 'pTall');
    expect([pTall.displayValue, rowsOf(pTall._valueNode)]).toEqual([
      '<10000000x2 sparse int8>',
      [
        ['Value(1,1)', '7', false],
        ['Value(9999999,2)', '8', false],
      ],
    ]);
  });

  it('in a .mat, where a copy into a dictionary keeps its bytes', () => {
    const mat: any = ingest(createSession(), buffer(patchMatSubsystem(SPARSE_FLAGS, INT8)), { filename: 'hexobj_values.mat' });
    const pTall = mat.children.find((e: any) => e.name === 'pTall');
    expect([pTall._valueNode.displayValue, rowsOf(pTall._valueNode)]).toEqual([
      '<10000000x2 sparse int8>',
      [
        ['Value(1,1)', '7', false],
        ['Value(9999999,2)', '8', false],
      ],
    ]);
    const copied = JSON.parse(JSON.stringify(pTall.serializeValue()))._elements[0]._properties.Value;
    expect(copied._type).toBe('cdata');
    expect(hex([...uudecode(copied._value)])).toContain(hex(INT8));
  });
});
