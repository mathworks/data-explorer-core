// Copyright 2026 The MathWorks, Inc.
import { parseMatrix } from './MatParser.js';
import { formatMatlabNum } from './XmlUtils.js';
const MI_MATRIX = 14;
const MCOS_HANDLE_MAGIC = 3707764736; // 0xDD000000
const MAX_RECURSION_DEPTH = 32;
// A MATLAB `string`-typed property is stored as its own MCOS object whose text
// lives in a packed uint64 heap cell using an internal, undocumented encoding we
// cannot reverse with confidence. Rather than surface corrupted text, such a value
// resolves to this honest sentinel. (char arrays — 'like this' — are ordinary and
// decode correctly; only the double-quoted string type is affected.)
export const NOT_AVAILABLE = '<not available>';
const STRING_CLASS_NAME = 'string';
function align8(n) {
    return n + ((8 - (n % 8)) % 8);
}
// Null when the 8-byte tag would read past the end of the view. Every offset here
// is derived from a length the FILE declared, so a truncated or otherwise damaged
// blob can point past the bytes present; DataView answers that with a RangeError,
// and since nothing between here and the host catches it, the throw took out the
// whole open — a .slx whose modelWorkspace.mxarray was cut short failed to open at
// all rather than opening with an unresolved object. (MxArrayParser deliberately
// hands over a SHORT trailing element instead of a fabricated one, which is what
// makes such a blob reach this function.) A tag we cannot read is a blob we cannot
// navigate, so callers stop and the variable stays an empty shell.
function readSubelement(view, offset) {
    if (offset < 0 || offset + 8 > view.byteLength) {
        return null;
    }
    const tag = view.getUint32(offset, true);
    const hi = (tag >>> 16) & 0xffff;
    const lo = tag & 0xffff;
    if (hi !== 0 && lo !== 0) {
        return { type: lo, bytes: hi, dataOffset: offset + 4, totalSize: 8 };
    }
    const type = view.getUint32(offset, true);
    const bytes = view.getUint32(offset + 4, true);
    return { type, bytes, dataOffset: offset + 8, totalSize: 8 + align8(bytes) };
}
// A subelement's declared byte count, clamped to the bytes actually present, so a
// self-declared length cannot send parseMatrix reading off the end of the view.
function readableBytes(view, sub) {
    return Math.max(0, Math.min(sub.bytes, view.byteLength - sub.dataOffset));
}
function toUint8(value) {
    if (value instanceof Uint8Array)
        return value;
    if (Array.isArray(value))
        return new Uint8Array(value);
    return null;
}
// ---- Navigation: raw element bytes -> the MCOS cell array (cells[]) -----------
function findCellArrayInOpaque(view, opaqueContentOffset, opaqueContentLength) {
    let offset = opaqueContentOffset;
    const end = Math.min(opaqueContentOffset + opaqueContentLength, view.byteLength);
    const flagsSub = readSubelement(view, offset);
    if (!flagsSub)
        return null;
    offset += flagsSub.totalSize;
    while (offset < end) {
        const sub = readSubelement(view, offset);
        if (!sub)
            return null;
        if (sub.type === MI_MATRIX) {
            return { offset: sub.dataOffset, length: readableBytes(view, sub) };
        }
        // A zero-size subelement would leave `offset` where it was and spin here
        // forever on a damaged blob, so treat it as the end of what we can navigate.
        if (sub.totalSize <= 0)
            return null;
        offset += sub.totalSize;
    }
    return null;
}
// Walk the anonymous FileWrapper element: outer uint8 matrix -> inner struct with
// an opaque "MCOS" field -> that field's cell array. Returns cells[] or null.
function extractCells(anonRawBytes) {
    const outerView = new DataView(anonRawBytes.buffer, anonRawBytes.byteOffset, anonRawBytes.byteLength);
    // The 8-byte outer tag has to be there before either word of it can be read.
    if (outerView.byteLength < 16 || outerView.getUint32(0, true) !== MI_MATRIX)
        return null;
    const outerMatrix = parseMatrix(outerView, 8, Math.min(outerView.getUint32(4, true), outerView.byteLength - 8));
    const blobBytes = outerMatrix.className === 'uint8' ? toUint8(outerMatrix.value) : null;
    if (!blobBytes || blobBytes.length < 16)
        return null;
    const blobView = new DataView(blobBytes.buffer, blobBytes.byteOffset, blobBytes.byteLength);
    const structSub = readSubelement(blobView, 8);
    if (!structSub || structSub.type !== MI_MATRIX)
        return null;
    const structMatrix = parseMatrix(blobView, structSub.dataOffset, readableBytes(blobView, structSub));
    const mcosField = structMatrix.fields && structMatrix.fields['MCOS'] ? structMatrix.fields['MCOS'] : null;
    if (!mcosField || !mcosField.isOpaque || !mcosField._rawBytes)
        return null;
    const opaqueView = new DataView(mcosField._rawBytes.buffer, mcosField._rawBytes.byteOffset, mcosField._rawBytes.byteLength);
    const opaqueTag = readSubelement(opaqueView, 0);
    if (!opaqueTag || opaqueTag.type !== MI_MATRIX)
        return null;
    const cellLoc = findCellArrayInOpaque(opaqueView, opaqueTag.dataOffset, readableBytes(opaqueView, opaqueTag));
    if (!cellLoc)
        return null;
    const cellArray = parseMatrix(opaqueView, cellLoc.offset, cellLoc.length);
    if (cellArray.className !== 'cell' || !Array.isArray(cellArray.value))
        return null;
    return cellArray.value;
}
// ---- Metadata table parse -----------------------------------------------------
function parseMetaTable(cells) {
    if (cells.length < 1 || !cells[0])
        return null;
    const metadata = cells[0].className === 'uint8' ? toUint8(cells[0].value) : null;
    if (!metadata || metadata.length < 40)
        return null;
    const view = new DataView(metadata.buffer, metadata.byteOffset, metadata.byteLength);
    const u32 = (o) => view.getUint32(o, true);
    const w = [];
    for (let i = 0; i < 10; i++)
        w.push(u32(i * 4));
    // Segment offsets must be monotonic and within bounds to be trustworthy.
    if (!(40 <= w[2] && w[2] <= w[3] && w[3] <= w[4] && w[4] <= w[5] && w[5] <= w[6] && w[6] <= metadata.length)) {
        return null;
    }
    // String table: index 0 is the synthetic empty string; real strings are 1-based.
    const decoder = new TextDecoder();
    const strings = [''];
    for (let p = 40; p < w[2];) {
        let e = p;
        while (e < w[2] && metadata[e] !== 0)
            e++;
        strings.push(decoder.decode(metadata.slice(p, e)));
        p = e + 1;
    }
    // Class table: 0-based rows. fullName = "pkg.cls" (or just "cls" when no package).
    const classes = [];
    for (let p = w[2]; p + 16 <= w[3]; p += 16) {
        const pkg = strings[u32(p)] || '';
        const cls = strings[u32(p + 4)] || '';
        classes.push({ fullName: pkg ? pkg + '.' + cls : cls });
    }
    // Object table: 0-based rows; word0 = classId, word4 = property-block index.
    // Row 0 is the null object.
    const objects = [];
    for (let p = w[4]; p + 24 <= w[5]; p += 24) {
        objects.push({ classId: u32(p), blockIdx: u32(p + 16) });
    }
    // Property blocks: each 8-byte aligned, addressed by object word4 (not
    // positionally). block[0] is the empty/default block.
    const blocks = [];
    for (let p = w[5]; p < w[6];) {
        const start = p;
        const nProps = u32(p);
        p += 4;
        // Defensive: a wildly large count means we lost alignment — stop rather than
        // fabricate. Empty (nProps == 0) blocks are real per-object placeholders.
        if (nProps > 1000 || p + nProps * 12 > w[6])
            break;
        const triples = [];
        for (let k = 0; k < nProps; k++) {
            triples.push([u32(p), u32(p + 4), u32(p + 8)]);
            p += 12;
        }
        blocks.push(triples);
        p = start + align8(p - start);
    }
    return { strings, classes, objects, blocks };
}
// ---- Value resolution ---------------------------------------------------------
function isObjectHandle(cell) {
    if (cell.className !== 'uint32')
        return false;
    const v = cell.value;
    return Array.isArray(v) && v.length >= 5 && v[0] === MCOS_HANDLE_MAGIC;
}
// Parse an object handle already decoded into a uint32 value array (as it appears
// for a NESTED object-valued property inside a block), laid out exactly like the
// raw-byte form: [magic, ndims, dim0, dim1, …, objId0, objId1, …]. A scalar handle
// is [magic, 2, 1, 1, id]; an N-element array is [magic, 2, N, 1, id0..idN-1]. Returns
// the dimensions and the FULL id list so a nested object ARRAY (e.g. a Bus's
// Elements_internal, or any object-array property) keeps every element, not just its
// first. Returns null if the array isn't a well-formed handle.
function objectHandleFromValue(v) {
    if (!Array.isArray(v) || v.length < 5 || v[0] !== MCOS_HANDLE_MAGIC)
        return null;
    const ndims = v[1];
    if (ndims < 1 || ndims > 8 || 2 + ndims > v.length)
        return null;
    const dims = [];
    for (let d = 0; d < ndims; d++)
        dims.push(v[2 + d]);
    const count = dims.reduce((a, b) => a * b, 1);
    if (count < 1 || 2 + ndims + count > v.length)
        return null;
    const ids = [];
    for (let k = 0; k < count; k++)
        ids.push(v[2 + ndims + k]);
    return { dims, ids };
}
function buildMatrixValue(dims, elements) {
    const rows = dims[0];
    const cols = dims[1];
    const rowStrs = [];
    for (let r = 0; r < rows; r++) {
        const vals = [];
        for (let c = 0; c < cols; c++) {
            // These elements are raw IEEE-754 doubles out of the blob, so Inf and NaN
            // reach here as themselves; formatMatlabNum spells them the way MATLAB
            // does, where String() would write the unreadable 'Infinity'.
            vals.push(formatMatlabNum(elements[r * cols + c]));
        }
        rowStrs.push('[' + vals.join(', ') + ']');
    }
    // Same shape the SLDD path emits, so displayValue formats identically.
    return { _type: 'double', _value: 'Matrix(' + rows + ',' + cols + ')\n' + rowStrs.join('\n') };
}
// Turn a parsed mxArray value into a property value in the SLDD-shaped form the
// data model expects. Object handles recurse into nested { _object_class,
// _properties }; structs and cells recurse into { _array_type: 'Struct'|'Cell', … }.
// Unresolvable values return undefined (dropped).
function resolveValue(cell, ctx, path, depth) {
    if (!cell)
        return undefined;
    if (isObjectHandle(cell)) {
        const handle = objectHandleFromValue(cell.value);
        // A SCALAR object property (the common case): one nested { _object_class,
        // _properties }, exactly as before.
        if (!handle || handle.ids.length === 1) {
            const refId = handle ? handle.ids[0] : cell.value[4];
            return buildObjectValue(refId, ctx, path, depth + 1);
        }
        // An object ARRAY property (e.g. a Bus's Elements_internal holding N
        // BusElements): expand EVERY id into its own element, producing the same
        // value-object array shape the SLDD path emits so the data model builds one
        // child node per element instead of dropping all but the first.
        const cls = ctx.meta.classes[ctx.meta.objects[handle.ids[0]]?.classId];
        const dims = handle.dims.length >= 2 ? [handle.dims[0], handle.dims[1]] : [1, handle.ids.length];
        return {
            _array_class: cls ? cls.fullName : '',
            _array_type: 'MATLABArray',
            _dimensions: dims,
            _mw_element_type: 'MATLABArray',
            _elements: handle.ids.map((id) => ({ _properties: buildProperties(id, ctx, path, depth + 1) })),
        };
    }
    const cls = cell.className;
    const val = cell.value;
    if (cls === 'struct') {
        return buildStructValue(cell, ctx, path, depth);
    }
    if (cls === 'cell') {
        const elems = Array.isArray(val) ? val : [];
        return {
            _array_type: 'Cell',
            _dimensions: cell.dimensions || [1, elems.length],
            _elements: elems.map((e) => resolveValue(e, ctx, path, depth)),
            _mw_element_type: 'MATLABArray',
        };
    }
    if (cls === 'char') {
        return typeof val === 'string' ? val : '';
    }
    if (cls === 'logical') {
        if (Array.isArray(val))
            return val.map((x) => !!x);
        return !!val;
    }
    // Numeric classes (double, single, intN, uintN).
    if (typeof val === 'number') {
        return val;
    }
    if (Array.isArray(val)) {
        if (val.length === 0)
            return [];
        const dims = cell.dimensions || [1, val.length];
        if (dims.length >= 2 && dims[0] > 1 && dims[1] > 1) {
            return buildMatrixValue(dims, val);
        }
        return val;
    }
    return undefined;
}
// A parsed struct mxArray -> the SLDD Struct value shape (single-element bag of
// fields), so StructNode.parse builds the same nested field rows the JSON path does.
function buildStructValue(cell, ctx, path, depth) {
    const fields = cell.fields || {};
    const element = {};
    const fieldNames = [];
    for (const [fieldName, fieldVar] of Object.entries(fields)) {
        const fv = Array.isArray(fieldVar) ? fieldVar[0] : fieldVar;
        element[fieldName] = resolveValue(fv, ctx, path, depth);
        fieldNames.push(fieldName);
    }
    return {
        _array_type: 'Struct',
        _dimensions: cell.dimensions || [1, 1],
        _elements: [element],
        _fields: fieldNames,
        _mw_element_type: 'MATLABArray',
    };
}
// Build the _properties bag for an object id, resolving each triple. Nested calls
// wrap the result as { _object_class, _properties }; the caller for a root object
// takes .properties directly.
function buildProperties(objId, ctx, path, depth) {
    const props = {};
    if (depth > MAX_RECURSION_DEPTH || path.has(objId))
        return props;
    const obj = ctx.meta.objects[objId];
    if (!obj)
        return props;
    path.add(objId);
    // 1) Class defaults FIRST, so every property this class declares surfaces by name
    //    (and value) even when the instance left it at its default and the instance
    //    block omits it. Then the instance block overrides those it mutated.
    const dflt = ctx.defaults[obj.classId];
    if (dflt && dflt.className === 'struct' && dflt.fields) {
        for (const [fieldName, fieldVar] of Object.entries(dflt.fields)) {
            const fv = Array.isArray(fieldVar) ? fieldVar[0] : fieldVar;
            const resolved = resolveValue(fv, ctx, path, depth);
            if (resolved !== undefined) {
                props[fieldName] = resolved;
            }
        }
    }
    // 2) Per-instance overrides, addressed by the object's block index (word4).
    const block = ctx.meta.blocks[obj.blockIdx] || [];
    for (const [nameIdx, flag, value] of block) {
        const name = ctx.meta.strings[nameIdx];
        if (!name)
            continue;
        let resolved;
        if (flag === 1) {
            resolved = resolveValue(ctx.cells[value + 2] || null, ctx, path, depth);
        }
        else if (flag === 0) {
            resolved = ctx.meta.strings[value] ?? '';
        }
        else if (flag === 2) {
            resolved = value !== 0;
        }
        else {
            continue; // unknown flag — never guess
        }
        if (resolved !== undefined) {
            props[name] = resolved;
        }
    }
    path.delete(objId);
    return props;
}
function buildObjectValue(objId, ctx, path, depth) {
    const obj = ctx.meta.objects[objId];
    if (!obj)
        return undefined;
    const cls = ctx.meta.classes[obj.classId];
    // A `string`-typed value object's text cannot be recovered — surface the honest
    // sentinel rather than an empty object shell or corrupted characters.
    if (cls && cls.fullName === STRING_CLASS_NAME) {
        return NOT_AVAILABLE;
    }
    const properties = buildProperties(objId, ctx, path, depth);
    return { _object_class: cls ? cls.fullName : '', _properties: properties };
}
// ---- Named-variable -> root object id -----------------------------------------
function splitClassName(fullClassName) {
    const lastDot = fullClassName.lastIndexOf('.');
    if (lastDot === -1)
        return { packageName: '', shortClassName: fullClassName };
    return { packageName: fullClassName.substring(0, lastDot), shortClassName: fullClassName.substring(lastDot + 1) };
}
// A named opaque variable's own element bytes contain an object handle laid out as
// uint32 words: [magic, ndims, dim0, dim1, …, objId0, objId1, …]. For a scalar this
// is [magic, 2, 1, 1, objId]; for an N-element array it is [magic, 2, N, 1, id0..idN-1]
// (object ids in column-major order). Returns the dimensions and the full id list so
// an object ARRAY expands into one node per element, not just its first object.
function objectHandleFromRaw(rawBytes) {
    if (!rawBytes || rawBytes.length < 4)
        return null;
    const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    for (let o = 0; o + 8 <= rawBytes.length; o += 4) {
        if (view.getUint32(o, true) !== MCOS_HANDLE_MAGIC)
            continue;
        const word = (i) => view.getUint32(o + i * 4, true);
        const ndims = word(1);
        // Defensive: a sane handle has 1..8 dims that fit within the remaining words.
        if (ndims < 1 || ndims > 8 || o + (2 + ndims) * 4 > rawBytes.length)
            return null;
        const dims = [];
        for (let d = 0; d < ndims; d++)
            dims.push(word(2 + d));
        const count = dims.reduce((a, b) => a * b, 1);
        if (count < 1 || o + (2 + ndims + count) * 4 > rawBytes.length)
            return null;
        const ids = [];
        for (let k = 0; k < count; k++)
            ids.push(word(2 + ndims + k));
        return { dims, ids };
    }
    return null;
}
export function decodeMcosBlob(anonRawBytes, opaqueVars) {
    const result = new Map();
    if (!anonRawBytes || anonRawBytes.length === 0 || opaqueVars.length === 0)
        return result;
    const cells = extractCells(anonRawBytes);
    if (!cells)
        return result;
    const meta = parseMetaTable(cells);
    if (!meta)
        return result;
    // Per-class defaults are the LAST heap cell: a cell array indexed by classId.
    // Absent or non-cell -> no defaults (buildProperties then relies on blocks only).
    const lastCell = cells.length > 0 ? cells[cells.length - 1] : null;
    const defaults = lastCell && lastCell.className === 'cell' && Array.isArray(lastCell.value)
        ? lastCell.value
        : [];
    const ctx = { cells, meta, defaults };
    for (const v of opaqueVars) {
        const handle = objectHandleFromRaw(v.rawBytes);
        if (!handle || handle.ids.length === 0)
            continue;
        // Confidence check: EVERY element object's class must match the variable's
        // declared class. If any doesn't, we mis-located the object graph — skip the
        // whole variable rather than surface a partial/guessed array.
        const idsInRange = handle.ids.every((id) => id > 0 && id < meta.objects.length);
        if (!idsInRange)
            continue;
        const classesMatch = handle.ids.every((id) => {
            const cls = meta.classes[meta.objects[id].classId];
            return cls && cls.fullName === v.className;
        });
        if (!classesMatch)
            continue;
        const elements = handle.ids.map((id) => buildProperties(id, ctx, new Set(), 0));
        // Normalize to a 2-D [rows, cols] shape the display path expects (a bare
        // MATLAB column vector arrives as [N, 1]; a scalar as [1, 1]).
        const dimensions = handle.dims.length >= 2 ? [handle.dims[0], handle.dims[1]] : [1, handle.dims[0] ?? elements.length];
        const { packageName, shortClassName } = splitClassName(v.className);
        result.set(v.name, {
            name: v.name,
            className: v.className,
            packageName,
            shortClassName,
            properties: elements[0] ?? {},
            elements,
            dimensions,
            value: (elements[0] ?? {}).Value,
        });
    }
    return result;
}
//# sourceMappingURL=McosParser.js.map