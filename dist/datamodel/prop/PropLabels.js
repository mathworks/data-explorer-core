// Copyright 2026 The MathWorks, Inc.
export default class PropLabels {
    static { this.key = 'Labels'; }
    static { this.displayName = 'Labels'; }
    static { this.editor = 'label'; }
    static { this.column = 'Labels'; }
    static readValue(node) {
        const labels = node.labels;
        return labels && labels.length > 0 ? labels.join(', ') : '';
    }
    static format(value) {
        return value || '';
    }
}
//# sourceMappingURL=PropLabels.js.map