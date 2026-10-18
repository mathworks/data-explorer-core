// The three grammars, a token each. As searches below, each runs in one native pass over a body of
// any length: nearly every body of every dictionary holds no token outside its grammar, and is then
// not split again to find which. A search tries a token where one starts and asks whether a whole
// token of the grammar stands there; none nests a repetition, so none backtracks across tokens.
const TOKEN = {
    logical: '[01]',
    integer: String.raw `-?\d+`,
    number: String.raw `(?:-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|-?Inf|NaN)`,
};
const INTEGER_CLASS = /^u?int(?:8|16|32|64)$/;
function grammarOf(type) {
    if (type === 'logical') {
        return 'logical';
    }
    if (type === 'double' || type === 'single') {
        return 'number';
    }
    return INTEGER_CLASS.test(type) ? 'integer' : null;
}
function searches(form) {
    return {
        logical: new RegExp(form(TOKEN.logical)),
        integer: new RegExp(form(TOKEN.integer)),
        number: new RegExp(form(TOKEN.number)),
    };
}
// One token.
const WHOLE = searches((t) => `^${t}$`);
// A binary dictionary's body: tokens between whitespace.
const IN_BODY = searches((t) => String.raw `(?:^|\s)(?!${t}(?:\s|$))\S`);
// A text dictionary's typed row, `[1, 2]` with its brackets taken off: the parts between commas.
const IN_ROW = searches((t) => String.raw `(?:^|,)(?!\s*${t}[FU]?\s*(?:,|$))`);
// A text dictionary's `Matrix(...)` or `Vector(N)` body: tokens between whitespace, commas,
// semicolons and brackets. A line break inside a token, which the reader joins up, is asked about.
const IN_MATRIX = searches((t) => String.raw `(?:^|[\s,;[\]])(?!${t}[FU]?(?:[\s,;[\]]|$))[^\s,;[\]]|[^\s,;[\]]\n(?=[^\s,;[\]])`);
/**
 * Is `token` one number (or one logical) of class `type`, spelled as MATLAB writes it? Without
 * its `F` or `U` suffix, which a text dictionary's typed literal carries. Any token of a class
 * this grammar does not cover (char, a complex body, an object) is.
 */
export function isWrittenSpelling(type, token) {
    const grammar = grammarOf(type);
    return grammar === null || WHOLE[grammar].test(token);
}
/** Does a binary dictionary's whitespace-separated body hold a token MATLAB does not write, or none at all? */
export function bodyHoldsUnwritten(type, body) {
    const grammar = grammarOf(type);
    return grammar !== null && (!/\S/.test(body) || IN_BODY[grammar].test(body));
}
/** Does a text dictionary's typed row (the text between its brackets) hold a part MATLAB does not write? */
export function rowHoldsUnwritten(type, inner) {
    const grammar = grammarOf(type);
    return grammar !== null && IN_ROW[grammar].test(inner);
}
/** Does a text dictionary's `Matrix(...)` or `Vector(N)` body (past its header) hold a token MATLAB does not write? */
export function matrixHoldsUnwritten(type, body) {
    const grammar = grammarOf(type);
    return grammar !== null && IN_MATRIX[grammar].test(body);
}
// The first and a count, not a list: one value can hold millions of tokens.
let first = null;
let count = 0;
/** Record one spelling MATLAB does not write, and the value it is shown as. */
export function recordUnwrittenSpelling(type, text, shown) {
    if (count++ === 0) {
        first = { type, text, shown };
    }
}
/** The spellings recorded since the last call, which clears them, or null if there were none. */
export function takeUnwrittenSpellings() {
    const taken = first && { count, first };
    first = null;
    count = 0;
    return taken;
}
// A hand edit's text can be anything, a whole line of it included.
const QUOTED_MAX = 40;
function quoted(text) {
    return `'${text.length > QUOTED_MAX ? text.slice(0, QUOTED_MAX) + '...' : text}'`;
}
/** The one warning for entry `part` whose read recorded `taken`. */
export function unwrittenSpellingWarning(part, taken) {
    const { type, text, shown } = taken.first;
    const spelled = `the ${type} text ${quoted(text)}`;
    const message = taken.count === 1
        ? `"${part}" holds ${spelled}, which MATLAB does not write; `
            + (shown === null ? 'no value is read from it.' : `it is shown as ${shown}.`)
        : `"${part}" holds ${taken.count} values in text MATLAB does not write; the first is ${spelled}, `
            + (shown === null ? 'from which no value is read.' : `shown as ${shown}.`);
    return { code: 'part-unreadable', message, part };
}
//# sourceMappingURL=writtenSpelling.js.map