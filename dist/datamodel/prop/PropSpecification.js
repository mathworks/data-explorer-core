// Copyright 2026 The MathWorks, Inc.
export default class PropSpecification {
    static { this.key = 'Specification'; }
    static { this.displayName = 'Specification'; }
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
//# sourceMappingURL=PropSpecification.js.map