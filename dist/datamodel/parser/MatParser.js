// Copyright 2026 The MathWorks, Inc.
import { inflateZlib } from './Inflate.js';
import { exactInt } from './XmlUtils.js';
import { reasonOf } from './ParseWarning.js';
import { isObjectHandle, objectHandleFromValue } from './McosHandle.js';
import { emptySparse, unbackedColumns } from './SparseData.js';
import { setOwn } from './ownKeys.js';
const CLASS_NAMES = {
    1: 'cell', 2: 'struct', 3: 'object', 4: 'char',
    5: 'sparse', 6: 'double', 7: 'single', 8: 'int8',
    9: 'uint8', 10: 'int16', 11: 'uint16', 12: 'int32',
    13: 'uint32', 14: 'int64', 15: 'uint64'
};
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
const MI_COMPRESSED = 15;
const MI_UTF8 = 16;
const MI_UTF16 = 17;
// The array class of a single (mxSINGLE_CLASS), whose elements are read as MATLAB spells them
// (singleDigits).
const MX_SINGLE_CLASS = 7;
function align8(n) {
    return n + ((8 - (n % 8)) % 8);
}
// Every byte count in a MAT-file is self-declared, and nothing downstream
// re-checks it: `bytes` becomes a DataView index, a Uint8Array length, and a loop
// bound. A truncated download or a hand-edited file therefore used to throw a bare
// RangeError ("Offset is outside the bounds of the DataView") straight out of the
// reader, and no caller catches it — parseMat is called unguarded from
// DataModel.addMatSource, so one bad length failed the whole open rather than the
// one variable. Clamping here fixes every such site at once, because all of them
// take their length from this one function.
//
// A tag that does not itself fit is reported as a zero-length element, which ends
// the containing loop on the next `offset < end` check.
function readSubelement(view, offset) {
    if (offset < 0 || offset + 8 > view.byteLength) {
        // dataOffset stays inside the view even here: callers pass it straight to
        // `new Uint8Array(buffer, dataOffset, bytes)`, which rejects an out-of-range
        // offset even when the length is 0.
        return { type: 0, bytes: 0, dataOffset: Math.max(0, Math.min(offset, view.byteLength)), totalSize: 8 };
    }
    const tag = view.getUint32(offset, true);
    const hi = (tag >>> 16) & 0xFFFF;
    const lo = tag & 0xFFFF;
    if (hi !== 0 && lo !== 0) {
        // Small-element form: the payload lives in the tag's own upper 4 bytes.
        return { type: lo, bytes: Math.min(hi, 4), dataOffset: offset + 4, totalSize: 8 };
    }
    const type = view.getUint32(offset, true);
    const declared = view.getUint32(offset + 4, true);
    const bytes = Math.min(declared, Math.max(0, view.byteLength - (offset + 8)));
    return { type, bytes, dataOffset: offset + 8, totalSize: 8 + align8(bytes) };
}
const ELEMENT_WIDTH = {
    [MI_INT8]: 1, [MI_UINT8]: 1, [MI_INT16]: 2, [MI_UINT16]: 2,
    [MI_INT32]: 4, [MI_UINT32]: 4, [MI_SINGLE]: 4,
    [MI_DOUBLE]: 8, [MI_INT64]: 8, [MI_UINT64]: 8
};
// One numeric payload, element by element. The return type is `(number | string)[]`
// because MATLAB's 64-bit integers do not fit a double: the two arms below read them as
// `bigint` and hand them to `exactInt`, which keeps a number where a double is lossless
// and falls back to the canonical decimal TEXT where it is not — the same representation
// the text and binary dictionary readers already carry (XmlUtils.parseExactNum, defects
// 29 and 30) and the same one MatWriter already writes back.
//
// This used to be `number[]`, built with `Number(view.getBigUint64(...))`, and the cast
// was not a nit: `maxU64` read back as 18446744073709552000, which is not merely rounded
// but OUT of uint64 range. It also silently corrupted the `string` payload cell, where
// four UTF-16 code units share one uint64 and the rounding lands in the LOW bits — that
// is, on the FIRST character of every group of four ("café" -> "`afé"). See
// test/parity/matlab/STRING_MCOS.md.
//
// `single` is whether the array is of class single (C-033): each miSINGLE element is then the
// decimal MATLAB spells that float32 with (singleDigits), and not the double getFloat32 widens
// it to. Any other class reads an miSINGLE element as that double, which for a double stored
// in four bytes is its value.
function readNumericArray(view, sub, count, single = false) {
    const values = [];
    const off = sub.dataOffset;
    // `count` comes from the array's DECLARED dimensions, which a truncated or
    // hand-corrupted file can inflate past the bytes actually present. Reading on
    // regardless throws a bare RangeError out of the DataView, which no caller
    // catches — a single bad byte range would take down the whole open. Clamp to
    // what the payload and the buffer really hold and return a short array; the
    // node layer already renders fewer elements than the dimensions claim.
    //
    // A payload of a type with no width holds no element this can read, so none is read.
    // Its `default` arm used to push a 0 for each DECLARED element, the one count here no
    // byte bounded: a 64-byte variable read as a million zeros, and a 4 KB file of 60 ran a
    // 512 MB heap out. The full-array arm of parseMatrix records such a payload as not
    // decoded (unreadablePart). A sparse array's pr of such a type holds no non-zero, as
    // before: readSparse's `keep` reads a value that is not there as 0, and drops a 0.
    const width = ELEMENT_WIDTH[sub.type];
    if (!width) {
        return values;
    }
    const available = Math.min(sub.bytes, Math.max(0, view.byteLength - off));
    count = Math.min(count, Math.floor(available / width));
    for (let i = 0; i < count; i++) {
        switch (sub.type) {
            case MI_DOUBLE:
                values.push(view.getFloat64(off + i * 8, true));
                break;
            case MI_SINGLE: {
                const x = view.getFloat32(off + i * 4, true);
                values.push(single ? singleDigits(x) : x);
                break;
            }
            case MI_INT8:
                values.push(view.getInt8(off + i));
                break;
            case MI_UINT8:
                values.push(view.getUint8(off + i));
                break;
            case MI_INT16:
                values.push(view.getInt16(off + i * 2, true));
                break;
            case MI_UINT16:
                values.push(view.getUint16(off + i * 2, true));
                break;
            case MI_INT32:
                values.push(view.getInt32(off + i * 4, true));
                break;
            case MI_UINT32:
                values.push(view.getUint32(off + i * 4, true));
                break;
            case MI_INT64:
                values.push(exactInt(view.getBigInt64(off + i * 8, true)));
                break;
            case MI_UINT64:
                values.push(exactInt(view.getBigUint64(off + i * 8, true)));
                break;
        }
    }
    return values;
}
/**
 * A single as the decimal MATLAB spells it with, measured (R2027a): C's `%.6g` where that is
 * the same float32, and otherwise `%.9g`, which always is — or `%.10g` for realmax('single'),
 * whose `%.9g` is past it. Six is FLT_DIG, the digits every float32 holds, and nine
 * FLT_DECIMAL_DIG, the digits that name any one; MATLAB writes a double by the same rule at
 * fifteen and seventeen (a binary dictionary holds 1/3 as 0.33333333333333331).
 *
 * getFloat32 hands back the double of the same value, and every number here prints as the
 * shortest text of its DOUBLE: single(3.3) is the double 3.299999952316284, and showed so,
 * where both dictionaries hold MATLAB's own text for the same value, `3.3` (the corpus
 * twins param_vars.mat / param_json.sldd, P30_TypeMaxUnitDesc; DESIGN.md recorded the
 * difference as a limitation). It is not "the shortest decimal that is the same float32":
 * MATLAB writes single(1/3) as 0.333333343, where 0.33333334 would do, and the smallest
 * subnormal as 1.4013e-45, where 1e-45 would. make_typed_fixtures.m's sSingleSweep, 4,082
 * float32 bit patterns from the smallest subnormal to realmax, holds MATLAB's text for each
 * in a text dictionary (its binary format writes the same digits, measured), and this rule
 * gives every one, where the shortest would differ on 3,520 (typedMcosFixtures.test.ts). It
 * also gives every one of the 127,743 non-zero singles a customer text dictionary in the
 * corpus holds.
 *
 * Lossless: the number is the same float32, so MatWriter's setFloat32 writes back the bits
 * that were read, and a text dictionary's `0.333333343F` names them too. An infinity, a NaN
 * and either zero are themselves.
 */
function singleDigits(x) {
    if (!Number.isFinite(x) || x === 0) {
        return x;
    }
    const ax = Math.abs(x);
    let six = roundedDigits(ax, 6);
    if (Number.isNaN(six)) {
        six = Math.abs(Number(x.toPrecision(6)));
    }
    if (Math.fround(six) === ax) {
        return x < 0 ? -six : six;
    }
    const nine = roundedDigits(ax, 9);
    if (!Number.isNaN(nine)) {
        return x < 0 ? -nine : nine;
    }
    const text = toPrecisionHalfEven(x, 9);
    return Math.abs(text) > FLT_MAX ? toPrecisionHalfEven(x, 10) : text;
}
// The largest finite single, realmax('single').
const FLT_MAX = 3.4028234663852886e38;
const POWERS_OF_TEN = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12];
/**
 * The positive single `ax` to `p` significant digits, an exact tie to the even digit, by
 * arithmetic that is exact: `ax * 10^j` is, for a float32 and 0 <= j <= 12 (24 bits of
 * mantissa by at most 28 of 5^12 fit a double's 53), so it is rounded as the exact value is,
 * and `n / 10^j` is the double nearest that decimal. NaN where `j` would fall outside that
 * range — a single of 1e9 or more, or under 1e-4 for nine digits and 1e-7 for six — which
 * toPrecisionHalfEven reads instead. The same numbers (every 31st float32 bit pattern, both
 * signs, compared), in a fifth of the time: singleDigits runs once per element, and a million
 * singles took 400 ms by toPrecision alone and take 75 ms so, against 8 ms for the bare read.
 */
