// Copyright 2026 The MathWorks, Inc.
import { formatMatlabNum } from '../parser/XmlUtils.js';
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
        if (typeof value === 'string') {
            return "'" + value + "'";
        }
        if (Array.isArray(value)) {
            if (value.length === 0) {
                return '[ ]';
            }
            if (value.length === 1 && typeof value[0] === 'string') {
                return '"' + value[0] + '"';
            }
            const arrStr = '[' + value.map(formatMatlabNum).join(' ') + ']';
            return arrStr.length > 50 ? '<1x' + value.length + ' double>' : arrStr;
        }
        return '';
    }
}
//# sourceMappingURL=PropValue.js.map