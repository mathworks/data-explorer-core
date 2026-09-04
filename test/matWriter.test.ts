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
