// Copyright 2026 The MathWorks, Inc.
import { parseExactNum } from './XmlUtils.js';
function parse(str) {
    str = str.trim();
    if (str === '') {
        return null;
    }
    const ch = str.charAt(0);
    if (ch === '[') {
        return parseArray(str);
    }
    if (ch === '{') {
        return parseCell(str);
    }
    if (ch === "'") {
        return parseChar(str);
    }
    if (ch === '"') {
        return parseString(str);
    }
    if (str === 'true') {
        return { type: 'logical', value: true };
    }
    if (str === 'false') {
        return { type: 'logical', value: false };
    }
    const n = parseMatlabNumber(str);
    if (n !== null) {
        return { type: 'double', value: n };
    }
    const complexResult = parseComplex(str);
    if (complexResult) {
        return complexResult;
    }
    return null;
}
// A MATLAB real scalar literal, or null when `str` is not one. `Number()` alone
// is too permissive here: it accepts JavaScript-only spellings that MATLAB does
// not ('Infinity', '0x10', '1_000') while rejecting MATLAB's own 'Inf'/'NaN'.
// Accepting a non-MATLAB literal is the harmful direction — it would be written
// back into a .sldd as a value MATLAB cannot evaluate.
//
// The return is `number | string` because a double cannot hold every int64/uint64,
// and this is the EDIT path: `Number('18446744073709551615')` is 18446744073709552000,
// so typing intmax('uint64') into the cell wrote a different number back to the file
// (defect 42). parseExactNum is the same decision the READ path makes — a number when
// the double is lossless, canonical decimal TEXT when it is not — and it must be the
// same one, because the two ends store into the same slots (_scalarValue/_elements)
// and the writers spell whatever they find there. Only a pure-integer token can take
// the text form; a real or an exponent is a double in MATLAB too, so it stays a number.
function parseMatlabNumber(str) {
    // MATLAB spells the non-finite values Inf/NaN, optionally signed.
    const nonFinite = /^([+-]?)(Inf|NaN)$/.exec(str);
    if (nonFinite) {
        if (nonFinite[2] === 'NaN') {
            return NaN;
        }
        return nonFinite[1] === '-' ? -Infinity : Infinity;
    }
    // Decimal integer/real with optional exponent — no hex, no separators.
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(str)) {
        return null;
    }
    const n = parseExactNum(str);
    return typeof n === 'number' && isNaN(n) ? null : n;
}
/**
 * The same parse with every exact-integer token collapsed back to its double — the
 * reading every consumer got before defect 42.
 *
 * The token exists for the one caller that can hold it: a MATLAB variable whose own class
 * is int64/uint64, which is the only place a class is known at edit time (see
 * XmlUtils.exactForClass). Every other consumer's value is a double by construction, and
 * MATLAB agrees with them: a bare decimal literal is a double there, so
 * `p.Value = 18446744073709551615` stores the nearest double. Such a consumer calls this
 * once, next to its parse, rather than testing for a token at each use — one that slipped
 * through would be written to the dictionary as a JSON STRING and read back as char.
 *
 * `type === 'double'` is the gate, not the value's JavaScript type: a char value can be
 * all digits ('123'), and a string array's elements are strings.
 */
