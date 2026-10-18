// Copyright 2026 The MathWorks, Inc.
//
// A sparse array whose indices place non-zeros and whose bytes hold none of their values: its
// real part (pr) is of a type with no width, is cut short inside its tag, is absent, or holds
// fewer values than the indices place; or a complex one's imaginary part (pi) is so. MATLAB
// writes no such array, so only a damaged or hand-edited file holds one.
//
// The reader read each value that was not there as 0, and dropped it as a zero: a 3x4 whose
// ir/jc place four non-zeros showed `<3x4 sparse double>` with no rows, an all-zero matrix the
// file never held, and only a record cut short said anything at all. One whose pr held two of
// its four values showed those two. The full-array arm already records the matching damage as
// not decoded (unreadablePart), and a numeric array with no payload is not decoded too.
//
// The maintainer's group F ruling of 2026-10-18 (F1-5; theme 1: warn and show what was read)
// makes it what those are: `<3x4 sparse double, not decoded>`, its class and size being the
// part that was read, with no rows and no editor, and a warning saying why. An array whose
// indices place no non-zero has no value to lose, and reads as before.
//
// Each value is built byte by byte (test/tools/matBytes.ts), so a failure here is about the
// damage and not about a fixture.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync, zlibSync } from 'fflate';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { uuencode } from '../src/datamodel/parser/CdataCodec.js';
import { MatBudgetError, createSession, ingest } from '../src/index.js';
import { CLASS, MI, arrayFlags, cellVar, dims, element, matFile, matrix, numericData, numericVar, sparseVar, structVar, u32le, varName } from './tools/matBytes.js';
import { copyOf, thrownBy } from './tools/pasteVenues.js';

/** A file under test/, as bytes. */
const testFile = (path: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(`./${path}`, import.meta.url))));
const arrayBufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/** `el` as the payload of an miCOMPRESSED record, the way MATLAB stores a variable. */
function zipped(el: Uint8Array): Uint8Array {
  const data = zlibSync(el);
  const out = new Uint8Array(8 + data.length);
  out.set(u32le(MI.COMPRESSED), 0);
  out.set(u32le(data.length), 4);
  out.set(data, 8);
  return out;
}

// S = sparse([1 2 3 2], [1 1 2 4], [10 11 20 30], 3, 4): ir and jc place four non-zeros, at
// (1,1), (2,1), (3,2) and (2,4).
const IR = [0, 1, 2, 1];
const JC = [0, 2, 3, 3, 4];
const worked = { name: 'S', dimensions: [3, 4], ir: IR, jc: JC, real: [10, 11, 20, 30] };

/** The 3x4 `S` above, its indices as MATLAB writes them, followed by `parts` verbatim in place of pr and pi. */
const withParts = (parts: Uint8Array[], opts: { complex?: boolean; logical?: boolean; name?: string } = {}) =>
  matrix([
    arrayFlags(CLASS.SPARSE, { complex: opts.complex, logical: opts.logical, nzmax: 4 }),
    dims([3, 4]),
    varName(opts.name ?? 'S'),
    numericData(MI.INT32, IR),
    numericData(MI.INT32, JC),
    ...parts,
  ]);
const f64 = (values: number[]) => numericData(MI.DOUBLE, values);

// Where pr's tag starts in sparseVar(worked): the record's tag, flags, dims, a one-letter name,
// ir (four int32s) and jc (five, padded to 24 bytes).
const PR_AT = 8 + 16 + 16 + 16 + 24 + 32;
// And pi's, in the complex one: pr is four doubles.
const PI_AT = PR_AT + 8 + 32;

const NOT_DECODED = '<3x4 sparse double, not decoded>';
const widthless = (type: number, part = 'real part') =>
  `its ${part} is of MAT data type ${type}, which has no element width, so none of its 4 elements can be read`;
const cutInTag = (k: number, part = 'real part') => `the bytes end ${k} byte${k === 1 ? '' : 's'} into its ${part}'s 8-byte tag`;
const absent = (part = 'real part') => `its indices place 4 non-zero(s) and its bytes end before their ${part}`;
const short = (held: number, part = 'real part') => `its ${part} holds ${held} of the 4 values its indices place`;

/** The one warning a .mat gives for the value at `part` not decoded for `why`. */
const notDecodedWarning = (part: string, why: string) => ({ code: 'part-unreadable', message: `"${part}" was not decoded: ${why}.`, part });

