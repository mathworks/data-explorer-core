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
    enumeration?: Record<string, unknown>;
}
/**
 * What the decoder could not read of one variable it was asked for, for the caller's
 * warnings (decodeMcosVariables' `issues`). ParseWarning.ts's rule, at this layer: the bytes
 * say an object is there, and it was not read, or not all of it.
 *
 * `refused`: the confidence gate turned the whole variable down, so it is absent from the
 * result — its handle names an object the table does not hold, or objects of another class.
 * Otherwise it is in the result, decoded in part: an object it reaches addresses a property
 * block that readBlocks stopped before.
 *
 * `reason` is one clause, for a message: it names what was wrong and, for a partial decode,
 * what is shown instead.
 */
export interface McosDecodeIssue {
    refused: boolean;
    reason: string;
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
 * An Inf or NaN part is the other place the two differ (MATLAB writes complex(1, NaN)
 * `1.0NaNi`), and the envelope records one with `_nonFinite`. parseCdata read only text so
 * marked as numbers, and showed a binary dictionary's own non-finite text quoted; it reads
 * both now (MatlabVariableNode._isComplexText), so [1+2i NaN 3-4i] shows the three complex
 * doubles the plain .mat variable shows, from either. The marker stays on the envelope as
 * it was, which a copy of the value carries.
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
export declare function decodeMcosVariables<V extends McosVariableRef>(anonRawBytes: Uint8Array, variables: readonly V[], issues?: Map<V, McosDecodeIssue>): Map<V, McosObjectData>;
export declare function decodeMcosBlob(anonRawBytes: Uint8Array, opaqueVars: OpaqueVarRef[]): Map<string, McosObjectData>;
//# sourceMappingURL=McosParser.d.ts.map