// Copyright 2026 The MathWorks, Inc.
//
// The inverse of MatParser.parseMatrix: a MatVariable back to the bytes of one
// MAT-file `miMATRIX` element, and from there to the `cdata` string an
// uncompressed-text .sldd carries.
//
// WHY THIS EXISTS. A text dictionary's `_value` is a restricted literal grammar
// that stops at rank 2. Asked directly, MATLAB reads every candidate spelling of
// a 2x3x2 back as an empty 1x0: `Matrix(2,3,2)` with grouped rows, with a flat
// column-major list, with nested pages, and `Matrix(2,3,2)\nreshape(...)`; the
// bare expressions `reshape([...],2,3,2)` and `cat(3,...)` are not evaluated at
// all and read back as the scalar 0 (test/parity/matlab/probe_rank3_serial.m).
// MATLAB's own dictionary answers the same question by storing EVERY rank >= 3
// value as cdata whatever its kind — double, single, int32, uint64, logical,
// char, complex, cell and struct all come out as `{"_type": "cdata"}`
// (test/parity/matlab/probe_nd_rich.m). So this is not an optimization; it is the
// only form MATLAB reads at rank >= 3.
//
// EVERY LAYOUT CHOICE HERE IS MEASURED against streams MATLAB wrote, because a
// stream our own reader accepts proves only that we are self-consistent:
//
//   * the variable NAME is empty at every level — a cdata payload is a bare
//     value, and the name lives in the JSON key or the struct field-name table
//   * long (8-byte) tags everywhere, EXCEPT a payload of 1..4 bytes, which takes
//     the small form; an EMPTY payload stays long (that is how MATLAB writes the
//     empty name)
//   * a logical is class uint8 with the logical flag and a miUINT8 payload
//   * a char payload is miUTF8
//   * a struct's field-name stride is max(longest name, 4) + 1 — measured at
//     lengths 1, 3, 4, 5, 6 and 8, which rules out both `longest + 1` and any
//     4-byte rounding of it
//   * numeric data is COLUMN-major, while cell and struct ELEMENTS are already in
//     column-major order in the model. That split is not a nicety: it is defect
//     14, documented in display/Subscript.ts, and inverting the wrong one of the
//     two silently permutes the value.
//
// The tests hold all of it to byte equality against MATLAB's own eighteen cdata
// streams, so a wrong guess here fails loudly rather than shipping a file MATLAB
// reads as empty.

import type { MatVariable } from './MatParser.js';
import {
  complexClassTag,
  isExactToken,
  parseComplexNum,
  transposeFromColumnMajorND,
  transposeToColumnMajorND,
} from './XmlUtils.js';
import { isMatCdata, uuencode } from './CdataCodec.js';
import { encodedBytes, isEncodedValue } from './EncodedValue.js';
import { backedColumnsOf, sparseFromDense } from './SparseData.js';

/**
 * A value this format cannot carry — an MCOS object (a MATLAB `string`, an
 * object array), or a class MatParser could not name. Thrown rather than
 * written, because a stream that declares one thing and carries another is read
 * back as garbage instead of as a failure.
 */
export class MatWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MatWriteError';
  }
}

const MI_INT8 = 1;
const MI_UINT8 = 2;
const MI_INT16 = 3;
const MI_UINT16 = 4;
const MI_INT32 = 5;
const MI_UINT32 = 6;
const MI_SINGLE = 7;
const MI_DOUBLE = 9;
const MI_INT64 = 12;
const MI_UINT64 = 13;
const MI_MATRIX = 14;
const MI_UTF8 = 16;

const MX_CELL = 1;
const MX_STRUCT = 2;
const MX_CHAR = 4;
const MX_UINT8 = 9;

// The inverse of MatParser's CLASS_NAMES. 'sparse' and 'object' are absent on
// purpose: neither has a shape this writer can produce, and naming them would
// turn a loud MatWriteError into a stream MATLAB misreads. (A sparse array's
// className is its element class, 'double', 'logical' or 'single', and
// encodeMatVariable sends it to encodeSparse on its isSparse before this table is
// asked.)
const CLASS_CODE: Record<string, number> = {
  cell: MX_CELL,
  struct: MX_STRUCT,
  char: MX_CHAR,
  double: 6,
  single: 7,
  int8: 8,
  uint8: MX_UINT8,
  int16: 10,
  uint16: 11,
  int32: 12,
  uint32: 13,
  int64: 14,
  uint64: 15,
  // A logical array is not its own MAT class: MATLAB writes class uint8 with the
  // logical flag set, which is what MatParser reads back as isLogical.
  logical: MX_UINT8,
};