/** The variable a one-variable file holds, as read: its value, why it was not decoded, and whether it holds non-zeros. */
const read = (bytes: Uint8Array) => {
  const parsed = parseMat(matFile([bytes]));
  expect(parsed.variables).toHaveLength(1);
  const v = parsed.variables[0];
  return { v: [v.value, v.undecoded, v.sparse ? v.sparse.row.length : null], warnings: parsed.warnings };
};

/** A row as a host is shown it: its name, value, class, whether it offers an editor, and its rows. */
const row = (n: any): unknown => [n.name, n.displayValue, n.className, n.valueEditable, n.children.map(row)];

describe('a sparse array whose non-zeros have no values in the file is shown as not decoded, never as zeros', () => {
  it('its real part of a type with no width', () => {
    for (const type of [0, MI.MATRIX, MI.COMPRESSED, MI.UTF8, MI.UTF16, 18, 255]) {
      for (const bytes of [0, 32]) {
        // Before: ['<3x4 sparse double>', undefined, 0], and no warning.
        expect([type, bytes, read(withParts([element(type, new Uint8Array(bytes))]))], `type ${type}, ${bytes} bytes`).toEqual([
          type,
          bytes,
          { v: [NOT_DECODED, widthless(type), null], warnings: [notDecodedWarning('S', widthless(type))] },
        ]);
      }
    }
  });

  it('a record cut short inside its real part\'s tag, bare and compressed, or right before it', () => {
    const full = sparseVar(worked);
    expect(full.slice(PR_AT, PR_AT + 4)).toEqual(u32le(MI.DOUBLE));
    for (const [what, wrap] of [['record', (b: Uint8Array) => b], ['compressed', zipped]] as const) {
      for (let k = 0; k <= 7; k++) {
        const parsed = parseMat(matFile([wrap(full.slice(0, PR_AT + k))]));
        const v = parsed.variables[0];
        const why = k === 0 ? absent() : cutInTag(k);
        // Before: '<3x4 sparse double>' with no rows, and the record's warning alone.
        expect([what, k, v.name, v.value, v.undecoded], `${what} ${k}`).toEqual([what, k, 'S', NOT_DECODED, why]);
        expect(parsed.warnings.map((w) => [w.part, w.message.slice(0, 20)]), `${what} ${k}`).toEqual([
          ['S', what === 'record' ? 'A record at byte 128' : 'A compressed record '],
          ['S', '"S" was not decoded:'],
        ]);
      }
    }
    // Cut inside pr's data, after two and a half of its four values.
    const cut = parseMat(matFile([full.slice(0, PR_AT + 8 + 20)]));
    expect([cut.variables[0].value, cut.variables[0].undecoded]).toEqual([NOT_DECODED, short(2)]);
  });

  it('no real part at all after its indices', () => {
    // A record whose length is its own: nothing but the variable says anything is missing.
    // Before: '<3x4 sparse double>', 0 rows, no warning.
    expect(read(sparseVar({ ...worked, omitData: true }))).toEqual({ v: [NOT_DECODED, absent(), null], warnings: [notDecodedWarning('S', absent())] });
    // A logical one says its class.
    const logical = read(withParts([], { logical: true }));
    expect(logical.v).toEqual(['<3x4 sparse logical, not decoded>', absent(), null]);
  });

  it('a real part that holds fewer values than its indices place', () => {
    // Before: two rows, (1,1) = 10 and (2,1) = 11, and no warning: the matrix shown was neither
    // the file's nor all of what it said.
    for (const held of [0, 1, 2, 3]) {
      expect(read(withParts([f64([10, 11, 20].slice(0, held))])), `${held} held`).toEqual({
        v: [NOT_DECODED, short(held), null],
        warnings: [notDecodedWarning('S', short(held))],
      });
    }
    // At a narrower type, counted in its own values: three int8s are three of the four.
    expect(read(withParts([numericData(MI.INT8, [1, 2, 3])])).v).toEqual([NOT_DECODED, short(3), null]);
  });

  it('a complex one whose imaginary part has no width, is cut short, is absent, or holds too few', () => {
    const re = f64([10, 11, 20, 30]);
    for (const type of [0, MI.UTF8, 255]) {
      expect(read(withParts([re, element(type, new Uint8Array(32))], { complex: true })), `type ${type}`).toEqual({
        v: [NOT_DECODED, widthless(type, 'imaginary part'), null],
        warnings: [notDecodedWarning('S', widthless(type, 'imaginary part'))],
      });
    }
    expect(read(withParts([re], { complex: true })).v).toEqual([NOT_DECODED, absent('imaginary part'), null]);
    expect(read(withParts([re, f64([1])], { complex: true })).v).toEqual([NOT_DECODED, short(1, 'imaginary part'), null]);
    const z = sparseVar({ ...worked, imag: [1, 2, 3, 4] });
    expect(z.slice(PI_AT, PI_AT + 4)).toEqual(u32le(MI.DOUBLE));
    const cut = parseMat(matFile([z.slice(0, PI_AT + 5)])).variables[0];
    expect([cut.value, cut.undecoded]).toEqual([NOT_DECODED, cutInTag(5, 'imaginary part')]);
    // The real part's reason first, when both are unreadable.
    expect(read(withParts([element(MI.UTF8, new Uint8Array(32)), element(MI.UTF8, new Uint8Array(32))], { complex: true })).v).toEqual([
      NOT_DECODED,
      widthless(MI.UTF8),
      null,
    ]);
  });

  it('as a struct field and as a cell element: named as MATLAB names it, and the value beside it read', () => {
    const one = (n: number) => numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [n] });
    const damaged = withParts([element(MI.UTF8, new Uint8Array(32))], { name: '' });
    const s = parseMat(matFile([structVar('s', ['S', 'g'], [{ S: damaged, g: one(7) }])]));
    const fields = s.variables[0].fields as any;
    expect([fields.S.value, fields.S.undecoded, fields.g.value, s.warnings]).toEqual([
      NOT_DECODED,
      widthless(MI.UTF8),
      7,
      [notDecodedWarning('s.S', widthless(MI.UTF8))],
    ]);
    const c = parseMat(matFile([cellVar('c', [damaged, one(8)])]));
    const [first, second] = c.variables[0].value as any[];
    expect([first.value, first.undecoded, !!first._rawBytes, second.value, c.warnings]).toEqual([
      NOT_DECODED,
      widthless(MI.UTF8),
      true,
      8,
      [notDecodedWarning('c{1}', widthless(MI.UTF8))],
    ]);
  });
});

