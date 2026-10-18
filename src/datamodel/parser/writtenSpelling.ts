// Copyright 2026 The MathWorks, Inc.
//
// A typed value's text as MATLAB writes it, and a record of each spelling it never writes, for
// the dictionary's warnings (LENIENT).
//
// MATLAB writes a logical as 0 or 1, an integer as an optional '-' and digits, and a double or a
// single as a number: every token of every typed body in the local corpus (58 binary and 167 text
// dictionaries) and in the fixtures is one of those. A hand edit can write anything, and the
// readers take it as they always have, strictly: a binary dictionary's logical `1.0` is false and
// its int16 `1e2` is 100, where MATLAB's own binary reader, which is C-like, reads true and 1
// (measured, R2027a). So the value shown can differ from MATLAB's, and nothing said so.
//
// The readers have no warnings sink of their own, so each spelling outside that grammar is
// recorded here with the value it is shown as, and the reader that builds each entry and holds the
// sink takes the record before and after it: BinarySlddParser.parseBinarySlddParts for a binary
// dictionary, whose text it reads, and SlddNode.parse for a text dictionary, whose typed literals
// the node reads (as integerReading's and EncodedValue's records are taken).
import type { ParseWarning } from './ParseWarning.js';

// The three grammars, a token each. As searches below, each runs in one native pass over a body of
// any length: nearly every body of every dictionary holds no token outside its grammar, and is then
// not split again to find which. A search tries a token where one starts and asks whether a whole
// token of the grammar stands there; none nests a repetition, so none backtracks across tokens.
const TOKEN = {
  logical: '[01]',
  integer: String.raw`-?\d+`,
  number: String.raw`(?:-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|-?Inf|NaN)`,
};
type Grammar = keyof typeof TOKEN;

const INTEGER_CLASS = /^u?int(?:8|16|32|64)$/;

function grammarOf(type: string): Grammar | null {
  if (type === 'logical') {
    return 'logical';
  }
  if (type === 'double' || type === 'single') {
    return 'number';
  }
  return INTEGER_CLASS.test(type) ? 'integer' : null;
}

function searches(form: (token: string) => string): Record<Grammar, RegExp> {
  return {
    logical: new RegExp(form(TOKEN.logical)),
    integer: new RegExp(form(TOKEN.integer)),
    number: new RegExp(form(TOKEN.number)),
  };
}

// One token.
const WHOLE = searches((t) => `^${t}$`);
// A binary dictionary's body: tokens between whitespace.
const IN_BODY = searches((t) => String.raw`(?:^|\s)(?!${t}(?:\s|$))\S`);
// A text dictionary's typed row, `[1, 2]` with its brackets taken off: the parts between commas.
const IN_ROW = searches((t) => String.raw`(?:^|,)(?!\s*${t}[FU]?\s*(?:,|$))`);
// A text dictionary's `Matrix(...)` or `Vector(N)` body: tokens between whitespace, commas,
// semicolons and brackets. A line break inside a token, which the reader joins up, is asked about.
const IN_MATRIX = searches(
  (t) => String.raw`(?:^|[\s,;[\]])(?!${t}[FU]?(?:[\s,;[\]]|$))[^\s,;[\]]|[^\s,;[\]]\n(?=[^\s,;[\]])`,
);

/**
 * Is `token` one number (or one logical) of class `type`, spelled as MATLAB writes it? Without
 * its `F` or `U` suffix, which a text dictionary's typed literal carries. Any token of a class
 * this grammar does not cover (char, a complex body, an object) is.
 */
export function isWrittenSpelling(type: string, token: string): boolean {
  const grammar = grammarOf(type);
  return grammar === null || WHOLE[grammar].test(token);
}

/** Does a binary dictionary's whitespace-separated body hold a token MATLAB does not write, or none at all? */
export function bodyHoldsUnwritten(type: string, body: string): boolean {
  const grammar = grammarOf(type);
  return grammar !== null && (!/\S/.test(body) || IN_BODY[grammar].test(body));
}

/** Does a text dictionary's typed row (the text between its brackets) hold a part MATLAB does not write? */
export function rowHoldsUnwritten(type: string, inner: string): boolean {
  const grammar = grammarOf(type);
  return grammar !== null && IN_ROW[grammar].test(inner);
}

/** Does a text dictionary's `Matrix(...)` or `Vector(N)` body (past its header) hold a token MATLAB does not write? */
export function matrixHoldsUnwritten(type: string, body: string): boolean {
  const grammar = grammarOf(type);
  return grammar !== null && IN_MATRIX[grammar].test(body);
}

/** One spelling MATLAB does not write: its class, its text, and what it is shown as (null: no value is read from it). */
export interface UnwrittenSpelling {
  type: string;
  text: string;
  shown: string | null;
}

/** The spellings recorded since the last take: how many, and the first, all a warning names. */
export interface UnwrittenSpellings {
  count: number;
  first: UnwrittenSpelling;
}

// The first and a count, not a list: one value can hold millions of tokens.
let first: UnwrittenSpelling | null = null;
let count = 0;

/** Record one spelling MATLAB does not write, and the value it is shown as. */
export function recordUnwrittenSpelling(type: string, text: string, shown: string | null): void {
  if (count++ === 0) {
    first = { type, text, shown };
  }
}

/** The spellings recorded since the last call, which clears them, or null if there were none. */
export function takeUnwrittenSpellings(): UnwrittenSpellings | null {
  const taken = first && { count, first };
  first = null;
  count = 0;
  return taken;
}

// A hand edit's text can be anything, a whole line of it included.
const QUOTED_MAX = 40;

function quoted(text: string): string {
  return `'${text.length > QUOTED_MAX ? text.slice(0, QUOTED_MAX) + '...' : text}'`;
}

/** The one warning for entry `part` whose read recorded `taken`. */
export function unwrittenSpellingWarning(part: string, taken: UnwrittenSpellings): ParseWarning {
  const { type, text, shown } = taken.first;
  const spelled = `the ${type} text ${quoted(text)}`;
  const message = taken.count === 1
    ? `"${part}" holds ${spelled}, which MATLAB does not write; `
      + (shown === null ? 'no value is read from it.' : `it is shown as ${shown}.`)
    : `"${part}" holds ${taken.count} values in text MATLAB does not write; the first is ${spelled}, `
      + (shown === null ? 'from which no value is read.' : `shown as ${shown}.`);
  return { code: 'part-unreadable', message, part };
}
