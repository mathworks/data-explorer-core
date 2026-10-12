/** The most elements one dimension of a MAT stream may have: its dims word is an int32. */
export declare const MAT_MAX_EXTENT = 2147483647;
/** Whether `x` is one extent of a size: a whole number of elements a double counts exactly. */
export declare function isExtent(x: unknown): x is number;
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
 * The count is written in a Dimension as String spells it, 2^60 as 1152921504606847000: the
 * XML writers' spelling of every extent, which this does not change.
 */
export declare function isExactDigits(digits: string): boolean;
/**
 * `x`, an extent a binary dictionary's reader read as a double, as the digits of a `Matrix(…)`
 * header: the count it is. String spells a whole number past 2^53 - 1 with the shortest digits
 * that parse to it, which can say another count (2^60 as 1152921504606847000), and a header so
 * spelled is refused (isExactDigits). From 10^21 String spells an exponent instead; that is
 * left as it was.
 */
export declare function headerDigits(x: number): string;
/** Whether `x` is anything but NaN, an infinity or a bigint, the extents a text dictionary refuses. */
export declare function isTextExtent(x: unknown): boolean;
/** `d` as it was given, for a message: `[1,"x"]`, `[0,Infinity]`, `[NaN,1]`, `[2n,3n]`. */
export declare function dimsText(d: unknown): string;
//# sourceMappingURL=Size.d.ts.map