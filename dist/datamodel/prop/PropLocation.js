// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
export default class PropLocation {
    static { this.key = 'Location'; }
    static { this.displayName = 'Location'; }
    static { this.editor = 'label'; }
    static { this.column = 'Location'; }
    static readValue(node) {
        return node.location || '';
    }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropLocation.js.map