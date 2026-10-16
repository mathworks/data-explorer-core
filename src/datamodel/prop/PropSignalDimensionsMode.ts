// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../node/BaseNode.js';
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
    static key = 'dimensionsMode';
    static displayName = 'Dimensions Mode';
    static editor = 'select';
    static column: string | null = 'dimensionsMode';
    // The node field (and raw `_properties` key) an edit is written to.
    static nodeProperty = 'DimensionsMode';
    // Raw _properties key, so the PI "Other" catch-all treats it as already shown.
    static sourceKeys = ['DimensionsMode'];

    static readValue(node: BaseNode): string {
        return ((node as unknown as { DimensionsMode?: string }).DimensionsMode) || 'auto';
    }

    static readOptions(): string[] {
        return OPTIONS;
    }

    static format = formatText;
}
