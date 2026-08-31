// Copyright 2026 The MathWorks, Inc.
export default class PropMin {
    static { this.key = 'Min'; }
    static { this.displayName = 'Minimum'; }
    static { this.editor = 'text'; }
    static { this.column = 'Min'; }
    static format(value) {
        return value !== undefined && value !== null ? String(value) : '';
    }
}
//# sourceMappingURL=PropMin.js.map