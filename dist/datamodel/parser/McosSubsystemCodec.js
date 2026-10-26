// Copyright 2026 The MathWorks, Inc.
import { MatWriteError } from './MatWriter.js';
import { MCOS_HANDLE_MAGIC } from './McosHandle.js';
/** How a triple's value is read: a string-table index, a value index, an integer, an object id. */
export const McosValueKind = { string: 0, cell: 1, integer: 2, object: 3 };
const MI_INT8 = 1;
const MI_UINT8 = 2;
const MI_INT32 = 5;
const MI_UINT32 = 6;
const MI_DOUBLE = 9;
const MI_UINT64 = 13;
const MI_MATRIX = 14;
const MI_UTF8 = 16;
const MI_UTF16 = 17;
const MX_CELL = 1;
const MX_STRUCT = 2;
const MX_OBJECT = 3;
const MX_CHAR = 4;
const MX_SPARSE = 5;
const MX_DOUBLE = 6;
const MX_UINT8 = 9;
const MX_INT32 = 12;
const MX_UINT32 = 13;
const MX_UINT64 = 15;
const MX_FUNCTION = 16;
const MX_OPAQUE = 17;
const INT32_MAX = 0x7fffffff;
const UINT32_MAX = 0xffffffff;
// The preamble MATLAB R2027a writes at the head of a subsystem's payload, and of the payload of
// the stream's own trailing element: version 0x0100, 'IM' for little-endian, then four zero bytes.
const PREAMBLE = Uint8Array.of(0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00);
class Refused extends Error {
    constructor(refusal) {
        super(refusal.message);
        this.refusal = refusal;
    }
}
function fail(reason, message) {
    throw new Refused({ ok: false, reason, message });
}
function align8(n) {
    return n + ((8 - (n % 8)) % 8);
}
/**
 * The sub-element whose tag is at `at`, wholly before `limit`, or null. A tag whose upper half is
 * not zero is the small form, of 1 to 4 bytes, and anything else there is no tag.
 */
function subAt(view, at, limit) {
    if (at + 8 > limit) {
        return null;
    }
    const word = view.getUint32(at, true);
    const small = word >>> 16;
    if (small !== 0) {
        const type = word & 0xffff;
        return small > 4 || type === 0 ? null : { at, type, data: at + 4, bytes: small, end: at + 8 };
    }
    const bytes = view.getUint32(at + 4, true);
    const end = at + 8 + align8(bytes);
    return end > limit ? null : { at, type: word, data: at + 8, bytes, end };
}
/**
 * The miMATRIX element at `at`, wholly before `limit`, whose sub-elements tile it exactly and open
 * with an array-flags word, or null. The bare 8-byte tag of an empty element is not one.
 */
function layerAt(view, at, limit) {
    const tag = subAt(view, at, limit);
    if (!tag || tag.type !== MI_MATRIX || tag.bytes % 8 !== 0) {
        return null;
    }
    const subs = [];
    for (let p = tag.data; p < tag.end;) {
        const sub = subAt(view, p, tag.end);
        if (!sub) {
            return null;
        }
        subs.push(sub);
        p = sub.end;
    }
    const flags = subs[0];
    return flags && flags.type === MI_UINT32 && flags.bytes === 8 ? { at, end: tag.end, subs } : null;
}
function classOf(view, layer) {
    return view.getUint8(layer.subs[0].data);
}
/** The int32 extents of a dims sub-element, or null when it is not one. */
function dimsIn(view, sub) {
    if (!sub || sub.type !== MI_INT32 || sub.bytes < 8 || sub.bytes % 4 !== 0) {
        return null;
    }
    const dims = [];
    for (let p = sub.data; p < sub.data + sub.bytes; p += 4) {
        const d = view.getInt32(p, true);
        if (d < 0) {
            return null;
        }
        dims.push(d);
    }
    return dims;
}
/** Whether `bytes` from `at` spell `text` and nothing more in a field of `width` bytes, the rest NUL. */
function spells(bytes, at, width, text) {
    if (width < text.length) {
        return false;
    }
    for (let i = 0; i < width; i++) {
        if (bytes[at + i] !== (i < text.length ? text.charCodeAt(i) : 0)) {
            return false;
        }
    }
    return true;
}
/**
 * Whether `cell` is one whole miMATRIX element: the bare 8-byte tag of an empty one, or one whose
 * sub-elements tile it and open with an array-flags word.
 */
function isWholeElement(cell) {
    const view = new DataView(cell.buffer, cell.byteOffset, cell.byteLength);
    const tag = subAt(view, 0, cell.length);
    if (!tag || tag.type !== MI_MATRIX || tag.end !== cell.length) {
        return false;
    }
    return tag.bytes === 0 || layerAt(view, 0, cell.length) !== null;
}
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
/**
 * A sub-element holding `payload` of MAT type `type`, by the rule MATLAB writes a subsystem by:
 * a payload of 1 to 4 bytes takes the 4-byte small tag, any other the 8-byte one, and the payload
 * is padded to 8 with zeros.
 */
function subElement(type, payload) {
    const n = payload.length;
    if (n > UINT32_MAX) {
        throw new MatWriteError(`a sub-element of ${n} bytes is past what its tag can say`);
    }
    const small = n >= 1 && n <= 4;
    const out = new Uint8Array(small ? 8 : 8 + align8(n));
    const view = new DataView(out.buffer);
    if (small) {
        view.setUint32(0, (n << 16) | type, true);
        out.set(payload, 4);
    }
    else {
        view.setUint32(0, type, true);
        view.setUint32(4, n, true);
        out.set(payload, 8);
    }
    return out;
}
/** An miMATRIX element around `parts`, its byte count restated. */
function matrixElement(parts) {
    let bytes = 0;
    for (const p of parts) {
        bytes += p.length;
    }
    if (bytes > UINT32_MAX) {
        throw new MatWriteError(`an element of ${bytes} bytes is past what its tag can say`);
    }
    // One allocation, the tag and every part copied in once.
    const out = new Uint8Array(8 + bytes);
    const view = new DataView(out.buffer);
    view.setUint32(0, MI_MATRIX, true);
    view.setUint32(4, bytes, true);
    let at = 8;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}
function words32(values, signed) {
    const out = new Uint8Array(4 * values.length);
    const view = new DataView(out.buffer);
    values.forEach((v, i) => {
        if (!Number.isInteger(v) || (signed ? v < -INT32_MAX - 1 || v > INT32_MAX : v < 0 || v > UINT32_MAX)) {
            throw new MatWriteError(`${v} is not a ${signed ? 'int32' : 'uint32'}`);
        }
        if (signed)
            view.setInt32(4 * i, v, true);
        else
            view.setUint32(4 * i, v, true);
    });
    return out;
}
function dimsElement(dims) {
    for (const d of dims) {
        if (d > INT32_MAX) {
            throw new MatWriteError(`an extent of ${d} is past what an int32 dims word can say`);
        }
    }
    return subElement(MI_INT32, words32(dims, true));
}
/** The array-flags sub-element of class `cls`: the flags word, then nzmax 0. */
function flagsElement(cls) {
    return subElement(MI_UINT32, words32([cls, 0], false));
}
function textElement(text) {
    return subElement(MI_INT8, new TextEncoder().encode(text));
}
// A struct 1x0 with no fields: what MATLAB writes in a per-class cell for a class with nothing to
// record there, and for the null class.
const EMPTY_STRUCT = matrixElement([
    flagsElement(MX_STRUCT),
    dimsElement([1, 0]),
    textElement(''),
    subElement(MI_INT32, words32([1], true)),
    textElement(''),
]);
/** A growable little-endian byte buffer, for the blob. */
class ByteSink {
    constructor() {
        this.buf = new Uint8Array(256);
        this.view = new DataView(this.buf.buffer);
        this.length = 0;
    }
    room(n) {
        if (this.length + n <= this.buf.length) {
            return;
        }
        let size = this.buf.length * 2;
        while (size < this.length + n)
            size *= 2;
        const next = new Uint8Array(size);
        next.set(this.buf.subarray(0, this.length));
        this.buf = next;
        this.view = new DataView(next.buffer);
    }
    u8(v, what) {
        if (!Number.isInteger(v) || v < 0 || v > 0xff) {
            throw new MatWriteError(`the metadata blob's ${what} is ${v}, not a uint8`);
        }
        this.room(1);
        this.buf[this.length++] = v;
    }
    u32(v, what) {
        if (!Number.isInteger(v) || v < 0 || v > UINT32_MAX) {
            throw new MatWriteError(`the metadata blob's ${what} is ${v}, not a uint32`);
        }
        this.room(4);
        this.view.setUint32(this.length, v, true);
        this.length += 4;
    }
    bytes(b) {
        this.room(b.length);
        this.buf.set(b, this.length);
        this.length += b.length;
    }
    pad8() {
        while (this.length % 8 !== 0)
            this.u8(0, 'padding');
    }
    setU32(at, v) {
        this.view.setUint32(at, v, true);
    }
    result() {
        return this.buf.slice(0, this.length);
    }
}
/**
 * How many per-class cells follow the value cells, by blob version: three in version 4.0, the
 * only one MATLAB R2027a writes; four in 5.0, which adds the package names. No other version is
 * read, since a wrong count would take a per-class cell for a value cell, or the reverse.
 */
function trailingCells(major, minor) {
    if (minor !== 0) {
        return null;
    }
    return major === 4 ? 3 : major === 5 ? 4 : null;
}
/**
 * Reads a subsystem element whole into records; or refuses it, when a layer or a section does not
 * parse exactly, a record names what is not there, it is a kind this codec was not measured on, or
 * writing its records back would not give its bytes.
 *
 * The records' byte arrays are views into `bytes`, not copies: nothing may write into `bytes`, or
 * transfer its buffer, while they are in use.
 */
export function readSubsystem(bytes) {
    try {
        const subsystem = readLayers(bytes);
        let again;
        try {
            again = writeSubsystem(subsystem);
        }
        catch (e) {
            if (e instanceof MatWriteError) {
                fail('not-canonical', `its records do not write back: ${e.message}`);
            }
            throw e;
        }
        const at = firstDifference(again, bytes);
        if (at !== null) {
            fail('not-canonical', `its records write back as other bytes, from byte ${at} of ${bytes.length}`);
        }
        return { ok: true, subsystem };
    }
    catch (e) {
        if (e instanceof Refused) {
            return e.refusal;
        }
        throw e;
    }
}
/** Where `a` and `b` first differ, or null when they are the same bytes. */
function firstDifference(a, b) {
    const n = Math.min(a.length, b.length);
    let i = 0;
    // Four bytes a step where both are aligned to it, as a value cell of a fresh array is: a large
    // value is compared three times a write (the read's write-back, the self-check's, its records).
    if (a.byteOffset % 4 === 0 && b.byteOffset % 4 === 0) {
        const words = n >>> 2;
        const wa = new Uint32Array(a.buffer, a.byteOffset, words);
        const wb = new Uint32Array(b.buffer, b.byteOffset, words);
        while (i < words && wa[i] === wb[i])
            i++;
        i *= 4;
    }
    for (; i < n; i++) {
        if (a[i] !== b[i]) {
            return i;
        }
    }
    return a.length === b.length ? null : n;
}
function readLayers(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const piece = (sub) => bytes.subarray(sub.at, sub.end);
    // The element: uint8 [1 N], its data the N bytes of the payload.
    const outer = layerAt(view, 0, bytes.length);
    if (!outer || outer.end !== bytes.length) {
        fail('malformed', 'the subsystem is not one whole MAT element');
    }
    const outerDims = dimsIn(view, outer.subs[1]);
    const data = outer.subs[3];
    if (outer.subs.length !== 4 || classOf(view, outer) !== MX_UINT8 || data.type !== MI_UINT8) {
        fail('malformed', 'the subsystem is not a uint8 array');
    }
    if (!outerDims || outerDims.length !== 2 || outerDims[0] !== 1 || outerDims[1] !== data.bytes) {
        fail('malformed', `the subsystem's dims do not say its ${data.bytes} bytes as [1 ${data.bytes}]`);
    }
    // The payload: an 8-byte preamble that says it is little-endian, the struct, the rest.
    const payloadEnd = data.data + data.bytes;
    if (data.bytes < 16) {
        fail('malformed', `the subsystem's payload is ${data.bytes} bytes, too short to hold a struct`);
    }
    const endian = String.fromCharCode(bytes[data.data + 2], bytes[data.data + 3]);
    if (endian !== 'IM') {
        fail(endian === 'MI' ? 'unsupported' : 'malformed', endian === 'MI' ? "the subsystem's payload is big-endian" : "the subsystem's payload has no endian mark");
    }
    const struct = layerAt(view, data.data + 8, payloadEnd);
    if (!struct || classOf(view, struct) !== MX_STRUCT) {
        fail('malformed', "the subsystem's payload does not open with a whole struct");
    }
    // The struct: flags, dims [1 1], name, field-name width, field names, one value per field, and
    // exactly one of the fields MCOS.
    const structDims = dimsIn(view, struct.subs[1]);
    const [, , , widthSub, namesSub] = struct.subs;
    if (!structDims || structDims.length !== 2 || structDims[0] !== 1 || structDims[1] !== 1 || !widthSub || !namesSub
        || widthSub.type !== MI_INT32 || widthSub.bytes !== 4 || namesSub.type !== MI_INT8) {
        fail('malformed', "the subsystem's struct is not one struct with a field-name table");
    }
    const width = view.getInt32(widthSub.data, true);
    const fieldCount = width > 0 ? namesSub.bytes / width : namesSub.bytes === 0 ? 0 : NaN;
    if (!Number.isInteger(fieldCount) || struct.subs.length !== 5 + fieldCount) {
        fail('malformed', "the subsystem's struct does not hold one value per field it names");
    }
    const mcos = [];
    for (let f = 0; f < fieldCount; f++) {
        if (spells(bytes, namesSub.data + f * width, width, 'MCOS'))
            mcos.push(f);
    }
    if (mcos.length !== 1) {
        fail('malformed', `the subsystem's struct has ${mcos.length} MCOS fields, not one`);
    }
    // The field: class-17 opaque, type 'MCOS', class 'FileWrapper__', and its cell array [n 1].
    const field = struct.subs[5 + mcos[0]];
    const opaque = layerAt(view, field.at, field.end);
    if (!opaque || opaque.end !== field.end || classOf(view, opaque) !== MX_OPAQUE || opaque.subs.length !== 5
        || !spells(bytes, opaque.subs[2].data, opaque.subs[2].bytes, 'MCOS')
        || !spells(bytes, opaque.subs[3].data, opaque.subs[3].bytes, 'FileWrapper__')) {
        fail('malformed', "the subsystem's MCOS field is not a FileWrapper__ opaque");
    }
    const holder = opaque.subs[4];
    const cellArray = layerAt(view, holder.at, holder.end);
    const cellDims = cellArray ? dimsIn(view, cellArray.subs[1]) : null;
    if (!cellArray || cellArray.end !== holder.end || classOf(view, cellArray) !== MX_CELL || !cellDims || cellArray.subs.length < 3) {
        fail('malformed', "the subsystem's FileWrapper__ holds no whole cell array");
    }
    const cells = cellArray.subs.slice(3);
    if (cellDims.reduce((a, b) => a * b, 1) !== cells.length || cells.some((c) => c.type !== MI_MATRIX)) {
        fail('malformed', "the subsystem's cell array does not hold the cells its dims declare");
    }
    if (cells.length < 2) {
        fail('malformed', `the subsystem's cell array holds ${cells.length} cells, too few to hold a metadata blob and its []`);
    }
    // Cell 0: the metadata blob, a uint8 array.
    const blobCell = layerAt(view, cells[0].at, cells[0].end);
    const blobData = blobCell?.subs[3];
    if (!blobCell || !blobData || blobCell.subs.length !== 4 || classOf(view, blobCell) !== MX_UINT8 || blobData.type !== MI_UINT8
        || !dimsIn(view, blobCell.subs[1])) {
        fail('malformed', "the subsystem's first cell is not its metadata blob");
    }
    const blob = readBlob(view, blobData.data, blobData.bytes);
    // Then [], the value cells, and the per-class cells the blob's version writes after them.
    const trailing = trailingCells(blob.major, blob.minor);
    if (cells.length < 2 + trailing) {
        fail('malformed', `the subsystem's cell array holds ${cells.length} cells, fewer than the ${2 + trailing} around its values`);
    }
    const valueCells = cells.slice(2, cells.length - trailing);
    for (const [k, cell] of valueCells.entries()) {
        if (!isWholeElement(piece(cell))) {
            fail('malformed', `value cell ${k} is not one whole MAT element`);
        }
    }
    const tail = cells.slice(cells.length - trailing);
    const classes = blob.classes.length;
    const records = {
        outer: { flags: piece(outer.subs[0]), name: piece(outer.subs[2]) },
        preamble: bytes.subarray(data.data, data.data + 8),
        struct: { head: struct.subs.slice(0, 5).map(piece), fields: struct.subs.slice(5).map((sub, f) => (f === mcos[0] ? null : piece(sub))) },
        opaqueHead: opaque.subs.slice(0, 4).map(piece),
        cellArray: { flags: piece(cellArray.subs[0]), name: piece(cellArray.subs[2]) },
        blobCell: { flags: piece(blobCell.subs[0]), name: piece(blobCell.subs[2]) },
        blob,
        reserved: piece(cells[1]),
        values: valueCells.map(piece),
        packages: trailing === 4 ? numberCell(view, bytes, tail.shift(), classes, MX_UINT32, 'package-name') : null,
        classData: elementCell(view, bytes, tail.shift(), classes, 'saved class data'),
        aliases: numberCell(view, bytes, tail.shift(), classes, MX_INT32, 'alias'),
        defaults: elementCell(view, bytes, tail.shift(), classes, 'defaults'),
        rest: bytes.subarray(struct.end, payloadEnd),
    };
    const dangling = danglingReference(records);
    if (dangling) {
        fail('malformed', dangling);
    }
    return records;
}
/** A per-class cell of elements: a cell array with one whole element per class row. */
function elementCell(view, bytes, cell, classes, what) {
    const layer = layerAt(view, cell.at, cell.end);
    if (!layer || classOf(view, layer) !== MX_CELL || layer.subs.length < 3 || !dimsIn(view, layer.subs[1])) {
        fail('malformed', `the subsystem's ${what} cell is not a cell array`);
    }
    const entries = layer.subs.slice(3);
    if (entries.length !== classes) {
        fail('malformed', `the subsystem's ${what} cell holds ${entries.length} entries for its ${classes} class rows`);
    }
    for (const entry of entries) {
        if (entry.type !== MI_MATRIX || !isWholeElement(bytes.subarray(entry.at, entry.end))) {
            fail('malformed', `an entry of the subsystem's ${what} cell is not one whole MAT element`);
        }
    }
    return { flags: bytes.subarray(layer.subs[0].at, layer.subs[0].end), name: bytes.subarray(layer.subs[2].at, layer.subs[2].end), entries: entries.map((e) => bytes.subarray(e.at, e.end)) };
}
/** A per-class cell of numbers: an int32 or uint32 array with one entry per class row. */
function numberCell(view, bytes, cell, classes, cls, what) {
    const layer = layerAt(view, cell.at, cell.end);
    const type = cls === MX_INT32 ? MI_INT32 : MI_UINT32;
    const numbers = layer?.subs[3];
    if (!layer || classOf(view, layer) !== cls || layer.subs.length !== 4 || !numbers || numbers.type !== type || !dimsIn(view, layer.subs[1])) {
        fail('malformed', `the subsystem's ${what} cell is not ${cls === MX_INT32 ? 'an int32' : 'a uint32'} array`);
    }
    if (numbers.bytes !== 4 * classes) {
        fail('malformed', `the subsystem's ${what} cell holds ${numbers.bytes / 4} entries for its ${classes} class rows`);
    }
    const entries = [];
    for (let p = numbers.data; p < numbers.data + numbers.bytes; p += 4) {
        entries.push(cls === MX_INT32 ? view.getInt32(p, true) : view.getUint32(p, true));
    }
    return { flags: bytes.subarray(layer.subs[0].at, layer.subs[0].end), name: bytes.subarray(layer.subs[2].at, layer.subs[2].end), entries };
}
/**
 * What the first record naming something that is not there names, in words, or null when every
 * record's references land: a string index past the table, a class row, an object, a list or a
 * value cell past theirs, a triple of a value kind past the four MATLAB writes. Or a null record
 * that is not one: class row 0 and object 0, wherever their tables have rows, are all zeros,
 * since a reference to 0 means none.
 */
