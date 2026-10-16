// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import type { SetPropertyResult } from '../DataNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.LookupTable';
export default class LookupTableNode extends SimulinkObjectNode {
    // What the FILE says, shown read-only. MATLAB's Simulink.LookupTable has no Description:
    // `isprop` is 0, setting one fails with MATLAB:noPublicFieldForClass (R2027a, measured
    // 2026-10-16), and a dictionary MATLAB writes carries no such key. A key some other writer
    // left is read here for the Description column and written back exactly as read: nothing
    // overrides it (`_serializedOverrides` is the inherited empty one), so the file's own bag
    // passes through. Simulink.FunctionElement is the precedent (ServiceBusNode.ts).
    Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.Description = (props.Description as string) || ''; }
    get icon(): string { return 'wsLookup'; }
    get className(): string { return CLASS_NAME; }
    // A LookupTable has no scalar "value" — the Value column is empty and not editable.
    get displayValue(): string { return ''; }
    get valueEditable(): boolean { return false; }
    getProperties(): PropClass[] { return [PropName, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/lookupTable.json).
    // No editor in the table (`row._descriptionEditable`) or the Property Inspector.
    get descriptionEditable(): boolean { return false; }
    // An edit is refused in MATLAB's words, rather than accepted and saved as a key MATLAB
    // ignores on load, which is what an edit here used to do.
    setProperty(propName: string, stringValue: string): true | SetPropertyResult {
        if (propName === 'Description') {
            return { error: true, reason: `Unrecognized property 'Description' for class '${CLASS_NAME}'.`, invalidValue: stringValue, validValue: this.Description };
        }
        return super.setProperty(propName, stringValue);
    }
    static get defaultName(): string { return 'LookupTable'; }
    // MEASURED from what MATLAB R2027a writes for `Simulink.LookupTable` with nothing set, in
    // MATLAB's own alphabetical key order. Four nested objects and two scalars, where the bag used
    // to be EMPTY — so a newly added LookupTable showed a Storage Class of 'Auto' that no write
    // could reach (`writeSourcePath` refuses rather than synthesizing the missing CoderInfo).
    // The Breakpoints/StructTypeInfo classes are shared with `Simulink.Breakpoint` but the VALUES
    // are not: a LookupTable numbers its breakpoint 'BP1'/'N1' against the Breakpoint's 'BP'/'N',
    // because a table has an axis per dimension and a standalone breakpoint set has one.
    static createDefault(name: string, parent: BaseNode | null): LookupTableNode { const rawVal = LookupTableNode._defaultRawVal(CLASS_NAME, { AllowMultipleInstancesOfTypeToHaveDifferentTableBreakpointSizes: false, Breakpoints: { _object_class: 'Simulink.lookuptable.Breakpoint', _properties: { DataType: 'auto', Description: '', Dimensions: [0, 0], FieldName: 'BP1', TunableSizeName: 'N1', TunableSizeValue: -1, Unit: '' } }, CoderInfo: LookupTableNode._defaultCoderInfo('Parameter'), StructTypeInfo: { _object_class: 'Simulink.lookuptable.StructTypeInfo', _properties: { DataScope: 'Auto', HeaderFileName: '', Name: '' } }, SupportTunableSize: false, Table: { _object_class: 'Simulink.lookuptable.Table', _properties: { DataType: 'auto', Description: '', Dimensions: [0, 0], FieldName: 'Table', Unit: '' } } }); const props = LookupTableNode._propsOf(rawVal); return new LookupTableNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): LookupTableNode { const props = LookupTableNode._propsOf(rawVal); return new LookupTableNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
}
