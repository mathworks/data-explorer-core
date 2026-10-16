import type { ParseWarning } from './ParseWarning.js';
import { type SparseData } from './SparseData.js';
export interface MatVariable {
    name: string;
    className: string;
    dimensions: number[];
    isComplex: boolean;
    isLogical: boolean;
    isSparse?: boolean;
    sparse?: SparseData;
    value: unknown;
    fields: Record<string, MatVariable | MatVariable[]> | null;
    _rawBytes?: Uint8Array | null;
    _modified?: boolean;
    _unwritable?: string;
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
export declare function undecodedValue(dimensions: number[], className: string): string;
export declare const MAX_NESTING = 128;
/**
 * Whether `v` is a struct array whose elements nothing reads one by one: one this reader
 * recorded without decoding (`undecoded`), or one with no fields declaring more than
 * MAX_LAID_OUT_FIELDLESS elements, which the node layer shows as its summary alone and the
 * guard in parseMatrix leaves be, such an element taking no bytes. Either is all declared size,
 * so a reader that lays a struct out an element at a time lays out what no byte holds:
 * McosParser's, for an object's property, built one bag per element and StructNode a row per
 * bag, and a Parameter whose Value was repmat(struct(), 1, 1e6) ran a 512 MB heap out.
 * Such a struct keeps the bytes it was read from wherever it is read (a cell element too,
 * below), and is handed over as those.
 */
export declare function isUnheldStructArray(v: MatVariable): boolean;
/**
 * How many elements of struct array `v` this reader holds: as many as the longest of its
 * fields' lists, which hold one entry per element read (parseMatrix's struct arm), and never
 * more than it declares. An element of a struct with fields takes the bytes of its fields'
 * matrices, so a struct array whose bytes ran out holds fewer elements than it declares, and
 * a reader that lays it out an element at a time lays out the ones it holds: MATLAB writes
 * every field of every element, so for an array it wrote that is every element it declares.
 * A struct with no fields holds every element it declares, an element of one taking no bytes,
 * and so does one with a field held as a single variable rather than a list, which this
 * reader writes for a 1x1 alone and a reader of an array takes for every element's.
 */
export declare function structElementsHeld(v: MatVariable): number;
/** The enumeration instance struct of `variable`, an opaque parseOpaque read, or undefined. */
export declare function enumerationInstanceOf(variable: MatVariable): MatVariable | undefined;
/**
 * The text of a function handle as MATLAB stores one, `function` of a struct's `function_handle`
 * field with its `type` beside it, or null: as McosParser reads one an object's property holds,
 * and as a .mat holds one in the struct after a class-16 element's name (measured on the display
 * catalog's catalog.mat: fh_sin's `function` 'sin', type 'simple'; fh_anon's 'sf%272@(x)x.^2+1',
 * type 'anonymous', beside the saving MATLAB's matlabroot).
 *
 * An ANONYMOUS handle's `function` is prefixed with the `sf%<n>@` of the scope it was made in,
 * where func2str, MATLAB's display and a text dictionary all say `@(x)x.^2+1`: the prefix goes,
 * and the `@` that opens the anonymous function's own text stays; nothing else is rewritten.
 */
export declare function functionHandleText(fn: unknown, type: unknown): string | null;
/** The function handle `variable` is, as parseMatrix read it, or undefined. */
export declare function functionHandleOf(variable: MatVariable): {
    text: string | null;
} | undefined;
export declare function parseMatrix(view: DataView, baseOffset: number, length: number, depth?: number): MatVariable;
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