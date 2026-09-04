// Copyright 2026 The MathWorks, Inc.
//
// The transport an uncompressed-text .sldd uses for a value its JSON schema
// cannot spell: `{"_type": "cdata", "_value": "<characters>"}`, where the
// characters are a MAT-file byte stream at six bits each, offset by 0x20.
//
// Both directions live here so they cannot drift apart. The encoder is the exact
// inverse of the decoder, and test/matWriter.test.ts holds it to that by
// re-encoding the strings MATLAB itself wrote and requiring the same characters
// back.
//
// Two properties of the alphabet (0x20..0x5F) matter beyond this file:
//
//   * it INCLUDES the double quote, so a cdata body inside the JSON contains
//     escaped quotes. Patching one of these entries with a regex like
//     `"_value": "[^"]*"` truncates at the first escaped quote and corrupts the
//     file — which reads as "MATLAB cannot open it", i.e. as a defect in
//     whatever wrote the value.
//   * MATLAB pads the string with NUL characters, which are NOT in the alphabet.
//     They sit past the byte count the stream itself declares, so the decoder's
//     arithmetic on them is harmless; see the padding note in uuencode.
/**
 * The first four characters of every MAT byte stream MATLAB writes into a text
 * dictionary. They are the encoding of the fixed opening bytes 00 01 49 — the
 * version word 0x0100 and the first byte of the 'IM' endian marker — so they are
 * the same for every value of every class, and nothing else that carries the
 * `{"_type": "cdata"}` tag starts with them.
 */
export const MAT_CDATA_PREFIX = '  %)';
/**
 * Is this `cdata` a MAT byte stream, or the plain-text complex form?
 *
 * One tag, two meanings, and the difference decides how a value is written:
 *
 *   * `{"_type": "cdata", "_value": "1+2i"}` is how a BINARY dictionary spells a
 *     complex property (BinarySlddParser reads `<P IsComplex="1">` into it), and
 *     the XML writer spells it back the same way.
 *   * `{"_type": "cdata", "_value": "  %)3…"}` is how a TEXT dictionary carries a
 *     value its literal grammar cannot spell at all — every rank >= 3 value, and
 *     every complex one (defect 22). Its XML form is not text at all: it depends
 *     on the class, dimensions and elements inside the bytes.
 *
 * Handing the second to the first's writer produces `Class="double"
 * IsComplex="1"` with six-bit characters as its body — a file that opens, and
 * reads back as garbage.
 */
export function isMatCdata(value) {
    if (value === null || typeof value !== 'object') {
        return false;
    }
    const v = value._value;
    return typeof v === 'string' && v.indexOf(MAT_CDATA_PREFIX) === 0;
}
/**
 * Characters to bytes: six bits per character, most significant bit first,
 * offset by 0x20. A trailing partial byte is dropped, which is what makes
 * MATLAB's NUL padding harmless — those characters only ever contribute bits
 * past the byte count the embedded MAT element declares.
 */
export function uudecode(str) {
    const bits = [];
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
/**
 * Bytes to characters, the exact inverse of uudecode, including the padding
 * MATLAB writes.
 *
 * The padding is measured, not invented. MATLAB emits ceil(bits/6) data
 * characters, then NUL-pads to a multiple of four, then appends one more NUL:
 * that is the only rule that accounts for all five cdata entries in
 * artifacts/text/cases.sldd (1, 3, 3, 2 and 3 trailing NULs for byte counts
 * 168, 832, 856, 104 and 88) and for the thirteen in fixtures/nd_rich.sldd.
 * Note the NULs are NOT the encoding of zero — a zero six-bit group inside the
 * data is a SPACE, 0x20 — so this cannot be reproduced by zero-padding the byte
 * stream to a multiple of three and encoding that.
 */
export function uuencode(bytes) {
    const chars = [];
    const dataChars = Math.ceil((bytes.length * 8) / 6);
    for (let i = 0; i < dataChars; i++) {
        let v = 0;
        for (let b = 0; b < 6; b++) {
            const bit = i * 6 + b;
            const byte = bit >> 3;
            const inByte = 7 - (bit & 7);
            v = (v << 1) | (byte < bytes.length ? (bytes[byte] >> inByte) & 1 : 0);
        }
        chars.push(String.fromCharCode(0x20 + v));
    }
    while (chars.length % 4 !== 0) {
        chars.push('\0');
    }
    chars.push('\0');
    return chars.join('');
}
//# sourceMappingURL=CdataCodec.js.map