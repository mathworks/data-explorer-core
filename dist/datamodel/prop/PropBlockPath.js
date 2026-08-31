// Copyright 2026 The MathWorks, Inc.
export default class PropBlockPath {
    static { this.key = 'BlockPath'; }
    static { this.displayName = 'Block Path'; }
    static { this.editor = 'label'; }
    static { this.column = null; }
    static readValue(node) {
        return node.blockPath || '';
    }
    static format(value) {
        return value || '';
    }
}
//# sourceMappingURL=PropBlockPath.js.map