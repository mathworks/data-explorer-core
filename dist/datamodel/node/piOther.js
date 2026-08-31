// Copyright 2026 The MathWorks, Inc.
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
    if ('_value' in v && !isPlainObject(v._value) && !Array.isArray(v._value)) {
        return String(v._value);
    }
    return null;
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