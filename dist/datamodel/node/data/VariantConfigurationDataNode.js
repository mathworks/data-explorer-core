// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.VariantConfigurationData';
export default class VariantConfigurationDataNode extends SimulinkObjectNode {
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
    // UNGATED, as VariantBankNode's Value is.
    _serializedOverrides() { return { Value: this.Value }; }
    static get defaultName() { return 'VariantConfigurationData'; }
    static createDefault(name, parent) { const rawVal = VariantConfigurationDataNode._defaultRawVal(CLASS_NAME, { Value: '' }); const props = VariantConfigurationDataNode._propsOf(rawVal); return new VariantConfigurationDataNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    static parse(rawVal, name, parent) { const props = VariantConfigurationDataNode._propsOf(rawVal); return new VariantConfigurationDataNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=VariantConfigurationDataNode.js.map