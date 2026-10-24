// Copyright 2026 The MathWorks, Inc.
import { formatMatlabNum } from '../parser/XmlUtils.js';
export default class PropMax {
    static { this.key = 'Max'; }
    static { this.displayName = 'Maximum'; }
    static { this.editor = 'text'; }
    static { this.column = 'Max'; }
    static format(value) {
        // A number as MATLAB spells it: a bound a file holds as an infinity shows Inf, not "Infinity".
        return value !== undefined && value !== null ? formatMatlabNum(value) : '';
    }
}
//# sourceMappingURL=PropMax.js.map