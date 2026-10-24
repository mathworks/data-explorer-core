/** The Signedness MATLAB shows of a saved SignednessBool: true, false, or none (a 0x0 logical). */
export declare function signednessShown(saved: unknown): string | null;
/** The three shown of a NumericType's saved bag, or null where it holds them not as numbers. */
export declare function numericTypeShown(bag: Record<string, unknown>): {
    Signed: string;
    FractionLength: number;
    Slope: number;
} | null;
/**
 * The saved three of a NumericType's bag that the shown three it also holds say otherwise, as what they
 * say: numericTypeShown's other way (SignednessBool true, false or a 0x0 logical for 'Signed',
 * 'Unsigned', 'Auto'; FixedExponent = -FractionLength; SlopeAdjustmentFactor = Slope * 2^FractionLength).
 * Only of a bag that holds both, which is a MAT-file's node's (withNumericTypeShown), whose edits write
 * the shown three while its save writes the saved: what a copy of it holds of them, so that the copy is
 * what the save writes. A dictionary's bag holds the saved three alone, or a hand-written shown pair.
 */
export declare function numericTypeSaved(bag: Record<string, unknown>): Record<string, unknown>;
/** `bag`, a NumericType's as MCOS decoded it, with the shown three added where it holds the saved. */
export declare function withNumericTypeShown(bag: Record<string, unknown>): Record<string, unknown>;
/** `bag`, a Parameter's or a Signal's as MCOS decoded it, with its CoderInfo's Identifier added beside the Alias it is saved as. */
export declare function withCoderInfoShown(bag: Record<string, unknown>): Record<string, unknown>;
//# sourceMappingURL=mcosShown.d.ts.map