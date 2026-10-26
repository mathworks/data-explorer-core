import type { ParsedValue } from '../../parser/MatlabValueParser.js';
/** What elementRefusal reads of the array an element is edited in. */
export interface ElementArray {
    readonly dims: number[];
    _scalarType: string;
    _sparse?: unknown;
    _isComplexValue(): boolean;
    _complexClass(): string;
}
declare const TAKES: {
    readonly number: "one number";
    readonly logical: "true or false";
    readonly string: "one string, or a char row";
};
/**
 * Why `typed`, read as `parsed` (null where it reads as no value), is no element of `array`, which
 * takes `takes` (a number, true or false, a piece of text): what an element of it takes, and what
 * the text typed is, quoted as it is shown. "Array elements must be scalar numbers" said neither,
 * of `[1 2; 3 4]` typed into one, of text, and of `[1 2` alike, and its logical and string
 * array's alike said nothing of what was typed.
 */
export declare function elementRefusal(typed: string, parsed: ParsedValue | null, array: ElementArray, takes: keyof typeof TAKES): string;
export {};
//# sourceMappingURL=elementRefusal.d.ts.map