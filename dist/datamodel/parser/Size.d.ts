/** The most elements one dimension of a MAT stream may have: its dims word is an int32. */
export declare const MAT_MAX_EXTENT = 2147483647;
/** Whether `x` is one extent of a size: a whole number of elements a double counts exactly. */
export declare function isExtent(x: unknown): x is number;
/** Whether `d` is a size: a list whose every entry is an extent. */
export declare function isSize(d: unknown): d is number[];
/** Whether an XML Dimension can spell `x` as read: a finite non-negative number. */
export declare function isSpellableExtent(x: unknown): x is number;
/** `d` as it was given, for a message: `[1,"x"]`, `[0,Infinity]`, `[NaN,1]`, `[2n,3n]`. */
export declare function dimsText(d: unknown): string;
//# sourceMappingURL=Size.d.ts.map