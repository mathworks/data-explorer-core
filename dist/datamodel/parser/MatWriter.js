// Copyright 2026 The MathWorks, Inc.
//
// The inverse of MatParser.parseMatrix: a MatVariable back to the bytes of one
// MAT-file `miMATRIX` element, and from there to the `cdata` string an
// uncompressed-text .sldd carries.
//
// WHY THIS EXISTS. A text dictionary's `_value` is a restricted literal grammar
// that stops at rank 2. Asked directly, MATLAB reads every candidate spelling of
// a 2x3x2 back as an empty 1x0: `Matrix(2,3,2)` with grouped rows, with a flat
// column-major list, with nested pages, and `Matrix(2,3,2)\nreshape(...)`; the
// bare expressions `reshape([...],2,3,2)` and `cat(3,...)` are not evaluated at
// all and read back as the scalar 0 (test/parity/matlab/probe_rank3_serial.m).
// MATLAB's own dictionary answers the same question by storing EVERY rank >= 3
// value as cdata whatever its kind — double, single, int32, uint64, logical,
// char, complex, cell and struct all come out as `{"_type": "cdata"}`
// (test/parity/matlab/probe_nd_rich.m). So this is not an optimization; it is the
// only form MATLAB reads at rank >= 3.
//
// EVERY LAYOUT CHOICE HERE IS MEASURED against streams MATLAB wrote, because a
// stream our own reader accepts proves only that we are self-consistent:
//
//   * the variable NAME is empty at every level — a cdata payload is a bare
//     value, and the name lives in the JSON key or the struct field-name table
//   * long (8-byte) tags everywhere, EXCEPT a payload of 1..4 bytes, which takes
//     the small form; an EMPTY payload stays long (that is how MATLAB writes the
//     empty name)
//   * a logical is class uint8 with the logical flag and a miUINT8 payload
//   * a char payload is miUTF8
//   * a struct's field-name stride is max(longest name, 4) + 1 — measured at
//     lengths 1, 3, 4, 5, 6 and 8, which rules out both `longest + 1` and any
//     4-byte rounding of it
//   * numeric data is COLUMN-major, while cell and struct ELEMENTS are already in
//     column-major order in the model. That split is not a nicety: it is defect
//     14, documented in display/Subscript.ts, and inverting the wrong one of the
//     two silently permutes the value.
//
// The tests hold all of it to byte equality against MATLAB's own eighteen cdata
// streams, so a wrong guess here fails loudly rather than shipping a file MATLAB
// reads as empty.
import { transposeToColumnMajorND } from './XmlUtils.js';
import { uuencode } from './CdataCodec.js';
/**
 * A value this format cannot carry — an MCOS object (a MATLAB `string`, an
 * object array), or a class MatParser could not name. Thrown rather than
 * written, because a stream that declares one thing and carries another is read
 * back as garbage instead of as a failure.
 */
