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
 * Whether `digits`, one extent of a `Matrix(…)` header, parse to the count they say, so that a
 * Dimension spelled from that count says what the header said. A double holds every count to
 * 2^53 - 1 and only some past it: 9007199254740992 (2^53), which a binary dictionary's reader
 * puts in a header for its own `0*9007199254740992`, is held as written; 9007199254740993
 * parses to 2^53, and 22 digits or more parse to a number spelled with an exponent. Leading
 * zeros say nothing.
 */
export declare function isExactDigits(digits: string): boolean;
/** `d` as it was given, for a message: `[1,"x"]`, `[0,Infinity]`, `[NaN,1]`, `[2n,3n]`. */
export declare function dimsText(d: unknown): string;
//# sourceMappingURL=Size.d.ts.map