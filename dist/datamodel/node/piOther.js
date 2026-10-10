// Copyright 2026 The MathWorks, Inc.
// Builds the Property Inspector "Other" catch-all: every raw `_properties` key a
// node carries that its curated/schema layout did NOT already surface. This lets
// the PI show ALL of a node's properties, not just the modeled ones.
//
// No node or schema imports (it reads only a plain `_properties` bag, the parser
// helpers that read a value out of one, and the display convention's spellings), so it
// stays inside the extractable data-model layer. Behavior:
//   - Nested MATLAB objects ({ _object_class, _properties }) are flattened ONE
//     level: `CoderInfo.StorageClass`, `CoderInfo.CSCPackageName`, …
//   - Typed scalars ({ _type, _value }) are unwrapped to their value.
//   - A `cdata` value — complex text, or a text dictionary's MAT stream — is read
//     and laid out the way the same channel shows a real value of its shape; a sparse
//     array, however it is spelled, is its summary (`<3x3 sparse double>`).
//   - Objects nested DEEPER than one level render as their `[ClassName]`.
//   - Arrays render as `[a, b, c]`.
// Values are read-only display strings; the bag is never mutated.
import { isMatCdata, uudecode } from '../parser/CdataCodec.js';
import { encodedClass, encodedStream, isEncodedValue } from '../parser/EncodedValue.js';
import { decodeMatStream } from '../parser/MatParser.js';
import { sparseSummaryForm } from '../display/DisplayConvention.js';
import { complexClassTag, formatComplexNum, formatMatlabNum, parseComplexNum, transposeFromColumnMajorND, } from '../parser/XmlUtils.js';
// Internal serialization-envelope keys — structural, never user properties.
const ENVELOPE_KEYS = new Set([
    '_id', '_object_class', '_array_class', '_array_type', '_dimensions',
    '_mw_element_type', '_type', '_value', '_properties', '_rawVal',
    '_elements', '_fields',
]);
function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
// A typed scalar envelope { _type, _value } → its stringified value (only when
// the value is itself a scalar, not a nested structure).
function asTypedScalar(v) {
    if (v._type === 'cdata' && typeof v._value === 'string') {
        return formatCdata(v);
    }
    // A binary dictionary's encoded value: its `_value` is hex text, which is storage and
    // not display. The bytes are the same MAT stream a text dictionary's cdata is.
    if (isEncodedValue(v)) {
        const stream = encodedStream(v);
        return stream.bytes ? formatStream(stream.bytes) : '<' + (encodedClass(v) || 'double') + ', not decoded>';
    }
    // This package's own literal for a sparse double ({_type: 'sparse', _value:
    // 'Matrix(2,2)…'} or a bare row `[0, 7, 0]`), as the stream of one shows above.
    if (v._type === 'sparse' && typeof v._value === 'string') {
        const header = /^Matrix\((\d+),(\d+)\)/.exec(v._value);
        const dims = header
            ? [Number(header[1]), Number(header[2])]
            : [1, v._value.replace(/^\[|\]$/g, '').split(',').filter((t) => t.trim() !== '').length];
        return sparseSummaryForm(dims, 'double');
    }
    if ('_value' in v && !isPlainObject(v._value) && !Array.isArray(v._value)) {
        return String(v._value);
    }
    return null;
}
// Elements laid out as this channel lays out a real value of the same shape: a scalar
// bare, a row as `[a, b, c]` (formatOther's array form, which a real row reaches as a
// bare list), and anything else rank-2 as the typed-literal `Matrix(r,c)` text a real
// matrix's `_value` is, a row per line, in row order. Past rank 2 there is no such text,
// so it is the summary the tree shows, `<2x2x2 double>`.
function layOut(rowMajor, dims, cls) {
    if (rowMajor.length === 1 && dims.length <= 2) {
        return rowMajor[0];
    }
    if (dims.length > 2) {
        return '<' + dims.join('x') + ' ' + cls + '>';
    }
    const [rows, cols] = dims;
    if (rows === 1) {
        return '[' + rowMajor.join(', ') + ']';
    }
    const lines = [];
    for (let r = 0; r < rows; r++) {
        lines.push('[' + rowMajor.slice(r * cols, (r + 1) * cols).join(', ') + ']');
    }
    return 'Matrix(' + rows + ',' + cols + ')\n' + lines.join('\n');
}
// A `cdata` value, which is never display text as it stands. Complex text (a binary
// dictionary's `<P IsComplex="1">` body, or the MCOS decoder's) is MATLAB's storage
// order — `1+2i 5+6i 3+4i 7+8i` for [1+2i 3+4i; 5+6i 7+8i] — and was shown just so, with no
// shape; a text dictionary's MAT stream is six-bit characters and was shown as those.
// Each is read here: the text as its elements (with MATLAB's `.0` dropped, as the node
// layer drops it), the stream by the reader every other path decodes one with. A stream
// that is not a number shows its summary, and one that does not decode, nothing. Text
// that is neither shows as it is, as every cdata value did.
function formatCdata(v) {
    const text = v._value;
    if (!isMatCdata(v)) {
        const colMajor = text.trim() === '' ? [] : text.trim().split(/\s+/).map((t) => t.replace(/(\d+)\.0(?=[+\-i]|$)/g, '$1'));
        const dims = Array.isArray(v._dimensions) ? v._dimensions : [1, colMajor.length];
        if (colMajor.length === 0) {
            return '[]';
        }
        if (!colMajor.every((t) => parseComplexNum(t) !== null) || colMajor.length !== dims.reduce((a, b) => a * b, 1)) {
            return text;
        }
        return layOut(transposeFromColumnMajorND(colMajor, dims), dims, complexClassTag(v._class) ?? 'double');
    }
    return formatStream(uudecode(text));
}
// A MAT stream — a text dictionary's cdata, decoded, or a binary dictionary's hex — laid
// out as above: a number as its elements, anything else as its summary, and a stream
// that does not decode as nothing. Read by the stream reader every other venue uses
// (MatParser.decodeMatStream).
function formatStream(bytes) {
    const stream = decodeMatStream(bytes);
    if (!stream.ok) {
        return '';
    }
    try {
        const m = stream.variable;
        // A sparse array is its summary here as in its own row, never its elements laid
        // out — or the reader's placeholder for one too large to read.
        if (m.isSparse) {
            return m.undecoded ? String(m.value) : sparseSummaryForm(m.dimensions, m.className);
        }
        const numeric = m.className !== 'char' && m.className !== 'struct' && m.className !== 'cell' && !m.isOpaque;
        if (!numeric || m.isLogical) {
            return '<' + m.dimensions.join('x') + ' ' + m.className + '>';
        }
        const values = Array.isArray(m.value) ? m.value : m.value === null ? [] : [m.value];
        if (values.length === 0) {
            return '[]';
        }
        const shown = values.map((x) => x !== null && typeof x === 'object' ? formatComplexNum(x.re, x.im) : formatMatlabNum(x));
        return layOut(shown, m.dimensions, m.className);
    }
    catch {
        return '';
    }
}
// A nested MATLAB object { _object_class, _properties } → its class + prop bag.
function asNestedObject(v) {
    if (isPlainObject(v._properties)) {
        return { className: String(v._object_class ?? ''), props: v._properties };
    }
    return null;
}
// Format a leaf value (primitive / array / deeper object) for display. A deeper
// object collapses to its `[ClassName]` rather than recursing (one-level rule).
function formatOther(v) {
    if (v === undefined || v === null) {
        return '';
    }
    if (Array.isArray(v)) {
        return '[' + v.join(', ') + ']';
    }
    if (isPlainObject(v)) {
        const scalar = asTypedScalar(v);
        if (scalar !== null) {
            return scalar;
        }
        const obj = asNestedObject(v);
        if (obj) {
            return obj.className ? '[' + obj.className + ']' : '[object]';
        }
        return '';
    }
    return String(v);
}
// Build the "Other" rows for a node's raw `_properties` bag, skipping any
// top-level key already surfaced by the curated/schema layout (`shownKeys`) and
// the structural envelope keys.
export function buildOtherRows(properties, shownKeys) {
    if (!isPlainObject(properties)) {
        return [];
    }
    const rows = [];
    for (const key of Object.keys(properties)) {
        if (shownKeys.has(key) || ENVELOPE_KEYS.has(key)) {
            continue;
        }
        const value = properties[key];
        if (isPlainObject(value)) {
            // Unwrap a typed scalar in place.
            const scalar = asTypedScalar(value);
            if (scalar !== null) {
                rows.push({ name: key, value: scalar });
                continue;
            }
            // Flatten a nested object ONE level: emit each of its sub-properties.
            const obj = asNestedObject(value);
            if (obj) {
                const subKeys = Object.keys(obj.props).filter((k) => !ENVELOPE_KEYS.has(k));
                if (subKeys.length === 0) {
                    // No sub-properties to flatten — keep the object visible by its class.
                    rows.push({ name: key, value: obj.className ? '[' + obj.className + ']' : '[object]' });
                }
                else {
                    for (const subKey of subKeys) {
                        rows.push({ name: key + '.' + subKey, value: formatOther(obj.props[subKey]) });
                    }
                }
                continue;
            }
            // A plain object with no recognized envelope — render compactly.
            rows.push({ name: key, value: formatOther(value) });
            continue;
        }
        rows.push({ name: key, value: formatOther(value) });
    }
    return rows;
}
//# sourceMappingURL=piOther.js.map