function danglingReference(sub) {
    const b = sub.blob;
    const nullClass = b.classes[0];
    if (nullClass && (nullClass.namespace !== 0 || nullClass.name !== 0 || nullClass.version.some((v) => v !== 0))) {
        return 'class row 0, the null class, is not all zeros';
    }
    const nullObject = b.objects[0];
    if (nullObject && Object.values(nullObject).some((v) => v !== 0)) {
        return 'object 0, the null object, is not all zeros';
    }
    const strings = b.strings.length;
    const objects = b.objects.length;
    const triple = (t, where) => {
        if (t.name >= strings)
            return `${where} names string ${t.name}, and the table holds ${strings}`;
        if (t.flag === McosValueKind.string && t.value >= strings)
            return `${where} holds string ${t.value}, and the table holds ${strings}`;
        if (t.flag === McosValueKind.cell && t.value >= sub.values.length)
            return `${where} names value cell ${t.value}, and the subsystem holds ${sub.values.length}`;
        if (t.flag === McosValueKind.object && t.value >= objects)
            return `${where} names object ${t.value}, and the table holds ${objects}`;
        if (t.flag > McosValueKind.object)
            return `${where} is of value kind ${t.flag}`;
        return null;
    };
    for (const [i, c] of b.classes.entries()) {
        if (c.namespace >= strings || c.name >= strings)
            return `class row ${i} names a string past the table's ${strings}`;
    }
    const lists = [['constructor-argument list', b.ctorLists], ['property list', b.pvLists], ['per-array entry', (b.fileHeader?.perArray ?? []).map((e) => e.triples)]];
    for (const [what, all] of lists) {
        for (const [i, list] of all.entries()) {
            for (const [j, t] of list.entries()) {
                const problem = triple(t, `triple ${j} of ${what} ${i}`);
                if (problem)
                    return problem;
            }
        }
    }
    for (const [i, o] of b.objects.entries()) {
        if (i === 0)
            continue;
        if (o.classIndex < 1 || o.classIndex >= b.classes.length)
            return `object ${i} names class row ${o.classIndex}, and the table holds ${b.classes.length}`;
        if (o.child >= objects || o.sibling >= objects)
            return `object ${i} links an object past the table's ${objects}`;
        if (o.ctorList >= Math.max(1, b.ctorLists.length))
            return `object ${i} names constructor-argument list ${o.ctorList}, and the blob holds ${b.ctorLists.length}`;
        if (o.pvList >= Math.max(1, b.pvLists.length))
            return `object ${i} names property list ${o.pvList}, and the blob holds ${b.pvLists.length}`;
        if (o.dynamicProps >= Math.max(1, b.dynamicProps.length))
            return `object ${i} names dynamic-property list ${o.dynamicProps}, and the blob holds ${b.dynamicProps.length}`;
    }
    for (const [i, list] of b.dynamicProps.entries()) {
        if (list.some((id) => id >= objects))
            return `dynamic-property list ${i} names an object past the table's ${objects}`;
    }
    for (const r of b.removedProps ?? []) {
        if (r.objectId >= objects || r.names.some((n) => n >= strings))
            return `the removed-property entry of object ${r.objectId} names what is not there`;
    }
    for (const cell of [sub.aliases, sub.packages]) {
        if (cell?.entries.some((n) => n < 0 || n >= strings))
            return 'a class alias or package names a string past the table';
    }
    return null;
}
const SECTIONS = ['class table', 'constructor-argument lists', 'object table', 'property lists', 'dynamic-property lists', 'value pointers', 'removed properties', 'file header'];
/**
 * The metadata blob of `length` bytes at `at`, every section read into records and held to end
 * exactly where the next starts: a section that ends short of its successor's offset, or runs
 * past it, is refused, since an offset left stale by an edit is exactly that.
 *
 * `handle`: the blob inside a 'handle' opaque instead (readHandleOpaque), version 1.0, whose
 * removed-property and file-header offsets are written as 0: it has neither section.
 */
function readBlob(view, at, length, handle = false) {
    if (length < 40) {
        fail('malformed', `the metadata blob is ${length} bytes, short of its 40-byte header`);
    }
    const u8 = (o) => view.getUint8(at + o);
    const u32 = (o, limit = length) => {
        if (o + 4 > limit) {
            fail('malformed', `the metadata blob is cut short at byte ${o}`);
        }
        return view.getUint32(at + o, true);
    };
    const major = u8(0);
    const minor = u8(1);
    if (u8(2) !== 0) {
        fail('unsupported', 'the metadata blob is big-endian');
    }
    if (handle ? major !== 1 || minor !== 0 : trailingCells(major, minor) === null) {
        fail('unsupported', `the metadata blob is version ${major}.${minor}, and this codec reads ${handle ? "1.0 in a 'handle' opaque" : '4.0 and 5.0'}`);
    }
    const starts = [];
    for (let i = 0; i < 8; i++) {
        let s = u32(8 + 4 * i);
        if (handle && i >= 6) {
            if (s !== 0) {
                fail('unsupported', `the 'handle' opaque's metadata blob holds ${SECTIONS[i]}, which no MATLAB-written one was seen to`);
            }
            s = length;
        }
        if (s < (starts[i - 1] ?? 40) || s > length) {
            fail('malformed', `the metadata blob's ${SECTIONS[i]} start at ${s}, out of order or out of its ${length} bytes`);
        }
        starts.push(s);
    }
    const ends = (i) => (i + 1 < 8 ? starts[i + 1] : length);
    const tiles = (i, q) => {
        if (q !== ends(i)) {
            fail('malformed', `the metadata blob's ${SECTIONS[i]} end at ${q}, not at ${ends(i)} where ${i + 1 < 8 ? `the ${SECTIONS[i + 1]} start` : 'the blob ends'}`);
        }
    };
    // Strings: NUL-terminated from byte 40, padded to 8; index 0 is the empty string.
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const strings = [''];
    const count = u32(4);
    let p = 40;
    for (let i = 0; i < count; i++) {
        let e = p;
        while (e < starts[0] && u8(e) !== 0)
            e++;
        if (e >= starts[0]) {
            fail('malformed', `the metadata blob's string table holds fewer than the ${count} strings it declares`);
        }
        try {
            strings.push(decoder.decode(new Uint8Array(view.buffer, view.byteOffset + at + p, e - p)));
        }
        catch {
            fail('malformed', `string ${i + 1} of the metadata blob is not UTF-8`);
        }
        p = e + 1;
    }
    p = 40 + align8(p - 40);
    if (p !== starts[0]) {
        fail('malformed', `the metadata blob's string table ends at ${p}, not at ${starts[0]} where the class table starts`);
    }
    // Class rows, 16 bytes: namespace and name string indices, four bytes, four unused.
    if ((starts[1] - starts[0]) % 16 !== 0) {
        fail('malformed', "the metadata blob's class table is not whole 16-byte rows");
    }
    const classes = [];
    for (let q = starts[0]; q < starts[1]; q += 16) {
        classes.push({ namespace: u32(q), name: u32(q + 4), version: [u8(q + 8), u8(q + 9), u8(q + 10), u8(q + 11)] });
    }
    // A section of lists, each a count then that many 12-byte triples, padded to 8.
    const tripleLists = (i) => {
        const lists = [];
        let q = starts[i];
        while (q < ends(i)) {
            const n = u32(q, ends(i));
            if (n > (ends(i) - q - 4) / 12) {
                fail('malformed', `a list of the metadata blob's ${SECTIONS[i]} runs past the section's end`);
            }
            lists.push(triplesAt(q + 4, n));
            q += align8(4 + 12 * n);
        }
        tiles(i, q);
        return lists;
    };
    const triplesAt = (q, n) => {
        const out = [];
        for (let j = 0; j < n; j++) {
            out.push({ name: u32(q + 12 * j), flag: u32(q + 12 * j + 4), value: u32(q + 12 * j + 8) });
        }
        return out;
    };
    const ctorLists = tripleLists(1);
    // Object rows, 24 bytes: class row, two linked objects, the three lists.
    if ((starts[3] - starts[2]) % 24 !== 0) {
        fail('malformed', "the metadata blob's object table is not whole 24-byte rows");
    }
    const objects = [];
    for (let q = starts[2]; q < starts[3]; q += 24) {
        objects.push({ classIndex: u32(q), child: u32(q + 4), sibling: u32(q + 8), ctorList: u32(q + 12), pvList: u32(q + 16), dynamicProps: u32(q + 20) });
    }
    const pvLists = tripleLists(3);
    // Dynamic-property lists: a count then that many object ids, padded to 8.
    const dynamicProps = [];
    let q = starts[4];
    while (q < ends(4)) {
        const n = u32(q, ends(4));
        if (n > (ends(4) - q - 4) / 4) {
            fail('malformed', "a list of the metadata blob's dynamic-property lists runs past the section's end");
        }
        const ids = [];
        for (let j = 0; j < n; j++)
            ids.push(u32(q + 4 + 4 * j));
        dynamicProps.push(ids);
        q += align8(4 + 4 * n);
    }
    tiles(4, q);
    // Value pointers: a byte count then the bytes, padded to 8.
    const valuePointers = [];
    q = starts[5];
    while (q < ends(5)) {
        const n = u32(q, ends(5));
        if (n > ends(5) - q - 4) {
            fail('malformed', "a value pointer of the metadata blob runs past its section's end");
        }
        valuePointers.push(new Uint8Array(view.buffer, view.byteOffset + at + q + 4, n));
        q += align8(4 + n);
    }
    tiles(5, q);
    // Removed properties, when the section is there: a count, then (object, n, n string indices)…,
    // padded to 8.
    let removedProps = null;
    if (starts[6] < starts[7]) {
        removedProps = [];
        let r = starts[6] + 4;
        for (let entries = u32(starts[6], ends(6)); entries > 0; entries--) {
            const objectId = u32(r, ends(6));
            const n = u32(r + 4, ends(6));
            if (n > (ends(6) - r - 8) / 4) {
                fail('malformed', "the metadata blob's removed properties run past the section's end");
            }
            const names = [];
            for (let j = 0; j < n; j++)
                names.push(u32(r + 8 + 4 * j));
            removedProps.push({ objectId, names });
            r += 8 + 4 * n;
        }
        tiles(6, starts[6] + align8(r - starts[6]));
    }
    // The file header, when the blob does not end before it: a count of tables and where each is,
    // padded to 8; the one table MATLAB R2027a writes there, the per-array property map, follows it:
    // a count, then (index, n, n triples)…, padded to 8, to the blob's end.
    let fileHeader = null;
    const h = starts[7];
    if (h < length) {
        const tables = u32(h);
        if (tables > 1) {
            fail('unsupported', `the metadata blob's file header holds ${tables} tables, and this codec reads one, the per-array property map`);
        }
        const mapAt = h + align8(4 + 4 * tables);
        if (tables === 0) {
            tiles(7, mapAt);
            fileHeader = { perArray: null };
        }
        else {
            if (u32(h + 4) !== mapAt) {
                fail('malformed', "the metadata blob's per-array property map is not where its file header ends");
            }
            const perArray = [];
            let r = mapAt + 4;
            for (let entries = u32(mapAt); entries > 0; entries--) {
                const index = u32(r);
                const n = u32(r + 4);
                if (n > (length - r - 8) / 12) {
                    fail('malformed', "the metadata blob's per-array property map runs past its end");
                }
                perArray.push({ index, triples: triplesAt(r + 8, n) });
                r += 8 + 12 * n;
            }
            tiles(7, mapAt + align8(r - mapAt));
            fileHeader = { perArray };
        }
    }
    return { major, minor, reserved: u8(3), strings, classes, ctorLists, objects, pvLists, dynamicProps, valuePointers, removedProps, fileHeader };
}
/**
 * The subsystem element the records say, tag included: every offset of the blob, every dims and
 * every byte count around a record computed from the records, every other sub-element the bytes
 * it holds. Throws MatWriteError for records no subsystem can say: a per-class cell without one
 * entry per class row, or one the blob's version does not write; a string with a NUL in it; a
 * number past its field; a size past what an int32 dims word can say.
 */
