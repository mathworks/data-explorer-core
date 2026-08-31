// Copyright 2026 The MathWorks, Inc.
export default class PropLocation {
    static { this.key = 'Location'; }
    static { this.displayName = 'Location'; }
    static { this.editor = 'label'; }
    static { this.column = 'Location'; }
    static readValue(node) {
        return node.location || '';
    }
    static format(value) {
        return value || '';
    }
}
//# sourceMappingURL=PropLocation.js.map