function roundedDigits(ax, p) {
    let j = p - 1 - Math.floor(Math.log10(ax));
    if (j < 0 || j > 12) {
        return NaN;
    }
    let y = ax * POWERS_OF_TEN[j];
    // log10 can land a hair either side of an exponent: then `y` has a digit too many or too
    // few, and the scale moves one place.
    if (y >= POWERS_OF_TEN[p]) {
        if (j === 0) {
            return NaN;
        }
        y = ax * POWERS_OF_TEN[--j];
    }
    else if (y < POWERS_OF_TEN[p - 1]) {
        if (j === 12) {
            return NaN;
        }
        y = ax * POWERS_OF_TEN[++j];
    }
    const whole = Math.floor(y);
    const rest = y - whole;
    const n = rest > 0.5 || (rest === 0.5 && whole % 2 === 1) ? whole + 1 : whole;
    return n / POWERS_OF_TEN[j];
}
/**
 * `x` to `p` significant digits as C's printf rounds it: to the nearer, and an exact tie to
 * the EVEN digit. toPrecision takes the one farther from zero at a tie, so single(1000000.125)
 * came out 1000000.13 where MATLAB writes 1000000.12 (typed_mcos.sldd's sSingleTies). Only a
 * value of exactly `p + 1` significant digits, the last a 5, is a tie; toPrecision's own text
 * of it at `p + 1` digits is then that 5, which is what is looked for before the exact digits
 * are.
 */
function toPrecisionHalfEven(x, p) {
    const away = x.toPrecision(p);
    if (!/5(?:e|$)/.test(x.toPrecision(p + 1))) {
        return Number(away);
    }
    // Every significant digit of `x` up to a hundred, which a tie at ten has all of.
    const digits = x.toPrecision(100).replace(/e.*$/, '').replace(/[-.]/g, '').replace(/^0+/, '');
    if (digits[p] !== '5' || !/^0*$/.test(digits.slice(p + 1))) {
        return Number(away);
    }
    // An exact tie, which goes to the even neighbour: the one nearer zero, `x` cut to `p`
    // digits, when the last of those is even, and `away` when it is odd. The nearer one is
    // read off a number just inside the tie: 2^-45 of `x` moves a double, and is far less
    // than half a unit in a tenth digit.
    return Number(digits[p - 1]) % 2 === 0 ? Number((x * (1 - 2 ** -45)).toPrecision(p)) : Number(away);
}
// Why the numeric part whose tag is at `at` holds none of the `count` elements its array
// declares, or null when it holds what its bytes do. Either its tag is cut short by the end of
// the bytes, which readSubelement reports as a tag of type 0, or its type has no width: in both
// readNumericArray reads nothing, so there is no value to give, and the variable is recorded as
// the reader's other refusals are rather than read as the zeros it was. An array declaring no
// element holds all of it whatever the type, which is [].
function unreadablePart(view, at, sub, count, part) {
    if (!(count > 0) || ELEMENT_WIDTH[sub.type]) {
        return null;
    }
    if (at + 8 > view.byteLength) {
        const there = Math.max(0, view.byteLength - at);
        return 'the bytes end ' + there + (there === 1 ? ' byte' : ' bytes') + ' into its ' + part + "'s 8-byte tag";
    }
    return 'its ' + part + ' is of MAT data type ' + sub.type + ', which has no element width, so none of its '
        + count + ' elements can be read';
}
function readString(view, sub) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset + sub.dataOffset, sub.bytes);
    return new TextDecoder().decode(bytes).replace(/\0/g, '');
}
// MATLAB stores array data column-major; the data model reads it row-major. A
// vector needs no reordering, which is why a singleton dimension returns as-is.
//
// An N-D array is a stack of rows x cols pages, each stored column-major in turn,
// so every page gets transposed. Handling only the first page (and sizing the
// result to rows*cols) used to leave the rest as holes in a sparse array — and
// because Array.prototype.forEach skips holes, the node layer then built children
// for only the first page: half of a 2x3x2 lost its values with no error anywhere.
// Starting from a copy is what guarantees no element can go missing, whatever the
// declared dimensions turn out to be.
function transposeFromColMajor(values, dimensions) {
    if (values.length <= 1) {
        return values;
    }
    const rows = dimensions[0];
    const cols = dimensions[1];
    if (rows <= 1 || cols <= 1) {
        return values;
    }
    const page = rows * cols;
    const result = values.slice();
    for (let base = 0; base + page <= values.length; base += page) {
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                result[base + r * cols + c] = values[base + c * rows + r];
            }
        }
    }
    return result;
}
// The `value` of a variable whose class is recognized and whose payload was not
// read — see MatVariable.undecoded.
//
// `<3000x4000 double, not decoded>`: deliberately the angle-bracket summary spelling of
// src/datamodel/display/DisplayConvention.ts (`summaryForm`), because that spelling
// is what makes a consumer render the cell gray/italic AND withhold the editor
// (BaseNode.valueEditable tests for the brackets). The reason is appended rather
// than left off: a bare `<1x1 object>` reads as an ordinary summary of a value that
// decoded fine and is one click from its elements, which is exactly the wrong thing
// to say about a value that has none. Spelled here rather than imported because no
// parser in this package imports the display layer, and one string is not worth
// being the first. Exported for the node layer, which spells the same placeholder for a value
// this reader left null (MatlabVariableNode._createFromMatNumeric).
export function undecodedValue(dimensions, className) {
    // MATLAB's own size() is always at least 2-D, and so is every dims array a
    // real file carries; a shorter one means the dims subelement was truncated.
    const shape = dimensions.length >= 2 ? dimensions : [1, dimensions[0] || 1];
    return '<' + shape.join('x') + ' ' + className + ', not decoded>';
}
// A sparse array's `value`: its summary, `<10000000x2 sparse double>` — the spelling of
// DisplayConvention.sparseSummaryForm, spelled here for the reason undecodedValue gives.
function sparseValue(dimensions, className) {
    const shape = dimensions.length >= 2 ? dimensions : [1, dimensions[0] || 1];
    return '<' + shape.join('x') + ' sparse ' + className + '>';
}
// Past this many DECLARED elements, an array whose bytes cannot hold that many is recorded
// rather than read (the guard in parseMatrix): the node layer builds one row per declared
// element, so a dims word of 0x7FFFFFFF in a two-element struct array — one corrupted byte
// of a dictionary's hex value — ran the heap out and took the process with it. A sparse
// array is not subject to it: what it holds is its non-zeros, read from the bytes, at any
// declared size (readSparse).
//
// The number is a judgment call: 1e6 doubles is an 8 MB array, roughly a 1000x1000
// matrix, and below it a short array stays the clamped read it always was. It was the
// limit past which a sparse array, too, was refused, until a sparse array stopped being
// held as its dense form.
const MAX_UNBACKED_ELEMENTS = 1000000;
// Past this many elements a struct array with no fields has no element rows in the node layer
// (MatlabVariableNode._createFromMatStruct): MAX_EXPANDED_ELEMENTS, its row cap, restated here
// because this folder imports nothing from display/ (test/moduleBoundaries.test.ts), and held
// to it by test/matStructArray.test.ts, which asks each route at the cap and one past it.
const MAX_LAID_OUT_FIELDLESS = 10000;
// How many levels of struct fields and cell elements parseMatrix reads, the variable itself the
// first: the value at the next level down is recorded rather than read (the cap in parseMatrix).
// parseMatrix recurses into each field and element, and it had no bound but the call stack: a
// 1x1 cell nested about 1,600 deep, a 77 KB file, threw "Maximum call stack size exceeded" out
// of parseMat and refused the whole .mat. Where the stack ran out moved with the engine, the
// thread and the JIT (on half node's default stack a 900-deep cell failed to open and a
// 1,000-deep one opened); a cap is the same on all of them.
//
// 128 is dex-core's mat5::MAX_NESTING, and 21 times the deepest variable in the corpus (6
// levels, across 58 .mat files and 151 .slx workspaces). What walks a MatVariable after this
// reader (collectUndecoded, the node layer, MatWriter) recurses too, and stops where this does,
// at a value with nothing under it.
export const MAX_NESTING = 128;
/**
 * Whether `v` is a struct array whose elements nothing reads one by one: one this reader
 * recorded without decoding (`undecoded`), or one with no fields declaring more than
 * MAX_LAID_OUT_FIELDLESS elements, which the node layer shows as its summary alone and the
 * guard in parseMatrix leaves be, such an element taking no bytes. Either is all declared size,
 * so a reader that lays a struct out an element at a time lays out what no byte holds:
 * McosParser's, for an object's property, built one bag per element and StructNode a row per
 * bag, and a Parameter whose Value was repmat(struct(), 1, 1e6) ran a 512 MB heap out.
 * Such a struct keeps the bytes it was read from wherever it is read (a cell element too,
 * below), and is handed over as those.
 */
export function isUnheldStructArray(v) {
    if (v.className !== 'struct') {
        return false;
    }
    if (v.undecoded) {
        return true;
    }
    const count = (v.dimensions || []).reduce((a, b) => a * b, 1);
    return count > MAX_LAID_OUT_FIELDLESS && Object.keys(v.fields || {}).length === 0;
}
/**
 * How many elements of struct array `v` this reader holds: as many as the longest of its
 * fields' lists, which hold one entry per element read (parseMatrix's struct arm), and never
 * more than it declares. An element of a struct with fields takes the bytes of its fields'
 * matrices, so a struct array whose bytes ran out holds fewer elements than it declares, and
 * a reader that lays it out an element at a time lays out the ones it holds: MATLAB writes
 * every field of every element, so for an array it wrote that is every element it declares.
 * A struct with no fields holds every element it declares, an element of one taking no bytes,
 * and so does one with a field held as a single variable rather than a list, which this
 * reader writes for a 1x1 alone and a reader of an array takes for every element's.
 */
