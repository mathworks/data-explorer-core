// Copyright 2026 The MathWorks, Inc.
//
// A value a compressed-binary dictionary stores as an ENCODED BYTE STREAM rather than as
// XML, and the one shape every layer of this package carries it in.
//
// MATLAB writes a dictionary value this way when XML cannot spell it — a sparse array, or
// a function handle, anywhere inside the value (test/fixtures/sparse/make_sparse_fixtures.m
// grades that rule on every entry it writes):
//
//   <P Name="Value" Class="double" Encoding="hex" EncodedLength="248">
//                   0001494D000000000E000000E8000000…</P>
//
// The text is `getByteStreamFromArray(value)` in uppercase hex — a MAT stream: the version
// word 0x0100, 'IM', four reserved bytes, then one miMATRIX element (and, for an MCOS
// object, a trailing uint8 element holding the object's subsystem). It is the same byte
// stream a TEXT dictionary carries for the same value as `{"_type": "cdata"}`, at six bits
// a character instead of four (CdataCodec), which is what makes the two dictionary
// flavours interchangeable for it.
//
// Nothing read the Encoding attribute before this module existed, so the hex text went to
// parseFloat as the value's body: `parseFloat('0001494D…')` is 1494, and every hex value in
// the corpus showed as 1494, as an editable double — and the next save WROTE 1494 back in
// place of the stream. That is why the envelope below keeps everything the element said,
// verbatim, and why a value read this way is written back from it rather than from what
// the node layer made of it.
import { escapeXml, pad as xmlPad } from './XmlUtils.js';
import { matStreamFailure } from './MatParser.js';
/** The `_type` tag of an encoded value, at every depth and in every layer. */
export const ENCODED_TYPE = 'encoded';
/** Is `x` an encoded value? Shape only — whether it DECODES is `encodedBytes`'s question. */
export function isEncodedValue(x) {
    if (x === null || typeof x !== 'object') {
        return false;
    }
    const o = x;
    return o._type === ENCODED_TYPE && typeof o._value === 'string' && !!o._attrs && typeof o._attrs === 'object';
}
/** The MATLAB class the element names — `class(value)`, never 'sparse' — or '' when it names none. */
export function encodedClass(v) {
    return v._attrs.Class ?? '';
}
/**
 * Attributes a property writer states itself, and so must not repeat from `_attrs`: the
 * name, and MATLAB's saveobj marker pair (see DataNode.pxAttrs).
 */
const POSITIONAL_ATTRS = new Set(['Name', 'Source', 'PropertyType']);
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
export function encodedValueOf(attrs, text) {
    if (attrs['@_Encoding'] === undefined) {
        return null;
    }
    const kept = {};
    for (const [key, val] of Object.entries(attrs)) {
        if (!key.startsWith('@_')) {
            continue;
        }
        const name = key.slice(2);
        if (!POSITIONAL_ATTRS.has(name)) {
            kept[name] = String(val);
        }
    }
    return { _type: ENCODED_TYPE, _attrs: kept, _value: text };
}
/**
 * The element an encoded value is written as: its tag and positional attributes (`nameAttrs`,
 * already spelled — ` Name="Value"`, or the saveobj pair), then its own attributes and text
 * exactly as they were read.
 */
