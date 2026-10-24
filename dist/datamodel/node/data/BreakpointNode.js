// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.Breakpoint';
export default class BreakpointNode extends SimulinkObjectNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.Description = props.Description || ''; }
    get icon() { return 'wsSimulinkBreakpoint'; }
    get className() { return CLASS_NAME; }
    // A Breakpoint has no scalar "value" — the Value column is empty and not editable.
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    getProperties() { return [PropName, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/breakpoint.json).
    // MATLAB's Simulink.Breakpoint has no Description: isprop is false (BaseNode.descriptionApplies),
    // so no editor in the table (`row._descriptionEditable`) or the Property Inspector.
    get descriptionApplies() { return false; }
    // And an edit of one is refused in MATLAB's words, by every setter and the session's gate alike
    // (DataNode._noDescriptionRefusal, SimulinkObjectNode.setProperty), rather than accepted and
    // saved as a key MATLAB ignores on load, which is what an edit here used to do.
    _noDescriptionRefusal(propName, stringValue) {
        return propName === 'Description' ? { error: true, reason: `Unrecognized property 'Description' for class '${CLASS_NAME}'.`, invalidValue: stringValue, validValue: '' } : null;
    }
    static get defaultName() { return 'Breakpoint'; }
    // MEASURED from what MATLAB R2027a writes for `Simulink.Breakpoint` with nothing set, in
    // MATLAB's own alphabetical key order. Three of the four properties are themselves nested
    // objects, and the bag used to be EMPTY — which is why a newly added Breakpoint could display
    // a Storage Class of 'Auto' and refuse every write to it: `writeSourcePath` never invents a
    // missing sub-object, so with no CoderInfo there was nowhere for the value to land.
    // 'BP'/'N' are MATLAB's single-breakpoint field names — a LookupTable's own Breakpoints
    // object is the same class numbered 'BP1'/'N1', so the two are NOT interchangeable.
    static createDefault(name, parent) { const rawVal = BreakpointNode._defaultRawVal(CLASS_NAME, { Breakpoints: { _object_class: 'Simulink.lookuptable.Breakpoint', _properties: { DataType: 'auto', Description: '', Dimensions: [0, 0], FieldName: 'BP', TunableSizeName: 'N', TunableSizeValue: -1, Unit: '' } }, CoderInfo: BreakpointNode._defaultCoderInfo('Parameter'), StructTypeInfo: { _object_class: 'Simulink.lookuptable.StructTypeInfo', _properties: { DataScope: 'Auto', HeaderFileName: '', Name: '' } }, SupportTunableSize: false }); const props = BreakpointNode._propsOf(rawVal); return new BreakpointNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    static parse(rawVal, name, parent) { const props = BreakpointNode._propsOf(rawVal); return new BreakpointNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=BreakpointNode.js.map