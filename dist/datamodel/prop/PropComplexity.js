// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
// A bus element's Complexity ('real' | 'complex'). MATLAB constrains it to that
// enum (verified: any other value raises "There is no enumerated value named
// ..."), so it COULD be an editable select; it is surfaced read-only for now to
// stay conservative and stop the column rendering empty for elements. Emits into
// the shared `complexity` column (same key the Parameter/Signal schema uses).
export default class PropComplexity {
    static { this.key = 'complexity'; }
    static { this.displayName = 'Complexity'; }
    static { this.editor = 'label'; }
    static { this.column = 'complexity'; }
    // Raw _properties key (differs from the lowercase display key) so the PI
    // "Other" catch-all treats it as already shown.
    static { this.sourceKeys = ['Complexity']; }
    static readValue(node) {
        return (node.Complexity) || '';
    }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropComplexity.js.map