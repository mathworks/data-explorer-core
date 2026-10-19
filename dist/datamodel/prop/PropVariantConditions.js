// Copyright 2026 The MathWorks, Inc.
import { SAVEOBJ_KEY } from '../parser/XmlUtils.js';
import { formatMatlabChar } from '../parser/MatlabValueParser.js';
import PropValue from './PropValue.js';
/**
 * A value read where text belongs, shown as it was read: text as itself, a number, a logical or
 * a numeric array as PropValue spells it, and anything else by its kind (`<struct>`). Only a
 * hand edit puts anything but text in a VariantBank's fields, and MATLAB does not read it as
 * text either (VariantBankNode's warnings).
 */
export function formatReadValue(value) {
    if (typeof value === 'string') {
        return value;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const v = value;
        const kind = v._array_type ?? v._type ?? v._array_class ?? 'value';
        return `<${String(kind).toLowerCase()}>`;
    }
    return PropValue.format(value);
}
// One element of the cell, as a MATLAB literal: a char quoted ('V == 1'), anything else as read.
function element(value) {
    return typeof value === 'string' ? formatMatlabChar(value) : formatReadValue(value);
}
/**
 * A Simulink.VariantBank's VariantConditions, a cell of conditions, shown as the cell literal an
 * edit types: `{'V == 1','V == 2'}`, and `{}` for none. Elements are in the file's order, which
 * is column-major, so a cell a hand edit shaped 2x1 shows as `{'a';'b'}`. A value that is not a
 * cell, which only a hand edit writes, is shown as read: a char as its literal ('V==1', which
 * MATLAB reads as a cell of that one condition), anything else by its kind.
 */
export default class PropVariantConditions {
    static { this.key = 'VariantConditions'; }
    static { this.displayName = 'Variant Conditions'; }
    static { this.editor = 'text'; }
    static { this.column = 'variantConditions'; }
    // Read out of the saveobj envelope, or the plain property a text dictionary R2026b wrote, so
    // the "Other" group lists neither again.
    static { this.sourceKeys = [SAVEOBJ_KEY, 'VariantConditions']; }
    static format(value) {
        if (typeof value === 'string') {
            return formatMatlabChar(value);
        }
        const cell = value;
        if (!cell || typeof cell !== 'object' || cell._array_type !== 'Cell' || !Array.isArray(cell._elements)) {
            return formatReadValue(value);
        }
        const elements = cell._elements.map(element);
        const dims = Array.isArray(cell._dimensions) ? cell._dimensions : [1, elements.length];
        const rows = dims.length === 2 && dims[0] > 1 && dims[0] * dims[1] === elements.length ? dims[0] : 1;
        if (rows === 1) {
            return '{' + elements.join(',') + '}';
        }
        const lines = [];
        for (let r = 0; r < rows; r++) {
            const row = [];
            for (let c = 0; c < dims[1]; c++) {
                row.push(elements[c * rows + r]);
            }
            lines.push(row.join(','));
        }
        return '{' + lines.join(';') + '}';
    }
}
//# sourceMappingURL=PropVariantConditions.js.map