export function writeSubsystem(sub) {
    const b = sub.blob;
    const trailing = trailingCells(b.major, b.minor);
    if (trailing === null) {
        throw new MatWriteError(`a metadata blob of version ${b.major}.${b.minor} is not one this codec writes`);
    }
    const present = [sub.packages, sub.classData, sub.aliases, sub.defaults].filter((c) => c !== null).length;
    if (present !== trailing || (trailing === 3 && sub.packages !== null)) {
        throw new MatWriteError(`a version ${b.major}.${b.minor} subsystem has ${trailing} per-class cells, and these records hold ${present}`);
    }
    const C = b.classes.length;
    for (const [what, cell] of [['package-name', sub.packages], ['saved class data', sub.classData], ['alias', sub.aliases], ['defaults', sub.defaults]]) {
        if (cell && cell.entries.length !== C) {
            throw new MatWriteError(`the ${what} cell holds ${cell.entries.length} entries for ${C} class rows`);
        }
    }
    const blob = writeBlob(b);
    const elements = (cell) => matrixElement([cell.flags, dimsElement([C, 1]), cell.name, ...cell.entries]);
    const numbers = (cell, type, dims) => matrixElement([cell.flags, dimsElement(dims), cell.name, subElement(type, words32(cell.entries, type === MI_INT32))]);
    const cells = [
        matrixElement([sub.blobCell.flags, dimsElement([blob.length, 1]), sub.blobCell.name, subElement(MI_UINT8, blob)]),
        sub.reserved,
        ...sub.values,
    ];
    if (sub.packages)
        cells.push(numbers(sub.packages, MI_UINT32, [1, C]));
    if (sub.classData)
        cells.push(elements(sub.classData));
    if (sub.aliases)
        cells.push(numbers(sub.aliases, MI_INT32, [C, 1]));
    if (sub.defaults)
        cells.push(elements(sub.defaults));
    const cellArray = matrixElement([sub.cellArray.flags, dimsElement([cells.length, 1]), sub.cellArray.name, ...cells]);
    const opaque = matrixElement([...sub.opaqueHead, cellArray]);
    const struct = matrixElement([...sub.struct.head, ...sub.struct.fields.map((f) => f ?? opaque)]);
    const payload = concat([sub.preamble, struct, sub.rest]);
    if (payload.length > INT32_MAX) {
        throw new MatWriteError(`the subsystem would be ${payload.length} bytes, past what its int32 dims can say`);
    }
    return matrixElement([sub.outer.flags, dimsElement([1, payload.length]), sub.outer.name, subElement(MI_UINT8, payload)]);
}
/** The metadata blob the records say, every section's offset computed from what precedes it. */
function writeBlob(b, handle = false) {
    if (handle && (b.removedProps !== null || b.fileHeader !== null)) {
        throw new MatWriteError("the metadata blob of a 'handle' opaque holds no removed properties or file header");
    }
    const out = new ByteSink();
    for (const v of [b.major, b.minor, 0, b.reserved])
        out.u8(v, 'version');
    out.u32(b.strings.length - 1, 'string count');
    for (let i = 0; i < 8; i++)
        out.u32(0, 'section offset');
    const encoder = new TextEncoder();
    for (const s of b.strings.slice(1)) {
        out.bytes(stringBytes(encoder, s));
        out.u8(0, 'string table');
    }
    out.pad8();
    const starts = [];
    const triples = (list, what) => {
        for (const t of list) {
            out.u32(t.name, `${what} name`);
            out.u32(t.flag, `${what} value kind`);
            out.u32(t.value, `${what} value`);
        }
    };
    const lists = (all, what) => {
        for (const list of all) {
            out.u32(list.length, `${what} count`);
            triples(list, what);
            out.pad8();
        }
    };
    starts.push(out.length);
    for (const c of b.classes) {
        out.u32(c.namespace, 'class namespace');
        out.u32(c.name, 'class name');
        for (const v of c.version)
            out.u8(v, 'class version');
        out.u32(0, 'class row');
    }
    starts.push(out.length);
    lists(b.ctorLists, 'constructor argument');
    starts.push(out.length);
    for (const o of b.objects) {
        for (const v of [o.classIndex, o.child, o.sibling, o.ctorList, o.pvList, o.dynamicProps])
            out.u32(v, 'object row');
    }
    starts.push(out.length);
    lists(b.pvLists, 'property');
    starts.push(out.length);
    for (const ids of b.dynamicProps) {
        out.u32(ids.length, 'dynamic-property count');
        for (const id of ids)
            out.u32(id, 'dynamic property');
        out.pad8();
    }
    starts.push(out.length);
    for (const v of b.valuePointers) {
        out.u32(v.length, 'value pointer length');
        out.bytes(v);
        out.pad8();
    }
    starts.push(out.length);
    if (b.removedProps) {
        out.u32(b.removedProps.length, 'removed-property count');
        for (const r of b.removedProps) {
            out.u32(r.objectId, 'removed-property object');
            out.u32(r.names.length, 'removed-property count');
            for (const n of r.names)
                out.u32(n, 'removed property');
        }
        out.pad8();
    }
    starts.push(out.length);
    if (b.fileHeader) {
        // [1, where the map is] or [0], padded to 8: the map starts 8 bytes on either way.
        const perArray = b.fileHeader.perArray;
        const h = out.length;
        out.u32(perArray ? 1 : 0, 'file header');
        if (perArray)
            out.u32(h + 8, 'file header');
        out.pad8();
        if (perArray) {
            out.u32(perArray.length, 'per-array count');
            for (const e of perArray) {
                out.u32(e.index, 'per-array index');
                out.u32(e.triples.length, 'per-array count');
                triples(e.triples, 'per-array');
            }
            out.pad8();
        }
    }
    starts.forEach((s, i) => out.setU32(8 + 4 * i, handle && i >= 6 ? 0 : s));
    return out.result();
}
/** A string's bytes in the table: UTF-8, which cannot hold a NUL or a lone surrogate. */
function stringBytes(encoder, s) {
    if (s.includes('\0') || /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s)) {
        throw new MatWriteError(`the string ${JSON.stringify(s)} cannot be held in the metadata blob's string table`);
    }
    return encoder.encode(s);
}
// ---- Edits ------------------------------------------------------------------------------------
//
// Each edit changes the records in place and returns where it put what it added; none moves an
// existing record (APPEND ONLY, above). Each throws MatWriteError, changing nothing, for an edit
// that names what is not there or that would change something it was not asked to: an object
// with no property list of its own, a value cell another triple names too. What they do not check
// is what a whole edit leaves — a triple naming a string not yet interned, an object row not yet
// filled in — which verifySubsystem holds the written bytes to.
//
// Each refuses a subsystem of a blob version no edit was measured on (measuredVersion), which
// this codec reads and writes back for display only.
/**
 * Whether edits of `sub` were measured against MATLAB: its blob is version 4.0, what MATLAB R2027a
 * writes. A version-5.0 blob is read, and written back as read, on the layout MATLAB's package
 * names are documented to take, but no MATLAB-written one was ever seen, so no edit of one was
 * judged: an added class could extend a per-class cell that is not per class.
 */
export function measuredVersion(sub) {
    return sub.blob.major === 4 && sub.blob.minor === 0;
}
function editable(sub) {
    if (!measuredVersion(sub)) {
        throw new MatWriteError(`a version ${sub.blob.major}.${sub.blob.minor} subsystem is read for display only: no edit of one was measured against MATLAB`);
    }
}
/** The qualified name of class row `classIndex`: 'Simulink.Parameter', or 'string' in no namespace. */
export function classNameOf(sub, classIndex) {
    const row = sub.blob.classes[classIndex];
    if (!row) {
        throw new MatWriteError(`class row ${classIndex} is not one of the ${sub.blob.classes.length} the subsystem holds`);
    }
    const s = sub.blob.strings;
    return (row.namespace ? s[row.namespace] + '.' : '') + s[row.name];
}
/** The first class row naming `qualifiedName`, or 0 when none does. */
export function findClass(sub, qualifiedName) {
    for (let i = 1; i < sub.blob.classes.length; i++) {
        if (classNameOf(sub, i) === qualifiedName) {
            return i;
        }
    }
    return 0;
}
/**
 * The index of `text` in the string table: the first entry that spells it, or a new last entry
 * when none does, which is how MATLAB's save interns a string. The empty string is index 0, which
 * the table does not hold.
 */
export function internString(sub, text) {
    editable(sub);
    if (text === '') {
        return 0;
    }
    stringBytes(new TextEncoder(), text);
    const strings = sub.blob.strings;
    const at = strings.indexOf(text, 1);
    if (at > 0) {
        return at;
    }
    strings.push(text);
    return strings.length - 1;
}
/** internString of each of `texts`, in order. */
export function internStrings(sub, texts) {
    return texts.map((t) => internString(sub, t));
}
/**
 * A new class row for `spec.name`, with an entry in every per-class cell; returns its index.
 *
 * New even when the table holds the class already: MATLAB's `save -append` writes a row per class
 * per save session, and measured against MATLAB R2027a a reused row loads the same. So a caller
 * adding several objects of a class in one save uses the row it got for the first.
 *
 * Strings are interned in the order MATLAB's append interns them: the class name, its namespace,
 * the alias, the package name, then the field names of a defaults struct.
 */
export function addClass(sub, spec) {
    editable(sub);
    const dot = spec.name.lastIndexOf('.');
    const ns = dot < 0 ? '' : spec.name.slice(0, dot);
    const name = spec.name.slice(dot + 1);
    if (!name) {
        throw new MatWriteError(`'${spec.name}' is not a class name`);
    }
    for (const e of [spec.classData, spec.defaults]) {
        if (e && !isWholeElement(e)) {
            throw new MatWriteError(`a per-class entry of ${spec.name} is not one whole MAT element`);
        }
    }
    if (spec.packageName !== undefined && !sub.packages) {
        throw new MatWriteError(`a version ${sub.blob.major}.${sub.blob.minor} subsystem holds no package names`);
    }
    const encoder = new TextEncoder();
    for (const s of [name, ns, spec.alias ?? '', spec.packageName ?? ''])
        stringBytes(encoder, s);
    // A class table with no row lacks the null class 0 too, as an object table with no row lacks
    // the null object (appendObjectRow): it comes first, with its entry in every per-class cell.
    if (sub.blob.classes.length === 0) {
        sub.blob.classes.push({ namespace: 0, name: 0, version: [0, 0, 0, 0] });
        sub.packages?.entries.push(0);
        sub.classData?.entries.push(EMPTY_STRUCT.slice());
        sub.aliases?.entries.push(0);
        sub.defaults?.entries.push(EMPTY_STRUCT.slice());
    }
    const nameAt = internString(sub, name);
    const nsAt = internString(sub, ns);
    const aliasAt = spec.alias ? internString(sub, spec.alias) : 0;
    const packageAt = spec.packageName ? internString(sub, spec.packageName) : 0;
    const defaults = spec.defaults ?? EMPTY_STRUCT.slice();
    internStrings(sub, structFieldNames(defaults) ?? []);
    sub.blob.classes.push({ namespace: nsAt, name: nameAt, version: spec.version ? [...spec.version] : [0, 0, 0, 0] });
    sub.packages?.entries.push(packageAt);
    sub.classData?.entries.push(spec.classData ?? EMPTY_STRUCT.slice());
    sub.aliases?.entries.push(aliasAt);
    sub.defaults?.entries.push(defaults);
    return sub.blob.classes.length - 1;
}
/** The field names of a struct element, in order, or null for an element that is not a struct. */
export function structFieldNames(element) {
    const view = new DataView(element.buffer, element.byteOffset, element.byteLength);
    const layer = layerAt(view, 0, element.length);
    if (!layer || classOf(view, layer) !== MX_STRUCT || layer.subs.length < 5) {
        return null;
    }
    const [, , , widthSub, namesSub] = layer.subs;
    if (widthSub.type !== MI_INT32 || widthSub.bytes !== 4 || namesSub.type !== MI_INT8) {
        return null;
    }
    const width = view.getInt32(widthSub.data, true);
    if (width <= 0 || namesSub.bytes % width !== 0) {
        return namesSub.bytes === 0 ? [] : null;
    }
    const decoder = new TextDecoder();
    const names = [];
    for (let p = namesSub.data; p < namesSub.data + namesSub.bytes; p += width) {
        let e = p;
        while (e < p + width && element[e] !== 0)
            e++;
        names.push(decoder.decode(element.subarray(p, e)));
    }
    return names;
}
/**
 * A new object row, all zeros, for a caller that must hand out the object's id before it knows
 * the rest of the row: MATLAB numbers an object before the objects its properties hold, and adds
 * its class row and dynamic-property list after theirs. Returns its id.
 */
export function appendObjectRow(sub) {
    editable(sub);
    const b = sub.blob;
    // Measured against MATLAB R2027a: a .mat whose only MCOS values are of an enumeration class with
    // no superclass has no object row at all, the null object 0 included, and no property list; and
    // MATLAB's own save of it with a `string` added writes the null object and the null property
    // list 0 before the string. Without them the first object would be object 0, which MATLAB loads
    // as a deleted handle, or a default instance.
    if (b.objects.length === 0) {
        b.objects.push({ classIndex: 0, child: 0, sibling: 0, ctorList: 0, pvList: 0, dynamicProps: 0 });
        if (b.pvLists.length === 0) {
            b.pvLists.push([]);
        }
    }
    b.objects.push({ classIndex: 0, child: 0, sibling: 0, ctorList: 0, pvList: 0, dynamicProps: 0 });
    return b.objects.length - 1;
}
/**
 * A new constructor-argument list holding `triples`; returns its index. In a subsystem with no
 * list yet the null list 0 is added first, as MATLAB adds it with the first list. (Measured
 * against MATLAB R2027a: a file whose objects all saved property lists, a ConfigSet's, has no
 * constructor-argument list at all, and a first list written there as list 0 made the `string`
 * it was for fail to load.)
 */
