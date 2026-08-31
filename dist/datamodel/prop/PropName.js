// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
export default class PropName {
    static { this.key = 'Name'; }
    static { this.displayName = 'Name'; }
    static { this.editor = 'text'; }
    static { this.column = 'Name'; }
    static { this.nodeProperty = 'name'; }
    // The raw _properties key is 'Name' (capital) — distinct from nodeProperty
    // ('name', the JS field). Declare it so the PI "Other" catch-all treats a
    // node's raw 'Name' key as already shown (e.g. bus elements store it).
    static { this.sourceKeys = ['Name']; }
    static readValue(node) {
        return node.displayName;
    }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropName.js.map