export class MatWriteError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MatWriteError';
    }
}
const MI_INT8 = 1;
const MI_UINT8 = 2;
const MI_INT16 = 3;
const MI_UINT16 = 4;
const MI_INT32 = 5;
const MI_UINT32 = 6;
const MI_SINGLE = 7;
const MI_DOUBLE = 9;
const MI_INT64 = 12;
const MI_UINT64 = 13;
const MI_MATRIX = 14;
const MI_UTF8 = 16;
const MX_CELL = 1;
const MX_STRUCT = 2;
const MX_CHAR = 4;
const MX_UINT8 = 9;
// The inverse of MatParser's CLASS_NAMES. 'sparse' and 'object' are absent on
// purpose: neither has a shape this writer can produce, and naming them would
// turn a loud MatWriteError into a stream MATLAB misreads.
const CLASS_CODE = {
    cell: MX_CELL,
    struct: MX_STRUCT,
    char: MX_CHAR,
    double: 6,
    single: 7,
    int8: 8,
    uint8: MX_UINT8,
    int16: 10,
    uint16: 11,
    int32: 12,
    uint32: 13,
    int64: 14,
    uint64: 15,
    // A logical array is not its own MAT class: MATLAB writes class uint8 with the
    // logical flag set, which is what MatParser reads back as isLogical.
    logical: MX_UINT8,
};
const PAYLOAD_TYPE = {
    6: MI_DOUBLE,
    7: MI_SINGLE,
    8: MI_INT8,
    9: MI_UINT8,
    10: MI_INT16,
    11: MI_UINT16,
    12: MI_INT32,
    13: MI_UINT32,
    14: MI_INT64,
    15: MI_UINT64,
};
const WIDTH = {
    [MI_INT8]: 1,
    [MI_UINT8]: 1,
    [MI_INT16]: 2,
    [MI_UINT16]: 2,
    [MI_INT32]: 4,
    [MI_UINT32]: 4,
    [MI_SINGLE]: 4,
    [MI_DOUBLE]: 8,
    [MI_INT64]: 8,
    [MI_UINT64]: 8,
};
// The 8 bytes a cdata payload opens with: version 0x0100, then the 'IM'
// endian marker, then four zero bytes of pad. Byte-for-byte what MATLAB writes.
const CDATA_PREAMBLE = [0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00];
function concat(parts) {
    let total = 0;
    for (const p of parts) {
        total += p.length;
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}
function u32le(n) {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, n >>> 0, true);
    return out;
}
/**
 * One data element: a tag plus its payload, padded to an 8-byte boundary.
 *
 * A payload of 1..4 bytes takes MATLAB's small form — byte count in the tag's
 * upper half, payload in the tag's second word, eight bytes in total. An empty
 * payload does NOT: MATLAB writes the long form there, and matching that is what
 * makes an empty variable name eight bytes rather than four.
 */
function element(type, data) {
    if (data.length > 0 && data.length <= 4) {
        const out = new Uint8Array(8);
        const view = new DataView(out.buffer);
        view.setUint16(0, type, true);
        view.setUint16(2, data.length, true);
        out.set(data, 4);
        return out;
    }
    const pad = (8 - (data.length % 8)) % 8;
    return concat([u32le(type), u32le(data.length), data, new Uint8Array(pad)]);
}
function arrayFlags(cls, complex, logical) {
    const data = new Uint8Array(8);
    data[0] = cls;
    data[1] = (complex ? 0x08 : 0) | (logical ? 0x02 : 0);
    return element(MI_UINT32, data);
}
function dimsElement(d) {
    const data = new Uint8Array(d.length * 4);
    const view = new DataView(data.buffer);
    d.forEach(function (n, i) {
        view.setInt32(i * 4, n, true);
    });
    return element(MI_INT32, data);
}
// A cdata value is anonymous at every level, so there is only ever this one name
// element: the long form of miINT8 with zero bytes.
function emptyName() {
    return element(MI_INT8, new Uint8Array(0));
}
/**
 * A MAT element needs at least two dimensions, and MatParser hands back whatever
 * the file declared. A [2,1,2] stays [2,1,2] — MATLAB keeps interior singletons,
 * and rewriting them would change the value's shape.
 */
function dimsOf(v) {
    const d = (v.dimensions || []).slice();
    while (d.length < 2) {
        d.push(1);
    }
    return d;
}
function elementCountOf(d) {
    return d.reduce(function (a, b) {
        return a * b;
    }, 1);
}
/** An empty 0x0 double — MATLAB's `[]`, and the placeholder for a hole. */
function emptyDoubleBytes() {
    return element(MI_MATRIX, concat([arrayFlags(CLASS_CODE.double, false, false), dimsElement([0, 0]), emptyName(), element(MI_DOUBLE, new Uint8Array(0))]));
}
/**
 * A 64-bit integer payload has to go out as a BigInt.
 *
 * The value arrives one of two ways. An exact decimal TOKEN — a string, which is how
 * every channel now carries an int64/uint64 whose magnitude a double cannot hold
 * (XmlUtils.parseExactNum) — converts losslessly, which is the whole reason the text
 * form exists. A plain number may not be an integer any more: a 64-bit value that came
 * in through some path still reading it as a double lost precision above 2^53, and a
 * non-finite one has no integer form at all. BigInt() throws on both, and a throw here
 * would fail the whole save, so round and treat a non-finite as zero.
 */
