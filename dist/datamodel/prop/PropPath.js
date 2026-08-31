// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
export default class PropPath {
    static { this.key = 'Path'; }
    static { this.displayName = 'Path'; }
    static { this.editor = 'label'; }
    static { this.column = null; }
    static readValue(node) {
        return node.fullPath || node.name;
    }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropPath.js.map