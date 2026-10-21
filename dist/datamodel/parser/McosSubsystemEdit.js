// Copyright 2026 The MathWorks, Inc.
import { parseMatrix } from './MatParser.js';
import { encodeMatVariable } from './MatWriter.js';
import { MCOS_HANDLE_MAGIC, objectHandleFromValue } from './McosHandle.js';
const MI_INT8 = 1;
const MI_UINT8 = 2;
const MI_INT32 = 5;
const MI_UINT32 = 6;
const MI_MATRIX = 14;
const MX_CELL = 1;
const MX_STRUCT = 2;
const MX_OBJECT = 3;
const MX_CHAR = 4;
const MX_SPARSE = 5;
const MX_UINT8 = 9;
const MX_UINT32 = 13;
const MX_FUNCTION = 16;
const MX_OPAQUE = 17;
// Byte 1 of the array flags word.
const COMPLEX_FLAG = 0x08;
const FLAG_CELL = 1;
const FLAG_WORDS = { 0: 'a string-table index', 2: 'an integer', 3: 'an object id' };
// The cells after the value cells in a version-4 subsystem's cell array, three per-class
// tables: saved class information, class aliases, and the class defaults McosParser reads. Other
// versions hold another number of them, and none is read: readLayers counts the value cells by
// this before it reads the blob, and readBlob then refuses a blob of any version but 4.0
// ('unsupported'), so no subsystem read with this count of another version's is ever handed on.
const TRAILING_CELLS = 3;
const INT32_MAX = 0x7fffffff;
const WIDTH = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 7: 4, 9: 8, 12: 8, 13: 8 };
class Refused extends Error {
    constructor(refusal) {
        super(refusal.message);
        this.refusal = refusal;
    }
}
function fail(reason, message, savedName) {
    throw new Refused(savedName === undefined ? { ok: false, reason, message } : { ok: false, reason, savedName, message });
}
function align8(n) {
    return n + ((8 - (n % 8)) % 8);
}
/**
 * The sub-element whose tag is at `at`, wholly before `limit`, or null. A tag whose upper
 * half is not zero is the small form, of 1 to 4 bytes, and anything else there is no tag.
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
 * The miMATRIX element at `at`, wholly before `limit`, whose sub-elements tile it exactly
 * and open with an array-flags word, or null.
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
function isComplex(view, layer) {
    return (view.getUint8(layer.subs[0].data + 1) & COMPLEX_FLAG) !== 0;
}
/** The extents a dims sub-element holds, or null when it is not one. */
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
/**
 * Whether `bytes` from `at` spell `text` and nothing more in a field of `width` bytes: the
 * rest of the field NUL. Compared, not decoded, so a damaged length cannot make a string
 * of a megabyte out of one.
 */
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
/** The first element of a numeric payload of MAT type `type`, or null for a type that is not one. */
function firstNumber(view, type, at) {
    switch (type) {
        case 1: return view.getInt8(at);
        case 2: return view.getUint8(at);
        case 3: return view.getInt16(at, true);
        case 4: return view.getUint16(at, true);
        case 5: return view.getInt32(at, true);
        case 6: return view.getUint32(at, true);
        case 7: return view.getFloat32(at, true);
        case 9: return view.getFloat64(at, true);
        case 12: return view.getBigInt64(at, true);
        case 13: return view.getBigUint64(at, true);
        default: return null;
    }
}
/**
 * Whether the miMATRIX element at `at` holds an object reference at any depth, or null
 * when it does not parse.
 *
 * MATLAB turns a value cell's object references into objects as it loads it, wherever in
 * the cell they sit, and a reference is a uint32 array whose first word is the handle
 * magic: a nested object's handle, an enumeration's tag, a function handle's marker. So
 * every uint32 in the tree is asked, whatever its shape, which is wider than what MATLAB
 * reads as one — a refusal costs an edit, a miss re-points an object. An object element of
 * any class, which no value cell holds, is taken for one too.
 *
 * `strict`, for a cell from outside: every payload holds what its dims declare, as a cell
 * MATLAB reads as the value meant has to. A numeric payload of other than numel times its
 * width is a shorter or garbage array to MATLAB, not an error. Walked with an explicit
 * stack, so a deep cell has no depth limit here.
 */
