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
import { BINARY_EMPTY_KEY, complexClassTag, ENUM_KEY, ENUMERATION_KEY, emptyHeaderDims, formatMatrixSerial, formatNumLiteral, isEnumBag, isExactToken, needsExactInt, PROPERTY_SOURCE_KEY, parseComplexNum, parseExactNum, parseMatlabNum, integerConversion, transposeFromColumnMajorND, transposeToColumnMajorND, } from './XmlUtils.js';
import { isMatCdata, uuencode } from './CdataCodec.js';
import { encodedBytes, isEncodedValue } from './EncodedValue.js';
import { backedColumnsOf, sparseFromDense, sparseIndexFault } from './SparseData.js';
import { dimsText, isSize, isTextExtent, MAT_MAX_EXTENT } from './Size.js';
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
/**
 * A write refused for what a value declares rather than what it holds: `reason`
 *   - 'budget': it would put out more than UNBACKED_BYTES_BUDGET that no data backs;
 *   - 'not-a-count': its dims are not a size (parser/Size), so there is nothing to count;
 *   - 'past-int32': an extent past MAT_MAX_EXTENT, which no MAT stream's dims word can say;
 *   - 'not-an-index': a sparse array's non-zero whose row or column is not a whole number,
 *     which no index can hold, and without which the array is not the one it is;
 *   - 'not-decoded': a value the reader recorded without decoding, with no stream of its own
 *     to be written as, so nothing holds its value but the text of its placeholder.
 * Final: nothing may be written in the value's place — not the value laid out full, not its
 * summary, not its elements one by one — so it reaches whoever asked for the write, and a
 * copy or a save that holds the value fails. Every other MatWriteError says this writer has
 * no spelling for the value, and a caller may write it another way.
 *
 * `at` is where in the value the write was refused, in MATLAB's spelling from the value the
 * write began at ('{16385}', '.f', '(2).f'; '' for that value itself), and `what` is what
 * stands there, in words. `entry` is set once the node layer has restated it for a user,
 * naming the entry (budgetFailure).
 */