describe('through a session, as a host opens it', () => {
  const opened = (variables: Uint8Array[]): any => createSession().addMatSource('s.mat', matFile(variables));

  it('one row, not decoded, with no editor and no rows; the file says why, and its copy is refused', () => {
    const mat = opened([
      withParts([element(MI.UTF8, new Uint8Array(32))]),
      sparseVar({ ...worked, name: 'T', omitData: true }),
      withParts([f64([10, 11])], { name: 'U' }),
      sparseVar({ ...worked, name: 'ok' }),
    ]);
    // Before: S, T and U each `<3x4 sparse double>`, the first two with no rows and U with two,
    // 10 and 11, each with an editor, and the file said nothing of any of them.
    expect(mat.children.map(row)).toEqual([
      ['S', NOT_DECODED, 'double', false, []],
      ['T', NOT_DECODED, 'double', false, []],
      ['U', NOT_DECODED, 'double', false, []],
      [
        'ok',
        '<3x4 sparse double>',
        'double',
        false,
        [
          ['1', '10', 'double', true, []],
          ['2', '11', 'double', true, []],
          ['3', '20', 'double', true, []],
          ['4', '30', 'double', true, []],
        ],
      ],
    ]);
    expect(mat.children.map((n: any) => n.isSparse)).toEqual([false, false, false, true]);
    // Before: S's copy was sparse(3,4), all zeros, which pasted and saved as a value the file
    // never held. A value that was not decoded has nothing to copy (F1-10).
    const [e] = thrownBy(() => mat.children[0].serialize());
    expect([e?.name, e instanceof MatBudgetError && e.reason, e?.message]).toEqual([
      'MatBudgetError',
      'not-decoded',
      `Cannot write "S": S is a 3x4 double that was not decoded (${widthless(MI.UTF8)}), so there is no value of it to write. Nothing was written.`,
    ]);
    expect(copyOf(mat.children[3])).toEqual(copyOf(opened([sparseVar(worked)]).children[0]));
  });

  it('in a text dictionary\'s cdata and a binary one\'s hex: not decoded, and saved as it was read', () => {
    const PREAMBLE = [0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00];
    const stream = Uint8Array.from([...PREAMBLE, ...withParts([f64([10, 11])], { name: '' })]);
    const json = JSON.parse(strFromU8(testFile('fixtures/sparse/sparse_text.sldd')));
    const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const entry = entries.find((x: any) => x.name === 'c');
    entry.value = { _type: 'cdata', _value: uuencode(stream) };
    const text = createSession();
    const textRoot: any = text.addDataSource('sparse_text.sldd', JSON.parse(JSON.stringify(json)));
    const c = textRoot.getSection('design').children.find((x: any) => x.name === 'c');
    // Before: `<3x4 sparse double>` with two rows, 10 and 11.
    expect(row(c)).toEqual(['c', NOT_DECODED, 'double', false, []]);
    expect(copyOf(c)).toEqual(entry.value);
    const saved = JSON.parse(text.serializeSource(textRoot.name)!.text!);
    expect(saved.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((x: any) => x.name === 'c').value).toEqual(entry.value);

    const parts = unzipSync(testFile('fixtures/sparse/sparse_binary.sldd'));
    const chunk = strFromU8(parts['data/chunk0.xml']);
    const at = chunk.indexOf('<P Name="Value" Class="cell" Encoding="hex"', chunk.indexOf('<P Name="Name" Class="char">c</P>'));
    expect(at).toBeGreaterThan(0);
    const digits = Array.from(stream, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
    const tag = `<P Name="Value" Class="double" Encoding="hex" EncodedLength="${stream.length}">`;
    const zip = zipSync({ ...parts, 'data/chunk0.xml': strToU8(chunk.slice(0, at) + tag + digits + chunk.slice(chunk.indexOf('</P>', at))) });
    const binary = createSession();
    const binaryRoot: any = ingest(binary, arrayBufferOf(zip), { filename: 'sparse_binary.sldd' });
    const h = binaryRoot.getSection('design').children.find((x: any) => x.name === 'c');
    expect(row(h)).toEqual(['c', NOT_DECODED, 'double', false, []]);
    expect(strFromU8(unzipSync((binary.serializeSource(binaryRoot.name) as any).bytes)['data/chunk0.xml'])).toContain(tag + digits + '</P>');
  });
});

describe('what reads as it did', () => {
  it('an array whose values are all there, or whose indices place no non-zero', () => {
    // The worked array: its four non-zeros.
    const v = parseMat(matFile([sparseVar(worked)]));
    expect([v.variables[0].value, v.variables[0].undecoded, [...v.variables[0].sparse!.re], v.warnings]).toEqual([
      '<3x4 sparse double>',
      undefined,
      [10, 11, 20, 30],
      [],
    ]);
    // Values the file holds as zeros are zeros, and a stored zero is not a non-zero.
    expect(read(withParts([f64([0, 0, 0, 0])]))).toEqual({ v: ['<3x4 sparse double>', undefined, 0], warnings: [] });
    // More values than the indices place: the reserved tail is never read (nzmax is capacity).
    expect(read(withParts([f64([10, 11, 20, 30, 99, 99])])).v).toEqual(['<3x4 sparse double>', undefined, 4]);
    // sparse(3, 4), with MATLAB's empty ir and pr: no non-zero to lose.
    expect(read(sparseVar({ name: 'Z', dimensions: [3, 4], ir: [], jc: [0, 0, 0, 0, 0], real: [] }))).toEqual({
      v: ['<3x4 sparse double>', undefined, 0],
      warnings: [],
    });
    // Its pr absent too, or of a type with no width: still nothing placed, so nothing lost.
    const none = (parts: Uint8Array[]) =>
      matrix([arrayFlags(CLASS.SPARSE, { nzmax: 1 }), dims([3, 4]), varName('Z'), numericData(MI.INT32, []), numericData(MI.INT32, [0, 0, 0, 0, 0]), ...parts]);
    expect(read(none([])).v).toEqual(['<3x4 sparse double>', undefined, 0]);
    expect(read(none([element(MI.UTF8, new Uint8Array(8))])).v).toEqual(['<3x4 sparse double>', undefined, 0]);
    // Cut after its name: no indices, so no non-zero is placed, and its unbacked columns are said.
    const t = read(matrix([arrayFlags(CLASS.SPARSE, { nzmax: 1 }), dims([3, 4]), varName('t')]));
    expect(t).toEqual({
      v: ['<3x4 sparse double>', undefined, 0],
      warnings: [{ code: 'part-unreadable', message: '"t" declares 4 columns and its column index holds 0, so only the non-zeros of those were read.', part: 't' }],
    });
  });
});
