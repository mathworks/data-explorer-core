export declare function escapeXml(str: string): string;
export declare function formatMatlabNum(num: unknown): string;
export declare function parseMatlabNum(text: string): number;
export declare function formatDoubleXml(num: number): string;
export declare function formatNumericXml(num: number, type: string): string;
export declare function formatComplexXml(complexStr: string): string;
export declare function transposeToColumnMajor<T>(rowMajor: T[], rows: number, cols: number): T[];
export declare function transposeToColumnMajorND<T>(rowMajor: T[], dims: number[]): T[];
export declare function transposeFromColumnMajorND<T>(colMajor: T[], dims: number[]): T[];
export declare function pad(indent: number): string;
export declare function matlabTimestampNow(): string;
//# sourceMappingURL=XmlUtils.d.ts.map