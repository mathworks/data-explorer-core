export interface ParsedValue {
    type: string;
    value: unknown;
    dims?: number[];
    cls?: string;
}
/**
 * A Value as a user types it, read as parse reads it, but for a bare word in a cell, `{missing}`,
 * `{strings(0,3)}`, `{a, b}`: no value this package evaluates, which parse keeps as a char
 * (`{'missing'}`, `{'strings(0', '3)'}`) and a typed value refuses, saying which word and how a
 * char or a string is typed. Null for text that is no value. The setters of a variable's Value
 * read it so (MatlabVariableNode.setProperty, MatNode's retype); what a file holds, and every
 * other caller of parse, is read as before.
 */
export declare function parseTyped(text: string): {
    parsed: ParsedValue;
} | {
    why: string;
} | null;
declare function parse(str: string): ParsedValue | null;
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
export declare function collapseExact(parsed: ParsedValue): ParsedValue;
/**
 * One ROW of a char literal, without the brackets a row holding a control character needs
 * around it: `'ab'`, or `'a' newline 'b'`. A char matrix's rows are these, joined inside its
 * one pair of brackets (matlabValueRules.formatCharMatrix): ['a' newline 'b'; 'cde'].
 */
export declare function formatMatlabCharRow(value: string): string;
export declare function formatMatlabChar(value: string): string;
export declare function formatMatlabString(value: string): string;
export declare function controlsAsOneChar(value: string): string;
export declare function unquoteMatlabText(text: string): string;
declare function parseArray(str: string): ParsedValue | null;
declare function parseCell(str: string): ParsedValue | null;
/**
 * An empty value, spelled as MATLAB makes it of a call no bracket can stand for (the D12 ruling):
 * `cell(1,0)`, `zeros(0,3)`, `zeros(1,0,'int8')`, `false(1,0)` (or `true(1,0)`, the same empty),
 * `strings(0,3)`, `char(zeros(1,0))`,
 * of any rank (`zeros(1,0,2)`), as MatlabVariableNode._emptySpelled shows one. One count is a square,
 * as in MATLAB (`zeros(0)` is 0x0). Null for any other text, a call that makes no empty (`zeros(2,2)`,
 * whose elements this package does not make) among it.
 */
export declare function emptyConstructor(text: string): ParsedValue | null;
export declare function classCall(span: string): unknown | null;
/**
 * A complex value typed in (a parsed 'complex'), as the bag a binary dictionary's reader gives
 * one, which a node is built of as one read from a file is (MatlabVariableNode._parseCdataText),
 * and each writer spells as MATLAB does. A scalar is its text, `{_type: 'cdata', _value: '1+2i'}`;
 * an array (whose value is its elements, complexArray) its elements' text column-major under its
 * dims, `{_type: 'cdata', _value: '1+2i 3+0i', _dimensions: [1, 2]}`. What a cell's member is held
 * as (cellElementRaw), and a Simulink.Parameter's Value (ParameterNode.setProperty).
 */
export declare function complexBag(parsed: ParsedValue): {
    _type: 'cdata';
    _value: string;
    _dimensions?: number[];
};
declare function parsedIsScalarNumeric(parsed: ParsedValue | null): boolean;
export { parsedIsScalarNumeric };
declare const _default: {
    parse: typeof parse;
    parseTyped: typeof parseTyped;
    parseArray: typeof parseArray;
    parseCell: typeof parseCell;
    parsedIsScalarNumeric: typeof parsedIsScalarNumeric;
    formatMatlabChar: typeof formatMatlabChar;
    formatMatlabCharRow: typeof formatMatlabCharRow;
    formatMatlabString: typeof formatMatlabString;
    unquoteMatlabText: typeof unquoteMatlabText;
};
export default _default;
//# sourceMappingURL=MatlabValueParser.d.ts.map