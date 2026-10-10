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
import { UNBACKED_COLUMNS_ALLOWED } from '../src/datamodel/parser/SparseData.js';
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
      // Every row under a hex value is read-only, so those `false`s say nothing of the array
      // itself: what does is that no writer would take it.
      expect(pTall._valueNode._sparseRefusal()).toBe(
        `a sparse array declaring ${cols} columns is backed for 2, and its column index would be words no byte of its source held`,
      );
      expect(() => encodeMatStream(pTall._valueNode._var)).toThrow(MatWriteError);
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
    // Not hex: the rows are read-only for this array's own sake, and say why.
    expect(value.children[0].setProperty('Value', '9')).toMatchObject({ error: true, reason: expect.stringMatching(/cannot be written once edited/) });
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
    // Read-only as every row under a hex value is; and refused for its class as well.
    expect(pTall._valueNode._sparseRefusal()).toBe('no sparse MAT class for "int8"');
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
    // Not hex: read-only because nothing could write an edit of an int8 sparse array.
    expect(pTall._valueNode.children[0].setProperty('Value', '9')).toMatchObject({
      error: true,
      reason: expect.stringMatching(/no sparse MAT class for "int8"/),
    });
    const copied = JSON.parse(JSON.stringify(pTall.serializeValue()))._elements[0]._properties.Value;
    expect(copied._type).toBe('cdata');
    expect(hex([...uudecode(copied._value)])).toContain(hex(INT8));
  });
});

