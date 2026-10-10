/** The `_type` tag of an encoded value, at every depth and in every layer. */
export declare const ENCODED_TYPE = "encoded";
/**
 * An encoded value as the binary reader hands it over and the writers hand it back.
 *
 * `_attrs` is every attribute of the element except the ones that say WHERE it sits — its
 * Name, and the saveobj pair a property writer spells for itself (DataNode.pxAttrs) — in
 * the order the file gave them. It is the writer's source, so an untouched value goes back
 * out attribute for attribute; read `Class`, `Encoding` and `EncodedLength` through the
 * accessors below rather than through copies of them.
 *
 * `_value` is the element's text exactly as it was read: the line break after the tag, the
 * indentation of every line, and whatever else. A dictionary's XML reader keeps leaf
 * whitespace (XmlReader's `trimValues: false`), which is what lets a no-op save write the
 * same bytes MATLAB did.
 */
export interface EncodedValue {
    _type: typeof ENCODED_TYPE;
    _attrs: Record<string, string>;
    _value: string;
}
/** Is `x` an encoded value? Shape only — whether it DECODES is `encodedBytes`'s question. */
export declare function isEncodedValue(x: unknown): x is EncodedValue;
/** The MATLAB class the element names — `class(value)`, never 'sparse' — or '' when it names none. */
export declare function encodedClass(v: EncodedValue): string;
/**
 * The envelope for an XML element that carries an `Encoding` attribute, or null for one
 * that does not. `attrs` is the element's attribute bag as the dictionary reader produced
 * it (keys prefixed `@_`, document order).
 *
 * Every `Encoding` becomes one, not just "hex": MATLAB has been seen writing no other, but
 * the alternative for an unknown one is the path that produced 1494 — the text read as a
 * number — and a value this reader cannot decode is still a value it can carry back out
 * unchanged.
 */
export declare function encodedValueOf(attrs: Record<string, unknown>, text: string): EncodedValue | null;
/**
 * The element an encoded value is written as: its tag and positional attributes (`nameAttrs`,
 * already spelled — ` Name="Value"`, or the saveobj pair), then its own attributes and text
 * exactly as they were read.
 */
export declare function encodedXml(tag: string, nameAttrs: string, v: EncodedValue, indent: number): string;
/** Why an encoded value's bytes could not be read, or the bytes. */
export type EncodedBytes = {
    bytes: Uint8Array;
    reason?: undefined;
} | {
    bytes?: undefined;
    reason: string;
};
/**
 * The bytes an encoded value holds, honouring its `EncodedLength`, or the reason there are
 * none to read. The reason is phrased to follow "not decoded: ", the way MatParser's
 * `undecoded` reasons are.
 *
 * Whitespace anywhere in the text is layout — MATLAB breaks the digits into indented lines
 * of 128 — and is skipped. Anything else that is not a hex digit, or an odd number of digits,
 * is not a byte stream this reader can trust, so it is refused rather than read around.
 *
 * `EncodedLength` is MATLAB's byte count. Fewer digits than it declares is a truncated
 * stream, refused here rather than decoded short: the MAT readers below clamp silently, and
 * a sparse array missing its tail would display as a matrix with zeros where its values
 * were. More digits than it declares are read up to the count; the surplus is not the
 * value's, but it is still the file's, and the writer replays it.
 */
export declare function encodedBytes(v: EncodedValue): EncodedBytes;
/** Record why an encoded value did not decode (see `decodeFailures`). */
export declare function recordDecodeFailure(reason: string): void;
/** The decode failures recorded since the last call, which clears them. */
export declare function takeDecodeFailures(): string[];
/**
 * The bytes of an encoded value when they are a MAT stream this package can read, every
 * element of it whole — or the reason they are not (MatParser.matStreamFailure, which
 * says why a value has to be whole and a container need not be). This is the hex
 * adapter's half of the stream reader: encodedBytes removes the wrapper, and the stream
 * is MatParser's to judge.
 */
export declare function encodedStream(v: EncodedValue): EncodedBytes;
/**
 * The MAT stream at the start of `bytes`, cut to the length its own elements declare, or
 * null when it is not one: the preamble, then elements up to a zero tag or the last one
 * the bytes hold whole.
 *
 * For a stream that came out of a text dictionary's cdata, whose six-bit characters end in
 * MATLAB's NUL padding: those contribute bits past the last whole byte of the stream, and
 * uudecode keeps a byte of them, so the decoded bytes are one longer than the value. A
 * binary dictionary states the length (EncodedLength), so it has to be the stream's own.
 */
export declare function matStreamPrefix(bytes: Uint8Array): Uint8Array | null;
/**
 * Bytes as the text of a hex element, in MATLAB's own layout: a line break after the tag,
 * then lines of at most 128 uppercase digits each indented two levels deeper than the
 * element, the last running straight into the closing tag. Measured on every hex value
 * make_sparse_fixtures.m wrote (`hexLineLengths`, `hexIndent`, `hexClosesOnDataLine`); an
 * entry's Value sits at indent 2, so its lines are indented sixteen spaces, as MATLAB's are.
 */
export declare function hexText(bytes: Uint8Array, indent: number): string;
/** An encoded value for `bytes`, as MATLAB writes one at `indent` for a value of `className`. */
export declare function hexValue(bytes: Uint8Array, className: string, indent: number): EncodedValue;
//# sourceMappingURL=EncodedValue.d.ts.map