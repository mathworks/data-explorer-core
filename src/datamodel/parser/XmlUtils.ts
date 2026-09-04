// Copyright 2026 The MathWorks, Inc.

'use strict';

export function escapeXml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
export const SAVEOBJ_KEY = '_saveobj';

// A number as MATLAB spells it. Only the non-finite values differ from
// String(num), but they differ in a way that matters: MATLAB cannot read the
// JavaScript spelling 'Infinity' back, and our own MatlabValueParser rejects it
// too — so a value displayed as 'Infinity' is also an uneditable one.
export function formatMatlabNum(num: unknown): string {
    if (typeof num === 'number' && !isFinite(num)) {
        return isNaN(num) ? 'NaN' : num > 0 ? 'Inf' : '-Inf';
    }
    return String(num);
}

// The inverse: a number as it appears in a .sldd, falling back to 0 for text
// that is not a number at all. parseFloat reads MATLAB's Inf/-Inf/NaN as NaN,
// and the `|| 0` idiom then silently turns each of them into zero — so the
// non-finite spellings have to be recognised before parseFloat sees them.
export function parseMatlabNum(text: string): number {
    const t = text.trim();
    if (t === 'Inf' || t === '+Inf') { return Infinity; }
    if (t === '-Inf') { return -Infinity; }
    if (t === 'NaN') { return NaN; }
    const n = parseFloat(t);
    return isNaN(n) ? 0 : n;
}

// A whitespace-separated numeric body, as a .sldd/.slx <P> carries it.
// BinarySlddParser split and converted this for itself in THREE places and reached
// for plain `Number` in two of them — and Number('Inf') is NaN, because JavaScript
// spells infinity 'Infinity'. So MATLAB's own bytes for a vector holding
// non-finites, `Dimension="1*5">1.0 Inf -Inf NaN 5.0`, read back as
// [1 NaN NaN NaN 5]: both infinities destroyed on load and indistinguishable
// afterwards from a real NaN. One helper, so the three sites cannot disagree again.
export function parseNumericBody(text: string): number[] {
    return text.trim().split(/\s+/).map((part) => parseMatlabNum(part));
}

// ---- exact 64-bit integers (defects 29 and 30) ----
//
// A double holds every integer up to 2^53 and nothing past it. MATLAB's int64/uint64
// range is 2^64 wide, so its own values are outside a double's exact range BY
// CONSTRUCTION — cases.sldd carries maxU64 = 18446744073709551615 and i64Unsafe =
// 9007199254740993 — and every channel that read them through parseFloat wrote a
// different number back:
//
//   maxU64   18446744073709551615  ->  18446744073709552000U
//   i64Vec   [9223372036854775807, -9223372036854775808, -1]
//            -> [9223372036854776000, -9223372036854776000, -1]
//
// Worse than a rounding nit, the value comes back OUT of range (18446744073709552000 >
// intmax('uint64')), and MATLAB's reader does not merely clamp that token — it abandons
// the REST of the body. u64Vec's [18446744073709551615, 1, 0] reopened as
// [18446744073709551615, 0, 0], so a neighbour that was perfectly representable was
// destroyed by its neighbour's overflow (measured by probe_writeback_bin).
//
// The fix is to stop converting: a token a double cannot hold is carried as its own
// decimal TEXT, from the reader all the way to the writer. Every formatter below goes
// through formatMatlabNum, which is String(), so the text passes through untouched.

/**
 * One numeric token, EXACT: a number where a double is lossless, the canonical decimal
 * TEXT where it is not.
 *
 * The test is the round trip, not the class. Every value a double does hold stays a
 * number, so no existing path changes behaviour and only the tokens that were actually
 * being corrupted take the new representation. `+7` and `007` canonicalize to `7`, so a
 * cosmetic difference in the stored spelling never on its own forces the text form.
 */
export function parseExactNum(text: string): number | string {
    const t = text.trim();
    const num = parseMatlabNum(t);
    if (!/^[+-]?\d+$/.test(t)) {
        return num;
    }
    const canon = t.replace(/^\+/, '').replace(/^(-?)0+(?=\d)/, '$1');
    return String(num) === canon ? num : canon;
}

/** parseNumericBody's exact twin: a whitespace-separated body, token by token. */
export function parseExactBody(text: string): (number | string)[] {
    return text.trim().split(/\s+/).map(parseExactNum);
}

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
export function exactInt(big: bigint): number | string {
    const num = Number(big);
    return Number.isSafeInteger(num) ? num : big.toString();
}

/**
 * Is this value an exact 64-bit token — a bare decimal integer carried as TEXT because a
 * double cannot hold it (parseExactNum, exactInt)?
 *
 * Every consumer that has to tell one apart from an ordinary string asks here, so the
 * readers, the McosParser value resolver and MatWriter's byte packer cannot disagree about
 * what counts as one.
 */
