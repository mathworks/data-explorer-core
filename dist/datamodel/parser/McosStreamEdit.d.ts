import { type EncodedValue } from './EncodedValue.js';
/** A stream split where a save splits it: the value's element ends at `valueEnd`, and `subsystem` is the element after it. */
export type McosStreamParts = {
    ok: true;
    valueEnd: number;
    subsystem: Uint8Array;
} | {
    ok: false;
    message: string;
};
/**
 * The value and the subsystem of `bytes`, a MAT stream, or why it is not the two of them and
 * nothing else, as a clause: a stream that does not frame whole, holds no element after its value,
 * or holds more than one, or a subsystem that is not an miMATRIX, is not one a save can rewrite
 * and still know it wrote everything that was there.
 */
export declare function mcosStreamParts(bytes: Uint8Array): McosStreamParts;
/** `bytes`' value, as it was, followed by `subsystem`: the stream a save writes. */
export declare function streamWithSubsystem(bytes: Uint8Array, valueEnd: number, subsystem: Uint8Array): Uint8Array;
/**
 * A hex value of `bytes`, as `read` was: its attributes in the order it gave them, its
 * EncodedLength the byte count of `bytes`, and its text in MATLAB's layout at `indent`
 * (EncodedValue.hexText). MATLAB's reader needs neither the layout nor the attribute order
 * (measured), but they are what MATLAB itself writes for the same stream, byte for byte.
 */
export declare function rewrittenHex(read: EncodedValue, bytes: Uint8Array, indent: number): EncodedValue;
export declare function sameBytes(a: Uint8Array, b: Uint8Array): boolean;
//# sourceMappingURL=McosStreamEdit.d.ts.map