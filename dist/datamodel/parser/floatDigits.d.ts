/**
 * The finite number `x` as MATLAB writes it into a binary dictionary under class `cls`: the
 * double, or the single `x` is, already a float32 (see above). Not for an infinity or a NaN,
 * which have words of their own.
 */
export declare function matlabFloatText(x: number, cls: 'double' | 'single'): string;
//# sourceMappingURL=floatDigits.d.ts.map