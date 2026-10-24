// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.LookupTable';
export default class LookupTableNode extends SimulinkObjectNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.Description = props.Description || ''; }
    get icon() { return 'wsLookup'; }
    get className() { return CLASS_NAME; }
    // A LookupTable has no scalar "value" — the Value column is empty and not editable.
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    getProperties() { return [PropName, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/lookupTable.json).
    // MATLAB's Simulink.LookupTable has no Description: isprop is false (BaseNode.descriptionApplies),
    // so no editor in the table (`row._descriptionEditable`) or the Property Inspector.
    get descriptionApplies() { return false; }
    // And an edit of one is refused in MATLAB's words, by every setter and the session's gate alike
    // (DataNode._noDescriptionRefusal, SimulinkObjectNode.setProperty), rather than accepted and
    // saved as a key MATLAB ignores on load, which is what an edit here used to do.
    _noDescriptionRefusal(propName, stringValue) {
        return propName === 'Description' ? { error: true, reason: `Unrecognized property 'Description' for class '${CLASS_NAME}'.`, invalidValue: stringValue, validValue: '' } : null;
    }
    static get defaultName() { return 'LookupTable'; }
    // MEASURED from what MATLAB R2027a writes for `Simulink.LookupTable` with nothing set, in
    // MATLAB's own alphabetical key order. Four nested objects and two scalars, where the bag used
    // to be EMPTY — so a newly added LookupTable showed a Storage Class of 'Auto' that no write
    // could reach (`writeSourcePath` refuses rather than synthesizing the missing CoderInfo).
    // The Breakpoints/StructTypeInfo classes are shared with `Simulink.Breakpoint` but the VALUES
    // are not: a LookupTable numbers its breakpoint 'BP1'/'N1' against the Breakpoint's 'BP'/'N',
    // because a table has an axis per dimension and a standalone breakpoint set has one.
    static createDefault(name, parent) { const rawVal = LookupTableNode._defaultRawVal(CLASS_NAME, { AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes: false, Breakpoints: { _object_class: 'Simulink.lookuptable.Breakpoint', _properties: { DataType: 'auto', Description: '', Dimensions: [0, 0], FieldName: 'BP1', TunableSizeName: 'N1', TunableSizeValue: -1, Unit: '' } }, CoderInfo: LookupTableNode._defaultCoderInfo('Parameter'), StructTypeInfo: { _object_class: 'Simulink.lookuptable.StructTypeInfo', _properties: { DataScope: 'Auto', HeaderFileName: '', Name: '' } }, SupportTunableSize: false, Table: { _object_class: 'Simulink.lookuptable.Table', _properties: { DataType: 'auto', Description: '', Dimensions: [0, 0], FieldName: 'Table', Unit: '' } } }); const props = LookupTableNode._propsOf(rawVal); return new LookupTableNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    static parse(rawVal, name, parent) { const props = LookupTableNode._propsOf(rawVal); return new LookupTableNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=LookupTableNode.js.map