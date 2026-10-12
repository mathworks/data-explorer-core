// Copyright 2026 The MathWorks, Inc.
//
// Derive a .mat fixture from one MATLAB wrote, by renaming a token inside it.
//
// MATLAB compresses every top-level variable of a Level-5 file (miCOMPRESSED), and an
// MCOS class name lives in two of them: the opaque variable's own element and the
// subsystem blob that carries the object's properties. A byte patch of the file cannot
// reach either, so this inflates each compressed element, replaces the token wherever
// it occurs, and deflates it again. The token and its replacement must be the same
// length, so that every offset INSIDE an element (the subsystem's string table, its
// property cells) still holds; only the elements' compressed sizes move, and the
// header's subsystem offset is moved with them.

import { unzlibSync, zlibSync } from 'fflate';

const MI_COMPRESSED = 15;
const SUBSYS_OFFSET_AT = 116;

function replaceAll(bytes: Uint8Array, from: Uint8Array, to: Uint8Array): number {
  let hits = 0;
  for (let i = 0; i + from.length <= bytes.length; i++) {
    let match = true;
    for (let j = 0; j < from.length; j++) {
      if (bytes[i + j] !== from[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      bytes.set(to, i);
      hits++;
      i += from.length - 1;
    }
  }
  return hits;
}

export interface RenamedMat {
  bytes: ArrayBuffer;
  /** How many times the token was replaced, over every element. */
  hits: number;
}

/**
 * `mat` with every occurrence of `from` inside its compressed elements replaced by `to`,
 * each either text or raw bytes. Pass `dropSubsystem` to also leave out the subsystem
 * element (and zero the header's pointer to it), which is a file whose objects the MCOS
 * decoder cannot resolve.
 */
export function renameInMat(
  mat: Uint8Array,
  from: string | Uint8Array,
  to: string | Uint8Array,
  dropSubsystem = false,
): RenamedMat {
  const fromBytes = typeof from === 'string' ? new TextEncoder().encode(from) : from;
  const toBytes = typeof to === 'string' ? new TextEncoder().encode(to) : to;
  if (fromBytes.length !== toBytes.length) {
    throw new Error(`renameInMat: the token and its replacement differ in length`);
  }
  const view = new DataView(mat.buffer, mat.byteOffset, mat.byteLength);
  const subsysAt = Number(view.getBigUint64(SUBSYS_OFFSET_AT, true));

  const header = mat.slice(0, 128);
  const parts: Uint8Array[] = [header];
  let length = header.length;
  let newSubsysAt = 0;
  let hits = 0;
  for (let at = 128; at + 8 <= mat.length;) {
    const type = view.getUint32(at, true);
    const size = view.getUint32(at + 4, true);
    const padded = type === MI_COMPRESSED ? size : size + ((8 - (size % 8)) % 8);
    let element = mat.subarray(at, at + 8 + padded);
    if (at === subsysAt) {
      if (dropSubsystem) {
        at += 8 + padded;
        continue;
      }
      newSubsysAt = length;
    }
    if (type === MI_COMPRESSED) {
      const inflated = unzlibSync(mat.subarray(at + 8, at + 8 + size)).slice();
      hits += replaceAll(inflated, fromBytes, toBytes);
      const deflated = zlibSync(inflated);
      element = new Uint8Array(8 + deflated.length);
      const tag = new DataView(element.buffer);
      tag.setUint32(0, MI_COMPRESSED, true);
      tag.setUint32(4, deflated.length, true);
      element.set(deflated, 8);
    }
    parts.push(element);
    length += element.length;
    at += 8 + padded;
  }
  new DataView(header.buffer).setBigUint64(SUBSYS_OFFSET_AT, BigInt(newSubsysAt), true);

  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return { bytes: out.buffer, hits };
}
