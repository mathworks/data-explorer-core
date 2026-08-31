// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
export default class PropLabels {
    static { this.key = 'Labels'; }
    static { this.displayName = 'Labels'; }
    static { this.editor = 'label'; }
    static { this.column = 'Labels'; }
    static readValue(node) {
        const labels = node.labels;
        return labels && labels.length > 0 ? labels.join(', ') : '';
    }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropLabels.js.map