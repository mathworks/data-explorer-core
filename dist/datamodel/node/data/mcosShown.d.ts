/** The Signedness MATLAB shows of a saved SignednessBool: true, false, or none (a 0x0 logical). */
export declare function signednessShown(saved: unknown): string | null;
/** The three shown of a NumericType's saved bag, or null where it holds them not as numbers. */
export declare function numericTypeShown(bag: Record<string, unknown>): {
    Signed: string;
    FractionLength: number;
    Slope: number;
} | null;
/** `bag`, a NumericType's as MCOS decoded it, with the shown three added where it holds the saved. */
export declare function withNumericTypeShown(bag: Record<string, unknown>): Record<string, unknown>;
/** `bag`, a Parameter's or a Signal's as MCOS decoded it, with its CoderInfo's Identifier added beside the Alias it is saved as. */
export declare function withCoderInfoShown(bag: Record<string, unknown>): Record<string, unknown>;
//# sourceMappingURL=mcosShown.d.ts.map