// Copyright 2026 The MathWorks, Inc.
//
// A numeric array past the reader's element limit (MatParser.MAT_ARRAY_ELEMENT_LIMIT). The reader
// reads a numeric part as one JS array, a number an element, and V8 holds no more than 2^27 in
// one (measured, Node 24): a 1x134217729 uint8, 128 MB, threw "RangeError: Invalid array length"
// out of parseMat, and the whole .mat failed to open, the variables beside it included. Theme 1
// (never crash) applies; group F group 3 leaves lazy reading for later. So such an array is
// recorded now as the reader's other refusals are: its class, its size and the reason, a warning
// naming it, and the bytes it was read from. The rest of the file reads as it did.
//
// One case is at the real size, under the limit the package ships with. The rest read under a
// limit lowered to 6 elements, through the setter the package does not export, as the inflate
// ceiling's tests do (test/matInflateCeiling.test.ts). Each value is built byte by byte
// (test/tools/matBytes.ts), so a failure here is about the limit and not about a fixture.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { decodeMatStream, parseMat, setMatArrayElementLimit, type MatVariable } from '../src/datamodel/parser/MatParser.js';
import { uuencode } from '../src/datamodel/parser/CdataCodec.js';
import { MatBudgetError, createSession, ingest } from '../src/index.js';
import {
  CLASS, MI, arrayFlags, cellVar, dims, matFile, mxArrayFile, numericVar, sparseVar, structVar, u32le, varName,
} from './tools/matBytes.js';
import { copyOf, thrownBy } from './tools/pasteVenues.js';

/** A file under test/, as bytes. */
const testFile = (path: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(`./${path}`, import.meta.url))));
const arrayBufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const sameBytes = (a: Uint8Array | null | undefined, b: Uint8Array) => !!a && Buffer.from(a).equals(Buffer.from(b));

/** The warning a .mat gives for the value at `path` not decoded for `why`. */
const notDecoded = (path: string, why: string) => ({ code: 'part-unreadable', message: `"${path}" was not decoded: ${why}.`, part: path });

/** The refusal of a copy of `path`, `what`, in entry `entry`, not decoded for `why` (F1-10). */
const refusal = (entry: string, path: string, what: string, why: string) => [
  'MatBudgetError', true, 'not-decoded', entry, path,
  `Cannot write "${entry}": ${path} is ${what} that was not decoded (${why}), so there is no value of it to write. Nothing was written.`,
];

/** What `f` threw, as a host meets it: its class, whether it is final, its reason, entry and path, and its message. */
function thrown(f: () => unknown): unknown[] {
  const [e] = thrownBy(f);
  const b = e as MatBudgetError | null;
  return [e?.name, e instanceof MatBudgetError, b?.reason, b?.entry, b?.at, e?.message];
}

const scalar = (name: string, n: number) => numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, 1], real: [n] });
const one = (n: number) => scalar('', n);
const uint8s = (name: string, n: number) => numericVar({ name, cls: CLASS.UINT8, dimensions: [1, n], real: Array.from({ length: n }, (_, i) => i + 1) });

describe('at the size it threw at, under the limit the package ships with', () => {
  const N = 2 ** 27 + 1;

  /**
   * A .mat holding `before`, a 1xN uint8 `big` of zeros, and `after`: the record of `big` built
   * in one allocation, because matBytes copies a payload once a layer and this one is 128 MB.
   */
  function bigFile(): { buffer: ArrayBuffer; record: [number, number] } {
    const before = scalar('before', 1);
    const after = scalar('after', 2);
    const head = [arrayFlags(CLASS.UINT8), dims([1, N]), varName('big'), u32le(MI.UINT8), u32le(N)];
    const headBytes = head.reduce((n, p) => n + p.length, 0);
    const body = headBytes + Math.ceil(N / 8) * 8;
    const out = new Uint8Array(128 + before.length + 8 + body + after.length);
    out.set(new Uint8Array(matFile([])), 0);
    out.set(before, 128);
    let at = 128 + before.length;
    const start = at;
    out.set(u32le(MI.MATRIX), at);
    out.set(u32le(body), at + 4);
    at += 8;
    for (const p of head) {
      out.set(p, at);
      at += p.length;
    }
    out.set(after, start + 8 + body);
    return { buffer: out.buffer, record: [start, start + 8 + body] };
  }

  const WHY = `its real part holds ${N} elements, more than the ${2 ** 27} this reader reads into one array`;

  it('a .mat holding a 1x134217729 uint8 opens: the array recorded, not decoded, with its bytes, and the variables beside it read', { timeout: 120_000 }, () => {
    const { buffer, record } = bigFile();
    // Before: parseMat threw "RangeError: Invalid array length", about 1.5 s in.
    const parsed = parseMat(buffer);
    expect(parsed.variables.map((v) => [v.name, v.value])).toEqual([['before', 1], ['big', `<1x${N} uint8, not decoded>`], ['after', 2]]);
    const big = parsed.variables[1];
    expect([big.className, big.dimensions, big.undecoded]).toEqual(['uint8', [1, N], WHY]);
    expect(sameBytes(big._rawBytes, new Uint8Array(buffer, record[0], record[1] - record[0]))).toBe(true);
    expect(parsed.warnings).toEqual([notDecoded('big', WHY)]);

    const mat: any = createSession().addMatSource('big.mat', buffer);
    expect(mat.children.map((n: any) => [n.name, n.displayValue, n.valueEditable])).toEqual([
      ['before', '1', true],
      ['big', `<1x${N} uint8, not decoded>`, false],
      ['after', '2', true],
    ]);
    expect(mat.warnings).toEqual([notDecoded('big', WHY)]);
  });
});

