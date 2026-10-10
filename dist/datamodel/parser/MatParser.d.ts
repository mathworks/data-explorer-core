import type { ParseWarning } from './ParseWarning.js';
export interface MatVariable {
    name: string;
    className: string;
    dimensions: number[];
    isComplex: boolean;
    isLogical: boolean;
    isSparse?: boolean;
    value: unknown;
    fields: Record<string, MatVariable | MatVariable[]> | null;
    _rawBytes?: Uint8Array | null;
    _modified?: boolean;
    _anonymous?: boolean;
    isOpaque?: boolean;
    mcosHandle?: {
        dims: number[];
        ids: number[];
    } | null;
    undecoded?: string;
}
export interface ParsedMat {
    header: string;
    variables: MatVariable[];
    warnings: ParseWarning[];
}
export declare function parseMatrix(view: DataView, baseOffset: number, length: number): MatVariable;
export declare function parseMat(arrayBuffer: ArrayBuffer): ParsedMat;
/** A MAT stream read: the variable and the elements after it, or why there is none. */
export type MatStream = {
    ok: true;
    variable: MatVariable;
    trailingElements: Uint8Array[];
} | {
    ok: false;
    reason: string;
};
/**
 * Why `bytes` is not a MAT stream this package reads, or null when it is one. Each reason
 * is phrased to follow "not decoded: ", as `undecoded` reasons are.
 *
 * The preamble has to be MATLAB's: `00 01 49 4D`, then a reserved word of zero (as it is in
 * every stream MATLAB was seen writing: 87 text-dictionary cdata, 17 hex values, 5 `.mdl`
 * records and 12 `.slx` parts under test/, and 594 `.slx` parts, 25 cdata and 4 hex values
 * in the corpus), then a miMATRIX element.
 *
 * `whole` asks for every element to be there to its last byte, for a VALUE: the readers
 * clamp a short element to the bytes present and read on, which is right for a container
 * that must open whatever it can and wrong for a value that would then display with part
 * of itself silently missing. A stream that ends early is a damaged value, not a smaller
 * one — and that holds for an object's subsystem as much as for its array: one cut short
 * decoded into a Simulink.Parameter whose sparse Value showed zeros where MATLAB's 5 and 6
 * are, with nothing to say so. Every hex value MATLAB was seen writing is whole elements to
 * its last byte, so the walk asks for exactly that, and may stop early only at a zero tag.
 */
export declare function matStreamFailure(bytes: Uint8Array, whole?: boolean): string | null;
/**
 * The variable a MAT stream holds and the elements that follow it (an MCOS object's
 * subsystem), or why it holds none — never a throw, and never a number read out of
 * something that is not a stream.
 *
 * The array's declared size is clamped to the bytes present, which is how a workspace or
 * a cdata value has always been read; `whole` refuses a stream that is not whole instead
 * (matStreamFailure). Elements after the array are kept as far as the bytes go: past a
 * bad length there is no way to find the next tag.
 *
 * An array of a class the reader does not model comes back as the variable it is
 * (`className: 'unknown'`), not as a failure: what to show for it is the caller's choice.
 */
export declare function decodeMatStream(bytes: Uint8Array, options?: {
    whole?: boolean;
}): MatStream;
//# sourceMappingURL=MatParser.d.ts.map