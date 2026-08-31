// Copyright 2026 The MathWorks, Inc.
export default class PropNumberOfEntries {
    static { this.key = 'NumberOfEntries'; }
    static { this.displayName = 'Number of Entries'; }
    static { this.editor = 'label'; }
    static format(value) {
        return String(value || 0);
    }
}
//# sourceMappingURL=PropNumberOfEntries.js.map