function toBigInt(n) {
    if (typeof n === 'string') {
        try {
            return BigInt(n);
        }
        catch {
            return 0n;
        }
    }
    return isFinite(n) ? BigInt(Math.round(n)) : 0n;
}
function numericPayload(type, values) {
    const width = WIDTH[type];
    if (!width) {
        throw new MatWriteError('no payload width for MAT element type ' + type);
    }
    const data = new Uint8Array(values.length * width);
    const view = new DataView(data.buffer);
    values.forEach(function (v, i) {
        const at = i * width;
        const n = typeof v === 'number' ? v : Number(v);
        switch (type) {
            case MI_INT8:
                view.setInt8(at, n);
                break;
            case MI_UINT8:
                view.setUint8(at, n);
                break;
            case MI_INT16:
                view.setInt16(at, n, true);
                break;
            case MI_UINT16:
                view.setUint16(at, n, true);
                break;
            case MI_INT32:
                view.setInt32(at, n, true);
                break;
            case MI_UINT32:
                view.setUint32(at, n, true);
                break;
            case MI_SINGLE:
                view.setFloat32(at, n, true);
                break;
            // `v` and not `n`: the coercion above is a double, and putting an exact 64-bit
            // token through it is exactly the rounding this representation exists to avoid.
            case MI_INT64:
                view.setBigInt64(at, toBigInt(v), true);
                break;
            case MI_UINT64:
                view.setBigUint64(at, toBigInt(v), true);
                break;
            default:
                view.setFloat64(at, n, true);
                break;
        }
    });
    return element(type, data);
}
/**
 * The values of a numeric variable as one flat list. MatParser collapses a 1x1 to
 * a bare number and leaves an empty one null, so all three shapes arrive here.
 */
