// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.ConfigSet';
export default class ConfigSetNode extends DataNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.ConfigName = props.Name || ''; }
    get icon() { return this.active ? 'check_settings' : 'settings'; }
    get className() { return CLASS_NAME; }
    // A ConfigSet has no scalar "value" — the Value column is empty and not editable.
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    getProperties() { return [PropName, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/configSet.json).
    _getSerializedProperties() { const props = Object.assign({}, this.serial._properties); props.Name = this.ConfigName; return props; }
    serializeValue() { return this._serializeSimulinkObject({ Name: this.ConfigName }); }
    static get defaultName() { return 'Configuration'; }
    static createDefault(name, parent) { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { Name: name || 'Configuration' } }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new ConfigSetNode(name, parent, props, serial); }
    static parse(rawVal, name, parent) { const elem = rawVal._elements && rawVal._elements[0]; const props = ((elem && elem._properties) || {}); const serial = { _rawVal: rawVal, _properties: props }; return new ConfigSetNode(name, parent, props, serial); }
}
//# sourceMappingURL=ConfigSetNode.js.map