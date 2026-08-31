// Copyright 2026 The MathWorks, Inc.
export default class PropValue {
    static { this.key = 'Value'; }
    static { this.displayName = 'Value'; }
    static { this.editor = 'text'; }
    static { this.column = 'Value'; }
    static { this.defaultValue = 0; }
    static readValue(node) {
        return node.displayValue;
    }
    static format(value) {
        if (value === null || value === undefined) {
            return '[ ]';
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
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
            const arrStr = '[' + value.join(' ') + ']';
            return arrStr.length > 50 ? '<1x' + value.length + ' double>' : arrStr;
        }
        return '';
    }
    static parse(raw) {
        return raw;
    }
    static validate() {
        return null;
    }
}
//# sourceMappingURL=PropValue.js.map