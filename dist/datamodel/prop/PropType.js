// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
export default class PropType {
    static { this.key = 'Type'; }
    static { this.displayName = 'Type'; }
    static { this.editor = 'label'; }
    static { this.column = 'Type'; }
    static readValue(node) {
        const n = node;
        return n.projectItemType || n.className || '';
    }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropType.js.map