// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
// A Simulink.Signal's Complexity: an editable dropdown over the Signal's own enum,
// 'auto' | 'real' | 'complex'. Measured in R2027a: `set(Simulink.Signal, 'Complexity')` is
// exactly that set, mpt.Signal's is the same, the default is 'auto', and any other value is
// refused with "There is no enumerated value named 'X'." So this is PropComplexity's mechanism
// with the Signal's set. PropComplexity stays BusElement's and ValueType's, whose classes
// have no 'auto'; the two share the column and nothing else.
//
// SignalNode.setProperty validates an edit against readOptions (DataNode._rejectUnknownEnumeral),
// so the dropdown and the rule that refuses a typed-in value are one list. `nodeProperty` sends
// an edit to the node field, which both panes read: SignalNode puts this atom in the table and
// in the Property Inspector, in place of the schema descriptor that reads the source bag.
//
// readValue falls back to 'auto', not '': a cleared cell stores '' (the licence
// _rejectUnknownEnumeral gives a clear), which SignalNode saves as 'auto', so the cell shows
// what the save writes.
const OPTIONS = ['auto', 'real', 'complex'];
export default class PropSignalComplexity {
    static { this.key = 'complexity'; }
    static { this.displayName = 'Complexity'; }
    static { this.editor = 'select'; }
    static { this.column = 'complexity'; }
    // The node field (and raw `_properties` key) an edit is written to.
    static { this.nodeProperty = 'Complexity'; }
    // Raw _properties key, so the PI "Other" catch-all treats it as already shown.
    static { this.sourceKeys = ['Complexity']; }
    static readValue(node) {
        return (node.Complexity) || 'auto';
    }
    static readOptions() {
        return OPTIONS;
    }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropSignalComplexity.js.map