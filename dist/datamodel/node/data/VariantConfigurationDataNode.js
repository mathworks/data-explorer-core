// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import { objectValueClassOf } from '../DataNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.VariantConfigurationData';
export default class VariantConfigurationDataNode extends SimulinkObjectNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.Value = props.Value !== undefined ? props.Value : ''; }
    get icon() { return 'variantSettings'; }
    // Report the real class identity from the parsed value (e.g. the container
    // is 'Simulink.VariantConfigurations'), falling back to the data class name.
    get className() { const raw = this.serial._rawVal; return (raw && objectValueClassOf(raw)) || CLASS_NAME; }
    // A VariantConfiguration has no scalar "value" — the Value column is empty and not editable.
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    getProperties() { return [PropName, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/variantConfigurationData.json).
    // MATLAB's Simulink.VariantConfigurations has no Value, as Simulink.VariantBank has none
    // (R2027a, test/parity/matlab/probe_variantconfigurations_value.m: under either name the
    // object built is a Simulink.VariantConfigurations, `isprop(…, 'Value')` is 0, none of the
    // ten properties its metaclass lists is a Value, and setting one fails with "Unrecognized
    // property 'Value' for class 'Simulink.VariantConfigurations'."). So a Value edit is refused,
    // in VariantBankNode's words, rather than taken by DataNode's generic tail, which kept the
    // text, marked the entry Modified and had both save paths write it. One still in the encoded
    // stream it was read from keeps that refusal's own reason.
    setProperty(propName, stringValue) {
        if (this._resolveProperty(propName) !== 'Value') {
            return super.setProperty(propName, stringValue);
        }
        return (this._refuseInlineBagEdit(propName, stringValue) ??
            this._refuseEncodedEdit(propName, stringValue) ?? {
            error: true,
            reason: `'${this.displayName}' is a ${this.className}, which has no Value, so none can be set on it.`,
            invalidValue: stringValue,
            validValue: this.displayValue,
        });
    }
    // Nothing beside the envelope, or into a bag held with none: the bag is written as it was
    // read, so a file's own Value key (only ever this package's) passes through `_mergeProps`
    // unchanged, and no new one is ever written. The `{ Value: '' }` this used to return reached
    // the file wherever there was no envelope to drop it under, an unedited save included.
    _serializedOverrides() { return {}; }
    static get defaultName() { return 'VariantConfigurationData'; }
    // The one entry the Add gallery produced that MATLAB REFUSED to load, in both formats:
    // `SLDD:sldd:ValueClassNotAcceptedInSection`. Two separate reasons, both measured from a
    // dictionary MATLAB wrote.
    //
    // First the class, and this half is fidelity rather than correctness. MATLAB stores the
    // CONTAINER, `Simulink.VariantConfigurations`, and never
    // `Simulink.VariantConfigurationData`, which is the name of the DATA inside it —
    // `Simulink.VariantConfigurationData` is not even a constructible class in R2027a
    // (`Simulink.VariantConfigurationData` answers with a `Simulink.VariantConfigurations`).
    // Writing the container name is free on the way back in: `_array_class:
    // 'Simulink.VariantConfigurations'` already routes to this node (NodeClassMap, kindMap,
    // SectionNode, schema/index's alias), and `className` reads `_array_class` rather than
    // CLASS_NAME, so the entry we write reads back as itself.
    //
    // What the error was actually about is the SECTION, which is not in this file: an entry
    // of this class belongs to DESIGN data, and the gallery was adding it to the
    // Configurations section. Renaming the class alone did not move the refusal by a word —
    // probe7 got the same identifier back for `Simulink.VariantConfigurations` in
    // 'Configurations', in both formats — which is what pinned it on the section.
    // SectionNode's `design` list carries that account.
    //
    // Second the shape. This class custom-saves, so a property bag is not merely lower
    // fidelity but the wrong kind of thing — the same trap that segfaulted MATLAB for
    // `Simulink.VariantVariable` (see `_defaultCustomSaveRawVal`). `_fields` is MATLAB's
    // DECLARATION order, which is not the alphabetical order its text writer emits, and the
    // binary file is what states the four struct fields' own field names and their `1*0`
    // shape — the text writer flattens all four to `{"_type":"struct","_value":"[]"}` and
    // loses them. `_emptyStruct` keeps them, for the reason it documents: that spelling
    // round-trips through both of our writers, and MATLAB's lossier one does not survive our
    // binary path at all.
    //
    // `Version` is release-stamped ('27.1' as measured) rather than derived or omitted,
    // because it is the input to MATLAB's own migration: a file claiming the version whose
    // shape it actually has is the honest answer, an absent one reads as the oldest possible
    // format, and there is nothing in a text `.sldd` to derive a live release from.
    static createDefault(name, parent) {
        const rawVal = VariantConfigurationDataNode._defaultCustomSaveRawVal('Simulink.VariantConfigurations', ['Configurations', 'VariantConfigurations', 'Constraints', 'PreferredConfiguration',
            'DefaultConfigurationName', 'DataDictionaryName', 'DataDictionarySection',
            'AreSubModelConfigurationsMigrated', 'ComponentConfigurationData', 'Version'], {
            Configurations: VariantConfigurationDataNode._emptyStruct(['Name', 'Description', 'ControlVariables'], [1, 0]),
            VariantConfigurations: VariantConfigurationDataNode._emptyStruct(['Name', 'Description', 'ControlVariables', 'SubModelConfigurations'], [1, 0]),
            Constraints: VariantConfigurationDataNode._emptyStruct(['Name', 'Condition', 'Description'], [1, 0]),
            PreferredConfiguration: '',
            DefaultConfigurationName: '',
            DataDictionaryName: '',
            DataDictionarySection: '',
            AreSubModelConfigurationsMigrated: true,
            ComponentConfigurationData: VariantConfigurationDataNode._emptyStruct(['ConfigurationName', 'ComponentName', 'ComponentVariantConfigurationData',
                'ComponentConfigurationName', 'ComponentControlVariablesInfo'], [1, 0]),
            Version: '27.1'
        });
        const props = VariantConfigurationDataNode._propsOf(rawVal);
        return new VariantConfigurationDataNode(name, parent, props, { _rawVal: rawVal, _properties: props });
    }
    static parse(rawVal, name, parent) { const props = VariantConfigurationDataNode._propsOf(rawVal); return new VariantConfigurationDataNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=VariantConfigurationDataNode.js.map