function flatValues(value) {
    if (value === null || value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}
/**
 * An exact 64-bit token: a bare decimal integer carried as TEXT because a double cannot
 * hold it (XmlUtils.parseExactNum). Only numericPayload's two 64-bit arms consume one,
 * and only a 64-bit class ever produces one, so every other arm sees numbers as before.
 */
function isExactToken(x) {
    return typeof x === 'string' && /^-?\d+$/.test(x);
}
function realPart(x) {
    if (x !== null && typeof x === 'object' && 're' in x) {
        return Number(x.re) || 0;
    }
    // Untouched: `Number(x) || 0` here would round maxU64 to 18446744073709552000 on the
    // way into the byte stream, one step after the reader had kept it exact (defect 29).
    if (isExactToken(x)) {
        return x;
    }
    return Number(x) || 0;
}
function imagPart(x) {
    if (x !== null && typeof x === 'object' && 'im' in x) {
        return Number(x.im) || 0;
    }
    return 0;
}
function numericBody(v, cls, d) {
    const flat = flatValues(v.value);
    const n = elementCountOf(d);
    if (flat.length !== n) {
        // A stream that declares more elements than it carries is not read as an
        // error by MATLAB — it is read as a shorter or garbage array. Refuse instead.
        throw new MatWriteError('numeric value has ' + flat.length + ' elements but declares [' + d.join(',') + ']');
    }
    const type = PAYLOAD_TYPE[cls];
    // The model holds numeric elements row-major within each page; MAT stores them
    // column-major. Cells and structs are NOT transposed (see the file header).
    const real = transposeToColumnMajorND(flat.map(realPart), d);
    const parts = [numericPayload(type, real)];
    if (v.isComplex) {
        parts.push(numericPayload(type, transposeToColumnMajorND(flat.map(imagPart), d)));
    }
    return parts;
}
function charBody(v, d) {
    // MatParser does not transpose char data — a char matrix's string comes back in
    // the file's own column-major order — so it goes out exactly as it came in.
    const text = typeof v.value === 'string' ? v.value : String(v.value ?? '');
    // Same contract as numericBody: a stream whose dims and payload disagree is not
    // an error to MATLAB, it is a shorter or garbage array. A char matrix reaches
    // here from the node layer with its own _dims, so this is where a shape that no
    // longer describes the text has to stop.
    if (text.length !== elementCountOf(d)) {
        throw new MatWriteError('char value has ' + text.length + ' characters but declares [' + d.join(',') + ']');
    }
    return [element(MI_UTF8, new TextEncoder().encode(text))];
}
function cellBody(v, d) {
    const cells = flatValues(v.value);
    const n = elementCountOf(d);
    const parts = [];
    for (let i = 0; i < n; i++) {
        const c = cells[i];
        // A slot the reader could not read stays a hole. Dropping it would slide
        // every later element one position early.
        parts.push(c ? encodeMatVariable(c) : emptyDoubleBytes());
    }
    return parts;
}
function structBody(v, d) {
    const fields = v.fields || {};
    const names = Object.keys(fields);
    const longest = names.reduce(function (a, s) {
        return Math.max(a, s.length);
    }, 0);
    const stride = Math.max(longest, 4) + 1;
    const strideData = new Uint8Array(4);
    new DataView(strideData.buffer).setInt32(0, stride, true);
    const nameData = new Uint8Array(names.length * stride);
    const enc = new TextEncoder();
    names.forEach(function (name, i) {
        nameData.set(enc.encode(name), i * stride);
    });
    const parts = [element(MI_INT32, strideData), element(MI_INT8, nameData)];
    const n = elementCountOf(d);
    for (let e = 0; e < n; e++) {
        for (const name of names) {
            const held = fields[name];
            const one = Array.isArray(held) ? held[e] : n === 1 ? held : undefined;
            // A MATLAB struct array is homogeneous, so every element has every field.
            // An element that lost one (a whole-value edit clears its children) keeps
            // its slot as an empty double rather than shifting the ones after it.
            parts.push(one ? encodeMatVariable(one) : emptyDoubleBytes());
        }
    }
    return parts;
}
/** The bytes of one complete `miMATRIX` element: tag, then the matrix body. */
export function encodeMatVariable(v) {
    if (v.isOpaque) {
        throw new MatWriteError('cannot write an MCOS opaque value (' + (v.className || 'unknown') + ')');
    }
    const cls = CLASS_CODE[v.className];
    if (cls === undefined) {
        throw new MatWriteError('no MAT class for "' + v.className + '"');
    }
    const d = dimsOf(v);
    const logical = !!v.isLogical || v.className === 'logical';
    const subs = [arrayFlags(cls, !!v.isComplex, logical), dimsElement(d), emptyName()];
    if (cls === MX_CELL) {
        subs.push(...cellBody(v, d));
    }
    else if (cls === MX_STRUCT) {
        subs.push(...structBody(v, d));
    }
    else if (cls === MX_CHAR) {
        subs.push(...charBody(v, d));
    }
    else {
        subs.push(...numericBody(v, logical ? MX_UINT8 : cls, d));
    }
    return element(MI_MATRIX, concat(subs));
}
/**
 * The `_value` string of a text .sldd `{"_type": "cdata"}` entry: the 8-byte
 * preamble, one miMATRIX element, uuencoded.
 */
export function encodeCdata(v) {
    return uuencode(concat([new Uint8Array(CDATA_PREAMBLE), encodeMatVariable(v)]));
}
//# sourceMappingURL=MatWriter.js.map