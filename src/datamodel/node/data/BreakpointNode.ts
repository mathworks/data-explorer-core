// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
const CLASS_NAME = 'Simulink.Breakpoint';
export default class BreakpointNode extends SimulinkObjectNode {
    Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.Description = (props.Description as string) || ''; }
    get icon(): string { return 'wsSimulinkBreakpoint'; }
    get className(): string { return CLASS_NAME; }
    // A Breakpoint has no scalar "value" — the Value column is empty and not editable.
    get displayValue(): string { return ''; }
    get valueEditable(): boolean { return false; }
    getProperties(): PropClass[] { return [PropName, PropDataType, PropDescription]; }
    // PI layout: schema-driven "General" group (classes/breakpoint.json).
    _serializedOverrides(): Record<string, unknown> { return this._gatedProps({ Description: this.Description }); }
    static get defaultName(): string { return 'Breakpoint'; }
    static createDefault(name: string, parent: BaseNode | null): BreakpointNode { const rawVal = BreakpointNode._defaultRawVal(CLASS_NAME); const props = BreakpointNode._propsOf(rawVal); return new BreakpointNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): BreakpointNode { const props = BreakpointNode._propsOf(rawVal); return new BreakpointNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
}
