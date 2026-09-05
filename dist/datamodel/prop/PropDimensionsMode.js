// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
// A bus element's DimensionsMode: an editable dropdown over MATLAB's own enum,
// 'Fixed' | 'Variable'. The capital F is what MATLAB itself wrote into
// `test/parity/artifacts/text/params.sldd` ("DimensionsMode": "Fixed"), and it is
// the reason the set is not lower-cased for tidiness — any other spelling raises
// "There is no enumerated value named ..." (probed on the live object; recorded in
// Simulink.BusElement.md). The set is declared here as readOptions and
// BusElementNode.setProperty validates an incoming edit against THIS list, so the
// dropdown and the rule that refuses a typed-in value are the same list.
//
// `nodeProperty` is load-bearing now that the prop is writable: the display key is
// lowercase ('dimensionsMode', the column) while the node field and the raw
// `_properties` key are capitalised, so without it DataNode.setProperty would
// resolve the edit to a stray `dimensionsMode` field and the real DimensionsMode
// would never change.
//
// NOT verified by the live MATLAB tier. The in-process gates (edit stores, invalid
// value refused, edited value survives serialize + re-parse in both .sldd formats)
// all pass; the write-back case that has MATLAB reopen the file and read the
// property back is in test/parity/matlab/writeback.live.test.ts and has never been
// run, because this machine has no MATLAB. Until someone runs it with
// DEX_MATLAB_CMD set, "MATLAB accepts what we write here" is an expectation, not a
// result.
//
// Only Simulink.BusElement uses this atom. The `dimensionsMode` COLUMN is also
// filled for Simulink.Signal, but through the declarative schema
// (schema/props/dataObject.json), which still declares it a label — deliberately,
// because a Signal's DimensionsMode defaults to 'auto', a value this set does not
// contain, so the two are separate unlocks with separate enums.
const OPTIONS = ['Fixed', 'Variable'];
export default class PropDimensionsMode {
    static { this.key = 'dimensionsMode'; }
    static { this.displayName = 'Dimensions Mode'; }
    static { this.editor = 'select'; }
    static { this.column = 'dimensionsMode'; }
    // The node field (and raw `_properties` key) an edit is written to.
    static { this.nodeProperty = 'DimensionsMode'; }
    // Raw _properties key (differs from the lowercase display key) so the PI
    // "Other" catch-all treats it as already shown.
    static { this.sourceKeys = ['DimensionsMode']; }
    static readValue(node) {
        return (node.DimensionsMode) || '';
    }
    static readOptions() {
        return OPTIONS;
    }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropDimensionsMode.js.map