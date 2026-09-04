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
 * parseExactNum's binary twin: one 64-bit integer read out of a BINARY container, in the
 * same `number | string` form.
 *
 * A `.mat` file stores an int64/uint64 as eight raw bytes, so there is no decimal text to
 * canonicalize — `DataView.getBigInt64` gives the value exactly and the only question is
 * whether a double can carry it onward. Same rule as parseExactNum, same two outcomes, so
 * the two readers cannot disagree about which values take the text form: everything a
 * double holds stays a number, and only the tokens that were actually being corrupted
 * become text.
 *
 * `Number.isSafeInteger` is the exact test — not `<= Number.MAX_SAFE_INTEGER`, which is
 * true of 2^53 + 1 as a double after it has ALREADY rounded down to 2^53.
 */
export declare function exactInt(big: bigint): number | string;
/**
 * Is this value an exact 64-bit token — a bare decimal integer carried as TEXT because a
 * double cannot hold it (parseExactNum, exactInt)?
 *
 * Every consumer that has to tell one apart from an ordinary string asks here, so the
 * readers, the McosParser value resolver and MatWriter's byte packer cannot disagree about
 * what counts as one.
 */
export declare function isExactToken(x: unknown): x is string;
/**
 * Does this MATLAB class need the exact reader?
 *
 * Only the 64-bit integers: every other class a dictionary carries is either narrower
 * than 2^53 (int8..uint32, logical, char codes) or a float, whose stored spelling IS a
 * double's and for which the text form would suppress the `.0` and `%.17g` handling the
 * float paths do on purpose.
 */
export declare function needsExactInt(type: string | null | undefined): boolean;
/**
 * One EDITED numeric token, narrowed to what its class can actually hold: the exact
 * decimal text for an int64/uint64, the double for everything else.
 *
 * The read paths know a token's class from the file, so they never need this. The edit
 * path does: MatlabValueParser is class-blind and hands back the exact text for any
 * integer a double cannot hold (defect 42), but only the two 64-bit classes can carry
 * one. Under any other class the double IS the value — MATLAB agrees, because a bare
 * decimal literal is a double there, so `x = 18446744073709551615` stores the nearest
 * double exactly as this does — and keeping the text instead wrote a JSON STRING into
 * the dictionary, which reads back as the CHAR '18446744073709551615'.
 *
 * Numbers pass through untouched, so this is safe to map over a whole element list.
 */
export declare function exactForClass(value: unknown, type: string | null | undefined): unknown;
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