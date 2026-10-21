// Copyright 2026 The MathWorks, Inc.
//
// What a Level-5 miMATRIX element holds, read straight off its bytes by a walker of its own,
// with no help from the package's reader (MatParser) or writer (MatWriter). A test that compares
// the variable a save wrote with the one the file held through the package's own reader sees
// only what that reader keeps: a struct array of no element read as `fields: {}`, so a save
// that wrote its field-name table empty read back as the variable it was read as, and MATLAB
// loaded a struct of no field (test/parity/matlab/matWritebackDefects.test.ts). This reads every
// part of the element MATLAB's `load` reads for a plain value, so that two elements are the same
// value exactly when what it gives them is the same.
//
// What it keeps of an element, `ElementValue`:
//   - the array class and the flags byte's complex, global, logical and sparse bits, and the
//     dims;
//   - a struct's (or a class-3 object's) field names, in order, from its field-name table,
//     whatever its stride, and an object's class name;
//   - the members of a cell, and of a struct, element by element and field by field, each the
//     same way;
//   - a numeric array's elements, as its class holds them whatever type the file stored them
//     in (MATLAB narrows a double's storage to the smallest integer type that holds it):
//     a double or a single as the bits of its IEEE value, so -0 is not 0, and NaN as `NaN`
//     whatever its payload (see `nan`); an integer as its exact decimal, int64 and uint64
//     included; complex parts apart;
//   - a char's UTF-16 code units, however the file stored them (miUTF8, miUTF16, miUINT16,
//     miUINT8);
//   - a sparse array's row index, column starts and non-zeros, nzmax apart (the capacity
//     MATLAB reserves, not the value).
// A class-17 (MCOS opaque) element is kept as its bytes: no save writes one fresh.

export interface ElementValue {
  cls: number;
  complex: boolean;
  global: boolean;
  logical: boolean;
  sparse: boolean;
  dims: number[];
  name: string;
  className?: string;
  fields?: string[];
  members?: ElementValue[];
  re?: string[];
  im?: string[];
  text?: number[];
  ir?: number[];
  jc?: number[];
  opaque?: number[];
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
const MI_UTF16 = 17;

const CELL = 1;
const STRUCT = 2;
const OBJECT = 3;
const CHAR = 4;
const SPARSE = 5;
const DOUBLE = 6;
const SINGLE = 7;
const INT64 = 14;
const UINT64 = 15;
const OPAQUE = 17;

interface Sub {
  type: number;
  data: Uint8Array;
  next: number;
}

// One data element at `at`: its type, its data, and where the next one starts. The small form
// packs type and length into one word and its data into the next; the long one pads to 8.
function subAt(view: DataView, bytes: Uint8Array, at: number): Sub {
  const word = view.getUint32(at, true);
  if (word >>> 16) {
    const n = word >>> 16;
    return { type: word & 0xffff, data: bytes.subarray(at + 4, at + 4 + n), next: at + 8 };
  }
  const n = view.getUint32(at + 4, true);
  return { type: word, data: bytes.subarray(at + 8, at + 8 + n), next: at + 8 + Math.ceil(n / 8) * 8 };
}

// What NaN is kept as. A NaN's payload is not compared: this package's reader holds a double as
// a JavaScript number, and V8 does not promise a NaN's payload through one (it may hand back
// the canonical NaN), so a payload is not something a save of a value read here can be held to.
// MATLAB's own arithmetic makes the canonical NaN; a file holding another is MATLAB's own write
// of a value someone built bit by bit.
const nan = 'NaN';

function bitsOf64(x: number): string {
  if (Number.isNaN(x)) {
    return nan;
  }
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, x, true);
  return b.getBigUint64(0, true).toString(16);
}

function bitsOf32(x: number): string {
  if (Number.isNaN(x)) {
    return nan;
  }
  const b = new DataView(new ArrayBuffer(4));
  b.setFloat32(0, x, true);
  return b.getUint32(0, true).toString(16);
}

// The elements a data element holds, as numbers, or as bigints for the 64-bit integer types.
function numbersOf(sub: Sub): (number | bigint)[] {
  const v = new DataView(sub.data.buffer, sub.data.byteOffset, sub.data.byteLength);
  const out: (number | bigint)[] = [];
  const each = (size: number, read: (at: number) => number | bigint) => {
    for (let at = 0; at + size <= sub.data.byteLength; at += size) {
      out.push(read(at));
    }
  };
  switch (sub.type) {
    case MI_INT8:
      each(1, (at) => v.getInt8(at));
      break;
    case MI_UINT8:
    case MI_UTF8:
      each(1, (at) => v.getUint8(at));
      break;
    case MI_INT16:
      each(2, (at) => v.getInt16(at, true));
      break;
    case MI_UINT16:
    case MI_UTF16:
      each(2, (at) => v.getUint16(at, true));
      break;
    case MI_INT32:
      each(4, (at) => v.getInt32(at, true));
      break;
    case MI_UINT32:
      each(4, (at) => v.getUint32(at, true));
      break;
    case MI_SINGLE:
      each(4, (at) => v.getFloat32(at, true));
      break;
    case MI_DOUBLE:
      each(8, (at) => v.getFloat64(at, true));
      break;
    case MI_INT64:
      each(8, (at) => v.getBigInt64(at, true));
      break;
    case MI_UINT64:
      each(8, (at) => v.getBigUint64(at, true));
      break;
    default:
      throw new Error('a numeric part of data type ' + sub.type);
  }
  return out;
}

