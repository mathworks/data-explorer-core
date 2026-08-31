// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
// A bus element's DimensionsMode ('Fixed' | 'Variable'). MATLAB constrains it to
// that enum (verified), so it COULD be an editable select; surfaced read-only for
// now to stay conservative and stop the column rendering empty for elements.
// Emits into the shared `dimensionsMode` column.
export default class PropDimensionsMode {
    static { this.key = 'dimensionsMode'; }
    static { this.displayName = 'Dimensions Mode'; }
    static { this.editor = 'label'; }
    static { this.column = 'dimensionsMode'; }
    // Raw _properties key (differs from the lowercase display key) so the PI
    // "Other" catch-all treats it as already shown.
    static { this.sourceKeys = ['DimensionsMode']; }
    static readValue(node) {
        return (node.DimensionsMode) || '';
    }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropDimensionsMode.js.map