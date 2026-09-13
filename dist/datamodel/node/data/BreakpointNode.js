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
    static createDefault(name, parent) { const rawVal = BreakpointNode._defaultRawVal(CLASS_NAME); const props = BreakpointNode._propsOf(rawVal); return new BreakpointNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    static parse(rawVal, name, parent) { const props = BreakpointNode._propsOf(rawVal); return new BreakpointNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=BreakpointNode.js.map