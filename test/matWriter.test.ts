// Copyright 2026 The MathWorks, Inc.
//
// The MAT-element writer and the cdata transport, measured against MATLAB's own
// bytes.
//
// The test that matters is one line: take a cdata string MATLAB wrote, read it,
// write it again, and require the SAME STRING back. Nothing weaker is worth much
// here. Every earlier check of this write path round-tripped through our own
// reader, which is self-consistent rather than true — that is exactly how defect
// 19 (a `Matrix()` spelling MATLAB silently discards) and defect 22 (a rank-3
// header that reads back as an empty 1x0) both survived three verification
// passes. A byte-for-byte match against MATLAB's own stream cannot pass on a
// spelling MATLAB does not write.
//
// Eighteen streams are covered:
//   * artifacts/text/cases.sldd — the five cdata entries in the MATLAB-authored
//     parity corpus: cellNd, cplxScalar, cplxVec, nd2x3x2, structNd.
//   * fixtures/nd_rich.sldd — written by test/parity/matlab/probe_nd_rich.m to
//     widen that corpus, which is all-double, single-field and one-char-named.
//     It adds single, int32, uint64, logical, char and complex at rank 3, a cell
//     whose eight slots disagree in class (including a nested cell, a nested
//     struct and a nested N-D double), a struct with three field names of
//     different lengths, and four structs that pin the field-name stride rule.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMatrix, type MatVariable } from '../src/datamodel/parser/MatParser.js';
import { uudecode, uuencode } from '../src/datamodel/parser/CdataCodec.js';
import { encodeCdata, encodeMatVariable, MatWriteError } from '../src/datamodel/parser/MatWriter.js';

const MI_MATRIX = 14;

interface Stream {
  file: string;
  name: string;
  value: string;
}

