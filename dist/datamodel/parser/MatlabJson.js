// Copyright 2026 The MathWorks, Inc.
// JSON as MATLAB writes a model's parts (R2026b+: configSetN.json, configSetInfo.json and the rest),
// so that a part this package writes anew is MATLAB's own layout of the same object. Held to every
// JSON member of every `.slx` in the repo, written again from its parse byte for byte
// (test/matlabJson.test.ts). No node is imported here.
//
//   an object      `{`, each key on its own line two spaces in, `"key":value`, then `}`; `{}` empty
//   an array       of values: `[1,  2]`, two spaces after each comma; `[]` empty
//                  of one object: `[{`, the object's keys four spaces in, then `}]`; of one
//                  array, that array inline: `[[]]`
//                  of more objects (or arrays): `[`, each on its own line two spaces in, then `]`
//   a string       JSON's escapes, and `/` escaped too
//   no line break after the last `}`
/** `value`, a parsed JSON value, as MATLAB writes it. */
export function formatMatlabJson(value) {
    return format(value, '');
}
const isContainer = (v) => v !== null && typeof v === 'object';
function format(value, indent) {
    if (Array.isArray(value))
        return formatArray(value, indent);
    if (isContainer(value))
        return formatObject(value, indent, indent);
    if (typeof value === 'string')
        return JSON.stringify(value).replace(/\//g, '\\/');
    return JSON.stringify(value);
}
// The object's keys `inner + '  '` in, its closing brace at `close`.
function formatObject(obj, inner, close) {
    const keys = Object.keys(obj);
    if (keys.length === 0)
        return '{}';
    const at = inner + '  ';
    return '{\n' + keys.map((k) => `${at}${format(k, at)}:${format(obj[k], at)}`).join(',\n') + '\n' + close + '}';
}
function formatArray(items, indent) {
    if (items.length === 0)
        return '[]';
    if (!items.some(isContainer))
        return '[' + items.map((v) => format(v, indent)).join(',  ') + ']';
    const first = items[0];
    if (items.length === 1) {
        return '[' + (Array.isArray(first) ? formatArray(first, indent + '  ') : formatObject(first, indent + '  ', indent + '  ')) + ']';
    }
    const at = indent + '  ';
    return '[\n' + items.map((v) => at + format(v, at)).join(',\n') + '\n' + indent + ']';
}
//# sourceMappingURL=MatlabJson.js.map