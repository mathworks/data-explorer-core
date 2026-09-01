// Copyright 2026 The MathWorks, Inc.
import { formatMatlabNum } from '../parser/XmlUtils.js';
import { formatMatlabChar, formatMatlabString, unquoteMatlabText } from '../parser/MatlabValueParser.js';
export default class PropValue {
    static { this.key = 'Value'; }
    static { this.displayName = 'Value'; }
    static { this.editor = 'text'; }
    static { this.column = 'Value'; }
    static readValue(node) {
        return node.displayValue;
    }
    static format(value) {
        if (value === null || value === undefined) {
            return '[ ]';
        }
        // formatMatlabNum, not String: a Value of Inf/-Inf/NaN is legal in MATLAB
        // and reaches us as a real non-finite number, but its JavaScript spelling
        // ('Infinity') is not a MATLAB literal and MatlabValueParser rejects it —
        // so String() would render a cell whose own displayed text cannot be
        // typed back in.
        if (typeof value === 'number') {
            return formatMatlabNum(value);
        }
        if (typeof value === 'boolean') {
            return String(value);
        }
        // formatMatlabChar, not a bare concatenation: MATLAB escapes a quote inside
        // a literal by doubling it, so the text `it's` has to display as 'it''s'.
        // Written as 'it's' the cell showed something that is not a MATLAB literal,
        // and the table seeds its in-place editor with the displayed text — so
        // committing it unchanged re-parsed as a DIFFERENT, shorter value.
        if (typeof value === 'string') {
            return formatMatlabChar(value);
        }
        if (Array.isArray(value)) {
            if (value.length === 0) {
                return '[ ]';
            }
            if (value.length === 1 && typeof value[0] === 'string') {
                return formatMatlabString(value[0]);
            }
            const arrStr = '[' + value.map(formatMatlabNum).join(' ') + ']';
            return arrStr.length > 50 ? '<1x' + value.length + ' double>' : arrStr;
        }
        return '';
    }
    // The inverse of the quoting above — see PropClass.unformat. Consulted only by
    // DataNode's generic string path, i.e. by the nodes that store a bare string
    // and let this atom decorate it (Simulink.VariantBank and friends). The classes
    // whose Value is a real MATLAB expression (Parameter, a MATLAB variable,
    // VariantControl) override setProperty and parse the text themselves, so their
    // quotes stay meaningful and this is never reached for them.
    static { this.unformat = unquoteMatlabText; }
}
//# sourceMappingURL=PropValue.js.map