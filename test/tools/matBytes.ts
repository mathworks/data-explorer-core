// Copyright 2026 The MathWorks, Inc.
//
// A minimal Level-5 MAT-file writer, used only by tests.
//
// The .mat/.mxarray fixtures we ship are all produced by MATLAB, so they only
// contain the shapes MATLAB happens to emit: double/logical/char/struct/cell and
// MCOS opaques, always zlib-compressed, always well-formed. That leaves whole
// families of the reader untested — every non-double numeric width, complex
// arrays, UTF-16 char data, struct ARRAYS (as opposed to scalar structs), a cell
// holding a non-matrix element, and every malformed-stream guard. Recording a
// fixture per case is impractical (many of them MATLAB will not write at all), so
// the tests synthesize the bytes instead.
//
// Everything here writes the LONG (8-byte) tag form. The reader also accepts
// MATLAB's small-element form, which real fixtures already cover; using only the
// long form here keeps the writer trivial and still exercises the same decode
// paths.

/** Data-element type codes (the `miXXX` constants of the MAT-file spec). */
export const MI = {
  INT8: 1,
  UINT8: 2,
  INT16: 3,
  UINT16: 4,
  INT32: 5,
  UINT32: 6,
  SINGLE: 7,
  DOUBLE: 9,
  INT64: 12,
  UINT64: 13,
  MATRIX: 14,
  COMPRESSED: 15,
  UTF8: 16,
  UTF16: 17,
} as const;

/** Array-class codes (the `mxXXX_CLASS` constants). */
export const CLASS = {
  CELL: 1,
  STRUCT: 2,
  OBJECT: 3,
  CHAR: 4,
  SPARSE: 5,
  DOUBLE: 6,
  SINGLE: 7,
  INT8: 8,
  UINT8: 9,
  INT16: 10,
  UINT16: 11,
  INT32: 12,
  UINT32: 13,
  INT64: 14,
  UINT64: 15,
  OPAQUE: 17,
} as const;

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function u32le(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n >>> 0, true);
  return out;
}

/**
 * One data element: an 8-byte tag (type, byte count) plus the payload padded out
 * to an 8-byte boundary. The tag reports the UNPADDED count, as the spec requires.
 */
export function element(type: number, data: Uint8Array): Uint8Array {
  const padded = (8 - (data.length % 8)) % 8;
  return concat([u32le(type), u32le(data.length), data, new Uint8Array(padded)]);
}

/** The array-flags subelement: class in byte 0, the complex/logical bits in byte 1. */
export function arrayFlags(cls: number, opts: { complex?: boolean; logical?: boolean } = {}): Uint8Array {
  const data = new Uint8Array(8);
  data[0] = cls;
  data[1] = (opts.complex ? 0x08 : 0) | (opts.logical ? 0x02 : 0);
  return element(MI.UINT32, data);
}

export function dims(d: number[]): Uint8Array {
  const data = new Uint8Array(d.length * 4);
  const view = new DataView(data.buffer);
  d.forEach((n, i) => view.setInt32(i * 4, n, true));
  return element(MI.INT32, data);
}

export function varName(s: string): Uint8Array {
  return element(MI.INT8, new TextEncoder().encode(s));
}

const WIDTH: Record<number, number> = {
  [MI.INT8]: 1,
  [MI.UINT8]: 1,
  [MI.INT16]: 2,
  [MI.UINT16]: 2,
  [MI.INT32]: 4,
  [MI.UINT32]: 4,
  [MI.SINGLE]: 4,
  [MI.DOUBLE]: 8,
  [MI.INT64]: 8,
  [MI.UINT64]: 8,
};

/** A numeric payload element, written at the width the element type implies. */
export function numericData(type: number, values: number[]): Uint8Array {
  const width = WIDTH[type];
  if (!width) {
    throw new Error(`numericData: no width for element type ${type}`);
  }
  const data = new Uint8Array(values.length * width);
  const view = new DataView(data.buffer);
  values.forEach((v, i) => {
    const at = i * width;
    switch (type) {
      case MI.INT8: view.setInt8(at, v); break;
      case MI.UINT8: view.setUint8(at, v); break;
      case MI.INT16: view.setInt16(at, v, true); break;
      case MI.UINT16: view.setUint16(at, v, true); break;
      case MI.INT32: view.setInt32(at, v, true); break;
      case MI.UINT32: view.setUint32(at, v, true); break;
      case MI.SINGLE: view.setFloat32(at, v, true); break;
      case MI.DOUBLE: view.setFloat64(at, v, true); break;
      case MI.INT64: view.setBigInt64(at, BigInt(v), true); break;
      default: view.setBigUint64(at, BigInt(v), true); break;
    }
  });
  return element(type, data);
}

/** Wrap subelements as an miMATRIX element. */
export function matrix(subs: Uint8Array[]): Uint8Array {
  return element(MI.MATRIX, concat(subs));
}

