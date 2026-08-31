// Copyright 2026 The MathWorks, Inc.
export default class PropStatus {
    static { this.key = 'Status'; }
    static { this.displayName = 'Status'; }
    static { this.editor = 'label'; }
    static { this.column = null; }
    static readValue(node) {
        return node.resolved ? 'Loaded' : 'Not Loaded';
    }
    static format(value) {
        return value || '';
    }
}
//# sourceMappingURL=PropStatus.js.map