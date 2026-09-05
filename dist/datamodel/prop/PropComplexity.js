// Copyright 2026 The MathWorks, Inc.
import { formatText } from './formatText.js';
// A bus element's Complexity: an editable dropdown over MATLAB's own enum,
// 'real' | 'complex'. That casing is not a guess — it is what MATLAB itself wrote
// into `test/parity/artifacts/text/params.sldd` ("Complexity": "real") for both
// elements of MyBus, and any other value raises "There is no enumerated value
// named ..." (probed on the live object; recorded in Simulink.BusElement.md).
// Since the enum is closed and known, the set is declared here as readOptions
// rather than inferred, and BusElementNode.setProperty validates an incoming edit
// against THIS list — one list, so the dropdown the table renders and the rule
// that refuses a typed-in value cannot drift apart.
//
// `nodeProperty` is load-bearing now that the prop is writable: the display key is
// lowercase ('complexity', the column) while the node field and the raw
// `_properties` key are capitalised, so without it DataNode.setProperty would
// resolve the edit to a stray `complexity` field and the real Complexity would
// never change.
//
// NOT verified by the live MATLAB tier. The in-process gates (edit stores, invalid
// value refused, edited value survives serialize + re-parse in both .sldd formats)
// all pass; the write-back case that has MATLAB reopen the file and read the
// property back is in test/parity/matlab/writeback.live.test.ts and has never been
// run, because this machine has no MATLAB. Until someone runs it with
// DEX_MATLAB_CMD set, "MATLAB accepts what we write here" is an expectation, not a
// result.
//
// Only Simulink.BusElement uses this atom. The `complexity` COLUMN is also filled
// for Parameter/Signal/ValueType, but through the declarative schema
// (schema/props/dataObject.json), which still declares it a label — deliberately,
// because those classes admit a third value ('auto') and are a separate unlock.
const OPTIONS = ['real', 'complex'];
export default class PropComplexity {
    static { this.key = 'complexity'; }
    static { this.displayName = 'Complexity'; }
    static { this.editor = 'select'; }
    static { this.column = 'complexity'; }
    // The node field (and raw `_properties` key) an edit is written to.
    static { this.nodeProperty = 'Complexity'; }
    // Raw _properties key (differs from the lowercase display key) so the PI
    // "Other" catch-all treats it as already shown.
    static { this.sourceKeys = ['Complexity']; }
    static readValue(node) {
        return (node.Complexity) || '';
    }
    static readOptions() {
        return OPTIONS;
    }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropComplexity.js.map