export function appendCtorList(sub, triples = []) {
    editable(sub);
    return appendWithNull(sub.blob.ctorLists, triples.map((t) => ({ ...t })));
}
/** A new property list holding `triples`, after the null list 0 when there is none; returns its index. */
export function appendPvList(sub, triples = []) {
    editable(sub);
    return appendWithNull(sub.blob.pvLists, triples.map((t) => ({ ...t })));
}
/**
 * A new dynamic-property list holding the object ids `ids`, after the null list 0 when there is
 * none; returns its index. MATLAB gives every object it saves by property list one of its own,
 * empty for one with no dynamic properties, and writes none, null list and all, before the first.
 */
export function appendDynamicPropsList(sub, ids = []) {
    editable(sub);
    return appendWithNull(sub.blob.dynamicProps, [...ids]);
}
function appendWithNull(lists, list) {
    if (lists.length === 0) {
        lists.push([]);
    }
    lists.push(list);
    return lists.length - 1;
}
/**
 * A new object, with its lists: a constructor-argument list when `ctor` is given, a property list
 * and a dynamic-property list of its own when `pv` is given. Returns its id.
 */
export function addObject(sub, spec) {
    editable(sub);
    if (!Number.isInteger(spec.classIndex) || spec.classIndex < 1 || spec.classIndex >= sub.blob.classes.length) {
        throw new MatWriteError(`class row ${spec.classIndex} is not one of the ${sub.blob.classes.length - 1} the subsystem holds`);
    }
    if (spec.dynamicProps && !spec.pv) {
        throw new MatWriteError('an object saved without a property list has no dynamic properties');
    }
    const id = appendObjectRow(sub);
    const row = sub.blob.objects[id];
    row.classIndex = spec.classIndex;
    row.child = spec.child ?? 0;
    row.sibling = spec.sibling ?? 0;
    if (spec.ctor) {
        row.ctorList = appendCtorList(sub, spec.ctor);
    }
    if (spec.pv) {
        row.pvList = appendPvList(sub, spec.pv);
        row.dynamicProps = appendDynamicPropsList(sub, spec.dynamicProps);
    }
    return id;
}
function wholeCell(cell) {
    if (!isWholeElement(cell)) {
        throw new MatWriteError('a value cell is one whole MAT element, and this is not');
    }
    return cell;
}
/** `cell`, one whole miMATRIX element, appended after every value cell; returns its value index. */
export function addValueCell(sub, cell) {
    editable(sub);
    sub.values.push(wholeCell(cell));
    return sub.values.length - 1;
}
/**
 * Value cell `valueIndex` replaced by `cell`: what changes a stored property, and, with a
 * descriptorCell and `objectReference`, what re-points one at other objects.
 */
export function replaceValueCell(sub, valueIndex, cell, options = {}) {
    editable(sub);
    if (!Number.isInteger(valueIndex) || valueIndex < 0 || valueIndex >= sub.values.length) {
        throw new MatWriteError(`value cell ${valueIndex} is not one of the ${sub.values.length} the subsystem holds`);
    }
    wholeCell(cell);
    const handleSwap = options.handleOpaque === true && sameHandleClass(sub.values[valueIndex], cell);
    if (options.handleOpaque && !handleSwap) {
        throw new MatWriteError(`value cell ${valueIndex}, or the cell replacing it, is not a 'handle' opaque that reads whole, of the other's class`);
    }
    if (!options.objectReference && !handleSwap && (holdsObjectReference(sub.values[valueIndex]) || holdsObjectReference(cell))) {
        throw new MatWriteError(`value cell ${valueIndex} or the cell replacing it holds an object reference, not a value`);
    }
    sub.values[valueIndex] = cell;
}
/** Whether `a` and `b` are both 'handle' opaques that read whole, of one class. */
function sameHandleClass(a, b) {
    const x = readHandleOpaque(a);
    const y = readHandleOpaque(b);
    return x.ok && y.ok && firstDifference(x.opaque.head[3], y.opaque.head[3]) === null;
}
/**
 * Whether an element holds an object reference at any depth: an object, function-handle or opaque
 * element, or a uint32 array whose first word is 0xDD000000 (a nested object's handle, an
 * enumeration's tag), which MATLAB turns into objects as it loads the cell.
 */
function holdsObjectReference(element) {
    const view = new DataView(element.buffer, element.byteOffset, element.byteLength);
    const stack = [[0, element.length]];
    while (stack.length > 0) {
        const [at, end] = stack.pop();
        const layer = layerAt(view, at, end);
        if (!layer) {
            continue;
        }
        const cls = classOf(view, layer);
        if (cls === MX_OBJECT || cls === MX_FUNCTION || cls === MX_OPAQUE) {
            return true;
        }
        const re = layer.subs[3];
        if (cls === MX_UINT32 && re && re.type === MI_UINT32 && re.bytes >= 4 && view.getUint32(re.data, true) === MCOS_HANDLE_MAGIC) {
            return true;
        }
        const members = cls === MX_CELL ? layer.subs.slice(3) : cls === MX_STRUCT ? layer.subs.slice(5) : [];
        for (const m of members) {
            if (m.type === MI_MATRIX)
                stack.push([m.at, m.end]);
        }
    }
    return false;
}
/** How many triples, of every list and the per-array map, name value cell `valueIndex`. */
export function valueCellUsers(sub, valueIndex) {
    const b = sub.blob;
    let n = 0;
    for (const list of [...b.ctorLists, ...b.pvLists, ...(b.fileHeader?.perArray ?? []).map((e) => e.triples)]) {
        for (const t of list) {
            if (t.flag === McosValueKind.cell && t.value === valueIndex)
                n++;
        }
    }
    return n;
}
/**
 * The triples of object `objectId`'s property list, in order, by saved name; [] for an object
 * that saved itself as one payload and has no property list.
 */
export function propertiesOf(sub, objectId) {
    const row = objectRow(sub, objectId);
    const list = row.pvList ? sub.blob.pvLists[row.pvList] : [];
    return list.map((t) => ({ savedName: sub.blob.strings[t.name], flag: t.flag, value: t.value }));
}
function objectRow(sub, objectId) {
    if (!Number.isInteger(objectId) || objectId < 1 || objectId >= sub.blob.objects.length) {
        throw new MatWriteError(`object ${objectId} is not one of the ${sub.blob.objects.length - 1} the subsystem holds`);
    }
    return sub.blob.objects[objectId];
}
/**
 * Object `objectId`'s property list, which it must have and must not share: an edit of a list two
 * objects name would edit both. (MATLAB writes a list per object, and no file was seen sharing one.)
 */
function ownPvList(sub, objectId) {
    const row = objectRow(sub, objectId);
    if (row.pvList === 0) {
        throw new MatWriteError(`object ${objectId} saved itself as one payload, and has no property list`);
    }
    if (sub.blob.objects.some((o, id) => id !== objectId && o.pvList === row.pvList)) {
        throw new MatWriteError(`object ${objectId}'s property list is named by another object as well`);
    }
    return sub.blob.pvLists[row.pvList];
}
/**
 * `triple` inserted into object `objectId`'s property list at `position` (its end by default):
 * a property that was at its class default, which MATLAB saves no triple for, given a value.
 * Returns the position. Refuses a property the list holds already.
 */
export function insertPvTriple(sub, objectId, triple, position) {
    editable(sub);
    const list = ownPvList(sub, objectId);
    if (list.some((t) => t.name === triple.name)) {
        throw new MatWriteError(`object ${objectId} holds a triple for ${sub.blob.strings[triple.name]} already`);
    }
    const at = position ?? list.length;
    if (!Number.isInteger(at) || at < 0 || at > list.length) {
        throw new MatWriteError(`position ${at} is not in object ${objectId}'s property list of ${list.length}`);
    }
    list.splice(at, 0, { ...triple });
    return at;
}
/**
 * The triple for `savedName` removed from object `objectId`'s property list, and returned; null
 * when the list holds none. The property loads as its class default, as when MATLAB's own save
 * finds it back at the default. A value cell the triple named stays where it is, named by nothing.
 */
export function removePvTriple(sub, objectId, savedName) {
    editable(sub);
    const list = ownPvList(sub, objectId);
    const at = list.findIndex((t) => sub.blob.strings[t.name] === savedName);
    return at < 0 ? null : list.splice(at, 1)[0];
}
/**
 * Property `savedName` of object `objectId` given the value `cell`, one whole miMATRIX element:
 * its value cell replaced when it has one; otherwise the cell appended after every other and the
 * property's triple made to name it, in place when the list holds one, inserted at `position`
 * (the list's end by default) when the property was at its class default. Refuses a cell another
 * triple names too, which a replacement would change for both; and, without `objectReference`, an
 * object reference given or replaced (McosCellOptions).
 */
export function setProperty(sub, objectId, savedName, cell, position, options = {}) {
    editable(sub);
    const list = ownPvList(sub, objectId);
    wholeCell(cell);
    const at = list.findIndex((t) => sub.blob.strings[t.name] === savedName);
    const old = list[at];
    if (old && old.flag === McosValueKind.cell) {
        if (valueCellUsers(sub, old.value) > 1) {
            throw new MatWriteError(`${savedName}'s value cell is named by another triple as well`);
        }
        replaceValueCell(sub, old.value, cell, options);
        return { op: 'swap', valueIndex: old.value, position: at };
    }
    if (!options.objectReference && (old?.flag === McosValueKind.object || holdsObjectReference(cell))) {
        throw new MatWriteError(`${savedName} ${old?.flag === McosValueKind.object ? 'names an object' : 'would hold an object reference'}, not a value`);
    }
    if (old) {
        const valueIndex = addValueCell(sub, cell);
        list[at] = { name: old.name, flag: McosValueKind.cell, value: valueIndex };
        return { op: 'retype', valueIndex, position: at };
    }
    const placed = position ?? list.length;
    if (!Number.isInteger(placed) || placed < 0 || placed > list.length) {
        throw new MatWriteError(`position ${placed} is not in object ${objectId}'s property list of ${list.length}`);
    }
    const name = internString(sub, savedName);
    const valueIndex = addValueCell(sub, cell);
    list.splice(placed, 0, { name, flag: McosValueKind.cell, value: valueIndex });
    return { op: 'insert', valueIndex, position: placed };
}
// ---- Values ------------------------------------------------------------------------------------
function numelOf(dims, what) {
    if (dims.length < 2 || dims.some((d) => !Number.isInteger(d) || d < 0 || d > INT32_MAX)) {
        throw new MatWriteError(`[${dims.join(' ')}] is not the dims of ${what}`);
    }
    return dims.reduce((a, d) => a * d, 1);
}
/**
 * The value cell of an object reference: the uint32 column [0xDD000000, ndims, dims…, ids…,
 * class row], nameless, as MATLAB writes the property of an object that holds other objects (a
 * Parameter's CoderInfo) and the inside of every class-17 element. `ids` are column-major; a
 * deleted handle is id 0.
 */
export function descriptorCell(d) {
    const numel = numelOf(d.dims, 'an object reference');
    if (d.ids.length !== numel) {
        throw new MatWriteError(`an object reference of dims [${d.dims.join(' ')}] names ${numel} objects, not ${d.ids.length}`);
    }
    const words = [MCOS_HANDLE_MAGIC, d.dims.length, ...d.dims, ...d.ids, ...(d.classIndex === null ? [] : [d.classIndex])];
    return matrixElement([flagsElement(MX_UINT32), dimsElement([words.length, 1]), textElement(''), subElement(MI_UINT32, words32(words, false))]);
}
/**
 * The objects a value cell or a class-17 element names, or null when it is not an object
 * reference: a uint32 column whose first word is 0xDD000000 and that holds what its dims say,
 * plus at most the class row.
 */
export function readDescriptor(element) {
    const view = new DataView(element.buffer, element.byteOffset, element.byteLength);
    let layer = layerAt(view, 0, element.length);
    if (layer && classOf(view, layer) === MX_OPAQUE && layer.subs.length === 5) {
        const inner = layer.subs[4];
        layer = layerAt(view, inner.at, inner.end);
    }
    if (!layer || classOf(view, layer) !== MX_UINT32 || layer.subs.length !== 4) {
        return null;
    }
    const dims = dimsIn(view, layer.subs[1]);
    const data = layer.subs[3];
    if (!dims || dims.length !== 2 || dims[1] !== 1 || data.type !== MI_UINT32 || data.bytes !== 4 * dims[0] || dims[0] < 3) {
        return null;
    }
    const w = [];
    for (let p = data.data; p < data.data + data.bytes; p += 4)
        w.push(view.getUint32(p, true));
    const nd = w[1];
    if (w[0] !== MCOS_HANDLE_MAGIC || 2 + nd > w.length) {
        return null;
    }
    const extents = w.slice(2, 2 + nd);
    const numel = extents.reduce((a, d) => a * d, 1);
    const rest = w.length - 2 - nd - numel;
    if (rest < 0 || rest > 1) {
        return null;
    }
    return { dims: extents, ids: w.slice(2 + nd, 2 + nd + numel), classIndex: rest === 1 ? w[w.length - 1] : null };
}
/**
 * A class-17 element naming objects of the subsystem: what a variable holding them is, or a
 * struct field or a cell holding them in a variable (name ''). `className` is the name the
 * variable shows, the class's oldest name for a renamed class.
 */
export function objectReferenceElement(name, className, d) {
    return matrixElement([flagsElement(MX_OPAQUE), textElement(name), textElement('MCOS'), textElement(className), descriptorCell(d)]);
}
/**
 * The class-17 element of an enumeration value of class `className` that a struct field or a cell
 * holds (name ''), made of `element`, the one it was read as; or null where that is not one. Its
 * fourth part is no handle but MATLAB's instance struct, EnumerationInstanceTag its first field
 * (MatParser.enumerationInstanceOf), which names the class by row and each enumeral by its string
 * and its object, all of the subsystem, which no edit here renumbers (APPEND ONLY): so the struct
 * is kept as it was read, and the rest restated as objectReferenceElement writes it.
 */
export function enumerationReferenceElement(className, element) {
    const view = new DataView(element.buffer, element.byteOffset, element.byteLength);
    const layer = layerAt(view, 0, element.length);
    if (!layer || layer.end !== element.length || classOf(view, layer) !== MX_OPAQUE || layer.subs.length !== 5) {
        return null;
    }
    const held = layer.subs[4];
    const instance = element.subarray(held.at, held.end);
    if (held.type !== MI_MATRIX || structFieldNames(instance)?.[0] !== 'EnumerationInstanceTag') {
        return null;
    }
    return matrixElement([flagsElement(MX_OPAQUE), textElement(''), textElement('MCOS'), textElement(className), instance]);
}
const MISSING_TEXT = 0xffffffffffffffffn;
/**
 * The value cell of a `string` array: a uint64 row [1, ndims, dims…, one length per element
 * (UTF-16 code units; 2^64 - 1 for <missing>), then every element's code units packed, zero-padded
 * to 8 bytes]. `texts` are column-major, null for <missing>.
 */
