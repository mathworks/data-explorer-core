// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.VariantBank';
// MATLAB's Simulink.VariantBank has no Value (R2027a: `isprop(Simulink.VariantBank, 'Value')`
// is 0, and setting one fails with "Unrecognized property 'Value' for class
// 'Simulink.VariantBank'."). Its properties are Name, Description, VariantConditions,
// AllChoicesCoderInfo and ActiveChoiceCoderInfo, and the saveobj envelope a dictionary holds it
// as adds BankCoderInfo; none of them is modelled here yet. So the Value column offers no editor
// and a Value edit is refused, as a bus element's is (BaseBusElementNode). A Value key a file
// already carries, which only this package ever wrote (MATLAB reads such a file without a
// warning, builds a bank with no Value, and drops the key on its next save), is shown and
// written back as it was read, read-only.
export default class VariantBankNode extends SimulinkObjectNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this._valueInFile = props.Value !== undefined; this.Value = this._valueInFile ? props.Value : ''; }
    get icon() { return 'wsParameters_bank'; }
    get className() { return CLASS_NAME; }
    get displayValue() { return this._valueInFile ? PropValue.format(this.Value) : ''; }
    // The column stays, read-only, for a Value a file already carries.
    get valueEditable() { return false; }
    getProperties() { return [PropName, PropValue, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/variantBank.json).
    // Refused rather than taken: DataNode's generic tail would keep the text, mark the entry
    // Modified and answer `true`, and the file would gain a key MATLAB ignores. One still in the
    // encoded stream it was read from keeps that refusal's own reason.
    setProperty(propName, stringValue) {
        if (this._resolveProperty(propName) === 'Value') {
            return (this._refuseEncodedEdit(propName, stringValue) ?? {
                error: true,
                reason: `'${this.displayName}' is a ${this.className}, which has no Value, so none can be set on it.`,
                invalidValue: stringValue,
                validValue: this.displayValue,
            });
        }
        return super.setProperty(propName, stringValue);
    }
    // Nothing overridden: the bag is written as it was read, so a file's own Value key (and
    // only that) passes through `_mergeProps` unchanged, and no new one is ever written.
    _serializedOverrides() { return {}; }
    static get defaultName() { return 'VariantBank'; }
    // A saveobj envelope, for the reason VariantVariableNode's carries one, and nothing beside
    // it: MATLAB has no `Value` property on this class at all, so the `{ Value: '' }` this used
    // to write was pure invention. Fields, order and defaults measured from a MATLAB-written
    // dictionary.
    static createDefault(name, parent) { const rawVal = VariantBankNode._defaultCustomSaveRawVal(CLASS_NAME, ['Name', 'Description', 'VariantConditions', 'AllChoicesCoderInfo', 'ActiveChoiceCoderInfo', 'BankCoderInfo'], { Name: '', Description: '', VariantConditions: VariantBankNode._emptyCell(), AllChoicesCoderInfo: '', ActiveChoiceCoderInfo: '', BankCoderInfo: '' }); const props = VariantBankNode._propsOf(rawVal); return new VariantBankNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    static parse(rawVal, name, parent) { const props = VariantBankNode._propsOf(rawVal); return new VariantBankNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=VariantBankNode.js.map