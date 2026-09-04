export interface ParsedValue {
    type: string;
    value: unknown;
    dims?: number[];
}
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
export declare function formatMatlabChar(value: string): string;
export declare function formatMatlabString(value: string): string;
export declare function unquoteMatlabText(text: string): string;
declare function parseArray(str: string): ParsedValue | null;
declare function parseCell(str: string): ParsedValue | null;
declare function parsedIsScalarNumeric(parsed: ParsedValue | null): boolean;
export { parsedIsScalarNumeric };
declare const _default: {
    parse: typeof parse;
    parseArray: typeof parseArray;
    parseCell: typeof parseCell;
    parsedIsScalarNumeric: typeof parsedIsScalarNumeric;
    formatMatlabChar: typeof formatMatlabChar;
    formatMatlabString: typeof formatMatlabString;
    unquoteMatlabText: typeof unquoteMatlabText;
};
export default _default;
//# sourceMappingURL=MatlabValueParser.d.ts.map