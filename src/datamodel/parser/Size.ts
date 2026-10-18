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
//     parse to doubles, so digits naming a count no double holds exactly (isExactDigits) are
//     refused too: they would be parsed to another count, and written as that one. A header
//     a binary dictionary's reader builds from the doubles it read is spelled with their
//     exact digits (headerDigits), so it never is;
//   - a text dictionary is written as JSON, so a hand-made `[1, "x"]` is written back as
//     read, and NaN, an infinity, a bigint, undefined, a function and a symbol are refused
//     (isTextExtent): JSON.stringify writes all but the bigint as null, which is not the
//     extent given, and cannot write a bigint at all. `null` is what a hand-made text file
//     holds, like "x", and is written back as read.
// Dims are walked by index (everyExtent), so an array hole is undefined, which no writer
// spells. `every` skips a hole: a `[1, <hole>]` passed for a size, and was written as
// `Dimension="1*"`, as no Dimension at all, or as null.

/** The most elements one dimension of a MAT stream may have: its dims word is an int32. */
export const MAT_MAX_EXTENT = 0x7fffffff;

/** Whether `x` is one extent of a size: a whole number of elements a double counts exactly. */
export function isExtent(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
}

/**
 * Whether `d` is a list and `pred` holds for every entry of it, a hole read as undefined:
 * `every` skips a hole, so `[1, <hole>].every(isExtent)` is true.
 */
export function everyExtent(d: unknown, pred: (x: unknown) => boolean): d is unknown[] {
  return Array.isArray(d) && Array.from(d).every(pred);
}

/** Whether `d` is a size: a list whose every entry is an extent. */
export function isSize(d: unknown): d is number[] {
  return everyExtent(d, isExtent);
}

/** Whether a MAT stream can say `d`: a size, every extent of which its int32 dims word holds. */
export function isStreamSize(d: unknown): d is number[] {
  return isSize(d) && d.every((x) => x <= MAT_MAX_EXTENT);
}

/** Whether an XML Dimension can spell `x` as read: a finite non-negative number. */
export function isSpellableExtent(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0;
}

/**
 * Whether `digits`, one extent of a `Matrix(…)` header, name a count a double holds exactly,
 * so that the count a writer parses them to is the count they say. A double holds every count
 * to 2^53 - 1 and only some past it: 2^53 and 2^60 (1152921504606846976) it holds, but
 * 9007199254740993 parses to 2^53, and 1152921504606847000, the digits String gives 2^60,
 * parses to 2^60, which is another count. Whether the digits survive a round trip as text
 * is another question: 2^60's own do not, and String(2^60)'s do. Leading zeros say nothing.
 * The count is written in a Dimension as String spells it, 2^60 as 1152921504606847000: the
 * XML writers' spelling of every extent, which this does not change.
 */
export function isExactDigits(digits: string): boolean {
  if (!/^\d+$/.test(digits)) {
    return false;
  }
  const n = Number(digits);
  return Number.isFinite(n) && BigInt(digits) === BigInt(n);
}

/**
 * `x`, an extent a binary dictionary's reader read as a double, as the digits of a `Matrix(…)`
 * header: the count it is. String spells a whole number past 2^53 - 1 with the shortest digits
 * that parse to it, which can say another count (2^60 as 1152921504606847000), and a header so
 * spelled is refused (isExactDigits). From 10^21 String spells an exponent instead; that is
 * left as it was.
 */
export function headerDigits(x: number): string {
  const s = String(x);
  return Number.isSafeInteger(x) || !/^\d+$/.test(s) ? s : BigInt(x).toString();
}

/**
 * Whether `x` is anything but NaN, an infinity, a bigint, undefined, a function or a symbol,
 * the extents a text dictionary refuses.
 */
export function isTextExtent(x: unknown): boolean {
  return typeof x === 'number'
    ? Number.isFinite(x)
    : !(x === undefined || typeof x === 'bigint' || typeof x === 'function' || typeof x === 'symbol');
}

/**
 * `d` as it was given, for a message: `[1,"x"]`, `[0,Infinity]`, `[NaN,1]`, `[2n,3n]`. A hole
 * is `undefined`, and a function `a function`, not its source.
 */
export function dimsText(d: unknown): string {
  const one = (x: unknown): string => {
    if (typeof x === 'number') return String(x);
    if (typeof x === 'bigint') return String(x) + 'n';
    if (typeof x === 'string') return JSON.stringify(x);
    if (typeof x === 'function') return 'a function';
    try {
      return JSON.stringify(x) ?? String(x);
    } catch {
      return String(x);
    }
  };
  return Array.isArray(d) ? '[' + Array.from(d).map(one).join(',') + ']' : one(d);
}
