// Copyright 2026 The MathWorks, Inc.
export default class PropMax {
    static { this.key = 'Max'; }
    static { this.displayName = 'Maximum'; }
    static { this.editor = 'text'; }
    static { this.column = 'Max'; }
    static format(value) {
        return value !== undefined && value !== null ? String(value) : '';
    }
}
//# sourceMappingURL=PropMax.js.map