export function structElementsHeld(v) {
    const count = (v.dimensions || []).reduce((a, b) => a * b, 1);
    const lists = Object.values(v.fields || {});
    if (lists.length === 0 || lists.some((list) => !Array.isArray(list))) {
        return count;
    }
    let held = 0;
    for (const list of lists) {
        held = Math.max(held, list.length);
    }
    return Math.min(count, held);
}
// The non-zeros of a sparse array, as MATLAB's find() lists them: column by column, and
// within a column by row. Subelement layout, from the MAT-file format spec (Level 5,
// sparse arrays) — the two index arrays sit between the name and the payload, where a
// full array has nothing:
//
//   array flags   miUINT32   8 bytes            byte 0 class (5), byte 1 flags,
//                                               BYTES 4-7 nzmax (uint32)
//   dimensions    miINT32    4 * ndims          rows, cols
//   array name    miINT8     len(name)
//   ir            miINT32    4 * nzmax          0-based ROW index of each non-zero,
//                                               in column-major order
//   jc            miINT32    4 * (cols + 1)     jc[j] is the ir/pr index where
//                                               column j starts, so column j holds
//                                               ir[jc[j] .. jc[j+1]-1]; jc[cols] is
//                                               the non-zero count
//   pr            numeric    width * nnz        the non-zeros themselves
//   pi            numeric    width * nnz        present iff the complex flag is set
//
// Every count above is taken from the subelement's OWN tag, as everywhere else in
// this reader, because that is the number of bytes actually present; nzmax and
// cols + 1 are used only to clamp, never to extend.
//
// nzmax is CAPACITY, not content, and that is the distinction the reader has to keep:
// `spalloc` reserves it, so a legal file can carry nzmax 10 — and therefore ten ir
// entries and ten pr values — while holding two non-zeros, with the unused eight of
// each being whatever was in the reserved space. jc is what says which are real: the
// column walk below visits only ir[jc[0] .. jc[cols]-1], so the reserved tail is
// never read as a value. An implementation that zipped ir with pr directly, or that
// took ir.length for the non-zero count, would put that tail in the matrix.
//
// Nothing here is sized by the DECLARED shape, because nothing else bounds it: the walk
// covers the columns jc actually holds, and an index array is read only as the integers
// MATLAB writes it as. A dims word of 0x7FFFFFFF — one corrupted byte of a hex value —
// would otherwise walk two billion columns, or allocate two billion zeros for a jc of a
// type with no width (readNumericArray reads one of those as `count` zeros).
//
// What comes back is what MATLAB's find() would say of the matrix the bytes describe,
// which a file MATLAB wrote already is and a hand-made one may not be: a row index
// outside the declared rows is dropped, rows repeated within a column keep the LAST value
// (as the dense scatter this replaced had it), rows out of order are sorted, and a stored
// zero is not a non-zero.
// `single` is whether the array is of class single, whose non-zeros are read as a full
// single array's are (readNumericArray).
function readSparse(view, offset, end, dimensions, isComplex, nzmax, single) {
    const rows = Math.max(0, dimensions[0] || 0);
    const cols = Math.max(0, dimensions[1] || 0);
    // Each of the four reads is guarded by the END OF THIS ELEMENT, the same way the
    // full-array branch guards its real and imaginary payloads. A variable truncated
    // after its indices — or after its dimensions — leaves the arrays below empty
    // rather than reading the next variable's tag as this one's data, and every empty
    // one degrades cleanly: no ir means no non-zeros, so the matrix comes back all
    // zeros, which is the honest reading of a sparse array whose non-zeros are absent.
    let ir = [];
    if (offset < end) {
        const irSub = readSubelement(view, offset);
        offset += irSub.totalSize;
        if (INTEGER_DATA_TYPES.has(irSub.type)) {
            // At the type's own width: counted at four bytes apiece, an ir of miUINT8 read
            // none of its rows and one of miINT16 half of them.
            const irCount = Math.floor(irSub.bytes / ELEMENT_WIDTH[irSub.type]);
            ir = readNumericArray(view, irSub, nzmax > 0 ? Math.min(nzmax, irCount) : irCount).map(Number);
        }
    }
    let jc = [];
    if (offset < end) {
        const jcSub = readSubelement(view, offset);
        offset += jcSub.totalSize;
        if (INTEGER_DATA_TYPES.has(jcSub.type)) {
            jc = readNumericArray(view, jcSub, cols + 1).map(Number);
        }
    }
    // nnz is jc[cols] BY DEFINITION — the column-start array ends with the total —
    // and it is what pr's length must be read against. A jc that came back short was
    // truncated, so its last entry is not the total and ir's own length is the better
    // answer.
    const nnz = Math.max(0, Math.min(jc.length === cols + 1 ? jc[cols] : ir.length, ir.length));
    let pr = [];
    if (offset < end) {
        const prSub = readSubelement(view, offset);
        offset += prSub.totalSize;
        pr = readNumericArray(view, prSub, nnz, single);
    }
    let pi = [];
    if (isComplex && offset < end) {
        const piSub = readSubelement(view, offset);
        offset += piSub.totalSize;
        pi = readNumericArray(view, piSub, nnz, single);
    }
    // At most nnz entries, which ir's own bytes bound.
    const rowOut = new Int32Array(nnz);
    const colOut = new Int32Array(nnz);
    const reOut = new Float64Array(nnz);
    const imOut = isComplex ? new Float64Array(nnz) : null;
    let n = 0;
    const keep = (row, col, k) => {
        const re = Number(pr[k] ?? 0);
        const im = isComplex ? Number(pi[k] ?? 0) : 0;
        // `!== 0` is true of NaN and false of -0, which is MATLAB's rule for both.
        if (re === 0 && im === 0) {
            return;
        }
        rowOut[n] = row;
        colOut[n] = col;
        reOut[n] = re;
        if (imOut) {
            imOut[n] = im;
        }
        n++;
    };
    const walked = Math.min(cols, Math.max(0, jc.length - 1));
    for (let col = 0; col < walked; col++) {
        const from = Math.max(0, jc[col]);
        const to = Math.min(jc[col + 1], nnz);
        if (!(to > from)) {
            continue;
        }
        // MATLAB's own column: every row in range, ascending, none twice — kept as it is.
        let ordinary = true;
        for (let k = from, last = -1; k < to && ordinary; k++) {
            ordinary = ir[k] > last && ir[k] < rows;
            last = ir[k];
        }
        if (ordinary) {
            for (let k = from; k < to; k++) {
                keep(ir[k], col, k);
            }
            continue;
        }
        // Anything else: a row outside the declared rows dropped, as a corrupt file and not
        // a value — kept, it would land in another column or past the array's own
        // dimensions — and each remaining row once, at the last entry naming it, in order.
        const lastEntry = new Map();
        for (let k = from; k < to; k++) {
            if (ir[k] >= 0 && ir[k] < rows) {
                lastEntry.set(ir[k], k);
            }
        }
        for (const row of [...lastEntry.keys()].sort((a, b) => a - b)) {
            keep(row, col, lastEntry.get(row));
        }
    }
    return {
        row: rowOut.slice(0, n),
        col: colOut.slice(0, n),
        re: reOut.slice(0, n),
        im: imOut ? imOut.slice(0, n) : null,
        // The columns whose starts jc held, which for a file MATLAB wrote is all of them; a
        // dims word that declares more is damaged (SparseData.backedColumns).
        backedColumns: walked,
    };
}
// A class-17 (MCOS opaque) element is four parts after its array flags: the variable
// name, the type-system marker ("MCOS"), the class name, and the object handle — a
// complete miMATRIX holding the uint32 words McosHandle.ts describes.
function parseOpaque(view, offset, end) {
    const nameSub = readSubelement(view, offset);
    offset += nameSub.totalSize;
    const name = readString(view, nameSub);
    const markerSub = readSubelement(view, offset);
    offset += markerSub.totalSize;
    const classSub = readSubelement(view, offset);
    offset += classSub.totalSize;
    const className = readString(view, classSub);
    const variable = {
        name, className, dimensions: [1, 1], isComplex: false, isLogical: false, value: null, fields: null, isOpaque: true,
        mcosHandle: readOpaqueHandle(view, offset, end),
    };
    if (variable.mcosHandle === null) {
        const instance = readEnumerationInstance(view, offset, end);
        if (instance) {
            enumerationInstances.set(variable, instance);
        }
    }
    return variable;
}
// What an enumeration value's class-17 element holds in place of an object handle, by the
// variable parseOpaque made of the element. MATLAB writes the fourth part of an enumeration
// value's element as a 1x1 struct, not the uint32 handle every other object has:
//
//   EnumerationInstanceTag  0xDD000000
//   ClassName               the class's row in the subsystem's class table
//   ValueNames              the string-table index of each enumeral the value uses, Kx1
//   Values                  a Kx1 cell, an object handle per enumeral
//   ValueIndices            the value's own size, each element the 0-based index of its enumeral
//   BuiltinClassName        the string-table index of the class it derives from, if any
//
// measured on the display catalog's catalog.mat (en_on, en_onoff_vec, en_sl_vec, dx_enum_1x0).
// Held beside the variable, as McosParser reads it (McosParser.enumerationValue), for the reason
// mcosDecodedTable holds the decode beside it: the variable is the host's.
const enumerationInstances = new WeakMap();
/** The enumeration instance struct of `variable`, an opaque parseOpaque read, or undefined. */
export function enumerationInstanceOf(variable) {
    return enumerationInstances.get(variable);
}
// The handle part at `offset`, when it is an enumeration instance struct, or null.
function readEnumerationInstance(view, offset, end) {
    if (offset + 8 > end) {
        return null;
    }
    const sub = readSubelement(view, offset);
    if (sub.type !== MI_MATRIX || sub.dataOffset + sub.bytes > end) {
        return null;
    }
    const flagsSub = readSubelement(view, sub.dataOffset);
    if (flagsSub.bytes < 2 || CLASS_NAMES[view.getUint8(flagsSub.dataOffset)] !== 'struct') {
        return null;
    }
    let instance;
    try {
        instance = parseMatrix(view, sub.dataOffset, sub.bytes);
    }
    catch {
        return null;
    }
    const tag = instance.fields?.EnumerationInstanceTag;
    return tag && !Array.isArray(tag) && tag.className === 'uint32' && tag.value === 0xdd000000 ? instance : null;
}
/**
 * The text of a function handle as MATLAB stores one, `function` of a struct's `function_handle`
 * field with its `type` beside it, or null: as McosParser reads one an object's property holds,
 * and as a .mat holds one in the struct after a class-16 element's name (measured on the display
 * catalog's catalog.mat: fh_sin's `function` 'sin', type 'simple'; fh_anon's 'sf%272@(x)x.^2+1',
 * type 'anonymous', beside the saving MATLAB's matlabroot).
 *
 * An ANONYMOUS handle's `function` is prefixed with the `sf%<n>@` of the scope it was made in,
 * where func2str, MATLAB's display and a text dictionary all say `@(x)x.^2+1`: the prefix goes,
 * and the `@` that opens the anonymous function's own text stays; nothing else is rewritten.
 */