export function encodedXml(tag, nameAttrs, v, indent) {
    let open = xmlPad(indent) + '<' + tag + nameAttrs;
    for (const [name, val] of Object.entries(v._attrs)) {
        open += ' ' + name + '="' + escapeXml(val) + '"';
    }
    return open + '>' + escapeXml(v._value) + '</' + tag + '>';
}
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
export function encodedBytes(v) {
    const encoding = v._attrs.Encoding;
    if (encoding !== 'hex') {
        return { reason: `its Encoding is "${encoding}", which this reader does not decode` };
    }
    const digits = v._value.replace(/\s+/g, '');
    if (!/^[0-9A-Fa-f]*$/.test(digits)) {
        return { reason: 'its hex text holds a character that is not a hex digit' };
    }
    if (digits.length % 2 !== 0) {
        return { reason: `its hex text has an odd number of digits (${digits.length})` };
    }
    const held = digits.length / 2;
    let length = held;
    const declared = v._attrs.EncodedLength;
    if (declared !== undefined) {
        if (!/^\s*\d+\s*$/.test(declared)) {
            return { reason: `its EncodedLength "${declared}" is not a byte count` };
        }
        const want = Number(declared);
        if (want > held) {
            return { reason: `it declares ${want} bytes and holds ${held}` };
        }
        length = want;
    }
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = parseInt(digits.substr(2 * i, 2), 16);
    }
    return { bytes };
}
/**
 * Why encoded values read while one dictionary entry was being built did not decode,
 * for that dictionary's warnings.
 *
 * A stream whose BYTES are wrong is reported by the binary reader, which sees them
 * (BinarySlddParser.warnUnreadableEncoded, from encodedStream's reason). One whose bytes
 * are framed right and still do not decode fails only where it is decoded, in the node
 * layer (MatlabVariableNode.parseEncoded), which has no warnings sink of its own — so it
 * records the reason here and SlddNode.parse, which builds the entry and holds the sink,
 * takes them after each entry, and before it, so that nothing recorded outside a
 * dictionary's own read (a paste) is reported against one of its entries.
 */
const decodeFailures = [];
/** Record why an encoded value did not decode (see `decodeFailures`). */
export function recordDecodeFailure(reason) {
    decodeFailures.push(reason);
}
/** The decode failures recorded since the last call, which clears them. */
export function takeDecodeFailures() {
    return decodeFailures.splice(0);
}
/**
 * The bytes of an encoded value when they are a MAT stream this package can read, every
 * element of it whole — or the reason they are not (MatParser.matStreamFailure, which
 * says why a value has to be whole and a container need not be). This is the hex
 * adapter's half of the stream reader: encodedBytes removes the wrapper, and the stream
 * is MatParser's to judge.
 */
export function encodedStream(v) {
    const read = encodedBytes(v);
    if (!read.bytes) {
        return read;
    }
    const failure = matStreamFailure(read.bytes, true);
    return failure ? { reason: failure } : read;
}
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
export function matStreamPrefix(bytes) {
    if (matStreamFailure(bytes)) {
        return null;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = 8;
    while (at + 8 <= bytes.length) {
        const type = view.getUint32(at, true);
        const size = view.getUint32(at + 4, true);
        if (type === 0 && size === 0) {
            break;
        }
        if (at + 8 + size > bytes.length) {
            break;
        }
        at += 8 + size;
    }
    return at > 8 ? bytes.slice(0, at) : null;
}
/**
 * Bytes as the text of a hex element, in MATLAB's own layout: a line break after the tag,
 * then lines of at most 128 uppercase digits each indented two levels deeper than the
 * element, the last running straight into the closing tag. Measured on every hex value
 * make_sparse_fixtures.m wrote (`hexLineLengths`, `hexIndent`, `hexClosesOnDataLine`); an
 * entry's Value sits at indent 2, so its lines are indented sixteen spaces, as MATLAB's are.
 */
export function hexText(bytes, indent) {
    let digits = '';
    for (const b of bytes) {
        digits += (b < 16 ? '0' : '') + b.toString(16).toUpperCase();
    }
    const lead = '\n' + xmlPad(indent + 2);
    let text = '';
    for (let at = 0; at < digits.length; at += 128) {
        text += lead + digits.slice(at, at + 128);
    }
    return text;
}
/** An encoded value for `bytes`, as MATLAB writes one at `indent` for a value of `className`. */
export function hexValue(bytes, className, indent) {
    return {
        _type: ENCODED_TYPE,
        _attrs: { Class: className, Encoding: 'hex', EncodedLength: String(bytes.length) },
        _value: hexText(bytes, indent),
    };
}
//# sourceMappingURL=EncodedValue.js.map