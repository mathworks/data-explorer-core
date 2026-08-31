// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
export default class PropStatus {
    static { this.key = 'Status'; }
    static { this.displayName = 'Status'; }
    static { this.editor = 'label'; }
    static { this.column = null; }
    static readValue(node) {
        return node.resolved ? 'Loaded' : 'Not Loaded';
    }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropStatus.js.map