describe('past the element limit, an array is recorded, not decoded, and the rest of the file is read', () => {
  const LIMIT = 6;
  const why = (part: string, n: number) => `its ${part} holds ${n} elements, more than the ${LIMIT} this reader reads into one array`;

  beforeAll(() => setMatArrayElementLimit(LIMIT));
  afterAll(() => setMatArrayElementLimit(undefined));

  it('an array of as many elements as the limit reads as it did, and one of a single element more is recorded with its bytes', () => {
    const atLimit = uint8s('at', LIMIT);
    const over = uint8s('over', LIMIT + 1);
    const parsed = parseMat(matFile([scalar('before', 1), atLimit, over, scalar('after', 2)]));
    expect(parsed.variables.map((v) => [v.name, v.className, v.value, v.undecoded])).toEqual([
      ['before', 'double', 1, undefined],
      ['at', 'uint8', [1, 2, 3, 4, 5, 6], undefined],
      ['over', 'uint8', '<1x7 uint8, not decoded>', why('real part', 7)],
      ['after', 'double', 2, undefined],
    ]);
    expect(sameBytes(parsed.variables[2]._rawBytes, over)).toBe(true);
    expect(parsed.warnings).toEqual([notDecoded('over', why('real part', 7))]);
  });

  it('the limit counts what the bytes hold, whatever the size declares; a 2-D array counts all its elements', () => {
    // Declares 1x10 and holds 5: read short, as before. A 2x4 double holds 8.
    const short = numericVar({ name: 'short', cls: CLASS.DOUBLE, dimensions: [1, 10], real: [1, 2, 3, 4, 5] });
    const matrix2x4 = numericVar({ name: 'm', cls: CLASS.DOUBLE, dimensions: [2, 4], real: [1, 2, 3, 4, 5, 6, 7, 8] });
    const parsed = parseMat(matFile([short, matrix2x4]));
    expect(parsed.variables.map((v) => [v.name, v.value, v.undecoded])).toEqual([
      ['short', [1, 2, 3, 4, 5], undefined],
      ['m', '<2x4 double, not decoded>', why('real part', 8)],
    ]);
    expect(parsed.warnings).toEqual([notDecoded('m', why('real part', 8))]);
  });

  it('a complex array whose imaginary part alone is past the limit is recorded, naming that part', () => {
    // Declares 1x7: its real part holds 3 values, and its imaginary part 7.
    const z = numericVar({ name: 'z', cls: CLASS.DOUBLE, dimensions: [1, 7], real: [1, 2, 3], imag: [1, 2, 3, 4, 5, 6, 7] });
    const parsed = parseMat(matFile([z]));
    expect([parsed.variables[0].value, parsed.variables[0].undecoded]).toEqual(['<1x7 double, not decoded>', why('imaginary part', 7)]);
    expect(parsed.warnings).toEqual([notDecoded('z', why('imaginary part', 7))]);
  });

  it('in a compressed record, as MATLAB saves in -v7: recorded, with the bytes it inflated to', () => {
    const over = uint8s('over', LIMIT + 1);
    // A compressed record's tag counts the zlib stream, and the next record follows it unpadded.
    const packed = deflateSync(over);
    const record = new Uint8Array(8 + packed.length);
    record.set(u32le(MI.COMPRESSED), 0);
    record.set(u32le(packed.length), 4);
    record.set(packed, 8);
    const parsed = parseMat(matFile([scalar('before', 1), record, scalar('after', 2)]));
    expect(parsed.variables.map((v) => [v.name, v.value])).toEqual([['before', 1], ['over', '<1x7 uint8, not decoded>'], ['after', 2]]);
    expect(sameBytes(parsed.variables[1]._rawBytes, over)).toBe(true);
    expect(parsed.warnings).toEqual([notDecoded('over', why('real part', 7))]);
  });

  it('a sparse array with more row indices, or more column starts, than the limit is recorded, as a sparse array', () => {
    // 3x4 with 7 non-zeros: 7 row indices. 1x6 with one non-zero: 7 column starts.
    const many = sparseVar({ name: 'many', dimensions: [3, 4], ir: [0, 1, 2, 0, 1, 2, 0], jc: [0, 3, 6, 7, 7], real: [1, 2, 3, 4, 5, 6, 7] });
    const wide = sparseVar({ name: 'wide', dimensions: [1, 6], ir: [0], jc: [0, 1, 1, 1, 1, 1, 1], real: [9] });
    const fits = sparseVar({ name: 'fits', dimensions: [1, 5], ir: [0], jc: [0, 1, 1, 1, 1, 1], real: [9] });
    const parsed = parseMat(matFile([many, wide, fits]));
    const ROWS = `it has 7 row indices, more than the ${LIMIT} this reader reads into one array`;
    const COLS = `it has 7 column starts, more than the ${LIMIT} this reader reads into one array`;
    expect(parsed.variables.map((v) => [v.name, v.isSparse, v.value, v.undecoded])).toEqual([
      ['many', true, '<3x4 sparse double, not decoded>', ROWS],
      ['wide', true, '<1x6 sparse double, not decoded>', COLS],
      ['fits', true, '<1x5 sparse double>', undefined],
    ]);
    expect(Array.from(parsed.variables[2].sparse!.re)).toEqual([9]);
    expect(parsed.warnings).toEqual([notDecoded('many', ROWS), notDecoded('wide', COLS)]);

    // As a row, it is what was read of it, with no editor, and its copy is refused naming it
    // as its row does, a sparse array (B-13).
    const mat: any = createSession().addMatSource('sp.mat', matFile([many]));
    expect([mat.children[0].displayValue, mat.children[0].valueEditable]).toEqual(['<3x4 sparse double, not decoded>', false]);
    expect(thrown(() => mat.children[0].serialize())).toEqual(refusal('many', 'many', 'a 3x4 sparse double', ROWS));
  });

  it('a struct field and a cell element past the limit: each keeps its bytes, its row says so, and the copy of it, and of what holds it, is refused', () => {
    const s = structVar('s', ['f', 'g'], [{ f: uint8s('', LIMIT + 1), g: one(2) }]);
    const c = cellVar('c', [one(1), uint8s('', LIMIT + 1)]);
    const parsed = parseMat(matFile([s, c]));
    const [ps, pc] = parsed.variables;
    const f = ps.fields!.f as MatVariable;
    const e = (pc.value as MatVariable[])[1];
    expect([f.value, f.undecoded, e.value, e.undecoded]).toEqual([
      '<1x7 uint8, not decoded>', why('real part', 7), '<1x7 uint8, not decoded>', why('real part', 7),
    ]);
    expect([sameBytes(f._rawBytes, uint8s('', LIMIT + 1)), sameBytes(e._rawBytes, uint8s('', LIMIT + 1))]).toEqual([true, true]);
    expect([(ps.fields!.g as MatVariable).value, (pc.value as MatVariable[])[0].value]).toEqual([2, 1]);
    expect(parsed.warnings).toEqual([notDecoded('s.f', why('real part', 7)), notDecoded('c{2}', why('real part', 7))]);

    const mat: any = createSession().addMatSource('t.mat', matFile([s, c]));
    const [ns, nc] = mat.children;
    expect([ns.children[0].displayValue, ns.children[0].valueEditable, nc.children[1].displayValue, nc.children[1].valueEditable]).toEqual([
      '<1x7 uint8, not decoded>', false, '<1x7 uint8, not decoded>', false,
    ]);
    expect(mat.warnings).toEqual([notDecoded('s.f', why('real part', 7)), notDecoded('c{2}', why('real part', 7))]);
    for (const n of [ns, ns.children[0]]) {
      expect(thrown(() => n.serialize())).toEqual(refusal('s', 's.f', 'a 1x7 uint8', why('real part', 7)));
    }
    for (const n of [nc, nc.children[1]]) {
      expect(thrown(() => n.serialize())).toEqual(refusal('c', 'c{2}', 'a 1x7 uint8', why('real part', 7)));
    }
    expect([ns.children[1].serialize(), nc.children[0].serialize()]).toEqual([2, 1]);
  });

  it('a .mat variable: its row is what was read of it, with no editor, and its copy is refused; the one beside it copies as before', () => {
    const mat: any = createSession().addMatSource('t.mat', matFile([scalar('ok', 7), uint8s('x', LIMIT + 1)]));
    const [o, x] = mat.children;
    expect([x.name, x.displayValue, x.className, x.valueEditable]).toEqual(['x', '<1x7 uint8, not decoded>', 'uint8', false]);
    expect(thrown(() => x.serialize())).toEqual(refusal('x', 'x', 'a 1x7 uint8', why('real part', 7)));
    expect(copyOf(o)).toBe(7);
  });

  it('in a dictionary value, a text dictionary\'s cdata or a binary one\'s hex: it opens as not decoded, and an untouched save writes it back as read', () => {
    const PREAMBLE = [0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00];
    const stream = Uint8Array.from([...PREAMBLE, ...uint8s('', LIMIT + 1)]);
    const decoded = decodeMatStream(stream);
    expect(decoded.ok && [decoded.variable.value, decoded.variable.undecoded]).toEqual(['<1x7 uint8, not decoded>', why('real part', 7)]);

    // Text: fixtures/sparse/sparse_text.sldd with its entry c's value the cdata of the stream.
    const json = JSON.parse(strFromU8(testFile('fixtures/sparse/sparse_text.sldd')));
    const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const entry = entries.find((x: any) => x.name === 'c');
    entry.value = { _type: 'cdata', _value: uuencode(stream) };
    const text = createSession();
    const textRoot: any = text.addDataSource('sparse_text.sldd', JSON.parse(JSON.stringify(json)));
    const c = textRoot.getSection('design').children.find((x: any) => x.name === 'c');
    expect([c.displayValue, c.valueEditable]).toEqual(['<1x7 uint8, not decoded>', false]);
    const saved = JSON.parse(text.serializeSource(textRoot.name)!.text!);
    const out = saved.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((x: any) => x.name === 'c');
    expect(out.value).toEqual(entry.value);

    // Binary: fixtures/sparse/sparse_binary.sldd with its entry c's hex Value the stream.
    const parts = unzipSync(testFile('fixtures/sparse/sparse_binary.sldd'));
    const chunk = strFromU8(parts['data/chunk0.xml']);
    const named = chunk.indexOf('<P Name="Name" Class="char">c</P>');
    const at = chunk.indexOf('<P Name="Value" Class="cell" Encoding="hex"', named);
    expect([named > 0, at > named]).toEqual([true, true]);
    const digits = Array.from(stream, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
    const tag = `<P Name="Value" Class="uint8" Encoding="hex" EncodedLength="${stream.length}">`;
    const zip = zipSync({ ...parts, 'data/chunk0.xml': strToU8(chunk.slice(0, at) + tag + digits + chunk.slice(chunk.indexOf('</P>', at))) });
    const binary = createSession();
    const binaryRoot: any = ingest(binary, arrayBufferOf(zip), { filename: 'sparse_binary.sldd' });
    const h = binaryRoot.getSection('design').children.find((x: any) => x.name === 'c');
    expect([h.displayValue, h.valueEditable]).toEqual(['<1x7 uint8, not decoded>', false]);
    expect(strFromU8(unzipSync((binary.serializeSource(binaryRoot.name) as any).bytes)['data/chunk0.xml'])).toContain(tag + digits + '</P>');
  });

  it('in a model workspace, the model opens with every variable, the one past the limit not decoded, and says nothing', () => {
    const ws = structVar('', ['big', 'ok'], [{ big: uint8s('', LIMIT + 1), ok: one(7) }]);
    const entries = unzipSync(testFile('parity/artifacts/slx/cases.slx'));
    expect(Object.keys(entries)).toContain('simulink/modelWorkspace.mxarray');
    entries['simulink/modelWorkspace.mxarray'] = new Uint8Array(mxArrayFile(ws.subarray(8)));
    const model: any = createSession().addModelSource('cases.slx', arrayBufferOf(zipSync(entries)));
    const workspace = model.children.find((x: any) => x.name === 'workspace');
    expect(workspace.children.map((n: any) => [n.name, n.displayValue, n.valueEditable])).toEqual([
      ['big', '<1x7 uint8, not decoded>', false],
      ['ok', '7', true],
    ]);
    // A model workspace does not report a value it did not decode (the C-232 ruling).
    expect(model.warnings ?? []).toEqual([]);
  });
});

describe('the limit set back', () => {
  it('an array of one element more than a lowered limit reads in full once the limit the package ships with is back', () => {
    setMatArrayElementLimit(6);
    try {
      expect(parseMat(matFile([uint8s('x', 7)])).variables[0].undecoded).toBe('its real part holds 7 elements, more than the 6 this reader reads into one array');
    } finally {
      setMatArrayElementLimit(undefined);
    }
    const parsed = parseMat(matFile([uint8s('x', 7)]));
    expect([parsed.variables[0].value, parsed.variables[0].undecoded, parsed.warnings]).toEqual([[1, 2, 3, 4, 5, 6, 7], undefined, []]);
  });
});
