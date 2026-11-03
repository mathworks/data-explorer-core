// Copyright 2026 The MathWorks, Inc.
import { decodeMatStream, parseMat } from './MatParser.js';
import { elementNamed, encodeMatVariable } from './MatWriter.js';
import { inflateZlib } from './Inflate.js';
const PREAMBLE = Uint8Array.of(0x00, 0x01, 0x49, 0x4d, 0x00, 0x00, 0x00, 0x00);
const MI_INT8 = 1;
const MI_INT32 = 5;
const MI_MATRIX = 14;
const MI_COMPRESSED = 15;
const STRUCT_CLASS = 2;
const HEADER_TEXT = 'MATLAB 5.0 MAT-file, a model workspace as data-explorer-core edits it';
/**
 * The MAT-file `stream`, a model workspace part's bytes, is as this package edits it, and what was
 * read of it for the conversion back; or why it is not one this package can convert and convert
 * back exactly, as a clause.
 */
export function matOfWorkspaceStream(stream) {
    if (stream.length < 16 || !PREAMBLE.every((b, i) => stream[i] === b)) {
        return { ok: false, why: 'it does not open as MATLAB writes a model workspace' };
    }
    const decoded = decodeMatStream(stream, { whole: true });
    if (!decoded.ok) {
        return { ok: false, why: decoded.reason };
    }
    if (decoded.variable.className !== 'struct' || decoded.variable.dimensions.length !== 2 || decoded.variable.dimensions.some((d) => d !== 1)) {
        return { ok: false, why: 'it holds no 1x1 struct of variables' };
    }
    if (decoded.trailingElements.length > 1) {
        return { ok: false, why: 'it holds more after its variables than the objects they hold' };
    }
    const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
    const outerEnd = 16 + view.getUint32(12, true);
    const parts = structParts(stream, view, 16, outerEnd);
    if (typeof parts === 'string') {
        return { ok: false, why: parts };
    }
    const subsystem = decoded.trailingElements[0] ?? null;
    if (subsystem && (view.getUint32(subsystem.byteOffset - stream.byteOffset, true) !== MI_MATRIX || outerEnd + subsystem.length !== stream.length)) {
        return { ok: false, why: 'the element after its variables is not the objects they hold' };
    }
    const fields = new Map();
    const records = new Map();
    const out = [];
    for (let i = 0; i < parts.names.length; i++) {
        const name = parts.names[i];
        const field = parts.fields[i];
        if (fields.has(name)) {
            return { ok: false, why: 'it holds two variables named "' + name + '"' };
        }
        const record = field.length === 8 ? emptyRecord(name) : elementNamed(field, name);
        if (!record) {
            return { ok: false, why: 'its variable "' + name + '" is not an array a name can be given' };
        }
        fields.set(name, field);
        records.set(name, record);
        out.push(record);
    }
    const header = new Uint8Array(128);
    header.fill(0x20, 0, 116);
    header.set(new TextEncoder().encode(HEADER_TEXT), 0);
    const recordsLength = out.reduce((n, r) => n + r.length, 0);
    if (subsystem) {
        new DataView(header.buffer).setBigUint64(116, BigInt(128 + recordsLength), true);
        out.push(subsystem);
    }
    header.set([0x00, 0x01, 0x49, 0x4d], 124);
    return {
        ok: true,
        mat: concat([header, ...out]),
        read: { preamble: stream.slice(0, 8), head: parts.head, names: parts.names, fields, records },
    };
}
/**
 * The model workspace part of `mat`, a MAT-file this package wrote of one `read` was converted out
 * of (MatFileWriter.serializeMatFile of the MatNode made of it): each named record a field of the
 * struct, as it was read where the record is the one built of it, and the unnamed record the element
 * after it. Throws, saying why, where `mat` is not a MAT-file a stream can be made of: one with a
 * record this cannot read as an array, or more than one unnamed record.
 */
