// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
// A Simulink.Signal's DimensionsMode: an editable dropdown over the Signal's own enum,
// 'auto' | 'Fixed' | 'Variable'. Measured in R2027a: `set(Simulink.Signal, 'DimensionsMode')`
// is exactly that set, with that casing, mpt.Signal's is the same, the default is 'auto', and
// any other value is refused with "There is no enumerated value named 'X'." So this is
// PropDimensionsMode's mechanism with the Signal's set. PropDimensionsMode stays BusElement's
// and ValueType's, whose classes have no 'auto'.
//
// SignalNode.setProperty validates an edit against readOptions (DataNode._rejectUnknownEnumeral),
// so the dropdown and the rule that refuses a typed-in value are one list. `nodeProperty` sends
// an edit to the node field, which both panes read: SignalNode puts this atom in the table and
// in the Property Inspector, in place of the schema descriptor that reads the source bag.
//
// readValue falls back to 'auto', not '': a cleared cell stores '' (the licence
// _rejectUnknownEnumeral gives a clear), which SignalNode saves as 'auto', so the cell shows
// what the save writes.
const OPTIONS = ['auto', 'Fixed', 'Variable'];
export default class PropSignalDimensionsMode {
    static { this.key = 'dimensionsMode'; }
    static { this.displayName = 'Dimensions Mode'; }
    static { this.editor = 'select'; }
    static { this.column = 'dimensionsMode'; }
    // The node field (and raw `_properties` key) an edit is written to.
    static { this.nodeProperty = 'DimensionsMode'; }
    // Raw _properties key, so the PI "Other" catch-all treats it as already shown.
    static { this.sourceKeys = ['DimensionsMode']; }
    static readValue(node) {
        return (node.DimensionsMode) || 'auto';
    }
    static readOptions() {
        return OPTIONS;
    }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropSignalDimensionsMode.js.map