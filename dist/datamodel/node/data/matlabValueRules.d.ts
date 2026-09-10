import type { MatVariable } from '../../parser/MatParser.js';
export declare function emptyDouble(): MatVariable;
export declare function formatStringElement(el: unknown): string;
export declare const TYPED_NUMERIC_CLASS: RegExp;
export declare function classAfterEdit(current: string, parsedType: string): string;
export declare function elementClass(arrayClass: string): string;
export declare function needsTypedLiteral(type: string, value: unknown): boolean;
export declare function formatMatrix(rows: number, cols: number, elements: unknown[]): string;
export declare function formatCharMatrix(text: string, dims: number[]): string;
export declare function parseMatrixValue(raw: Record<string, unknown>): {
    dims: number[];
    elements: (number | string)[];
    type: string;
} | null;
//# sourceMappingURL=matlabValueRules.d.ts.map