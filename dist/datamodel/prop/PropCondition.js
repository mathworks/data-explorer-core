// Copyright 2026 The MathWorks, Inc.
import { formatMatlabChar, unquoteMatlabText } from '../parser/MatlabValueParser.js';
export default class PropCondition {
    static { this.key = 'Condition'; }
    static { this.displayName = 'Condition'; }
    static { this.editor = 'text'; }
    static { this.column = 'Value'; }
    // formatMatlabChar, not a bare concatenation: a condition containing a quote
    // (strcmp(mode,'fast') is an ordinary variant condition) has to display as the
    // literal that reads back as itself, or the text shown in the cell is not one
    // MATLAB can evaluate.
    static format(value) {
        return value ? formatMatlabChar(String(value)) : '';
    }
    // The inverse — see PropClass.unformat. The stored Condition is raw text while
    // the cell displays it quoted, and the editor is seeded with what the cell
    // showed, so an edit arrives quoted and has to be unquoted before it is stored
    // or the quotes accumulate into the saved file.
    static { this.unformat = unquoteMatlabText; }
}
//# sourceMappingURL=PropCondition.js.map