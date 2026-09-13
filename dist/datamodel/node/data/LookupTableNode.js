// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
const CLASS_NAME = 'Simulink.LookupTable';
export default class LookupTableNode extends SimulinkObjectNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.Description = props.Description || ''; }
    get icon() { return 'wsLookup'; }
    get className() { return CLASS_NAME; }
    // A LookupTable has no scalar "value" — the Value column is empty and not editable.
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    getProperties() { return [PropName, PropDataType, PropDescription]; }
    // PI layout: schema-driven "General" group (classes/lookupTable.json).
    _serializedOverrides() { return this._gatedProps({ Description: this.Description }); }
    static get defaultName() { return 'LookupTable'; }
    static createDefault(name, parent) { const rawVal = LookupTableNode._defaultRawVal(CLASS_NAME); const props = LookupTableNode._propsOf(rawVal); return new LookupTableNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    static parse(rawVal, name, parent) { const props = LookupTableNode._propsOf(rawVal); return new LookupTableNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=LookupTableNode.js.map