import { MatVariable } from './MatParser.js';
export interface McosObjectData {
    name: string;
    className: string;
    packageName: string;
    shortClassName: string;
    properties: Record<string, unknown>;
    elements: Record<string, unknown>[];
    dimensions: number[];
    value: unknown;
    stringElements?: (string | null)[] | null;
}
export declare const NOT_AVAILABLE = "<not available>";
export declare const STRING_CLASS_NAME = "string";
export interface OpaqueVarRef {
    name: string;
    className: string;
    rawBytes?: Uint8Array | null;
}
export type McosVariableRef = Pick<MatVariable, 'name' | 'className' | 'mcosHandle' | '_rawBytes'>;
export declare function decodeMcosVariables<V extends McosVariableRef>(anonRawBytes: Uint8Array, variables: readonly V[]): Map<V, McosObjectData>;
export declare function decodeMcosBlob(anonRawBytes: Uint8Array, opaqueVars: OpaqueVarRef[]): Map<string, McosObjectData>;
//# sourceMappingURL=McosParser.d.ts.map