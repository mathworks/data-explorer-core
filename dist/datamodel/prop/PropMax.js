// Copyright 2026 The MathWorks, Inc.
export default class PropMax {
    static { this.key = 'Max'; }
    static { this.displayName = 'Maximum'; }
    static { this.editor = 'text'; }
    static { this.column = 'Max'; }
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
            return 'Max must be a number';
        }
        return null;
    }
}
//# sourceMappingURL=PropMax.js.map