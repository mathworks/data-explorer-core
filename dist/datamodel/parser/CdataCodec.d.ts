/**
 * The first four characters of every MAT byte stream MATLAB writes into a text
 * dictionary. They are the encoding of the fixed opening bytes 00 01 49 — the
 * version word 0x0100 and the first byte of the 'IM' endian marker — so they are
 * the same for every value of every class, and nothing else that carries the
 * `{"_type": "cdata"}` tag starts with them.
 */
export declare const MAT_CDATA_PREFIX = "  %)";
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
export declare function isMatCdata(value: unknown): boolean;
/**
 * Characters to bytes: six bits per character, most significant bit first,
 * offset by 0x20. A trailing partial byte is dropped, which is what makes
 * MATLAB's NUL padding harmless — those characters only ever contribute bits
 * past the byte count the embedded MAT element declares.
 */
export declare function uudecode(str: string): Uint8Array;
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
export declare function uuencode(bytes: Uint8Array): string;
//# sourceMappingURL=CdataCodec.d.ts.map