// Copyright 2026 The MathWorks, Inc.
export default class PropDataType {
    static { this.key = 'DataType'; }
    static { this.displayName = 'Data Type'; }
    static { this.editor = 'label'; }
    static { this.column = 'DataType'; }
    static { this.defaultValue = ''; }
    static readValue(node) {
        return node.dataType;
    }
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
//# sourceMappingURL=PropDataType.js.map