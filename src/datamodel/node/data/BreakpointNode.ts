// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import type { SetPropertyResult } from '../DataNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.Breakpoint';
export default class BreakpointNode extends SimulinkObjectNode {
    // What the FILE says, shown read-only. MATLAB's Simulink.Breakpoint has no Description:
    // `isprop` is 0, setting one fails with MATLAB:noPublicFieldForClass (R2027a, measured
    // 2026-10-16), and a dictionary MATLAB writes carries no such key. A key some other writer
    // left is read here for the Description column and written back exactly as read: nothing
    // overrides it (`_serializedOverrides` is the inherited empty one), so the file's own bag
    // passes through. Simulink.FunctionElement is the precedent (ServiceBusNode.ts).
    Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.Description = (props.Description as string) || ''; }
    get icon(): string { return 'wsSimulinkBreakpoint'; }
    get className(): string { return CLASS_NAME; }
    // A Breakpoint has no scalar "value" — the Value column is empty and not editable.
    get displayValue(): string { return ''; }
    get valueEditable(): boolean { return false; }
    getProperties(): PropClass[] { return [PropName, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/breakpoint.json).
    // No editor in the table (`row._descriptionEditable`) or the Property Inspector.
    get descriptionEditable(): boolean { return false; }
    // An edit is refused in MATLAB's words, rather than accepted and saved as a key MATLAB
    // ignores on load, which is what an edit here used to do.
    setProperty(propName: string, stringValue: string): true | SetPropertyResult {
        // One whose properties are held beside its class, which the save writes back as read, refuses
        // every edit but a rename in one message (DataNode._refuseInlineBagEdit).
        const inlineRefusal = this._refuseInlineBagEdit(propName, stringValue);
        if (inlineRefusal) { return inlineRefusal; }
        if (propName === 'Description') {
            return { error: true, reason: `Unrecognized property 'Description' for class '${CLASS_NAME}'.`, invalidValue: stringValue, validValue: this.Description };
        }
        return super.setProperty(propName, stringValue);
    }
    static get defaultName(): string { return 'Breakpoint'; }
    // MEASURED from what MATLAB R2027a writes for `Simulink.Breakpoint` with nothing set, in
    // MATLAB's own alphabetical key order. Three of the four properties are themselves nested
    // objects, and the bag used to be EMPTY — which is why a newly added Breakpoint could display
    // a Storage Class of 'Auto' and refuse every write to it: `writeSourcePath` never invents a
    // missing sub-object, so with no CoderInfo there was nowhere for the value to land.
    // 'BP'/'N' are MATLAB's single-breakpoint field names — a LookupTable's own Breakpoints
    // object is the same class numbered 'BP1'/'N1', so the two are NOT interchangeable.
    static createDefault(name: string, parent: BaseNode | null): BreakpointNode { const rawVal = BreakpointNode._defaultRawVal(CLASS_NAME, { Breakpoints: { _object_class: 'Simulink.lookuptable.Breakpoint', _properties: { DataType: 'auto', Description: '', Dimensions: [0, 0], FieldName: 'BP', TunableSizeName: 'N', TunableSizeValue: -1, Unit: '' } }, CoderInfo: BreakpointNode._defaultCoderInfo('Parameter'), StructTypeInfo: { _object_class: 'Simulink.lookuptable.StructTypeInfo', _properties: { DataScope: 'Auto', HeaderFileName: '', Name: '' } }, SupportTunableSize: false }); const props = BreakpointNode._propsOf(rawVal); return new BreakpointNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): BreakpointNode { const props = BreakpointNode._propsOf(rawVal); return new BreakpointNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
}