export function stringPayloadCell(texts, dims) {
    const numel = numelOf(dims, 'a string array');
    if (texts.length !== numel) {
        throw new MatWriteError(`a string array of dims [${dims.join(' ')}] holds ${numel} elements, not ${texts.length}`);
    }
    const head = 2 + dims.length + numel;
    const units = texts.reduce((a, t) => a + (t === null ? 0 : t.length), 0);
    const payload = new Uint8Array(8 * head + align8(2 * units));
    const view = new DataView(payload.buffer);
    const words = [1n, BigInt(dims.length), ...dims.map(BigInt), ...texts.map((t) => (t === null ? MISSING_TEXT : BigInt(t.length)))];
    words.forEach((w, i) => view.setBigUint64(8 * i, w, true));
    let p = 8 * head;
    for (const t of texts) {
        for (let i = 0; t !== null && i < t.length; i++, p += 2)
            view.setUint16(p, t.charCodeAt(i), true);
    }
    return matrixElement([flagsElement(MX_UINT64), dimsElement([1, payload.length / 8]), textElement(''), subElement(MI_UINT64, payload)]);
}
/** The texts a `string` value cell holds, column-major (null for <missing>), and its dims; or null. */
export function readStringPayload(cell) {
    const view = new DataView(cell.buffer, cell.byteOffset, cell.byteLength);
    const layer = layerAt(view, 0, cell.length);
    const data = layer?.subs[3];
    if (!layer || classOf(view, layer) !== MX_UINT64 || layer.subs.length !== 4 || !data || data.type !== MI_UINT64 || data.bytes % 8 !== 0 || data.bytes < 16) {
        return null;
    }
    const word = (i) => view.getBigUint64(data.data + 8 * i, true);
    const count = data.bytes / 8;
    if (word(0) !== 1n || word(1) > BigInt(count - 2)) {
        return null;
    }
    const nd = Number(word(1));
    const dims = [];
    for (let i = 0; i < nd; i++) {
        const d = word(2 + i);
        if (d > BigInt(INT32_MAX))
            return null;
        dims.push(Number(d));
    }
    const numel = dims.reduce((a, d) => a * d, 1);
    if (2 + nd + numel > count) {
        return null;
    }
    const texts = [];
    let p = data.data + 8 * (2 + nd + numel);
    const end = data.data + data.bytes;
    for (let i = 0; i < numel; i++) {
        const n = word(2 + nd + i);
        if (n === MISSING_TEXT) {
            texts.push(null);
            continue;
        }
        if (n > BigInt((end - p) / 2)) {
            return null;
        }
        const codes = [];
        for (let j = 0; j < Number(n); j++, p += 2)
            codes.push(view.getUint16(p, true));
        let text = '';
        for (let j = 0; j < codes.length; j += 4096)
            text += String.fromCharCode(...codes.slice(j, j + 4096));
        texts.push(text);
    }
    return { dims, texts };
}
/**
 * A new `string` object holding the array `texts` (column-major, null for <missing>) of `dims`:
 * one object holds the whole array, saved as one constructor argument of type 'any' naming its
 * payload cell. `classIndex` is the string class row to use, a new one by default. Strings are
 * interned as MATLAB interns them, 'any' before 'string'. Returns the object's id, its class row
 * and its payload's value index; the variable naming it is a class-17 element of dims [1 1]
 * whatever the array's (objectReferenceElement).
 */
export function addStringObject(sub, texts, dims, classIndex) {
    editable(sub);
    const cell = stringPayloadCell(texts, dims);
    if (classIndex !== undefined && classNameOf(sub, classIndex) !== 'string') {
        throw new MatWriteError(`class row ${classIndex} is ${classNameOf(sub, classIndex)}, not string`);
    }
    const any = internString(sub, 'any');
    const ci = classIndex ?? addClass(sub, { name: 'string' });
    const valueIndex = addValueCell(sub, cell);
    const objectId = addObject(sub, { classIndex: ci, ctor: [{ name: any, flag: McosValueKind.cell, value: valueIndex }] });
    return { objectId, classIndex: ci, valueIndex };
}
/** The texts and dims of `string` object `objectId`, or null when it is not one. */
export function stringObjectOf(sub, objectId) {
    const row = objectRow(sub, objectId);
    const list = row.ctorList ? sub.blob.ctorLists[row.ctorList] : null;
    if (row.pvList !== 0 || !list || list.length !== 1 || classNameOf(sub, row.classIndex) !== 'string') {
        return null;
    }
    const [t] = list;
    if (sub.blob.strings[t.name] !== 'any' || t.flag !== McosValueKind.cell) {
        return null;
    }
    const payload = readStringPayload(sub.values[t.value]);
    return payload && { valueIndex: t.value, ...payload };
}
/**
 * Whether value cell `cell` names objects of its subsystem: 'descriptor' for an object reference
 * (readDescriptor reads it), 'nested' for an MCOS opaque, an enumeration or an object reference
 * anywhere inside a struct or a cell (and for an element of a kind not looked into), 'none' for a
 * value, a 'handle' opaque included.
 */
export function valueCellReferences(cell) {
    const view = new DataView(cell.buffer, cell.byteOffset, cell.byteLength);
    const layer = layerAt(view, 0, cell.length);
    if (layer && classOf(view, layer) === MX_UINT32 && readDescriptor(cell)) {
        return 'descriptor';
    }
    return namesObjects(cell, view, 0, cell.length) ? 'nested' : 'none';
}
// A plain value is a char, sparse or numeric class (double … uint64; logical sits in the flags).
// Anything but those, a struct, a cell or an opaque is not looked into, and counts as naming objects.
function namesObjects(bytes, view, at, end) {
    const layer = layerAt(view, at, end);
    if (!layer) {
        // The bare 8-byte [] (and nothing else a cell holds) is not a layer.
        return false;
    }
    const cls = classOf(view, layer);
    const children = (from) => layer.subs.slice(from).some((s) => s.type === MI_MATRIX && namesObjects(bytes, view, s.at, s.end));
    if (cls === MX_UINT32) {
        return readDescriptor(bytes.subarray(layer.at, layer.end)) !== null;
    }
    if (cls === MX_CHAR || cls === MX_SPARSE || (cls >= MX_DOUBLE && cls <= MX_UINT64)) {
        return false;
    }
    if (cls === MX_CELL) {
        return children(3);
    }
    if (cls === MX_STRUCT) {
        const names = structFieldNames(bytes.subarray(layer.at, layer.end));
        return names === null || names.includes('EnumerationInstanceTag') || children(5);
    }
    if (cls === MX_OPAQUE && layer.subs.length === 5) {
        return !spells(bytes, layer.subs[2].data, layer.subs[2].bytes, 'handle');
    }
    return true;
}
/**
 * `element` with every object reference inside it — itself, or in a field or a cell at any depth
 * — replaced by `rename(reference)`, called once per reference in the order they lie: how the
 * objects a class's defaults struct holds are given their rows in another subsystem. A new
 * reference must have the old one's dims and its class row or none, so that it takes the bytes
 * the old one took. Throws MatWriteError, writing nothing, for a reference this cannot reach:
 * one inside an MCOS opaque or an enumeration, or an element of a kind not looked into.
 */
export function mapObjectReferences(element, rename) {
    const view = new DataView(element.buffer, element.byteOffset, element.byteLength);
    const found = [];
    const walk = (at, end) => {
        const layer = layerAt(view, at, end);
        if (!layer)
            return;
        const cls = classOf(view, layer);
        if (cls === MX_UINT32) {
            if (readDescriptor(element.subarray(layer.at, layer.end)))
                found.push(layer.subs[3]);
            return;
        }
        if (cls === MX_CHAR || cls === MX_SPARSE || (cls >= MX_DOUBLE && cls <= MX_UINT64))
            return;
        if (cls === MX_OPAQUE && layer.subs.length === 5 && spells(element, layer.subs[2].data, layer.subs[2].bytes, 'handle'))
            return;
        const names = cls === MX_STRUCT ? structFieldNames(element.subarray(layer.at, layer.end)) : null;
        if ((cls !== MX_CELL && cls !== MX_STRUCT) || (cls === MX_STRUCT && (!names || names.includes('EnumerationInstanceTag')))) {
            throw new MatWriteError('an object reference inside an opaque, an enumeration or an element of an unread kind cannot be renamed');
        }
        for (const s of layer.subs.slice(cls === MX_CELL ? 3 : 5)) {
            if (s.type === MI_MATRIX)
                walk(s.at, s.end);
        }
    };
    walk(0, element.length);
    const out = element.slice();
    const outView = new DataView(out.buffer);
    for (const data of found) {
        const old = descriptorAt(view, data);
        const next = rename(old);
        if (next.dims.length !== old.dims.length || next.dims.some((d, i) => d !== old.dims[i]) || (next.classIndex === null) !== (old.classIndex === null)) {
            throw new MatWriteError(`an object reference of dims [${old.dims.join(' ')}] cannot be renamed to one of dims [${next.dims.join(' ')}] in place`);
        }
        const words = [MCOS_HANDLE_MAGIC, next.dims.length, ...next.dims, ...next.ids, ...(next.classIndex === null ? [] : [next.classIndex])];
        words.forEach((w, i) => outView.setUint32(data.data + 4 * i, w, true));
    }
    return out;
}
/** The descriptor whose uint32 words are sub-element `data`. */
function descriptorAt(view, data) {
    const w = [];
    for (let p = data.data; p < data.data + data.bytes; p += 4)
        w.push(view.getUint32(p, true));
    const nd = w[1];
    const dims = w.slice(2, 2 + nd);
    const numel = dims.reduce((a, d) => a * d, 1);
    return { dims, ids: w.slice(2 + nd, 2 + nd + numel), classIndex: w.length > 2 + nd + numel ? w[w.length - 1] : null };
}
/**
 * The fields of a 1x1 struct element, in order, each with its value element (tag included); []
 * for a struct with no fields (the 1x0 one MATLAB writes for a class with no defaults); null for
 * anything else. What a class's defaults struct says its properties default to.
 */
export function structFields(element) {
    const view = new DataView(element.buffer, element.byteOffset, element.byteLength);
    const layer = layerAt(view, 0, element.length);
    const names = structFieldNames(element);
    if (names && names.length === 0) {
        return [];
    }
    const dims = layer ? dimsIn(view, layer.subs[1]) : null;
    if (!layer || !names || !dims || dims.length !== 2 || dims[0] !== 1 || dims[1] !== 1 || layer.subs.length !== 5 + names.length) {
        return null;
    }
    return names.map((name, i) => ({ name, value: element.subarray(layer.subs[5 + i].at, layer.subs[5 + i].end) }));
}
/** The stream's trailing element as layers: the uint8 element, and the struct its payload holds. */
function trailingStruct(rest) {
    const view = new DataView(rest.buffer, rest.byteOffset, rest.byteLength);
    const outer = layerAt(view, 0, rest.length);
    const data = outer?.subs[3];
    if (!outer || outer.end !== rest.length || classOf(view, outer) !== MX_UINT8 || outer.subs.length !== 4 || !data || data.type !== MI_UINT8
        || data.bytes < 16 || PREAMBLE.some((v, i) => rest[data.data + i] !== v)) {
        return null;
    }
    const struct = layerAt(view, data.data + 8, data.data + data.bytes);
    if (!struct || struct.end !== data.data + data.bytes || classOf(view, struct) !== MX_STRUCT) {
        return null;
    }
    const names = structFieldNames(rest.subarray(struct.at, struct.end));
    return names && struct.subs.length === 5 + names.length ? { outer, struct, names } : null;
}
/**
 * The class systems the subsystem's stream holds objects of: the field names of the struct in
 * its trailing element, ['MCOS'] as MATLAB R2027a writes it, ['MCOS', 'handle'] once a 'handle'
 * opaque is saved; null when the trailing element is not that shape.
 */
export function classSystemsOf(sub) {
    return trailingStruct(sub.rest)?.names ?? null;
}
/**
 * Each of `names` the stream's trailing struct does not hold given to it as a field, last, holding
 * [] — what MATLAB R2023b writes there in a file a 'handle' opaque is saved in. The fields it
 * holds keep their values; the field-name width is restated, the longest name and its NUL.
 */
export function addClassSystems(sub, names) {
    const t = trailingStruct(sub.rest);
    if (!t) {
        throw new MatWriteError("the subsystem's trailing element is not the struct of class systems MATLAB writes");
    }
    const missing = names.filter((n, i) => !t.names.includes(n) && names.indexOf(n) === i);
    if (missing.length === 0) {
        return;
    }
    // As MATLAB's own append was measured: the stream given a class system it lacks holds none but
    // those named (MCOS); another beside them was never seen, nor where a new one would go.
    const other = t.names.filter((n) => n !== 'MCOS' && !names.includes(n));
    if (other.length > 0) {
        throw new MatWriteError(`the subsystem's stream holds ${other.join(', ')} objects, beside which no ${missing.join(', ')} system was measured`);
    }
    const encoder = new TextEncoder();
    const all = [...t.names, ...missing];
    const width = Math.max(...all.map((n) => encoder.encode(n).length)) + 1;
    const table = new Uint8Array(width * all.length);
    all.forEach((n, i) => table.set(encoder.encode(n), i * width));
    const rest = sub.rest;
    const piece = (s) => rest.subarray(s.at, s.end);
    const [flags, dims, name] = t.struct.subs;
    const struct = matrixElement([piece(flags), piece(dims), piece(name), subElement(MI_INT32, words32([width], true)), subElement(MI_INT8, table),
        ...t.struct.subs.slice(5).map(piece), ...missing.map(() => matrixElement([]))]);
    const payload = concat([PREAMBLE, struct]);
    sub.rest = matrixElement([piece(t.outer.subs[0]), dimsElement([1, payload.length]), piece(t.outer.subs[2]), subElement(MI_UINT8, payload)]);
}
/** Whether `cell` is a 'handle' opaque element, whether or not the rest of it reads. */
export function isHandleOpaque(cell) {
    const view = new DataView(cell.buffer, cell.byteOffset, cell.byteLength);
    const layer = layerAt(view, 0, cell.length);
    return !!layer && classOf(view, layer) === MX_OPAQUE && layer.subs.length === 5 && spells(cell, layer.subs[2].data, layer.subs[2].bytes, 'handle');
}
/**
 * Reads a 'handle' opaque value cell whole into records; or refuses it, as readSubsystem refuses a
 * subsystem: a layer or section that does not parse exactly, a record naming what is not there, a
 * kind not measured, or records that would not write back as its bytes.
 */
