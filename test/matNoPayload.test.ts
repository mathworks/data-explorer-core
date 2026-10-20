// Copyright 2026 The MathWorks, Inc.
//
// A numeric MAT value that declares elements and holds no data: its bytes end after its name,
// before the tag of its real part. MATLAB writes no such value, so only a damaged file holds
// one, and the reader (MatParser.parseMatrix) leaves its value null, which it says means no
// payload was there at all (matParser.test.ts, "leaves the value null when the payload
// subelement is missing entirely").
//
// The node layer took that null for a value. A 1x1 showed `null` and a 2x3 `[null]`, and each
// offered an editor, for a value nothing read; a complex one did the same, since #116 built it
// as the real one cut at the same point. The maintainer's ruling of 2026-10-16 (group E, theme
// 1: warn and show what was read) makes it what every other value the reader did not decode
// is: one row, `<2x3 double, not decoded>`, with no editor and no element rows, its class and
// size being the part that was read. A .mat file says so; a model workspace does not (C-232).
//
// Each value is built byte by byte (test/tools/matBytes.ts), so a failure here is about the
// missing payload and not about a fixture.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync, zlibSync } from 'fflate';
import { decodeMatStream, parseMat } from '../src/datamodel/parser/MatParser.js';
import { parseMxArray } from '../src/datamodel/parser/MxArrayParser.js';
import { uuencode } from '../src/datamodel/parser/CdataCodec.js';
import { regenerateChunkXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { createSession, ingest } from '../src/index.js';
import { CLASS, MI, cellVar, charVar, matFile, mxArrayFile, numericVar, structVar, u32le } from './tools/matBytes.js';

/** A file under test/, as bytes. */
const testFile = (path: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(`./${path}`, import.meta.url))));
const arrayBufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/** A numeric value whose bytes end after its name: no real part, and no imaginary one. */
const noPayload = (name: string, cls: number, dimensions: number[], opts: { complex?: boolean; logical?: boolean } = {}) =>
  numericVar({ name, cls, dimensions, real: [], ...(opts.complex ? { imag: [] } : {}), logical: opts.logical, omitData: true });

const ok = () => numericVar({ name: 'ok', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [7] });
const empty = () => numericVar({ name: 'e', cls: CLASS.DOUBLE, dimensions: [0, 0], real: [] });
const tail = () => charVar('tail', 'end', MI.UTF8);

/** The one warning a .mat gives for the value at `part` holding none of its `count` elements. */
const holdsNoData = (part: string, count: number) => ({
  code: 'part-unreadable',
  message: `"${part}" declares ${count} element(s) and holds no data, so its value was not read.`,
  part,
});

/** A row as a host is shown it: its name, value, class, whether it offers an editor, and its rows. */
const row = (n: any): unknown => [n.name, n.displayValue, n.className, n.valueEditable, n.children.map(row)];
const notDecoded = (name: string, shape: string, cls: string) => [name, `<${shape} ${cls}, not decoded>`, cls, false, []];

/**
 * The refusal a copy of `entry` meets for the value at `path` holding none of its `count`
 * elements: nothing holds its value, and the text of its placeholder is another value (the
 * maintainer's group F ruling of 2026-10-18, F1-10).
 */
const refusedCopy = (entry: string, path: string, shape: string, cls: string, count: number) =>
  `Cannot write "${entry}": ${path} is a ${shape} ${cls} that was not decoded (it declares ${count} element(s) and holds no data), `
  + 'so there is no value of it to write. Nothing was written.';

const opened = (name: string, variables: Uint8Array[]): any => createSession().addMatSource(name, matFile(variables));