describe('no rows, no columns or nothing: what backs the columns is what is there, never the dims', () => {
  // A column index is cols + 1 words whatever the rows, so a 0x134217728 sparse array is a
  // 512 MB index. In a file MATLAB wrote, the file holds that index (SparseData.backedColumns
  // counts what its jc held). A source with no index — this package's own `sparse` literal,
  // a host's dense list — backs a column only with an element: `Matrix(0,134217728)\n[]`,
  // 52 characters, was credited every column its header declared, and pasted into a binary
  // dictionary and saved it ran the process out of memory (7.1 GB, 18.6 s, fatal). Beyond
  // that, any array has a few columns for free (UNBACKED_COLUMNS_ALLOWED), so sparse(0, 5),
  // which MATLAB holds valid, stays sparse wherever it is pasted.
  const BIG = 134217728;
  const FORMS: { label: string; dims: number[]; jc: number[]; held: boolean }[] = [
    // `held`: whether a file's own index for it, as MATLAB writes one, is this jc.
    { label: '0x134217728', dims: [0, BIG], jc: [0], held: false },
    { label: '0x5', dims: [0, 5], jc: [0, 0, 0, 0, 0, 0], held: true },
    { label: '5x0', dims: [5, 0], jc: [0], held: true },
    { label: '0x0', dims: [0, 0], jc: [0], held: true },
  ];
  const literalOf = (d: number[]) => ({ _type: 'sparse', _value: `Matrix(${d[0]},${d[1]})\n[]` });
  // A source of no bytes backs no column, but a few come free.
  const backedWithoutBytes = (d: number[]) => d[1] <= UNBACKED_COLUMNS_ALLOWED;
  // The pasted entry's own Value element, in what was saved.
  const pastedValue = (saved: string): string => {
    const at = saved.indexOf('<P Name="Name" Class="char">pasted</P>');
    const from = saved.indexOf('<P Name="Value"', at);
    return saved.slice(from, saved.indexOf('>', from) + 1);
  };
  let seq = 0;
  const uuid = () => `00000000-0000-4000-e400-${String(++seq).padStart(12, '0')}`;

  /** `value` pasted into a fresh dictionary of `file` and saved: the time each took, and the size written. */
  function pasteAndSave(file: string, value: unknown): { node: any; ms: number; size: number; saved: string } {
    const session = createSession();
    const root: any = ingest(session, buffer(fixture(file)), { filename: file });
    const [node, pasteMs] = timed((): any => root.getSection('design').parseEntry({ name: 'pasted', metadata: { uuid: uuid() }, value }));
    const [out, saveMs] = timed(() => session.serializeSource(root.name)!);
    const saved = out.kind === 'text' ? out.text! : strFromU8(unzipSync(out.bytes!)['data/chunk0.xml']);
    return { node, ms: pasteMs + saveMs, size: saved.length, saved };
  }
  const expectSmallAndSound = (r: { ms: number; size: number; saved: string }, label: string) => {
    expect(r.ms, `${label} time`).toBeLessThan(2000);
    expect(r.size, `${label} size`).toBeLessThan(1_000_000);
    expect(r.saved, label).not.toContain('Class="sparse"');
  };

  it('a host\'s own non-zeros back a column apiece, unless it says how many columns back them', () => {
    const host = (cols: number, extra: Record<string, unknown> = {}) => ({
      name: '', className: 'double', dimensions: [1, cols], isComplex: false, isLogical: false, isSparse: true, value: '<summary>', fields: null,
      sparse: { row: Int32Array.from([0]), col: Int32Array.from([0]), re: Float64Array.from([5]), im: null, ...extra },
    });
    expect(() => encodeMatStream(host(1))).not.toThrow();
    expect(() => encodeMatStream(host(1000000))).toThrow(MatWriteError);
    expect(() => encodeMatStream(host(1000000, { backedColumns: 1000000 }))).not.toThrow();
    // A few columns come free, and no more.
    expect(() => encodeMatStream(host(UNBACKED_COLUMNS_ALLOWED))).not.toThrow();
    expect(() => encodeMatStream(host(UNBACKED_COLUMNS_ALLOWED + 1))).toThrow(MatWriteError);
    // And a dense list handed to the writer itself: with no rows, it backs no column.
    const dense = (d: number[]) => ({ name: '', className: 'double', dimensions: d, isComplex: false, isLogical: false, isSparse: true, value: [], fields: null });
    const [, ms] = timed(() => expect(() => encodeMatStream(dense([0, BIG]))).toThrow(MatWriteError));
    expect(ms).toBeLessThan(1000);
    expect(() => encodeMatStream(dense([0, UNBACKED_COLUMNS_ALLOWED + 1]))).toThrow(MatWriteError);
    for (const d of [[0, 5], [5, 0], [0, 0], [0, UNBACKED_COLUMNS_ALLOWED]]) {
      expect(() => encodeMatStream(dense(d)), d.join('x')).not.toThrow();
    }
  });

  for (const f of FORMS) {
    it(`${f.label}, as this package's sparse literal: opened, saved and pasted into either dictionary at once`, () => {
      const literal = literalOf(f.dims);
      for (const file of ['sparse_text.sldd', 'sparse_binary.sldd']) {
        const r = pasteAndSave(file, literal);
        expect([r.node.displayValue, r.node.isSparse, r.node.children.length], `${file}`).toEqual([`<${f.dims.join('x')} sparse double>`, true, 0]);
        expectSmallAndSound(r, `${f.label} into ${file}`);
        // In a binary dictionary it is still sparse — a hex stream — unless no writer could
        // write it, and then it is the small full empty its shape is.
        if (file === 'sparse_binary.sldd') {
          expect(pastedValue(r.saved).includes('Encoding="hex"'), `${f.label} stays sparse`).toBe(backedWithoutBytes(f.dims));
        }
      }
      // In a text dictionary, untouched, it is the literal it was read as.
      const text = pasteAndSave('sparse_text.sldd', literal);
      expect(JSON.parse(text.saved).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'pasted').value).toEqual(literal);
      // What would write it as a stream refuses it, unless it has no columns to back.
      if (backedWithoutBytes(f.dims)) {
        expect(() => encodeMatStream(text.node._var)).not.toThrow();
      } else {
        expect(() => encodeMatStream(text.node._var)).toThrow(MatWriteError);
      }
    });

    it(`${f.label}, as a host's dense variable: read, copied and pasted into either dictionary at once`, () => {
      const mat: any = createSession().addMatSourceParsed('h.mat', {
        header: '',
        variables: [{ name: 'h', className: 'double', dimensions: f.dims.slice(), isComplex: false, isLogical: false, isSparse: true, value: [], fields: null }],
        warnings: [],
      });
      const h = mat.children[0];
      expect([h.displayValue, h.children.length]).toEqual([`<${f.dims.join('x')} sparse double>`, 0]);
      const [copied, ms] = timed(() => JSON.parse(JSON.stringify(h.serializeValue())));
      expect(ms).toBeLessThan(2000);
      // Copied, it is a sparse array's stream, unless no writer could write it.
      expect(copied?._type === 'cdata', `${f.label} copied sparse`).toBe(backedWithoutBytes(f.dims));
      for (const file of ['sparse_text.sldd', 'sparse_binary.sldd']) {
        expectSmallAndSound(pasteAndSave(file, copied), `${f.label} host into ${file}`);
      }
      if (backedWithoutBytes(f.dims)) {
        expect(() => encodeMatStream(h._var)).not.toThrow();
      } else {
        expect(() => encodeMatStream(h._var)).toThrow(MatWriteError);
      }
    });

    it(`${f.label}, read from MAT bytes in a .mat and as a binary dictionary's hex: opened, saved and copied at once`, () => {
      const element = sparseVar({ name: 'm', dimensions: f.dims, ir: [], jc: f.jc, real: [], nzmax: 1, sparseFlag: true });
      // The .mat: copied into either dictionary as the element it was read from.
      const mat: any = createSession().addMatSource('m.mat', matFile([element]));
      const m = mat.children[0];
      expect([m.displayValue, m.children.length]).toEqual([`<${f.dims.join('x')} sparse double>`, 0]);
      const [copied, ms] = timed(() => JSON.parse(JSON.stringify(m.serializeValue())));
      expect(ms).toBeLessThan(2000);
      expect([...uudecode(copied._value).slice(0, matStreamOfElement(element)!.length)]).toEqual([...matStreamOfElement(element)!]);
      for (const file of ['sparse_text.sldd', 'sparse_binary.sldd']) {
        expectSmallAndSound(pasteAndSave(file, copied), `${f.label} .mat into ${file}`);
      }
      // Its index held its columns, or it did not, and the writer says which.
      if (f.held) {
        expect(() => encodeMatStream(m._var)).not.toThrow();
      } else {
        expect(() => encodeMatStream(m._var)).toThrow(MatWriteError);
      }
      // A binary dictionary's hex of the same stream: replayed byte for byte on save.
      const stream = matStreamOfElement(element)!;
      const hexText = '\n' + hex([...stream]).replace(/(.{128})/g, '$1\n').replace(/\n$/, '');
      const encoded = { _type: 'encoded', _attrs: { Class: 'double', Encoding: 'hex', EncodedLength: String(stream.length) }, _value: hexText };
      const r = pasteAndSave('sparse_binary.sldd', encoded);
      expect([r.node.displayValue, r.node.children.length]).toEqual([`<${f.dims.join('x')} sparse double>`, 0]);
      expectSmallAndSound(r, `${f.label} hex`);
      expect(r.saved.replace(/\s+/g, '')).toContain(hex([...stream]));
    });
  }
});