export function readHandleOpaque(cell) {
    try {
        const opaque = readHandleLayers(cell);
        let again;
        try {
            again = writeHandleOpaque(opaque);
        }
        catch (e) {
            if (e instanceof MatWriteError) {
                fail('not-canonical', `its records do not write back: ${e.message}`);
            }
            throw e;
        }
        const at = firstDifference(again, cell);
        if (at !== null) {
            fail('not-canonical', `its records write back as other bytes, from byte ${at} of ${cell.length}`);
        }
        return { ok: true, opaque };
    }
    catch (e) {
        if (e instanceof Refused) {
            return e.refusal;
        }
        throw e;
    }
}
function readHandleLayers(cell) {
    const view = new DataView(cell.buffer, cell.byteOffset, cell.byteLength);
    const piece = (sub) => cell.subarray(sub.at, sub.end);
    const layer = layerAt(view, 0, cell.length);
    if (!layer || layer.end !== cell.length || !isHandleOpaque(cell)) {
        fail('malformed', "the cell is not a 'handle' opaque");
    }
    const holder = layer.subs[4];
    const inner = layerAt(view, holder.at, holder.end);
    const dims = inner ? dimsIn(view, inner.subs[1]) : null;
    if (!inner || inner.end !== holder.end || classOf(view, inner) !== MX_CELL || !dims || inner.subs.length < 5) {
        fail('malformed', "the 'handle' opaque holds no cell of a blob, a reference and values");
    }
    const cells = inner.subs.slice(3);
    if (dims.reduce((a, d) => a * d, 1) !== cells.length || cells.some((c) => c.type !== MI_MATRIX)) {
        fail('malformed', "the 'handle' opaque's cell does not hold the cells its dims declare");
    }
    const blobCell = layerAt(view, cells[0].at, cells[0].end);
    const data = blobCell?.subs[3];
    const blobDims = blobCell ? dimsIn(view, blobCell.subs[1]) : null;
    if (!blobCell || !data || blobCell.subs.length !== 4 || classOf(view, blobCell) !== MX_UINT8 || data.type !== MI_UINT8
        || !blobDims || blobDims.length !== 2 || blobDims[0] * blobDims[1] !== data.bytes || (blobDims[0] !== 1 && blobDims[1] !== 1)) {
        fail('malformed', "the 'handle' opaque's first cell is not its metadata blob");
    }
    const blob = readBlob(view, data.data, data.bytes, true);
    for (const [k, c] of cells.slice(2).entries()) {
        if (!isWholeElement(piece(c))) {
            fail('malformed', `value cell ${k} of the 'handle' opaque is not one whole MAT element`);
        }
    }
    const records = {
        head: layer.subs.slice(0, 4).map(piece),
        cellArray: { flags: piece(inner.subs[0]), name: piece(inner.subs[2]) },
        blobCell: { flags: piece(blobCell.subs[0]), name: piece(blobCell.subs[2]), row: blobDims[0] === 1 && blobDims[1] !== 1 },
        blob,
        root: piece(cells[1]),
        values: cells.slice(2).map(piece),
    };
    const dangling = danglingReference({ blob, values: records.values, aliases: null, packages: null });
    if (dangling) {
        fail('malformed', `in the 'handle' opaque, ${dangling}`);
    }
    return records;
}
/** The 'handle' opaque value cell the records say: the blob's offsets and every dims and size restated. */
export function writeHandleOpaque(h) {
    const blob = writeBlob(h.blob, true);
    const blobCell = matrixElement([h.blobCell.flags, dimsElement(h.blobCell.row ? [1, blob.length] : [blob.length, 1]), h.blobCell.name, subElement(MI_UINT8, blob)]);
    const cells = [blobCell, h.root, ...h.values];
    return matrixElement([...h.head, matrixElement([h.cellArray.flags, dimsElement([cells.length, 1]), h.cellArray.name, ...cells])]);
}
const CODER_INFO_SAVED = { StorageClass: 'StorageClass', Identifier: 'Alias', Alignment: 'Alignment' };
// The storage classes an edit was measured writing into a 'handle' blob (MATLAB R2023b and R2024b):
// each built-in one saved by its name, as a string index, but ImportedExternPointer, a char cell;
// and 'Model default', which MATLAB saves as SimulinkGlobal.
const HANDLE_STORAGE_CLASSES = {
    Auto: { saved: 'Auto', charCell: false },
    ExportedGlobal: { saved: 'ExportedGlobal', charCell: false },
    ImportedExtern: { saved: 'ImportedExtern', charCell: false },
    ImportedExternPointer: { saved: 'ImportedExternPointer', charCell: true },
    SimulinkGlobal: { saved: 'SimulinkGlobal', charCell: false },
    'Model default': { saved: 'SimulinkGlobal', charCell: false },
};
/**
 * The StorageClass, Identifier and Alignment a 'handle' opaque CoderInfo holds, for display; or why
 * not: an opaque that does not read, or holds another class (a Signal's LoggingInfo), or a CoderInfo
 * that saves one of the three in a form not measured.
 */
export function handleCoderInfoOf(cell) {
    try {
        const read = readHandleOpaque(cell);
        if (!read.ok) {
            return read;
        }
        const h = read.opaque;
        const triple = coderInfoTriple(h);
        const text = (key) => {
            const t = triple(key);
            const value = t.flag === McosValueKind.string ? h.blob.strings[t.value] : t.flag === McosValueKind.cell ? charText(h.values[t.value]) : null;
            if (value === null) {
                fail('unsupported', `the CoderInfo saves ${CODER_INFO_SAVED[key]} as other than text`);
            }
            return value;
        };
        const t = triple('Alignment');
        const alignment = t.flag === McosValueKind.integer ? t.value : t.flag === McosValueKind.cell ? scalarOf(h.values[t.value]) : null;
        if (alignment === null) {
            fail('unsupported', 'the CoderInfo saves Alignment as other than one number');
        }
        return { ok: true, settings: { StorageClass: text('StorageClass'), Identifier: text('Identifier'), Alignment: alignment } };
    }
    catch (e) {
        if (e instanceof Refused) {
            return e.refusal;
        }
        // What shows a file never throws: anything else this read could not take is a refusal too.
        return { ok: false, reason: 'malformed', message: `the 'handle' opaque does not read as a CoderInfo (${e instanceof Error ? e.message : String(e)})` };
    }
}
/**
 * The 'handle' opaque CoderInfo value cell `cell` with `edits` made, written as MATLAB's own edit
 * writes it (above): StorageClass as HANDLE_STORAGE_CLASSES says, a string index or a char cell;
 * Identifier as the Alias char cell; Alignment as a double cell. Only a storage class written so
 * was measured, and any other is refused ('unsupported'), as is any edit of a CoderInfo whose
 * storage class is another now (a custom one, whose attributes an edit may change too); no other
 * value is judged here (whether MATLAB takes it, under that storage class, is the caller's to
 * judge). None is made in place: the cell is new. Or why not: an opaque that does not read, holds
 * another class, or does not save the property edited.
 */
export function editHandleCoderInfo(cell, edits) {
    try {
        const read = readHandleOpaque(cell);
        if (!read.ok) {
            return read;
        }
        const h = read.opaque;
        const triple = coderInfoTriple(h);
        const held = triple('StorageClass');
        const now = held.flag === McosValueKind.string ? h.blob.strings[held.value] : held.flag === McosValueKind.cell ? charText(h.values[held.value]) : null;
        if (now === null || !Object.values(HANDLE_STORAGE_CLASSES).some((c) => c.saved === now)) {
            fail('unsupported', `the CoderInfo's storage class is ${now === null ? 'saved as other than text' : JSON.stringify(now)}, under which no edit was measured; those measured are ${Object.keys(HANDLE_STORAGE_CLASSES).join(', ')}`);
        }
        const storage = edits.StorageClass === undefined ? null : Object.hasOwn(HANDLE_STORAGE_CLASSES, edits.StorageClass) ? HANDLE_STORAGE_CLASSES[edits.StorageClass] : undefined;
        if (storage === undefined) {
            fail('unsupported', `no edit to storage class ${JSON.stringify(edits.StorageClass)} was measured; those measured are ${Object.keys(HANDLE_STORAGE_CLASSES).join(', ')}`);
        }
        for (const key of ['StorageClass', 'Identifier', 'Alignment']) {
            const v = edits[key];
            if (v === undefined) {
                continue;
            }
            const t = triple(key);
            if (key === 'StorageClass' && storage && !storage.charCell) {
                t.flag = McosValueKind.string;
                t.value = handleString(h.blob, storage.saved);
                continue;
            }
            const value = key === 'Alignment' ? doubleCell(Number(v)) : charCell(key === 'StorageClass' && storage ? storage.saved : String(v));
            if (t.flag === McosValueKind.cell) {
                h.values[t.value] = value;
            }
            else {
                h.values.push(value);
                t.flag = McosValueKind.cell;
                t.value = h.values.length - 1;
            }
        }
        rebuildAsMatlab(h);
        const out = writeHandleOpaque(h);
        const back = readHandleOpaque(out);
        const at = back.ok ? differenceAt(back.opaque, h, '') : 'its bytes';
        if (at !== null) {
            throw new MatWriteError(`the edited 'handle' opaque reads back with ${at || 'its records'} other than meant`);
        }
        return { ok: true, cell: out };
    }
    catch (e) {
        if (e instanceof Refused) {
            return e.refusal;
        }
        throw e;
    }
}
/**
 * Every property object 1 of a 'handle' opaque saves, and its class: the whole object, as every
 * property is saved there (above). Each as R2027a's MCOS decode reads the same object's
 * (McosParser): text as text, a logical or a real numeric scalar as itself, an object it holds as
 * `{_object_class, _properties}` of that object's own. So a copy of the object it is a property of
 * carries all of it: a CoderInfo read for its StorageClass, Identifier and Alignment alone went into
 * a dictionary without its CSCPackageName, and MATLAB R2027a loaded it warning that the package of
 * its custom storage classes had changed from 'Simulink' to ''. Or why not: an opaque that does not
 * read, or a property saved in a form not read here.
 */
export function handleObjectOf(cell) {
    try {
        const read = readHandleOpaque(cell);
        if (!read.ok) {
            return read;
        }
        const h = read.opaque;
        const b = h.blob;
        const classOfObject = (id) => {
            const cls = b.objects[id] && b.classes[b.objects[id].classIndex];
            if (!cls) {
                fail('malformed', `the 'handle' opaque names object ${id}, which it does not hold`);
            }
            return (cls.namespace ? b.strings[cls.namespace] + '.' : '') + b.strings[cls.name];
        };
        const objectOf = (id, held) => {
            if (held.has(id)) {
                fail('unsupported', `object ${id} of the 'handle' opaque holds itself`);
            }
            const within = new Set(held).add(id);
            const out = {};
            for (const t of b.objects[id].pvList ? b.pvLists[b.objects[id].pvList] ?? [] : []) {
                const name = b.strings[t.name];
                if (t.flag === McosValueKind.string) {
                    out[name] = b.strings[t.value];
                }
                else if (t.flag === McosValueKind.integer) {
                    out[name] = t.value;
                }
                else if (t.flag === McosValueKind.object) {
                    out[name] = { _object_class: classOfObject(t.value), _properties: objectOf(t.value, within) };
                }
                else {
                    const value = h.values[t.value];
                    const ref = value ? readDescriptor(value) : null;
                    if (ref && ref.ids.length === 1 && ref.dims.every((d) => d === 1)) {
                        out[name] = { _object_class: classOfObject(ref.ids[0]), _properties: objectOf(ref.ids[0], within) };
                        continue;
                    }
                    const plain = value ? handleValueOf(value) : undefined;
                    if (plain === undefined) {
                        fail('unsupported', `the ${classOfObject(id)} saves ${name} as other than text, a logical, a number or one object`);
                    }
                    out[name] = plain;
                }
            }
            return out;
        };
        return { ok: true, className: classOfObject(1), properties: objectOf(1, new Set()) };
    }
    catch (e) {
        if (e instanceof Refused) {
            return e.refusal;
        }
        return { ok: false, reason: 'malformed', message: `the 'handle' opaque does not read (${e instanceof Error ? e.message : String(e)})` };
    }
}
// A value cell of a 'handle' opaque as R2027a's decode reads the same property: a char row (or an
// empty char) as its text, a logical scalar as true or false, a real numeric scalar as its number;
// undefined for any other.
function handleValueOf(cell) {
    const view = new DataView(cell.buffer, cell.byteOffset, cell.byteLength);
    const layer = layerAt(view, 0, cell.length);
    if (!layer) {
        return undefined;
    }
    const cls = classOf(view, layer);
    const flags = view.getUint8(layer.subs[0].data + 1);
    if (cls === MX_CHAR) {
        const dims = dimsIn(view, layer.subs[1]);
        return dims && dims.length === 2 && (dims[0] === 1 || dims[0] * dims[1] === 0) ? charText(cell) ?? undefined : undefined;
    }
    // The complex flag (0x08): no real scalar.
    if (flags & 0x08) {
        return undefined;
    }
    const n = scalarOf(cell);
    if (n === null) {
        return undefined;
    }
    // The logical flag (0x02), on a uint8.
    if (flags & 0x02) {
        return cls === MX_UINT8 && (n === 0 || n === 1) ? n === 1 : undefined;
    }
    return n;
}
/** The finder of object 1's triples by setting, refusing an opaque whose object 1 is not a CoderInfo. */
function coderInfoTriple(h) {
    const b = h.blob;
    const row = b.objects[1];
    const cls = row && b.classes[row.classIndex];
    const name = cls ? (cls.namespace ? b.strings[cls.namespace] + '.' : '') + b.strings[cls.name] : null;
    if (name !== 'Simulink.CoderInfo') {
        fail('unsupported', `the 'handle' opaque holds ${name ? `a ${name}` : 'no object'}, and only a Simulink.CoderInfo's storage class, identifier and alignment are read and edited`);
    }
    const list = row.pvList ? b.pvLists[row.pvList] : [];
    return (key) => {
        const t = list.find((x) => b.strings[x.name] === CODER_INFO_SAVED[key]);
        if (!t) {
            fail('unsupported', `the CoderInfo saves no ${CODER_INFO_SAVED[key]}`);
        }
        return t;
    };
}
/** The index of `text` in a 'handle' blob's table, where '' is an entry of its own: the first that spells it, or a new last one. */
function handleString(b, text) {
    stringBytes(new TextEncoder(), text);
    const at = b.strings.indexOf(text, 1);
    if (at > 0) {
        return at;
    }
    b.strings.push(text);
    return b.strings.length - 1;
}
/**
 * The opaque's blob written again as MATLAB writes it: strings in the order first used (each
 * object's class namespace and name, then each triple's name and its string value, an object a
 * value cell references visited where the reference is), value cells in the order of the triples;
 * a string or cell no longer used gone. Objects, class rows and lists keep their numbers.
 */
