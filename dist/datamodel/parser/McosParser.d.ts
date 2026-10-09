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
 * space-separated, with `_dimensions` (every extent) on anything but a scalar and
 * `_class` on anything but a double (complexClassTag) — BinarySlddParser's
 * `<P IsComplex="1">` arm, with MATLAB's `.0` already dropped. Undefined for anything
 * else, including an EMPTY complex value, which keeps the `[]` the numeric arm below has
 * always given it.
 *
 * MatParser carries a complex element as `{ re, im }`, row-major within each page, and
 * nothing below this decoder reads that pair: the matrix arm String()-coerced each one
 * to '[object Object]' inside a Matrix(r,c) body, which then parsed as no numbers at all
 * (`[ ]`), and every other shape went through as the bare pairs, which the node layer
 * printed as `[[object Object]]`. So a Simulink.Parameter whose Value is 3+4i showed
 * that, in a .mat and in a model workspace alike. In this form the value takes the
 * route the binary dictionary's does — MatlabVariableNode.parseCdata — and shows `3+4i`,
 * `[1+2i 3+4i 5+6i]` with one element row each, `<2x2x2 double>`, `<1x60 int16>`.
 *
 * Each element is formatComplexNum's spelling of the numbers MATLAB's bytes hold, which
 * is the plain .mat variable's spelling of the same value: complex(1/3, 0.1) is
 * `0.3333333333333333+0.1i` here and there. It is not always the binary dictionary's
 * text, which is MATLAB's own and differs in digits and in sign where MATLAB writes more
 * (`0.33333333333333331+0.1i`, `1.0E-20+2.0E+21i`, `1-0i`).
 *
 * An Inf or NaN part is the other place the two differ, and the reason for
 * `_nonFinite`: parseCdata does not read the binary dictionary's non-finite text as
 * numbers (see MatlabVariableNode._isOwnNonFiniteText for why), and the marker is what
 * lets it read this text, so [1+2i NaN 3-4i] shows the three complex doubles the plain
 * .mat variable shows rather than one quoted char.
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