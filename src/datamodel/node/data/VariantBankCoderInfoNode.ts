// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import type { SetPropertyResult } from '../DataNode.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.VariantBankCoderInfo';
// MATLAB's Simulink.VariantBankCoderInfo has no Value (R2027a: `isprop(Simulink.VariantBankCoderInfo,
// 'Value')` is 0, and setting one fails with "Unrecognized property 'Value' for class
// 'Simulink.VariantBankCoderInfo'."). Its properties are HeaderFile, DefinitionFile, PreStatement,
// PostStatement and Qualifier, which are also the fields of the saveobj envelope a dictionary
// holds it as; none of them is modelled here yet. So, as for VariantBankNode (and a bus element,
// BaseBusElementNode), the Value column offers no editor and a Value edit is refused. A Value key
// a file already carries, which only this package ever wrote (MATLAB reads such a file without a
// warning, builds the object with no Value, and drops the key on its next save), is shown and
// written back as it was read, read-only.
export default class VariantBankCoderInfoNode extends SimulinkObjectNode {
    Value: unknown;
    // Whether the file carried a Value key at all. MATLAB's own entries never do, and showing
    // their absent one as `''` implied a char value the class does not have.
    readonly _valueInFile: boolean;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this._valueInFile = props.Value !== undefined; this.Value = this._valueInFile ? props.Value : ''; }
    get icon(): string { return 'wsParameters_bankCoderInfo'; }
    get className(): string { return CLASS_NAME; }
    get displayValue(): string { return this._valueInFile ? PropValue.format(this.Value) : ''; }
    // The column stays, read-only, for a Value a file already carries.
    get valueEditable(): boolean { return false; }
    getProperties(): PropClass[] { return [PropName, PropValue, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/variantBankCoderInfo.json).
    // Refused rather than taken: DataNode's generic tail would keep the text, mark the entry
    // Modified and answer `true`, and the file would gain a key MATLAB ignores. One still in the
    // encoded stream it was read from keeps that refusal's own reason.
    setProperty(propName: string, stringValue: string): true | SetPropertyResult {
        if (this._resolveProperty(propName) === 'Value') {
            return (
                this._refuseEncodedEdit(propName, stringValue) ?? {
                    error: true,
                    reason: `'${this.displayName}' is a ${this.className}, which has no Value, so none can be set on it.`,
                    invalidValue: stringValue,
                    validValue: this.displayValue,
                }
            );
        }
        return super.setProperty(propName, stringValue);
    }
    // Nothing overridden: the bag is written as it was read, so a file's own Value key (and
    // only that) passes through `_mergeProps` unchanged, and no new one is ever written.
    _serializedOverrides(): Record<string, unknown> { return {}; }
    static get defaultName(): string { return 'VariantBankCoderInfo'; }
    // A saveobj envelope, as VariantBankNode's is, and nothing beside it: MATLAB has no `Value`
    // property on this class, so none is written.
    // The only field here whose default is not empty is Qualifier, which MATLAB defaults to the
    // string 'None' — every field is a plain char, so this class's envelope is spelled
    // identically in both formats. Measured from a MATLAB-written dictionary.
    static createDefault(name: string, parent: BaseNode | null): VariantBankCoderInfoNode { const rawVal = VariantBankCoderInfoNode._defaultCustomSaveRawVal(CLASS_NAME, ['HeaderFile', 'DefinitionFile', 'PreStatement', 'PostStatement', 'Qualifier'], { HeaderFile: '', DefinitionFile: '', PreStatement: '', PostStatement: '', Qualifier: 'None' }); const props = VariantBankCoderInfoNode._propsOf(rawVal); return new VariantBankCoderInfoNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): VariantBankCoderInfoNode { const props = VariantBankCoderInfoNode._propsOf(rawVal); return new VariantBankCoderInfoNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
}