export function isExactToken(x: unknown): x is string {
    return typeof x === 'string' && /^-?\d+$/.test(x);
}

/**
 * Does this MATLAB class need the exact reader?
 *
 * Only the 64-bit integers: every other class a dictionary carries is either narrower
 * than 2^53 (int8..uint32, logical, char codes) or a float, whose stored spelling IS a
 * double's and for which the text form would suppress the `.0` and `%.17g` handling the
 * float paths do on purpose.
 */
export function needsExactInt(type: string | null | undefined): boolean {
    return type === 'int64' || type === 'uint64';
}

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
export function exactForClass(value: unknown, type: string | null | undefined): unknown {
    if (!isExactToken(value)) {
        return value;
    }
    return needsExactInt(type) ? value : Number(value);
}

export function formatDoubleXml(num: unknown): string {
    // An exact 64-bit token reaches here only through formatNumLiteral's `double` arm,
    // which a 64-bit class never takes; the guard is here so the exact form can never
    // silently become NaN if a future caller routes one through.
    if (typeof num === 'string') {
        return num;
    }
    if (typeof num !== 'number') {
        return formatMatlabNum(num);
    }
    if (!isFinite(num)) {
        return formatMatlabNum(num);
    }
    const s = String(num);
    if (!s.includes('.') && !s.includes('e') && !s.includes('E')) {
        return s + '.0';
    }
    return s;
}

export function formatNumericXml(num: unknown, type: string): string {
    // Already MATLAB's own decimal text (see parseExactNum). Math.round below would put
    // it back through a double and undo the whole point of carrying it as text.
    if (typeof num === 'string' && /^-?\d+$/.test(num)) {
        return num;
    }
    if (type === 'double' || type === 'single') {
        return formatDoubleXml(num);
    }
    return formatMatlabNum(Math.round(Number(num)));
}

// One number inside a typed `_value` literal, as MATLAB spells it there. The
// suffixes are MATLAB's own, read off its uncompressed-text dictionary: it writes a
// uint64 vector as '[18446744073709551615U, 1U, 0U]', a single as '3.14159274F', an
// int16 vector bare as '[1, 2, 3]', and a double with a forced '.0'. Dropping the
// suffix is not cosmetic — MATLAB reads a suffixless body back as double.
// `num` is `unknown` rather than `number` because an int64/uint64 element may be an
// exact decimal STRING (see parseExactNum). formatMatlabNum is String(), so the three
// integer arms below carry it through untouched; only the float arms convert, and no
// 64-bit token ever reaches them.
export function formatNumLiteral(num: unknown, type: string): string {
    if (type === 'single') {
        return formatMatlabNum(num) + 'F';
    }
    if (type === 'uint8' || type === 'uint16' || type === 'uint32' || type === 'uint64') {
        return formatMatlabNum(num) + 'U';
    }
    if (type === 'double') {
        return formatDoubleXml(num);
    }
    return formatMatlabNum(num);
}

