export declare function escapeXml(str: string): string;
/**
 * The property-bag key MATLAB's saveobj envelope is filed under.
 *
 * A class that serializes through `saveobj` writes its whole state as one UNNAMED
 * `<P Source="saveobj" PropertyType="any" Class="struct">`, so a property bag — which
 * needs a key — has to invent one. It must start with '_': MATLAB identifiers cannot,
 * so the key can never collide with a real property name, and the display and edit paths
 * can filter it out on that rule alone.
 *
 * Read by BinarySlddParser.parseStructElement and written by DataNode.pxAttrs, which
 * turns it back into the Source/PropertyType attributes. Keyed 'undefined' (the old
 * behaviour of an absent @_Name) MATLAB's loadobj finds no envelope at all and rebuilds
 * an EMPTY object — defect 28.
 */
export declare const SAVEOBJ_KEY = "_saveobj";
export declare function formatMatlabNum(num: unknown): string;
export declare function parseMatlabNum(text: string): number;
export declare function parseNumericBody(text: string): number[];
/**
 * One numeric token, EXACT: a number where a double is lossless, the canonical decimal
 * TEXT where it is not.
 *
 * The test is the round trip, not the class. Every value a double does hold stays a
 * number, so no existing path changes behaviour and only the tokens that were actually
 * being corrupted take the new representation. `+7` and `007` canonicalize to `7`, so a
 * cosmetic difference in the stored spelling never on its own forces the text form.
 */
export declare function parseExactNum(text: string): number | string;
/** parseNumericBody's exact twin: a whitespace-separated body, token by token. */
export declare function parseExactBody(text: string): (number | string)[];
/**
 * Does this MATLAB class need the exact reader?
 *
 * Only the 64-bit integers: every other class a dictionary carries is either narrower
 * than 2^53 (int8..uint32, logical, char codes) or a float, whose stored spelling IS a
 * double's and for which the text form would suppress the `.0` and `%.17g` handling the
 * float paths do on purpose.
 */
export declare function needsExactInt(type: string | null | undefined): boolean;
export declare function formatDoubleXml(num: unknown): string;
export declare function formatNumericXml(num: unknown, type: string): string;
export declare function formatNumLiteral(num: unknown, type: string): string;
export declare function formatMatrixSerial(values: unknown[], dims: number[], type: string): string;
/**
 * Does this char shape have to be STATED, or does the bare form already say it?
 *
 * A bare string read back is a 1xN char, so a rank-2 row needs neither the mxchar
 * envelope nor a Dimension — and MATLAB writes neither. Every other shape needs both,
 * including a 1x1xN, whose first extent is also 1: testing dims[0] alone would drop
 * the pages. The rule is the char twin of the row-vector rule in formatMatrixSerial.
 */
export declare function charNeedsShape(dims: number[]): boolean;
/**
 * The char codes of a stored (column-major) string, in the row-major order the
 * `Matrix()` literal lays out — the same order parseMatrixValue and
 * DataNode._parseMatrixNums read back.
 *
 * charCodeAt per index rather than Array.from: MATLAB's char is a 16-bit code unit,
 * so a surrogate pair is TWO characters of a MATLAB char array, and iterating by code
 * point would silently halve its length.
 */
export declare function charCodesRowMajor(text: string, dims: number[]): number[];
/** The inverse: row-major codes from an mxchar literal back to the stored string. */
export declare function charTextFromCodes(rowMajorCodes: number[], dims: number[]): string;
/**
 * MATLAB's `mxchar` literal for a char array of rank >= 2 that is not a row.
 *
 * The body is formatMatrixSerial's, so the bracketed-group spelling — the only one
 * MATLAB reads back (defect 19) — is stated in exactly one place. The header is forced
 * because a row must never reach here: bare, this literal WOULD read back as a row,
 * which is the whole reason charNeedsShape exists.
 */
export declare function formatMxCharSerial(text: string, dims: number[]): string;
export declare function formatComplexXml(complexStr: string): string;
export declare function transposeToColumnMajor<T>(rowMajor: T[], rows: number, cols: number): T[];
export declare function transposeToColumnMajorND<T>(rowMajor: T[], dims: number[]): T[];
export declare function transposeFromColumnMajorND<T>(colMajor: T[], dims: number[]): T[];
export declare function pad(indent: number): string;
export declare function matlabTimestampNow(): string;
//# sourceMappingURL=XmlUtils.d.ts.map