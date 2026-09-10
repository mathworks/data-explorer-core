// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.VariantBankCoderInfo';
export default class VariantBankCoderInfoNode extends SimulinkObjectNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.Value = props.Value !== undefined ? props.Value : ''; }
    get icon() { return 'wsParameters_bankCoderInfo'; }
    get className() { return CLASS_NAME; }
    get displayValue() { return PropValue.format(this.Value); }
    getProperties() { return [PropName, PropValue, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/variantBankCoderInfo.json).
    // UNGATED, as VariantBankNode's Value is.
    _serializedOverrides() { return { Value: this.Value }; }
    static get defaultName() { return 'VariantBankCoderInfo'; }
    static createDefault(name, parent) { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { Value: '' } }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new VariantBankCoderInfoNode(name, parent, props, serial); }
    static parse(rawVal, name, parent) { const elem = rawVal._elements && rawVal._elements[0]; const props = ((elem && elem._properties) || {}); const serial = { _rawVal: rawVal, _properties: props }; return new VariantBankCoderInfoNode(name, parent, props, serial); }
}
//# sourceMappingURL=VariantBankCoderInfoNode.js.map