function rebuildAsMatlab(h) {
    const b = h.blob;
    const users = new Map();
    for (const [id, o] of b.objects.entries()) {
        if (id === 0)
            continue;
        if (o.ctorList !== 0) {
            fail('unsupported', `object ${id} of the 'handle' opaque saved constructor arguments, which no MATLAB-written one was seen to`);
        }
        if (o.pvList)
            users.set(o.pvList, (users.get(o.pvList) ?? 0) + 1);
    }
    if ([...users.values()].some((n) => n > 1)) {
        fail('unsupported', "two objects of the 'handle' opaque name one property list");
    }
    // An edit of a cell two triples name would edit both: none was seen in a file MATLAB wrote.
    const cellUsers = new Map();
    for (const list of [...users.keys()].map((i) => b.pvLists[i] ?? [])) {
        for (const t of list)
            if (t.flag === McosValueKind.cell)
                cellUsers.set(t.value, (cellUsers.get(t.value) ?? 0) + 1);
    }
    if ([...cellUsers.values()].some((n) => n > 1)) {
        fail('unsupported', "two triples of the 'handle' opaque name one value cell");
    }
    const old = b.strings;
    const strings = [''];
    const where = new Map();
    const take = (i) => {
        const text = old[i];
        let k = where.get(text);
        if (k === undefined) {
            strings.push(text);
            k = strings.length - 1;
            where.set(text, k);
        }
        return k;
    };
    const values = [];
    const seen = new Set();
    const classes = new Map();
    const visit = (id) => {
        if (seen.has(id))
            return;
        if (id < 1 || id >= b.objects.length) {
            fail('malformed', `a value cell of the 'handle' opaque names object ${id}, and its table holds ${b.objects.length}`);
        }
        seen.add(id);
        const o = b.objects[id];
        if (!classes.has(o.classIndex)) {
            const c = b.classes[o.classIndex];
            const ns = c.namespace ? take(c.namespace) : 0;
            classes.set(o.classIndex, [ns, take(c.name)]);
        }
        for (const t of o.pvList ? b.pvLists[o.pvList] : []) {
            t.name = take(t.name);
            if (t.flag === McosValueKind.string) {
                t.value = take(t.value);
            }
            else if (t.flag === McosValueKind.cell) {
                const cell = h.values[t.value];
                values.push(cell);
                t.value = values.length - 1;
                for (const child of readDescriptor(cell)?.ids ?? [])
                    visit(child);
            }
        }
    };
    for (let id = 1; id < b.objects.length; id++)
        visit(id);
    for (let ci = 1; ci < b.classes.length; ci++) {
        if (!classes.has(ci)) {
            fail('unsupported', `class row ${ci} of the 'handle' opaque has no object`);
        }
    }
    for (const [ci, [ns, nm]] of classes) {
        b.classes[ci].namespace = ns;
        b.classes[ci].name = nm;
    }
    b.strings = strings;
    h.values = values;
}
/** A char row value cell as MATLAB writes one: ASCII as miUTF8, anything else as miUTF16; '' as 0x0. */
function charCell(text) {
    const ascii = /^[\x00-\x7f]*$/.test(text);
    let payload = new TextEncoder().encode(text);
    if (!ascii) {
        payload = new Uint8Array(2 * text.length);
        const view = new DataView(payload.buffer);
        for (let i = 0; i < text.length; i++)
            view.setUint16(2 * i, text.charCodeAt(i), true);
    }
    return matrixElement([flagsElement(MX_CHAR), dimsElement(text ? [1, text.length] : [0, 0]), textElement(''), subElement(ascii ? MI_UTF8 : MI_UTF16, payload)]);
}
/** A double scalar value cell. */
function doubleCell(x) {
    const payload = new Uint8Array(8);
    new DataView(payload.buffer).setFloat64(0, x, true);
    return matrixElement([flagsElement(MX_DOUBLE), dimsElement([1, 1]), textElement(''), subElement(MI_DOUBLE, payload)]);
}
/** The text of a char value cell, or null for one that is not a char. */
function charText(cell) {
    const view = new DataView(cell.buffer, cell.byteOffset, cell.byteLength);
    const layer = layerAt(view, 0, cell.length);
    if (!layer || classOf(view, layer) !== MX_CHAR) {
        return null;
    }
    const data = layer.subs[3];
    if (!data) {
        return '';
    }
    const bytes = cell.subarray(data.data, data.data + data.bytes);
    if (data.type === MI_UTF8) {
        return new TextDecoder().decode(bytes);
    }
    // Two bytes a character (miUTF16, miUINT16), or one (any other type), 4096 characters at a time:
    // a long text spread into one call overflows the stack.
    const wide = data.type === MI_UTF16 || data.type === 4;
    const codes = [];
    let text = '';
    for (let i = 0; i < bytes.length; i += wide ? 2 : 1) {
        codes.push(wide ? bytes[i] | ((bytes[i + 1] ?? 0) << 8) : bytes[i]);
        if (codes.length === 4096) {
            text += String.fromCharCode(...codes);
            codes.length = 0;
        }
    }
    return text + String.fromCharCode(...codes);
}
/** The one number a real numeric value cell holds, or null. */
function scalarOf(cell) {
    const view = new DataView(cell.buffer, cell.byteOffset, cell.byteLength);
    const layer = layerAt(view, 0, cell.length);
    const data = layer?.subs[3];
    const dims = layer ? dimsIn(view, layer.subs[1]) : null;
    if (!layer || !data || layer.subs.length !== 4 || !dims || dims.reduce((a, d) => a * d, 1) !== 1) {
        return null;
    }
    const cls = classOf(view, layer);
    if (cls < MX_DOUBLE || cls > MX_UINT64) {
        return null;
    }
    const read = {
        1: () => view.getInt8(data.data), 2: () => view.getUint8(data.data), 3: () => view.getInt16(data.data, true), 4: () => view.getUint16(data.data, true),
        5: () => view.getInt32(data.data, true), 6: () => view.getUint32(data.data, true), 7: () => view.getFloat32(data.data, true), 9: () => view.getFloat64(data.data, true),
    };
    return read[data.type] ? read[data.type]() : null;
}
// ---- A subsystem from nothing -------------------------------------------------------------------
/** A struct [1 1] with the one field MCOS holding `value`, as the subsystem's payloads open. */
function mcosStruct(value) {
    const names = new Uint8Array(5);
    names.set(new TextEncoder().encode('MCOS'));
    return matrixElement([flagsElement(MX_STRUCT), dimsElement([1, 1]), textElement(''), subElement(MI_INT32, words32([5], true)), subElement(MI_INT8, names), value]);
}
function uint8Element(payload) {
    return matrixElement([flagsElement(MX_UINT8), dimsElement([1, payload.length]), textElement(''), subElement(MI_UINT8, payload)]);
}
/**
 * A subsystem with no class and no object, for a file that has none, in the shape MATLAB R2027a
 * writes one: a version-4.0 blob of null records (class row 0, object 0, property list 0, no
 * constructor-argument or dynamic-property list), an empty removed-property map and per-array
 * map, a struct 1x0 or 0 in each per-class cell for the null class, and after the struct the
 * stream's own uint8 [1 88] element holding struct{MCOS: []}. Measured against MATLAB R2027a: a
 * `string` added to it is MATLAB's own subsystem for that one variable, byte for byte.
 *
 * Or, given `shape`, an empty subsystem in that subsystem's shape instead: its layers, its blob's
 * version, the sections it writes, and the null entry 0 of each of its per-class cells. The
 * shape's struct fields other than MCOS and the rest of its payload (the stream's own trailing
 * element) are copied as they are: a shape that holds another subsystem's data there carries it
 * over.
 */
export function createSubsystem(shape) {
    const empty = textElement('');
    if (shape) {
        // Every byte array copied: a shape is often a template read once and kept, which no record
        // made from it may share.
        const own = (bytes) => bytes.slice();
        const first = (cell) => cell && { flags: own(cell.flags), name: own(cell.name), entries: cell.entries.slice(0, 1).map((e) => (e instanceof Uint8Array ? own(e) : e)) };
        const b = shape.blob;
        return {
            outer: { flags: own(shape.outer.flags), name: own(shape.outer.name) },
            preamble: own(shape.preamble),
            struct: { head: shape.struct.head.map(own), fields: shape.struct.fields.map((f) => f && own(f)) },
            opaqueHead: shape.opaqueHead.map(own),
            cellArray: { flags: own(shape.cellArray.flags), name: own(shape.cellArray.name) },
            blobCell: { flags: own(shape.blobCell.flags), name: own(shape.blobCell.name) },
            blob: emptyBlob(b.major, b.minor, b.reserved, b.removedProps !== null, b.fileHeader && { perArray: b.fileHeader.perArray && [] }),
            reserved: own(shape.reserved),
            values: [],
            packages: first(shape.packages),
            classData: first(shape.classData),
            aliases: first(shape.aliases),
            defaults: first(shape.defaults),
            rest: own(shape.rest),
        };
    }
    return {
        outer: { flags: flagsElement(MX_UINT8), name: empty },
        preamble: PREAMBLE.slice(),
        struct: { head: [flagsElement(MX_STRUCT), dimsElement([1, 1]), empty, subElement(MI_INT32, words32([5], true)), subElement(MI_INT8, Uint8Array.of(0x4d, 0x43, 0x4f, 0x53, 0))], fields: [null] },
        opaqueHead: [flagsElement(MX_OPAQUE), empty, textElement('MCOS'), textElement('FileWrapper__')],
        cellArray: { flags: flagsElement(MX_CELL), name: empty },
        blobCell: { flags: flagsElement(MX_UINT8), name: empty },
        blob: emptyBlob(4, 0, 0, true, { perArray: [] }),
        reserved: matrixElement([]),
        values: [],
        packages: null,
        classData: { flags: flagsElement(MX_CELL), name: empty, entries: [EMPTY_STRUCT.slice()] },
        aliases: { flags: flagsElement(MX_INT32), name: empty, entries: [0] },
        defaults: { flags: flagsElement(MX_CELL), name: empty, entries: [EMPTY_STRUCT.slice()] },
        rest: uint8Element(concat([PREAMBLE, mcosStruct(matrixElement([]))])),
    };
}
function emptyBlob(major, minor, reserved, removed, fileHeader) {
    return {
        major,
        minor,
        reserved,
        strings: [''],
        classes: [{ namespace: 0, name: 0, version: [0, 0, 0, 0] }],
        ctorLists: [],
        objects: [{ classIndex: 0, child: 0, sibling: 0, ctorList: 0, pvList: 0, dynamicProps: 0 }],
        pvLists: [[]],
        dynamicProps: [],
        valuePointers: [],
        removedProps: removed ? [] : null,
        fileHeader,
    };
}
/**
 * A copy of `sub` an edit of which leaves `sub` as it was: every record and list its own, the byte
 * arrays shared (no edit writes into one).
 */
export function cloneSubsystem(sub) {
    return cloneRecords(sub);
}
function cloneRecords(v) {
    if (v === null || typeof v !== 'object' || v instanceof Uint8Array) {
        return v;
    }
    if (Array.isArray(v)) {
        return v.map(cloneRecords);
    }
    const out = {};
    for (const [k, x] of Object.entries(v))
        out[k] = cloneRecords(x);
    return out;
}
/**
 * Whether `written` reads back as exactly the records `intended`: every layer and section parsed
 * exactly, every reference landing, every record — every string in its place, every row, list,
 * triple and value cell — the one meant. The check a writer runs on what it writes, since MATLAB
 * loads a subsystem whose offsets are stale with no warning and its records misassigned.
 *
 * And whether the records keep the rules no byte count shows: every value cell that is an object
 * reference names objects the table holds, one object of the class row it names. Given `original`,
 * the subsystem as read before the edits, also that they only appended (APPEND ONLY, above): its
 * strings, rows and per-class entries in place; no record no edit writes changed (the removed
 * properties, the file header, the layers; the stream's trailing element only given class
 * systems); a new object's lists its own; every reference cell an edit wrote naming distinct
 * objects of the table, from 1, each of its class row and none the object that holds it; a
 * 'handle' opaque replaced only by one of its objects, classes and references, of a storage class
 * measured. And, with `options`, that the edits stayed on the objects they were for and that the
 * variables created name what they should (McosVerifyOptions). A writer always passes `original`
 * and the objects it edited: a string moved, a row spliced in or a cell shifted reads back as
 * meant, and MATLAB loads an enumeration variable naming the moved string, or a property naming
 * its neighbour's cell, as something else, with no warning.
 */
export function verifySubsystem(written, intended, original, options = {}) {
    const back = readSubsystem(written);
    if (!back.ok) {
        return { ok: false, reason: 'refused', message: `the written subsystem does not read back (${back.reason}): ${back.message}` };
    }
    const at = differenceAt(back.subsystem, intended, '');
    if (at !== null) {
        return { ok: false, reason: 'differs', message: `the written subsystem reads back with ${at || 'its records'} other than meant` };
    }
    const broken = referenceProblem(intended)
        ?? (original ? renumbering(original, intended) ?? untouchedChanged(original, intended) ?? newRecordProblem(original, intended) : null)
        ?? (original && options.edited ? strayEdit(original, intended, options.edited) : null)
        ?? (options.variables ? variableProblem(intended, options.variables) : null);
    return broken === null ? { ok: true } : { ok: false, reason: 'broken', message: broken };
}
/** The first record of `original` no edit writes that `edited` holds otherwise, in words, or null. */
function untouchedChanged(original, edited) {
    const a = original.blob;
    const b = edited.blob;
    const same = [
        ['blob version', [a.major, a.minor, a.reserved], [b.major, b.minor, b.reserved]],
        ['removed properties', a.removedProps, b.removedProps],
        ['file header', a.fileHeader, b.fileHeader],
        ['value pointers', a.valuePointers, b.valuePointers],
        ['element', original.outer, edited.outer],
        ['preamble', original.preamble, edited.preamble],
        ['struct', original.struct, edited.struct],
        ['FileWrapper__ opaque', original.opaqueHead, edited.opaqueHead],
        ['cell array', [original.cellArray, original.blobCell, original.reserved], [edited.cellArray, edited.blobCell, edited.reserved]],
        ['per-class cells', [original.packages, original.classData, original.aliases, original.defaults].map((c) => c && [c.flags, c.name]),
            [edited.packages, edited.classData, edited.aliases, edited.defaults].map((c) => c && [c.flags, c.name])],
    ];
    for (const [what, was, is] of same) {
        if (differenceAt(was, is, '') !== null)
            return `the edits changed the subsystem's ${what}, which no edit writes`;
    }
    if (firstDifference(original.rest, edited.rest) !== null) {
        // Only class systems given: MATLAB's own fields as they were, and new ones holding [].
        const was = trailingStruct(original.rest);
        const is = trailingStruct(edited.rest);
        const value = (t, rest, i) => rest.subarray(t.struct.subs[5 + i].at, t.struct.subs[5 + i].end);
        const empty = matrixElement([]);
        if (!was || !is || was.names.some((n, i) => is.names[i] !== n || firstDifference(value(was, original.rest, i), value(is, edited.rest, i)) !== null)
            || is.names.slice(was.names.length).some((_, j) => firstDifference(value(is, edited.rest, was.names.length + j), empty) !== null)) {
            return "the edits changed the stream's trailing element other than by giving it class systems";
        }
    }
    return null;
}
/**
 * The first new record that breaks a rule an edit keeps, in words, or null: a new object naming a
 * list it does not own; a reference cell an edit wrote naming object 0, an object past the table,
 * one twice, one of another class row than it names, or the object that holds it; a 'handle'
 * opaque replaced by one of other objects, classes or references, or of a storage class no edit was
 * measured writing.
 */