export function functionHandleText(fn, type) {
    if (typeof fn !== 'string') {
        return null;
    }
    return type === 'anonymous' ? fn.replace(/^sf%\d+@/, '@') : fn;
}
// What parseMatrix read of a function handle, by the variable it made of the class-16 element:
// its text, or null for an empty one. Held beside the variable, as an enumeration's instance
// struct is (enumerationInstanceOf). A class-16 element whose text is not where MATLAB writes
// it has none, and is the class this reader does not model, as it always was.
const functionHandles = new WeakMap();
/** The function handle `variable` is, as parseMatrix read it, or undefined. */
export function functionHandleOf(variable) {
    return functionHandles.get(variable);
}
// The text of the function handle whose class-16 element's struct is at `offset`, or null.
function functionHandleElementText(view, offset, end) {
    const sub = readSubelement(view, offset);
    if (sub.type !== MI_MATRIX) {
        return null;
    }
    let outer;
    try {
        outer = parseMatrix(view, sub.dataOffset, Math.min(sub.bytes, end - sub.dataOffset));
    }
    catch {
        return null;
    }
    const field = (v, name) => {
        const f = v?.fields?.[name];
        return f && !Array.isArray(f) ? f : null;
    };
    const fh = field(outer, 'function_handle');
    return functionHandleText(field(fh, 'function')?.value, field(fh, 'type')?.value);
}
// The handle part of a class-17 element, or null when it is not there in the one shape
// a handle has. The part itself has to lie inside the opaque element, and everything
// inside the part is then read through a view of exactly the part: a subelement in it
// that declares more bytes than the part holds is a damaged part, and reading on would
// take the next element's bytes for ids — readSubelement clamps to its view, not to the
// matrix it is reading.
//
// Two checks come BEFORE the words are read:
//
//   - The array class. A handle is a uint32 matrix and nothing else is one. (It also
//     kept a part that is itself a class-17 element from recursing back into parseOpaque
//     while the words went through parseMatrix; they no longer do, so nothing here can
//     recurse at all.)
//   - The data's own type: an integer one. A uint32 array may still have its data stored
//     as doubles, and a fractional id read from there is not a handle MATLAB wrote.
//     objectHandleFromValue refuses a fractional word too; this refuses the storage.
//
// The words are taken in the order they are STORED, which is the order MATLAB reads a
// handle in, whatever shape its matrix declares. They are deliberately not read through
// parseMatrix, whose numeric arm hands a matrix back row-major: harmless for the Nx1
// MATLAB writes, but a matrix declared 2x3 came back transposed, and its words then said
// another rank and other ids — a scalar read as an empty shell, an array as a scalar.
function readOpaqueHandle(view, offset, end) {
    if (offset + 8 > end) {
        return null;
    }
    const handleSub = readSubelement(view, offset);
    if (handleSub.type !== MI_MATRIX || handleSub.dataOffset + handleSub.bytes > end) {
        return null;
    }
    const part = new DataView(view.buffer, view.byteOffset + handleSub.dataOffset, handleSub.bytes);
    const flagsSub = readSubelement(part, 0);
    if (flagsSub.bytes < 2 || CLASS_NAMES[part.getUint8(flagsSub.dataOffset)] !== 'uint32') {
        return null;
    }
    // Array flags, dimensions and name, then the data.
    let at = flagsSub.totalSize;
    const dimsSub = readSubelement(part, at);
    at += dimsSub.totalSize;
    at += readSubelement(part, at).totalSize;
    const dataSub = readSubelement(part, at);
    if (!INTEGER_DATA_TYPES.has(dataSub.type)) {
        return null;
    }
    // As many words as the declared dimensions hold — readNumericArray clamps that to the
    // bytes present — in their linear order.
    let declared = 1;
    for (let i = 0; i + 4 <= dimsSub.bytes; i += 4) {
        declared *= Math.max(0, part.getInt32(dimsSub.dataOffset + i, true));
    }
    const words = readNumericArray(part, dataSub, declared);
    const matrix = {
        name: '', className: 'uint32', dimensions: [words.length, 1], isComplex: false, isLogical: false, value: words, fields: null,
    };
    return isObjectHandle(matrix) ? objectHandleFromValue(words) : null;
}
const INTEGER_DATA_TYPES = new Set([MI_INT8, MI_UINT8, MI_INT16, MI_UINT16, MI_INT32, MI_UINT32, MI_INT64, MI_UINT64]);
// The byte count a struct field or a cell element is parsed with: what its own tag
// declares — except that an MCOS OPAQUE is held to the end of the container holding it.
// An opaque that declares itself longer than its container would otherwise read the
// bytes that follow the container, another element's, as its object handle. In a
// well-formed file every child lies inside its parent, so this changes nothing there.
//
// Only the opaque, deliberately. Bounding every child the same way would also change
// what the LAST element of a cut-short stream reads — a numeric field straddling its
// parent's end is read whole today, and matWriter.test.ts's truncated `structNd` relies
// on that — which is a question about truncation, not about object handles. Only the
// parse is bounded: `_rawBytes` keeps the element's padded size, which the writer replays.
function childLength(view, sub, tagOffset, end) {
    const flagsSub = readSubelement(view, tagOffset + 8);
    const isOpaque = flagsSub.bytes >= 2 && view.getUint8(flagsSub.dataOffset) === 17;
    return isOpaque ? Math.max(0, Math.min(sub.bytes, end - (tagOffset + 8))) : sub.bytes;
}
// How many fields a struct array whose field-name length subelement is at `offset`
// declares, as the struct arm of parseMatrix reads them: one name per stride of the
// name block, the last one however short, and 0 for a stride that is not there or not
// positive. Counting whole strides only, a block shorter than its stride (which MATLAB
// never writes: it pads every name to the stride) counted no field while the arm read
// one, and the array passed the guard below as a fieldless one. 0 too for a length or a
// block whose tag does not lie inside the element: the arm records such a struct, and one
// whose names run on past the element's end, as not decoded, at any size, so the guard
// need not.
function structFieldCount(view, offset, end) {
    if (offset + 8 > end) {
        return 0;
    }
    const lenSub = readSubelement(view, offset);
    const stride = lenSub.bytes >= 4 ? view.getInt32(lenSub.dataOffset, true) : 0;
    const namesAt = offset + lenSub.totalSize;
    if (stride <= 0 || namesAt + 8 > end) {
        return 0;
    }
    return Math.ceil(readSubelement(view, namesAt).bytes / stride);
}
// `depth` is how many levels of struct fields and cell elements lie above this matrix: 0 for a
// variable, and for any other matrix a caller reads on its own (an MCOS subsystem, a MAT stream).
export function parseMatrix(view, baseOffset, length, depth = 0) {
    let offset = baseOffset;
    // The element ends where its length says or where the bytes do, whichever comes first.
    // `length` can be the file's own claim, unchecked: a top-level record's, or the one a
    // compressed record's payload gives its matrix. Every read clamps to the bytes there
    // are (readSubelement, and readNumericArray, which reads none of a payload of a type
    // with no width), but the walk over a struct's or a cell's elements and the
    // declared-size guard below went by the end the claim gave: past the last byte each
    // step read an empty tag and stepped on, up to the half-billion steps a claim of 4 GB
    // allows, and the guard took the claim for bytes left, so a struct array declaring
    // 500,000,000 elements with one element's bytes was not refused, and a host built a row
    // per declared element until the heap ran out. A struct field or a cell element was
    // always bounded so, its length being readSubelement's, which clamps it; a top-level
    // record cut short by the end of the file now reads as one of those does. parseMat
    // says the record, or the payload, was read short.
    const held = Math.max(0, Math.min(length, view.byteLength - baseOffset));
    const end = baseOffset + held;
    // An miMATRIX of no bytes, its tag alone, is an empty array: MATLAB writes some empty
    // struct fields that way (a Simulink Design Verifier sldvData in the corpus holds 19),
    // and reads one back as []. It has no flags to read, and reading on would take them,
    // the dimensions and the name from the element after its tag: those fields came back
    // as doubles of rank 12 to 1,314, which showed [ ] and were copied as an empty of that
    // rank. So it is what a [] MATLAB writes in full reads as.
    //
    // The tag's CLAIM of no bytes, deliberately, not `held`: the claim is MATLAB's spelling of
    // [], and a matrix that claims bytes and holds none (its tag the last 8 bytes of a file or
    // a payload) is one cut short before its array flags, read below as the nameless shell of
    // a class unknown, as one cut inside its flags is. Taken for [], it would be an empty
    // double the bytes never said it is. parseMat keeps either shell as an anonymous variable.
    // Every other caller hands over a length clamped to the bytes, where the claim and `held`
    // are one, but for a struct field or a cell element written in the small-element form,
    // whose claim of up to 4 bytes readSubelement does not clamp: MATLAB writes no matrix that
    // way, and one that is the last 8 bytes is read as cut short too, with the warning a class
    // unknown gets.
    if (length <= 0) {
        return { name: '', className: 'double', dimensions: [0, 0], isComplex: false, isLogical: false, value: [], fields: null };
    }
    const flagsSub = readSubelement(view, offset);
    offset += flagsSub.totalSize;
    // A matrix truncated before its own array-flags subelement tells us nothing —
    // not even its class — so there is no partial variable worth returning. The
    // named-variable check in parseMat drops this shell.
    if (flagsSub.bytes < 2) {
        return { name: '', className: 'unknown', dimensions: [], isComplex: false, isLogical: false, value: null, fields: null };
    }
    const arrayClass = view.getUint8(flagsSub.dataOffset) & 0xFF;
    const flags = view.getUint8(flagsSub.dataOffset + 1);
    const isComplex = !!(flags & 0x08);
    const isLogical = !!(flags & 0x02);
    // Sparse storage, which MATLAB writes two ways. A double or logical sparse array is
    // MAT class 5 (mxSPARSE_CLASS), the one the MAT-file spec documents. A SINGLE sparse
    // array — R2027a makes them — keeps class 7 (mxSINGLE_CLASS) and is told apart only by
    // flag 0x10, which MATLAB sets on every sparse array it writes, class 5 included (0x10
    // plain, 0x12 logical, 0x18 complex). Measured: every sparse array in
    // test/fixtures/sparse (make_sparse_fixtures.m records matClassCode and matFlags per
    // value) and sparse_cases.mat carries it, and of 1.7 million arrays in the corpus .mat
    // files not one full numeric array does. Read by class code alone, a sparse single
    // went to the full-array arm below, which took its row indices for its values:
    // sparse([0 1.5; 2.5 0; 0 -4], single) displayed as [1 0; 2].
    const isSparse = arrayClass === 5 || (!!(flags & 0x10) && arrayClass >= 6 && arrayClass <= 15);
    if (arrayClass === 17) {
        return parseOpaque(view, offset, end);
    }
    const dimsSub = readSubelement(view, offset);
    offset += dimsSub.totalSize;
    const ndims = Math.floor(dimsSub.bytes / 4);
    const dimensions = [];
    for (let i = 0; i < ndims; i++) {
        dimensions.push(view.getInt32(dimsSub.dataOffset + i * 4, true));
    }
    const nameSub = readSubelement(view, offset);
    offset += nameSub.totalSize;
    const nameBytes = new Uint8Array(view.buffer, view.byteOffset + nameSub.dataOffset, nameSub.bytes);
    const name = new TextDecoder().decode(nameBytes);
    const totalElements = dimensions.reduce((a, b) => a * b, 1);
    // A sparse array's class is its ELEMENTS' class, which is what MATLAB's class()
    // answers — 'double' for class 5 (complex is still double), 'logical' when the
    // logical flag is set, and the numeric class itself for a flagged one (single).
    // CLASS_NAMES[5] is the MAT-file's name for the storage, and is not a class a value
    // has.
    const className = isSparse
        ? (arrayClass === 5 ? (isLogical ? 'logical' : 'double') : CLASS_NAMES[arrayClass])
        : (CLASS_NAMES[arrayClass] || 'unknown');
    const result = { name, className, dimensions, isComplex, isLogical, value: null, fields: null };
    if (isSparse) {
        result.isSparse = true;
    }
    // Past MAX_NESTING levels a matrix is recorded with its class, size and name, and nothing in
    // it is read. What holds it keeps its bytes, as for every value this reader does not decode:
    // a struct field always, and a cell element when it is not decoded.
    if (depth >= MAX_NESTING) {
        result.value = undecodedValue(dimensions, className);
        result.undecoded = 'nested more than ' + MAX_NESTING + ' levels deep, so it was not read';
        return result;
    }
    // A declared size no bytes here could hold. Every element of a full array, of a cell,
    // and of a struct array with a field takes at least a byte of this element (a cell's
    // an 8-byte tag apiece, a struct's one per field), so an array declaring more elements
    // than it has bytes left is a damaged one, whatever its class. Past MAX_UNBACKED_ELEMENTS
    // it is recorded rather than read: the clamps keep the READ inside the bytes, but the
    // node layer builds one row per DECLARED element, so a dimension word of 0x7FFFFFFF in a
    // struct array of two elements — one corrupted byte of a dictionary's hex value — ran
    // the heap out and took the whole process with it. Below that size a short array stays
    // the clamped read it always was, and so does a struct array with no fields, whose
    // elements take no bytes at all. A sparse array's elements take no bytes either — its
    // non-zeros do, and readSparse reads only those.
    //
    // A struct array's element is held to what it takes at the least: its F fields' tags, 8
    // bytes each, a field of [] being its tag alone. Held to a byte, the guard let through
    // eight times the elements such an array's bytes can back, or more with more fields: a
    // 2 MB file whose record claims exactly the bytes it holds, a 1x1,500,000 struct with one
    // field and 250,000 elements' bytes, was not refused, and a host built a row per declared
    // element until the heap ran out. MATLAB writes every field of every element, so an array
    // it wrote always has its 8F bytes apiece. A refusal its bytes alone explain reads as it
    // did; one the 8F explain says so.
    const bytesLeft = Math.max(0, end - offset);
    const fieldCount = arrayClass === 2 ? structFieldCount(view, offset, end) : 0;
    const perElement = fieldCount > 0 ? 8 * fieldCount : 1;
    if (!isSparse && arrayClass !== 3 && totalElements > MAX_UNBACKED_ELEMENTS
        && totalElements > Math.floor(bytesLeft / perElement)
        && !(arrayClass === 2 && fieldCount === 0)) {
        result.value = undecodedValue(dimensions, className);
        result.undecoded =
            'declares ' + totalElements + ' elements, more than the ' + bytesLeft + ' bytes left in it can hold'
                + (totalElements > bytesLeft ? '' : ' at ' + perElement + ' bytes an element');
        return result;
    }
    if (isSparse) {
        // HELD AS ITS NON-ZEROS, and that is the decision in this branch worth recording.
        //
        // It used to be presented dense: the non-zeros scattered into the flat row-major
        // element list every other numeric class produces, because every consumer of
        // MatVariable.value understood that one shape. A sparse array's declared size says
        // nothing about what it holds, though, so that list cost what the array DECLARES —
        // a million zeros for spBig's five non-zeros, and for `sparse(1e7, 2)`, which MATLAB
        // stores in 120 bytes, twenty million, which this reader refused past a million
        // elements instead of materializing. So the non-zeros are the value now, in
        // `sparse`, and nothing here or in the node layer lays them out densely: a sparse
        // array is shown as its summary and one row per non-zero, edited a non-zero at a
        // time and written from the non-zeros.
        //
        // That the file stored it sparse survives as `isSparse`, beside the class MATLAB
        // gives the value. It used to survive in `className` instead, as 'sparse' — the
        // file's word for the storage, shown in every Class and Data Type cell and every
        // summary, where MATLAB's class() says double (measured on every sparse array in
        // test/fixtures/sparse). `isSparse` is also what sends MatWriter to its sparse
        // encoder, which writes the non-zeros back as MATLAB's ir/jc/pr — required,
        // because writing the array back full would silently change the variable's storage
        // in the file, and a class of 'double' alone would let the writer do exactly that.
        //
        // `value` is the summary, as `undecoded`'s placeholder is the value of what was not
        // read: a host that renders values without knowing about `sparse` still shows
        // something true. A 1x1 is not unwrapped to a scalar: it has no list to unwrap.
        const nzmax = flagsSub.bytes >= 8 ? view.getUint32(flagsSub.dataOffset + 4, true) : 0;
        result.sparse = offset < end ? readSparse(view, offset, end, dimensions, isComplex, nzmax, arrayClass === MX_SINGLE_CLASS) : emptySparse(isComplex, 0);
        result.value = sparseValue(dimensions, className);
    }
    else if (arrayClass >= 6 && arrayClass <= 15) {
        if (offset < end) {
            const realAt = offset;
            const realSub = readSubelement(view, offset);
            offset += realSub.totalSize;
            const imagAt = offset;
            const imagSub = isComplex && offset < end ? readSubelement(view, offset) : null;
            // A part that holds none of the elements declared, its tag cut short or of a type
            // with no width, leaves no value to read (unreadablePart).
            const unread = unreadablePart(view, realAt, realSub, totalElements, 'real part')
                ?? (imagSub && unreadablePart(view, imagAt, imagSub, totalElements, 'imaginary part'));
            if (unread) {
                result.value = undecodedValue(dimensions, className);
                result.undecoded = unread;
                return result;
            }
            const realValues = readNumericArray(view, realSub, totalElements, arrayClass === MX_SINGLE_CLASS);
            if (imagSub) {
                offset += imagSub.totalSize;
                const imagValues = readNumericArray(view, imagSub, totalElements, arrayClass === MX_SINGLE_CLASS);
                const colMajor = realValues.map((r, i) => ({ re: r, im: imagValues[i] }));
                result.value = transposeFromColMajor(colMajor, dimensions);
            }
            else {
                const rowMajor = transposeFromColMajor(realValues, dimensions);
                result.value = rowMajor.length === 1 ? rowMajor[0] : rowMajor;
            }
        }
    }
    else if (arrayClass === 3) {
        // The pre-MCOS object: MATLAB's own class system before R2008a, and the reason
        // CLASS_NAMES has named class 3 all along while nothing dispatched on it.
        //
        // RECORDED, NOT DECODED, and deliberately so. The MAT-file spec describes the
        // layout as a struct array's with a class-name subelement inserted after the
        // array name, but this repo has no evidence for that: there is no
        // MATLAB-authored class-3 fixture in the corpus, `test/parity/matlab/
        // STRING_MCOS.md` covers the class-17 MCOS opaque and says nothing about this
        // one, and no MATLAB is reachable to ask. A decoder written from the document
        // alone would be an untested path whose failure mode is plausible-looking
        // field names, which is worse than not reading it — the same reasoning
        // probe_string.m records for the MCOS payload it refused to guess, and the
        // same reasoning docs/TODO.md item 15 records for a ConfigSetRef.
        //
        // What it must NOT do is arrive as `value: null`, which is indistinguishable
        // from an empty variable — before this branch a 1x1 class-3 object rendered
        // the JS word "null" in the Value column, since the node layer took it for a
        // scalar whose value happened to be null.
        //
        // It is NOT marked isOpaque either, though the rendering would be close. That
        // flag means "an MCOS reference the McosParser resolves" everywhere it is read
        // (McosParser.ts:229, MatNode.ts:129, MatWriter.ts:408 — "cannot write an MCOS
        // opaque value"), and a class-3 object is precisely the object that is not
        // that. Claiming it would send it to a decoder that cannot help and would
        // report the wrong reason for the wrong format.
        result.value = undecodedValue(dimensions, className);
        result.undecoded =
            'MAT array class 3, the pre-MCOS object: recorded but not decoded, because no'
                + ' MATLAB-authored fixture in this corpus pins its layout';
    }
    else if (arrayClass === 16) {
        // A function handle (mxFUNCTION_CLASS). Its class stays the 'unknown' of a class this
        // reader does not model, which is what sends a stream holding one to a binary
        // dictionary as the hex MATLAB writes it there (MatlabVariableNode.needsHexInBinary);
        // its text, `sin` or `@(x)x.^2+1`, is kept beside it (functionHandleOf), for the node
        // a handle is built as, at the top of a .mat (MatNode.fromParsed) and in a struct
        // field or a cell element (MatlabVariableNode.parseMatVariable). An empty one has no
        // body.
        const text = totalElements > 0 && offset + 8 <= end ? functionHandleElementText(view, offset, end) : null;
        if (totalElements === 0 || text !== null) {
            functionHandles.set(result, { text });
        }
    }
    else if (arrayClass === 4) {
        if (offset < end) {
            const charSub = readSubelement(view, offset);
            offset += charSub.totalSize;
            const charBytes = new Uint8Array(view.buffer, view.byteOffset + charSub.dataOffset, charSub.bytes);
            if (charSub.type === MI_UTF8 || charSub.type === MI_UINT8 || charSub.type === MI_INT8) {
                result.value = new TextDecoder().decode(charBytes);
            }
            else if (charSub.type === MI_UTF16 || charSub.type === MI_UINT16) {
                result.value = new TextDecoder('utf-16le').decode(charBytes);
            }
            else {
                result.value = new TextDecoder().decode(charBytes);
            }
        }
    }
    else if (arrayClass === 2) {
        // Struct
        if (offset < end) {
            // A field-name length, or the name block a positive stride says there is, that
            // does not lie inside the element (its tag past the end, or its names running on
            // past it) is a damaged struct, recorded as one, as the guard above records one: a
            // warning naming it, and no rows. Read where its tag said, the block was the next
            // element's bytes, a sibling field's or the next variable's, and with no bytes left
            // for fields the struct ended up with none.
            // structFieldCount counted none either, so a 272-byte file declaring 2,000,000
            // elements passed the guard as a struct array with no fields, and a host built a
            // row for each until the heap ran out. (A struct cut off before its field-name
            // length is not this: it has fields null and no warning, as it always had.)
            const pastItsEnd = () => {
                result.value = undecodedValue(dimensions, className);
                result.undecoded = 'its field names lie past the end of its ' + held + ' bytes';
                return result;
            };
            if (offset + 8 > end) {
                return pastItsEnd();
            }
            const fieldNameLenSub = readSubelement(view, offset);
            offset += fieldNameLenSub.totalSize;
            // The field-name stride comes straight off the file, and it is the loop
            // increment below. A corrupt zero or negative value makes that loop
            // never advance — the parse hangs forever rather than failing, which
            // freezes whatever thread opened the file. A struct with no readable
            // field-name stride has no readable field names, so stop instead of
            // spinning. (Fewer than 4 bytes means the file ended mid-stride.)
            const fieldNameLen = fieldNameLenSub.bytes >= 4 ? view.getInt32(fieldNameLenSub.dataOffset, true) : 0;
            if (fieldNameLen <= 0) {
                result.fields = {};
                return result;
            }
            if (offset + 8 > end) {
                return pastItsEnd();
            }
            const fieldNamesSub = readSubelement(view, offset);
            if (fieldNamesSub.dataOffset + fieldNamesSub.bytes > end) {
                return pastItsEnd();
            }
            offset += fieldNamesSub.totalSize;
            const fieldNames = [];
            const fnBytes = new Uint8Array(view.buffer, view.byteOffset + fieldNamesSub.dataOffset, fieldNamesSub.bytes);
            // A name ends at a NUL, at the stride, or at the end of the block, whichever is
            // first. The block's end is the one the file cannot move: past it `fnBytes[j]` is
            // undefined, which is not 0, so a stride longer than the block ran the name on in
            // NULs to the stride's length, and a 264-byte file declaring a stride of 1e8 ran
            // the heap out building one.
            for (let i = 0; i < fnBytes.length; i += fieldNameLen) {
                const stop = Math.min(i + fieldNameLen, fnBytes.length);
                let str = '';
                for (let j = i; j < stop && fnBytes[j] !== 0; j++) {
                    str += String.fromCharCode(fnBytes[j]);
                }
                if (str) {
                    fieldNames.push(str);
                }
            }
            const fields = {};
            // Element by element while there is a name to look for and a byte to read it from:
            // a byte there is, not one the element's length claims (see `end`).
            // A struct array with no field names holds nothing per element, and one whose bytes
            // have run out holds nothing more, so walking the rest of its DECLARED elements read
            // nothing and only held the parse: 1e10 empty steps, 34 s, for a 1e5x1e5 struct(),
            // which MATLAB writes in about 200 bytes. What is read is what was read before.
            for (let e = 0; e < totalElements && fieldNames.length > 0 && offset < end; e++) {
                for (const fn of fieldNames) {
                    if (offset >= end) {
                        break;
                    }
                    const fieldStart = offset;
                    const fieldMatrixSub = readSubelement(view, offset);
                    if (fieldMatrixSub.type === MI_MATRIX) {
                        const child = parseMatrix(view, offset + 8, childLength(view, fieldMatrixSub, offset, end), depth + 1);
                        // totalSize rounds the payload up to an 8-byte boundary, so
                        // on a file that ends mid-padding it can name more bytes
                        // than exist. The writer replays these bytes verbatim, so
                        // keep the ones that are really there.
                        const rawLen = Math.min(fieldMatrixSub.totalSize, view.byteLength - fieldStart);
                        child._rawBytes = new Uint8Array(view.buffer, view.byteOffset + fieldStart, Math.max(0, rawLen));
                        // The field names are the FILE's. `constructor`, `toString`, `valueOf`
                        // and `hasOwnProperty` are legal MATLAB field names, and on this plain
                        // `{}` each is already "there" as an inherited member: a struct array's
                        // `if (!fields[fn]) fields[fn] = []` skipped the `[]` and pushed onto a
                        // function, so the whole .mat failed with "fields[fn].push is not a
                        // function". `__proto__` (no MATLAB name, but a file can spell it) went
                        // to the prototype setter, which threw the same way in a struct array
                        // and lost the field from a 1x1. So presence is an own-key question,
                        // and the write goes through setOwn.
                        if (totalElements === 1) {
                            setOwn(fields, fn, child);
                        }
                        else if (Object.prototype.hasOwnProperty.call(fields, fn)) {
                            fields[fn].push(child);
                        }
                        else {
                            setOwn(fields, fn, [child]);
                        }
                    }
                    else if (totalElements > 1 && fieldStart + 8 <= end) {
                        // A slot of a struct array that is not a matrix, its tag whole inside
                        // the array, is a damaged struct, recorded as one, as pastItsEnd records
                        // one: MATLAB writes every field of every element as a matrix. It was
                        // stepped over and left no hole in its field's list, so the elements
                        // after it moved up one in that field and not in the others: element 3's
                        // value showed as element 2's, and nothing said so. A tag the end of the
                        // bytes cuts is not this: it is a cut, and the elements before it are
                        // kept, as for a struct array cut anywhere else. In a 1x1 such a slot
                        // only leaves its field out, and nothing moves.
                        result.value = undecodedValue(dimensions, className);
                        result.undecoded = 'element ' + (e + 1) + "'s field " + fn
                            + ' is not a matrix (a data element of type ' + fieldMatrixSub.type + ')';
                        return result;
                    }
                    offset += fieldMatrixSub.totalSize;
                }
            }
            // Every field an array names is kept, with the list of its elements read, even one
            // whose bytes ran out before any element of it was read. Dropped, an array holding no
            // element read as one with no fields, which has a row for every element it declares
            // up to MAX_LAID_OUT_FIELDLESS: a 104-byte struct naming a field and declaring 10,000
            // elements had 10,000 empty rows, and a 104 KB file holding 1,000 of them ran a
            // 512 MB heap out while it opened. MATLAB writes every field of every element, so an
            // array it wrote has every list already.
            if (totalElements > 1) {
                for (const fn of fieldNames) {
                    if (!Object.prototype.hasOwnProperty.call(fields, fn)) {
                        setOwn(fields, fn, []);
                    }
                }
            }
            result.fields = fields;
        }
    }
    else if (arrayClass === 1) {
        // Cell array
        const cells = [];
        for (let i = 0; i < totalElements && offset < end; i++) {
            const cellSub = readSubelement(view, offset);
            if (cellSub.type === MI_MATRIX) {
                const child = parseMatrix(view, offset + 8, childLength(view, cellSub, offset, end), depth + 1);
                // A value recorded without being decoded has nothing to be written from
                // but the bytes it was read from (MatWriter.matStreamOfElement), so it
                // keeps them, as a struct field does: copied out of a cell — or out of an
                // MCOS property, whose values are a cell's elements — it went into a
                // dictionary as the text of its placeholder, or as []. A sparse array keeps
                // them too: they are what it is written back as while nothing edits it, and
                // what an MCOS property holding one is handed over as (McosParser). So does a
                // struct array whose elements nothing reads one by one (isUnheldStructArray), for
                // the same handover and because a copy of it is those bytes
                // (MatlabVariableNode._matStream).
                if (child.undecoded || child.isSparse || isUnheldStructArray(child)) {
                    const rawLen = Math.min(cellSub.totalSize, view.byteLength - offset);
                    child._rawBytes = new Uint8Array(view.buffer, view.byteOffset + offset, Math.max(0, rawLen));
                }
                cells.push(child);
            }
            else {
                cells.push(null);
            }
            offset += cellSub.totalSize;
        }
        result.value = cells;
    }
    return result;
}
export function parseMat(arrayBuffer) {
    const buf = new Uint8Array(arrayBuffer);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    // A Level-5 MAT-file opens with a fixed 128-byte header. Reading it out of a
    // shorter buffer threw whatever the byte slice happened to throw — an empty
    // file surfaced as "Invalid typed array length: 116", and a file of 120 bytes
    // read its endian indicator out of the zero padding and blamed big-endian.
    // Both reach the user verbatim as "Failed to parse <name>.mat: ...", so say
    // what is actually wrong.
    if (buf.length < 128) {
        throw new Error('Not a MAT-file: shorter than the 128-byte header');
    }
    const headerBytes = new Uint8Array(buf.buffer, buf.byteOffset, 116);
    const header = new TextDecoder().decode(headerBytes).trim();
    // A `-v7.3` file is HDF5, and it carries this same 128-byte header in its HDF5
    // userblock — so nothing below rejects it. Its endian indicator is a genuine
    // little-endian 'IM', and the first record tag is read out of the zero padding that
    // follows the header, which is exactly the format's end-of-variables marker. The
    // result was `variables: []`: a successful parse of an empty file, indistinguishable
    // from a real .mat holding no variables. `-v7.3` is what MATLAB requires above 2 GB.
    //
    // Matched on the version prefix, because the rest of the header is per-file platform
    // and date text. Checked before the endian indicator so the message names the format
    // we do not implement rather than blaming the byte order of one we do. Actually
    // READING HDF5 is a separate and far larger question; see docs/TODO.md.
    if (header.startsWith('MATLAB 7.3 MAT-file')) {
        throw new Error('MAT-file version 7.3 (HDF5) is not supported');
    }
    const endianIndicator = String.fromCharCode(buf[126]) + String.fromCharCode(buf[127]);
    if (endianIndicator !== 'IM') {
        throw new Error('Big-endian MAT files not supported');
    }
    const variables = [];
    const warnings = [];
    // The variables a record's own warning names as read short (`short` below): a value the cut
    // left holding no data is that one loss, said once (collectUndecoded).
    const readShort = new Set();
    let offset = 128;
    // The name to blame a short record on — empty for the unnamed element every MCOS
    // file carries, which has no name to give.
    const nameFor = (variable) => (variable._anonymous ? '' : variable.name);
    while (offset < buf.length) {
        if (offset + 8 > buf.length) {
            // Between one and seven bytes left: the file ends INSIDE a record tag.
            // Every record in a MAT-file starts on an 8-byte boundary, so a complete
            // file cannot land here — these bytes are a truncated write, and with them
            // goes however much of the file followed. Reported without a `part`
            // because there is nothing left to read the name out of.
            warnings.push({
                code: 'part-unreadable',
                message: `The file ends with ${buf.length - offset} byte(s) where a record header needs 8, `
                    + 'so anything stored after the last variable read was not read.',
            });
            break;
        }
        const dataType = view.getUint32(offset, true);
        const numBytes = view.getUint32(offset + 4, true);
        // The format's own end-of-variables marker. NOT a warning: a file that ends
        // where it says it ends has been read completely.
        if (dataType === 0 && numBytes === 0) {
            break;
        }
        // A record may declare more bytes than the file holds. Everything below clamps
        // rather than throwing (see readSubelement), so the variable still opens —
        // short. The clamp is what keeps one bad length from failing the whole open;
        // this is what keeps the short read from being reported as a whole one. Held
        // until after the parse so the warning can name the variable it cost.
        const missing = offset + 8 + numBytes - buf.length;
        let shortened = '';
        if (dataType === MI_COMPRESSED) {
            const compressed = buf.slice(offset + 8, offset + 8 + numBytes);
            let pako;
            try {
                pako = decompressZlib(compressed);
            }
            catch (err) {
                // No `part`: the variable's NAME is inside the payload that would not
                // inflate, so this file cannot say what was lost and naming a
                // neighbour would be worse than saying nothing. The byte offset is
                // what a caller can act on. Reading continues at the next record —
                // one unreadable record is one variable, not the file.
                warnings.push({
                    code: 'part-unreadable',
                    message: `A compressed record at byte ${offset} could not be decompressed `
                        + `(${reasonOf(err)}), so the variable it holds was not read.`,
                });
                offset += 8 + numBytes;
                continue;
            }
            const deView = new DataView(pako.buffer, pako.byteOffset, pako.byteLength);
            // The payload's tag, the 8 bytes everything in it is read from, has to be there
            // before either word of it can be read. Read regardless, a payload of 0 to 7 bytes
            // threw a bare RangeError out of parseMat, and the whole open failed with the
            // variables after it. Such a record holds no variable this can read, and is
            // reported as one that will not inflate is.
            const tagged = deView.byteLength >= 8;
            const innerType = tagged ? deView.getUint32(0, true) : 0;
            const innerBytes = tagged ? deView.getUint32(4, true) : 0;
            if (!tagged) {
                warnings.push({
                    code: 'part-unreadable',
                    message: `A compressed record at byte ${offset} inflates to ${deView.byteLength} bytes, fewer than the 8 `
                        + "of a data element's tag, so the variable it holds was not read.",
                });
            }
            else if (innerType === MI_MATRIX) {
                const variable = parseMatrix(deView, 8, innerBytes);
                if (variable.name) {
                    variable._rawBytes = new Uint8Array(pako.buffer, pako.byteOffset, pako.byteLength);
                    variables.push(variable);
                }
                else {
                    variables.push({ name: '', className: '', dimensions: [], isComplex: false, isLogical: false, value: null, fields: null, _rawBytes: new Uint8Array(pako.buffer, pako.byteOffset, pako.byteLength), _anonymous: true });
                }
                shortened = nameFor(variables[variables.length - 1]);
                // The record's warning below, one level in. The matrix's own tag in the
                // payload may claim more bytes than the payload holds, as a record may claim
                // more than the file holds, and parseMatrix reads what is there either way;
                // but the record around it is whole, so the record's warning cannot say so.
                // A 1x3 struct whose third element lay past the payload's end read two of
                // them, and nothing said so.
                const held = deView.byteLength - 8;
                if (innerBytes > held) {
                    const short = {
                        code: 'part-unreadable',
                        message: `A compressed record at byte ${offset} holds a variable that declares ${innerBytes} bytes, `
                            + `and its payload holds only ${held}, so it was read short.`,
                    };
                    if (shortened) {
                        short.part = shortened;
                        readShort.add(variables[variables.length - 1]);
                    }
                    warnings.push(short);
                }
            }
            else {
                warnings.push({
                    code: 'part-unreadable',
                    message: `A compressed record at byte ${offset} holds a data element of type `
                        + `${innerType} where a variable has to be a matrix, so it was not read.`,
                });
            }
        }
        else if (dataType === MI_MATRIX) {
            const variable = parseMatrix(view, offset + 8, numBytes);
            if (variable.name) {
                variable._rawBytes = buf.slice(offset, offset + 8 + numBytes);
                variables.push(variable);
            }
            else {
                variables.push({ name: '', className: '', dimensions: [], isComplex: false, isLogical: false, value: null, fields: null, _rawBytes: buf.slice(offset, offset + 8 + numBytes), _anonymous: true });
            }
            shortened = nameFor(variables[variables.length - 1]);
        }
        else {
            // Only miCOMPRESSED and miMATRIX carry a variable at this level. Anything
            // else was skipped, and a whole variable's worth of file went with it.
            warnings.push({
                code: 'part-unreadable',
                message: `A data element of type ${dataType} at byte ${offset} is not a variable, `
                    + 'so it was not read.',
            });
        }
        if (missing > 0) {
            const short = {
                code: 'part-unreadable',
                message: `A record at byte ${offset} declares ${numBytes} bytes and the file holds only `
                    + `${Math.max(0, buf.length - offset - 8)}, so it was read short.`,
            };
            if (shortened) {
                short.part = shortened;
                readShort.add(variables[variables.length - 1]);
            }
            warnings.push(short);
        }
        offset += 8 + numBytes;
    }
    // Every variable the reader deliberately did not decode, and every one whose class
    // it does not model, becomes one warning here — including the ones nested inside a
    // struct or a cell, which no file-level list could otherwise point at.
    for (const variable of variables) {
        collectUndecoded(variable, variable.name || '<unnamed>', warnings, readShort);
    }
    return { header, variables, warnings };
}
/**
 * One warning per piece of a variable that was not decoded, named the way MATLAB
 * names that piece: `s.inner`, `s(2).inner`, `c{3}`.
 *
 * The path matters more than it looks. A host renders this list beside a file, so
 * "big" for a field of a struct called `s` sends someone looking for a variable that
 * does not exist; `s.big` is the expression they can type. Walking into `fields` and
 * into a cell's elements is what makes a loss two levels down reportable at all.
 *
 * `undecoded` is used as the message verbatim, which is what MatVariable.undecoded
 * asked for when it recorded that this item would come: the reason string is written
 * once, at the point that decided, and the variable keeps it whether or not anyone
 * looks at the file-level list.
 */
