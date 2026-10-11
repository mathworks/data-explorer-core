// Copyright 2026 The MathWorks, Inc.
//
// What a size is. A value's dims, as a reader hands them over, are words a file or a host
// supplied: MATLAB writes whole numbers of elements, but a hand-made or damaged value can
// carry anything — `[1, "x"]`, `[1, {}]`, `[0, 1e400]` out of JSON, `[NaN, 1]` from a host,
// a digit run past what a double holds in a `Matrix(…)` header. Every extent of a size is a
// whole number from 0 to the most a MAT stream's int32 dims word can say. A reader takes
// anything else as damaged (NodeClassMap.parseValue, MatlabVariableNode.parseMatVariable),
// and the writer refuses it (MatWriter.encodeElement), so no NaN reaches a count.
/** The most elements one dimension may have: a MAT stream writes each as an int32. */
export const MAX_EXTENT = 0x7fffffff;
/** Whether `x` is one extent of a size. */
export function isExtent(x) {
    return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= MAX_EXTENT;
}
/** Whether `d` is a size: a list whose every entry is an extent. */
export function isSize(d) {
    return Array.isArray(d) && d.every(isExtent);
}
/** `d` as it was given, for a message: `[1,"x"]`, `[0,Infinity]`, `[NaN,1]`. */
export function dimsText(d) {
    if (!Array.isArray(d)) {
        return typeof d === 'string' ? JSON.stringify(d) : String(d);
    }
    return '[' + d.map((x) => (typeof x === 'number' ? String(x) : typeof x === 'string' ? JSON.stringify(x) : JSON.stringify(x) ?? String(x))).join(',') + ']';
}
//# sourceMappingURL=Size.js.map