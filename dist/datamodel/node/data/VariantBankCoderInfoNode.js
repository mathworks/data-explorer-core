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
    // A saveobj envelope, as VariantBankNode's is, and the invented `Value` goes the same way.
    // The only field here whose default is not empty is Qualifier, which MATLAB defaults to the
    // string 'None' — every field is a plain char, so this class's envelope is spelled
    // identically in both formats. Measured from a MATLAB-written dictionary.
    static createDefault(name, parent) { const rawVal = VariantBankCoderInfoNode._defaultCustomSaveRawVal(CLASS_NAME, ['HeaderFile', 'DefinitionFile', 'PreStatement', 'PostStatement', 'Qualifier'], { HeaderFile: '', DefinitionFile: '', PreStatement: '', PostStatement: '', Qualifier: 'None' }); const props = VariantBankCoderInfoNode._propsOf(rawVal); return new VariantBankCoderInfoNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    static parse(rawVal, name, parent) { const props = VariantBankCoderInfoNode._propsOf(rawVal); return new VariantBankCoderInfoNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=VariantBankCoderInfoNode.js.map