export function collapseExact(parsed) {
    if (parsed.type !== 'double') {
        return parsed;
    }
    const collapse = (v) => (typeof v === 'string' ? Number(v) : v);
    return {
        ...parsed,
        value: Array.isArray(parsed.value) ? parsed.value.map(collapse) : collapse(parsed.value),
    };
}
// ---- Quoted-literal scanning ----
// MATLAB escapes the quote character by DOUBLING it, so 'it''s' is one char value
// of four characters and '''' is the single-quote character itself. Every reader
// below shares this one scanner rather than searching for the next quote: the
// first-quote-wins form ended a value in the middle of it, so a 1x2 cell
// {'it''s', 'ok'} tokenized as the three elements "it", "s'" and "ok" — a cell of
// the wrong SIZE with mangled text, written back to the file with no error shown.
// Read the quoted token that starts at `start` (which must hold the quote
// character). Returns the unescaped text and the index just past the closing
// quote, or null when the token never closes.
function scanQuoted(str, start) {
    const q = str.charAt(start);
    let text = '';
    let i = start + 1;
    while (i < str.length) {
        const ch = str.charAt(i);
        if (ch === q) {
            if (str.charAt(i + 1) === q) {
                text += q;
                i += 2;
                continue;
            }
            return { text, next: i + 1 };
        }
        text += ch;
        i++;
    }
    return null;
}
// The text of `str` when it is EXACTLY one quoted literal, else null. Trailing
// content after the closing quote is a rejection, not something to ignore:
// 'a'b' is a syntax error in MATLAB, and reading it as `a'b` stored a value the
// file could no longer evaluate.
function unquote(str, q) {
    if (str.charAt(0) !== q) {
        return null;
    }
    const scanned = scanQuoted(str, 0);
    return scanned && scanned.next === str.length ? scanned.text : null;
}
// A char/string value spelled as the MATLAB literal that reads back as itself —
// the exact inverse of parse() for those two types, which is why it lives here
// and not with the other display helpers. Concatenating the raw text instead
// produced 'it's', which is not a literal at all: the table showed it, the
// in-place editor was seeded with it, and committing it unchanged split the value.
export function formatMatlabChar(value) {
    return "'" + value.replace(/'/g, "''") + "'";
}
export function formatMatlabString(value) {
    return '"' + value.replace(/"/g, '""') + '"';
}
// For a property whose DISPLAY is the quoted literal but whose stored value is the
// raw text (a Variant condition/specification, a bank Value): strip one layer of
// quotes and undouble the escapes, passing unquoted input through unchanged. The
// table seeds the editor with the displayed text, so without this a commit that
// changed nothing stored the quotes themselves and the next edit nested them
// again — 'a == 1' → ''a == 1'' → … until the saved condition was no longer an
// expression MATLAB could evaluate.
export function unquoteMatlabText(text) {
    const asChar = unquote(text, "'");
    if (asChar !== null) {
        return asChar;
    }
    const asString = unquote(text, '"');
    return asString !== null ? asString : text;
}
function parseChar(str) {
    const value = unquote(str, "'");
    return value === null ? null : { type: 'char', value };
}
function parseString(str) {
    const value = unquote(str, '"');
    return value === null ? null : { type: 'string', value };
}
function parseComplex(str) {
    const m = str.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([+-](?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)i$/);
    if (m) {
        const re = parseFloat(m[1]);
        const im = parseFloat(m[2]);
        const formatted = im >= 0 ? re + '+' + im + 'i' : re + '' + im + 'i';
        return { type: 'complex', value: formatted };
    }
    const mi = str.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)i$/);
    if (mi) {
        const im = parseFloat(mi[1]);
        const formatted = '0' + (im >= 0 ? '+' + im + 'i' : '' + im + 'i');
        return { type: 'complex', value: formatted };
    }
    return null;
}
function parseArray(str) {
    str = str.trim();
    if (str.length < 2 || str.charAt(0) !== '[' || str.charAt(str.length - 1) !== ']') {
        return null;
    }
    const inner = str.slice(1, -1).trim();
    if (inner === '') {
        return { type: 'double', value: [], dims: [0, 0] };
    }
    const rows = splitRows(inner);
    const matrix = [];
    let cols = -1;
    let isStringArray = false;
    // Which QUOTE the text rows used, which is the whole difference between a char
    // matrix and a string array: MATLAB reads ['ab'; 'cd'] as a 2x2 CHAR and
    // ["ab"; "cd"] as a 2x1 string, and it promotes a mixed literal to string. Both
    // spellings used to come back as a string array, so committing a char matrix's own
    // displayed value — the text the table seeds its editor with — silently retyped the
    // entry from char to string and reshaped it 2x2 -> 2x1 (defect 25).
    let anyDoubleQuoted = false;
    // Every numeric row so far held nothing but true/false, which makes the whole array
    // logical. MATLAB promotes a MIXED literal to double — `[true 1]` is a double there —
    // so one ordinary number anywhere in the value is enough to clear this.
    let allLogical = true;
    const charRows = [];
    for (let r = 0; r < rows.length; r++) {
        const rowStr = rows[r].trim();
        if (rowStr === '') {
            continue;
        }
        const scannedNums = tokenizeNumbers(rowStr);
        const nums = scannedNums && scannedNums.nums;
        if (scannedNums === null) {
            const scanned = tokenizeStrings(rowStr);
            if (scanned === null) {
                return null;
            }
            const strings = scanned.texts;
            // A row of strings after rows of numbers: MATLAB has no such array,
            // and accepting it wrote a "string array" whose leading elements were
            // numbers straight back into the file. The numeric branch below
            // already refuses the mirror case (numbers after strings).
            if (!isStringArray && matrix.length > 0) {
                return null;
            }
            isStringArray = true;
            anyDoubleQuoted = anyDoubleQuoted || scanned.anyDouble;
            // A char row is the horizontal CONCATENATION of its pieces — ['ab' 'cd'] is
            // the 1x4 'abcd' — so the char reading keeps the joined text per row beside
            // the per-element matrix the string reading needs. The two readings measure
            // a row differently (elements vs characters), so an inconsistent element
            // count is recorded rather than refused here: ['ab'; 'c' 'd'] is a ragged
            // string array and a perfectly good 2x2 char.
            charRows.push(strings.join(''));
            if (cols < 0) {
                cols = strings.length;
            }
            else if (strings.length !== cols) {
                cols = -2;
            }
            matrix.push(strings);
        }
        else {
            if (isStringArray) {
                return null;
            }
            if (cols < 0) {
                cols = nums.length;
            }
            else if (nums.length !== cols) {
                return null;
            }
            allLogical = allLogical && scannedNums.allLogical;
            matrix.push(nums);
        }
    }
    if (matrix.length === 0) {
        return { type: 'double', value: [], dims: [0, 0] };
    }
    // Single-quoted text is a CHAR array — one value, its rows concatenated
    // vertically — so it is measured in characters and not in elements, and it is
    // built here rather than from `matrix`.
    if (isStringArray && !anyDoubleQuoted) {
        return charFromRows(charRows);
    }
    // Beyond this point a row means a list of elements, so the counts have to agree.
    if (cols < 0) {
        return null;
    }
    const elements = [];
    for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < cols; c++) {
            elements.push(matrix[r][c]);
        }
    }
    if (isStringArray) {
        return { type: 'string-array', value: elements, dims: [matrix.length, cols] };
    }
    // 'logical' with an ARRAY value, not a type of its own: the two are told apart by
    // Array.isArray at every consumer that cares (see _applyParsed and
    // parsedIsScalarNumeric), the same way 'double' already carries both a scalar and an
    // array. A third type name would have to be added to each of those dispatches
    // instead, and a consumer that missed it would silently treat a logical array as
    // unparseable.
    if (allLogical) {
        return { type: 'logical', value: elements, dims: [matrix.length, cols] };
    }
    return { type: 'double', value: elements, dims: [matrix.length, cols] };
}
// The char array `['ab'; 'cd']` spells, from its already-concatenated rows.
//
// Every row must be the same LENGTH — MATLAB's own rule for vertical char
// concatenation, which is why ['ab'; 'c'] is an error there and null here — and the
// value is stored the way every other channel stores a char: one string in MATLAB's
// column-major order, with the real extents beside it. A single row is left without
// dims because a 1xN char states no shape anywhere (charNeedsShape).
function charFromRows(rows) {
    const width = rows[0].length;
    for (let r = 1; r < rows.length; r++) {
        if (rows[r].length !== width) {
            return null;
        }
    }
    if (rows.length === 1 || width === 0) {
        return { type: 'char', value: rows.length === 1 ? rows[0] : '' };
    }
    let text = '';
    for (let c = 0; c < width; c++) {
        for (let r = 0; r < rows.length; r++) {
            text += rows[r].charAt(c);
        }
    }
    return { type: 'char', value: text, dims: [rows.length, width] };
}
// The quoted pieces of one row, plus whether ANY of them used the double quote —
// which is the only thing in the text that says string rather than char.
function tokenizeStrings(rowStr) {
    const elements = [];
    let anyDouble = false;
    let i = 0;
    const len = rowStr.length;
    while (i < len) {
        while (i < len && (rowStr.charAt(i) === ' ' || rowStr.charAt(i) === ',')) {
            i++;
        }
        if (i >= len) {
            break;
        }
        const ch = rowStr.charAt(i);
        if (ch === '"' || ch === "'") {
            const scanned = scanQuoted(rowStr, i);
            if (!scanned) {
                return null;
            }
            if (ch === '"') {
                anyDouble = true;
            }
            elements.push(scanned.text);
            i = scanned.next;
        }
        else {
            return null;
        }
    }
    return elements.length > 0 ? { texts: elements, anyDouble } : null;
}
function parseCell(str) {
    str = str.trim();
    if (str.length < 2 || str.charAt(0) !== '{' || str.charAt(str.length - 1) !== '}') {
        return null;
    }
    const inner = str.slice(1, -1).trim();
    if (inner === '') {
        return { type: 'cell', value: [], dims: [0, 0] };
    }
    const rows = splitRows(inner);
    const matrix = [];
    let cols = -1;
    for (let r = 0; r < rows.length; r++) {
        const rowStr = rows[r].trim();
        if (rowStr === '') {
            continue;
        }
        const elems = tokenizeCellElements(rowStr);
        if (elems === null) {
            return null;
        }
        if (cols < 0) {
            cols = elems.length;
        }
        else if (elems.length !== cols) {
            return null;
        }
        matrix.push(elems);
    }
    if (matrix.length === 0) {
        return { type: 'cell', value: [], dims: [0, 0] };
    }
    const elements = [];
    for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < cols; c++) {
            elements.push(matrix[r][c]);
        }
    }
    return { type: 'cell', value: elements, dims: [matrix.length, cols] };
}
// Split on the row separator, ignoring any ';' that is inside a nested
// bracket/brace or inside a quoted literal — `{'a;b'}` is one element, not two
// rows. An unterminated quote swallows the rest of the text rather than splitting
// it, which leaves the malformed input for the element tokenizer to reject.
function splitRows(inner) {
    const rows = [];
    let depth = 0;
    let start = 0;
    let i = 0;
    while (i < inner.length) {
        const ch = inner.charAt(i);
        if (ch === "'" || ch === '"') {
            const scanned = scanQuoted(inner, i);
            if (!scanned) {
                break;
            }
            i = scanned.next;
            continue;
        }
        if (ch === '[' || ch === '{') {
            depth++;
        }
        else if (ch === ']' || ch === '}') {
            depth--;
        }
        else if (ch === ';' && depth === 0) {
            rows.push(inner.slice(start, i));
            start = i + 1;
        }
        i++;
    }
    rows.push(inner.slice(start));
    return rows;
}
// One row of a numeric or LOGICAL array literal, plus whether every token in it was
// true/false — which is the only thing in the text that says logical rather than double.
//
// `true` and `false` used to be refused here, so `[true false true]` was not a literal
// this parser knew at all. That is MATLAB's OWN spelling of a logical array (mat2str
// prints `[true false true]`, and the corpus's boolVec displays exactly that), so a user
// who committed the text their cell was showing got "Invalid MATLAB expression", and the
// only spelling that WAS accepted — [1 0 1] — retyped the entry from logical to double
// (defect 43). MATLAB agrees with both readings: [true false true] is logical there and
// [1 0 1] is double, so accepting the first is what makes the second correct rather than
// the only option.
//
// An element is `number | string` for the same reason a scalar is — see
// parseMatlabNumber. [18446744073709551615 2 3] keeps its first element as text.
function tokenizeNumbers(rowStr) {
    const parts = rowStr.trim().split(/[,\s]+/);
    const nums = [];
    let allLogical = true;
    for (let i = 0; i < parts.length; i++) {
        if (parts[i] === '') {
            continue;
        }
        // 1/0, never the boolean: _elements is the form the container's display, its _var
        // snapshot and the typed literal all read, and the readers store a logical array
        // that way too (parseTypedVector).
        if (parts[i] === 'true' || parts[i] === 'false') {
            nums.push(parts[i] === 'true' ? 1 : 0);
            continue;
        }
        // Same literal rule as a scalar, so `[1 Inf]` parses and `[1 0x10]` does
        // not. `isNaN` would additionally have rejected a legitimate NaN element.
        const n = parseMatlabNumber(parts[i]);
        if (n === null) {
            return null;
        }
        allLogical = false;
        nums.push(n);
    }
    return nums.length > 0 ? { nums, allLogical } : null;
}
function tokenizeCellElements(rowStr) {
    const elements = [];
    let i = 0;
    const len = rowStr.length;
    while (i < len) {
        while (i < len && (rowStr.charAt(i) === ' ' || rowStr.charAt(i) === ',')) {
            i++;
        }
        if (i >= len) {
            break;
        }
        const ch = rowStr.charAt(i);
        if (ch === "'" || ch === '"') {
            const scanned = scanQuoted(rowStr, i);
            if (!scanned) {
                return null;
            }
            elements.push(scanned.text);
            i = scanned.next;
        }
        else if (ch === '[') {
            const end = findMatchingBracket(rowStr, i, '[', ']');
            if (end < 0) {
                return null;
            }
            const nested = parseArray(rowStr.slice(i, end + 1));
            if (nested === null) {
                return null;
            }
            // Same reason as parseLiteral: a numeric array inside a cell is a double
            // array, so no exact-integer token leaves parseCell. `type === 'double'` is
            // the gate rather than the value's shape, because a string array's elements
            // are strings too and {["12" "ab"]} must keep "12" as text.
            elements.push(collapseExact(nested).value);
            i = end + 1;
        }
        else if (ch === '{') {
            const end = findMatchingBracket(rowStr, i, '{', '}');
            if (end < 0) {
                return null;
            }
            const nested = parseCell(rowStr.slice(i, end + 1));
            if (nested === null) {
                return null;
            }
            elements.push({
                _array_type: 'Cell',
                _dimensions: nested.dims,
                _elements: nested.value,
                _mw_element_type: 'MATLABArray'
            });
            i = end + 1;
        }
        else {
            let end = i;
            while (end < len && rowStr.charAt(end) !== ',' && rowStr.charAt(end) !== ' ' && rowStr.charAt(end) !== ';') {
                end++;
            }
            const token = rowStr.slice(i, end);
            elements.push(parseLiteral(token));
            i = end;
        }
    }
    return elements.length > 0 ? elements : null;
}
function parseLiteral(token) {
    if (token === 'true') {
        return true;
    }
    if (token === 'false') {
        return false;
    }
    const n = parseMatlabNumber(token);
    // A CELL element's class comes from its own literal, and a bare decimal literal is a
    // double in MATLAB — {18446744073709551615} holds a double, not a uint64 — so the
    // exact-integer token collapses here rather than being carried out of the parser.
    // A cell element has no class beside it to consult later, and a bare string in one
    // IS text (see the `return token` below), so a token that escaped would come back
    // as the char '18446744073709551615'.
    if (typeof n === 'string') {
        return Number(n);
    }
    if (n !== null) {
        return n;
    }
    // Not a number — keep the raw token (a bare identifier in a cell stays text).
    return token;
}
// Skip over quoted spans rather than counting brackets inside them: a bracket is
// ordinary text between quotes, so `{['a]'], 1}` closed its inner array at the ']'
// inside the char value and the whole cell then failed to parse (null → "Invalid
// MATLAB expression" on a value MATLAB accepts).
function findMatchingBracket(str, start, open, close) {
    let depth = 0;
    let i = start;
    while (i < str.length) {
        const ch = str.charAt(i);
        if (ch === "'" || ch === '"') {
            const scanned = scanQuoted(str, i);
            if (!scanned) {
                return -1;
            }
            i = scanned.next;
            continue;
        }
        if (ch === open) {
            depth++;
        }
        if (ch === close) {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
        i++;
    }
    return -1;
}
// True when a freshly-parsed value is a SCALAR NUMERIC value — the rule a
// Constant's Value must satisfy. Admits a plain number, a logical (true/false),
// a complex scalar, and a 1-element numeric array (the parser yields a bare
// number for `5`, but `[5]` parses to a 1-length double array — both are 1x1).
// Rejects multi-element arrays/matrices, cells, char, and string. Kept next to
// the parser so both the model (edit-time validation) and the paste/drop gate
// can share one definition. `null` (unparseable) is never scalar-numeric.
function parsedIsScalarNumeric(parsed) {
    if (!parsed) {
        return false;
    }
    // 'logical' shares the double arm because it too carries either a scalar (`true`) or an
    // array (`[true false true]`, defect 43). Testing only the type would have called a
    // three-element logical array scalar-numeric, which is the one thing this predicate
    // exists to refuse.
    if (parsed.type === 'double' || parsed.type === 'logical') {
        if (Array.isArray(parsed.value)) {
            return parsed.value.length === 1;
        }
        return true;
    }
    return parsed.type === 'complex';
}
export { parsedIsScalarNumeric };
export default {
    parse,
    parseArray,
    parseCell,
    parsedIsScalarNumeric,
    formatMatlabChar,
    formatMatlabString,
    unquoteMatlabText,
};
//# sourceMappingURL=MatlabValueParser.js.map