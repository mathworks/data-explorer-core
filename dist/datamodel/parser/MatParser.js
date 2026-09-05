// Copyright 2026 The MathWorks, Inc.
import { unzlibSync } from 'fflate';
import { exactInt } from './XmlUtils.js';
import { reasonOf } from './ParseWarning.js';
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
function readNumericArray(view, sub, count) {
    const values = [];
    const off = sub.dataOffset;
    // `count` comes from the array's DECLARED dimensions, which a truncated or
    // hand-corrupted file can inflate past the bytes actually present. Reading on
    // regardless throws a bare RangeError out of the DataView, which no caller
    // catches — a single bad byte range would take down the whole open. Clamp to
    // what the payload and the buffer really hold and return a short array; the
    // node layer already renders fewer elements than the dimensions claim.
    const width = ELEMENT_WIDTH[sub.type];
    if (width) {
        const available = Math.min(sub.bytes, Math.max(0, view.byteLength - off));
        count = Math.min(count, Math.floor(available / width));
    }
    for (let i = 0; i < count; i++) {
        switch (sub.type) {
            case MI_DOUBLE:
                values.push(view.getFloat64(off + i * 8, true));
                break;
            case MI_SINGLE:
                values.push(view.getFloat32(off + i * 4, true));
                break;
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
            default: values.push(0);
        }
    }
    return values;
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
// `<3x4 sparse, not decoded>`: deliberately the angle-bracket summary spelling of
// src/datamodel/display/DisplayConvention.ts (`summaryForm`), because that spelling
// is what makes a consumer render the cell gray/italic AND withhold the editor
// (BaseNode.valueEditable tests for the brackets). The reason is appended rather
// than left off: a bare `<1x1 object>` reads as an ordinary summary of a value that
// decoded fine and is one click from its elements, which is exactly the wrong thing
// to say about a value that has none. Spelled here rather than imported because no
// parser in this package imports the display layer, and one string is not worth
// being the first.
function undecodedValue(dimensions, className) {
    // MATLAB's own size() is always at least 2-D, and so is every dims array a
    // real file carries; a shorter one means the dims subelement was truncated.
    const shape = dimensions.length >= 2 ? dimensions : [1, dimensions[0] || 1];
    return '<' + shape.join('x') + ' ' + className + ', not decoded>';
}
// A sparse array is the one class whose DECLARED size says nothing about how much
// data it holds: `sparse(1e6, 1e6)` with three non-zeros declares 1e12 elements.
// Materializing that is not merely a slow path — it is `new Array(1e12)` throwing
// "Invalid array length" out of a reader no caller catches, so one variable would
// fail the whole file open, which is the failure mode every clamp in this file
// exists to prevent. Above this many elements the dense form is refused through the
// same `undecoded` channel class 3 uses, rather than being silently truncated.
//
// The number is a judgment call, and this is the reasoning behind it: 1e6 doubles is
// an 8 MB array, roughly a 1000x1000 matrix, and the display summarizes anything
// over ten elements to `<1000x1000 sparse>` whatever the values are — so past this
// point the dense form costs memory to produce something no user can see. The
// general version of this problem is docs/TODO.md item 14 ("Nothing is lazy"), which
// every other class shares; sparse is only the class where the gap between declared
// and stored size makes it reachable from a small file.
const SPARSE_MAX_DENSE_ELEMENTS = 1000000;
// The non-zeros of a sparse array, scattered into the dense row-major list every
// other numeric class produces. Subelement layout, from the MAT-file format spec
// (Level 5, sparse arrays) — the two index arrays sit between the name and the
// payload, where a full array has nothing:
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
// took ir.length for the non-zero count, would scatter that tail into the matrix.
function readSparse(view, offset, end, dimensions, isComplex, nzmax) {
    const rows = Math.max(0, dimensions[0] || 0);
    const cols = Math.max(0, dimensions[1] || 0);
    // Each of the four reads is guarded by the END OF THIS ELEMENT, the same way the
    // full-array branch guards its real and imaginary payloads. A variable truncated
    // after its indices — or after its dimensions — leaves the arrays below empty
    // rather than reading the next variable's tag as this one's data, and every empty
    // one degrades cleanly: no ir means no scatter, so the matrix comes back all
    // zeros, which is the honest reading of a sparse array whose non-zeros are absent.
    let ir = [];
    if (offset < end) {
        const irSub = readSubelement(view, offset);
        offset += irSub.totalSize;
        const irCount = Math.floor(irSub.bytes / 4);
        ir = readNumericArray(view, irSub, nzmax > 0 ? Math.min(nzmax, irCount) : irCount).map(Number);
    }
    let jc = [];
    if (offset < end) {
        const jcSub = readSubelement(view, offset);
        offset += jcSub.totalSize;
        jc = readNumericArray(view, jcSub, cols + 1).map(Number);
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
        pr = readNumericArray(view, prSub, nnz);
    }
    let pi = [];
    if (isComplex && offset < end) {
        const piSub = readSubelement(view, offset);
        offset += piSub.totalSize;
        pi = readNumericArray(view, piSub, nnz);
    }
    const total = rows * cols;
    const dense = new Array(total);
    for (let i = 0; i < total; i++) {
        // A fresh object per cell rather than one shared zero: nothing downstream
        // mutates an element today, but a shared reference across every zero of a
        // matrix is a trap to leave lying around for whatever does next.
        dense[i] = isComplex ? { re: 0, im: 0 } : 0;
    }
    // No transpose call here, unlike every other numeric branch. transposeFromColMajor
    // exists because a full array arrives as one flat column-major run with the
    // (row, column) pair implied by position; a sparse array states the row in ir and
    // the column in the jc walk, so the same reordering is the one index expression
    // `row * cols + col` and there is nothing left to reorder afterwards.
    for (let col = 0; col < cols; col++) {
        const from = Math.max(0, jc[col] ?? 0);
        const to = Math.min(jc[col + 1] ?? from, nnz);
        for (let k = from; k < to; k++) {
            const row = ir[k];
            // A row index outside the declared rows is a corrupt file, not a value:
            // writing it would either land in another column's cell or extend the
            // array past its own dimensions.
            if (!(row >= 0 && row < rows)) {
                continue;
            }
            dense[row * cols + col] = isComplex
                ? { re: pr[k] ?? 0, im: pi[k] ?? 0 }
                : (pr[k] ?? 0);
        }
    }
    return dense;
}
function parseOpaque(view, offset, _end) {
    const nameSub = readSubelement(view, offset);
    offset += nameSub.totalSize;
    const name = readString(view, nameSub);
    const markerSub = readSubelement(view, offset);
    offset += markerSub.totalSize;
    const classSub = readSubelement(view, offset);
    const className = readString(view, classSub);
    return { name, className, dimensions: [1, 1], isComplex: false, isLogical: false, value: null, fields: null, isOpaque: true };
}
export function parseMatrix(view, baseOffset, length) {
    let offset = baseOffset;
    const end = baseOffset + length;
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
    const className = CLASS_NAMES[arrayClass] || 'unknown';
    const result = { name, className, dimensions, isComplex, isLogical, value: null, fields: null };
    if (arrayClass >= 6 && arrayClass <= 15) {
        if (offset < end) {
            const realSub = readSubelement(view, offset);
            offset += realSub.totalSize;
            const realValues = readNumericArray(view, realSub, totalElements);
            if (isComplex && offset < end) {
                const imagSub = readSubelement(view, offset);
                offset += imagSub.totalSize;
                const imagValues = readNumericArray(view, imagSub, totalElements);
                const colMajor = realValues.map((r, i) => ({ re: r, im: imagValues[i] }));
                result.value = transposeFromColMajor(colMajor, dimensions);
            }
            else {
                const rowMajor = transposeFromColMajor(realValues, dimensions);
                result.value = rowMajor.length === 1 ? rowMajor[0] : rowMajor;
            }
        }
    }
    else if (arrayClass === 5) {
        // Sparse. PRESENTED DENSE, with `className` left as 'sparse', and that is the
        // decision in this branch worth recording.
        //
        // The alternative was to expose the triplets — value: { ir, jc, pr } — which
        // is the storage and is what a numerical consumer would want. It is the wrong
        // answer for this package twice over. Every consumer of MatVariable.value
        // understands exactly ONE shape, a flat row-major element list matching
        // `dimensions`: MatlabVariableNode's numeric arm, the display formatters, the
        // XML and JSON writers, the DTO. Triplets would need a fifth `_kind` in that
        // node's state machine (the closed union at MatlabVariableNode.ts:286-289),
        // its own formatter, its own child-row rule and its own serializer — a lot of
        // new surface for a shape nothing renders, in a package whose job is display
        // and fidelity rather than arithmetic. And a user opening a .mat wants to see
        // the matrix: dense, a sparse matrix reads as the matrix it is, sorts and
        // copies like every other one, and its zeros are real zeros.
        //
        // Nothing that matters is lost by it. The fact that the file stored it sparse
        // survives in `className`, which is also what keeps MatWriter refusing to
        // write one (CLASS_CODE has no 'sparse' entry, MatWriter.ts:76-78) — required,
        // because a dense value cannot be re-emitted as ir/jc/pr and writing it back
        // as a full array would silently change the variable's class in the file.
        // Note that MATLAB's own class() answers 'double' for a sparse double and
        // issparse() is what distinguishes it, so 'sparse' here is the FILE's word
        // for the storage, which is exactly the fact worth keeping.
        const nzmax = flagsSub.bytes >= 8 ? view.getUint32(flagsSub.dataOffset + 4, true) : 0;
        if (totalElements > SPARSE_MAX_DENSE_ELEMENTS) {
            result.value = undecodedValue(dimensions, className);
            result.undecoded =
                'sparse array of ' + totalElements + ' elements: larger than this reader materializes ('
                    + SPARSE_MAX_DENSE_ELEMENTS + ' elements), and its non-zeros are not read';
        }
        else if (offset < end) {
            const dense = readSparse(view, offset, end, dimensions, isComplex, nzmax);
            // Unwrapped for a 1x1 exactly as the numeric branch above unwraps, and NOT
            // unwrapped when complex, also as above: the complex arm downstream reads
            // a list and collapses a single pair itself.
            result.value = isComplex ? dense : (dense.length === 1 ? dense[0] : dense);
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
            const fieldNamesSub = readSubelement(view, offset);
            offset += fieldNamesSub.totalSize;
            const fieldNames = [];
            const fnBytes = new Uint8Array(view.buffer, view.byteOffset + fieldNamesSub.dataOffset, fieldNamesSub.bytes);
            for (let i = 0; i < fnBytes.length; i += fieldNameLen) {
                let str = '';
                for (let j = i; j < i + fieldNameLen && fnBytes[j] !== 0; j++) {
                    str += String.fromCharCode(fnBytes[j]);
                }
                if (str) {
                    fieldNames.push(str);
                }
            }
            const fields = {};
            for (let e = 0; e < totalElements; e++) {
                for (const fn of fieldNames) {
                    if (offset >= end) {
                        break;
                    }
                    const fieldStart = offset;
                    const fieldMatrixSub = readSubelement(view, offset);
                    if (fieldMatrixSub.type === MI_MATRIX) {
                        const child = parseMatrix(view, offset + 8, fieldMatrixSub.bytes);
                        // totalSize rounds the payload up to an 8-byte boundary, so
                        // on a file that ends mid-padding it can name more bytes
                        // than exist. The writer replays these bytes verbatim, so
                        // keep the ones that are really there.
                        const rawLen = Math.min(fieldMatrixSub.totalSize, view.byteLength - fieldStart);
                        child._rawBytes = new Uint8Array(view.buffer, view.byteOffset + fieldStart, Math.max(0, rawLen));
                        if (totalElements === 1) {
                            fields[fn] = child;
                        }
                        else {
                            if (!fields[fn]) {
                                fields[fn] = [];
                            }
                            fields[fn].push(child);
                        }
                    }
                    offset += fieldMatrixSub.totalSize;
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
                const child = parseMatrix(view, offset + 8, cellSub.bytes);
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
            const innerType = deView.getUint32(0, true);
            const innerBytes = deView.getUint32(4, true);
            if (innerType === MI_MATRIX) {
                const variable = parseMatrix(deView, 8, innerBytes);
                if (variable.name) {
                    variable._rawBytes = new Uint8Array(pako.buffer, pako.byteOffset, pako.byteLength);
                    variables.push(variable);
                }
                else {
                    variables.push({ name: '', className: '', dimensions: [], isComplex: false, isLogical: false, value: null, fields: null, _rawBytes: new Uint8Array(pako.buffer, pako.byteOffset, pako.byteLength), _anonymous: true });
                }
                shortened = nameFor(variables[variables.length - 1]);
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
            }
            warnings.push(short);
        }
        offset += 8 + numBytes;
    }
    // Every variable the reader deliberately did not decode, and every one whose class
    // it does not model, becomes one warning here — including the ones nested inside a
    // struct or a cell, which no file-level list could otherwise point at.
    for (const variable of variables) {
        collectUndecoded(variable, variable.name || '<unnamed>', warnings);
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
function collectUndecoded(variable, path, warnings) {
    if (variable.undecoded) {
        warnings.push({
            code: 'part-unreadable',
            message: `"${path}" was not decoded: ${variable.undecoded}.`,
            part: path,
        });
    }
    else if (variable.className === 'unknown') {
        // A class code CLASS_NAMES has no name for: a function handle (16), or a class
        // a later release added. The value is in the file and comes back null, which is
        // indistinguishable from an empty variable — the confusion this channel exists
        // to remove. Note this is a limit of the READER, not of the file, and the
        // policy that keeps file limits quiet does not cover it: the bytes claim a
        // value and the reader did not produce one.
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
    if (variable.fields) {
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
function decompressZlib(compressed) {
    return unzlibSync(compressed);
}
//# sourceMappingURL=MatParser.js.map