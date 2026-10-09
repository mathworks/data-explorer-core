import type { MatVariable } from './MatParser.js';
export declare const MCOS_HANDLE_MAGIC = 3707764736;
export declare function isObjectHandle(cell: MatVariable): boolean;
export declare function objectHandleFromValue(v: number[]): {
    dims: number[];
    ids: number[];
} | null;
export declare function objectHandleFromRaw(rawBytes: Uint8Array | null | undefined): {
    dims: number[];
    ids: number[];
} | null;
//# sourceMappingURL=McosHandle.d.ts.map