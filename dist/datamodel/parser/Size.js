// Copyright 2026 The MathWorks, Inc.
//
// What a size is, for a writer. A value's dims are words a file or a host supplied, and the
// readers take them as they come: MATLAB writes whole numbers of elements, but a hand-made
// or damaged value can carry anything — `[1, "x"]`, `[1, {}]`, `[0, 1e400]` out of JSON,
// `[NaN, 1]` or a bigint from a host. What is written from them has to be what they say:
//   - a MAT stream counts elements, so its dims must be a size — every extent a whole number
//     of elements a double counts exactly (isSize) — and each must fit the stream's int32
//     dims word (MAT_MAX_EXTENT). MatWriter refuses anything else, finally;
//   - an XML Dimension spells extents as text, and a binary dictionary's reader passes every
//     finite non-negative number through as read (`1*2.5` included), so the XML writers
//     write any such extent back as read, and refuse only what no Dimension can spell
//     (isSpellableExtent): NaN, an infinity, a negative, a string, an object;
//   - a text literal's `Matrix(r,c)` header states its extents as digits, which the writers
//     parse to doubles, so digits a double does not hold as written (isExactDigits) are
//     refused too: they would be spelled as another count;
//   - a text dictionary is written as JSON, so a hand-made `[1, "x"]` is written back as
//     read, and NaN, an infinity and a bigint are refused (isTextExtent): JSON.stringify
//     writes the first two as null and cannot write a bigint at all. It writes undefined, a
//     function, a symbol and an array hole as null too; those are not asked.
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
/** Whether a MAT stream can say `d`: a size, every extent of which its int32 dims word holds. */
export function isStreamSize(d) {
    return isSize(d) && d.every((x) => x <= MAT_MAX_EXTENT);
}
/** Whether an XML Dimension can spell `x` as read: a finite non-negative number. */
export function isSpellableExtent(x) {
    return typeof x === 'number' && Number.isFinite(x) && x >= 0;
}
/**
 * Whether `digits`, one extent of a `Matrix(…)` header, parse to the count they say, so that a
 * Dimension spelled from that count says what the header said. A double holds every count to
 * 2^53 - 1 and only some past it: 9007199254740992 (2^53), which a binary dictionary's reader
 * puts in a header for its own `0*9007199254740992`, is held as written; 9007199254740993
 * parses to 2^53, and 22 digits or more parse to a number spelled with an exponent. Leading
 * zeros say nothing.
 */
export function isExactDigits(digits) {
    return String(Number(digits)) === digits.replace(/^0+(?=\d)/, '');
}
/** Whether `x` is anything but NaN, an infinity or a bigint, the extents a text dictionary refuses. */
export function isTextExtent(x) {
    return typeof x === 'number' ? Number.isFinite(x) : typeof x !== 'bigint';
}
/** `d` as it was given, for a message: `[1,"x"]`, `[0,Infinity]`, `[NaN,1]`, `[2n,3n]`. */
export function dimsText(d) {
    const one = (x) => {
        if (typeof x === 'number')
            return String(x);
        if (typeof x === 'bigint')
            return String(x) + 'n';
        if (typeof x === 'string')
            return JSON.stringify(x);
        try {
            return JSON.stringify(x) ?? String(x);
        }
        catch {
            return String(x);
        }
    };
    return Array.isArray(d) ? '[' + d.map(one).join(',') + ']' : one(d);
}
//# sourceMappingURL=Size.js.map