export class MatBudgetError extends MatWriteError {
    constructor(message, at, what, entry, reason = 'budget') {
        super(message);
        this.name = 'MatBudgetError';
        this.at = at;
        this.what = what;
        this.entry = entry;
        this.reason = reason;
        this.counted = reason !== 'not-a-count';
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
// turn a loud MatWriteError into a stream MATLAB misreads. (A sparse array's
// className is its element class, 'double', 'logical' or 'single', and
// encodeMatVariable sends it to encodeSparse on its isSparse before this table is
// asked.)
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
// ---- What one write may put out that nothing it was handed backs --------------------------
//
// Almost every byte this writer puts out is a byte of the value it was handed: the elements
// of an array, the non-zeros of a sparse one, the members of a cell. Two things are not, and
// both are sized by a declared shape alone: the column index of a sparse array, cols + 1 words
// whatever it holds, past the columns its source backs (SparseData.backedColumns); and the
// empty double a cell or a struct array writes for each element it declares and does not have.
// One dims word can declare either by the billion, so they come out of one budget, shared by
// every array and container in the value, and are charged before they are allocated. Past it
// the encode is refused, with an error a caller can catch.
//
// One budget for the whole value, not an allowance per array: a cell holds as many arrays as
// it likes, and 80,000 sparse arrays of 0x256 in one cell of an 11 KB .mat, each allowed its
// 256 columns, were 80 MB of column index that ran the process out of memory. What the value
// does hold never counts, so a value MATLAB wrote is never refused, whatever its size.
//
// One encode is one value. So is one WRITE (oneWrite), however many encodes a writer splits
// the value into: a binary dictionary writes a cell this writer has no stream for as XML,
// each sparse element of it the hex of a stream of its own, and those streams draw on the
// one budget. A writer's own spelling of what no data backs — the zeros of a sparse array it
// writes full (spendUnbacked) — comes out of it too.
//
// A refusal for the budget is final (MatBudgetError): the value is not written in part, or
// as anything else, and the write fails. Writing it as XML instead, or full, or as its
// summary, only moved the cost somewhere else or wrote a different value. A refusal for any
// other reason — a class this writer has no code for — leaves the caller its own spelling,
// out of the same budget, and gives back what the refused encode had charged: it wrote
// nothing.
/**
 * The most bytes one write (oneWrite; outside one, each encodeMatVariable, encodeMatStream,
 * encodeCdata) puts out that no data it was handed backs. Sized by measuring the worst case
 * it allows, one value spending all of it — a host's 1x4194305 copied, pasted into a text and
 * a binary dictionary and saved, cdata and hex included — on node 24: a peak of 0.32 GB for
 * the copy, 0.67 GB for the text save and 0.73 GB for the binary one, where twice this
 * peaked at 1.0 and 1.1 GB. Pinned at its value in test/unbackedBudget.test.ts.
 */
export const UNBACKED_BYTES_BUDGET = 16 * 1024 * 1024;
const newBudget = () => ({ left: UNBACKED_BYTES_BUDGET, at: [] });
/** The budget of the write under way (oneWrite), or null between writes. */
let writing = null;
/** Whether a write (oneWrite) is under way. */
export function writeUnderWay() {
    return writing !== null;
}
/**
 * Runs `write` as one write of one value: every encode in it, and every spendUnbacked, shares
 * one UNBACKED_BYTES_BUDGET. Inside a write already under way it is that write. Every node
 * writer of a value that holds others — serializeValue and serializeXml of a cell, a struct,
 * an object — starts one when none is, so a node written on its own is one write as an
 * entry's serialize() and XML are, not one per member it holds.
 */
export function oneWrite(write) {
    if (writing) {
        return write();
    }
    writing = newBudget();
    try {
        return write();
    }
    finally {
        writing = null;
    }
}
/**
 * Takes `bytes` of the write's budget for something a writer spells that no data backs —
 * `what`, in words — or, when not that much is left, takes nothing and refuses the write
 * (MatBudgetError).
 */
export function spendUnbacked(bytes, what) {
    charge(writing ?? newBudget(), bytes, what);
}
/**
 * Takes `bytes` of the budget, before they are written, or refuses the write. A charge that
 * is not a count — NaN, an infinity, a negative or a fraction, out of a dims word that is not
 * a size (`[1, "x"]`, `[0, 1e400]`) — is refused as well: compared, NaN is never more than
 * what is left, and taken, it left NaN, which no later charge was ever more than, so one such
 * array turned the budget off for the rest of the value.
 */
function charge(budget, bytes, what) {
    // NaN, a negative or a fraction. A count past 2^53, or an infinity out of a product of
    // sizes, is still one — over any budget — and refused as that.
    if (!(bytes >= 0) || (Number.isFinite(bytes) && !Number.isInteger(bytes))) {
        const at = budget.at.join('');
        throw new MatBudgetError((at || 'the value') + ', ' + what + ', would write ' + bytes + ' bytes no data backs, which is not a count', at, what, undefined, 'not-a-count');
    }
    if (bytes === 0) {
        return;
    }
    if (bytes > budget.left) {
        const at = budget.at.join('');
        // A count past 2^53 is not printed: a double holds it rounded.
        const said = Number.isSafeInteger(bytes) ? String(bytes) : 'more than ' + Number.MAX_SAFE_INTEGER;
        throw new MatBudgetError((at || 'the value') + ', ' + what + ', would write ' + said + ' bytes no data backs, more than the ' + budget.left + ' left of one write\'s '
            + UNBACKED_BYTES_BUDGET, at, what);
    }
    budget.left -= bytes;
}
/**
 * `e` restated for whoever asked for the write: the entry, the MATLAB path of what the
 * budget ran out at — `where` is the path of the value the refused encode began at, from
 * the entry's name — and the budget, in words a user can act on. Restated once.
 */
export function budgetFailure(e, entry, where) {
    if (e.entry !== undefined) {
        return e;
    }
    const at = where + e.at;
    const mib = UNBACKED_BYTES_BUDGET / (1024 * 1024) + ' MiB';
    const why = {
        budget: ', and with it the value would add more than ' + mib + ' that its data does not hold, the most one value may add.',
        'not-a-count': ', a size that is not a count, so what it would add beyond its data cannot be held to the ' + mib + ' one value may add.',
        'past-int32': ', an extent past ' + MAT_MAX_EXTENT + ', the most a MAT stream\'s dimensions can say, and it has no other spelling here.',
        'not-an-index': ', which is not a row and a column, and it has no spelling here without that non-zero.',
        'not-decoded': ', so there is no value of it to write.',
    }[e.reason];
    return new MatBudgetError('Cannot write "' + entry + '": ' + at + ' is ' + e.what + why + ' Nothing was written.', at, e.what, entry, e.reason);
}
/** `d` as MATLAB writes a size: 0x256, 1x100000000. */
const sizeOf = (d) => d.join('x');
/** How many elements `d` declares, exactly, as text: a product past 2^53 is no double. */
const countOf = (d) => d.reduce((a, x) => a * BigInt(x), 1n).toString();
/**
 * `cls` as MATLAB names a class, with its article: 'an int8', 'a char' (this package's
 * `mxchar` envelope holds one), 'a sparse double' (its `sparse` literal holds one).
 */
export function classPhrase(cls) {
    const name = cls === 'mxchar' ? 'char' : cls === 'sparse' ? 'sparse double' : cls;
    return (/^[aeio]/i.test(name) ? 'an ' : 'a ') + name;
}
const HOLE_BYTES = emptyDoubleBytes().length;
// The integer class each integer payload type holds, which is what its values are converted
// to (XmlUtils.toIntegerClass).
const PAYLOAD_INTEGER_CLASS = {
    [MI_INT8]: 'int8',
    [MI_UINT8]: 'uint8',
    [MI_INT16]: 'int16',
    [MI_UINT16]: 'uint16',
    [MI_INT32]: 'int32',
    [MI_UINT32]: 'uint32',
    [MI_INT64]: 'int64',
    [MI_UINT64]: 'uint64',
};
/**
 * The payload of a numeric element: each value as its type holds it.
 *
 * An integer type's value is MATLAB's conversion of it to that class (toIntegerClass, its
 * range looked up once for the payload, integerConversion): rounded to the nearest integer,
 * a tie away from zero, and saturated, with NaN as 0.
 * DataView's setters wrap modulo the width and truncate instead, so an int16 70000 went
 * into the stream as 4464, 3.7 as 3 and Inf as 0, and a complex element typed 70000+1i
 * was saved as 4464+1i. A value the class holds goes in as it always did.
 *
 * A 64-bit value goes out as a BigInt, from the exact decimal TOKEN a string carries when a
 * double cannot hold it (XmlUtils.parseExactNum), so the conversion never puts one through
 * a double; a plain number is converted the same way. BigInt() throws on what is not an
 * integer, and setBigInt64 wraps one past the range, which the conversion has already
 * saturated. (A logical array's payload is uint8, and its 1s and 0s are uint8 values.)
 */
function numericPayload(type, values) {
    const width = WIDTH[type];
    if (!width) {
        throw new MatWriteError('no payload width for MAT element type ' + type);
    }
    const data = new Uint8Array(values.length * width);
    const view = new DataView(data.buffer);
    const intClass = PAYLOAD_INTEGER_CLASS[type];
    const toClass = intClass === undefined ? undefined : integerConversion(intClass);
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        const at = i * width;
        if (toClass !== undefined) {
            const n = toClass(v);
            switch (type) {
                case MI_INT8:
                    view.setInt8(at, Number(n));
                    break;
                case MI_UINT8:
                    view.setUint8(at, Number(n));
                    break;
                case MI_INT16:
                    view.setInt16(at, Number(n), true);
                    break;
                case MI_UINT16:
                    view.setUint16(at, Number(n), true);
                    break;
                case MI_INT32:
                    view.setInt32(at, Number(n), true);
                    break;
                case MI_UINT32:
                    view.setUint32(at, Number(n), true);
                    break;
                case MI_INT64:
                    view.setBigInt64(at, BigInt(n), true);
                    break;
                default:
                    view.setBigUint64(at, BigInt(n), true);
                    break;
            }
            continue;
        }
        const n = typeof v === 'number' ? v : Number(v);
        if (type === MI_SINGLE) {
            view.setFloat32(at, n, true);
        }
        else {
            view.setFloat64(at, n, true);
        }
    }
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
// An exact 64-bit token is a bare decimal integer carried as TEXT because a double cannot
// hold it (XmlUtils.isExactToken). Only numericPayload's two 64-bit arms consume one, and
// only a 64-bit class ever produces one, so every other arm sees numbers as before.
//
// A complex int64/uint64 carries one in `re`/`im` as well: MatParser builds `{re, im}` out
// of the same readNumericArray both parts come from, so `Number(...) || 0` here would round
// the real part of `complex(intmax('int64'), 1)` one step after the reader kept it exact.
//
// A number is written as it is, NaN included. `Number(x) || 0` is false for NaN, so every
// NaN this packer wrote — a double's, a single's, either part of a complex value's — went
// into the stream as 0: [1 NaN Inf] read back as [1 0 Inf]. The fallback is for what is
// not a number at all.
function exactPart(x) {
    if (isExactToken(x)) {
        return x;
    }
    if (typeof x === 'number') {
        return x;
    }
    return Number(x) || 0;
}
function realPart(x) {
    if (x !== null && typeof x === 'object' && 're' in x) {
        return exactPart(x.re);
    }
    // Untouched: `Number(x) || 0` here would round maxU64 to 18446744073709552000 on the
    // way into the byte stream, one step after the reader had kept it exact (defect 29).
    return exactPart(x);
}
function imagPart(x) {
    if (x !== null && typeof x === 'object' && 'im' in x) {
        return exactPart(x.im);
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
function cellBody(v, d, budget) {
    const cells = flatValues(v.value);
    const n = elementCountOf(d);
    // Every slot it declares and does not hold is a hole, written as an empty double from the
    // budget: a cell declaring 1e8 elements and holding one was 1e8 of them.
    let held = 0;
    for (let i = 0; i < Math.min(n, cells.length); i++) {
        if (cells[i])
            held++;
    }
    charge(budget, (n - held) * HOLE_BYTES, 'a ' + sizeOf(d) + ' cell holding ' + held + ' of its ' + countOf(d) + ' elements');
    const parts = [];
    for (let i = 0; i < n; i++) {
        const c = cells[i];
        // A slot the reader could not read stays a hole. Dropping it would slide
        // every later element one position early.
        if (c) {
            budget.at.push('{' + (i + 1) + '}');
            parts.push(memberElement(c, budget));
            budget.at.pop();
        }
        else {
            parts.push(emptyDoubleBytes());
        }
    }
    return parts;
}
function structBody(v, d, budget) {
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
    // With no fields an element is nothing at all, so there is nothing per element to write.
    if (names.length === 0) {
        return parts;
    }
    // Each field of each element it declares and does not hold is a hole, from the budget.
    let holes = 0;
    for (const name of names) {
        const held = fields[name];
        let present = 0;
        if (Array.isArray(held)) {
            for (let e = 0; e < Math.min(n, held.length); e++) {
                if (held[e])
                    present++;
            }
        }
        else if (n === 1 && held) {
            present = 1;
        }
        holes += n - present;
    }
    const fieldCount = BigInt(countOf(d)) * BigInt(names.length);
    charge(budget, holes * HOLE_BYTES, 'a ' + sizeOf(d) + ' struct array missing ' + (Number.isSafeInteger(holes) ? holes : 'some') + ' of its ' + fieldCount + ' fields');
    for (let e = 0; e < n; e++) {
        for (const name of names) {
            const held = fields[name];
            const one = Array.isArray(held) ? held[e] : n === 1 ? held : undefined;
            // A MATLAB struct array is homogeneous, so every element has every field.
            // An element that lost one (a whole-value edit clears its children) keeps
            // its slot as an empty double rather than shifting the ones after it.
            if (one) {
                budget.at.push((n === 1 ? '' : '(' + (e + 1) + ')') + '.' + name);
                parts.push(memberElement(one, budget));
                budget.at.pop();
            }
            else {
                parts.push(emptyDoubleBytes());
            }
        }
    }
    return parts;
}
// MAT class 5, mxSPARSE_CLASS: what a double or logical sparse array is written under.
const MX_SPARSE = 5;
// The flag MATLAB sets on every sparse array it writes, class 5 included, and the only
// mark a sparse SINGLE has (see MatParser's sparse arm).
const SPARSE_FLAG = 0x10;
/**
 * A sparse array as MATLAB stores one: its non-zeros, not its elements.
 *
 * Every byte below is MATLAB's, measured on the sparse streams of test/fixtures/sparse
 * (make_sparse_fixtures.m: double real and complex, logical, single, all-zero, row,
 * column, non-finite, large, a struct field, a cell element, a Parameter Value), and the
 * tests hold this writer to byte equality with every one of them:
 *
 *   array flags   class 5 for double and logical, 7 for single; flags 0x10, plus 0x02
 *                 for logical and 0x08 for complex; nzmax max(nnz, 1) — an all-zero
 *                 array still reserves one
 *   dimensions    rows, cols (a sparse array has exactly two)
 *   name          empty, as everywhere in a stream
 *   ir            miINT32, the 0-based row of each non-zero in column-major order, nnz
 *                 of them (not nzmax)
 *   jc            miINT32, cols + 1 column starts
 *   pr            the non-zeros: miDOUBLE for double, miSINGLE for single, miUINT8 ones
 *                 for logical — never narrowed to a smaller type
 *   pi            the imaginary parts, of pr's type, when complex
 *
 * The non-zeros are `v.sparse`, as MatParser reads them and the node layer edits them
 * (MatlabVariableNode._buildVarObject); a variable a host or a test built with a dense
 * row-major `value` instead is read off that, which then has to hold every element. Only
 * an entry that is a non-zero is written — anything but 0 in either part, so NaN stays
 * and -0 goes (sparse(-0) holds nothing) — so one an edit set to zero is not. jc is
 * counted from the columns, which is the one part of the stream that grows with the
 * array's shape rather than with what it holds.
 *
 * Refused (sparseWriteRefusal): a variable a reader did not decode (`undecoded`, which has
 * no values here to write, only the placeholder that stands for them), a shape or class
 * MATLAB has no sparse storage for, a dense value whose length its dims disagree with, an
 * array whose dims declare more columns than what it was read from backs, and non-zeros out
 * of MATLAB's order or outside the array — each a stream MATLAB would read back as
 * something else, or, for the columns, one that would cost what no byte of the file held.
 */
function encodeSparse(v, budget) {
    const d = dimsOf(v);
    const logical = !!v.isLogical || v.className === 'logical';
    // A non-zero at no row and column first, whatever the shape: every other spelling of the
    // array — its full form, a dense list — drops the non-zero it cannot place and writes a
    // zero where it was, so the refusal is final. Asked after the shape, it let an int8 or an
    // N-D one through to the full form its caller writes (_sparseFallback), which dropped it.
    const fault = v.sparse ? sparseIndexFault(v.sparse) : -1;
    if (v.sparse && fault >= 0) {
        const at = budget.at.join('');
        const what = 'a ' + sizeOf(d) + ' sparse ' + (logical ? 'logical' : v.className) + ' whose non-zero ' + (fault + 1) + ' is at (' + String(v.sparse.row[fault]) + ', ' + String(v.sparse.col[fault]) + ')';
        throw new MatBudgetError((at || 'the value') + ', ' + what + ', which is not a row and a column', at, what, undefined, 'not-an-index');
    }
    // Then what no writer could write, then what the budget will not cover — a refusal of its
    // own, and final — and then what no stream could hold: an index of 2^30 columns no byte
    // backs is past the budget long before it is past a size word.
    const refusal = sparseShapeRefusal(v);
    if (refusal) {
        throw new MatWriteError(refusal);
    }
    const cls = logical || v.className === 'double' ? MX_SPARSE : CLASS_CODE.single;
    const payload = logical ? MI_UINT8 : v.className === 'double' ? MI_DOUBLE : MI_SINGLE;
    const complex = !!v.isComplex && !logical;
    const [rows, cols] = d;
    const s = v.sparse ?? sparseFromDense(flatValues(v.value), d, complex);
    // The column index past the columns its source backs, from the write's budget.
    const backed = Math.min(cols, backedColumnsOf(s));
    charge(budget, 4 * (cols - backed), sparseWhat(d, backed));
    const capped = sparseCapRefusal(cols);
    if (capped) {
        throw new MatWriteError(capped);
    }
    const ir = [];
    const jc = new Int32Array(cols + 1);
    const re = [];
    const im = [];
    for (let k = 0; k < s.row.length; k++) {
        const r = s.row[k];
        const c = s.col[k];
        const ordered = k === 0 || c > s.col[k - 1] || (c === s.col[k - 1] && r > s.row[k - 1]);
        if (!(r >= 0 && r < rows && c >= 0 && c < cols) || !ordered) {
            throw new MatWriteError('a sparse array\'s non-zeros are out of order or outside [' + d.join(',') + '] at entry ' + k);
        }
        const a = s.re[k];
        const b = complex && s.im ? s.im[k] : 0;
        // `!== 0` is true of NaN and false of -0, which is MATLAB's rule for both.
        if (a !== 0 || b !== 0) {
            ir.push(r);
            re.push(logical ? 1 : a);
            im.push(b);
            jc[c + 1]++;
        }
    }
    for (let c = 0; c < cols; c++) {
        jc[c + 1] += jc[c];
    }
    const flags = new Uint8Array(8);
    flags[0] = cls;
    flags[1] = SPARSE_FLAG | (complex ? 0x08 : 0) | (logical ? 0x02 : 0);
    new DataView(flags.buffer).setUint32(4, Math.max(ir.length, 1), true);
    const subs = [
        element(MI_UINT32, flags),
        dimsElement(d),
        emptyName(),
        numericPayload(MI_INT32, ir),
        numericPayload(MI_INT32, jc),
        numericPayload(payload, re),
    ];
    if (complex) {
        subs.push(numericPayload(payload, im));
    }
    return element(MI_MATRIX, concat(subs));
}
/**
 * Why encodeSparse refuses `v`, or null when it writes it. Read off the shape, the class and
 * what the non-zeros say backs them — never the non-zeros themselves — so it is asked of a
 * node before it offers an editor (MatlabVariableNode._sparseRefusal): an array no edit of
 * could be written takes none.
 *
 * The column index is the one part of the stream that grows with the array's declared
 * shape: cols + 1 words, whatever the rows. So the columns have to be backed by what the
 * array came from (SparseData.backedColumns): a file's own column index, or a dense list's
 * elements, one column apiece — never the declared count alone. One read from a file whose
 * index held fewer columns than its dims declare has a damaged dims word (`new Array(2^31)`
 * for one corrupted cols word of a 3 KB hex value, a fatal out-of-memory no caller could
 * catch), and `Matrix(0,134217728)\n[]`, credited its header's columns, was a 512 MB index
 * from 52 characters. The columns past the backed ones are written out of the write's
 * budget (UNBACKED_BYTES_BUDGET), so sparse(0, 5) and a host's 1x2e6 with three entries are
 * written, and refused here is only an array whose unbacked index alone is past all of it.
 * And no stream holds a column index past what its uint32 size word can say. A value MATLAB
 * wrote is none of these.
 */
export function sparseWriteRefusal(v) {
    const shape = sparseShapeRefusal(v);
    if (shape) {
        return shape;
    }
    // Dims no MAT stream can say, or that are no size: nothing could write an edit of it.
    if (!isSize(dimsOf(v))) {
        return 'a sparse array declaring dimensions ' + dimsText(dimsOf(v)) + ', which are not a size';
    }
    if (dimsOf(v).some((x) => x > MAT_MAX_EXTENT)) {
        return 'a ' + sizeOf(dimsOf(v)) + ' sparse array has an extent past ' + MAT_MAX_EXTENT + ', which no MAT stream can say';
    }
    const [, cols] = dimsOf(v);
    const backed = sparseBackedColumns(v);
    const unbacked = 4 * Math.max(0, cols - backed);
    if (unbacked > UNBACKED_BYTES_BUDGET) {
        return ('a sparse array declaring ' + cols + ' columns is backed for ' + backed + ', and the rest of its column index, ' + unbacked
            + ' bytes no data backs, is more than one write may put out (' + UNBACKED_BYTES_BUDGET + ')');
    }
    return sparseCapRefusal(cols);
}
/**
 * What no writer could write of `v` whatever the budget: a variable not decoded, a rank or
 * a class MATLAB never stores sparse, a dense list its dims disagree with.
 */
function sparseShapeRefusal(v) {
    if (v.undecoded) {
        return 'cannot write a sparse array the reader did not decode (' + v.undecoded + ')';
    }
    const d = dimsOf(v);
    if (d.length !== 2) {
        return 'a sparse array has two dimensions, not [' + d.join(',') + ']';
    }
    const logical = !!v.isLogical || v.className === 'logical';
    if (!logical && v.className !== 'double' && v.className !== 'single') {
        return 'no sparse MAT class for "' + v.className + '"';
    }
    const [rows, cols] = d;
    if (!v.sparse) {
        const n = flatValues(v.value).length;
        if (n !== rows * cols) {
            return 'sparse value has ' + n + ' elements but declares [' + d.join(',') + ']';
        }
    }
    return null;
}
/**
 * What backs `v`'s columns: the source's own index, or its elements, one column apiece —
 * never the declared count, which is one word of the file (SparseData.backedColumns). The
 * rest of the index comes out of a write's budget, and an array whose rest alone is past
 * all of it can never be written.
 */
function sparseBackedColumns(v) {
    const cols = dimsOf(v)[1];
    return v.sparse ? backedColumnsOf(v.sparse) : Math.min(cols, flatValues(v.value).length);
}
/** No stream holds a column index past what its uint32 size word can say. */
function sparseCapRefusal(cols) {
    return 4 * (cols + 1) > 0xffffffff ? 'a sparse array of ' + cols + ' columns has a column index no MAT stream can hold' : null;
}
/** A sparse array of `d` backed for `backed` columns, in the words a budget refusal uses. */
function sparseWhat(d, backed) {
    return 'a ' + sizeOf(d) + ' sparse array whose data holds ' + (backed === 0 ? 'none' : backed) + ' of its ' + d[1] + ' columns';
}
/**
 * The bytes of one complete `miMATRIX` element: tag, then the matrix body. It writes no more
 * than UNBACKED_BYTES_BUDGET that the value does not back, out of the write's budget when one
 * is under way (oneWrite).
 */
export function encodeMatVariable(v) {
    const budget = writing ?? newBudget();
    const left = budget.left;
    // Where this encode is, from `v`: each encode's own, a write's being many.
    const at = budget.at;
    budget.at = [];
    try {
        refuseDimsBelow(v, budget);
        return encodeElement(v, budget);
    }
    catch (e) {
        // Refused, it wrote nothing, so it takes nothing.
        budget.left = left;
        throw e;
    }
    finally {
        budget.at = at;
    }
}
/**
 * A member of a cell or a struct. A sparse array that carries the bytes it was read from —
 * which the node layer hands over only until an element row edits it
 * (MatlabVariableNode._buildVarObject) — is that element, as _matStream writes one standing
 * alone: its own bytes are the value, they cost what the file held, and they are MATLAB's
 * where a re-encode would be this writer's. Re-encoded from its non-zeros instead, each
 * 48-byte member of a cell of 80,000 declaring 0x256 is 1,104 bytes, 257 words of index no
 * byte held, and the cell is refused. Anything else is encoded, out of the write's budget.
 */
function memberElement(v, budget) {
    if (v.isSparse && v._rawBytes) {
        const own = ownElement(v._rawBytes);
        if (own) {
            return own;
        }
    }
    return encodeElement(v, budget);
}
/**
 * Whether memberElement writes `v` as the bytes it was read from. Its dims are then what its
 * bytes say, as the file said them, so they are not refuseDimsBelow's to ask: at 3f55eff a
 * member whose damaged dims word read [-5, 3] made an unedited cell's copy throw.
 */
function writtenAsOwnBytes(v) {
    return !!(v.isSparse && v._rawBytes && ownElementName(v._rawBytes));
}
/**
 * Refuses `v`, finally, when its dims are what no stream can hold. Dims that are no size
 * (parser/Size) make no count to hold to the budget — a fraction even makes a whole one:
 * [1, 2.5] charged 84 bytes for one hole and wrote three. And a size past what a MAT
 * stream's int32 dims word can say — MATLAB on 64 bits holds a zeros(0, 2^31), and a
 * dictionary spells it as text — has no stream, where it would be written as the extent
 * the word wraps to.
 */
function refuseDims(v, budget) {
    // MATLAB's class name: a logical array goes out as uint8 with the logical flag.
    const named = (v.isLogical ? 'logical' : v.className) || 'value';
    if (!isSize(v.dimensions || [])) {
        charge(budget, NaN, classPhrase(v.isSparse ? 'sparse ' + named : named) + ' declaring dimensions ' + dimsText(v.dimensions));
    }
    const past = (v.dimensions || []).find((x) => x > MAT_MAX_EXTENT);
    if (past !== undefined) {
        const at = budget.at.join('');
        const what = 'a ' + sizeOf(v.dimensions) + ' ' + (v.isSparse ? 'sparse ' : '') + named;
        throw new MatBudgetError((at || 'the value') + ', ' + what + ', has an extent of ' + past + ', past ' + MAT_MAX_EXTENT, at, what, undefined, 'past-int32');
    }
}
/**
 * refuseDims over `v` and every member below it, before anything is encoded: a final
 * refusal has to win whatever the order of the members. Encoded in order, a member written
 * another way — a struct of a class MatWriter has no variable for (`_unwritable`) — refused
 * the stream first, and its caller wrote the whole value another way, a later member whose
 * dims are no size included: `[0, 1e400]` went into a text dictionary as `[0,null]`.
 */
function refuseDimsBelow(v, budget) {
    refuseDims(v, budget);
    if (v.isSparse) {
        return;
    }
    if (v.className === 'cell') {
        flatValues(v.value).forEach((c, i) => {
            if (c && typeof c === 'object' && !writtenAsOwnBytes(c)) {
                budget.at.push('{' + (i + 1) + '}');
                refuseDimsBelow(c, budget);
                budget.at.pop();
            }
        });
    }
    else if (v.className === 'struct' && v.fields) {
        const n = elementCountOf(dimsOf(v));
        for (const [name, held] of Object.entries(v.fields)) {
            const each = Array.isArray(held) ? held : [held];
            each.forEach((one, e) => {
                if (one && typeof one === 'object' && !writtenAsOwnBytes(one)) {
                    budget.at.push((n === 1 ? '' : '(' + (e + 1) + ')') + '.' + name);
                    refuseDimsBelow(one, budget);
                    budget.at.pop();
                }
            });
        }
    }
}
/**
 * The refusal this writer makes of a variable of class `className` (encodeElement), or null for a
 * class it has a MAT class for. Asked, too, of a value whose variable says another class than
 * it has: a MATLAB string, which the node layer hands over as a char (MatlabVariableNode
 * _unwritableStream).
 */
export function classRefusal(className) {
    // By own key: a class name can be a file's word (a text dictionary's `_type`, a binary
    // one's Class), and `toString` or `constructor` would otherwise answer an inherited
    // function, slip past this refusal and fail later with an unrelated reason.
    return Object.prototype.hasOwnProperty.call(CLASS_CODE, className)
        ? null
        : new MatWriteError('no MAT class for "' + className + '"');
}
/** encodeMatVariable within an encode already under way, sharing its budget. */
function encodeElement(v, budget) {
    if (v.isOpaque) {
        throw new MatWriteError('cannot write an MCOS opaque value (' + (v.className || 'unknown') + ')');
    }
    // Dims that are no size (parser/Size) make no count to hold to the budget — a fraction
    // even makes a whole one: [1, 2.5] charged 84 bytes for one hole and wrote three — so they
    // are refused as what the budget cannot measure, finally.
    refuseDims(v, budget);
    // A member the node layer has no variable for (MatlabVariableNode._memberVar): this
    // writer has no stream for it, and its caller writes it another way.
    if (v._unwritable) {
        throw new MatWriteError(v._unwritable);
    }
    // Before the class lookup, because a sparse array's class IS one the full-array arms
    // have a code for — MATLAB's class() of a sparse double is 'double' — and the full
    // array they would write is a different variable: the same values, stored dense.
    if (v.isSparse) {
        return encodeSparse(v, budget);
    }
    const refusal = classRefusal(v.className);
    if (refusal) {
        throw refusal;
    }
    const cls = CLASS_CODE[v.className];
    const d = dimsOf(v);
    const logical = !!v.isLogical || v.className === 'logical';
    let body;
    if (cls === MX_CELL) {
        body = cellBody(v, d, budget);
    }
    else if (cls === MX_STRUCT) {
        body = structBody(v, d, budget);
    }
    else if (cls === MX_CHAR) {
        body = charBody(v, d);
    }
    else {
        body = numericBody(v, logical ? MX_UINT8 : cls, d);
    }
    // Not `subs.push(...body)`: a cell's body is one part a member, and spread as arguments,
    // past about 120,000 members it overflowed the stack.
    return element(MI_MATRIX, concat([arrayFlags(cls, !!v.isComplex, logical), dimsElement(d), emptyName(), concat(body)]));
}
/**
 * The `_value` string of a text .sldd `{"_type": "cdata"}` entry: the 8-byte
 * preamble, one miMATRIX element, uuencoded.
 */
export function encodeCdata(v) {
    return uuencode(encodeMatStream(v));
}
/**
 * The MAT stream of one value — `getByteStreamFromArray(value)`: the 8-byte preamble and
 * one miMATRIX element. A text dictionary carries it uuencoded (encodeCdata), a binary
 * one as hex (EncodedValue.hexValue).
 */
export function encodeMatStream(v) {
    return concat([new Uint8Array(CDATA_PREAMBLE), encodeMatVariable(v)]);
}
/**
 * The MAT stream of a value whose miMATRIX element is at hand AS READ (MatVariable's
 * `_rawBytes`), or null when the bytes are not a whole one this can re-frame.
 *
 * For a value nothing here can re-encode because the reader never decoded it — one
 * MatParser recorded as `undecoded` — though a copy of such a value itself, out of a .mat or
 * a model workspace, is refused (MatlabVariableNode._undecodedRefusal). Its bytes are
 * the value; the one thing in them a stream does not carry is the variable's NAME, which a
 * .mat writes into the element and a stream leaves empty, so the name subelement is
 * replaced by the empty one and the element's size restated. Everything else is copied byte for byte. An MCOS opaque (class 17) is not framed this
 * way, and its subsystem lives elsewhere in the file, so it is refused.
 */
export function matStreamOfElement(raw) {
    const own = ownElement(raw);
    return own ? concat([new Uint8Array(CDATA_PREAMBLE), own]) : null;
}
/**
 * The miMATRIX element `raw` holds as read, with its name subelement replaced by the empty
 * one an element has in a stream, a cell or a struct; null when the bytes are not a whole
 * one this can re-frame (see matStreamOfElement).
 */
function ownElement(raw) {
    const at = ownElementName(raw);
    if (!at) {
        return null;
    }
    const body = concat([raw.slice(8, at.nameAt), emptyName(), raw.slice(at.nameAt + at.name, at.end)]);
    return concat([u32le(MI_MATRIX), u32le(body.length), body]);
}
/**
 * Where the name subelement of the miMATRIX element `raw` holds is, and where the element
 * ends; null when the bytes are not a whole one ownElement can re-frame. Read, not built, so
 * it can be asked of every member before a write (refuseDimsBelow).
 */
function ownElementName(raw) {
    if (raw.length < 8) {
        return null;
    }
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const end = 8 + view.getUint32(4, true);
    if (view.getUint32(0, true) !== MI_MATRIX || end > raw.length) {
        return null;
    }
    // The byte length of the subelement at `at`, small form included, or 0 past the end.
    const subLength = (at) => {
        if (at + 8 > end) {
            return 0;
        }
        const word = view.getUint32(at, true);
        if (word >>> 16) {
            return 8;
        }
        const n = view.getUint32(at + 4, true);
        return 8 + n + ((8 - (n % 8)) % 8);
    };
    const flags = subLength(8);
    if (!flags || raw[16] === 17) {
        return null;
    }
    const dims = subLength(8 + flags);
    const nameAt = 8 + flags + dims;
    const name = dims ? subLength(nameAt) : 0;
    if (!name || nameAt + name > end) {
        return null;
    }
    return { nameAt, name, end };
}
/**
 * A complex value's plain-text form — `{_type: 'cdata', _value: '1+2i 5+6i 3+4i 7+8i',
 * _dimensions, _class?}`, what BinarySlddParser reads out of a binary dictionary and
 * McosParser.complexPropertyValue builds — as the variable it stands for, or null when it
 * is not that form or a token in it is not one complex element. Read off the text, so a
 * value the node layer could not read as numbers (a binary dictionary's own non-finite
 * text, shown quoted) still converts: XmlUtils.parseComplexNum reads every spelling,
 * MATLAB's `1.0NaNi` included.
 */
export function complexTextVariable(raw) {
    const env = raw;
    if (!env || env._type !== 'cdata' || typeof env._value !== 'string' || isMatCdata(env)) {
        return null;
    }
    const cls = complexClassTag(env._class) ?? 'double';
    const text = env._value.trim();
    const tokens = text === '' ? [] : text.split(/\s+/);
    const dims = Array.isArray(env._dimensions) ? env._dimensions.slice() : [1, tokens.length];
    if (elementCountOf(dims) !== tokens.length) {
        return null;
    }
    const pairs = tokens.map((t) => parseComplexNum(t, cls));
    if (pairs.some((pair) => pair === null)) {
        return null;
    }
    return {
        name: '',
        className: cls,
        dimensions: dims,
        isComplex: true,
        isLogical: false,
        // The text is column-major; a variable is row-major within each page, as MatParser
        // builds one and numericBody above expects.
        value: transposeFromColumnMajorND(pairs, dims),
        fields: null,
    };
}
/**
 * A real rank >= 3 array in the typed literal form a binary dictionary's reader holds it in
 * — `{_type: 'double', _value: 'Matrix(2,3,2)\n[[1.0, 2.0, 3.0]; …]'}`
 * (BinarySlddParser.formatMatrix) — as the variable it stands for, or null when it is not
 * that form: a class other than a numeric one or logical, a rank of 2 once trailing
 * singletons are dropped, no element, or a body whose tokens are not its element count.
 * MATLAB reads the literal out of a TEXT dictionary as an empty 1x0 (the file header), so
 * textDictionaryForm writes this instead, as the stream MATLAB writes there.
 *
 * The tokens are read as the node layer's parseMatrixValue reads them — Inf and NaN, the F
 * and U suffixes left off, an int64 or uint64 kept exact — but here, because this layer does
 * not reach the node layer. The body is each page's rows in turn, which is the row-major
 * order within each page a variable holds (complexTextVariable).
 */
function matrixLiteralVariable(o) {
    const cls = o._type;
    if (typeof cls !== 'string' || !(NUMERIC_CLASS.test(cls) || cls === 'logical') || typeof o._value !== 'string' || isEnumBag(o)) {
        return null;
    }
    const literal = /^Matrix\((\d+(?:,\d+)*)\)\n(.*)$/s.exec(o._value);
    if (!literal) {
        return null;
    }
    const dims = effectiveDims(literal[1].split(',').map((d) => parseInt(d, 10)));
    const count = elementCountOf(dims);
    if (dims.length < 3 || count === 0) {
        return null;
    }
    const tokens = literal[2].match(/-?(?:[\d.]+(?:[eE][+-]?\d+)?|Inf|NaN)/g) ?? [];
    if (tokens.length !== count) {
        return null;
    }
    const exact = needsExactInt(cls);
    return {
        name: '',
        className: cls,
        dimensions: dims,
        isComplex: false,
        isLogical: cls === 'logical',
        value: tokens.map((t) => (exact ? parseExactNum(t) : parseMatlabNum(t))),
        fields: null,
    };
}
/**
 * A text dictionary's own complex text, by identity: what its reader found there
 * (heldByTextDictionary), which v1.36.0 wrote for a complex value. textDictionaryForm turns it
 * into the stream MATLAB writes there, as it does any complex text, but one with no stream to
 * be instead — an extent past an int32, a size that is no count — it leaves as read, being
 * what the file already holds: refused, it failed the save of every entry in the file. The
 * same text pasted in out of a binary dictionary is not one of these, and is refused.
 *
 * And for the same reason, dims of its own that hold an infinity: JSON.parse reads an
 * overflowing extent, `1e400`, as one. JSON has no spelling for it, so a save writes it as
 * null, as it always has, where any other value's is refused (textDictionaryForm). What is
 * recorded is the dims array itself, not the bag holding it: an untouched object array is
 * written as a new bag around its elements (ObjectNode.serializeValue, `{ ...rawVal,
 * _elements }`), which keeps the array read and is not the bag read.
 */
const textDictionaryOwn = new WeakSet();
const isInfinity = (x) => x === Infinity || x === -Infinity;
/** An extent a text dictionary's own dims can hold: what JSON reads, an infinity for one past any double, never NaN or a bigint. */
const isReadExtent = (x) => isInfinity(x) || isTextExtent(x);
/**
 * Records every complex text in `value`, a value as the text dictionary being read holds it,
 * and every dims array that holds an infinity. Every entry is walked, so the walk allocates
 * nothing and steps over every primitive: 15 ms of the 420 ms a 138 MB dictionary of 140,000
 * entries takes to read.
 */
export function heldByTextDictionary(value) {
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            const e = value[i];
            if (e !== null && typeof e === 'object') {
                heldByTextDictionary(e);
            }
        }
        return;
    }
    if (value === null || typeof value !== 'object') {
        return;
    }
    const o = value;
    if (o._type === 'cdata') {
        textDictionaryOwn.add(o);
        return;
    }
    for (const k in o) {
        const v = o[k];
        if (v !== null && typeof v === 'object') {
            // Asked of the key the walk is on, not looked up on every object: about 4 ms of 140,000
            // entries' walk, where this costs none that shows.
            if (k === '_dimensions' && Array.isArray(v) && v.some(isInfinity)) {
                textDictionaryOwn.add(v);
            }
            heldByTextDictionary(v);
        }
    }
}
/**
 * A value as an uncompressed-text dictionary must hold it: every complex value in its
 * plain-text form, at any depth, replaced by the MAT stream MATLAB writes for it there, a
 * binary dictionary's dense empty too, and a real rank >= 3 `Matrix(…)` literal
 * (matrixLiteralVariable), and everything else as it was. A copy wherever
 * something changed, so the bag a node replays is never touched; the same object where
 * nothing did.
 *
 * MATLAB reads the plain-text form back out of a TEXT dictionary as an empty double
 * (defect 24's signature), and it is the form a binary dictionary and the MCOS decoder
 * hold a complex value in, which an untouched value replays: a Parameter pasted out of a
 * binary dictionary, or copied out of a .mat, went into a text one as
 * `{"_type": "cdata", "_value": "3+4i"}` and MATLAB reopened it as []. At any depth,
 * because the replay is whole bags too — a struct's, a cell's, a LookupTable's Table.
 */
export function textDictionaryForm(x, at = '') {
    return textForm(x, at, 'value');
}
function textForm(x, at, place) {
    if (x === null || typeof x !== 'object') {
        return x;
    }
    if (Array.isArray(x)) {
        let changed = false;
        const out = x.map((e) => {
            const t = textForm(e, at, place);
            changed = changed || t !== e;
            return t;
        });
        return changed ? out : x;
    }
    const o = x;
    // Dims holding NaN or an infinity, which JSON.stringify writes as null, or a bigint, which
    // it cannot write at all. Refused, finally, as an XML writer refuses them
    // (DataNode._sizeOrRefuse), said where they stand; a hand-made [1, "x"] goes as read, and
    // so do undefined, a function, a symbol and a hole, which are not asked (parser/Size,
    // isTextExtent). Not an infinity the text dictionary was read with
    // (textDictionaryOwn: a complex text's bag, or the dims array); NaN or a bigint, which no
    // file holds, even there.
    const dims = o._dimensions;
    if (Array.isArray(dims) && !dims.every(isTextExtent)
        && !((textDictionaryOwn.has(o) || textDictionaryOwn.has(dims)) && dims.every(isReadExtent))) {
        const what = classPhrase(bagClass(o)) + ' declaring dimensions ' + dimsText(dims);
        throw new MatBudgetError(what + ' was not written', at, what, undefined, 'not-a-count');
    }
    // A binary dictionary's encoded byte stream (EncodedValue) is the same stream a text
    // dictionary carries for the same value as cdata, four bits a character there and six
    // here — MATLAB's own text twin of a hex sparse array is that cdata character for
    // character. Written into a text dictionary as it stands, it would be a `_type` MATLAB
    // has no reader for. A stream whose bytes cannot be read is left as it is: nothing
    // else here could say what it holds.
    if (isEncodedValue(o)) {
        const read = encodedBytes(o);
        return read.bytes ? { _type: 'cdata', _value: uuencode(read.bytes) } : o;
    }
    // A binary dictionary's classed or shaped empty, as its reader holds one, saying so
    // (XmlUtils.BINARY_EMPTY_KEY): what a text dictionary was given for it (heldTextSpelling). The
    // same spelling without the key is a text dictionary's own, and goes as it is.
    if (o[BINARY_EMPTY_KEY] !== undefined) {
        return heldTextSpelling(o, place, at);
    }
    // A binary dictionary's dense empty in the form its reader gives one emptyOf cannot hold
    // (`_emptyDims`, BinarySlddParser.parseEntryValue), which a value replays where no MAT stream
    // can say its N-D dims (MatlabVariableNode.serializeValue): a text dictionary has no spelling
    // for an N-D value but the stream, so it is refused here, finally, said where it stands in
    // the value.
    if (Array.isArray(o._emptyDims) && typeof o._type === 'string') {
        const empty = { name: '', className: o._type, dimensions: o._emptyDims, isComplex: false, isLogical: o._type === 'logical', value: [], fields: null };
        try {
            return { _type: 'cdata', _value: encodeCdata(empty) };
        }
        catch (e) {
            if (e instanceof MatBudgetError) {
                throw new MatBudgetError(e.message, at + e.at, e.what, undefined, e.reason);
            }
            return o;
        }
    }
    // A real rank >= 3 literal, which MATLAB reads out of a text dictionary as an empty 1x0: a
    // binary dictionary's, pasted, or one an older version of this package wrote. Written as
    // the stream MATLAB writes for it there, at the leaf (defect 22's placement rule,
    // test/parity/matlab/DESIGN.md), and refused, finally, past what a stream can say, as the
    // complex text below is.
    const matrix = matrixLiteralVariable(o);
    if (matrix) {
        try {
            return { _type: 'cdata', _value: encodeCdata(matrix) };
        }
        catch (e) {
            if (e instanceof MatBudgetError) {
                throw new MatBudgetError(e.message, at + e.at, e.what, undefined, e.reason);
            }
            return o;
        }
    }
    if (o._type === 'cdata') {
        const variable = complexTextVariable(o);
        if (!variable) {
            return o;
        }
        try {
            return { _type: 'cdata', _value: encodeCdata(variable) };
        }
        catch (e) {
            // A refusal for what the value declares is final, here as anywhere: the complex text
            // left as it stands is what MATLAB reads back out of a text dictionary as an empty
            // double. Said where it stands in the value, for the node that owns it to name. But
            // not of the text the file being written was read with, which is that file's own.
            if (e instanceof MatBudgetError && !textDictionaryOwn.has(o)) {
                throw new MatBudgetError(e.message, at + e.at, e.what, undefined, e.reason);
            }
            return o;
        }
    }
    // An enumeration value read out of a binary dictionary, as MATLAB writes one in a text
    // dictionary (enumTextForm): the binary reader's two keys (XmlUtils.ENUM_KEY) are its own, and
    // a text dictionary has no reader for them. An empty one is the spelling it had before
    // (heldTextSpelling). One this cannot spell so is the object bag less the two keys, which is
    // what every one went into a text dictionary as before #87 read IsEnum.
    if (isEnumBag(o)) {
        const held = heldTextSpelling(o, place, at);
        if (held !== undefined) {
            return held;
        }
        const spelled = enumTextForm(o);
        if (spelled) {
            return spelled;
        }
        const bag = { ...o };
        delete bag[ENUM_KEY];
        if (Array.isArray(bag._elements)) {
            bag._elements = bag._elements.map((e) => {
                if (!e || typeof e !== 'object') {
                    return e;
                }
                const element = { ...e };
                delete element[ENUMERATION_KEY];
                return element;
            });
        }
        return textForm(bag, at, place);
    }
    // The Source and PropertyType a binary dictionary's reader keeps of an element's properties
    // (XmlUtils.PROPERTY_SOURCE_KEY), which a text dictionary has no place for: the properties
    // themselves are in the element's `_properties`, and stay there.
    if (Object.prototype.hasOwnProperty.call(o, PROPERTY_SOURCE_KEY)) {
        const element = { ...o };
        delete element[PROPERTY_SOURCE_KEY];
        return textForm(element, at, place);
    }
    let out = null;
    for (const k of Object.keys(o)) {
        const v = o[k];
        const t = k === '_elements' && Array.isArray(v) ? elementsForm(o, at)
            : k === '_properties' && v && typeof v === 'object' && !Array.isArray(v) ? namedForm(v, at)
                : textForm(v, at, place);
        if (t !== o[k]) {
            out = out ?? { ...o };
            out[k] = t;
        }
    }
    return out ?? o;
}
/** The class a raw bag holds, as the XML writers name it in a refusal: 'cell', 'single', 'Simulink.Parameter'. */
function bagClass(o) {
    if (o._type === 'cdata') {
        return complexClassTag(o._class) ?? 'double';
    }
    if (o._array_type === 'Cell' || o._array_type === 'Struct' || o._array_type === 'String') {
        return o._array_type.toLowerCase();
    }
    return typeof o._array_class === 'string' ? o._array_class : 'object';
}
/**
 * The spelling a text dictionary was given, before the binary reader kept what it now keeps, for
 * a value whose spelling there waits on MATLAB reading one back; undefined for every other value.
 * Held where it was, place by place, because it differed by place:
 *
 *   - an empty enumeration array (an enumeration bag with no enumeral): `[]` as a value of its
 *     own, an entry's, and '' as a property or a field, which is what the reader made of it
 *     before it read IsEnum there; in a cell, the bag, as the cell reader has held it since it
 *     read IsEnum. MATLAB's own text dictionary writes `{"_type": "dSomeColors", "_value":
 *     "[]"}` for one, whatever its size.
 *   - a shaped empty char, which the binary reader holds as the shaped char's mxchar literal
 *     with no character (BinarySlddParser.charValue): '', at every place, as it was read;
 *   - any other classed or shaped empty, which the binary reader holds as its class under a
 *     bare `Matrix(…)` header (BinarySlddParser.emptyOf), as each place's old form gave it: at
 *     a property or a field, `[]` for a numeric class and '' for any other; as an entry's
 *     value, what MatlabVariableNode.serializeValue made of the entry's `{_type, _emptyDims}`
 *     (entryEmptyText); in a cell, the header as read, which the cell reader always gave, but
 *     for a logical 0x0, which it held as `{_type: 'logical', _value: '[]'}`. MATLAB's own text
 *     dictionary writes `{"_type": "int16", "_value": "[]"}` for an int16 0x0 property and `[]`
 *     for an empty Simulink.BusElement array; how it reads a shaped one back is the open
 *     question.
 *
 * Each is one the binary reader says it read: an enumeration value by its keys (XmlUtils.ENUM_KEY),
 * an empty by its own (XmlUtils.BINARY_EMPTY_KEY), which is gone from what this returns, the
 * header kept as read included. The same spelling without that key is a text dictionary's own,
 * written by MATLAB or by this package, and is never asked here: it is written as it is held,
 * pasted, copied out of the text dictionary and back, or re-read from it.
 */
function heldTextSpelling(o, place, at) {
    if (isEnumBag(o)) {
        if (!Array.isArray(o._elements) || o._elements.length > 0) {
            return undefined;
        }
        return place === 'value' ? [] : place === 'named' ? '' : undefined;
    }
    const header = { ...o };
    delete header[BINARY_EMPTY_KEY];
    if (o._type === 'mxchar') {
        return '';
    }
    const dims = bareEmptyDims(o);
    if (!dims) {
        return header;
    }
    switch (place) {
        case 'named':
            return NUMERIC_CLASS.test(o._type) ? [] : '';
        case 'value':
            return entryEmptyText(o._type, dims, at);
        case 'cell':
            return o._type === 'logical' && dims.length === 2 && dims[0] === 0 && dims[1] === 0 ? { _type: 'logical', _value: '[]' } : header;
        default:
            return header;
    }
}
/**
 * What a text dictionary was given for an entry's classed or shaped empty while the binary
 * reader held one as `{_type, _emptyDims}` (MatlabVariableNode.serializeValue): an N-D one as
 * its MAT stream, as MATLAB writes every N-D value there, and refused, said where it stands, when
 * its dims are past what a stream can say; `[]` for one of rank 2, and for an N-D one of a class
 * no MAT stream holds.
 */
function entryEmptyText(cls, dims, at) {
    if (dims.length <= 2) {
        return [];
    }
    try {
        return { _type: 'cdata', _value: encodeCdata({ name: '', className: cls, dimensions: dims, isComplex: false, isLogical: cls === 'logical', value: [], fields: null }) };
    }
    catch (e) {
        if (e instanceof MatBudgetError) {
            throw new MatBudgetError(e.message, at + e.at, e.what, undefined, e.reason);
        }
        if (e instanceof MatWriteError) {
            return [];
        }
        throw e;
    }
}
/**
 * An enumeration value as MATLAB writes one in a text dictionary, or null for one it cannot be
 * spelled as here. MATLAB states the whole value as one element holding the numbers its
 * enumerals stand for, in their underlying class and spelled as a value of that class is, under
 * `_enum_value`, and the bag around it is 1x1 whatever the size of the value:
 *
 *   gearValue   {"_array_class": "GearMode", "_dimensions": [1, 1], "_elements": [{"_enum_value":
 *               {"_type": "int32", "_value": "-1"}, "_id": "1"}], "_mw_element_type": "MATLABArray"}
 *   gearRow     the same around {"_type": "int32", "_value": "[0, 1, -1]"}, a 1x3
 *   a 7x1       {"_type": "uint8", "_value": "Matrix(7,1)\n[0U, 0U, 0U, 0U, 0U, 0U, 0U]"}
 *   matEnum3D   {"_type": "cdata", "_value": …}, a 2x2x2's MAT stream of int32, as for any N-D value
 *
 * read off custom_object_text.sldd, dNJSON_SLDDApi.sldd and a customer dictionary, each the twin
 * of a binary dictionary holding the same values. The binary reader holds each enumeral's
 * `EnumerationType` and its number as MATLAB wrote them (XmlUtils.ENUMERATION_KEY), in MATLAB's
 * column-major order, and those are the whole of it: the enumeral's name is not in the text form,
 * which names the class alone. No `_id` is written, as for every object this package writes into
 * a text dictionary (SimulinkObjectNode._defaultRawVal). MATLAB writes the element without the
 * bag at an object's property, `{"_enum_value": …, "_id": "2", "_object_class": "GearMode"}`,
 * and the bag without its `_mw_element_type` at a struct field; this writes the bag at every
 * place, as it writes every object out of a binary dictionary at every place.
 *
 * Null when an enumeral lacks its type or number, when they disagree on the type, when the type is
 * not an integer class (the only kind the corpus shows MATLAB spelling, and a double's or a
 * logical's spelling here is unattested), when the size is not the count of enumerals, and for
 * an empty one, whose spelling waits on MATLAB reading one back (heldTextSpelling).
 */
function enumTextForm(o) {
    const elements = Array.isArray(o._elements) ? o._elements : [];
    const dims = Array.isArray(o._dimensions) ? o._dimensions : null;
    if (elements.length === 0 || !dims || dims.length < 2 || !dims.every((d) => typeof d === 'number' && Number.isInteger(d) && d >= 0)) {
        return null;
    }
    let type = null;
    const tokens = [];
    for (const e of elements) {
        const enumeral = e && typeof e === 'object' ? e[ENUMERATION_KEY] : undefined;
        if (!enumeral || typeof enumeral.type !== 'string' || typeof enumeral.value !== 'string') {
            return null;
        }
        if (type !== null && enumeral.type !== type) {
            return null;
        }
        type = enumeral.type;
        tokens.push(enumeral.value.trim());
    }
    const shape = effectiveDims(dims);
    if (type === null || !INTEGER_CLASS.test(type) || elementCountOf(shape) !== tokens.length || !tokens.every((t) => /^-?\d+$/.test(t))) {
        return null;
    }
    const exact = needsExactInt(type);
    const rowMajor = transposeFromColumnMajorND(tokens.map((t) => (exact ? t : Number(t))), shape);
    let value;
    if (shape.length > 2) {
        try {
            value = { _type: 'cdata', _value: encodeCdata({ name: '', className: type, dimensions: shape, isComplex: false, isLogical: false, value: rowMajor, fields: null }) };
        }
        catch (e) {
            if (e instanceof MatWriteError && !(e instanceof MatBudgetError)) {
                return null;
            }
            throw e;
        }
    }
    else {
        value = { _type: type, _value: shape[0] === 1 && shape[1] === 1 ? formatNumLiteral(rowMajor[0], type) : formatMatrixSerial(rowMajor, shape, type) };
    }
    const out = {};
    if (o._array_class !== undefined) {
        out._array_class = o._array_class;
    }
    out._dimensions = [1, 1];
    out._elements = [{ _enum_value: value }];
    if (o._mw_element_type !== undefined) {
        out._mw_element_type = o._mw_element_type;
    }
    return out;
}
const INTEGER_CLASS = /^u?int(?:8|16|32|64)$/;
/** Dims less the trailing singletons past the second, as MATLAB's size() states them. */
function effectiveDims(dims) {
    const d = dims.slice();
    while (d.length > 2 && d[d.length - 1] === 1) {
        d.pop();
    }
    return d;
}
const NUMERIC_CLASS = /^(?:double|single|u?int(?:8|16|32|64))$/;
/**
 * The extents of a classed empty as the binary reader holds one, its class under a bare
 * `Matrix(…)` header with a 0 among them (BinarySlddParser.emptyOf, XmlUtils.emptyHeaderDims), or
 * null.
 */
function bareEmptyDims(o) {
    return typeof o._type === 'string' ? emptyHeaderDims(o._value) : null;
}
/** textDictionaryForm over a record of named values — an object's properties, a struct's fields — each at `.name`. */
function namedForm(named, at) {
    let out = null;
    for (const name of Object.keys(named)) {
        const t = textForm(named[name], at + '.' + name, 'named');
        if (t !== named[name]) {
            out = out ?? { ...named };
            out[name] = t;
        }
    }
    return out ?? named;
}
/**
 * textDictionaryForm over the `_elements` of a raw bag, each at its MATLAB path: `{k}` in
 * a cell, and in a struct or object array `(k)`, unless it is the only element, before the
 * field or the property.
 */
function elementsForm(o, at) {
    const elements = o._elements;
    let changed = false;
    const out = elements.map((e, k) => {
        let t;
        if (o._array_type === 'Cell') {
            t = textForm(e, at + '{' + (k + 1) + '}', 'cell');
        }
        else {
            const here = at + (elements.length > 1 ? '(' + (k + 1) + ')' : '');
            // A struct element is its fields, each a value of its own; an object's, its id and
            // its `_properties`.
            t = e && typeof e === 'object' && !Array.isArray(e) && o._array_type === 'Struct'
                ? namedForm(e, here)
                : textForm(e, here, 'element');
        }
        changed = changed || t !== e;
        return t;
    });
    return changed ? out : elements;
}
//# sourceMappingURL=MatWriter.js.map