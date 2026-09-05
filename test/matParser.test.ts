// Copyright 2026 The MathWorks, Inc.
//
// Direct unit tests for the Level-5 MAT-file reader (parseMat/parseMatrix) and the
// .mxarray reader that shares its matrix logic.
//
// Every other test that touches these parsers goes through a MATLAB-authored
// fixture, which means they only ever see well-formed bytes in the handful of
// shapes MATLAB happens to write: 2-D doubles, scalar structs, cells, chars, MCOS
// opaques. This file synthesizes the bytes instead (see test/tools/matBytes.ts),
// which is the only practical way to reach two whole categories:
//
//   1. Valid-but-unwritten shapes — N-D arrays, every non-double numeric width,
//      complex arrays, UTF-16 char data, struct ARRAYS.
//   2. Malformed streams. Byte counts and the struct field-name stride are all
//      self-declared in this format, and nothing downstream re-checks them, so a
//      truncated download decides how far the reader indexes and how a loop
//      advances. `parseMat` is called unguarded from `DataModel.addMatSource`, so
//      anything it throws fails the entire file open.
//
// Four real defects were found here and are pinned below, each marked REGRESSION.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { parseMxArray } from '../src/datamodel/parser/MxArrayParser.js';
import { createSession } from '../src/index.js';
import NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import {
  CLASS,
  MI,
  arrayFlags,
  cellVar,
  charVar,
  dims,
  element,
  hdf5MatFile,
  matFile,
  matrix,
  mxArrayFile,
  numericVar,
  objectVar,
  sparseVar,
  structVar,
  u32le,
  varName,
} from './tools/matBytes.js';

/** A named double variable of the given shape, as a one-variable .mat buffer. */
function doubleFile(name: string, dimensions: number[], real: number[]): ArrayBuffer {
  return matFile([numericVar({ name, cls: CLASS.DOUBLE, dimensions, real })]);
}

/** The single variable in a one-variable file. */
function only(buffer: ArrayBuffer) {
  const parsed = parseMat(buffer);
  expect(parsed.variables).toHaveLength(1);
  return parsed.variables[0];
}

/**
 * A MATLAB-authored fixture from test/fixtures, as a detached ArrayBuffer.
 *
 * Everything else in this file is synthesized, on purpose (see the header). The two
 * fixtures read through here are the exceptions: both were harvested by
 * `probe_string.m` specifically so a synthesized claim could be checked against
 * MATLAB's own bytes.
 */
function fixtureBytes(name: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** An unnamed 1x1 double, for use as a struct field or cell element. */
const scalarField = (n: number) => numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [n] });

/** Overwrite the declared byte count of the tag at `tagOffset`, corrupting it. */
function corruptLength(el: Uint8Array, tagOffset: number, declared: number): Uint8Array {
  const copy = el.slice();
  new DataView(copy.buffer).setUint32(tagOffset + 4, declared, true);
  return copy;
}

// Offsets of the subelement tags inside a numericVar, which writes
// flags/dims/name/payload as 16-byte long-form elements after the 8-byte matrix tag.
const TAG = { flags: 8, dims: 24, name: 40, payload: 56 };

