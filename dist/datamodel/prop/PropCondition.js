// Copyright 2026 The MathWorks, Inc.
export default class PropCondition {
    static { this.key = 'Condition'; }
    static { this.displayName = 'Condition'; }
    static { this.editor = 'text'; }
    static { this.column = 'Value'; }
    static { this.defaultValue = ''; }
    static format(value) {
        return value ? "'" + value + "'" : '';
    }
    static parse(raw) {
        return String(raw || '');
    }
    static validate() {
        return null;
    }
}
//# sourceMappingURL=PropCondition.js.map