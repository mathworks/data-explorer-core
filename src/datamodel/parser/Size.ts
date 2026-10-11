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
//     (isSpellableExtent): NaN, an infinity, a negative, a string, an object.

/** The most elements one dimension of a MAT stream may have: its dims word is an int32. */
export const MAT_MAX_EXTENT = 0x7fffffff;

/** Whether `x` is one extent of a size: a whole number of elements a double counts exactly. */
export function isExtent(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
}

/** Whether `d` is a size: a list whose every entry is an extent. */
export function isSize(d: unknown): d is number[] {
  return Array.isArray(d) && d.every(isExtent);
}

/** Whether an XML Dimension can spell `x` as read: a finite non-negative number. */
export function isSpellableExtent(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0;
}

/** `d` as it was given, for a message: `[1,"x"]`, `[0,Infinity]`, `[NaN,1]`, `[2n,3n]`. */
export function dimsText(d: unknown): string {
  const one = (x: unknown): string => {
    if (typeof x === 'number') return String(x);
    if (typeof x === 'bigint') return String(x) + 'n';
    if (typeof x === 'string') return JSON.stringify(x);
    try {
      return JSON.stringify(x) ?? String(x);
    } catch {
      return String(x);
    }
  };
  return Array.isArray(d) ? '[' + d.map(one).join(',') + ']' : one(d);
}