// A numeric part's elements as its class holds them (see the file header).
function partOf(sub: Sub, cls: number): string[] {
  return numbersOf(sub).map((x) => {
    if (cls === DOUBLE) {
      return bitsOf64(Number(x));
    }
    if (cls === SINGLE) {
      return bitsOf32(Number(x));
    }
    return typeof x === 'bigint' ? x.toString() : cls === INT64 || cls === UINT64 ? BigInt(x).toString() : String(x);
  });
}

// A char's UTF-16 code units: miUTF8 decoded, every other type one unit per element.
function codeUnitsOf(sub: Sub): number[] {
  if (sub.type === MI_UTF8) {
    const text = new TextDecoder().decode(sub.data);
    return Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));
  }
  return numbersOf(sub).map(Number);
}

const textOf = (data: Uint8Array) => new TextDecoder().decode(data).replace(/\0+$/, '');

/** What the miMATRIX element whose tag is at `at` of `bytes` holds (see the file header). */
export function elementValue(bytes: Uint8Array, at = 0): ElementValue {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = subAt(view, bytes, at);
  if (tag.type !== MI_MATRIX) {
    throw new Error('not a matrix element (data type ' + tag.type + ')');
  }
  const end = at + 8 + tag.data.byteLength;
  let o = at + 8;
  const next = () => {
    const s = subAt(view, bytes, o);
    o = s.next;
    return s;
  };
  const flags = next();
  const cls = flags.data[0];
  const out: ElementValue = {
    cls,
    complex: (flags.data[1] & 0x08) !== 0,
    global: (flags.data[1] & 0x04) !== 0,
    logical: (flags.data[1] & 0x02) !== 0,
    // Class 5, or the sparse bit, which is all a sparse single has (MatWriter.encodeSparse).
    sparse: cls === SPARSE || (flags.data[1] & 0x10) !== 0,
    dims: [],
    name: '',
  };
  if (cls === OPAQUE) {
    out.opaque = Array.from(bytes.subarray(at, end));
    return out;
  }
  const dims = next();
  const dv = new DataView(dims.data.buffer, dims.data.byteOffset, dims.data.byteLength);
  for (let i = 0; i + 4 <= dims.data.byteLength; i += 4) {
    out.dims.push(dv.getInt32(i, true));
  }
  out.name = textOf(next().data);
  const n = out.dims.reduce((a, b) => a * b, 1);
  const members = (count: number) => {
    const list: ElementValue[] = [];
    for (let i = 0; i < count && o < end; i++) {
      list.push(elementValue(bytes, o));
      o = subAt(view, bytes, o).next;
    }
    return list;
  };
  if (cls === CELL) {
    out.members = members(n);
  } else if (cls === STRUCT || cls === OBJECT) {
    if (cls === OBJECT) {
      out.className = textOf(next().data);
    }
    const stride = next();
    const len = new DataView(stride.data.buffer, stride.data.byteOffset, 4).getInt32(0, true);
    const names = next();
    out.fields = [];
    for (let i = 0; len > 0 && i < names.data.byteLength; i += len) {
      out.fields.push(textOf(names.data.subarray(i, i + len)));
    }
    out.members = members(n * out.fields.length);
  } else if (cls === CHAR) {
    out.text = o < end ? codeUnitsOf(next()) : [];
  } else if (out.sparse) {
    out.ir = numbersOf(next()).map(Number);
    out.jc = numbersOf(next()).map(Number);
    // A logical's non-zeros as the numbers they are, a double's and a single's as their bits.
    const sparseCls = out.logical ? 9 : cls === SPARSE ? DOUBLE : cls;
    out.re = o < end ? partOf(next(), sparseCls) : [];
    if (out.complex) {
      out.im = o < end ? partOf(next(), sparseCls) : [];
    }
  } else {
    out.re = o < end ? partOf(next(), cls) : [];
    if (out.complex) {
      out.im = o < end ? partOf(next(), cls) : [];
    }
  }
  return out;
}

/**
 * The first difference between two element values, as a path and what differs, or null when
 * they are the same value. The element's own name is not compared: a top-level variable's is its
 * record's, which the caller asks after; every member's is empty.
 */
export function elementDifference(was: ElementValue, is: ElementValue, at = ''): string | null {
  const said = (what: string, a: unknown, b: unknown) => (at || 'the value') + ': ' + what + ' ' + JSON.stringify(a) + ' read, ' + JSON.stringify(b) + ' written';
  for (const key of ['cls', 'complex', 'global', 'logical', 'sparse', 'className'] as const) {
    if (was[key] !== is[key]) {
      return said(key, was[key], is[key]);
    }
  }
  if (was.dims.join('x') !== is.dims.join('x')) {
    return said('dims', was.dims, is.dims);
  }
  for (const key of ['fields', 're', 'im', 'text', 'ir', 'jc', 'opaque'] as const) {
    if (JSON.stringify(was[key]) !== JSON.stringify(is[key])) {
      return said(key, was[key], is[key]);
    }
  }
  const a = was.members ?? [];
  const b = is.members ?? [];
  if (a.length !== b.length) {
    return said('member count', a.length, b.length);
  }
  const fields = was.fields;
  const n = was.dims.reduce((x, y) => x * y, 1);
  for (let i = 0; i < a.length; i++) {
    const where = fields
      ? at + (n === 1 ? '' : '(' + (Math.floor(i / fields.length) + 1) + ')') + '.' + fields[i % fields.length]
      : at + '{' + (i + 1) + '}';
    const d = elementDifference(a[i], b[i], where);
    if (d) {
      return d;
    }
  }
  return null;
}