function holdsObjectReference(view, at, limit, strict) {
    const stack = [[at, limit]];
    while (stack.length > 0) {
        const [p, end] = stack.pop();
        const tag = subAt(view, p, end);
        if (!tag || tag.type !== MI_MATRIX) {
            return null;
        }
        // A member with no sub-elements at all is an empty one, and holds nothing.
        if (tag.bytes === 0 && !strict) {
            continue;
        }
        const m = layerAt(view, p, tag.end);
        if (!m) {
            return null;
        }
        const cls = classOf(view, m);
        if (cls === MX_OBJECT || cls === MX_FUNCTION || cls === MX_OPAQUE) {
            return true;
        }
        const dims = dimsIn(view, m.subs[1]);
        if (!dims || m.subs.length < 3) {
            return null;
        }
        const numel = dims.reduce((a, b) => a * b, 1);
        let members = [];
        if (cls === MX_CELL) {
            members = m.subs.slice(3);
            if (strict && members.length !== numel) {
                return null;
            }
        }
        else if (cls === MX_STRUCT) {
            const [, , , widthSub, namesSub] = m.subs;
            if (!widthSub || !namesSub || widthSub.type !== MI_INT32 || widthSub.bytes !== 4 || namesSub.type !== MI_INT8) {
                return null;
            }
            const fields = fieldCountOf(view, widthSub, namesSub);
            members = m.subs.slice(5);
            if (!Number.isInteger(fields) || (strict && members.length !== fields * numel)) {
                return null;
            }
        }
        else if (cls !== MX_CHAR && cls !== MX_SPARSE) {
            if (cls < 6 || cls > 15 || m.subs.length < 4) {
                return null;
            }
            const re = m.subs[3];
            if (cls === MX_UINT32 && re.bytes > 0) {
                if (!WIDTH[re.type] || re.bytes < WIDTH[re.type]) {
                    return null;
                }
                const first = firstNumber(view, re.type, re.data);
                if (first !== null && Number(first) === MCOS_HANDLE_MAGIC) {
                    return true;
                }
            }
            if (strict && !payloadsFit(m, numel, isComplex(view, m))) {
                return null;
            }
        }
        for (let i = members.length - 1; i >= 0; i--) {
            stack.push([members[i].at, members[i].end]);
        }
    }
    return false;
}
/**
 * How many fields a struct's field-name table names: its bytes over the width each name takes, none
 * for an empty table, and NaN for one that is not whole names (a width of 0 or less over names, or
 * names that do not fill a whole number of widths). For every struct this reads, the subsystem's
 * own (readLayers) and one in a value cell (holdsObjectReference).
 */
function fieldCountOf(view, widthSub, namesSub) {
    const width = view.getInt32(widthSub.data, true);
    return width > 0 ? namesSub.bytes / width : namesSub.bytes === 0 ? 0 : NaN;
}
/** Whether a numeric element's real part, and imaginary part when complex, hold numel values each. */
function payloadsFit(m, numel, complex) {
    const parts = m.subs.slice(3);
    if (parts.length !== (complex ? 2 : 1)) {
        return false;
    }
    return parts.every((part) => WIDTH[part.type] !== undefined && part.bytes === numel * WIDTH[part.type]);
}
/**
 * Reads a subsystem element whole, for a caller asking several questions of one; or refuses
 * it, when a layer does not parse exactly or is one this editor was not measured on.
 */
