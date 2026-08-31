// Copyright 2026 The MathWorks, Inc.
import { unzlibSync } from 'fflate';
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
                values.push(Number(view.getBigInt64(off + i * 8, true)));
                break;
            case MI_UINT64:
                values.push(Number(view.getBigUint64(off + i * 8, true)));
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
    const endianIndicator = String.fromCharCode(buf[126]) + String.fromCharCode(buf[127]);
    if (endianIndicator !== 'IM') {
        throw new Error('Big-endian MAT files not supported');
    }
    const variables = [];
    let offset = 128;
    while (offset < buf.length) {
        if (offset + 8 > buf.length) {
            break;
        }
        const dataType = view.getUint32(offset, true);
        const numBytes = view.getUint32(offset + 4, true);
        if (dataType === 0 && numBytes === 0) {
            break;
        }
        if (dataType === MI_COMPRESSED) {
            const compressed = buf.slice(offset + 8, offset + 8 + numBytes);
            const pako = decompressZlib(compressed);
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
        }
        offset += 8 + numBytes;
    }
    return { header, variables };
}
function decompressZlib(compressed) {
    return unzlibSync(compressed);
}
//# sourceMappingURL=MatParser.js.map