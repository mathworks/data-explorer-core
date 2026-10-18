/**
 * A value read where text belongs, shown as it was read: text as itself, a number, a logical or
 * a numeric array as PropValue spells it, and anything else by its kind (`<struct>`). Only a
 * hand edit puts anything but text in a VariantBank's fields, and MATLAB does not read it as
 * text either (VariantBankNode's warnings).
 */
export declare function formatReadValue(value: unknown): string;
/**
 * A Simulink.VariantBank's VariantConditions, a cell of conditions, shown as the cell literal an
 * edit types: `{'V == 1','V == 2'}`, and `{}` for none. Elements are in the file's order, which
 * is column-major, so a cell a hand edit shaped 2x1 shows as `{'a';'b'}`. A value that is not a
 * cell, which only a hand edit writes, is shown as read: a char as its literal ('V==1', which
 * MATLAB reads as a cell of that one condition), anything else by its kind.
 */
export default class PropVariantConditions {
    static key: string;
    static displayName: string;
    static editor: string;
    static column: string;
    static sourceKeys: string[];
    static format(value: unknown): string;
}
//# sourceMappingURL=PropVariantConditions.d.ts.map