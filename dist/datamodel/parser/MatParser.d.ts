export interface MatVariable {
    name: string;
    className: string;
    dimensions: number[];
    isComplex: boolean;
    isLogical: boolean;
    value: unknown;
    fields: Record<string, unknown> | null;
    _rawBytes?: Uint8Array;
    _modified?: boolean;
    _anonymous?: boolean;
    isOpaque?: boolean;
}
export interface ParsedMat {
    header: string;
    variables: MatVariable[];
}
export declare function parseMatrix(view: DataView, baseOffset: number, length: number): MatVariable;
export declare function parseMat(arrayBuffer: ArrayBuffer): ParsedMat;
//# sourceMappingURL=MatParser.d.ts.map