function newRecordProblem(original, edited) {
    const a = original.blob;
    const b = edited.blob;
    const unfilled = (id) => id >= a.objects.length || Object.values(a.objects[id]).every((v) => v === 0);
    // A new object's lists are new, and its own.
    const owners = [new Map(), new Map(), new Map()];
    b.objects.forEach((o, id) => [o.ctorList, o.pvList, o.dynamicProps].forEach((list, i) => list && owners[i].set(list, (owners[i].get(list) ?? 0) + 1)));
    const counts = [a.ctorLists.length, a.pvLists.length, a.dynamicProps.length];
    const kinds = ['constructor-argument', 'property', 'dynamic-property'];
    for (let id = 1; id < b.objects.length; id++) {
        if (!unfilled(id))
            continue;
        const o = b.objects[id];
        const lists = [o.ctorList, o.pvList, o.dynamicProps];
        for (let i = 0; i < 3; i++) {
            if (lists[i] && (lists[i] < counts[i] || owners[i].get(lists[i]) > 1)) {
                return `new object ${id} names ${kinds[i]} list ${lists[i]}, which another object names or the file held`;
            }
        }
        // An object a new one holds directly is copied with it: new too, and not itself.
        for (const t of [...(o.ctorList ? b.ctorLists[o.ctorList] ?? [] : []), ...(o.pvList ? b.pvLists[o.pvList] ?? [] : [])]) {
            if (t.flag === McosValueKind.object && (t.value === id || !unfilled(t.value) || t.value >= b.objects.length)) {
                return `new object ${id} holds object ${t.value}, which is ${t.value === id ? 'itself' : 'not one the edits made'}`;
            }
        }
    }
    // Who holds each value cell, by the triples naming it.
    const holders = new Map();
    b.objects.forEach((o, id) => {
        for (const t of [...(o.ctorList ? b.ctorLists[o.ctorList] ?? [] : []), ...(o.pvList ? b.pvLists[o.pvList] ?? [] : [])]) {
            if (t.flag === McosValueKind.cell)
                holders.set(t.value, [...(holders.get(t.value) ?? []), id]);
        }
    });
    // How many cells name each object: a new or changed reference names objects no other cell does
    // (a Bus's elements are its own, and MATLAB writes a value object once).
    const namedBy = new Map();
    const references = edited.values.map((cell) => referencesIn(cell));
    for (const list of references) {
        for (const id of new Set(list.flatMap((d) => d.ids)))
            namedBy.set(id, (namedBy.get(id) ?? 0) + 1);
    }
    let handleWritten = false;
    for (let k = 0; k < edited.values.length; k++) {
        const cell = edited.values[k];
        const old = k < original.values.length ? original.values[k] : null;
        if (old && firstDifference(old, cell) === null)
            continue;
        if (isHandleOpaque(cell) || (old && isHandleOpaque(old))) {
            const was = old && isHandleOpaque(old) ? handleCoderInfoOf(old) : null;
            const problem = (old && isHandleOpaque(old) ? handleSwapProblem(old, cell) : null) ?? handleProblem(cell, was?.ok ? was.settings.StorageClass : undefined);
            if (problem)
                return `value cell ${k}: ${problem}`;
            handleWritten = true;
            continue;
        }
        for (const d of references[k]) {
            const seen = new Set();
            for (const id of d.ids) {
                if (id < 1 || id >= b.objects.length)
                    return `value cell ${k}, which an edit wrote, names object ${id}, and the table holds 1 to ${b.objects.length - 1}`;
                if (seen.has(id))
                    return `value cell ${k}, which an edit wrote, names object ${id} twice`;
                seen.add(id);
                if (d.classIndex !== null && b.objects[id].classIndex !== d.classIndex) {
                    return `value cell ${k}, which an edit wrote, names object ${id} as one of class row ${d.classIndex}, and it is of row ${b.objects[id].classIndex}`;
                }
                if (holders.get(k)?.includes(id))
                    return `value cell ${k}, which an edit wrote, names object ${id}, which holds it`;
                if (namedBy.get(id) > 1)
                    return `value cell ${k}, which an edit wrote, names object ${id}, which another value cell names too`;
            }
        }
    }
    // The stream says it holds 'handle' objects once one is written, and not before.
    const systems = classSystemsOf(edited) ?? [];
    if (handleWritten && !systems.includes('handle')) {
        return "a 'handle' opaque was written, and the stream's trailing element does not say it holds 'handle' objects";
    }
    if (systems.includes('handle') && !(classSystemsOf(original) ?? []).includes('handle') && !edited.values.some((c) => isHandleOpaque(c))) {
        return "the stream's trailing element was given the 'handle' class system, and no 'handle' opaque is written";
    }
    return null;
}
/**
 * Why a 'handle' opaque an edit wrote is not one, in words, or null: it reads whole; its root names
 * object 1, of the class the opaque shows; every reference inside names objects of its own blob,
 * once each and not the object holding it; a CoderInfo's storage class is one an edit was
 * measured writing, or `kept`, the one the opaque it replaced held.
 */
function handleProblem(cell, kept) {
    const read = readHandleOpaque(cell);
    if (!read.ok) {
        return `a 'handle' opaque that does not read whole (${read.message})`;
    }
    const h = read.opaque;
    const b = h.blob;
    const view = new DataView(h.root.buffer, h.root.byteOffset, h.root.byteLength);
    const root = layerAt(view, 0, h.root.length);
    const member = root && classOf(view, root) === MX_CELL && root.subs.length === 4 ? root.subs[3] : null;
    const d = member ? readDescriptor(h.root.subarray(member.at, member.end)) : null;
    if (!d || d.ids.length !== 1 || d.ids[0] !== 1) {
        return "a 'handle' opaque whose root does not name its object 1";
    }
    const name = (ci) => { const c = b.classes[ci]; return c ? (c.namespace ? b.strings[c.namespace] + '.' : '') + b.strings[c.name] : null; };
    const shown = opaqueClassName(cell);
    if (!b.objects[1] || name(b.objects[1].classIndex) !== shown) {
        return `a 'handle' opaque showing ${shown} whose object 1 is ${b.objects[1] ? `a ${name(b.objects[1].classIndex)}` : 'missing'}`;
    }
    for (const [id, o] of b.objects.entries()) {
        for (const t of o.pvList ? b.pvLists[o.pvList] ?? [] : []) {
            const r = t.flag === McosValueKind.cell ? readDescriptor(h.values[t.value]) : null;
            if (r && (r.ids.some((x) => x < 1 || x >= b.objects.length || x === id) || new Set(r.ids).size !== r.ids.length)) {
                return `a 'handle' opaque whose object ${id} names ${r.ids.join(' ')}, past its table, itself or twice`;
            }
        }
    }
    const settings = shown === 'Simulink.CoderInfo' ? handleCoderInfoOf(cell) : null;
    if (settings && settings.ok && settings.settings.StorageClass !== kept && !Object.values(HANDLE_STORAGE_CLASSES).some((c) => c.saved === settings.settings.StorageClass)) {
        return `a CoderInfo given storage class ${settings.settings.StorageClass}, which no edit was measured writing`;
    }
    return null;
}
/** Every object reference an element holds, itself or in a field or a cell at any depth, a 'handle' opaque's own excepted. */
function referencesIn(element) {
    const view = new DataView(element.buffer, element.byteOffset, element.byteLength);
    const out = [];
    const walk = (at, end) => {
        const layer = layerAt(view, at, end);
        if (!layer)
            return;
        const cls = classOf(view, layer);
        const bytes = element.subarray(layer.at, layer.end);
        if (cls === MX_UINT32 || cls === MX_OPAQUE) {
            const d = cls === MX_OPAQUE && isHandleOpaque(bytes) ? null : readDescriptor(bytes);
            if (d)
                out.push(d);
            return;
        }
        if (cls === MX_CELL || cls === MX_STRUCT) {
            for (const s of layer.subs.slice(cls === MX_CELL ? 3 : 5)) {
                if (s.type === MI_MATRIX)
                    walk(s.at, s.end);
            }
        }
    };
    walk(0, element.length);
    return out;
}
/**
 * Why 'handle' opaque `old` may not be replaced by `cell`, or null: `cell` must be one too, reading
 * whole, with `old`'s object rows, classes, root and references.
 */
function handleSwapProblem(old, cell) {
    const was = readHandleOpaque(old);
    const is = readHandleOpaque(cell);
    if (!was.ok || !is.ok) {
        return `a 'handle' opaque replaced by ${is.ok ? 'one' : 'a cell'} that does not read whole`;
    }
    const shape = (h) => ({
        head: h.head,
        root: h.root,
        objects: h.blob.objects,
        classes: h.blob.classes.map((c) => [c.namespace ? h.blob.strings[c.namespace] : '', h.blob.strings[c.name]]),
        references: h.values.filter((v) => readDescriptor(v) !== null),
    });
    const at = differenceAt(shape(was.opaque), shape(is.opaque), '');
    return at === null ? null : `a 'handle' opaque replaced by one with other ${at.split(/[.[ ]/)[0]}`;
}
/**
 * The first record an edit changed outside `edited`, in words, or null: a list of an object not
 * edited, a property of an edited one it does not name, or a value cell of `original` that no
 * edited property names.
 */
function strayEdit(original, edited, objects) {
    const a = original.blob;
    const b = edited.blob;
    const named = new Map(objects.map((o) => [o.objectId, o.properties ? new Set(o.properties) : null]));
    const free = new Set();
    const listOf = (lists, i) => (i ? lists[i] ?? [] : []);
    for (let id = 1; id < a.objects.length; id++) {
        const o = a.objects[id];
        if (Object.values(o).every((v) => v === 0))
            continue;
        const props = named.get(id);
        const edits = named.has(id);
        const nameOf = (blob, t) => blob.strings[t.name];
        const keeps = (blob, t) => !edits || (props !== null && props !== undefined && !props.has(nameOf(blob, t)));
        for (const [what, was, is] of [
            ['constructor-argument', listOf(a.ctorLists, o.ctorList), listOf(b.ctorLists, b.objects[id].ctorList)],
            ['property', listOf(a.pvLists, o.pvList), listOf(b.pvLists, b.objects[id].pvList)],
        ]) {
            for (const t of was) {
                if (!keeps(a, t) && t.flag === McosValueKind.cell)
                    free.add(t.value);
            }
            const kept = (blob, list) => list.filter((t) => keeps(blob, t)).map((t) => [nameOf(blob, t), t.flag, t.value]);
            if (differenceAt(kept(a, was), kept(b, is), '') !== null) {
                return `the edits changed the ${what} list of object ${id}${edits ? ' other than in the properties named' : ', which no edit was for'}`;
            }
        }
        if (!edits || props) {
            const was = o.dynamicProps ? a.dynamicProps[o.dynamicProps] ?? [] : [];
            const is = b.objects[id].dynamicProps ? b.dynamicProps[b.objects[id].dynamicProps] ?? [] : [];
            if (differenceAt(was, is, '') !== null)
                return `the edits changed the dynamic properties of object ${id}`;
        }
    }
    for (let k = 0; k < original.values.length; k++) {
        if (!free.has(k) && firstDifference(original.values[k], edited.values[k]) !== null) {
            return `the edits changed value cell ${k}, which no property edited names`;
        }
    }
    return null;
}
/** The first created variable naming what it should not, in words, or null. */
function variableProblem(sub, variables) {
    const b = sub.blob;
    const named = new Map();
    const all = [...variables.created, ...(variables.kept ?? [])];
    for (const element of all) {
        for (const id of readDescriptor(element)?.ids ?? [])
            named.set(id, (named.get(id) ?? 0) + 1);
    }
    // A created variable's objects are roots: nothing inside the subsystem names them.
    const inside = new Set();
    for (const cell of sub.values) {
        for (const d of referencesIn(cell))
            d.ids.forEach((id) => inside.add(id));
    }
    for (const list of [...b.ctorLists, ...b.pvLists]) {
        for (const t of list)
            if (t.flag === McosValueKind.object)
                inside.add(t.value);
    }
    for (const [i, element] of variables.created.entries()) {
        const d = readDescriptor(element);
        const shown = opaqueClassName(element);
        if (!d || d.classIndex === null || d.ids.length === 0 || shown === null) {
            return `created variable ${i + 1} is not an object reference naming its class`;
        }
        if (d.classIndex < 1 || d.classIndex >= b.classes.length) {
            return `created variable ${i + 1} names class row ${d.classIndex}, and the table holds ${b.classes.length}`;
        }
        const alias = sub.aliases?.entries[d.classIndex];
        if (shown !== classNameOf(sub, d.classIndex) && !(alias && shown === b.strings[alias])) {
            return `created variable ${i + 1} shows class ${shown}, and names objects of ${classNameOf(sub, d.classIndex)}`;
        }
        const seen = new Set();
        for (const id of d.ids) {
            if (id < 1 || id >= b.objects.length)
                return `created variable ${i + 1} names object ${id}, and the table holds 1 to ${b.objects.length - 1}`;
            if (b.objects[id].classIndex !== d.classIndex)
                return `created variable ${i + 1} names object ${id} as one of class row ${d.classIndex}, and it is of row ${b.objects[id].classIndex}`;
            if (seen.has(id) || named.get(id) > 1)
                return `created variable ${i + 1} names object ${id}, which another variable names too`;
            if (inside.has(id))
                return `created variable ${i + 1} names object ${id}, which an object of the subsystem holds`;
            seen.add(id);
        }
    }
    return null;
}
/** The class name a class-17 element shows, or null for an element that is not one. */
function opaqueClassName(element) {
    const view = new DataView(element.buffer, element.byteOffset, element.byteLength);
    const layer = layerAt(view, 0, element.length);
    if (!layer || classOf(view, layer) !== MX_OPAQUE || layer.subs.length !== 5) {
        return null;
    }
    const name = layer.subs[3];
    return new TextDecoder().decode(element.subarray(name.data, name.data + name.bytes));
}
/**
 * The first value cell that is an object reference naming what is not there, in words, or null:
 * an object or a class row past its table, or one object of another class row than the reference
 * names. Only one: a reference to an array names the array's class, which MATLAB writes as their
 * common superclass when the objects are of several (a ConfigSet's components, in
 * test/fixtures/mcos/configset.mat), and the blob does not say which class is whose superclass.
 */
function referenceProblem(sub) {
    const { classes, objects } = sub.blob;
    for (const [k, cell] of sub.values.entries()) {
        const d = readDescriptor(cell);
        if (!d)
            continue;
        if (d.classIndex !== null && (d.classIndex < 1 || d.classIndex >= classes.length)) {
            return `value cell ${k} names objects of class row ${d.classIndex}, and the table holds ${classes.length}`;
        }
        for (const id of d.ids) {
            if (id >= objects.length) {
                return `value cell ${k} names object ${id}, and the table holds ${objects.length}`;
            }
            if (id !== 0 && d.ids.length === 1 && d.classIndex !== null && objects[id].classIndex !== d.classIndex) {
                return `value cell ${k} names object ${id} as one of class row ${d.classIndex}, and it is of row ${objects[id].classIndex}`;
            }
        }
    }
    return null;
}
/**
 * The first record of `original` that `edited` does not hold where it was, in words, or null: its
 * strings, class rows, objects (but a row `original` held still all zeros, which an edit fills in)
 * and per-class entries each a prefix of the edited one's, and no value cell or list fewer.
 */
function renumbering(original, edited) {
    const a = original.blob;
    const b = edited.blob;
    const prefix = (what, was, is, skip = () => false) => {
        if (is.length < was.length) {
            return `the edits leave ${is.length} ${what} of the ${was.length} read`;
        }
        for (let i = 0; i < was.length; i++) {
            if (!skip(was[i]) && differenceAt(was[i], is[i], '') !== null) {
                return `the edits moved or changed ${what} ${i}`;
            }
        }
        return null;
    };
    const unfilled = (row) => Object.values(row).every((v) => v === 0);
    const counts = [
        ['value cells', original.values.length, edited.values.length],
        ['constructor-argument lists', a.ctorLists.length, b.ctorLists.length],
        ['property lists', a.pvLists.length, b.pvLists.length],
        ['dynamic-property lists', a.dynamicProps.length, b.dynamicProps.length],
    ];
    for (const [what, was, is] of counts) {
        if (is < was)
            return `the edits leave ${is} ${what} of the ${was} read`;
    }
    return prefix('strings', a.strings, b.strings)
        ?? prefix('class rows', a.classes, b.classes)
        ?? prefix('objects', a.objects, b.objects, unfilled)
        ?? prefix('package names', original.packages?.entries ?? [], edited.packages?.entries ?? [])
        ?? prefix('saved class data entries', original.classData?.entries ?? [], edited.classData?.entries ?? [])
        ?? prefix('aliases', original.aliases?.entries ?? [], edited.aliases?.entries ?? [])
        ?? prefix('defaults entries', original.defaults?.entries ?? [], edited.defaults?.entries ?? []);
}
/** The path of the first place `a` and `b` differ ('blob.pvLists[3][1].value'), or null. */
function differenceAt(a, b, path) {
    if (a instanceof Uint8Array || b instanceof Uint8Array) {
        return a instanceof Uint8Array && b instanceof Uint8Array && firstDifference(a, b) === null ? null : path;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
            return `${path} (its length)`;
        }
        for (let i = 0; i < a.length; i++) {
            const at = differenceAt(a[i], b[i], `${path}[${i}]`);
            if (at !== null)
                return at;
        }
        return null;
    }
    if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const k of keys) {
            const at = differenceAt(a[k], b[k], path ? `${path}.${k}` : k);
            if (at !== null)
                return at;
        }
        return null;
    }
    return Object.is(a, b) ? null : path;
}
//# sourceMappingURL=McosSubsystemCodec.js.map