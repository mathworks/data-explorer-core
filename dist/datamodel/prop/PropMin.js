// Copyright 2026 The MathWorks, Inc.
import { formatMatlabNum } from '../parser/XmlUtils.js';
export default class PropMin {
    static { this.key = 'Min'; }
    static { this.displayName = 'Minimum'; }
    static { this.editor = 'text'; }
    static { this.column = 'Min'; }
    static format(value) {
        // A number as MATLAB spells it: a bound a file holds as an infinity shows Inf, not "Infinity".
        return value !== undefined && value !== null ? formatMatlabNum(value) : '';
    }
}
//# sourceMappingURL=PropMin.js.map