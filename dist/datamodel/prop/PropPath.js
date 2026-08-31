// Copyright 2026 The MathWorks, Inc.
export default class PropPath {
    static { this.key = 'Path'; }
    static { this.displayName = 'Path'; }
    static { this.editor = 'label'; }
    static { this.column = null; }
    static readValue(node) {
        return node.fullPath || node.name;
    }
    static format(value) {
        return value || '';
    }
}
//# sourceMappingURL=PropPath.js.map