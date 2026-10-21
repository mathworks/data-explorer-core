// Copyright 2026 The MathWorks, Inc.
import { matStreamFailure } from './MatParser.js';
import { ENCODED_TYPE, hexText } from './EncodedValue.js';
const MI_MATRIX = 14;
/**
 * The value and the subsystem of `bytes`, a MAT stream, or why it is not the two of them and
 * nothing else, as a clause: a stream that does not frame whole, holds no element after its value,
 * or holds more than one, or a subsystem that is not an miMATRIX, is not one a save can rewrite
 * and still know it wrote everything that was there.
 */
export function mcosStreamParts(bytes) {
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
export function streamWithSubsystem(bytes, valueEnd, subsystem) {
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
export function rewrittenHex(read, bytes, indent) {
    const attrs = { ...read._attrs };
    attrs.EncodedLength = String(bytes.length);
    return { _type: ENCODED_TYPE, _attrs: attrs, _value: hexText(bytes, indent) };
}
export function sameBytes(a, b) {
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
//# sourceMappingURL=McosStreamEdit.js.map