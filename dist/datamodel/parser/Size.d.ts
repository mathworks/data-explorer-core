/** The most elements one dimension may have: a MAT stream writes each as an int32. */
export declare const MAX_EXTENT = 2147483647;
/** Whether `x` is one extent of a size. */
export declare function isExtent(x: unknown): x is number;
/** Whether `d` is a size: a list whose every entry is an extent. */
export declare function isSize(d: unknown): d is number[];
/** `d` as it was given, for a message: `[1,"x"]`, `[0,Infinity]`, `[NaN,1]`. */
export declare function dimsText(d: unknown): string;
//# sourceMappingURL=Size.d.ts.map