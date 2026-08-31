// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.VariantConfigurationData';
export default class VariantConfigurationDataNode extends DataNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.Value = props.Value !== undefined ? props.Value : ''; }
    get icon() { return 'variantSettings'; }
    // Report the real class identity from the parsed value (e.g. the container
    // is 'Simulink.VariantConfigurations'), falling back to the data class name.
    get className() { const raw = this.serial._rawVal; return (raw && raw._array_class) || CLASS_NAME; }
    // A VariantConfiguration has no scalar "value" — the Value column is empty and not editable.
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    getProperties() { return [PropName, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/variantConfigurationData.json).
    _getSerializedProperties() { const props = Object.assign({}, this.serial._properties); props.Value = this.Value; return props; }
    serializeValue() { return this._serializeSimulinkObject({ Value: this.Value }); }
    static get defaultName() { return 'VariantConfigurationData'; }
    static createDefault(name, parent) { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { Value: '' } }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new VariantConfigurationDataNode(name, parent, props, serial); }
    static parse(rawVal, name, parent) { const elem = rawVal._elements && rawVal._elements[0]; const props = ((elem && elem._properties) || {}); const serial = { _rawVal: rawVal, _properties: props }; return new VariantConfigurationDataNode(name, parent, props, serial); }
}
//# sourceMappingURL=VariantConfigurationDataNode.js.map