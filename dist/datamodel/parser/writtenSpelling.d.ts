import type { ParseWarning } from './ParseWarning.js';
/**
 * Is `token` one number (or one logical) of class `type`, spelled as MATLAB writes it? Without
 * its `F` or `U` suffix, which a text dictionary's typed literal carries. Any token of a class
 * this grammar does not cover (char, a complex body, an object) is.
 */
export declare function isWrittenSpelling(type: string, token: string): boolean;
/** Does a binary dictionary's whitespace-separated body hold a token MATLAB does not write, or none at all? */
export declare function bodyHoldsUnwritten(type: string, body: string): boolean;
/** Does a text dictionary's typed row (the text between its brackets) hold a part MATLAB does not write? */
export declare function rowHoldsUnwritten(type: string, inner: string): boolean;
/** Does a text dictionary's `Matrix(...)` or `Vector(N)` body (past its header) hold a token MATLAB does not write? */
export declare function matrixHoldsUnwritten(type: string, body: string): boolean;
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
/** Record one spelling MATLAB does not write, and the value it is shown as. */
export declare function recordUnwrittenSpelling(type: string, text: string, shown: string | null): void;
/** The spellings recorded since the last call, which clears them, or null if there were none. */
export declare function takeUnwrittenSpellings(): UnwrittenSpellings | null;
/** The one warning for entry `part` whose read recorded `taken`. */
export declare function unwrittenSpellingWarning(part: string, taken: UnwrittenSpellings): ParseWarning;
//# sourceMappingURL=writtenSpelling.d.ts.map