// The `Matrix(d1,...,dn)` serial string, in the ONE spelling MATLAB can read back.
//
// This had two writers with two different bodies — the .sldd reader's own output
// here, and MatlabVariableNode._buildMatrixString on the write-back path — and
// Phase 6 widened both to rank 3 independently without noticing they disagreed at
// rank 2. Only this one is a spelling MATLAB accepts. Asked directly, by patching a
// single value string in a copy of MATLAB's own text cases.sldd and opening it with
// Simulink.data.dictionary.open (test/parity/matlab/probe_matrix_serial.m):
//
//   Matrix(2,3)\n[[1.0, 2.0, 3.0]; [4.0, 5.0, 6.0]]   -> double [2 3], values right
//   Matrix(2,3)\n[[1, 2, 3]; [4, 5, 6]]               -> double [2 3]  ('.0' optional)
//   Matrix(2,3)\n[1, 2, 3]\n[4, 5, 6]                 -> double [1 0]  ** EMPTY **
//   Matrix(3,1)\n[1.0, 2.0, 3.0]                      -> double [3 1]
//   Matrix(1,3)\n[1, 0, 1]   as logical               -> logical [1 3]
//   Matrix(2,3)\n[[1, 2, 3]; [4, 5, 6]] as int16      -> int16 [2 3]
//
// So the newline-joined form MATLAB rejects silently: every multi-row matrix edited
// in an uncompressed-text dictionary came back as a 1x0 empty. Bracketed groups
// joined with '; ' is the accepted form at every rank and class.
export function formatMatrixSerial(values: unknown[], dims: number[], type: string): string {
    const rows = dims[0];
    const cols = dims[1];
    const header = 'Matrix(' + dims.join(',') + ')';
    // A vector is one flat bracketed list — MATLAB's own spelling for a 3x1 in its
    // text dictionary is 'Matrix(3,1)\n[1.0, 2.0, 3.0]', and it read the 1xN twin
    // 'Matrix(1,3)\n[1.0, 2.0, 3.0]' back as [1 3] in the probe. It also accepts the
    // grouped 'Matrix(1,3)\n[[1.0, 2.0, 3.0]]', but flat is the form MATLAB writes
    // itself, so a vector takes it at either orientation. Only at rank <= 2: an
    // Rx1xP still has pages to lay out.
    if ((cols === 1 || rows === 1) && dims.length <= 2) {
        const flat = '[' + values.map((v) => formatNumLiteral(v, type)).join(', ') + ']';
        // A rank-2 ROW vector carries NO header: MATLAB spells a 1xN typed array as the
        // bare `[1, 2, 3]` and keeps `Matrix(3,1)` for the column, which is the one
        // orientation the shape has to be stated for — a bare list read back is a row.
        // Its own typed_text.sldd says so six times over (i32Vec, sglVec, lglVec,
        // u64Vec2, sTyped's `a` and `d` fields, cTyped's first element), and cases.sldd's
        // nonFinVec agrees for a double.
        //
        // This was defect 21, recorded as cosmetic when 19 was fixed and left alone for
        // "one spelling for every typed array". That reading was wrong about our own
        // code: BinarySlddParser has ALWAYS written a row vector bare on the READ path
        // (formatTypedVector, guarded by the same `dims.length <= 2 && dims[0] === 1`),
        // so the codebase had two spellings already and the write path was the one that
        // disagreed with both MATLAB and its neighbour. Keeping the header cost a diff
        // on every save of the commonest typed shape there is. MATLAB reads either form
        // (probe_writeback's literal/i16Vec), so this is churn rather than loss — but
        // churn in a file people keep under source control.
        return rows === 1 ? flat : header + '\n' + flat;
    }
    // One bracketed group per row, pages in order — a rank-3 body is just its pages'
    // rows concatenated, which is what parseMatrixValue and DataNode._parseMatrixNums
    // consume. MATLAB has no inline spelling of its own past rank 2 (it writes a
    // cdata MAT stream), so the page layout is ours; the group form is MATLAB's.
    const rowStrs: string[] = [];
    const pages = Math.max(1, Math.floor(values.length / Math.max(1, rows * cols)));
    for (let p = 0; p < pages; p++) {
        const base = p * rows * cols;
        for (let r = 0; r < rows; r++) {
            const row: string[] = [];
            for (let c = 0; c < cols; c++) {
                row.push(formatNumLiteral(values[base + r * cols + c], type));
            }
            rowStrs.push('[' + row.join(', ') + ']');
        }
    }
    return header + '\n[' + rowStrs.join('; ') + ']';
}

// ---- char shape (defect 25) ----
//
// A char array is stored as ONE string, in MATLAB's own column-major order — that is
// what a .mat char payload carries (MatParser deliberately does not transpose it) and
// what the XML body of a `Class="char"` property carries. The three helpers below are
// the whole of what the four channels need to agree on, and they live here so no
// channel can invent its own answer:
//
//   text .sldd    a 1xN row is a bare JSON string; anything else is
//                 {"_type":"mxchar","_value":"Matrix(2,2)\n[[97, 98]; [99, 100]]"} —
//                 char CODES, one bracketed group per ROW.
//   binary/.slx   <P Class="char" Dimension="2*2">acbd</P>, column-major text; a row
//                 and an empty char carry no Dimension at all.
//
// Both spellings are MATLAB's own, read off char_text.sldd and char_binary.sldd
// (test/parity/matlab/probe_char_shape.m wrote them).

/**
 * Does this char shape have to be STATED, or does the bare form already say it?
 *
 * A bare string read back is a 1xN char, so a rank-2 row needs neither the mxchar
 * envelope nor a Dimension — and MATLAB writes neither. Every other shape needs both,
 * including a 1x1xN, whose first extent is also 1: testing dims[0] alone would drop
 * the pages. The rule is the char twin of the row-vector rule in formatMatrixSerial.
 */
export function charNeedsShape(dims: number[]): boolean {
    return !(dims.length <= 2 && dims[0] === 1);
}

/**
 * The char codes of a stored (column-major) string, in the row-major order the
 * `Matrix()` literal lays out — the same order parseMatrixValue and
 * DataNode._parseMatrixNums read back.
 *
 * charCodeAt per index rather than Array.from: MATLAB's char is a 16-bit code unit,
 * so a surrogate pair is TWO characters of a MATLAB char array, and iterating by code
 * point would silently halve its length.
 */
