// Copyright 2026 The MathWorks, Inc.
//
// A `.mat` holding a small variable, then one compressed record that inflates to far more
// than a lowered ceiling, then another small variable: the input of test/matInflateCeiling
// .test.ts and of test/matInflateCeilingPeak.test.ts, which lower the ceiling to
// `LOWERED_CEILING` for it.
//
// The record is what MATLAB writes for `zeros(n, 1, 'uint8')` saved -v7: an miMATRIX of
// class uint8 named `bomb`, holding n zero bytes, zlib-wrapped. It is built without ever
// holding the n bytes: fflate's streaming compressor is fed the matrix header and then the
// same 1 MiB of zeros, with no flush points, so building it costs about a megabyte. A test
// that measures peak memory could not otherwise tell the cost of reading it from the cost
// of making it.
import { deflateSync } from 'node:zlib';
import { Zlib } from 'fflate';
import { CLASS, MI, arrayFlags, dims, numericVar, u32le, varName } from './matBytes.js';

/** The ceiling the tests read under: 1 MiB, so a record of 32 MiB is 32 times past it. */
export const LOWERED_CEILING = 1024 * 1024;
/** The zero bytes the bomb's uint8 array holds. */
export const BOMB_DATA_BYTES = 32 * 1024 * 1024;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** A top-level miCOMPRESSED record: its tag and the zlib stream, unpadded, as MATLAB writes it. */
function compressedRecord(stream: Uint8Array): Uint8Array {
  return concat([u32le(MI.COMPRESSED), u32le(stream.byteLength), stream]);
}

/** A 1x1 double named `name`, compressed. */
export function smallRecord(name: string, value: number): Uint8Array {
  const deflated = deflateSync(numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, 1], real: [value] }));
  return compressedRecord(new Uint8Array(deflated.buffer, deflated.byteOffset, deflated.byteLength));
}

/** The bomb's zlib stream, and how many bytes it inflates to. */
export function bombStream(): { stream: Uint8Array; inflated: number } {
  const header = concat([arrayFlags(CLASS.UINT8), dims([BOMB_DATA_BYTES, 1]), varName('bomb')]);
  const matrix = concat([u32le(MI.MATRIX), u32le(header.byteLength + 8 + BOMB_DATA_BYTES), header, u32le(MI.UINT8), u32le(BOMB_DATA_BYTES)]);
  const chunks: Uint8Array[] = [];
  const zlib = new Zlib({ level: 6 }, (chunk) => chunks.push(chunk));
  zlib.push(matrix);
  const megabyte = new Uint8Array(1024 * 1024);
  for (let i = 0; i < BOMB_DATA_BYTES / megabyte.byteLength; i++) zlib.push(megabyte);
  zlib.push(new Uint8Array(0), true);
  return { stream: concat(chunks), inflated: matrix.byteLength + BOMB_DATA_BYTES };
}

/**
 * The file: `before`, the bomb, `after`. `bombAt` is the byte offset of the bomb's record,
 * which is what a warning about it names.
 */
export function bombMat(): { buffer: ArrayBuffer; bombAt: number } {
  const header = new Uint8Array(128);
  header.fill(0x20, 0, 116);
  header.set(new TextEncoder().encode('MATLAB 5.0 MAT-file, built by test/tools/matInflateBomb.ts'), 0);
  header[125] = 0x01;
  header[126] = 0x49; // 'I'
  header[127] = 0x4d; // 'M'
  const before = smallRecord('before', 1);
  const bytes = concat([header, before, compressedRecord(bombStream().stream), smallRecord('after', 2)]);
  return { buffer: bytes.buffer as ArrayBuffer, bombAt: header.byteLength + before.byteLength };
}

/** What parseMat says about the bomb's record under a ceiling of `ceiling` bytes. */
export function ceilingWarning(bombAt: number, ceiling: number): { code: 'part-unreadable'; message: string } {
  return {
    code: 'part-unreadable',
    message: `A compressed record at byte ${bombAt} inflates to more than the ${ceiling}-byte ceiling `
      + 'for one MAT-file record, so the variable it holds was not read.',
  };
}
