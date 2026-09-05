import { type ParseWarning } from './ParseWarning.js';
/**
 * Read a `Dimension="d1*d2*...*dn"` attribute into every extent it declares.
 *
 * All of them are kept: MATLAB's own binary dictionary writes a 2x3x2 as
 * `"2*3*2"` with a flat column-major body, so folding the trailing extents into
 * the column count (2x6) reported a shape MATLAB never had, mislabelled every
 * element, and wrote `Matrix(2,6)` back on save. The serial string carries the
 * full rank now — `Matrix(2,3,2)` — so there is nothing left to fold into.
 *
 * A trailing singleton is dropped because MATLAB's `size()` drops it too: a
 * 2x3x1 IS a 2x3.
 *
 * The two off-nominal extent counts still have to be normalized here so every
 * caller folds them the SAME way — they used to each `split('*')` for
 * themselves, and both cases went wrong:
 *
 *   - Fewer than two extents (`Dimension="3"`) left `cols` undefined, so the value
 *     formatted as `Matrix(3,undefined)` with an EMPTY body — every element
 *     dropped on load, and re-saved as the scalar 0. A lone extent N is a row
 *     vector of N.
 *   - An unparseable Dimension has to become SOMETHING; a scalar is the least
 *     destructive guess.
 */
export declare function parseDims(dimension: string): number[];
/**
 * Read a compressed-binary `.sldd` package into dictionary content.
 *
 * `warnings`, when given, is appended to for anything the package CLAIMED to hold and
 * this reader could not read — see the header of this file for why the diagnostics
 * arrive through a parameter instead of the return value. Omitting it is supported and
 * unchanged: nothing is thrown, nothing is logged, and the content is identical.
 *
 * A package with no `data/chunk0.xml` at all still throws, because that is not a
 * dictionary this reader can answer for at all — there is no content to hand back and
 * warn beside. The line between the throw and a warning is whether the part is there:
 * present-and-unreadable is a short read, absent is not a `.sldd`.
 */
export declare function parseBinarySldd(arrayBuffer: ArrayBuffer, warnings?: ParseWarning[]): Record<string, unknown>;
export declare function parseBinarySlddParts(xmlString: string, zipMetadata: Record<string, Uint8Array>, warnings?: ParseWarning[]): Record<string, unknown>;
export declare function transposeColumnMajor<T>(values: T[], dims: number[]): T[];
//# sourceMappingURL=BinarySlddParser.d.ts.map