export function charCodesRowMajor(text: string, dims: number[]): number[] {
    const codes: number[] = [];
    for (let i = 0; i < text.length; i++) {
        codes.push(text.charCodeAt(i));
    }
    return transposeFromColumnMajorND(codes, dims);
}

/** The inverse: row-major codes from an mxchar literal back to the stored string. */
export function charTextFromCodes(rowMajorCodes: number[], dims: number[]): string {
    return transposeToColumnMajorND(rowMajorCodes, dims)
        .map((c) => String.fromCharCode(c))
        .join('');
}

/**
 * MATLAB's `mxchar` literal for a char array of rank >= 2 that is not a row.
 *
 * The body is formatMatrixSerial's, so the bracketed-group spelling — the only one
 * MATLAB reads back (defect 19) — is stated in exactly one place. The header is forced
 * because a row must never reach here: bare, this literal WOULD read back as a row,
 * which is the whole reason charNeedsShape exists.
 */
export function formatMxCharSerial(text: string, dims: number[]): string {
    const body = formatMatrixSerial(charCodesRowMajor(text, dims), dims, 'mxchar');
    return body.indexOf('Matrix(') === 0 ? body : 'Matrix(' + dims.join(',') + ')\n' + body;
}

// Every numeric part of a complex literal has to read as a double, so an integral
// part gains a '.0'. Match the WHOLE number rather than a trailing run of digits:
// the run-of-digits form appended '.0' to the EXPONENT, so '1e-7+2e-8i' was written
// as '1e-7.0+2e-8.0i', which is not a MATLAB literal at all. Exponents are not a
// corner case here — Number stringifies anything below 1e-6 that way, so typing an
// ordinary small value like '0.0000001+0.00000002i' into the inspector is stored as
// '1e-7+2e-8i' and reached this routine. The leading-dot alternative comes first so
// '.5' is seen as one number instead of a bare '5' that would yield '.5.0'.
export function formatComplexXml(complexStr: string): string {
    return complexStr.replace(
        /\.\d+(?:[eE][+-]?\d+)?|\d+\.?\d*(?:[eE][+-]?\d+)?/g,
        (num) => (/[.eE]/.test(num) ? num : num + '.0'),
    );
}

export function transposeToColumnMajor<T>(rowMajor: T[], rows: number, cols: number): T[] {
    if (rows <= 1) { return rowMajor; }
    const result = new Array<T>(rowMajor.length);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            result[c * rows + r] = rowMajor[r * cols + c];
        }
    }
    return result;
}

// The N-D form: an array of rank >= 3 is a stack of rows x cols pages, each stored
// column-major in turn, so every page is transposed and the page order is untouched.
// The exact inverse of BinarySlddParser.transposeColumnMajor. The rank-2-only
// version above, handed a 2x3x2, filled only the first six slots of a
// twelve-element result and left the rest as holes — half a .slx-bound N-D array
// written out as empty text.
export function transposeToColumnMajorND<T>(rowMajor: T[], dims: number[]): T[] {
    const rows = dims[0];
    const cols = dims[1];
    if (rows <= 1 || cols <= 1) { return rowMajor; }
    const page = rows * cols;
    const result = rowMajor.slice();
    for (let base = 0; base + page <= rowMajor.length; base += page) {
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                result[base + c * rows + r] = rowMajor[base + r * cols + c];
            }
        }
    }
    return result;
}

// The other direction: MATLAB's column-major storage order to the row-major-within-
// page order the display layer and the subscript helper both read. Generic over T
// because the complex path carries its elements as strings ('1+1i'), and the copy of
// this loop it used to carry was rank-2-only: handed a 2x3x2 it read six of the
// twelve values MATLAB wrote and the second page was gone on the next save.
export function transposeFromColumnMajorND<T>(colMajor: T[], dims: number[]): T[] {
    const rows = dims[0];
    const cols = dims[1];
    if (rows <= 1 || cols <= 1) { return colMajor; }
    const page = rows * cols;
    const result = colMajor.slice();
    for (let base = 0; base + page <= colMajor.length; base += page) {
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                result[base + r * cols + c] = colMajor[base + c * rows + r];
            }
        }
    }
    return result;
}

export function pad(indent: number): string {
    return '    '.repeat(indent);
}

// The current time as a raw MATLAB timestamp ('YYYYMMDDThhmmss.000000') — the one
// shape both .sldd serializers write and both parsers read. Sub-second precision is
// dropped rather than converted: MATLAB writes 6 fractional digits, we have 3, and a
// timestamp that claims microseconds it does not have is worse than a rounded one.
export function matlabTimestampNow(): string {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '.000000');
}
