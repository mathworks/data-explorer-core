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
/**
 * A complex numeric property in the form a compressed-binary dictionary gives the same
 * property: `{ _type: 'cdata', _value: '<elements>' }`, the elements column-major and
 * space-separated, with `_dimensions` (every extent) on anything but a scalar —
 * BinarySlddParser's `<P IsComplex="1">` arm, with MATLAB's `.0` already dropped.
 * Undefined for anything else, including an EMPTY complex value, which keeps the `[]`
 * the numeric arm below has always given it.
 *
 * MatParser carries a complex element as `{ re, im }`, row-major within each page, and
 * nothing below this decoder reads that pair: the matrix arm String()-coerced each one
 * to '[object Object]' inside a Matrix(r,c) body, which then parsed as no numbers at all
 * (`[ ]`), and every other shape went through as the bare pairs, which the node layer
 * printed as `[[object Object]]`. So a Simulink.Parameter whose Value is 3+4i showed
 * that, in a .mat and in a model workspace alike. In this form the value takes the
 * route the binary dictionary's does — MatlabVariableNode.parseCdata — and presents as
 * it does there: `3+4i`, `[1+2i 3+4i 5+6i]` with one element row each, `<2x2x2 double>`.
 * That includes a value with an Inf or NaN part, whose text parseCdata does not read as
 * numbers and shows quoted, as it shows the binary dictionary's copy (test/parity/matlab/
 * DESIGN.md, defect 57).
 *
 * Exported for its unit tests; resolveValue is the one caller.
 */
export declare function complexPropertyValue(cell: MatVariable): Record<string, unknown> | undefined;
export interface OpaqueVarRef {
    name: string;
    className: string;
    rawBytes?: Uint8Array | null;
}
export type McosVariableRef = Pick<MatVariable, 'name' | 'className' | 'mcosHandle' | '_rawBytes'>;
export declare function decodeMcosVariables<V extends McosVariableRef>(anonRawBytes: Uint8Array, variables: readonly V[]): Map<V, McosObjectData>;
export declare function decodeMcosBlob(anonRawBytes: Uint8Array, opaqueVars: OpaqueVarRef[]): Map<string, McosObjectData>;
//# sourceMappingURL=McosParser.d.ts.map