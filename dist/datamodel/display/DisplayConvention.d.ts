export declare const SUMMARY_MAX_CHARS = 1000;
export declare const SUMMARY_MAX_ELEMENTS = 10;
export declare const MAX_EXPANDED_ELEMENTS = 10000;
export declare const EMPTY_NUMERIC = "[ ]";
export declare const EMPTY_CELL = "{ }";
export declare const MISSING_STRING = "<missing>";
export declare function effectiveDims(dims: number[] | undefined | null): number[];
export declare function elementCount(dims: number[] | undefined | null): number;
export declare function needsSummary(dims: number[] | undefined | null): boolean;
export declare function overCharBudget(text: string): boolean;
export declare function summaryForm(dims: number[] | undefined | null, className: string): string;
export declare function sparseSummaryForm(dims: number[] | undefined | null, className: string): string;
//# sourceMappingURL=DisplayConvention.d.ts.map