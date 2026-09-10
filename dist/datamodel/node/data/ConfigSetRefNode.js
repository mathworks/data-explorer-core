// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.ConfigSetRef';
export default class ConfigSetRefNode extends SimulinkObjectNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.SourceName = props.SourceName || ''; }
    get icon() { return this.active ? 'check_configurationReference' : 'configurationReference'; }
    get className() { return CLASS_NAME; }
    // A ConfigSetRef has no scalar "value" — the Value column is empty and not editable.
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    getProperties() { return [PropName, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/configSetRef.json).
    // UNGATED, on the same terms as a ConfigSet's Name: a reference that cannot say what it
    // points at is not a reference, so the key is written even as the empty string a
    // half-built entry carries.
    _serializedOverrides() { return { SourceName: this.SourceName }; }
    static get defaultName() { return 'ConfigSetRef'; }
    static createDefault(name, parent) { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { SourceName: '' } }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new ConfigSetRefNode(name, parent, props, serial); }
    static parse(rawVal, name, parent) { const elem = rawVal._elements && rawVal._elements[0]; const props = ((elem && elem._properties) || {}); const serial = { _rawVal: rawVal, _properties: props }; return new ConfigSetRefNode(name, parent, props, serial); }
}
//# sourceMappingURL=ConfigSetRefNode.js.map