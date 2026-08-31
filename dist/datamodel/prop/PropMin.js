// Copyright 2026 The MathWorks, Inc.
export default class PropMin {
    static { this.key = 'Min'; }
    static { this.displayName = 'Minimum'; }
    static { this.editor = 'text'; }
    static { this.column = 'Min'; }
    static { this.defaultValue = undefined; }
    static format(value) {
        return value !== undefined && value !== null ? String(value) : '';
    }
    static parse(raw) {
        if (raw === '' || raw === undefined) {
            return undefined;
        }
        const num = Number(raw);
        return isNaN(num) ? raw : num;
    }
    static validate(value) {
        if (value !== undefined && value !== null && typeof value !== 'number') {
            return 'Min must be a number';
        }
        return null;
    }
}
//# sourceMappingURL=PropMin.js.map