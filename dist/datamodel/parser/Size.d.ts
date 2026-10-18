/** The most elements one dimension of a MAT stream may have: its dims word is an int32. */
export declare const MAT_MAX_EXTENT = 2147483647;
/** Whether `x` is one extent of a size: a whole number of elements a double counts exactly. */
export declare function isExtent(x: unknown): x is number;
/**
 * Whether `d` is a list and `pred` holds for every entry of it, a hole read as undefined:
 * `every` skips a hole, so `[1, <hole>].every(isExtent)` is true.
 */
export declare function everyExtent(d: unknown, pred: (x: unknown) => boolean): d is unknown[];
/** Whether `d` is a size: a list whose every entry is an extent. */
export declare function isSize(d: unknown): d is number[];
/** Whether a MAT stream can say `d`: a size, every extent of which its int32 dims word holds. */
export declare function isStreamSize(d: unknown): d is number[];
/** Whether an XML Dimension can spell `x` as read: a finite non-negative number. */
export declare function isSpellableExtent(x: unknown): x is number;
/**
 * Whether `digits`, one extent of a `Matrix(…)` header, name a count a double holds exactly,
 * so that the count a writer parses them to is the count they say. A double holds every count
 * to 2^53 - 1 and only some past it: 2^53 and 2^60 (1152921504606846976) it holds, but
 * 9007199254740993 parses to 2^53, and 1152921504606847000, the digits String gives 2^60,
 * parses to 2^60, which is another count. Whether the digits survive a round trip as text
 * is another question: 2^60's own do not, and String(2^60)'s do. Leading zeros say nothing.
 * A Dimension spells a count with its own digits (dimensionText), 2^60 as
 * 1152921504606846976, which this holds to be the count they say.
 */
export declare function isExactDigits(digits: string): boolean;
/**
 * `x`, one extent, as the text that states it: for a whole non-negative number, the digits of
 * the count it is. String spells a whole number past 2^53 - 1 with the shortest digits that
 * parse to it, which can say another count (2^60 as 1152921504606847000, which isExactDigits
 * refuses), and from 10^21 with an exponent (1e+21), which no reader takes for digits. Any
 * other number, 2.5 among them, and anything that is not a number, is as String spells it.
 */
export declare function extentDigits(x: number): string;
/**
 * `x`, an extent a binary dictionary's reader read as a double, as the digits of a `Matrix(…)`
 * header: the count it is (extentDigits), 10^21 included, so a header so built is never
 * refused (isExactDigits).
 */
export declare function headerDigits(x: number): string;
/**
 * `dims` as an XML Dimension states them, `0*1152921504606846976`: every number extent with
 * the digits of the count it is (extentDigits), joined by `*`. What is not a number is joined
 * as `join` joins it; the writers refuse such dims before they spell them (isSpellableExtent).
 */
export declare function dimensionText(dims: readonly unknown[]): string;
/**
 * Whether `x` is anything but NaN, an infinity, a bigint, undefined, a function or a symbol,
 * the extents a text dictionary refuses.
 */
export declare function isTextExtent(x: unknown): boolean;
/**
 * `d` as it was given, for a message: `[1,"x"]`, `[0,Infinity]`, `[NaN,1]`, `[2n,3n]`. A hole
 * is `undefined`, and a function `a function`, not its source.
 */
export declare function dimsText(d: unknown): string;
//# sourceMappingURL=Size.d.ts.map