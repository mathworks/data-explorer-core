// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
export default class PropBlockPath {
    static { this.key = 'BlockPath'; }
    static { this.displayName = 'Block Path'; }
    static { this.editor = 'label'; }
    static { this.column = null; }
    static readValue(node) {
        return node.blockPath || '';
    }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropBlockPath.js.map