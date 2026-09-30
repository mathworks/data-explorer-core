// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
const CLASS_NAME = 'Simulink.Breakpoint';
export default class BreakpointNode extends SimulinkObjectNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.Description = props.Description || ''; }
    get icon() { return 'wsSimulinkBreakpoint'; }
    get className() { return CLASS_NAME; }
    // A Breakpoint has no scalar "value" — the Value column is empty and not editable.
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    getProperties() { return [PropName, PropDataType, PropDescription]; }
    // PI layout: schema-driven "General" group (classes/breakpoint.json).
    _serializedOverrides() { return this._gatedProps({ Description: this.Description }); }
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