export interface NumericVarSpec {
  name: string;
  cls: number;
  dimensions: number[];
  /** Element type of the payload; defaults to the natural type for `cls`. */
  dataType?: number;
  real: number[];
  imag?: number[];
  logical?: boolean;
  /** Emit no payload subelement at all (a truncated variable). */
  omitData?: boolean;
  /**
   * Replaces the real payload wholesale. Used to hand the reader an element type
   * it has no case for (the `default` arm of its width switch), which
   * `numericData` deliberately refuses to write.
   */
  rawReal?: Uint8Array;
}

const NATURAL_DATA_TYPE: Record<number, number> = {
  [CLASS.DOUBLE]: MI.DOUBLE,
  [CLASS.SINGLE]: MI.SINGLE,
  [CLASS.INT8]: MI.INT8,
  [CLASS.UINT8]: MI.UINT8,
  [CLASS.INT16]: MI.INT16,
  [CLASS.UINT16]: MI.UINT16,
  [CLASS.INT32]: MI.INT32,
  [CLASS.UINT32]: MI.UINT32,
  [CLASS.INT64]: MI.INT64,
  [CLASS.UINT64]: MI.UINT64,
};

export function numericVar(spec: NumericVarSpec): Uint8Array {
  const type = spec.dataType ?? NATURAL_DATA_TYPE[spec.cls];
  const subs = [
    arrayFlags(spec.cls, { complex: !!spec.imag, logical: spec.logical }),
    dims(spec.dimensions),
    varName(spec.name),
  ];
  if (!spec.omitData) {
    subs.push(spec.rawReal ? element(type, spec.rawReal) : numericData(type, spec.real));
    if (spec.imag) {
      subs.push(numericData(type, spec.imag));
    }
  }
  return matrix(subs);
}

/**
 * A char array whose payload element type is chosen by the caller. The payload is
 * encoded at the width the element type implies — 16 bits for UTF16/UINT16, bytes
 * otherwise — so that a reader decoding it correctly gets `text` back.
 */
export function charVar(name: string, text: string, dataType: number, dimensions?: number[]): Uint8Array {
  const bytes =
    dataType === MI.UTF16 || dataType === MI.UINT16
      ? (() => {
          const out = new Uint8Array(text.length * 2);
          const view = new DataView(out.buffer);
          for (let i = 0; i < text.length; i++) {
            view.setUint16(i * 2, text.charCodeAt(i), true);
          }
          return out;
        })()
      : new TextEncoder().encode(text);
  return matrix([
    arrayFlags(CLASS.CHAR),
    dims(dimensions ?? [1, text.length]),
    varName(name),
    element(dataType, bytes),
  ]);
}

/**
 * A struct variable. `fieldValues` is one entry per struct element, each mapping
 * field name -> the miMATRIX bytes for that field's value. Pass `dimensions` to
 * declare a struct array; declaring more elements than `fieldValues` supplies
 * produces a truncated stream on purpose.
 */
export function structVar(
  name: string,
  fieldNames: string[],
  fieldValues: Array<Record<string, Uint8Array>>,
  dimensions?: number[],
): Uint8Array {
  const fieldNameLen = 32;
  const lenData = new Uint8Array(4);
  new DataView(lenData.buffer).setInt32(0, fieldNameLen, true);
  const namesData = new Uint8Array(fieldNames.length * fieldNameLen);
  fieldNames.forEach((fn, i) => namesData.set(new TextEncoder().encode(fn), i * fieldNameLen));

  const subs = [
    arrayFlags(CLASS.STRUCT),
    dims(dimensions ?? [1, 1]),
    varName(name),
    element(MI.INT32, lenData),
    element(MI.INT8, namesData),
  ];
  for (const values of fieldValues) {
    for (const fn of fieldNames) {
      subs.push(values[fn]);
    }
  }
  return matrix(subs);
}

/** A cell variable; each entry is the raw element bytes for that cell. */
export function cellVar(name: string, cells: Uint8Array[], dimensions?: number[]): Uint8Array {
  return matrix([
    arrayFlags(CLASS.CELL),
    dims(dimensions ?? [1, cells.length]),
    varName(name),
    ...cells,
  ]);
}

export interface MatFileOptions {
  /** 'IM' (default) is little-endian; 'MI' declares big-endian, which we reject. */
  endian?: 'IM' | 'MI';
  /** Raw bytes appended after the elements, e.g. a truncated trailing tag. */
  trailing?: Uint8Array;
  headerText?: string;
}

