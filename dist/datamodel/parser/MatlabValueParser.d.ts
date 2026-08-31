export interface ParsedValue {
    type: string;
    value: unknown;
    dims?: number[];
}
declare function parse(str: string): ParsedValue | null;
declare function parseArray(str: string): ParsedValue | null;
declare function parseCell(str: string): ParsedValue | null;
declare function parsedIsScalarNumeric(parsed: ParsedValue | null): boolean;
export { parsedIsScalarNumeric };
declare const _default: {
    parse: typeof parse;
    parseArray: typeof parseArray;
    parseCell: typeof parseCell;
    parsedIsScalarNumeric: typeof parsedIsScalarNumeric;
};
export default _default;
//# sourceMappingURL=MatlabValueParser.d.ts.map