export function workspaceStreamOfMat(mat, read) {
    const parsed = parseMat(mat.buffer.slice(mat.byteOffset, mat.byteOffset + mat.byteLength));
    const names = [];
    const fields = [];
    let subsystem = null;
    for (const record of parsed.records) {
        const element = record.compressed ? inflateZlib(record.bytes.subarray(8, 8 + new DataView(record.bytes.buffer, record.bytes.byteOffset).getUint32(4, true))) : record.bytes;
        if (record.name === null) {
            throw new Error('a variable of it could not be read as an array');
        }
        if (record.anonymous) {
            if (subsystem) {
                throw new Error('it holds two values with no name');
            }
            subsystem = whole(element);
            continue;
        }
        const built = read.records.get(record.name);
        const field = built && sameBytes(built, whole(element)) ? read.fields.get(record.name) : elementNamed(whole(element), '');
        if (!field) {
            throw new Error('its variable "' + record.name + '" could not be written as a field of the workspace');
        }
        names.push(record.name);
        fields.push(field);
    }
    const head = names.length === read.names.length && names.every((n, i) => n === read.names[i]) ? read.head : structHead(read.head, names);
    const body = concat([head, ...fields]);
    return concat([read.preamble, u32le(MI_MATRIX), u32le(body.length), body, ...(subsystem ? [subsystem] : [])]);
}
// The struct's subelements before its fields, its field names and its fields, read out of the
// miMATRIX at `at` whose data ends at `end`; or why not.
function structParts(bytes, view, at, end) {
    let p = at;
    const sub = () => {
        if (p + 8 > end) {
            return null;
        }
        const word = view.getUint32(p, true);
        if (word >>> 16) {
            const n = word >>> 16;
            return n > 4 ? null : { type: word & 0xffff, data: bytes.subarray(p + 4, p + 4 + n), next: p + 8 };
        }
        const n = view.getUint32(p + 4, true);
        const next = p + 8 + n + ((8 - (n % 8)) % 8);
        return next > end ? null : { type: word, data: bytes.subarray(p + 8, p + 8 + n), next };
    };
    const flags = sub();
    if (!flags || flags.data.length < 1 || flags.data[0] !== STRUCT_CLASS) {
        return 'its variables are not held as a struct';
    }
    p = flags.next;
    for (let i = 0; i < 2; i++) {
        const skipped = sub();
        if (!skipped) {
            return 'its struct of variables does not frame';
        }
        p = skipped.next;
    }
    const lengthEl = sub();
    if (!lengthEl || lengthEl.type !== MI_INT32 || lengthEl.data.length !== 4) {
        return 'its struct of variables names no field-name length';
    }
    const stride = new DataView(lengthEl.data.buffer, lengthEl.data.byteOffset, 4).getInt32(0, true);
    p = lengthEl.next;
    const table = sub();
    if (!table || table.type !== MI_INT8 || stride <= 0 || table.data.length % stride !== 0) {
        return 'its struct of variables holds no field-name table';
    }
    const names = [];
    for (let i = 0; i < table.data.length; i += stride) {
        const raw = table.data.subarray(i, i + stride);
        const zero = raw.indexOf(0);
        names.push(new TextDecoder().decode(zero < 0 ? raw : raw.subarray(0, zero)));
    }
    p = table.next;
    const head = bytes.slice(at, p);
    const fields = [];
    while (p < end) {
        if (p + 8 > end || view.getUint32(p, true) !== MI_MATRIX) {
            return 'a variable of it is not an array';
        }
        const next = p + 8 + view.getUint32(p + 4, true);
        if (next > end) {
            return 'a variable of it runs past the workspace';
        }
        fields.push(bytes.slice(p, next));
        p = next;
    }
    if (fields.length !== names.length) {
        return 'its struct of variables names ' + names.length + ' of them and holds ' + fields.length;
    }
    return { head, names, fields };
}
/**
 * The field-name length MATLAB's getByteStreamFromArray writes for a struct of fields `names`: the
 * longest name plus its terminator, never under 3, and 1 for no field. Not a MAT-file's (MatWriter's
 * struct, never under 5): measured on R2027a, test/parity/matlab/probe_workspace_stream.m.
 */
export function workspaceFieldStride(names) {
    if (names.length === 0) {
        return 1;
    }
    return Math.max(2, ...names.map((n) => new TextEncoder().encode(n).length)) + 1;
}
// The struct's head of `read`, its flags, dims and name as they were, with the field names `names`:
// the field-name length MATLAB writes for them (workspaceFieldStride) and the table.
function structHead(read, names) {
    const view = new DataView(read.buffer, read.byteOffset, read.byteLength);
    let p = 0;
    for (let i = 0; i < 3; i++) {
        const word = view.getUint32(p, true);
        const n = word >>> 16 ? 0 : view.getUint32(p + 4, true);
        p += word >>> 16 ? 8 : 8 + n + ((8 - (n % 8)) % 8);
    }
    const encoded = names.map((n) => new TextEncoder().encode(n));
    const stride = workspaceFieldStride(names);
    const table = new Uint8Array(stride * names.length);
    encoded.forEach((e, i) => table.set(e, i * stride));
    const length = new Uint8Array(8);
    const lv = new DataView(length.buffer);
    lv.setUint16(0, MI_INT32, true);
    lv.setUint16(2, 4, true);
    lv.setInt32(4, stride, true);
    const pad = (8 - (table.length % 8)) % 8;
    return concat([read.slice(0, p), length, u32le(MI_INT8), u32le(table.length), table, new Uint8Array(pad)]);
}
// A top-level `name = []`, what MATLAB loads a field of no bytes as. The writer writes an element
// unnamed, as a member is; the record is given its name.
function emptyRecord(name) {
    return elementNamed(encodeMatVariable({ name, className: 'double', dimensions: [0, 0], isComplex: false, isLogical: false, value: null, fields: null }), name);
}
// A record's element without the padding after it, to the length its tag says.
function whole(element) {
    const view = new DataView(element.buffer, element.byteOffset, element.byteLength);
    const type = view.getUint32(0, true);
    const end = type === MI_COMPRESSED ? element.length : 8 + view.getUint32(4, true);
    return element.subarray(0, Math.min(end, element.length));
}
function sameBytes(a, b) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
}
function u32le(n) {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, n, true);
    return out;
}
function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}
//# sourceMappingURL=ModelWorkspaceStream.js.map