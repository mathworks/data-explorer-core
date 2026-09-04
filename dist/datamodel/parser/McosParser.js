// Copyright 2026 The MathWorks, Inc.
import { parseMatrix } from './MatParser.js';
import { formatMatlabNum, isExactToken } from './XmlUtils.js';
const MI_MATRIX = 14;
const MCOS_HANDLE_MAGIC = 3707764736; // 0xDD000000
const MAX_RECURSION_DEPTH = 32;
// A MATLAB `string`-typed value is stored as its own MCOS object whose text lives in
// a packed uint64 heap cell. That cell IS decoded now (see the payload section below,
// and test/parity/matlab/STRING_MCOS.md for the dumps it was read off); this sentinel
// is what remains for a payload whose words do not account for the text — a shape
// without characters, never characters we guessed.
export const NOT_AVAILABLE = '<not available>';
// A `string` is an MCOS object, so it arrives on this path — but unlike every other
// class here it is a MATLAB DATA TYPE, and the node layer treats it as one. Exported
// because the caller that routes a named variable to its node has to make the same
// distinction, and two spellings of the class name could drift apart.
export const STRING_CLASS_NAME = 'string';
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
// The bytes of a `uint8` matrix, or null if this matrix is not one. parseMatrix
// decodes every numeric class to a plain number array — never a typed array — so
// that is the only conversion needed, and a matrix of some other class is not a
// blob we can navigate. (A ONE-element uint8 matrix decodes to a bare number and
// is rejected here; both callers separately require at least 16 bytes anyway.)
function uint8Bytes(matrix) {
    return matrix.className === 'uint8' && Array.isArray(matrix.value)
        ? new Uint8Array(matrix.value)
        : null;
}
// ---- Navigation: raw element bytes -> the MCOS cell array (cells[]) -----------
function findCellArrayInOpaque(view, opaqueContentOffset, opaqueContentLength) {
    let offset = opaqueContentOffset;
    const end = Math.min(opaqueContentOffset + opaqueContentLength, view.byteLength);
    // Unreachable through today's single caller, which hands us a window inside an
    // opaque field whose own tag it already read — but kept, because what makes it
    // unreachable is an invariant of MatParser's `_rawBytes` slicing, one module away
    // and free to change. The cost is one uncovered line; the alternative is a
    // RangeError out of DataView that nothing between here and the host catches.
    const flagsSub = readSubelement(view, offset);
    if (!flagsSub)
        return null;
    offset += flagsSub.totalSize;
    // Terminates on any input: readSubelement's totalSize is 8 (small-element form)
    // or 8 + align8(an unsigned byte count), so it is never below 8 and `offset`
    // always advances. A damaged blob cannot spin this loop.
    while (offset < end) {
        const sub = readSubelement(view, offset);
        if (!sub)
            return null;
        if (sub.type === MI_MATRIX) {
            return { offset: sub.dataOffset, length: readableBytes(view, sub) };
        }
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
    const blobBytes = uint8Bytes(outerMatrix);
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
    // `!opaqueTag` means `_rawBytes` is under 8 bytes — not producible by today's
    // MatParser, which only sets the field after reading a tag out of it, but that is
    // its invariant to keep, not ours to assume. Same trade as the flags guard above:
    // one uncovered line instead of a DataView RangeError escaping the parser.
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
    const metadata = uint8Bytes(cells[0]);
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
    // Object table: 0-based rows; word0 = classId, word3 = type-1 block index,
    // word4 = type-2 property-block index. Row 0 is the null object.
    const objects = [];
    for (let p = w[4]; p + 24 <= w[5]; p += 24) {
        objects.push({ classId: u32(p), blockIdx: u32(p + 16), type1Idx: u32(p + 12) });
    }
    // Both block segments have the same encoding, so one reader serves both. Each
    // block is 8-byte aligned and addressed by the object row's own index word (not
    // positionally); block[0] is the empty/default block.
    const readBlocks = (from, to) => {
        const out = [];
        for (let p = from; p < to;) {
            const start = p;
            const nProps = u32(p);
            p += 4;
            // Defensive: a wildly large count means we lost alignment — stop rather than
            // fabricate. Empty (nProps == 0) blocks are real per-object placeholders.
            if (nProps > 1000 || p + nProps * 12 > to)
                break;
            const triples = [];
            for (let k = 0; k < nProps; k++) {
                triples.push([u32(p), u32(p + 4), u32(p + 8)]);
                p += 12;
            }
            out.push(triples);
            p = start + align8(p - start);
        }
        return out;
    };
    return {
        strings,
        classes,
        objects,
        blocks: readBlocks(w[5], w[6]),
        type1Blocks: readBlocks(w[3], w[4]),
    };
}
// ---- Value resolution ---------------------------------------------------------
// The handle PREFIX check: a uint32 array long enough to carry the shortest legal
// handle, [magic, ndims, rows, cols, id], and tagged with the magic. This is the
// single place that shape is decided — objectHandleFromValue takes it as a
// precondition rather than re-deriving it, so the two cannot drift apart on what
// counts as a handle.
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
// first.
//
// PRECONDITION: isObjectHandle(cell) — so `v` is a magic-tagged uint32 array of at
// least 5 elements. Null here means the DIMENSION words are not self-consistent
// (the count they describe does not fit the ids present), which a damaged blob can
// produce; the caller falls back to reading v[4] as a scalar id.
function objectHandleFromValue(v) {
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
        // Every extent, as at the root-variable site below: a property holding a 2x3x2
        // object array (ndNested.mat's h.Kids) reported [2, 3] over twelve elements, so
        // the container printed a shape MATLAB never had and the element subscripts ran
        // (1,1)..(2,3) twice. Identical to the old expression for the Nx1 property a Bus
        // holds, which is why nothing here noticed.
        const dims = handle.dims.length >= 2 ? handle.dims.slice() : [1, handle.ids.length];
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
    if (cell.isLogical) {
        if (Array.isArray(val))
            return val.map((x) => !!x);
        return !!val;
    }
    // Numeric classes (double, single, intN, uintN). An int64/uint64 whose magnitude a
    // double cannot hold arrives as its own decimal TEXT (MatParser via XmlUtils.exactInt),
    // so a scalar one is a string here — accepting only `typeof 'number'` would drop such a
    // property out of the object entirely rather than merely rounding it.
    if (typeof val === 'number' || isExactToken(val)) {
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
    // A `string` is a data type, not a class with properties: its whole state is the
    // payload cell, and an object shell built from its (empty) property block would
    // present as a value-less row. Decode the payload instead.
    if (cls && cls.fullName === STRING_CLASS_NAME) {
        return stringObjectValue(objId, ctx);
    }
    const properties = buildProperties(objId, ctx, path, depth);
    return { _object_class: cls ? cls.fullName : '', _properties: properties };
}
// ---- MATLAB `string`: the shape inside the payload cell ------------------------
//
// A `string` array is ONE MCOS object however many elements it holds — unlike a 1x3
// Simulink.Parameter, which is three objects — so the handle a named variable
// carries says [1,1] for a 1x3 and for a 2x2x2 alike. The real extents are inside
// the object's own payload cell, and this is the only channel that has them.
//
// The route to that cell, measured rather than guessed (test/parity/matlab/
// STRING_MCOS.md records the dump each step came from):
//
//   object row word3 -> a TYPE-1 block -> exactly one triple, named "any", flag 1
//   -> heap index -> cells[index + 2], a 1xN uint64.
//
// `payload cell = objId + 1` fits every file whose only objects are strings and is
// NOT the rule: in strings_mixed.mat the string is object 4 with its payload at
// cells[9], because the Simulink.Parameter ahead of it took the first seven heap
// slots. The type-1 block is the only link.
//
// The payload's own words:
//
//   word 0            version — 1 in every case measured
//   word 1            ndims
//   words 2..2+ndims  the extents, MATLAB's own size()
//   next numel words  per-element UTF-16 code unit count, column-major;
//                     0xFFFFFFFFFFFFFFFF marks a `missing`
//   the rest          every element's code units concatenated, 4 per uint64,
//                     unit j of a group in bits 16*j..16*j+15, zero-padded at the end
//
// Two properties of that last row are what a decoder has to get right:
//
//   - The units are ONE CONTINUOUS STREAM. An element does not start a fresh word:
//     "alpha" "beta" "gamma" packs as  alph | abet | agam | ma__ .
//   - The count is CODE UNITS, not characters. "a😀b" counts 4, because the emoji is a
//     surrogate pair — and MATLAB's own strlength says 4 too. Walking characters would
//     desynchronize the whole stream after the first astral one.
//
// `""` and `missing` are told apart by the count word — 0 versus all ones — not by
// absence. A `missing` contributes no units and still occupies its count slot.
//
// The count and data words are routinely outside a double's exact range (a word packing
// four code units almost always is), so they arrive as exact decimal TOKENS rather than
// numbers, from MatParser via XmlUtils.exactInt. Every read of them here goes through
// `payloadWord`, which takes either. The extents never do: they are small integers.
const STRING_PAYLOAD_PROP = 'any';
const STRING_PAYLOAD_VERSION = 1;
// 0xFFFFFFFFFFFFFFFF in the count slot — MATLAB's `missing`.
const STRING_MISSING_COUNT = 18446744073709551615n;
const UNITS_PER_WORD = 4;
// A sanity ceiling on one element's code-unit count, so a count word from a payload that
// is not the one measured cannot ask for a billion-element array before failing.
const MAX_STRING_UNITS = 0x7fffffff;
// String.fromCharCode is applied to a slice of the unit array; a long enough element
// would overflow the call stack if the whole thing went in as arguments at once.
const FROM_CHAR_CODE_CHUNK = 4096;
// The payload words of a `string` object, or null if this object does not carry one
// in the exact shape measured. Never a partial answer: a type-1 block with anything
// other than the single "any" triple is a layout we have not seen, and a guessed
// shape is as wrong as a guessed character.
function stringPayloadWords(objId, ctx) {
    const obj = ctx.meta.objects[objId];
    if (!obj || obj.type1Idx === 0)
        return null;
    const block = ctx.meta.type1Blocks[obj.type1Idx];
    if (!block || block.length !== 1)
        return null;
    const [nameIdx, flag, value] = block[0];
    // flag 1 is "value is a heap index", as in the type-2 segment.
    if (flag !== 1 || ctx.meta.strings[nameIdx] !== STRING_PAYLOAD_PROP)
        return null;
    const cell = ctx.cells[value + 2];
    if (!cell || cell.className !== 'uint64')
        return null;
    const v = cell.value;
    if (Array.isArray(v))
        return v;
    return typeof v === 'number' || isExactToken(v) ? [v] : null;
}
// One payload word as an exact integer, whether it arrived as a number or as the decimal
// token a word too large for a double is carried in. Null for anything else, which is a
// payload that is not the one measured rather than a word to work around.
function payloadWord(word) {
    if (typeof word === 'number') {
        return Number.isSafeInteger(word) && word >= 0 ? BigInt(word) : null;
    }
    if (typeof word === 'string' && isExactToken(word)) {
        const n = BigInt(word);
        return n >= 0n ? n : null;
    }
    return null;
}
function textFromUnits(units) {
    if (units.length <= FROM_CHAR_CODE_CHUNK)
        return String.fromCharCode(...units);
    let out = '';
    for (let i = 0; i < units.length; i += FROM_CHAR_CODE_CHUNK) {
        out += String.fromCharCode(...units.slice(i, i + FROM_CHAR_CODE_CHUNK));
    }
    return out;
}
// The `numel` elements of a payload, column-major, starting at the first count word.
// `null` FOR THE WHOLE ARRAY means the words do not account for the text — a shape we can
// still report without characters we would have had to invent. `null` for ONE element is
// MATLAB's `missing`, which is a value, not a failure.
function decodeStringElements(words, countStart, numel) {
    const counts = [];
    let totalUnits = 0;
    for (let i = 0; i < numel; i++) {
        const w = payloadWord(words[countStart + i]);
        if (w === null)
            return null;
        if (w === STRING_MISSING_COUNT) {
            counts.push(null);
            continue;
        }
        if (w > BigInt(MAX_STRING_UNITS))
            return null;
        const n = Number(w);
        counts.push(n);
        totalUnits += n;
    }
    const dataStart = countStart + numel;
    const wordsNeeded = Math.ceil(totalUnits / UNITS_PER_WORD);
    if (dataStart + wordsNeeded > words.length)
        return null;
    // Unpack the whole stream first: an element does not begin on a word boundary, so the
    // units cannot be read per element without tracking a bit offset into a shared word.
    const units = [];
    for (let i = 0; i < wordsNeeded; i++) {
        const packed = payloadWord(words[dataStart + i]);
        if (packed === null)
            return null;
        for (let j = 0; j < UNITS_PER_WORD; j++) {
            units.push(Number((packed >> BigInt(16 * j)) & 0xffffn));
        }
    }
    const elements = [];
    let at = 0;
    for (const count of counts) {
        if (count === null) {
            elements.push(null);
            continue;
        }
        elements.push(textFromUnits(units.slice(at, at + count)));
        at += count;
    }
    return elements;
}
// MATLAB's own size() and text for a `string` object, or null when the payload is not
// reachable in the exact shape measured.
//
// `dims` and `elements` fail independently on purpose. The extents are small integers and
// survive conditions the packed code-unit words do not, so a payload whose text cannot be
// accounted for still reports its shape — `elements: null` — and the caller falls back to
// a summary rather than to a wrong size or a wrong character.
function stringPayload(objId, ctx) {
    const words = stringPayloadWords(objId, ctx);
    if (!words || words.length < 3)
        return null;
    // A version word we have never seen means a layout we cannot claim to know, so the
    // extents are not read from a position that may have moved.
    if (words[0] !== STRING_PAYLOAD_VERSION)
        return null;
    const ndims = words[1];
    // size() is never rank-1 in MATLAB; 8 is the same ceiling the object handles use. A
    // rank this small is a plain number, so an exact TOKEN in this slot is not a huge rank
    // — it is a payload that is not the one measured, and comparing it numerically would
    // coerce it and read extents from a position that may have moved.
    if (typeof ndims !== 'number' || ndims < 2 || ndims > 8 || 2 + ndims > words.length)
        return null;
    const raw = words.slice(2, 2 + ndims);
    if (!raw.every((d) => typeof d === 'number' && Number.isInteger(d) && d >= 0))
        return null;
    const dims = raw;
    const numel = dims.reduce((a, b) => a * b, 1);
    // strings(0,0) writes its extents and stops — no count words at all, and no text to
    // recover. An empty array of elements is the right answer, not a failed decode.
    const elements = numel === 0 ? [] : decodeStringElements(words, 2 + ndims, numel);
    return { dims, elements };
}
// The value a `string` object contributes when it is somebody's property: the same
// dimensioned envelope the dictionary formats use for a string array, so one node-layer
// path renders a string wherever it came from. NOT_AVAILABLE when the payload is not
// there in the measured form — a sentinel, never a guessed character.
//
// No SIMULINK class reaches this — assigning a string to one of their properties converts
// it to a char (STRING_MCOS.md, "What is NOT reachable"). A user-written class does:
// object_props.mat's `Vehicle.Name` is a string property, and it is what pinned this.
function stringObjectValue(objId, ctx) {
    const payload = stringPayload(objId, ctx);
    if (!payload || !payload.elements)
        return NOT_AVAILABLE;
    return {
        _array_type: 'String',
        _dimensions: payload.dims.slice(),
        _elements: payload.elements.slice(),
        _mw_element_type: 'MATLABArray',
    };
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
        // EVERY extent the handle declares. Keeping only the first two turned MATLAB's
        // 2x3x2 obj2x3x2 into a 2x3 — a shape it never had, over twelve elements whose
        // subscripts then repeated (1,1)..(2,3) twice. The handle's own ndims is the
        // authority; a 1-extent handle is a vector, which MATLAB reports as [1, N].
        //
        // Except for a `string`, where the handle is NOT the authority: one object holds
        // the whole array, so its handle says [1,1] whatever the shape, and the extents
        // have to come out of the payload. Falls back to the handle when the payload
        // cannot be read, which is the old [1,1] — wrong for an array, but no more wrong
        // than it was, and it is the only shape available.
        const payload = v.className === STRING_CLASS_NAME ? stringPayload(handle.ids[0], ctx) : null;
        const dimensions = payload?.dims ??
            (handle.dims.length >= 2 ? handle.dims.slice() : [1, handle.dims[0] ?? elements.length]);
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
            ...(v.className === STRING_CLASS_NAME ? { stringElements: payload?.elements ?? null } : {}),
        });
    }
    return result;
}
//# sourceMappingURL=McosParser.js.map