function collectUndecoded(variable, path, warnings, readShort) {
    const unbacked = variable.sparse ? unbackedColumns(variable.sparse, variable.dimensions) : null;
    if (variable.undecoded) {
        warnings.push({
            code: 'part-unreadable',
            message: `"${path}" was not decoded: ${variable.undecoded}.`,
            part: path,
        });
    }
    else if (unbacked) {
        // A sparse array whose dims word is damaged: read as far as its column index goes,
        // which is all of its bytes, and said so — it shows a size no byte of it backs.
        warnings.push({ code: 'part-unreadable', message: `"${path}" ${unbacked}.`, part: path });
    }
    else if (variable.className === 'unknown' && !functionHandles.has(variable)) {
        // A class code CLASS_NAMES has no name for: a function handle (16), or a class
        // a later release added. A function handle whose text read is shown wherever it
        // stands: at the top of the file (MatNode.fromParsed), and in a struct field or a
        // cell element (MatlabVariableNode.parseMatVariable). Any other value of such a class
        // is in the file and comes back null, which is indistinguishable from an empty
        // variable — the confusion this channel exists to remove. Note this is a limit of
        // the READER, not of the file, and the policy that keeps file limits quiet does
        // not cover it: the bytes claim a value and the reader did not produce one.
        //
        // The class NUMBER is deliberately not in the message. It is known only inside
        // parseMatrix, and carrying it out would mean a new field on MatVariable —
        // public surface, for a diagnostic that already names the variable.
        warnings.push({
            code: 'part-unreadable',
            message: `"${path}" is of a MAT array class this reader does not model, so its value `
                + 'was not read.',
            part: path,
        });
    }
    else if (holdsNoData(variable) && !readShort?.has(variable)) {
        // A numeric value whose bytes end before its real part (parseMatrix's numeric arm, with
        // no bytes left to read): it declares elements and none are there, which `value: null`
        // alone says to no host, and the node layer shows it as not decoded
        // (MatlabVariableNode._createFromMatNumeric). Not when the record holding it is the one
        // cut short: the record's warning names it, and that is the one loss.
        warnings.push({
            code: 'part-unreadable',
            message: `"${path}" declares ${variable.dimensions.reduce((a, b) => a * b, 1)} element(s) and holds no data, `
                + 'so its value was not read.',
            part: path,
        });
    }
    if (variable.fields) {
        // A struct array with fields whose bytes ran out holds fewer elements than it
        // declares: the file contradicting itself, as a short cell does below, and reported
        // once for the array, as that is. It said nothing, while a host showed a row for each
        // declared element, the ones past the bytes empty. Counted in whole elements, every
        // field of them read: one cut inside its fields has a row for those it holds
        // (structElementsHeld), and is reported as not read.
        const declared = variable.dimensions.reduce((a, b) => a * b, 1);
        let read = declared;
        for (const list of Object.values(variable.fields)) {
            if (Array.isArray(list)) {
                read = Math.min(read, list.length);
            }
        }
        if (declared > read) {
            warnings.push({
                code: 'part-unreadable',
                message: `"${path}" declares ${declared} element(s) and only ${read} could be read.`,
                part: path,
            });
        }
        for (const [name, field] of Object.entries(variable.fields)) {
            if (Array.isArray(field)) {
                // A struct ARRAY: one entry per element, so the path names the element
                // the way an index does. 1-based, as MATLAB counts.
                field.forEach((entry, i) => collectUndecoded(entry, `${path}(${i + 1}).${name}`, warnings));
            }
            else {
                collectUndecoded(field, `${path}.${name}`, warnings);
            }
        }
    }
    // A cell array's elements live in `value`. Two things can go wrong there, and both
    // are the file contradicting itself rather than a limit of anything: an element
    // that was not a matrix comes back as a null entry, and a stream that ran out
    // early comes back with fewer entries than the dimensions declare. Reported ONCE
    // for the array rather than once per missing element — a 1x100 cell that lost its
    // payload is one loss, and a hundred warnings for it is a count no host would show.
    if (variable.className === 'cell' && Array.isArray(variable.value)) {
        const cells = variable.value;
        const declared = variable.dimensions.reduce((a, b) => a * b, 1);
        const read = cells.filter((cell) => cell !== null).length;
        if (declared > read) {
            warnings.push({
                code: 'part-unreadable',
                message: `"${path}" declares ${declared} cell(s) and only ${read} could be read.`,
                part: path,
            });
        }
        cells.forEach((cell, i) => {
            if (cell) {
                collectUndecoded(cell, `${path}{${i + 1}}`, warnings);
            }
        });
    }
}
// The full numeric classes, a logical's uint8 among them: the ones parseMatrix's numeric arm reads.
const NUMERIC_CLASSES = new Set(Array.from({ length: 10 }, (_, i) => CLASS_NAMES[6 + i]));
// A full numeric (or logical) value that declares at least one element and holds none: the
// numeric arm found no bytes after its name, and left `value` null.
function holdsNoData(variable) {
    return variable.value === null && !variable.isSparse && !variable.isOpaque && !variable.fields
        && NUMERIC_CLASSES.has(variable.className) && variable.dimensions.reduce((a, b) => a * b, 1) > 0;
}
function decompressZlib(compressed) {
    return inflateZlib(compressed);
}
// ---- A MAT stream ------------------------------------------------------------------
//
// `getByteStreamFromArray(value)`: an 8-byte preamble — the version word 0x0100, the
// little-endian mark 'IM', four reserved bytes — then one miMATRIX element, and for an
// MCOS object the element holding its subsystem after that. It is what a text dictionary
// carries as cdata, a binary one as hex, a classic `.mdl` uuencoded in its MatData record
// and a `.slx` as its `simulink/modelWorkspace.mxarray` part. Each of those used to frame
// the stream itself, and no two framed it alike: the cdata reader never checked the
// preamble, the Property Inspector's reader checked nothing, and the binary reader checked
// the declared sizes the workspace readers clamp. Every one of them now strips its own
// wrapper (CdataCodec.uudecode, EncodedValue.encodedBytes) and comes here.
const MAT_STREAM_MAGIC = [0x00, 0x01, 0x49, 0x4d];
// A little-endian uint32. The `>>> 0` is load-bearing, not decoration: `<< 24` yields a
// SIGNED 32-bit result, so any length with the high bit set read as a negative number. A
// corrupt or malicious trailing length of 0xfffffff8 then read as -8, which made
// `offset += 8 + size` advance by zero — the scan below span forever pushing empty views
// until the heap died, taking the extension host with it. Unsigned, that length is simply
// larger than the stream and the scan's own clamp-and-stop handles it.
function ru32(buf, offset) {
    return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
}
/**
 * Why `bytes` is not a MAT stream this package reads, or null when it is one. Each reason
 * is phrased to follow "not decoded: ", as `undecoded` reasons are.
 *
 * The preamble has to be MATLAB's: `00 01 49 4D`, then a reserved word of zero (as it is in
 * every stream MATLAB was seen writing: 87 text-dictionary cdata, 17 hex values, 5 `.mdl`
 * records and 12 `.slx` parts under test/, and 594 `.slx` parts, 25 cdata and 4 hex values
 * in the corpus), then a miMATRIX element.
 *
 * `whole` asks for every element to be there to its last byte, for a VALUE: the readers
 * clamp a short element to the bytes present and read on, which is right for a container
 * that must open whatever it can and wrong for a value that would then display with part
 * of itself silently missing. A stream that ends early is a damaged value, not a smaller
 * one — and that holds for an object's subsystem as much as for its array: one cut short
 * decoded into a Simulink.Parameter whose sparse Value showed zeros where MATLAB's 5 and 6
 * are, with nothing to say so. Every hex value MATLAB was seen writing is whole elements to
 * its last byte, so the walk asks for exactly that, and may stop early only at a zero tag.
 */
