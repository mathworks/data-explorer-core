// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.VariantBank';
export default class VariantBankNode extends SimulinkObjectNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.Value = props.Value !== undefined ? props.Value : ''; }
    get icon() { return 'wsParameters_bank'; }
    get className() { return CLASS_NAME; }
    get displayValue() { return PropValue.format(this.Value); }
    getProperties() { return [PropName, PropValue, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/variantBank.json).
    // UNGATED: the Value is what the bank IS, so it is written whether or not the file
    // carried the key.
    _serializedOverrides() { return { Value: this.Value }; }
    static get defaultName() { return 'VariantBank'; }
    static createDefault(name, parent) { const rawVal = VariantBankNode._defaultRawVal(CLASS_NAME, { Value: '' }); const props = VariantBankNode._propsOf(rawVal); return new VariantBankNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    static parse(rawVal, name, parent) { const props = VariantBankNode._propsOf(rawVal); return new VariantBankNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=VariantBankNode.js.map