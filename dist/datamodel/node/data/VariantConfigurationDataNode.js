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