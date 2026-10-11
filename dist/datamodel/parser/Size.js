// Copyright 2026 The MathWorks, Inc.
//
// What a size is. A value's dims, as a reader hands them over, are words a file or a host
// supplied: MATLAB writes whole numbers of elements, but a hand-made or damaged value can
// carry anything — `[1, "x"]`, `[1, {}]`, `[0, 1e400]` out of JSON, `[NaN, 1]` from a host,
// a digit run past what a double holds exactly in a `Matrix(…)` header. Every extent of a
// size is a whole number of elements a double counts exactly. A reader takes anything else
// as damaged (NodeClassMap.parseValue, MatlabVariableNode.parseDamaged), and the writer
// refuses it (MatWriter.encodeElement), so no NaN reaches a count.
//
// A size is not bounded by what a MAT stream can say: MATLAB on 64 bits holds a
// zeros(0, 2^31), and text and XML spell its extents as text. That bound, MAT_MAX_EXTENT,
// is the encoder's alone: an array past it that has to be a stream is refused there.
/** The most elements one dimension of a MAT stream may have: its dims word is an int32. */
export const MAT_MAX_EXTENT = 0x7fffffff;
/** Whether `x` is one extent of a size: a whole number of elements a double counts exactly. */
export function isExtent(x) {
    return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
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