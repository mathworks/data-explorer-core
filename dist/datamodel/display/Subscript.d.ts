export type ElementOrder = 'row-major' | 'column-major';
export type Bracket = '()' | '{}';
export declare function ind2sub(colMajorIndex: number, dims: number[] | undefined | null): number[];
export declare function toColumnMajorIndex(linearIndex: number, dims: number[]): number;
export declare function subscriptLabel(name: string, linearIndex: number, dims: number[] | undefined | null, order: ElementOrder, bracket: Bracket): string;
//# sourceMappingURL=Subscript.d.ts.map