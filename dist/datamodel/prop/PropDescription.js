// Copyright 2026 The MathWorks, Inc.
export default class PropDescription {
    static { this.key = 'Description'; }
    static { this.displayName = 'Description'; }
    static { this.editor = 'textArea'; }
    static { this.column = 'Description'; }
    static { this.defaultValue = ''; }
    static format(value) {
        return value || '';
    }
    static parse(raw) {
        return String(raw || '');
    }
    static validate() {
        return null;
    }
}
//# sourceMappingURL=PropDescription.js.map