const PAYLOAD_TYPE: Record<number, number> = {
  6: MI_DOUBLE,
  7: MI_SINGLE,
  8: MI_INT8,
  9: MI_UINT8,
  10: MI_INT16,
  11: MI_UINT16,
  12: MI_INT32,
  13: MI_UINT32,
  14: MI_INT64,
  15: MI_UINT64,
};

const WIDTH: Record<number, number> = {
  [MI_INT8]: 1,
  [MI_UINT8]: 1,
  [MI_INT16]: 2,
  [MI_UINT16]: 2,
  [MI_INT32]: 4,
  [MI_UINT32]: 4,
  [MI_SINGLE]: 4,
  [MI_DOUBLE]: 8,
  [MI_INT64]: 8,
  [MI_UINT64]: 8,
};

// The 8 bytes a cdata payload opens with: version 0x0100, then the 'IM'
// endian marker, then four zero bytes of pad. Byte-for-byte what MATLAB writes.
const CDATA_PREAMBLE = [0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00];

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) {
    total += p.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function u32le(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n >>> 0, true);
  return out;
}

/**
 * One data element: a tag plus its payload, padded to an 8-byte boundary.
 *
 * A payload of 1..4 bytes takes MATLAB's small form — byte count in the tag's
 * upper half, payload in the tag's second word, eight bytes in total. An empty
 * payload does NOT: MATLAB writes the long form there, and matching that is what
 * makes an empty variable name eight bytes rather than four.
 */
function element(type: number, data: Uint8Array): Uint8Array {
  if (data.length > 0 && data.length <= 4) {
    const out = new Uint8Array(8);
    const view = new DataView(out.buffer);
    view.setUint16(0, type, true);
    view.setUint16(2, data.length, true);
    out.set(data, 4);
    return out;
  }
  const pad = (8 - (data.length % 8)) % 8;
  return concat([u32le(type), u32le(data.length), data, new Uint8Array(pad)]);
}

function arrayFlags(cls: number, complex: boolean, logical: boolean): Uint8Array {
  const data = new Uint8Array(8);
  data[0] = cls;
  data[1] = (complex ? 0x08 : 0) | (logical ? 0x02 : 0);
  return element(MI_UINT32, data);
}

function dimsElement(d: number[]): Uint8Array {
  const data = new Uint8Array(d.length * 4);
  const view = new DataView(data.buffer);
  d.forEach(function (n, i) {
    view.setInt32(i * 4, n, true);
  });
  return element(MI_INT32, data);
}

// A cdata value is anonymous at every level, so there is only ever this one name
// element: the long form of miINT8 with zero bytes.
function emptyName(): Uint8Array {
  return element(MI_INT8, new Uint8Array(0));
}

/**
 * A MAT element needs at least two dimensions, and MatParser hands back whatever
 * the file declared. A [2,1,2] stays [2,1,2] — MATLAB keeps interior singletons,
 * and rewriting them would change the value's shape.
 */
function dimsOf(v: Pick<MatVariable, 'dimensions'>): number[] {
  const d = (v.dimensions || []).slice();
  while (d.length < 2) {
    d.push(1);
  }
  return d;
}

function elementCountOf(d: number[]): number {
  return d.reduce(function (a, b) {
    return a * b;
  }, 1);
}

/** An empty 0x0 double — MATLAB's `[]`, and the placeholder for a hole. */
function emptyDoubleBytes(): Uint8Array {
  return element(
    MI_MATRIX,
    concat([arrayFlags(CLASS_CODE.double, false, false), dimsElement([0, 0]), emptyName(), element(MI_DOUBLE, new Uint8Array(0))]),
  );
}

/**
 * A 64-bit integer payload has to go out as a BigInt.
 *
 * The value arrives one of two ways. An exact decimal TOKEN — a string, which is how
 * every channel now carries an int64/uint64 whose magnitude a double cannot hold
 * (XmlUtils.parseExactNum) — converts losslessly, which is the whole reason the text
 * form exists. A plain number may not be an integer any more: a 64-bit value that came
 * in through some path still reading it as a double lost precision above 2^53, and a
 * non-finite one has no integer form at all. BigInt() throws on both, and a throw here
 * would fail the whole save, so round and treat a non-finite as zero.
 */
