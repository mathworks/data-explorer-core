// Copyright 2026 The MathWorks, Inc.

import type { MatVariable } from './MatParser.js';
import { matStreamFailure } from './MatParser.js';
import { cellValueAt, readMcosSubsystem } from './McosSubsystemEdit.js';
import { mcosMetaTableOf } from './McosParser.js';
import { variableDifference } from './MatFileWriter.js';
import { ENCODED_TYPE, hexText, type EncodedValue } from './EncodedValue.js';

// The MAT stream of a dictionary value that holds MCOS objects, as a save rewrites it: a binary
// dictionary's hex value (EncodedValue), which MATLAB writes as getByteStreamFromArray of an
// entry's whole Value when the value holds something its XML cannot spell, and the cdata of the
// same bytes a text dictionary is given when this package pastes one into it
// (MatWriter.textDictionaryForm). Measured against MATLAB R2027a, the stream is
//
//   00 01 49 4D 00 00 00 00                       the preamble
//   miMATRIX                                      the value, its objects as handles
//   miMATRIX uint8 [1 N], uncompressed            the subsystem: a .mat's, byte for byte
//
// and nothing after it. An edit of an object's property swaps the subsystem's cells as a
// MAT-file's save swaps them (McosSubsystemEdit), and the stream is the value's bytes as they
// were with the new subsystem after them. What else a save has to say of it, it says exactly:
// MATLAB trusts a binary dictionary's EncodedLength unchecked, and measured, one of 0 crashed
// it and one of 8 hung it, so it is the byte count of the stream written, never the one read.

/** A stream split where a save splits it: the value's element ends at `valueEnd`, and `subsystem` is the element after it. */
export type McosStreamParts = { ok: true; valueEnd: number; subsystem: Uint8Array } | { ok: false; message: string };

const MI_MATRIX = 14;

/**
 * The value and the subsystem of `bytes`, a MAT stream, or why it is not the two of them and
 * nothing else, as a clause: a stream that does not frame whole, holds no element after its value,
 * or holds more than one, or a subsystem that is not an miMATRIX, is not one a save can rewrite
 * and still know it wrote everything that was there.
 */
export function mcosStreamParts(bytes: Uint8Array): McosStreamParts {
  const failure = matStreamFailure(bytes, true);
  if (failure) {
    return { ok: false, message: failure };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const valueEnd = 16 + view.getUint32(12, true);
  if (valueEnd + 8 > bytes.length) {
    return { ok: false, message: 'it holds no objects after its value' };
  }
  const type = view.getUint32(valueEnd, true);
  const end = valueEnd + 8 + view.getUint32(valueEnd + 4, true);
  if (type !== MI_MATRIX) {
    return { ok: false, message: 'the element after its value is not an array' };
  }
  if (end !== bytes.length) {
    return { ok: false, message: 'it holds more after its objects, which a save would not write' };
  }
  return { ok: true, valueEnd, subsystem: bytes.subarray(valueEnd, end) };
}

/** `bytes`' value, as it was, followed by `subsystem`: the stream a save writes. */
export function streamWithSubsystem(bytes: Uint8Array, valueEnd: number, subsystem: Uint8Array): Uint8Array {
  const out = new Uint8Array(valueEnd + subsystem.length);
  out.set(bytes.subarray(0, valueEnd), 0);
  out.set(subsystem, valueEnd);
  return out;
}

/**
 * A hex value of `bytes`, as `read` was: its attributes in the order it gave them, its
 * EncodedLength the byte count of `bytes`, and its text in MATLAB's layout at `indent`
 * (EncodedValue.hexText). MATLAB's reader needs neither the layout nor the attribute order
 * (measured), but they are what MATLAB itself writes for the same stream, byte for byte.
 */
export function rewrittenHex(read: EncodedValue, bytes: Uint8Array, indent: number): EncodedValue {
  const attrs: Record<string, string> = { ...read._attrs };
  attrs.EncodedLength = String(bytes.length);
  return { _type: ENCODED_TYPE, _attrs: attrs, _value: hexText(bytes, indent) };
}

/** One value cell a save wrote into a subsystem, and the value it was written from. */
export interface McosWrittenCell {
  objectId: number;
  cellIndex: number;
  savedName: string;
  value: MatVariable;
}

/**
 * Where `element`, a subsystem a save wrote, is not `original` with `cells` written into it, in
 * words, or null where it is: it reads whole as a subsystem (its dims [1 N] its byte count among
 * what that asks); its metadata blob is the bytes it was, and so every object's class, property
 * list and the cell each property names; every cell not written is the bytes it was, and every
 * cell written reads as the value it was written from; and McosParser, which every object is
 * shown through, reads the same table of objects out of it. A MAT-file's save holds its subsystem
 * to the same (MatFileWriter's self-check).
 */
export function subsystemCellsDiffer(original: Uint8Array, element: Uint8Array, cells: readonly McosWrittenCell[]): string | null {
  const was = readMcosSubsystem(original);
  const is = readMcosSubsystem(element);
  if (!was.ok || !is.ok) {
    return 'its objects do not read back as a subsystem' + (is.ok ? '' : ' (' + is.message + ')');
  }
  const before = was.subsystem;
  const after = is.subsystem;
  if (before.cells.length !== after.cells.length) {
    return 'its objects read back with ' + after.cells.length + ' cells where ' + before.cells.length + ' were written';
  }
  const written = new Map(cells.map((c) => [c.cellIndex, c]));
  for (let i = 0; i < before.cells.length; i++) {
    const cell = written.get(i);
    if (cell) {
      const difference = variableDifference(cell.value, cellValueAt(after, i), 'object ' + cell.objectId + "'s " + cell.savedName);
      if (difference) {
        return difference;
      }
    } else if (!sameBytes(before.bytes.subarray(before.cells[i].at, before.cells[i].end), after.bytes.subarray(after.cells[i].at, after.cells[i].end))) {
      return i === 0 ? 'its objects read back with another table of them' : 'its objects read back with value cell ' + i + ', which no edit wrote, changed';
    }
  }
  if (JSON.stringify(mcosMetaTableOf(original)) !== JSON.stringify(mcosMetaTableOf(element))) {
    return 'its objects read back, as this package shows them, as another table of objects';
  }
  return null;
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
