// Copyright 2026 The MathWorks, Inc.
export default class PropName {
    static { this.key = 'Name'; }
    static { this.displayName = 'Name'; }
    static { this.editor = 'text'; }
    static { this.column = 'Name'; }
    static { this.nodeProperty = 'name'; }
    static { this.defaultValue = ''; }
    // The raw _properties key is 'Name' (capital) — distinct from nodeProperty
    // ('name', the JS field). Declare it so the PI "Other" catch-all treats a
    // node's raw 'Name' key as already shown (e.g. bus elements store it).
    static { this.sourceKeys = ['Name']; }
    static readValue(node) {
        return node.displayName;
    }
    static format(value) {
        return value || '';
    }
    static parse(raw) {
        return String(raw || '');
    }
    static validate(value) {
        if (!value || !value.trim()) {
            return 'Name cannot be empty';
        }
        return null;
    }
}
//# sourceMappingURL=PropName.js.map