function toBigInt(n: number | string): bigint {
  if (typeof n === 'string') {
    try {
      return BigInt(n);
    } catch {
      return 0n;
    }
  }
  return isFinite(n) ? BigInt(Math.round(n)) : 0n;
}

function numericPayload(type: number, values: ArrayLike<number | string>): Uint8Array {
  const width = WIDTH[type];
  if (!width) {
    throw new MatWriteError('no payload width for MAT element type ' + type);
  }
  const data = new Uint8Array(values.length * width);
  const view = new DataView(data.buffer);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const at = i * width;
    const n = typeof v === 'number' ? v : Number(v);
    switch (type) {
      case MI_INT8:
        view.setInt8(at, n);
        break;
      case MI_UINT8:
        view.setUint8(at, n);
        break;
      case MI_INT16:
        view.setInt16(at, n, true);
        break;
      case MI_UINT16:
        view.setUint16(at, n, true);
        break;
      case MI_INT32:
        view.setInt32(at, n, true);
        break;
      case MI_UINT32:
        view.setUint32(at, n, true);
        break;
      case MI_SINGLE:
        view.setFloat32(at, n, true);
        break;
      // `v` and not `n`: the coercion above is a double, and putting an exact 64-bit
      // token through it is exactly the rounding this representation exists to avoid.
      case MI_INT64:
        view.setBigInt64(at, toBigInt(v), true);
        break;
      case MI_UINT64:
        view.setBigUint64(at, toBigInt(v), true);
        break;
      default:
        view.setFloat64(at, n, true);
        break;
    }
  }
  return element(type, data);
}

/**
 * The values of a numeric variable as one flat list. MatParser collapses a 1x1 to
 * a bare number and leaves an empty one null, so all three shapes arrive here.
 */