/** Every `{_type: 'cdata'}` entry of a text dictionary, read straight off the file. */
function cdataStreams(rel: string): Stream[] {
  const json = JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
  const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  return entries
    .filter((e: any) => e?.value && e.value._type === 'cdata')
    .map((e: any) => ({ file: rel.replace(/^\.\//, ''), name: e.name as string, value: e.value._value as string }));
}

const STREAMS = [
  ...cdataStreams('./parity/artifacts/text/cases.sldd'),
  ...cdataStreams('./fixtures/nd_rich.sldd'),
];

/** The bytes a cdata string carries, and the MatVariable inside them. */
function readStream(s: string): { bytes: Uint8Array; declared: number; variable: MatVariable } {
  const bytes = uudecode(s);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = view.getUint32(12, true);
  expect(view.getUint32(8, true)).toBe(MI_MATRIX);
  return { bytes, declared, variable: parseMatrix(view, 16, declared) };
}

/**
 * The same stream read as if the file had ENDED after `keep` bytes of it.
 *
 * MatParser stops at the end it was given — a struct with no room left for its
 * field-name table keeps `fields` null, and a struct array with no room left for
 * element 10 hands back a field list shorter than the dimensions declare. Both are
 * shapes a truncated or partially written file really produces, and both then have to
 * come back out of the writer.
 */
function readTruncatedStream(s: string, keep: number): MatVariable {
  const bytes = uudecode(s);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return parseMatrix(view, 16, keep);
}

/** The MatVariable inside one bare `miMATRIX` element — what `encodeMatVariable` returns. */
function readElement(bytes: Uint8Array): MatVariable {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(MI_MATRIX);
  return parseMatrix(view, 8, view.getUint32(4, true));
}

/**
 * The type code and payload length of every subelement of one `miMATRIX` element, in
 * order: array flags, dimensions, name, then the data. Read by hand rather than through
 * MatParser because the point of the tests that use it is the TAG — which of the ten
 * numeric element types the payload declares itself to be, and how many bytes it claims
 * per value. Nothing MatParser hands back names those two things.
 */
function subelements(bytes: Uint8Array): { type: number; bytes: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = 8 + view.getUint32(4, true);
  const out: { type: number; bytes: number }[] = [];
  for (let at = 8; at < end; ) {
    // The small form packs the byte count into the tag's upper half; the long form
    // spends a second word on it and pads the payload to an 8-byte boundary.
    const packed = view.getUint16(at + 2, true);
    if (packed !== 0) {
      out.push({ type: view.getUint16(at, true), bytes: packed });
      at += 8;
    } else {
      const n = view.getUint32(at + 4, true);
      out.push({ type: view.getUint32(at, true), bytes: n });
      at += 8 + n + ((8 - (n % 8)) % 8);
    }
  }
  return out;
}

/** A 1x1 double: the starting point each hand-built case below varies one field of. */
function variable(over: Partial<MatVariable>): MatVariable {
  return {
    name: '',
    className: 'double',
    dimensions: [1, 1],
    isComplex: false,
    isLogical: false,
    value: 1,
    fields: null,
    ...over,
  };
}

describe('the cdata transport is its own inverse', () => {
  // The content is 8 bytes of preamble plus the element the stream declares;
  // anything past that is MATLAB's NUL padding, which carries no data.
  for (const s of STREAMS) {
    it(`re-encodes the ${s.file} ${s.name} byte stream to MATLAB's own characters`, () => {
      const { bytes, declared } = readStream(s.value);
      expect(uuencode(bytes.slice(0, 16 + declared))).toBe(s.value);
    });
  }

  it('round-trips arbitrary byte lengths, including the ones that need padding', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        bytes[i] = (i * 37 + 11) & 0xff;
      }
      expect(uudecode(uuencode(bytes)).slice(0, n)).toEqual(bytes);
    }
  });

  it('spells a zero six-bit group inside the data as a space, not a NUL', () => {
    // The distinction is the whole reason uuencode cannot be written as
    // "zero-pad to a multiple of three and encode that": MATLAB's trailing NULs
    // are padding OF THE STRING, and a zero in the data is 0x20.
    const encoded = uuencode(new Uint8Array([0, 0, 0]));
    expect(encoded).toBe('    \0');
  });
});

describe('MatWriter reproduces the streams MATLAB wrote', () => {
  for (const s of STREAMS) {
    it(`writes ${s.file} ${s.name} byte-for-byte`, () => {
      const { variable } = readStream(s.value);
      expect(encodeCdata(variable)).toBe(s.value);
    });
  }

  it('covers every kind MATLAB stores as cdata', () => {
    // A regenerated corpus that adds a kind must not silently escape the suite,
    // and a corpus that LOSES one must not quietly shrink it either.
    const kinds = STREAMS.map((s) => {
      const v = readStream(s.value).variable;
      return v.className + (v.isLogical ? '/logical' : '') + (v.isComplex ? '/complex' : '');
    });
    expect(new Set(kinds)).toEqual(
      new Set(['double', 'double/complex', 'single', 'int32', 'uint64', 'uint8/logical', 'char', 'cell', 'struct']),
    );
    expect(STREAMS.length).toBe(18);
  });
});

describe('MatWriter refuses what the format cannot carry', () => {
  const base: MatVariable = {
    name: '',
    className: 'double',
    dimensions: [1, 1],
    isComplex: false,
    isLogical: false,
    value: 1,
    fields: null,
  };

  it('throws on an MCOS opaque rather than writing a stream MATLAB misreads', () => {
    expect(() => encodeMatVariable({ ...base, className: 'string', isOpaque: true })).toThrow(MatWriteError);
  });

  it('throws on a class it has no MAT code for', () => {
    expect(() => encodeMatVariable({ ...base, className: 'unknown' })).toThrow(MatWriteError);
  });

  it('throws when the element count contradicts the declared dimensions', () => {
    // Silently writing the short list is what turns a shape defect into a data
    // defect: MATLAB reads the remaining slots as whatever follows in the file.
    expect(() => encodeMatVariable({ ...base, dimensions: [2, 3, 2], value: [1, 2, 3] })).toThrow(MatWriteError);
  });

  it('throws when a char’s text length contradicts the declared dimensions', () => {
    // The char twin of the check above, and it needs its own test because a char
    // carries its elements as a STRING rather than a list — a different length to
    // measure, in a different branch, guarded by a different line. The failure it
    // prevents is the one defect 25 is about: _buildVarObject used to spell a char's
    // shape as `[1, text.length]`, so an N-D char reached the writer claiming
    // [2, 3, 2] with twelve characters or [1, 12] with the same twelve, and only one of
    // those is the value MATLAB had. Three characters against a declared twelve slots
    // is a stream MATLAB reads to the end of the payload and past it.
    expect(() =>
      encodeMatVariable({ ...base, className: 'char', dimensions: [2, 3, 2], value: 'abc' }),
    ).toThrow(MatWriteError);
    // The control: the same declaration with the right number of characters is written,
    // so the guard is measuring the length and not merely rejecting rank 3.
    expect(() =>
      encodeMatVariable({ ...base, className: 'char', dimensions: [2, 3, 2], value: 'abcdefghijkl' }),
    ).not.toThrow();
  });
});

describe('the layout choices, stated where a failure is readable', () => {
  it('opens a cdata payload with the preamble MATLAB writes and one miMATRIX element', () => {
    const v: MatVariable = {
      name: 'ignored',
      className: 'double',
      dimensions: [2, 3, 2],
      isComplex: false,
      isLogical: false,
      value: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      fields: null,
    };
    const bytes = uudecode(encodeCdata(v));
    expect(Array.from(bytes.slice(0, 8))).toEqual([0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(8, true)).toBe(MI_MATRIX);
    const back = parseMatrix(view, 16, view.getUint32(12, true));
    expect(back.dimensions).toEqual([2, 3, 2]);
    // The name is dropped on purpose: a cdata payload is a bare value.
    expect(back.name).toBe('');
    expect(back.value).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('writes numeric data column-major, and cell elements in the order the model holds them', () => {
    // The asymmetry is defect 14. A 2x3 numeric [1..6] is row-major in the model,
    // so MATLAB's linear order is 1 4 2 5 3 6; a cell's elements are already
    // column-major, so they go out untouched.
    const num: MatVariable = {
      name: '',
      className: 'double',
      dimensions: [2, 3],
      isComplex: false,
      isLogical: false,
      value: [1, 2, 3, 4, 5, 6],
      fields: null,
    };
    const numBytes = uudecode(encodeCdata(num));
    const numView = new DataView(numBytes.buffer, numBytes.byteOffset, numBytes.byteLength);
    // The payload is the last subelement; read it back through the reader's own
    // inverse instead of hand-indexing, then undo the reader's transpose.
    expect(parseMatrix(numView, 16, numView.getUint32(12, true)).value).toEqual([1, 2, 3, 4, 5, 6]);

    const cell: MatVariable = {
      name: '',
      className: 'cell',
      dimensions: [2, 3],
      isComplex: false,
      isLogical: false,
      value: [1, 2, 3, 4, 5, 6].map((n) => ({ ...num, dimensions: [1, 1], value: n })),
      fields: null,
    };
    const cellBytes = uudecode(encodeCdata(cell));
    const cellView = new DataView(cellBytes.buffer, cellBytes.byteOffset, cellBytes.byteLength);
    const back = parseMatrix(cellView, 16, cellView.getUint32(12, true));
    expect((back.value as MatVariable[]).map((c) => c.value)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('keeps a hole a hole, and an empty value indistinguishable from one', () => {
    // The placeholder a hole gets IS MATLAB's `[]`, byte for byte — which is the whole
    // reason a hole is readable at all, and the reason an empty value must not be
    // treated as a defect. `flatValues` is where that lands: MatParser leaves an empty
    // variable's value null, and null is neither a list nor a scalar. Read as a
    // one-element list it contradicts the declared [0,0] and raises MatWriteError,
    // which for an N-D value is not an error a user sees — `_serializeCdata` catches it
    // and falls back to the rank-2 literal grammar MATLAB reads as an empty 1x0. One
    // empty slot would take the whole surrounding value with it.
    const hole = encodeMatVariable(variable({ className: 'cell', dimensions: [1, 1], value: [null] }));
    const written = encodeMatVariable(
      variable({
        className: 'cell',
        dimensions: [1, 1],
        value: [variable({ className: 'double', dimensions: [0, 0], value: null })],
      }),
    );
    expect(written).toEqual(hole);

    // And an empty value of some other class keeps that class rather than becoming the
    // placeholder: an empty int32 reopens as int32, not as double.
    const emptyInt = readElement(encodeMatVariable(variable({ className: 'int32', dimensions: [0, 0], value: null })));
    expect(emptyInt.className).toBe('int32');
    expect(emptyInt.dimensions).toEqual([0, 0]);
    expect(emptyInt.value).toEqual([]);
  });

  it('keeps a hole a hole', () => {
    const cell: MatVariable = {
      name: '',
      className: 'cell',
      dimensions: [1, 3],
      isComplex: false,
      isLogical: false,
      value: [null, { name: '', className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value: 7, fields: null }, null],
      fields: null,
    };
    const bytes = uudecode(encodeCdata(cell));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const back = parseMatrix(view, 16, view.getUint32(12, true));
    const cells = back.value as MatVariable[];
    expect(cells.length).toBe(3);
    expect(cells[1].value).toBe(7);
    expect(cells[0].dimensions).toEqual([0, 0]);
    expect(cells[2].dimensions).toEqual([0, 0]);
  });
});

// Ten numeric classes reach the payload writer and each is one line differing only in
// which DataView setter it calls — that is, only in how many bytes it spends per value
// and whether it treats the top bit as a sign. MATLAB's own cdata corpus happens to
// use six of them (double, single, int32, uint64, uint8-as-logical, and char's UTF-8),
// so four have never been written by anything but this file. Getting one wrong is not
// a crash: an int16 written through the int8 line stores 300 as 44, and MATLAB reopens
// the dictionary and shows 44. So the tag and the width are asserted directly, against
// the type codes the MAT-file format fixes, and the extremes of each class are in the
// data because a narrower setter cannot carry them.
//
// Signedness is deliberately NOT asserted: setInt16 and setUint16 write identical bytes
// for every value either class can hold, so the two lines are interchangeable and a
// test claiming otherwise would be claiming something untrue about the format. What
// distinguishes the classes is the class code in the array flags, which is asserted by
// reading the class name back.
describe('the integer widths MATLAB’s own corpus never made this writer produce', () => {
  const CASES: { className: string; miType: number; width: number; values: number[] }[] = [
    { className: 'int8', miType: 1, width: 1, values: [-128, 127, -1, 0, 1, 42] },
    { className: 'uint8', miType: 2, width: 1, values: [0, 255, 128, 1, 7, 42] },
    { className: 'int16', miType: 3, width: 2, values: [-32768, 32767, 300, -1, 0, 256] },
    { className: 'uint16', miType: 4, width: 2, values: [0, 65535, 300, 1, 256, 7] },
    { className: 'int32', miType: 5, width: 4, values: [-2147483648, 2147483647, 70000, -1, 0, 4] },
    { className: 'uint32', miType: 6, width: 4, values: [0, 4294967295, 70000, 1, 65536, 4] },
  ];

  for (const c of CASES) {
    it(`writes a rank-3 ${c.className} as a ${c.width}-byte mi type ${c.miType} payload`, () => {
      const bytes = encodeMatVariable(variable({ className: c.className, dimensions: [2, 1, 3], value: c.values }));
      const parts = subelements(bytes);
      expect(parts.length, 'array flags, dimensions, name, data').toBe(4);
      expect(parts[3].type).toBe(c.miType);
      expect(parts[3].bytes, 'six values at the class’s own width').toBe(c.width * 6);

      const back = readElement(bytes);
      expect(back.className).toBe(c.className);
      expect(back.dimensions).toEqual([2, 1, 3]);
      // Including the extremes, which is what a too-narrow setter loses.
      expect(back.value).toEqual(c.values);
    });
  }
});

// The guards that answer with a placeholder instead of refusing.
//
// A MatWriteError raised over a value that is merely INCOMPLETE is the worst outcome
// available here, and it does not look like an error. `MatlabVariableNode._serializeCdata`
// wraps this writer in a try/catch and returns null on a throw; `serializeValue` then
// falls through to the rank-2 literal grammar, which — per the file header above — is
// exactly the spelling MATLAB reads back as an empty 1x0. So one element the model
// could not hand over whole does not produce a warning or a failed save: it deletes the
// value it belonged to, quietly, in a file that reopens perfectly.
//
// Every case below is a shape a real reader or a real edit produces, and the behaviour
// pinned is always the same one — the slot is kept, filled with the nearest thing MATLAB
// can read, and the rest of the value goes out intact.
describe('a value the model could not hand over whole is still written', () => {
  it('writes a non-finite int64 element as zero rather than failing the save', () => {
    // `BigInt()` throws on Inf and on NaN, and there is no integer to write instead —
    // an int64 that came in through a path still reading it as a double, or an element a
    // user typed `Inf` into, has no 64-bit form at all. Zero in the slot keeps every
    // other element of the array in its own place.
    const back = readElement(
      encodeMatVariable(variable({ className: 'int64', dimensions: [1, 1, 3], value: [1, Infinity, NaN] })),
    );
    expect(back.className).toBe('int64');
    expect(back.value).toEqual([1, 0, 0]);
  });

  it('writes a complex element that lost its imaginary part as x+0i, in its own slot', () => {
    // A complex value's elements arrive as `{re, im}` pairs from the reader, but not from
    // every edit: `_buildVarObject`'s complex-scalar arm only builds a pair when its
    // regex matches the element's text, and leaves the raw value in place when it does
    // not — a complex scalar a user retyped as plain `5` is a bare value under an
    // `isComplex` header. Reading no `im` as no ELEMENT would shorten the payload and
    // slide every later value one position early.
    const back = readElement(
      encodeMatVariable(
        variable({
          className: 'double',
          isComplex: true,
          dimensions: [1, 3],
          value: [{ re: 1, im: 2 }, 7, { re: 3, im: 4 }],
        }),
      ),
    );
    expect(back.value).toEqual([{ re: 1, im: 2 }, { re: 7, im: 0 }, { re: 3, im: 4 }]);

    // The shape the node layer actually hands over for that retyped scalar: one bare
    // string under a complex header, which is 5+0i and not an empty value.
    const scalar = readElement(encodeMatVariable(variable({ className: 'double', isComplex: true, value: '5' })));
    expect(scalar.value).toEqual([{ re: 5, im: 0 }]);
  });

  it('writes an empty char as no characters, not as the four letters of “null”', () => {
    // `_buildVarObject` assigns a char's `value` straight from the node's scalar value
    // and only guards the DIMENSIONS computation against a non-string, so the writer is
    // where a char with nothing in it arrives as null. `String(null)` is the text
    // 'null' — four characters against a declared zero, which raises MatWriteError and
    // so deletes the value the empty char sat inside.
    const empty = encodeMatVariable(variable({ className: 'char', dimensions: [0, 0], value: null }));
    const parts = subelements(empty);
    expect(parts[3].type, 'char data is miUTF8').toBe(16);
    expect(parts[3].bytes).toBe(0);
    expect(readElement(empty).value).toBe('');

    // A char whose text arrived as a number is written as its digits — the same
    // coercion, in the direction the display layer already tolerates.
    expect(readElement(encodeMatVariable(variable({ className: 'char', dimensions: [1, 2], value: 65 }))).value).toBe('65');
  });

  it('keeps every slot of a struct array whose bytes ran out before the last element', () => {
    // MATLAB's own 2x3x2 `structNd`, read as if the file had ended 400 bytes early: the
    // reader stops at the end it was given, so `fields.a` comes back with six of the
    // twelve elements. The twelve slots are not interchangeable — a MAT struct array
    // stores them in order, so writing only the six would move element 7's value into
    // element 1's place for every field, and the six values that DID survive would come
    // back attached to the wrong elements.
    const structNd = STREAMS.find((s) => s.name === 'structNd')!;
    const short = readTruncatedStream(structNd.value, readStream(structNd.value).declared - 400);
    expect((short.fields!.a as MatVariable[]).length, 'the reader kept what was there').toBe(6);

    const back = readElement(encodeMatVariable(short));
    expect(back.dimensions).toEqual([2, 3, 2]);
    const slots = back.fields!.a as MatVariable[];
    expect(slots.length).toBe(12);
    // 1..6 where MATLAB put them; an empty double for each element that was lost.
    expect(slots.map((f) => f.value)).toEqual([1, 2, 3, 4, 5, 6, [], [], [], [], [], []]);
  });

  it('writes a struct whose field table was lost as a struct with no fields', () => {
    // Truncated harder — before the field-name stride — the reader has no field names to
    // report and leaves `fields` null. `Object.keys(null)` throws, and this is a whole
    // ENTRY's value in a forty-entry save, so the dictionary is what would be lost, not
    // the struct. It goes out as a 2x3x2 struct with nothing in it.
    const structNd = STREAMS.find((s) => s.name === 'structNd')!;
    const gutted = readTruncatedStream(structNd.value, 48);
    expect(gutted.className).toBe('struct');
    expect(gutted.fields).toBe(null);

    const back = readElement(encodeMatVariable(gutted));
    expect(back.className).toBe('struct');
    expect(back.dimensions).toEqual([2, 3, 2]);
    expect(back.fields).toEqual({});
  });
});