export function readMcosSubsystem(bytes) {
    try {
        return { ok: true, subsystem: readLayers(bytes) };
    }
    catch (e) {
        if (e instanceof Refused) {
            return e.refusal;
        }
        throw e;
    }
}
function readLayers(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // The element: uint8 [1 N], its data the N bytes of the payload.
    const outer = layerAt(view, 0, bytes.length);
    if (!outer || outer.end !== bytes.length) {
        fail('malformed', 'the subsystem is not one whole MAT element');
    }
    const outerDims = dimsIn(view, outer.subs[1]);
    const data = outer.subs[3];
    if (outer.subs.length !== 4 || classOf(view, outer) !== MX_UINT8 || isComplex(view, outer) || data.type !== MI_UINT8) {
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
    // The struct: flags, dims [1 1], name, field-name width, field names, one value per field.
    const structDims = dimsIn(view, struct.subs[1]);
    const [, , , widthSub, namesSub] = struct.subs;
    if (!structDims || structDims.length !== 2 || structDims[0] !== 1 || structDims[1] !== 1 || !widthSub || !namesSub
        || widthSub.type !== MI_INT32 || widthSub.bytes !== 4 || namesSub.type !== MI_INT8) {
        fail('malformed', "the subsystem's struct is not one struct with a field-name table");
    }
    const width = view.getInt32(widthSub.data, true);
    const fieldCount = fieldCountOf(view, widthSub, namesSub);
    if (!Number.isInteger(fieldCount) || struct.subs.length !== 5 + fieldCount) {
        fail('malformed', "the subsystem's struct does not hold one value per field it names");
    }
    const mcos = [];
    for (let f = 0; f < fieldCount; f++) {
        if (spells(bytes, namesSub.data + f * width, width, 'MCOS'))
            mcos.push(f);
    }
    if (mcos.length !== 1) {
        fail('malformed', `the subsystem's struct has ${mcos.length} MCOS fields, and an edit needs one`);
    }
    const mcosField = 5 + mcos[0];
    // The field: class-17 opaque, type 'MCOS', class 'FileWrapper__', and its cell array.
    const field = struct.subs[mcosField];
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
    const valueCells = cells.length - 2 - TRAILING_CELLS;
    if (valueCells < 0) {
        fail('malformed', `the subsystem's cell array holds ${cells.length} cells, fewer than the ${2 + TRAILING_CELLS} around its values`);
    }
    // Cell 0: the metadata blob, a uint8 array.
    const blobCell = layerAt(view, cells[0].at, cells[0].end);
    const blobDims = blobCell ? dimsIn(view, blobCell.subs[1]) : null;
    const blob = blobCell?.subs[3];
    if (!blobCell || !blob || blobCell.subs.length !== 4 || classOf(view, blobCell) !== MX_UINT8 || blob.type !== MI_UINT8
        || !blobDims || blobDims.reduce((a, b) => a * b, 1) !== blob.bytes) {
        fail('malformed', "the subsystem's first cell is not its metadata blob");
    }
    const table = readBlob(view, blob.data, blob.bytes);
    const references = new Map();
    for (const t of [...table.ctorLists.flat(), ...table.pvLists.flat(), ...table.perArray]) {
        if (t.flag === FLAG_CELL) {
            references.set(t.value, (references.get(t.value) ?? 0) + 1);
        }
    }
    const listUsers = new Map();
    for (const row of table.objects) {
        if (row.pvList !== 0) {
            listUsers.set(row.pvList, (listUsers.get(row.pvList) ?? 0) + 1);
        }
    }
    return { bytes, outer, struct, mcosField, opaque, cellArray, cells, blobAt: blob.data, ...table, valueCells, references, listUsers };
}
/**
 * The metadata blob of `length` bytes at `at`.
 *
 * Its header: a version (major, minor), a big-endian flag and a reserved byte, the string
 * count, then where each of eight segments starts, each ending where the next starts — the
 * class table, the constructor-argument lists, the object table, the property lists, then
 * dynamic properties, value pointers and removed properties, which hold no cell index, and
 * last the file header. That header is a count of tables and where each is; the one MATLAB
 * R2027a writes, the per-array property map, holds triples like the lists do.
 */
function readBlob(view, at, length) {
    if (length < 40) {
        fail('malformed', `the metadata blob is ${length} bytes, short of its 40-byte header`);
    }
    const u8 = (o) => view.getUint8(at + o);
    const u32 = (o) => view.getUint32(at + o, true);
    if (u8(2) !== 0) {
        fail('unsupported', 'the metadata blob is big-endian');
    }
    if (u8(0) !== 4 || u8(1) !== 0) {
        fail('unsupported', `the metadata blob is version ${u8(0)}.${u8(1)}, and this editor was measured on 4.0 only`);
    }
    const starts = [];
    for (let i = 0; i < 8; i++) {
        const s = u32(8 + 4 * i);
        if (s < (starts[i - 1] ?? 40) || s > length || s % 8 !== 0) {
            fail('malformed', `the metadata blob's segment ${i} starts at ${s}, out of order or out of its ${length} bytes`);
        }
        starts.push(s);
    }
    const [classesAt, ctorAt, objectsAt, pvAt, dynamicAt, , , headerAt] = starts;
    // Strings: NUL-terminated from byte 40, index 0 the empty string.
    const decoder = new TextDecoder();
    const strings = [''];
    const count = u32(4);
    for (let p = 40, i = 0; i < count; i++) {
        let e = p;
        while (e < classesAt && u8(e) !== 0)
            e++;
        if (e >= classesAt) {
            fail('malformed', `the metadata blob's string table holds fewer than the ${count} strings it declares`);
        }
        strings.push(decoder.decode(new Uint8Array(view.buffer, view.byteOffset + at + p, e - p)));
        p = e + 1;
    }
    const stringAt = (i) => (i < strings.length ? strings[i] : null);
    if ((ctorAt - classesAt) % 16 !== 0 || (pvAt - objectsAt) % 24 !== 0) {
        fail('malformed', "the metadata blob's class or object table is not whole rows");
    }
    const classes = [];
    for (let p = classesAt; p < ctorAt; p += 16) {
        const pkg = stringAt(u32(p));
        const cls = stringAt(u32(p + 4));
        classes.push(pkg === null || cls === null ? null : pkg ? pkg + '.' + cls : cls);
    }
    const objects = [];
    for (let p = objectsAt; p < pvAt; p += 24) {
        objects.push({ classId: u32(p), ctorList: u32(p + 12), pvList: u32(p + 16) });
    }
    // Each list: a count, then that many 12-byte triples, padded to 8; the lists tile their segment.
    const listsIn = (from, to, what) => {
        const lists = [];
        for (let p = from; p < to;) {
            const n = p + 4 <= to ? u32(p) : -1;
            const next = p + align8(4 + 12 * n);
            if (n < 0 || next > to) {
                fail('malformed', `a list of the metadata blob's ${what} runs past the segment's end`);
            }
            const list = [];
            for (let q = p + 4; q < p + 4 + 12 * n; q += 12) {
                list.push({ name: u32(q), flag: u32(q + 4), value: u32(q + 8), at: at + q });
            }
            lists.push(list);
            p = next;
        }
        return lists;
    };
    const ctorLists = listsIn(ctorAt, objectsAt, 'constructor arguments');
    const pvLists = listsIn(pvAt, dynamicAt, 'property lists');
    // The file header, when there is one: [count, where each table is…], padded to 8, and the
    // per-array map right after it: [entries, (index, n, n triples)…], padded to 8, to the end.
    const perArray = [];
    if (headerAt < length) {
        const tables = headerAt + 4 <= length ? u32(headerAt) : -1;
        const mapAt = headerAt + align8(4 + 4 * tables);
        if (tables < 0 || mapAt > length) {
            fail('malformed', "the metadata blob's file header runs past its end");
        }
        if (tables > 1) {
            fail('unsupported', `the metadata blob's file header holds ${tables} tables, and this editor reads only the first, the per-array properties`);
        }
        if (tables === 1) {
            if (u32(headerAt + 4) !== mapAt || mapAt + 4 > length) {
                fail('unsupported', "the metadata blob's per-array map is not where its file header ends");
            }
            let q = mapAt + 4;
            for (let entries = u32(mapAt); entries > 0; entries--) {
                const n = q + 8 <= length ? u32(q + 4) : -1;
                if (n < 0 || q + 8 + 12 * n > length) {
                    fail('malformed', "the metadata blob's per-array map runs past its end");
                }
                for (let r = q + 8; r < q + 8 + 12 * n; r += 12) {
                    perArray.push({ name: u32(r), flag: u32(r + 4), value: u32(r + 8), at: at + r });
                }
                q += 8 + 12 * n;
            }
            if (mapAt + align8(q - mapAt) !== length) {
                fail('unsupported', 'the metadata blob holds bytes past its per-array map');
            }
        }
        else if (mapAt !== length) {
            fail('unsupported', 'the metadata blob holds bytes past its file header');
        }
    }
    return { strings, classes, objects, ctorLists, pvLists, perArray };
}
function subsystemOf(subsystem) {
    return subsystem instanceof Uint8Array ? readLayers(subsystem) : subsystem;
}
/**
 * The object row `objectId` names, its property list, and why no cell of the list takes a swap
 * whatever the property, or null: another object's row names the list too (`shared-list`).
 */
function objectAt(s, objectId) {
    if (!Number.isInteger(objectId) || objectId < 1 || objectId >= s.objects.length) {
        fail('bad-object', `object ${objectId} is not one of the ${Math.max(0, s.objects.length - 1)} objects the subsystem holds`);
    }
    const row = s.objects[objectId];
    const className = s.classes[row.classId];
    if (className === undefined || className === null) {
        fail('malformed', `object ${objectId} names class ${row.classId}, which the class table does not hold`);
    }
    // List 0 is no list: an object that names it saved itself as one payload, through its
    // class's own save (a `string`'s text, a saveobj result), and has no property triples.
    if (row.pvList === 0) {
        return { className, list: [], ownSave: true, shared: null };
    }
    const list = s.pvLists[row.pvList];
    if (!list) {
        fail('malformed', `object ${objectId} names property list ${row.pvList}, and the blob holds ${s.pvLists.length}`);
    }
    if (list.some((t) => t.name < 1 || t.name >= s.strings.length)) {
        fail('malformed', `object ${objectId}'s property list names a string the table does not hold`);
    }
    const others = (s.listUsers.get(row.pvList) ?? 0) - 1;
    const shared = others > 0
        ? { ok: false, reason: 'shared-list', message: `object ${objectId}'s property list is named by ${others} other object${others === 1 ? '' : 's'} as well` }
        : null;
    return { className, list, ownSave: false, shared };
}
/** Why the cell of `t` cannot be swapped, or null when it can. */
function swapRefusal(s, t) {
    const savedName = s.strings[t.name];
    if (t.flag !== FLAG_CELL) {
        const as = FLAG_WORDS[t.flag] ?? `value kind ${t.flag}`;
        return { ok: false, reason: 'not-a-cell', savedName, message: `${savedName} is stored as ${as}, not in a value cell` };
    }
    if (t.value >= s.valueCells) {
        return { ok: false, reason: 'malformed', savedName, message: `${savedName} names value cell ${t.value}, and the subsystem holds ${s.valueCells}` };
    }
    const others = (s.references.get(t.value) ?? 0) - 1;
    if (others > 0) {
        return { ok: false, reason: 'shared-cell', savedName, message: `${savedName}'s value cell is named by ${others} other triple${others === 1 ? '' : 's'} as well` };
    }
    const cell = s.cells[t.value + 2];
    const view = new DataView(s.bytes.buffer, s.bytes.byteOffset, s.bytes.byteLength);
    const held = holdsObjectReference(view, cell.at, cell.end, false);
    if (held === null) {
        return { ok: false, reason: 'malformed', savedName, message: `${savedName}'s value cell does not parse` };
    }
    return held
        ? { ok: false, reason: 'object-reference', savedName, message: `${savedName}'s value cell holds an object reference, not a value` }
        : null;
}
/** Why `cell` cannot go into a subsystem as a value, or null when it can. */
function newCellRefusal(cell, savedName) {
    const view = new DataView(cell.buffer, cell.byteOffset, cell.byteLength);
    const m = layerAt(view, 0, cell.length);
    if (!m || m.end !== cell.length) {
        return { ok: false, reason: 'bad-cell', savedName, message: `the new value of ${savedName} is not one whole MAT element` };
    }
    const cls = classOf(view, m);
    const name = m.subs[2];
    if (cls !== MX_OBJECT && cls !== MX_FUNCTION && cls !== MX_OPAQUE && (!name || name.type !== MI_INT8 || name.bytes !== 0)) {
        return { ok: false, reason: 'bad-cell', savedName, message: `the new value of ${savedName} carries a name, which a cell does not` };
    }
    const held = holdsObjectReference(view, 0, cell.length, true);
    if (held === null) {
        return { ok: false, reason: 'bad-cell', savedName, message: `the new value of ${savedName} does not hold what its dims declare` };
    }
    return held
        ? { ok: false, reason: 'object-reference', savedName, message: `the new value of ${savedName} holds an object reference, not a value` }
        : null;
}
/**
 * Every property object `objectId` saved a triple for, in the order of its property list,
 * and whether editMcosSubsystem takes a swap of each: what the node layer decides
 * editability by. A property it does not list is at its class default, and takes none.
 */
export function storedProperties(subsystem, objectId) {
    try {
        const s = subsystemOf(subsystem);
        const { className, list, shared } = objectAt(s, objectId);
        const properties = list.map((t) => ({
            savedName: s.strings[t.name],
            flag: t.flag,
            cellIndex: t.flag === FLAG_CELL ? t.value + 2 : null,
            refusal: shared?.reason ?? swapRefusal(s, t)?.reason ?? null,
        }));
        return { ok: true, className, properties };
    }
    catch (e) {
        if (e instanceof Refused) {
            return e.refusal;
        }
        throw e;
    }
}
/**
 * The subsystem with the value cells of object `objectId`'s properties replaced, one per
 * edit, and every other byte as it was; or why not, for the first edit refused (nothing is
 * written then). No edits is the subsystem re-emitted as it was read.
 */
export function editMcosSubsystem(subsystem, objectId, edits) {
    return editMcosObjects(subsystem, [{ objectId, edits }]);
}
/**
 * editMcosSubsystem for the edits of several objects at once, the subsystem re-emitted once around
 * all of them; or why not, for the first edit refused (nothing is written then). An object named
 * twice is refused, as one property edited twice is: its edits are one list.
 */
export function editMcosObjects(subsystem, objects) {
    try {
        const s = subsystemOf(subsystem);
        const replaced = new Map();
        const seen = new Set();
        for (const { objectId, edits } of objects) {
            if (seen.has(objectId)) {
                fail('duplicate-edit', `object ${objectId} is edited twice`);
            }
            seen.add(objectId);
            const { list, ownSave, shared } = objectAt(s, objectId);
            if (shared && edits.length > 0) {
                throw new Refused({ ...shared, savedName: edits[0].savedName });
            }
            const named = new Set();
            for (const { savedName, cell } of edits) {
                if (named.has(savedName)) {
                    fail('duplicate-edit', `${savedName} is edited twice`, savedName);
                }
                named.add(savedName);
                const hits = list.filter((t) => s.strings[t.name] === savedName);
                if (hits.length > 1) {
                    fail('malformed', `object ${objectId}'s property list holds ${savedName} ${hits.length} times`, savedName);
                }
                if (hits.length === 0) {
                    fail('not-stored', ownSave
                        ? `object ${objectId} saved itself as one payload, and holds no ${savedName} to replace`
                        : `object ${objectId} saved no value for ${savedName}: it is at its class default, and has no cell to replace`, savedName);
                }
                const refusal = swapRefusal(s, hits[0]) ?? newCellRefusal(cell, savedName);
                if (refusal) {
                    throw new Refused(refusal);
                }
                replaced.set(hits[0].value + 2, cell);
            }
        }
        return { ok: true, bytes: rebuild(s, replaced) };
    }
    catch (e) {
        if (e instanceof Refused) {
            return e.refusal;
        }
        throw e;
    }
}
/**
 * What value cell `cellIndex` of the subsystem holds, read as MatParser reads a matrix (which is
 * how McosParser reads the same cell into an object's property), or null for an index past the
 * cells or a cell that does not read.
 */
export function cellValueAt(subsystem, cellIndex) {
    const cell = subsystem.cells[cellIndex];
    if (!cell) {
        return null;
    }
    try {
        return parseMatrix(new DataView(subsystem.bytes.buffer, subsystem.bytes.byteOffset, subsystem.bytes.byteLength), cell.data, cell.bytes);
    }
    catch {
        return null;
    }
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
/** A long-form tag: type, then byte count. */
function tag(type, bytes) {
    const out = new Uint8Array(8);
    const view = new DataView(out.buffer);
    view.setUint32(0, type, true);
    view.setUint32(4, bytes, true);
    return out;
}
function matrixOf(parts) {
    const body = concat(parts);
    return concat([tag(MI_MATRIX, body.length), body]);
}
/**
 * The subsystem re-emitted around its cells, `replaced` in place of the ones it names: the
 * cell array, the opaque, the struct, the payload and the element, each tag restated and
 * every other sub-element the bytes it was read as.
 */
function rebuild(s, replaced) {
    const b = s.bytes;
    const piece = (sub) => b.subarray(sub.at, sub.end);
    const cells = s.cells.map((cell, i) => replaced.get(i) ?? piece(cell));
    const cellArray = matrixOf([...s.cellArray.subs.slice(0, 3).map(piece), ...cells]);
    const opaque = matrixOf([...s.opaque.subs.slice(0, 4).map(piece), cellArray]);
    const struct = matrixOf(s.struct.subs.map((sub, i) => (i === s.mcosField ? opaque : piece(sub))));
    const data = s.outer.subs[3];
    const preamble = b.subarray(data.data, data.data + 8);
    const rest = b.subarray(s.struct.end, data.data + data.bytes);
    const n = preamble.length + struct.length + rest.length;
    if (n > INT32_MAX) {
        fail('bad-cell', `the subsystem would be ${n} bytes, past what its int32 dims can say`);
    }
    const dims = new Uint8Array(8);
    new DataView(dims.buffer).setInt32(0, 1, true);
    new DataView(dims.buffer).setInt32(4, n, true);
    return matrixOf([
        piece(s.outer.subs[0]),
        concat([tag(MI_INT32, 8), dims]),
        piece(s.outer.subs[2]),
        tag(MI_UINT8, n),
        preamble,
        struct,
        rest,
        new Uint8Array(align8(n) - n),
    ]);
}
/**
 * The id of element `index` (0-based, column-major, MATLAB's order) of the objects a handle
 * names, or null when it names none there: an index past its elements, or the null object 0,
 * which MATLAB writes for a deleted handle. The handle is MatVariable's `mcosHandle`, or the
 * words [0xDD000000, ndims, dims…, ids…, classIdx] as they are held (McosHandle.ts).
 */
export function objectIdOf(handle, index = 0) {
    if (!handle) {
        return null;
    }
    let ids;
    if (Array.isArray(handle)) {
        const parsed = handle.length >= 5 && handle[0] === MCOS_HANDLE_MAGIC ? objectHandleFromValue(handle) : null;
        if (!parsed) {
            return null;
        }
        ids = parsed.ids;
    }
    else {
        ids = handle.ids;
    }
    if (!Number.isInteger(index) || index < 0 || index >= ids.length) {
        return null;
    }
    const id = ids[index];
    return Number.isInteger(id) && id > 0 ? id : null;
}
/**
 * A fresh value cell for `v`: MatWriter's nameless miMATRIX, which keeps the two rules MATLAB
 * writes a subsystem cell by — a payload of 1 to 4 bytes takes the small tag, and a value
 * goes out in its own class's type, never narrowed (a double 5 is miDOUBLE) — so the cell of
 * a value MATLAB would have saved is the cell MATLAB saves. Throws MatWriteError for a value
 * MatWriter cannot write, an object among them.
 */
export function valueCellOf(v) {
    return encodeMatVariable(v);
}
//# sourceMappingURL=McosSubsystemEdit.js.map