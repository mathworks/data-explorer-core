export declare const SUMMARY_MAX_CHARS = 1000;
export declare const SUMMARY_MAX_ELEMENTS = 10;
export declare const MAX_EXPANDED_ELEMENTS = 10000;
export declare const MAT_NODE_CEILING = 500000;
export declare const EMPTY_NUMERIC = "[ ]";
export declare const EMPTY_CELL = "{}";
export declare const MISSING_STRING = "<missing>";
export declare function effectiveDims(dims: number[] | undefined | null): number[];
export declare function elementCount(dims: number[] | undefined | null): number;
export declare function needsSummary(dims: number[] | undefined | null): boolean;
export declare function overCharBudget(text: string): boolean;
export declare const EDIT_TEXT_MAX_CHARS = 200000;
/**
 * What `spell` returns with the element and char budgets off (needsSummary, overCharBudget): the
 * text of a value written out whole, past the size its row shows a summary at, which an editor of
 * it is seeded with (the D13 ruling). Rank >= 3 still has no literal, and a struct, an object and a
 * sparse array are still their summaries: those are not about size.
 */
export declare function spelledWhole<T>(spell: () => T): T;
export declare function summaryForm(dims: number[] | undefined | null, className: string): string;
export declare function classColumnText(className: string, attributes?: {
    complex?: boolean;
    sparse?: boolean;
}): string;
export declare function sparseSummaryForm(dims: number[] | undefined | null, className: string): string;
//# sourceMappingURL=DisplayConvention.d.ts.map