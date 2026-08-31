// Copyright 2026 The MathWorks, Inc.
// The EnumType "Value" cell: a dropdown whose options are the enumeral child
// names. The chosen option is written to the node's DefaultValue, so selecting a
// row sets which enumeral the enum defaults to. Reading falls back to the first
// enumeral when no DefaultValue is set (matching the child "current" icon rule).
export default class PropEnumValue {
    static { this.key = 'Value'; }
    static { this.displayName = 'Value'; }
    static { this.editor = 'select'; }
    static { this.column = 'Value'; }
    static { this.nodeProperty = 'DefaultValue'; }
    static { this.defaultValue = ''; }
    static readValue(node) {
        return node.displayValue;
    }
    static readOptions(node) {
        return node.children.map((c) => c.name);
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
//# sourceMappingURL=PropEnumValue.js.map