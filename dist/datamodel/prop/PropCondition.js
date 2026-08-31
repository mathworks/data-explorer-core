// Copyright 2026 The MathWorks, Inc.
export default class PropCondition {
    static { this.key = 'Condition'; }
    static { this.displayName = 'Condition'; }
    static { this.editor = 'text'; }
    static { this.column = 'Value'; }
    static format(value) {
        return value ? "'" + value + "'" : '';
    }
}
//# sourceMappingURL=PropCondition.js.map