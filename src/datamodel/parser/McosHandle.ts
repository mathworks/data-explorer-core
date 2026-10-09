// Copyright 2026 The MathWorks, Inc.

import type { MatVariable } from './MatParser.js';

// An MCOS object HANDLE: the uint32 words by which a variable, a struct field, a cell
// element or an object-valued property names the objects it holds in the file's one
// shared MCOS heap, laid out as [magic, ndims, dim0, dim1, …, objId0, objId1, …] and
// followed by a class id this reader does not use. A scalar is [magic, 2, 1, 1, id]; an
// N-element array is [magic, 2, N, 1, id0..idN-1], ids in column-major order.
//
// A module of its own because two readers have to agree on it and neither may import
// the other: MatParser reads the handle out of every class-17 element it parses, and
// McosParser reads it out of a property value and out of a variable's raw bytes —
// while already importing MatParser to parse its heap cells.

export const MCOS_HANDLE_MAGIC = 3707764736; // 0xDD000000

// The handle PREFIX check: a uint32 array long enough to carry the shortest legal
// handle, [magic, ndims, rows, cols, id], and tagged with the magic. This is the
// single place that shape is decided — objectHandleFromValue takes it as a
// precondition rather than re-deriving it, so the two cannot drift apart on what
// counts as a handle.
export function isObjectHandle(cell: MatVariable): boolean {
  if (cell.className !== 'uint32') return false;
  const v = cell.value;
  return Array.isArray(v) && v.length >= 5 && v[0] === MCOS_HANDLE_MAGIC;
}

// Parse an object handle already decoded into a uint32 value array (as it appears
// for a NESTED object-valued property inside a block, and as the fourth part of every
// class-17 element), laid out exactly like the raw-byte form. Returns the dimensions
// and the FULL id list so a nested object ARRAY (e.g. a Bus's Elements_internal, or
// any object-array property) keeps every element, not just its first.
//
// PRECONDITION: isObjectHandle(cell) — so `v` is a magic-tagged uint32 array of at
// least 5 elements. Null here means the DIMENSION words are not self-consistent
// (the count they describe does not fit the ids present), which a damaged blob can
// produce; the caller falls back to reading v[4] as a scalar id.
//
// Null too for any word that is not a whole non-negative number. A uint32 array always
// gives one, but the array's DATA can be stored as another type, and an id of 2.5 is
// inside the object table's range while naming no row of it: it used to reach the
// decoder and throw there, failing the whole file open.
export function objectHandleFromValue(v: number[]): { dims: number[]; ids: number[] } | null {
  const ndims = v[1];
  if (!isWhole(ndims) || ndims < 1 || ndims > 8 || 2 + ndims > v.length) return null;
  const dims: number[] = [];
  for (let d = 0; d < ndims; d++) dims.push(v[2 + d]);
  if (!dims.every(isWhole)) return null;
  const count = dims.reduce((a, b) => a * b, 1);
  if (count < 1 || 2 + ndims + count > v.length) return null;
  const ids: number[] = [];
  for (let k = 0; k < count; k++) ids.push(v[2 + ndims + k]);
  if (!ids.every(isWhole)) return null;
  return { dims, ids };
}

function isWhole(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

// The same handle found by SCANNING a variable's own element bytes for the magic
// word, which is how a variable's handle was located before MatParser kept it. Still
// the fallback for a variable that carries no parsed `mcosHandle`: one built by a host
// from an older parse, or one whose handle element did not parse.
export function objectHandleFromRaw(rawBytes: Uint8Array | null | undefined): { dims: number[]; ids: number[] } | null {
  if (!rawBytes || rawBytes.length < 4) return null;
  const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
  for (let o = 0; o + 8 <= rawBytes.length; o += 4) {
    if (view.getUint32(o, true) !== MCOS_HANDLE_MAGIC) continue;
    const word = (i: number): number => view.getUint32(o + i * 4, true);
    const ndims = word(1);
    // Defensive: a sane handle has 1..8 dims that fit within the remaining words.
    if (ndims < 1 || ndims > 8 || o + (2 + ndims) * 4 > rawBytes.length) return null;
    const dims: number[] = [];
    for (let d = 0; d < ndims; d++) dims.push(word(2 + d));
    const count = dims.reduce((a, b) => a * b, 1);
    if (count < 1 || o + (2 + ndims + count) * 4 > rawBytes.length) return null;
    const ids: number[] = [];
    for (let k = 0; k < count; k++) ids.push(word(2 + ndims + k));
    return { dims, ids };
  }
  return null;
}
