// Copyright 2026 The MathWorks, Inc.
export default class PropSpecification {
    static { this.key = 'Specification'; }
    static { this.displayName = 'Specification'; }
    static { this.editor = 'text'; }
    static { this.column = 'Value'; }
    static format(value) {
        return value ? "'" + value + "'" : '';
    }
}
//# sourceMappingURL=PropSpecification.js.map