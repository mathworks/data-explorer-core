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
    // date text varies per file, and the fixture's copy of it is synthesized (see
    // V73_HEADER_TEXT). Two headers differing in everything but the version prove the
    // check does not depend on the invented part.
    for (const headerText of [
      undefined,
      'MATLAB 7.3 MAT-file, Platform: GLNXA64, Created on: Tue Jan 07 23:59:59 2014 HDF5 schema 1.00',
    ]) {
      expect(() => parseMat(hdf5MatFile({ headerText })), String(headerText)).toThrow(
        'MAT-file version 7.3 (HDF5) is not supported',
      );
    }
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
