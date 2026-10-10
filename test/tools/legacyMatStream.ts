// Copyright 2026 The MathWorks, Inc.
//
// The MAT-stream code every venue ran before MatParser.decodeMatStream existed, copied
// verbatim from 163934c so test/matStreamSites.test.ts can hold each site to decoding
// its fixtures exactly as it did. Nothing in src/ imports this, and nothing here may be
// "fixed": it is the reference, defects and all. parseMatrix is the one piece still
// shared, because it did not change.
import { parseMatrix, type MatVariable } from '../../src/datamodel/parser/MatParser.js';
import { encodedBytes, type EncodedBytes, type EncodedValue } from '../../src/datamodel/parser/EncodedValue.js';
import { formatComplexNum, formatMatlabNum } from '../../src/datamodel/parser/XmlUtils.js';

/** CdataCodec.uudecode as it was: one array entry per bit. */
export function legacyCdataUudecode(str: string): Uint8Array {
  const bits: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const v = str.charCodeAt(i) - 0x20;
    for (let b = 5; b >= 0; b--) {
      bits.push((v >> b) & 1);
    }
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | bits[i * 8 + b];
    }
    bytes[i] = byte;
  }
  return bytes;
}

/** MdlParser's own uudecode as it was, which skipped line breaks. */
export function legacyMdlUudecode(text: string): Uint8Array {
  const out = new Uint8Array(Math.ceil((text.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0a || code === 0x0d) continue;
    acc = (acc << 6) | ((code - 32) & 0x3f);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.slice(0, n);
}

function ru32(buf: Uint8Array, offset: number): number {
  return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
}

/** MxArrayParser.readMxArrayRecords as it was: the `.slx` and `.mdl` workspace framing, and the hex value's. */
export function legacyReadMxArrayRecords(buffer: ArrayBufferLike): { outer: MatVariable | null; trailingElements: Uint8Array[] } {
  const buf = new Uint8Array(buffer);
  const trailingElements: Uint8Array[] = [];
  if (buf.length < 16) {
    return { outer: null, trailingElements };
  }
  if (buf[0] !== 0x00 || buf[1] !== 0x01 || buf[2] !== 0x49 || buf[3] !== 0x4d) {
    return { outer: null, trailingElements };
  }
  const outerTag = ru32(buf, 8);
  const outerSize = Math.min(ru32(buf, 12), buf.length - 16);
  if (outerTag !== 14 || outerSize <= 0) {
    return { outer: null, trailingElements };
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const outer = parseMatrix(view, 16, outerSize);
  let offset = 8 + 8 + outerSize;
  while (offset + 8 <= buf.length) {
    const tag = ru32(buf, offset);
    const size = ru32(buf, offset + 4);
    if (tag === 0 && size === 0) {
      break;
    }
    const available = buf.length - offset;
    const take = Math.min(8 + size, available);
    trailingElements.push(new Uint8Array(buf.buffer, buf.byteOffset + offset, take));
    if (take < 8 + size) {
      break;
    }
    offset += 8 + size;
  }
  return { outer, trailingElements };
}

/** EncodedValue.encodedStream as it was: a hex value's bytes, whole, or why not. */
export function legacyEncodedStream(v: EncodedValue): EncodedBytes {
  const read = encodedBytes(v);
  if (!read.bytes) {
    return read;
  }
  const bytes = read.bytes;
  if (bytes.length < 16) {
    return { reason: `it holds ${bytes.length} bytes, fewer than a MAT stream's header` };
  }
  if ([0x00, 0x01, 0x49, 0x4d].some((b, i) => bytes[i] !== b)) {
    return { reason: 'its bytes are not a MAT stream (they do not open with 00 01 49 4D)' };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8, true) !== 14) {
    return { reason: 'its MAT stream does not hold an array' };
  }
  let at = 8;
  while (at + 8 <= bytes.length) {
    const type = view.getUint32(at, true);
    const size = view.getUint32(at + 4, true);
    if (type === 0 && size === 0) {
      return { bytes };
    }
    if (at + 8 + size > bytes.length) {
      const what = at === 8 ? 'its MAT array' : `the element at byte ${at} of its MAT stream`;
      return { reason: `${what} declares ${size} bytes and the stream holds ${bytes.length - at - 8}` };
    }
    at += 8 + size;
  }
  if (at !== bytes.length) {
    return { reason: `its MAT stream ends ${bytes.length - at} bytes into an element's tag` };
  }
  return { bytes };
}

/**
 * The variable MatlabVariableNode.parseCdata read out of a text dictionary's cdata, or null
 * where it fell back to showing the text as a char: no magic check, the declared size
 * unclamped, nothing after the array.
 */
export function legacyCdataVariable(text: string): MatVariable | null {
  try {
    const bytes = legacyCdataUudecode(text);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(8, true) !== 14) {
      return null;
    }
    return parseMatrix(dv, 16, dv.getUint32(12, true));
  } catch {
    return null;
  }
}

/** The variable piOther's formatStream laid out, or null where it showed nothing. */
export function legacyPiVariable(bytes: Uint8Array): MatVariable | null {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return parseMatrix(dv, 16, dv.getUint32(12, true));
  } catch {
    return null;
  }
}

function layOut(rowMajor: string[], dims: number[], cls: string): string {
  if (rowMajor.length === 1 && dims.length <= 2) {
    return rowMajor[0];
  }
  if (dims.length > 2) {
    return '<' + dims.join('x') + ' ' + cls + '>';
  }
  const [rows, cols] = dims;
  if (rows === 1) {
    return '[' + rowMajor.join(', ') + ']';
  }
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    lines.push('[' + rowMajor.slice(r * cols, (r + 1) * cols).join(', ') + ']');
  }
  return 'Matrix(' + rows + ',' + cols + ')\n' + lines.join('\n');
}

/** piOther's formatStream as it was: what the Property Inspector's Other group showed for a stream. */
export function legacyFormatStream(bytes: Uint8Array): string {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const m = parseMatrix(dv, 16, dv.getUint32(12, true));
    const numeric = m.className !== 'char' && m.className !== 'struct' && m.className !== 'cell' && !m.isOpaque;
    if (!numeric || m.isLogical) {
      return '<' + m.dimensions.join('x') + ' ' + m.className + '>';
    }
    const values = Array.isArray(m.value) ? (m.value as unknown[]) : m.value === null ? [] : [m.value];
    if (values.length === 0) {
      return '[]';
    }
    const shown = values.map((x) =>
      x !== null && typeof x === 'object' ? formatComplexNum((x as { re: unknown }).re, (x as { im: unknown }).im) : formatMatlabNum(x),
    );
    return layOut(shown, m.dimensions, m.className);
  } catch {
    return '';
  }
}