export function matStreamFailure(bytes, whole = false) {
    if (bytes.length < 16) {
        return `it holds ${bytes.length} bytes, fewer than a MAT stream's header`;
    }
    if (MAT_STREAM_MAGIC.some((b, i) => bytes[i] !== b)) {
        return 'its bytes are not a MAT stream (they do not open with 00 01 49 4D)';
    }
    if (bytes[4] | bytes[5] | bytes[6] | bytes[7]) {
        return "its MAT stream's reserved bytes 4-7 are not zero";
    }
    if (ru32(bytes, 8) !== MI_MATRIX) {
        return 'its MAT stream does not hold an array';
    }
    if (!whole) {
        return null;
    }
    let at = 8;
    while (at + 8 <= bytes.length) {
        const type = ru32(bytes, at);
        const size = ru32(bytes, at + 4);
        if (type === 0 && size === 0) {
            return null;
        }
        if (at + 8 + size > bytes.length) {
            const what = at === 8 ? 'its MAT array' : `the element at byte ${at} of its MAT stream`;
            return `${what} declares ${size} bytes and the stream holds ${bytes.length - at - 8}`;
        }
        at += 8 + size;
    }
    if (at !== bytes.length) {
        return `its MAT stream ends ${bytes.length - at} bytes into an element's tag`;
    }
    return null;
}
/**
 * The variable a MAT stream holds and the elements that follow it (an MCOS object's
 * subsystem), or why it holds none — never a throw, and never a number read out of
 * something that is not a stream.
 *
 * The array's declared size is clamped to the bytes present, which is how a workspace or
 * a cdata value has always been read; `whole` refuses a stream that is not whole instead
 * (matStreamFailure). Elements after the array are kept as far as the bytes go: past a
 * bad length there is no way to find the next tag.
 *
 * An array of a class the reader does not model comes back as the variable it is
 * (`className: 'unknown'`), not as a failure: what to show for it is the caller's choice.
 */
export function decodeMatStream(bytes, options = {}) {
    const failure = matStreamFailure(bytes, !!options.whole);
    if (failure) {
        return { ok: false, reason: failure };
    }
    const outerSize = Math.min(ru32(bytes, 12), bytes.length - 16);
    if (outerSize <= 0) {
        return { ok: false, reason: 'its MAT array declares no bytes' };
    }
    let variable;
    try {
        variable = parseMatrix(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 16, outerSize);
    }
    catch (err) {
        return { ok: false, reason: `its MAT stream did not decode (${reasonOf(err)})` };
    }
    const trailingElements = [];
    let offset = 16 + outerSize;
    while (offset + 8 <= bytes.length) {
        const tag = ru32(bytes, offset);
        const size = ru32(bytes, offset + 4);
        if (tag === 0 && size === 0) {
            break;
        }
        const take = Math.min(8 + size, bytes.length - offset);
        trailingElements.push(new Uint8Array(bytes.buffer, bytes.byteOffset + offset, take));
        if (take < 8 + size) {
            break;
        }
        offset += 8 + size;
    }
    return { ok: true, variable, trailingElements };
}
//# sourceMappingURL=MatParser.js.map