describe('parseMat — file-level framing', () => {
  it('keeps the header text and reads a named scalar', () => {
    const parsed = parseMat(doubleFile('x', [1, 1], [42]));
    expect(parsed.header).toContain('MATLAB 5.0 MAT-file');
    expect(parsed.variables[0]).toMatchObject({ name: 'x', className: 'double', dimensions: [1, 1], value: 42 });
  });

  it('rejects a big-endian file rather than decoding it as little-endian', () => {
    // Silently misreading every number would be far worse than refusing the file.
    expect(() => parseMat(doubleFile('x', [1, 1], [1]))).not.toThrow();
    expect(() => parseMat(matFile([scalarField(1)], { endian: 'MI' }))).toThrow('Big-endian MAT files not supported');
  });

  it('REGRESSION: names the real problem when the file is shorter than the header', () => {
    // The 128-byte header was read before its size was checked, so the message the
    // user got depended on how short the file was: an empty or truncated download
    // failed with "Invalid typed array length: 116" from the header slice, and
    // anything from 116 to 127 bytes read its endian indicator out of the tail of
    // the header and blamed "Big-endian MAT files not supported" — pointing at a
    // format we simply do not implement rather than at the damaged file. Both
    // reach the user verbatim, as "Failed to parse <name>.mat: <message>".
    for (const size of [0, 1, 116, 120, 127]) {
      expect(() => parseMat(new ArrayBuffer(size)), `${size} bytes`).toThrow(
        'Not a MAT-file: shorter than the 128-byte header',
      );
    }
    // A header-only file is legal — a .mat holding no variables.
    const empty = parseMat(matFile([]));
    expect(empty.variables).toEqual([]);
    expect(empty.header).toContain('MATLAB 5.0 MAT-file');
  });

  it('refuses a -v7.3 file rather than reporting it as an empty one', () => {
    // A -v7.3 file is HDF5 behind a 128-byte header of exactly the Level-5 shape, so
    // every framing guard above passes it: it is longer than 128 bytes, and its endian
    // indicator is a real little-endian 'IM'. The record loop then reads its first tag
    // out of HDF5 userblock padding, gets 0/0, and takes the legitimate "no more
    // variables" exit — so the file parsed successfully with nothing in it, which is
    // indistinguishable from the header-only file the test above says is legal. -v7.3
    // is what MATLAB requires above 2 GB and what many users set by habit.
    //
    // Matched on the header's version prefix, not on the whole string: the platform and
    // date text varies per file. Two synthesized headers differing in everything but
    // the version prove the check does not depend on either one's text — and the third
    // case is the file MATLAB itself wrote, which is what says the synthesized two are
    // shaped like anything real.
    for (const headerText of [
      undefined,
      'MATLAB 7.3 MAT-file, Platform: GLNXA64, Created on: Tue Jan 07 23:59:59 2014 HDF5 schema 1.00',
    ]) {
      expect(() => parseMat(hdf5MatFile({ headerText })), String(headerText)).toThrow(
        'MAT-file version 7.3 (HDF5) is not supported',
      );
    }
    // `save('strings_v73.mat', '-v7.3', 'sRow')` — probe_string.m:80, harvested. 8 KB
    // of HDF5 for one 1x3 string array, which is itself the reason the refusal has to
    // be by header and not by content: there is nothing in here a Level-5 reader can
    // make sense of.
    expect(() => parseMat(fixtureBytes('strings_v73.mat')), 'MATLAB-authored').toThrow(
      'MAT-file version 7.3 (HDF5) is not supported',
    );
  });

  it('is refused by the same header text MATLAB actually writes', () => {
    // The guard on the guard. The refusal above is a string match against a header
    // whose text was invented for years (matBytes.V73_HEADER_TEXT), so it could have
    // been matching a prefix MATLAB never writes and no test would have noticed. This
    // reads the first 116 bytes of MATLAB's own -v7.3 file and pins the shape.
    const header = Buffer.from(fixtureBytes('strings_v73.mat'), 0, 116).toString('latin1');
    expect(header).toMatch(/^MATLAB 7\.3 MAT-file, Platform: \w+, Created on: .+ HDF5 schema 1\.00 \.\s*$/);
    // Byte 124-125 is the version field, and it is the one place a v7.3 file differs
    // from a Level-5 one structurally rather than in prose: 0x0200 against 0x0100.
    // Recorded, not relied on — the reader reads the text — but it is what a future
    // reader that wants to stop trusting prose would use.
    const bytes = new Uint8Array(fixtureBytes('strings_v73.mat'));
    expect([bytes[124], bytes[125]]).toEqual([0x00, 0x02]);
    expect([bytes[126], bytes[127]]).toEqual([0x49, 0x4d]);
    // And the endian indicator really is the little-endian one, which is why every
    // framing guard in the test above passes the file through to the version check.
    const level5 = new Uint8Array(matFile([]));
    expect([level5[126], level5[127]]).toEqual([bytes[126], bytes[127]]);
    expect([level5[124], level5[125]]).toEqual([0x00, 0x01]);
  });

  it('reads every variable in a multi-variable file, in order', () => {
    const parsed = parseMat(
      matFile([
        numericVar({ name: 'a', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [1] }),
        numericVar({ name: 'b', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [2] }),
      ]),
    );
    expect(parsed.variables.map((v) => [v.name, v.value])).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('stops at the zero terminator and at a tag too short to read', () => {
    const one = numericVar({ name: 'a', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [1] });
    expect(parseMat(matFile([one], { trailing: new Uint8Array(8) })).variables).toHaveLength(1);
    // Four stray bytes cannot hold a tag; the loop must break, not read past them.
    expect(parseMat(matFile([one], { trailing: new Uint8Array(4) })).variables).toHaveLength(1);
  });

  it('keeps an unnamed element as an anonymous variable with its raw bytes', () => {
    // MCOS metadata arrives as a nameless FileWrapper element. MatNode hands its
    // bytes to the MCOS decoder and writes them back verbatim on save, so the
    // parser must preserve rather than discard it.
    const anon = matrix([arrayFlags(CLASS.DOUBLE), dims([1, 1]), varName(''), element(MI.DOUBLE, new Uint8Array(8))]);
    const parsed = parseMat(matFile([anon]));
    expect(parsed.variables).toHaveLength(1);
    expect(parsed.variables[0]._anonymous).toBe(true);
    expect(parsed.variables[0]._rawBytes!.length).toBeGreaterThan(0);
  });

  it('ignores a top-level element that is neither a matrix nor compressed', () => {
    const parsed = parseMat(matFile([element(MI.DOUBLE, new Uint8Array(8))]));
    expect(parsed.variables).toEqual([]);
  });
});

describe('parseMat — numeric shapes', () => {
  it('reads each integer and float width at its own element size', () => {
    // A width mistake here is silent: the values come back plausible but wrong,
    // so each class is pinned against exact expected numbers.
    const widths: Array<[number, string]> = [
      [CLASS.SINGLE, 'single'],
      [CLASS.INT8, 'int8'],
      [CLASS.UINT8, 'uint8'],
      [CLASS.INT16, 'int16'],
      [CLASS.UINT16, 'uint16'],
      [CLASS.INT32, 'int32'],
      [CLASS.UINT32, 'uint32'],
      [CLASS.INT64, 'int64'],
      [CLASS.UINT64, 'uint64'],
    ];
    for (const [cls, expected] of widths) {
      const v = only(matFile([numericVar({ name: 'n', cls, dimensions: [1, 3], real: [1, 2, 3] })]));
      expect(v.className, expected).toBe(expected);
      expect(v.value, expected).toEqual([1, 2, 3]);
    }
  });

  it('reads a negative value back at the signed widths', () => {
    for (const cls of [CLASS.INT8, CLASS.INT16, CLASS.INT32, CLASS.INT64, CLASS.SINGLE, CLASS.DOUBLE]) {
      expect(only(matFile([numericVar({ name: 'n', cls, dimensions: [1, 1], real: [-7] })])).value).toBe(-7);
    }
  });

  it('reports an unrecognized payload element type as zeros rather than throwing', () => {
    // The reader's own `default` arm. A UTF8-tagged payload under a double class is
    // not something MATLAB writes, so the only requirement is that it stays inside
    // the buffer and produces the declared element count.
    const v = only(
      matFile([
        numericVar({ name: 'u', cls: CLASS.DOUBLE, dimensions: [1, 2], dataType: MI.UTF8, real: [], rawReal: new Uint8Array(16) }),
      ]),
    );
    expect(v.value).toEqual([0, 0]);
  });

  it('unwraps a 1x1 array to a bare number but keeps a vector as an array', () => {
    expect(only(doubleFile('s', [1, 1], [5])).value).toBe(5);
    expect(only(doubleFile('v', [1, 3], [5, 6, 7])).value).toEqual([5, 6, 7]);
  });

  it('reads a 0x0 array as an empty list', () => {
    // MATLAB still writes a (zero-length) payload subelement for `[]`, so the
    // reader takes the numeric path and produces `[]` — distinct from the `null`
    // that means "no payload was present at all" in the next test.
    const v = only(matFile([numericVar({ name: 'e', cls: CLASS.DOUBLE, dimensions: [0, 0], real: [] })]));
    expect(v.dimensions).toEqual([0, 0]);
    expect(v.value).toEqual([]);
  });

  it('leaves the value null when the payload subelement is missing entirely', () => {
    // A variable truncated after its name. `offset < end` is false, so no payload
    // is read at all — the guard exists so the reader does not fabricate values.
    const v = only(matFile([numericVar({ name: 'no', cls: CLASS.DOUBLE, dimensions: [1, 2], real: [], omitData: true })]));
    expect(v.value).toBeNull();
  });

  it('carries the logical flag without changing the stored numbers', () => {
    const v = only(matFile([numericVar({ name: 'b', cls: CLASS.UINT8, dimensions: [1, 3], real: [1, 0, 1], logical: true })]));
    expect(v.isLogical).toBe(true);
    expect(v.value).toEqual([1, 0, 1]);
  });

  it('pairs real and imaginary parts elementwise for a complex array', () => {
    const v = only(matFile([numericVar({ name: 'z', cls: CLASS.DOUBLE, dimensions: [1, 2], real: [1, 3], imag: [2, -4] })]));
    expect(v.isComplex).toBe(true);
    expect(v.value).toEqual([
      { re: 1, im: 2 },
      { re: 3, im: -4 },
    ]);
  });

  it('reads only the real part when the complex flag is set but no imaginary block follows', () => {
    // Truncated after the real payload: the pairing must not read past `end` into
    // whatever bytes happen to be next.
    const el = matrix([
      arrayFlags(CLASS.DOUBLE, { complex: true }),
      dims([1, 1]),
      varName('z'),
      element(MI.DOUBLE, new Uint8Array(8)),
    ]);
    const v = only(matFile([el]));
    expect(v.isComplex).toBe(true);
    expect(v.value).toBe(0);
  });
});

describe('parseMat — column-major to row-major', () => {
  it('transposes a 2-D matrix and leaves vectors untouched', () => {
    // MATLAB stores [1 3 5; 2 4 6] as the column-major run 1..6.
    expect(only(doubleFile('m', [2, 3], [1, 2, 3, 4, 5, 6])).value).toEqual([1, 3, 5, 2, 4, 6]);
    expect(only(doubleFile('row', [1, 4], [1, 2, 3, 4])).value).toEqual([1, 2, 3, 4]);
    expect(only(doubleFile('col', [4, 1], [1, 2, 3, 4])).value).toEqual([1, 2, 3, 4]);
  });

  it('REGRESSION: transposes every page of an N-D array instead of dropping all but the first', () => {
    // transposeFromColMajor sized its result to values.length but only wrote the
    // first rows*cols page, leaving the rest as HOLES in a sparse array. Holes read
    // back as undefined and — because Array.prototype.forEach skips them — the node
    // layer then built children for the first page only. A 2x3x2 lost half its data
    // on open, with no error anywhere and a serialized value that matched the tree.
    const v = only(doubleFile('nd', [2, 3, 2], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    expect(v.value).toEqual([1, 3, 5, 2, 4, 6, 7, 9, 11, 8, 10, 12]);
    expect((v.value as unknown[]).filter((x) => x === undefined)).toEqual([]);
  });

  it('REGRESSION: the node layer keeps a child per element of an N-D array', () => {
    // The parser-level assertion above is what broke; this is the symptom a user
    // would actually have seen — six of twelve rows, and a save that wrote six.
    const session = createSession();
    const mat = session.addMatSource('nd.mat', doubleFile('nd', [2, 3, 2], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])) as any;
    const node = mat.children[0];
    expect(node.children).toHaveLength(12);
    // The serialized form used to be the bare list [1,3,5,2,4,6,7,9,11,8,10,12]:
    // every element present, but nowhere to put [2,3,2], so writing this entry into
    // a dictionary turned MATLAB's 2x3x2 into a 1x12 (defect 15, hole 2).
    //
    // It now takes the cdata MAT stream, which is the only form MATLAB reads at
    // rank >= 3: the typed `Matrix(2,3,2)` literal that first closed this hole is
    // read back by MATLAB as an empty 1x0 in every spelling, so the entry saved
    // clean and opened destroyed (defect 22, test/parity/matlab/probe_rank3_serial.m
    // and probe_nd_rich.m). What matters here is the same thing it always was —
    // twelve elements and the shape — so this reads the bytes back rather than
    // matching a string.
    const out = node.serializeValue() as Record<string, unknown>;
    expect(out._type).toBe('cdata');
    const back = NodeRegistry.parseValue(out, 'nd', null) as any;
    expect(back._dims).toEqual([2, 3, 2]);
    expect(back.children).toHaveLength(12);
    expect(back.children.map((c: any) => c.displayValue)).toEqual(
      node.children.map((c: any) => c.displayValue),
    );
  });

  it('leaves a trailing partial page in place rather than dropping it', () => {
    // Declared 2x2x2 but only six values present. The last page is incomplete, so
    // it cannot be transposed — but its values must still survive.
    expect(only(doubleFile('nd', [2, 2, 2], [1, 2, 3, 4, 5, 6])).value).toEqual([1, 3, 2, 4, 5, 6]);
  });
});

describe('parseMat — char arrays', () => {
  it('decodes UTF-8, UINT8 and INT8 payloads as text', () => {
    for (const type of [MI.UTF8, MI.UINT8, MI.INT8]) {
      expect(only(matFile([charVar('c', 'hello', type)])).value).toBe('hello');
    }
  });

  it('decodes a UTF-16 payload, which a byte-wise decoder would mangle', () => {
    for (const type of [MI.UTF16, MI.UINT16]) {
      expect(only(matFile([charVar('c', 'héllo', type)])).value).toBe('héllo');
    }
  });

  it('falls back to UTF-8 for an unexpected char payload type', () => {
    expect(only(matFile([charVar('c', 'abcd', MI.INT32)])).value).toBe('abcd');
  });

  it('leaves the value null when the char payload is missing', () => {
    const el = matrix([arrayFlags(CLASS.CHAR), dims([1, 3]), varName('c')]);
    expect(only(matFile([el])).value).toBeNull();
  });
});

describe('parseMat — structs', () => {
  it('reads a scalar struct as one child variable per field', () => {
    const v = only(matFile([structVar('s', ['a', 'b'], [{ a: scalarField(1), b: scalarField(2) }])]));
    expect(v.className).toBe('struct');
    expect(Object.keys(v.fields!)).toEqual(['a', 'b']);
    expect((v.fields!.a as { value: unknown }).value).toBe(1);
    expect((v.fields!.b as { value: unknown }).value).toBe(2);
  });

  it('keeps each field child raw bytes, which the writer passes back through', () => {
    const v = only(matFile([structVar('s', ['a'], [{ a: scalarField(1) }])]));
    expect((v.fields!.a as { _rawBytes?: Uint8Array })._rawBytes!.length).toBeGreaterThan(0);
  });

  it('collects a struct ARRAY field into a list, one entry per element', () => {
    // A 1x2 struct array stores all of element 1's fields, then element 2's. The
    // scalar case yields the child directly; the array case must yield a list, or
    // element 2 would overwrite element 1 under the same key.
    const v = only(
      matFile([
        structVar(
          's',
          ['a', 'b'],
          [
            { a: scalarField(1), b: scalarField(2) },
            { a: scalarField(3), b: scalarField(4) },
          ],
          [1, 2],
        ),
      ]),
    );
    expect(v.dimensions).toEqual([1, 2]);
    expect((v.fields!.a as Array<{ value: unknown }>).map((c) => c.value)).toEqual([1, 3]);
    expect((v.fields!.b as Array<{ value: unknown }>).map((c) => c.value)).toEqual([2, 4]);
  });

  it('keeps the elements it has when a struct array is truncated mid-stream', () => {
    const v = only(matFile([structVar('s', ['a'], [{ a: scalarField(9) }], [1, 2])]));
    expect((v.fields!.a as Array<{ value: unknown }>).map((c) => c.value)).toEqual([9]);
  });

  it('skips a field slot whose element is not a matrix', () => {
    const notAMatrix = element(MI.DOUBLE, new Uint8Array(8));
    const v = only(matFile([structVar('s', ['a'], [{ a: notAMatrix }])]));
    expect(v.fields).toEqual({});
  });

  it('ignores padding in the field-name block rather than inventing empty names', () => {
    // Names are fixed-stride and zero-padded; a stride that holds no name at all
    // must not become a '' key.
    const lenData = new Uint8Array(4);
    new DataView(lenData.buffer).setInt32(0, 8, true);
    const names = new Uint8Array(16);
    names.set(new TextEncoder().encode('a'), 0); // second stride left all zero
    const el = matrix([
      arrayFlags(CLASS.STRUCT),
      dims([1, 1]),
      varName('s'),
      element(MI.INT32, lenData),
      element(MI.INT8, names),
      scalarField(1),
    ]);
    expect(Object.keys(only(matFile([el])).fields!)).toEqual(['a']);
  });

  it('REGRESSION: a zero field-name stride ends the parse instead of hanging forever', () => {
    // fieldNameLen is read from the file and used as the increment of the loop that
    // walks the name block: `for (i = 0; i < len; i += fieldNameLen)`. A corrupt 0
    // (or negative) stride made that loop never advance, so parseMat spun forever —
    // not an exception a caller could report, but a hung open with no way out. The
    // 8s default test timeout is what caught it.
    const lenData = new Uint8Array(4);
    new DataView(lenData.buffer).setInt32(0, 0, true);
    const el = matrix([
      arrayFlags(CLASS.STRUCT),
      dims([1, 1]),
      varName('s'),
      element(MI.INT32, lenData),
      element(MI.INT8, new TextEncoder().encode('abc\0')),
    ]);
    const v = only(matFile([el]));
    expect(v.fields).toEqual({});
  });

  it('leaves fields null when the struct is truncated before its field-name length', () => {
    const el = matrix([arrayFlags(CLASS.STRUCT), dims([1, 1]), varName('s')]);
    expect(only(matFile([el])).fields).toBeNull();
  });
});

describe('parseMat — cell arrays', () => {
  it('reads each cell element as its own variable', () => {
    const v = only(matFile([cellVar('c', [scalarField(7), charVar('', 'hi', MI.UTF8)], [1, 2])]));
    expect(v.className).toBe('cell');
    const cells = v.value as Array<{ value: unknown }>;
    expect(cells.map((c) => c.value)).toEqual([7, 'hi']);
  });

  it('records a non-matrix cell slot as null so positions stay aligned', () => {
    // Dropping it would shift every later element into the wrong index.
    const v = only(matFile([cellVar('c', [element(MI.DOUBLE, new Uint8Array(8)), scalarField(7)], [1, 2])]));
    expect((v.value as unknown[])[0]).toBeNull();
    expect(((v.value as Array<{ value: unknown }>)[1] as { value: unknown }).value).toBe(7);
  });

  it('reads an empty cell as an empty list', () => {
    expect(only(matFile([cellVar('c', [], [0, 0])])).value).toEqual([]);
  });

  it('stops at the declared element count even if more elements follow', () => {
    const v = only(matFile([cellVar('c', [scalarField(1), scalarField(2)], [1, 1])]));
    expect((v.value as unknown[])).toHaveLength(1);
  });

  it('nests: a cell holding a struct holding a cell', () => {
    const inner = cellVar('', [scalarField(3)], [1, 1]);
    const st = structVar('', ['f'], [{ f: inner }]);
    const v = only(matFile([cellVar('outer', [st], [1, 1])]));
    const cell0 = (v.value as Array<{ fields: Record<string, { value: unknown }> }>)[0];
    const innerCell = cell0.fields.f as unknown as { value: Array<{ value: unknown }> };
    expect(innerCell.value[0].value).toBe(3);
  });
});

// Every buffer below is synthesized by `sparseVar`, whose byte layout is written out
// field by field in test/tools/matBytes.ts and taken from the MAT-file format spec.
// That layout is no longer a claim about MATLAB: `probe_string.m` saved every one of
// these matrices and the file is checked in as test/fixtures/sparse_cases.mat, which
// the describe block AFTER this one reads. Each case there is the same matrix as one
// here, and the two are asserted to decode identically — so what these tests add is
// the shapes MATLAB cannot be asked for (a truncated file, a 2000x2000, a reserved
// but unused nzmax) on a byte layout that has been checked against MATLAB's own.
//
// The MATLAB call each fixture stands for stays quoted in the test that uses it.
describe('parseMat — sparse arrays (class 5)', () => {
  // S = sparse([1 2 3 2], [1 1 2 4], [10 11 20 30], 3, 4)
  //
  //        c1   c2   c3   c4
  //   r1   10    .    .    .
  //   r2   11    .    .   30
  //   r3    .   20    .    .
  //
  // Non-zeros in column-major order: (1,1)=10, (2,1)=11, (3,2)=20, (2,4)=30, which is
  // what `[i, j, s] = find(S)` returns. So ir (0-based rows) is [0 1 2 1]; jc holds
  // one start per column plus the total, [0 2 3 3 4] — column 1 owns ir[0..1],
  // column 2 owns ir[2], column 3 owns NOTHING (jc[2] === jc[3]), column 4 owns ir[3].
  //
  // Deliberately non-square, with a two-entry column, an empty column, a non-zero in
  // the last column and a first row that is all but empty: a transposed read, an
  // off-by-one in the column walk and a dropped empty column each change the answer.
  const worked = {
    name: 'S',
    dimensions: [3, 4],
    ir: [0, 1, 2, 1],
    jc: [0, 2, 3, 3, 4],
    real: [10, 11, 20, 30],
  };
  const workedDense = [10, 0, 0, 0, 11, 0, 0, 30, 0, 20, 0, 0];

  it('materializes the dense matrix from the ir/jc index arrays', () => {
    const v = only(matFile([sparseVar(worked)]));
    // The class stays 'sparse' — that the file stored it sparse is the one fact the
    // dense value cannot carry, and it is what keeps MatWriter refusing to write it.
    expect(v.className).toBe('sparse');
    expect(v.dimensions).toEqual([3, 4]);
    // Row-major, like every other numeric class: the node layer reads values in the
    // order it renders them.
    expect(v.value).toEqual(workedDense);
    expect(v.undecoded).toBeUndefined();
  });

  it('reads only the non-zeros jc accounts for, not the capacity nzmax reserved', () => {
    // nzmax is CAPACITY: the field says how many non-zeros the arrays have ROOM for,
    // and jc is the only subelement that says how many are real. A reader that zips ir
    // with pr, or takes ir.length for the count, puts eight fabricated values in this
    // matrix — modelled here as row 1 / value 99, both in range and both wrong.
    //
    // DEFENSIVE, and knowingly so. This was written as `S = spalloc(3, 4, 10);
    // S(1,1) = 7; S(3,2) = 8;` on the assumption that a spalloc'ed matrix reaches the
    // file with its reserved space in it. It does not: `save` TRIMS. MATLAB's own
    // bytes for that exact matrix (spAlloc in sparse_cases.mat, measured) declare
    // `nzmax=2`, with an ir of two entries and a pr of two values — the padding never
    // leaves memory. So no MATLAB-written file is believed to reach the reader in this
    // shape; what is asserted here is that the reader would survive one, because
    // nothing in the format forbids it and jc is authoritative either way.
    const v = only(
      matFile([
        sparseVar({
          name: 'S',
          dimensions: [3, 4],
          nzmax: 10,
          ir: [0, 2, 1, 1, 1, 1, 1, 1, 1, 1],
          jc: [0, 1, 2, 2, 2],
          real: [7, 8, 99, 99, 99, 99, 99, 99, 99, 99],
        }),
      ]),
    );
    expect(v.value).toEqual([7, 0, 0, 0, 0, 0, 0, 0, 0, 8, 0, 0]);
  });

  it('pairs real and imaginary parts of a complex sparse matrix', () => {
    // Z = sparse([1 2], [1 2], [1+2i, 3-4i], 2, 2) — the two non-zeros on the diagonal.
    const v = only(
      matFile([
        sparseVar({ name: 'Z', dimensions: [2, 2], ir: [0, 1], jc: [0, 1, 2], real: [1, 3], imag: [2, -4] }),
      ]),
    );
    expect(v.isComplex).toBe(true);
    // Every zero is a complex zero, not a bare 0: the complex arm downstream reads
    // `.re`/`.im` off every element it is handed.
    expect(v.value).toEqual([
      { re: 1, im: 2 },
      { re: 0, im: 0 },
      { re: 0, im: 0 },
      { re: 3, im: -4 },
    ]);
  });

  it('keeps the logical flag and reads the payload at its own declared width', () => {
    // sparse(logical([1 0; 0 1])). The element type here was a GUESS when this was
    // written — nothing in the corpus said which one MATLAB uses for a logical sparse —
    // and the guess was right: MATLAB writes miUINT8, two bytes for two non-zeros, with
    // 0x02 set in the array flags (measured off spLogical in sparse_cases.mat). What
    // the test pins is width-independent regardless: the payload is read at the type
    // its own tag declares, not at the class's natural width, which for class 5 would
    // be 8 bytes and would read two values as one — and isLogical survives for the node
    // layer to render as true/false.
    const v = only(
      matFile([
        sparseVar({
          name: 'L',
          dimensions: [2, 2],
          ir: [0, 1],
          jc: [0, 1, 2],
          real: [1, 1],
          logical: true,
          dataType: MI.UINT8,
        }),
      ]),
    );
    expect(v.isLogical).toBe(true);
    expect(v.value).toEqual([1, 0, 0, 1]);
  });

  it('reads an all-zero sparse matrix as zeros rather than as an empty value', () => {
    // sparse(3, 4): no non-zeros at all. ir is a zero-length element and jc is cols+1
    // zeros — which was the reading of the format doc this fixture was built on, and is
    // now measured: MATLAB writes ir and pr as elements with a real tag and a length of
    // 0, rather than omitting them, and declares `nzmax=1` where nnz is 0. A sparse
    // matrix holding nothing is still a 3x4 of zeros, which is a different value from
    // the `[]` the empty-double test above asserts.
    const v = only(matFile([sparseVar({ name: 'Z34', dimensions: [3, 4], ir: [], jc: [0, 0, 0, 0, 0], real: [] })]));
    expect(v.value).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // sparse([]) — 0x0, which really does hold nothing.
    const e = only(matFile([sparseVar({ name: 'E', dimensions: [0, 0], ir: [], jc: [0], real: [] })]));
    expect(e.value).toEqual([]);
  });

  it('records a sparse matrix too large to materialize instead of throwing or truncating', () => {
    // sparse(2000, 2000) with one non-zero: 30 bytes of index arrays declaring four
    // million elements. This is the shape a real sparse matrix has — its declared
    // size says nothing about how much data is present — and `sparse(1e6, 1e6)` would
    // ask for `new Array(1e12)`, a RangeError out of a reader no caller catches, so
    // one variable would fail the whole file open. Refused by name and by reason
    // instead, through the same channel class 3 uses.
    const v = only(matFile([sparseVar({ name: 'big', dimensions: [2000, 2000], ir: [0], jc: [0, 1, 1], real: [5] })]));
    expect(v.className).toBe('sparse');
    expect(v.value).toBe('<2000x2000 sparse, not decoded>');
    expect(v.undecoded).toContain('larger than this reader materializes');
    // Under the limit, the same shape of file decodes: the refusal is about size only.
    expect(only(matFile([sparseVar({ name: 'ok', dimensions: [1000, 1000], ir: [0], jc: [0, 1, 1], real: [5] })])).undecoded)
      .toBeUndefined();
  });

  it('survives a sparse file truncated at every offset past the header', () => {
    // The same blunt sweep the numeric shapes get: a caller cannot tell "corrupt
    // file" from "bug in the reader" when a truncation throws. The two index arrays
    // are two more self-declared lengths per variable, all of them feeding loop
    // bounds and DataView indices.
    const full = new Uint8Array(matFile([sparseVar(worked)]));
    for (let cut = 128; cut <= full.length; cut++) {
      const sliced = full.slice(0, cut);
      const buffer = sliced.buffer.slice(sliced.byteOffset, sliced.byteOffset + sliced.byteLength) as ArrayBuffer;
      expect(() => parseMat(buffer), `truncated to ${cut}`).not.toThrow();
    }
    // Truncated right after the indices, with no pr at all: no values to place, and
    // the reader must not fabricate any.
    const noData = only(matFile([sparseVar({ ...worked, omitData: true })]));
    expect(noData.value).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('reaches the node layer as the matrix it is, one child row per element', () => {
    // The user-visible half of this item: before the sparse branch existed, this
    // variable arrived with `value: null` and the node layer built ONE child holding
    // null for a twelve-element matrix.
    const session = createSession();
    const mat = session.addMatSource('sp.mat', matFile([sparseVar(worked)])) as any;
    const node = mat.children[0];
    expect(node.children).toHaveLength(12);
    expect(node.children.map((c: any) => c._scalarValue)).toEqual(workedDense);
    // Twelve elements is over the ten-element display budget, so the cell summarizes —
    // and the summary names 'sparse', which is where the storage class survives.
    expect(node.displayValue).toBe('<3x4 sparse>');
    expect(node.className).toBe('sparse');
    // A 2x3 is under the budget and prints as the matrix literal.
    const small = session.addMatSource(
      'sp2.mat',
      matFile([sparseVar({ name: 's', dimensions: [2, 3], ir: [0, 1], jc: [0, 1, 1, 2], real: [4, 6] })]),
    ) as any;
    expect(small.children[0].displayValue).toBe('[4 0 0; 0 0 6]');
  });
});

// The same six matrices, as MATLAB wrote them. `probe_string.m:150-158` saves them and
// test/fixtures/sparse_cases.mat is that file: 578 bytes, six variables, one
// miCOMPRESSED element each.
//
// This block is what turns the layout above from a reading of the format document into
// an observation. It is also the only sparse test here that would catch a MATLAB
// release changing what it writes — every fixture above would keep passing, because
// they are written by the same understanding they check.
describe('parseMat — sparse arrays, on MATLAB-authored bytes', () => {
  const parsed = parseMat(fixtureBytes('sparse_cases.mat'));
  const named = (name: string) => {
    const v = parsed.variables.find((each) => each.name === name);
    if (!v) throw new Error(`sparse_cases.mat has no ${name}`);
    return v;
  };

  // The MATLAB source line, then MATLAB's own `full()` answer for it — printed by the
  // probe, transposed to the row-major order this reader returns (MATLAB's mat2str is
  // column-major, so these are not copy-pasted).
  const CASES = [
    {
      name: 'spWorked', // sparse([1 2 3 2], [1 1 2 4], [10 11 20 30], 3, 4)
      dimensions: [3, 4],
      value: [10, 0, 0, 0, 11, 0, 0, 30, 0, 20, 0, 0],
      // nnz, and the nzmax MATLAB declared for it: equal, for every saved matrix that
      // has any non-zeros at all.
      twin: { nzmax: 4, ir: [0, 1, 2, 1], jc: [0, 2, 3, 3, 4], real: [10, 11, 20, 30] },
    },
    {
      name: 'spComplex', // sparse([1 2], [1 2], [1+2i, 3-4i], 2, 2)
      dimensions: [2, 2],
      value: [
        { re: 1, im: 2 },
        { re: 0, im: 0 },
        { re: 0, im: 0 },
        { re: 3, im: -4 },
      ],
      isComplex: true,
      twin: { nzmax: 2, ir: [0, 1], jc: [0, 1, 2], real: [1, 3], imag: [2, -4] },
    },
    {
      name: 'spLogical', // sparse(logical([1 0; 0 1]))
      dimensions: [2, 2],
      value: [1, 0, 0, 1],
      isLogical: true,
      // miUINT8, measured — which is the question the logical test above could not
      // answer for itself.
      twin: { nzmax: 2, ir: [0, 1], jc: [0, 1, 2], real: [1, 1], logical: true, dataType: MI.UINT8 },
    },
    {
      name: 'spNoneZero', // sparse(3, 4) — a 3x4 with no non-zeros at all
      dimensions: [3, 4],
      value: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      // ir and pr are present with a length of 0, and nzmax is 1 where nnz is 0.
      twin: { nzmax: 1, ir: [], jc: [0, 0, 0, 0, 0], real: [] },
    },
    {
      name: 'spEmpty', // sparse([]) — 0x0
      dimensions: [0, 0],
      value: [],
      // jc is a single 0: cols + 1 with cols = 0, not an empty element.
      twin: { nzmax: 1, ir: [], jc: [0], real: [] },
    },
    {
      name: 'spAlloc', // spalloc(3, 4, 10); S(1,1) = 7; S(3,2) = 8
      dimensions: [3, 4],
      value: [7, 0, 0, 0, 0, 0, 0, 0, 0, 8, 0, 0],
      // THE finding of this harvest: nzmax is 2, not the 10 spalloc reserved, and ir
      // and pr are two entries long. `save` trims. The capacity case above therefore
      // models a file MATLAB is not believed to write.
      twin: { nzmax: 2, ir: [0, 2], jc: [0, 1, 2, 2, 2], real: [7, 8] },
    },
  ];

  it('decodes every variable to the matrix MATLAB says it is', () => {
    // Alphabetical, which is the order `save` writes a variable list in regardless of
    // the order it was given them (SPVARS starts with spWorked).
    expect(parsed.variables.map((v) => v.name)).toEqual([
      'spAlloc',
      'spComplex',
      'spEmpty',
      'spLogical',
      'spNoneZero',
      'spWorked',
    ]);
    expect(parsed.warnings).toEqual([]);
    for (const c of CASES) {
      const v = named(c.name);
      expect(v.className, c.name).toBe('sparse');
      expect(v.dimensions, c.name).toEqual(c.dimensions);
      expect(v.value, c.name).toEqual(c.value);
      expect(!!v.isComplex, c.name).toBe(!!c.isComplex);
      expect(!!v.isLogical, c.name).toBe(!!c.isLogical);
      expect(v.undecoded, c.name).toBeUndefined();
    }
  });

  it('decodes each of them identically to the synthesized fixture that stands for it', () => {
    // The byte diff probe_string.m asked for, done at the decode. Each `twin` is
    // `sparseVar` fed the ir/jc/pr/nzmax MEASURED off MATLAB's element for that
    // variable, so a disagreement here means the two byte layouts are not the same
    // layout — and every synthesized sparse test above is then testing a shape MATLAB
    // does not write.
    //
    // It is deliberately BLIND to a decode bug, since one would hit both sides equally;
    // checked by inverting the reader's index expression, which fails the test above and
    // not this one. The two are a pair: that one says the values are right, this one says
    // the synthesized bytes are the bytes MATLAB writes.
    const projected = (v: (typeof parsed.variables)[number]) => ({
      className: v.className,
      dimensions: v.dimensions,
      value: v.value,
      isComplex: !!v.isComplex,
      isLogical: !!v.isLogical,
      undecoded: v.undecoded,
    });
    for (const c of CASES) {
      const synthesized = only(matFile([sparseVar({ name: c.name, dimensions: c.dimensions, ...c.twin })]));
      expect(projected(synthesized), c.name).toEqual(projected(named(c.name)));
    }
  });

  it('reaches the node layer as six sparse matrices', () => {
    // End to end, through the public entry point, on a file MATLAB wrote: this is the
    // shape the host actually sees, and before the sparse branch existed each of these
    // six was one child holding null.
    const session = createSession();
    const mat = session.addMatSource('sparse_cases.mat', fixtureBytes('sparse_cases.mat')) as any;
    //
    // Two rows here are worth reading rather than skimming:
    //
    //   * spLogical's class column says `logical`, not `sparse`. Every other row keeps
    //     the storage class, which is the deliberate choice the first sparse test above
    //     explains — but a logical sparse is rendered by its logical-ness instead. That
    //     is not a bug so much as a coincidence: it is exactly what MATLAB's own
    //     `class()` answers for it. (It answers `double` for the other five, where this
    //     column says `sparse`. Pinned as measured, not endorsed.)
    //   * the 2x2s print as literals and the 3x4s summarize, because the display budget
    //     is ten elements — so this list covers both arms of that on real bytes, plus
    //     the empty one, which prints as neither.
    expect(mat.children.map((c: any) => [c.name, c.className, c.displayValue])).toEqual([
      ['spAlloc', 'sparse', '<3x4 sparse>'],
      ['spComplex', 'sparse', '[1+2i 0+0i; 0+0i 3-4i]'],
      ['spEmpty', 'sparse', '[ ]'],
      ['spLogical', 'logical', '[true false; false true]'],
      ['spNoneZero', 'sparse', '<3x4 sparse>'],
      ['spWorked', 'sparse', '<3x4 sparse>'],
    ]);
  });
});

describe('parseMat — old-style (class 3) objects', () => {
  it('reports a class-3 object as recorded-but-not-decoded, not as an empty variable', () => {
    // The pre-MCOS object. Its layout is not something this corpus pins — there is no
    // MATLAB-authored class-3 fixture anywhere in it — so the reader records the
    // variable and says, in the value itself, that it did not read it. What it must
    // not do is what it did before: report `value: null`, which is indistinguishable
    // from a variable that is genuinely empty, and which the node layer rendered as
    // the JS word "null" in the Value column.
    const v = only(matFile([objectVar('o', [1, 1])]));
    expect(v.className).toBe('object');
    expect(v.value).toBe('<1x1 object, not decoded>');
    expect(v.undecoded).toContain('pre-MCOS object');
    // NOT isOpaque: that flag means "an MCOS reference the McosParser can resolve",
    // and a class-3 object is exactly the object that is not one. Claiming it would
    // route the variable to a decoder that cannot help it.
    expect(v.isOpaque).toBeUndefined();
    expect(v.fields).toBeNull();
    // The shape is the file's own, so an object ARRAY says so rather than claiming 1x1.
    expect(only(matFile([objectVar('oa', [1, 3])])).value).toBe('<1x3 object, not decoded>');
  });

  it('does not interpret the bytes after the array name', () => {
    // The spec describes a class-3 body as a struct array's with a class-name
    // subelement inserted; nothing here confirms that, so the payload is passed as
    // opaque bytes shaped LIKE that description. Reading it on the strength of the
    // document would produce plausible-looking field names out of a layout no
    // fixture pins, which is worse than not reading it.
    const strideData = new Uint8Array(4);
    new DataView(strideData.buffer).setInt32(0, 32, true);
    const names = new Uint8Array(32);
    names.set(new TextEncoder().encode('Prop'), 0);
    const structLike = new Uint8Array([
      ...element(MI.INT8, new TextEncoder().encode('mylegacyclass')),
      ...element(MI.INT32, strideData),
      ...element(MI.INT8, names),
      ...scalarField(7),
    ]);
    const v = only(matFile([objectVar('o', [1, 1], structLike)]));
    expect(v.fields).toBeNull();
    expect(v.value).toBe('<1x1 object, not decoded>');
  });

  it('leaves the variables and struct fields around it intact', () => {
    // The reader stops reading the object's body but the CONTAINER still has to walk
    // past it, in both places a variable can sit: the file's record loop, and the
    // field loop of a struct. Both advance by the element's own declared length, so a
    // field after an undecoded one must still read — otherwise not decoding one
    // variable would cost the ones after it too.
    const parsed = parseMat(
      matFile([
        objectVar('o', [1, 1], new Uint8Array([...element(MI.INT8, new TextEncoder().encode('cls'))])),
        numericVar({ name: 'after', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [42] }),
      ]),
    );
    expect(parsed.variables.map((x) => [x.name, x.value])).toEqual([
      ['o', '<1x1 object, not decoded>'],
      ['after', 42],
    ]);

    const s = only(
      matFile([structVar('s', ['obj', 'n'], [{ obj: objectVar('', [1, 1]), n: scalarField(5) }])]),
    );
    expect(Object.keys(s.fields!)).toEqual(['obj', 'n']);
    expect((s.fields!.obj as { value: unknown; undecoded?: string }).value).toBe('<1x1 object, not decoded>');
    expect((s.fields!.n as { value: unknown }).value).toBe(5);
  });

  it('renders in the node layer as an uneditable placeholder with no child rows', () => {
    const session = createSession();
    const mat = session.addMatSource('obj.mat', matFile([objectVar('o', [1, 1]), objectVar('oa', [1, 3])])) as any;
    const [scalar, array] = mat.children;
    // Before the branch existed this cell read `null`.
    expect(scalar.displayValue).toBe('<1x1 object, not decoded>');
    expect(scalar.children).toEqual([]);
    // Angle brackets are also the convention's no-editor signal, so the placeholder
    // cannot be typed over — there is no value here to commit.
    expect(scalar.valueEditable).toBe(false);
    // An object ARRAY is the case that needed its own arm in parseMatVariable: routed
    // through the numeric one it printed the MATLAB matrix literal
    // `[<1x3 object, not decoded>]`, which is a decoded one-element matrix, offered an
    // editor because the angle brackets were no longer the outermost characters, and
    // built a child row for element 1 of a value with no elements.
    expect(array.displayValue).toBe('<1x3 object, not decoded>');
    expect(array.children).toEqual([]);
    expect(array.valueEditable).toBe(false);
    // The class the file recorded still reaches the DataType column.
    expect([array.className, array.dataType]).toEqual(['object', 'object']);
  });

  it('renders an unmaterializable sparse matrix the same way', () => {
    // The other user of the same channel, so the two agree: one row, the reason in the
    // cell, no fabricated elements, no editor.
    const session = createSession();
    const mat = session.addMatSource(
      'big.mat',
      matFile([sparseVar({ name: 'big', dimensions: [2000, 2000], ir: [0], jc: [0, 1, 1], real: [5] })]),
    ) as any;
    const node = mat.children[0];
    expect(node.displayValue).toBe('<2000x2000 sparse, not decoded>');
    expect(node.children).toEqual([]);
    expect(node.valueEditable).toBe(false);
    expect(node.dataType).toBe('sparse');
  });
});

describe('parseMat — opaque (MCOS) variables', () => {
  it('reports name and class and defers the value to the MCOS decoder', () => {
    // Array class 17 is an opaque object. Its payload is an MCOS reference, not a
    // value, so the reader deliberately returns a 1x1 shell — MatNode then pairs it
    // with the anonymous FileWrapper element to recover properties.
    const el = matrix([
      arrayFlags(CLASS.OPAQUE),
      varName('obj'),
      element(MI.INT8, new TextEncoder().encode('MCOS')),
      element(MI.INT8, new TextEncoder().encode('Simulink.Parameter')),
    ]);
    const v = only(matFile([el]));
    expect(v).toMatchObject({
      name: 'obj',
      className: 'Simulink.Parameter',
      isOpaque: true,
      dimensions: [1, 1],
      value: null,
    });
  });
});

describe('parseMat — malformed byte counts', () => {
  // Each of these used to throw "Offset is outside the bounds of the DataView"
  // straight out of the reader. parseMat is called unguarded from
  // DataModel.addMatSource, so a single bad length failed the whole file open
  // rather than degrading the one variable. readSubelement now clamps every
  // declared length to the bytes actually present.
  const overlong = 0xffff;

  it('REGRESSION: a payload longer than the buffer yields short data, not a RangeError', () => {
    const bad = corruptLength(
      numericVar({ name: 'x', cls: CLASS.DOUBLE, dimensions: [1, 2], real: [1, 2] }),
      TAG.payload,
      overlong,
    );
    const v = only(matFile([bad]));
    expect(v.name).toBe('x');
    expect(Array.isArray(v.value) ? (v.value as unknown[]).length : 1).toBeLessThanOrEqual(2);
  });

  it('REGRESSION: an element count inflated by the declared dimensions is clamped to the payload', () => {
    // Dimensions say 100 elements; the payload holds two. Reading 100 doubles ran
    // off the end of the DataView.
    const el = matrix([
      arrayFlags(CLASS.DOUBLE),
      dims([1, 100]),
      varName('x'),
      element(MI.DOUBLE, new Uint8Array(16)),
    ]);
    const v = only(matFile([el]));
    expect(v.dimensions).toEqual([1, 100]);
    expect(v.value).toEqual([0, 0]);
  });

  it('REGRESSION: an overlong name, dims, or char length does not throw', () => {
    for (const tagOffset of [TAG.dims, TAG.name]) {
      const bad = corruptLength(numericVar({ name: 'x', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [1] }), tagOffset, overlong);
      expect(() => parseMat(matFile([bad])), `tag at ${tagOffset}`).not.toThrow();
    }
    const badChar = corruptLength(charVar('c', 'abcd', MI.UTF8), TAG.payload, overlong);
    expect(() => parseMat(matFile([badChar]))).not.toThrow();
  });

  it('reads a variable whose own element length overruns the file', () => {
    const bad = new Uint8Array(numericVar({ name: 'x', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [1] }));
    new DataView(bad.buffer).setUint32(4, overlong, true);
    expect(only(matFile([bad])).value).toBe(1);
  });

  it('survives a file truncated at every offset past the header', () => {
    // A blunt sweep: no truncation point may throw, because the caller cannot
    // distinguish "corrupt file" from "bug in the reader" when it does.
    const full = new Uint8Array(
      doubleFile('m', [2, 3], [1, 2, 3, 4, 5, 6]),
    );
    for (let cut = 128; cut <= full.length; cut++) {
      const sliced = full.slice(0, cut);
      const buffer = sliced.buffer.slice(sliced.byteOffset, sliced.byteOffset + sliced.byteLength) as ArrayBuffer;
      expect(() => parseMat(buffer), `truncated to ${cut}`).not.toThrow();
    }
  });
});

describe('parseMxArray', () => {
  /** The subelements of a struct matrix, i.e. the outer body of an .mxarray. */
  function workspaceBody(fields: Record<string, Uint8Array>): Uint8Array {
    const names = Object.keys(fields);
    const full = structVar('', names, [fields]);
    return full.slice(8); // drop the miMATRIX tag; mxArrayFile writes its own
  }

  it('reads each workspace variable, naming it from its struct field', () => {
    const parsed = parseMxArray(mxArrayFile(workspaceBody({ p: scalarField(11), q: scalarField(22) })));
    expect(parsed.map((v) => [v.name, v.value])).toEqual([
      ['p', 11],
      ['q', 22],
    ]);
  });

  // Every early return still yields the array-plus-_trailingElements shape the
  // callers destructure, so these assert emptiness by length rather than by
  // deep-equality against a bare [].
  const isEmptyResult = (r: ReturnType<typeof parseMxArray>) => r.length === 0 && r._trailingElements.length === 0;

  it('returns nothing for a buffer too short to hold a header', () => {
    expect(isEmptyResult(parseMxArray(new Uint8Array(4).buffer))).toBe(true);
  });

  it('returns nothing when the magic does not match', () => {
    expect(isEmptyResult(parseMxArray(mxArrayFile(new Uint8Array(16), { magic: [1, 2, 3, 4] })))).toBe(true);
  });

  it('returns nothing when the outer element is not a sized matrix', () => {
    expect(isEmptyResult(parseMxArray(mxArrayFile(new Uint8Array(16), { outerTag: 99 })))).toBe(true);
    expect(isEmptyResult(parseMxArray(mxArrayFile(new Uint8Array(16), { outerSize: 0 })))).toBe(true);
  });

  it('returns nothing when the outer matrix is not a struct', () => {
    // Only a struct carries named workspace variables; anything else has no fields.
    const nonStruct = new Uint8Array([
      ...arrayFlags(CLASS.DOUBLE),
      ...dims([1, 1]),
      ...varName('w'),
      ...element(MI.DOUBLE, new Uint8Array(8)),
    ]);
    expect(isEmptyResult(parseMxArray(mxArrayFile(nonStruct)))).toBe(true);
  });

  it('takes the first element of a struct-array field as the variable', () => {
    const full = structVar('', ['p'], [{ p: scalarField(1) }, { p: scalarField(2) }], [1, 2]);
    const parsed = parseMxArray(mxArrayFile(full.slice(8)));
    expect(parsed.map((v) => [v.name, v.value])).toEqual([['p', 1]]);
  });

  it('keeps trailing elements, which carry the MCOS metadata a save must replay', () => {
    const trailing = element(MI.DOUBLE, new Uint8Array(8));
    const parsed = parseMxArray(mxArrayFile(workspaceBody({ p: scalarField(5) }), { trailing }));
    expect(parsed).toHaveLength(1);
    expect(parsed._trailingElements).toHaveLength(1);
    expect(parsed._trailingElements[0].length).toBe(trailing.length);
  });

  it('stops at a zero terminator among the trailing elements', () => {
    const trailing = new Uint8Array([...element(MI.DOUBLE, new Uint8Array(8)), ...new Uint8Array(8)]);
    const parsed = parseMxArray(mxArrayFile(workspaceBody({ p: scalarField(5) }), { trailing }));
    expect(parsed._trailingElements).toHaveLength(1);
  });

  it('REGRESSION: an overlong trailing length keeps what is there instead of throwing', () => {
    // `new Uint8Array(buffer, offset, 8 + size)` throws a RangeError when `size` is
    // bigger than the file — losing the variables that had already parsed fine.
    const trailing = new Uint8Array([...u32le(MI.DOUBLE), ...u32le(0xffff)]);
    const parsed = parseMxArray(mxArrayFile(workspaceBody({ p: scalarField(5) }), { trailing }));
    expect(parsed.map((v) => v.name)).toEqual(['p']);
    expect(parsed._trailingElements[0].length).toBe(8);
  });

  it('survives a truncation at every offset', () => {
    const full = mxArrayFile(workspaceBody({ p: scalarField(1), q: scalarField(2) }));
    for (let cut = 0; cut <= full.byteLength; cut++) {
      expect(
        () => parseMxArray(full.slice(0, cut)),
        `truncated to ${cut}`,
      ).not.toThrow();
    }
  });

  // A uint32 length with the high bit set. Read with a signed `<< 24` these came
  // back NEGATIVE, so `offset += 8 + size` advanced by zero or went backwards and
  // the trailing-element scan span forever, pushing empty views until the heap died
  // — an out-of-memory crash of the whole extension host, not a parse failure the
  // caller could report. Unsigned, each is simply longer than the file and the
  // existing clamp-and-stop handles it. Note how a regression here shows up: the
  // worker dies of heap exhaustion, so the run fails with "Worker exited
  // unexpectedly" rather than a normal assertion diff.
  it.each([
    ['0xfffffff8, which reads as -8', 0xfffffff8],
    ['0x80000000, the first negative value', 0x80000000],
    ['0xffffffff, which reads as -1', 0xffffffff],
  ])('REGRESSION: a trailing length of %s terminates', (_label, size) => {
    const trailing = new Uint8Array([...u32le(MI.DOUBLE), ...u32le(size)]);
    const parsed = parseMxArray(mxArrayFile(workspaceBody({ p: scalarField(5) }), { trailing }));
    expect(parsed.map((v) => v.name)).toEqual(['p']);
    expect(parsed._trailingElements.map((t) => t.length)).toEqual([8]);
  }, 5000);

  it('REGRESSION: a high-bit outer size does not read as a negative length', () => {
    // outerSize feeds Math.min(size, buf.length - 16); a negative one won that
    // comparison and was passed to parseMatrix as a negative length.
    const parsed = parseMxArray(mxArrayFile(workspaceBody({ p: scalarField(5) }), { outerSize: 0x80000000 }));
    expect(parsed.map((v) => v.name)).toEqual(['p']);
  });
});