describe('a numeric MAT value with no data is shown as not decoded, with no editor and no rows', () => {
  it('a .mat: each one is its class and size, not decoded, the file says why, and the variables beside it are as they are', () => {
    const mat = opened('t.mat', [
      ok(),
      noPayload('r1', CLASS.DOUBLE, [1, 1]),
      noPayload('r23', CLASS.DOUBLE, [2, 3]),
      noPayload('c1', CLASS.DOUBLE, [1, 1], { complex: true }),
      noPayload('c12', CLASS.DOUBLE, [1, 2], { complex: true }),
      noPayload('b1', CLASS.UINT8, [1, 1], { logical: true }),
      noPayload('i32', CLASS.INT16, [3, 2]),
      // An empty one holds every one of its no elements, payload or not: it is [], as before.
      noPayload('e0', CLASS.DOUBLE, [0, 0]),
      empty(),
      tail(),
    ]);
    const control = opened('control.mat', [ok(), empty(), tail()]);
    const rows = mat.children.map(row);
    // Before: r1 `null`, r23 `[null]` with one element row, c1 and c12 the same, b1 `false`,
    // and every one of them with an editor.
    expect(rows.slice(1, 7)).toEqual([
      notDecoded('r1', '1x1', 'double'),
      notDecoded('r23', '2x3', 'double'),
      notDecoded('c1', '1x1', 'double'),
      notDecoded('c12', '1x2', 'double'),
      notDecoded('b1', '1x1', 'logical'),
      notDecoded('i32', '3x2', 'int16'),
    ]);
    // Shown as [], as before, and taking no edit: a matrix whose sub-elements end before its data
    // is one MATLAB does not load, so a save writes it only as it was read, or renamed
    // (MatFileWriter.freshRefusal).
    expect(rows[7]).toEqual(['e0', '[ ]', 'double', false, []]);
    expect([rows[0], ...rows.slice(8)]).toEqual(control.children.map(row));
    // Before: no warning at all.
    expect(mat.warnings).toEqual([
      holdsNoData('r1', 1),
      holdsNoData('r23', 6),
      holdsNoData('c1', 1),
      holdsNoData('c12', 2),
      holdsNoData('b1', 1),
      holdsNoData('i32', 6),
    ]);
    expect(control.warnings).toBeUndefined();
    // What a host asks of every row, and a copy of each: of a value beside them as it was, and of
    // one of them refused, naming it. It was the text of its placeholder.
    for (const n of mat.children) {
      expect(() => n.toRow()).not.toThrow();
    }
    for (const n of [mat.children[0], ...mat.children.slice(7)]) {
      expect(() => JSON.stringify(n.serializeValue())).not.toThrow();
    }
    const [, r1, r23, c1, c12, b1, i32] = mat.children;
    expect(() => r1.serializeValue()).toThrow(refusedCopy('r1', 'r1', '1x1', 'double', 1));
    expect(() => r23.serializeValue()).toThrow(refusedCopy('r23', 'r23', '2x3', 'double', 6));
    expect(() => c1.serializeValue()).toThrow(refusedCopy('c1', 'c1', '1x1', 'double', 1));
    expect(() => c12.serializeValue()).toThrow(refusedCopy('c12', 'c12', '1x2', 'double', 2));
    expect(() => b1.serializeValue()).toThrow(refusedCopy('b1', 'b1', '1x1', 'logical', 1));
    expect(() => i32.serializeValue()).toThrow(refusedCopy('i32', 'i32', '3x2', 'int16', 6));
  });

  it('a .mat: one in a struct field or a cell element is a not-decoded row there, named as MATLAB names it', () => {
    const one = (n: number) => numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [n] });
    const s = structVar('s', ['a', 'b'], [{ a: noPayload('', CLASS.DOUBLE, [1, 3]), b: one(2) }]);
    const c = cellVar('c', [noPayload('', CLASS.INT8, [1, 1]), one(5)]);
    const mat = opened('nested.mat', [ok(), s, c]);
    const [, sNode, cNode] = mat.children;
    // The value beside each takes no edit: a save writes s and c fresh or not at all, and has
    // nothing to write the one with no data from (MatNode._editRefusal).
    expect(sNode.children.map(row)).toEqual([notDecoded('a', '1x3', 'double'), ['b', '2', 'double', false, []]]);
    expect(cNode.children.map(row)).toEqual([notDecoded('1', '1x1', 'int8'), ['2', '5', 'double', false, []]]);
    expect(mat.warnings).toEqual([holdsNoData('s.a', 3), holdsNoData('c{1}', 1)]);
    for (const n of [sNode, cNode]) {
      expect(() => n.toRow()).not.toThrow();
    }
    // A copy of what holds one is refused, naming it. It held the text of its placeholder.
    expect(() => sNode.serializeValue()).toThrow(refusedCopy('s', 's.a', '1x3', 'double', 3));
    expect(() => cNode.serializeValue()).toThrow(refusedCopy('c', 'c{1}', '1x1', 'int8', 1));
  });

  it('a .mat whose last record is cut where its data begins: not decoded, and the file says so once', () => {
    // The record claims its whole value, and the file ends where the value's real part
    // begins, so the record is read short and its value holds no data: one loss, reported
    // once, by the record's warning, which names it.
    const x = numericVar({ name: 'x', cls: CLASS.DOUBLE, dimensions: [1, 3], real: [1, 2, 3] });
    const cutAt = 128 + ok().length + noPayload('x', CLASS.DOUBLE, [1, 3]).length;
    const whole = new Uint8Array(matFile([ok(), x]));
    const cut: any = createSession().addMatSource('cut.mat', arrayBufferOf(whole.slice(0, cutAt)));
    // `ok` as read, and taking no edit: its records do not tile the file, so no save of it can be
    // written (MatNode._fileRefusal).
    expect(cut.children.map(row)).toEqual([['ok', '7', 'double', false, []], notDecoded('x', '1x3', 'double')]);
    expect(cut.warnings).toEqual([
      {
        code: 'part-unreadable',
        message: `A record at byte ${128 + ok().length} declares ${x.length - 8} bytes and the file holds only ${cutAt - 128 - ok().length - 8}, so it was read short.`,
        part: 'x',
      },
    ]);

    // The same, one level in: a compressed record whose payload is cut there.
    const payload = x.slice(0, noPayload('x', CLASS.DOUBLE, [1, 3]).length);
    const data = zlibSync(payload);
    const compressed = new Uint8Array([...u32le(MI.COMPRESSED), ...u32le(data.length), ...data]);
    const inner: any = createSession().addMatSource('inner.mat', matFile([ok(), compressed]));
    expect(inner.children.map(row)).toEqual([['ok', '7', 'double', true, []], notDecoded('x', '1x3', 'double')]);
    expect(inner.warnings).toEqual([
      {
        code: 'part-unreadable',
        message: `A compressed record at byte ${128 + ok().length} holds a variable that declares ${x.length - 8} bytes, and its payload holds only ${payload.length - 8}, so it was read short.`,
        part: 'x',
      },
    ]);
  });

  it('the reader still says only that no payload was there: its value is null, as before', () => {
    // The parser's reading is unchanged: the node layer decides what null shows as.
    const parsed = parseMat(matFile([noPayload('r23', CLASS.DOUBLE, [2, 3])]));
    expect(parsed.variables.map((v) => [v.name, v.value, v.undecoded])).toEqual([['r23', null, undefined]]);
  });

  it('a model workspace: the model opens, the value is not decoded, and nothing warns', () => {
    // A workspace is a struct whose fields are its variables.
    const ws = structVar('', ['ok', 'r23', 'c12'], [{
      ok: numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 2], real: [1, 2] }),
      r23: noPayload('', CLASS.DOUBLE, [2, 3]),
      c12: noPayload('', CLASS.DOUBLE, [1, 2], { complex: true }),
    }]);
    const entries = unzipSync(testFile('parity/artifacts/slx/cases.slx'));
    expect(Object.keys(entries)).toContain('simulink/modelWorkspace.mxarray');
    entries['simulink/modelWorkspace.mxarray'] = new Uint8Array(mxArrayFile(ws.subarray(8)));
    const model: any = createSession().addModelSource('cases.slx', arrayBufferOf(zipSync(entries)));
    const workspace = model.children.find((s: any) => s.name === 'workspace');
    expect(workspace.children.map(row)).toEqual([
      ['ok', '[1 2]', 'double', true, [['1', '1', 'double', true, []], ['2', '2', 'double', true, []]]],
      notDecoded('r23', '2x3', 'double'),
      notDecoded('c12', '1x2', 'double'),
    ]);
    // A model workspace does not report a value it did not decode (the C-232 ruling).
    expect(model.warnings ?? []).toEqual([]);
  });

  it('a model workspace part cut between a complex variable\'s flags and its real part (#116\'s window): not decoded, no warning', () => {
    const PART = 'simulink/modelWorkspace.mxarray';
    const file = testFile('fixtures/mcos/complex_ws.slx');
    const entries = unzipSync(file);
    const part = entries[PART];
    // The lengths at which z, 3+4i, is read complex with no value, as #116's test finds them.
    const window: number[] = [];
    for (let length = 0; length < part.length; length++) {
      const z = parseMxArray(part.slice(0, length).buffer).find((v) => v.name === 'z');
      if (z && z.isComplex && z.value === null) {
        window.push(length);
      } else if (window.length > 0) {
        break;
      }
    }
    expect(window.length).toBe(31);
    for (const length of window) {
      const model: any = createSession().addModelSource('complex_ws.slx', arrayBufferOf(zipSync({ ...entries, [PART]: part.slice(0, length) })));
      const z = model.children.find((s: any) => s.name === 'workspace').children.find((n: any) => n.name === 'z');
      // Before: `null`, with an editor.
      expect([length, row(z)]).toEqual([length, notDecoded('z', '1x1', 'double')]);
      expect(model.warnings ?? []).toEqual([]);
    }
  });

  it('a dictionary value, a text dictionary\'s cdata or a binary one\'s hex: not decoded, read-only, and an untouched save writes it back as read', () => {
    const PREAMBLE = [0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00];
    const stream = Uint8Array.from([...PREAMBLE, ...noPayload('', CLASS.DOUBLE, [1, 2], { complex: true })]);
    const decoded = decodeMatStream(stream);
    expect(decoded.ok && [decoded.variable.isComplex, decoded.variable.value]).toEqual([true, null]);

    // Text: fixtures/sparse/sparse_text.sldd with its entry c's value the cdata of the stream.
    const json = JSON.parse(strFromU8(testFile('fixtures/sparse/sparse_text.sldd')));
    const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const entry = entries.find((e: any) => e.name === 'c');
    entry.value = { _type: 'cdata', _value: uuencode(stream) };
    const text = createSession();
    const textRoot: any = text.addDataSource('sparse_text.sldd', JSON.parse(JSON.stringify(json)));
    const c = textRoot.getSection('design').children.find((e: any) => e.name === 'c');
    // Before: `[null]`, with one element row.
    expect([c.displayValue, c.valueEditable, c.children.length]).toEqual(['<1x2 double, not decoded>', false, 0]);
    const saved = JSON.parse(text.serializeSource(textRoot.name)!.text!);
    const out = saved.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === 'c');
    expect(out.value).toEqual(entry.value);

    // Binary: fixtures/sparse/sparse_binary.sldd with its entry c's hex Value the stream.
    const parts = unzipSync(testFile('fixtures/sparse/sparse_binary.sldd'));
    const chunk = strFromU8(parts['data/chunk0.xml']);
    const named = chunk.indexOf('<P Name="Name" Class="char">c</P>');
    const at = chunk.indexOf('<P Name="Value" Class="cell" Encoding="hex"', named);
    expect([named > 0, at > named]).toEqual([true, true]);
    const digits = Array.from(stream, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
    const tag = `<P Name="Value" Class="double" Encoding="hex" EncodedLength="${stream.length}">`;
    const zip = zipSync({ ...parts, 'data/chunk0.xml': strToU8(chunk.slice(0, at) + tag + digits + chunk.slice(chunk.indexOf('</P>', at))) });
    const binary = createSession();
    const binaryRoot: any = ingest(binary, arrayBufferOf(zip), { filename: 'sparse_binary.sldd' });
    const h = binaryRoot.getSection('design').children.find((e: any) => e.name === 'c');
    expect([h.displayValue, h.valueEditable, h.children.length]).toEqual(['<1x2 double, not decoded>', false, 0]);
    expect(strFromU8(unzipSync((binary.serializeSource(binaryRoot.name) as any).bytes)['data/chunk0.xml'])).toContain(tag + digits + '</P>');
    expect(regenerateChunkXml(binaryRoot)).toContain(tag + digits + '</P>');
  });
});