/** A complete .mat buffer: 128-byte header, then the given top-level elements. */
export function matFile(elements: Uint8Array[], opts: MatFileOptions = {}): ArrayBuffer {
  const header = new Uint8Array(128);
  header.fill(0x20, 0, 116);
  header.set(
    new TextEncoder().encode(opts.headerText ?? 'MATLAB 5.0 MAT-file, synthesized by data-explorer-core tests'),
    0,
  );
  header[124] = 0x00;
  header[125] = 0x01;
  const endian = opts.endian ?? 'IM';
  header[126] = endian.charCodeAt(0);
  header[127] = endian.charCodeAt(1);

  const body = concat([header, ...elements, opts.trailing ?? new Uint8Array(0)]);
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
}

/**
 * The header text a `-v7.3` save writes, in the shape MATLAB writes it: the same
 * "MATLAB <version> MAT-file, Platform: ..., Created on: ..." form a Level-5 file
 * uses, with `7.3` where a Level-5 file says `5.0`, and the HDF5 schema version
 * appended.
 *
 * SYNTHESIZED, not recorded. No MATLAB-authored `-v7.3` file has ever been read
 * into this corpus — `probe_string.m:80` writes one to /tmp and it was never
 * harvested — so the platform and date text here is invented and only the `MATLAB
 * 7.3 MAT-file` prefix is load-bearing. That is why the reader matches on the
 * prefix rather than on this whole string; see the test that pins it.
 */
export const V73_HEADER_TEXT =
  'MATLAB 7.3 MAT-file, Platform: MACA64, Created on: Thu Sep 04 09:41:00 2025 HDF5 schema 1.00';

/** The HDF5 superblock signature: \x89 H D F \r \n \x1a \n. */
export const HDF5_SIGNATURE = new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface Hdf5MatOptions {
  headerText?: string;
  /**
   * HDF5 userblock size, i.e. where the superblock signature starts. MATLAB uses
   * 512, read off a real file (`test/parity/matlab/STRING_MCOS.md:132`); HDF5
   * itself requires a power of two >= 512.
   */
  userblock?: number;
}

/**
 * A `-v7.3` .mat buffer, as far as everything before the HDF5 superblock goes: the
 * ordinary 128-byte MATLAB header, zero padding out to the userblock size, then the
 * HDF5 superblock signature and some payload.
 *
 * Only the first 128 bytes are what a Level-5 reader ever looks at, and they are the
 * whole reason this format was reported as an empty file: the endian indicator is a
 * genuine little-endian `IM`, so the big-endian throw does not fire, and the first
 * record tag is read out of userblock padding, i.e. out of zeros.
 */
export function hdf5MatFile(opts: Hdf5MatOptions = {}): ArrayBuffer {
  const userblock = opts.userblock ?? 512;
  const out = new Uint8Array(userblock + HDF5_SIGNATURE.length + 64);
  out.fill(0x20, 0, 116);
  out.set(new TextEncoder().encode(opts.headerText ?? V73_HEADER_TEXT), 0);
  // Bytes 116-125 — the subsystem-data offset and the version field — are left zero.
  // A Level-5 file writes 0x0100 as its version and a v7.3 file is believed to write
  // something else, but nothing here has read one, so no test relies on that field
  // and this fixture does not pretend to know it.
  out[126] = 0x49; // 'I'
  out[127] = 0x4d; // 'M'
  out.set(HDF5_SIGNATURE, userblock);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

export interface MxArrayOptions {
  /** Defaults to the real magic, 00 01 49 4D. */
  magic?: number[];
  /** Overrides the outer element's type tag (miMATRIX by default). */
  outerTag?: number;
  /** Overrides the outer element's declared byte count. */
  outerSize?: number;
  /** Raw bytes appended after the outer element (trailing MCOS metadata). */
  trailing?: Uint8Array;
  /** Truncate the whole buffer to this length, to exercise the short-buffer guard. */
  truncateTo?: number;
}

/**
 * A complete .mxarray buffer: 8 bytes of magic/pad, then one outer element whose
 * body is `outerBody` (normally a struct matrix of workspace variables).
 */
export function mxArrayFile(outerBody: Uint8Array, opts: MxArrayOptions = {}): ArrayBuffer {
  const magic = new Uint8Array(8);
  magic.set(opts.magic ?? [0x00, 0x01, 0x49, 0x4d], 0);
  const size = opts.outerSize ?? outerBody.length;
  const padded = (8 - (outerBody.length % 8)) % 8;
  const body = concat([
    magic,
    u32le(opts.outerTag ?? MI.MATRIX),
    u32le(size),
    outerBody,
    new Uint8Array(padded),
    opts.trailing ?? new Uint8Array(0),
  ]);
  const sliced = opts.truncateTo === undefined ? body : body.slice(0, opts.truncateTo);
  return sliced.buffer.slice(sliced.byteOffset, sliced.byteOffset + sliced.byteLength) as ArrayBuffer;
}

/** The subelements of a matrix, without the outer miMATRIX tag. */
export function matrixBody(subs: Uint8Array[]): Uint8Array {
  return concat(subs);
}