function flatValues(value: unknown): unknown[] {
  if (value === null || value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

// An exact 64-bit token is a bare decimal integer carried as TEXT because a double cannot
// hold it (XmlUtils.isExactToken). Only numericPayload's two 64-bit arms consume one, and
// only a 64-bit class ever produces one, so every other arm sees numbers as before.
//
// A complex int64/uint64 carries one in `re`/`im` as well: MatParser builds `{re, im}` out
// of the same readNumericArray both parts come from, so `Number(...) || 0` here would round
// the real part of `complex(intmax('int64'), 1)` one step after the reader kept it exact.
//
// A number is written as it is, NaN included. `Number(x) || 0` is false for NaN, so every
// NaN this packer wrote — a double's, a single's, either part of a complex value's — went
// into the stream as 0: [1 NaN Inf] read back as [1 0 Inf]. The fallback is for what is
// not a number at all.
function exactPart(x: unknown): number | string {
  if (isExactToken(x)) {
    return x;
  }
  if (typeof x === 'number') {
    return x;
  }
  return Number(x) || 0;
}

function realPart(x: unknown): number | string {
  if (x !== null && typeof x === 'object' && 're' in (x as Record<string, unknown>)) {
    return exactPart((x as { re: unknown }).re);
  }
  // Untouched: `Number(x) || 0` here would round maxU64 to 18446744073709552000 on the
  // way into the byte stream, one step after the reader had kept it exact (defect 29).
  return exactPart(x);
}

function imagPart(x: unknown): number | string {
  if (x !== null && typeof x === 'object' && 'im' in (x as Record<string, unknown>)) {
    return exactPart((x as { im: unknown }).im);
  }
  return 0;
}

function numericBody(v: MatVariable, cls: number, d: number[]): Uint8Array[] {
  const flat = flatValues(v.value);
  const n = elementCountOf(d);
  if (flat.length !== n) {
    // A stream that declares more elements than it carries is not read as an
    // error by MATLAB — it is read as a shorter or garbage array. Refuse instead.
    throw new MatWriteError('numeric value has ' + flat.length + ' elements but declares [' + d.join(',') + ']');
  }
  const type = PAYLOAD_TYPE[cls];
  // The model holds numeric elements row-major within each page; MAT stores them
  // column-major. Cells and structs are NOT transposed (see the file header).
  const real = transposeToColumnMajorND(flat.map(realPart), d);
  const parts = [numericPayload(type, real)];
  if (v.isComplex) {
    parts.push(numericPayload(type, transposeToColumnMajorND(flat.map(imagPart), d)));
  }
  return parts;
}

function charBody(v: MatVariable, d: number[]): Uint8Array[] {
  // MatParser does not transpose char data — a char matrix's string comes back in
  // the file's own column-major order — so it goes out exactly as it came in.
  const text = typeof v.value === 'string' ? v.value : String(v.value ?? '');
  // Same contract as numericBody: a stream whose dims and payload disagree is not
  // an error to MATLAB, it is a shorter or garbage array. A char matrix reaches
  // here from the node layer with its own _dims, so this is where a shape that no
  // longer describes the text has to stop.
  if (text.length !== elementCountOf(d)) {
    throw new MatWriteError('char value has ' + text.length + ' characters but declares [' + d.join(',') + ']');
  }
  return [element(MI_UTF8, new TextEncoder().encode(text))];
}

function cellBody(v: MatVariable, d: number[]): Uint8Array[] {
  const cells = flatValues(v.value) as (MatVariable | null)[];
  const n = elementCountOf(d);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    // A slot the reader could not read stays a hole. Dropping it would slide
    // every later element one position early.
    parts.push(c ? encodeMatVariable(c) : emptyDoubleBytes());
  }
  return parts;
}

function structBody(v: MatVariable, d: number[]): Uint8Array[] {
  const fields = v.fields || {};
  const names = Object.keys(fields);
  const longest = names.reduce(function (a, s) {
    return Math.max(a, s.length);
  }, 0);
  const stride = Math.max(longest, 4) + 1;
  const strideData = new Uint8Array(4);
  new DataView(strideData.buffer).setInt32(0, stride, true);

  const nameData = new Uint8Array(names.length * stride);
  const enc = new TextEncoder();
  names.forEach(function (name, i) {
    nameData.set(enc.encode(name), i * stride);
  });

  const parts = [element(MI_INT32, strideData), element(MI_INT8, nameData)];
  const n = elementCountOf(d);
  for (let e = 0; e < n; e++) {
    for (const name of names) {
      const held = fields[name];
      const one = Array.isArray(held) ? held[e] : n === 1 ? held : undefined;
      // A MATLAB struct array is homogeneous, so every element has every field.
      // An element that lost one (a whole-value edit clears its children) keeps
      // its slot as an empty double rather than shifting the ones after it.
      parts.push(one ? encodeMatVariable(one) : emptyDoubleBytes());
    }
  }
  return parts;
}

// MAT class 5, mxSPARSE_CLASS: what a double or logical sparse array is written under.
const MX_SPARSE = 5;
// The flag MATLAB sets on every sparse array it writes, class 5 included, and the only
// mark a sparse SINGLE has (see MatParser's sparse arm).
const SPARSE_FLAG = 0x10;

/**
 * A sparse array as MATLAB stores one: its non-zeros, not its elements.
 *
 * Every byte below is MATLAB's, measured on the sparse streams of test/fixtures/sparse
 * (make_sparse_fixtures.m: double real and complex, logical, single, all-zero, row,
 * column, non-finite, large, a struct field, a cell element, a Parameter Value), and the
 * tests hold this writer to byte equality with every one of them:
 *
 *   array flags   class 5 for double and logical, 7 for single; flags 0x10, plus 0x02
 *                 for logical and 0x08 for complex; nzmax max(nnz, 1) — an all-zero
 *                 array still reserves one
 *   dimensions    rows, cols (a sparse array has exactly two)
 *   name          empty, as everywhere in a stream
 *   ir            miINT32, the 0-based row of each non-zero in column-major order, nnz
 *                 of them (not nzmax)
 *   jc            miINT32, cols + 1 column starts
 *   pr            the non-zeros: miDOUBLE for double, miSINGLE for single, miUINT8 ones
 *                 for logical — never narrowed to a smaller type
 *   pi            the imaginary parts, of pr's type, when complex
 *
 * The non-zeros are `v.sparse`, as MatParser reads them and the node layer edits them
 * (MatlabVariableNode._buildVarObject); a variable a host or a test built with a dense
 * row-major `value` instead is read off that, which then has to hold every element. Only
 * an entry that is a non-zero is written — anything but 0 in either part, so NaN stays
 * and -0 goes (sparse(-0) holds nothing) — so one an edit set to zero is not. jc is
 * counted from the columns, which is the one part of the stream that grows with the
 * array's shape rather than with what it holds.
 *
 * Refused (sparseWriteRefusal): a variable a reader did not decode (`undecoded`, which has
 * no values here to write, only the placeholder that stands for them), a shape or class
 * MATLAB has no sparse storage for, a dense value whose length its dims disagree with, an
 * array whose dims declare more columns than what it was read from backs, and non-zeros out
 * of MATLAB's order or outside the array — each a stream MATLAB would read back as
 * something else, or, for the columns, one that would cost what no byte of the file held.
 */
function encodeSparse(v: MatVariable): Uint8Array {
  const refusal = sparseWriteRefusal(v);
  if (refusal) {
    throw new MatWriteError(refusal);
  }
  const d = dimsOf(v);
  const logical = !!v.isLogical || v.className === 'logical';
  const cls = logical || v.className === 'double' ? MX_SPARSE : CLASS_CODE.single;
  const payload = logical ? MI_UINT8 : v.className === 'double' ? MI_DOUBLE : MI_SINGLE;
  const complex = !!v.isComplex && !logical;
  const [rows, cols] = d;
  const s = v.sparse ?? sparseFromDense(flatValues(v.value), d, complex);
  const ir: number[] = [];
  const jc = new Int32Array(cols + 1);
  const re: number[] = [];
  const im: number[] = [];
  for (let k = 0; k < s.row.length; k++) {
    const r = s.row[k];
    const c = s.col[k];
    const ordered = k === 0 || c > s.col[k - 1] || (c === s.col[k - 1] && r > s.row[k - 1]);
    if (!(r >= 0 && r < rows && c >= 0 && c < cols) || !ordered) {
      throw new MatWriteError('a sparse array\'s non-zeros are out of order or outside [' + d.join(',') + '] at entry ' + k);
    }
    const a = s.re[k];
    const b = complex && s.im ? s.im[k] : 0;
    // `!== 0` is true of NaN and false of -0, which is MATLAB's rule for both.
    if (a !== 0 || b !== 0) {
      ir.push(r);
      re.push(logical ? 1 : a);
      im.push(b);
      jc[c + 1]++;
    }
  }
  for (let c = 0; c < cols; c++) {
    jc[c + 1] += jc[c];
  }
  const flags = new Uint8Array(8);
  flags[0] = cls;
  flags[1] = SPARSE_FLAG | (complex ? 0x08 : 0) | (logical ? 0x02 : 0);
  new DataView(flags.buffer).setUint32(4, Math.max(ir.length, 1), true);
  const subs = [
    element(MI_UINT32, flags),
    dimsElement(d),
    emptyName(),
    numericPayload(MI_INT32, ir),
    numericPayload(MI_INT32, jc),
    numericPayload(payload, re),
  ];
  if (complex) {
    subs.push(numericPayload(payload, im));
  }
  return element(MI_MATRIX, concat(subs));
}

/**
 * Why encodeSparse refuses `v`, or null when it writes it. Read off the shape, the class and
 * what the non-zeros say backs them — never the non-zeros themselves — so it is asked of a
 * node before it offers an editor (MatlabVariableNode._sparseRefusal): an array no edit of
 * could be written takes none.
 *
 * The column index is the one part of the stream that grows with the array's declared
 * shape: cols + 1 words, whatever the rows. So the columns have to be backed by what the
 * array came from (SparseData.backedColumns): a file's own column index, or a dense list's
 * elements, one column apiece — never the declared count alone. One read from a file whose
 * index held fewer columns than its dims declare has a damaged dims word (`new Array(2^31)`
 * for one corrupted cols word of a 3 KB hex value, a fatal out-of-memory no caller could
 * catch), and `Matrix(0,134217728)\n[]`, credited its header's columns, was a 512 MB index
 * from 52 characters. And no stream holds a column index past what its uint32 size word
 * can say. A value MATLAB wrote is none of these.
 */
export function sparseWriteRefusal(
  v: Pick<MatVariable, 'undecoded' | 'dimensions' | 'className' | 'isLogical' | 'sparse' | 'value'>,
): string | null {
  if (v.undecoded) {
    return 'cannot write a sparse array the reader did not decode (' + v.undecoded + ')';
  }
  const d = dimsOf(v);
  if (d.length !== 2) {
    return 'a sparse array has two dimensions, not [' + d.join(',') + ']';
  }
  const logical = !!v.isLogical || v.className === 'logical';
  if (!logical && v.className !== 'double' && v.className !== 'single') {
    return 'no sparse MAT class for "' + v.className + '"';
  }
  const [rows, cols] = d;
  // What backs the columns: the source's own index, or its elements, one column apiece —
  // never the declared count, which is one word of the file (SparseData.backedColumns).
  let backed: number;
  if (v.sparse) {
    backed = backedColumnsOf(v.sparse);
  } else {
    const n = flatValues(v.value).length;
    if (n !== rows * cols) {
      return 'sparse value has ' + n + ' elements but declares [' + d.join(',') + ']';
    }
    backed = Math.min(cols, n);
  }
  if (backed < cols) {
    return 'a sparse array declaring ' + cols + ' columns is backed for ' + backed + ', and its column index would be words no byte of its source held';
  }
  if (4 * (cols + 1) > 0xffffffff) {
    return 'a sparse array of ' + cols + ' columns has a column index no MAT stream can hold';
  }
  return null;
}

/** The bytes of one complete `miMATRIX` element: tag, then the matrix body. */
export function encodeMatVariable(v: MatVariable): Uint8Array {
  if (v.isOpaque) {
    throw new MatWriteError('cannot write an MCOS opaque value (' + (v.className || 'unknown') + ')');
  }
  // Before the class lookup, because a sparse array's class IS one the full-array arms
  // have a code for — MATLAB's class() of a sparse double is 'double' — and the full
  // array they would write is a different variable: the same values, stored dense.
  if (v.isSparse) {
    return encodeSparse(v);
  }
  const cls = CLASS_CODE[v.className];
  if (cls === undefined) {
    throw new MatWriteError('no MAT class for "' + v.className + '"');
  }
  const d = dimsOf(v);
  const logical = !!v.isLogical || v.className === 'logical';
  const subs = [arrayFlags(cls, !!v.isComplex, logical), dimsElement(d), emptyName()];
  if (cls === MX_CELL) {
    subs.push(...cellBody(v, d));
  } else if (cls === MX_STRUCT) {
    subs.push(...structBody(v, d));
  } else if (cls === MX_CHAR) {
    subs.push(...charBody(v, d));
  } else {
    subs.push(...numericBody(v, logical ? MX_UINT8 : cls, d));
  }
  return element(MI_MATRIX, concat(subs));
}

/**
 * The `_value` string of a text .sldd `{"_type": "cdata"}` entry: the 8-byte
 * preamble, one miMATRIX element, uuencoded.
 */
export function encodeCdata(v: MatVariable): string {
  return uuencode(encodeMatStream(v));
}

/**
 * The MAT stream of one value — `getByteStreamFromArray(value)`: the 8-byte preamble and
 * one miMATRIX element. A text dictionary carries it uuencoded (encodeCdata), a binary
 * one as hex (EncodedValue.hexValue).
 */
export function encodeMatStream(v: MatVariable): Uint8Array {
  return concat([new Uint8Array(CDATA_PREAMBLE), encodeMatVariable(v)]);
}

/**
 * The MAT stream of a value whose miMATRIX element is at hand AS READ (MatVariable's
 * `_rawBytes`), or null when the bytes are not a whole one this can re-frame.
 *
 * For the value nothing here can re-encode because the reader never decoded it — one
 * MatParser recorded as `undecoded` — and which a copy out of a .mat or a model workspace
 * into a dictionary would otherwise write as the text of its placeholder. Its bytes are
 * the value; the one thing in them a stream does not carry is the variable's NAME, which a
 * .mat writes into the element and a stream leaves empty, so the name subelement is
 * replaced by the empty one and the element's size restated. Everything else is copied byte for byte. An MCOS opaque (class 17) is not framed this
 * way, and its subsystem lives elsewhere in the file, so it is refused.
 */
export function matStreamOfElement(raw: Uint8Array): Uint8Array | null {
  if (raw.length < 8) {
    return null;
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const end = 8 + view.getUint32(4, true);
  if (view.getUint32(0, true) !== MI_MATRIX || end > raw.length) {
    return null;
  }
  // The byte length of the subelement at `at`, small form included, or 0 past the end.
  const subLength = (at: number): number => {
    if (at + 8 > end) {
      return 0;
    }
    const word = view.getUint32(at, true);
    if (word >>> 16) {
      return 8;
    }
    const n = view.getUint32(at + 4, true);
    return 8 + n + ((8 - (n % 8)) % 8);
  };
  const flags = subLength(8);
  if (!flags || raw[16] === 17) {
    return null;
  }
  const dims = subLength(8 + flags);
  const nameAt = 8 + flags + dims;
  const name = dims ? subLength(nameAt) : 0;
  if (!name || nameAt + name > end) {
    return null;
  }
  const body = concat([raw.slice(8, nameAt), emptyName(), raw.slice(nameAt + name, end)]);
  return concat([new Uint8Array(CDATA_PREAMBLE), u32le(MI_MATRIX), u32le(body.length), body]);
}

/**
 * A complex value's plain-text form — `{_type: 'cdata', _value: '1+2i 5+6i 3+4i 7+8i',
 * _dimensions, _class?}`, what BinarySlddParser reads out of a binary dictionary and
 * McosParser.complexPropertyValue builds — as the variable it stands for, or null when it
 * is not that form or a token in it is not one complex element. Read off the text, so a
 * value the node layer could not read as numbers (a binary dictionary's own non-finite
 * text, shown quoted) still converts: XmlUtils.parseComplexNum reads every spelling,
 * MATLAB's `1.0NaNi` included.
 */
export function complexTextVariable(raw: unknown): MatVariable | null {
  const env = raw as Record<string, unknown> | null | undefined;
  if (!env || env._type !== 'cdata' || typeof env._value !== 'string' || isMatCdata(env)) {
    return null;
  }
  const cls = complexClassTag(env._class) ?? 'double';
  const text = env._value.trim();
  const tokens = text === '' ? [] : text.split(/\s+/);
  const dims = Array.isArray(env._dimensions) ? (env._dimensions as number[]).slice() : [1, tokens.length];
  if (elementCountOf(dims) !== tokens.length) {
    return null;
  }
  const pairs = tokens.map((t) => parseComplexNum(t, cls));
  if (pairs.some((pair) => pair === null)) {
    return null;
  }
  return {
    name: '',
    className: cls,
    dimensions: dims,
    isComplex: true,
    isLogical: false,
    // The text is column-major; a variable is row-major within each page, as MatParser
    // builds one and numericBody above expects.
    value: transposeFromColumnMajorND(pairs, dims),
    fields: null,
  };
}

/**
 * A value as an uncompressed-text dictionary must hold it: every complex value in its
 * plain-text form, at any depth, replaced by the MAT stream MATLAB writes for it there,
 * and everything else as it was. A copy wherever something changed, so the bag a node
 * replays is never touched; the same object where nothing did.
 *
 * MATLAB reads the plain-text form back out of a TEXT dictionary as an empty double
 * (defect 24's signature), and it is the form a binary dictionary and the MCOS decoder
 * hold a complex value in, which an untouched value replays: a Parameter pasted out of a
 * binary dictionary, or copied out of a .mat, went into a text one as
 * `{"_type": "cdata", "_value": "3+4i"}` and MATLAB reopened it as []. At any depth,
 * because the replay is whole bags too — a struct's, a cell's, a LookupTable's Table.
 */
export function textDictionaryForm(x: unknown): unknown {
  if (x === null || typeof x !== 'object') {
    return x;
  }
  if (Array.isArray(x)) {
    let changed = false;
    const out = x.map((e) => {
      const t = textDictionaryForm(e);
      changed = changed || t !== e;
      return t;
    });
    return changed ? out : x;
  }
  const o = x as Record<string, unknown>;
  // A binary dictionary's encoded byte stream (EncodedValue) is the same stream a text
  // dictionary carries for the same value as cdata, four bits a character there and six
  // here — MATLAB's own text twin of a hex sparse array is that cdata character for
  // character. Written into a text dictionary as it stands, it would be a `_type` MATLAB
  // has no reader for. A stream whose bytes cannot be read is left as it is: nothing
  // else here could say what it holds.
  if (isEncodedValue(o)) {
    const read = encodedBytes(o);
    return read.bytes ? { _type: 'cdata', _value: uuencode(read.bytes) } : o;
  }
  if (o._type === 'cdata') {
    const variable = complexTextVariable(o);
    if (!variable) {
      return o;
    }
    try {
      return { _type: 'cdata', _value: encodeCdata(variable) };
    } catch {
      return o;
    }
  }
  let out: Record<string, unknown> | null = null;
  for (const k of Object.keys(o)) {
    const t = textDictionaryForm(o[k]);
    if (t !== o[k]) {
      out = out ?? { ...o };
      out[k] = t;
    }
  }
  return out ?? o;
}
