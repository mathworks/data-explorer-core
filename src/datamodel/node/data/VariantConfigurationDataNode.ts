// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.VariantConfigurationData';
export default class VariantConfigurationDataNode extends SimulinkObjectNode {
    Value: unknown;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.Value = props.Value !== undefined ? props.Value : ''; }
    get icon(): string { return 'variantSettings'; }
    // Report the real class identity from the parsed value (e.g. the container
    // is 'Simulink.VariantConfigurations'), falling back to the data class name.
    get className(): string { const raw = this.serial._rawVal as Record<string, unknown> | undefined; return (raw && (raw._array_class as string)) || CLASS_NAME; }
    // A VariantConfiguration has no scalar "value" — the Value column is empty and not editable.
    get displayValue(): string { return ''; }
    get valueEditable(): boolean { return false; }
    getProperties(): PropClass[] { return [PropName, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/variantConfigurationData.json).
    // UNGATED, as VariantBankNode's Value is.
    _serializedOverrides(): Record<string, unknown> { return { Value: this.Value }; }
    static get defaultName(): string { return 'VariantConfigurationData'; }
    static createDefault(name: string, parent: BaseNode | null): VariantConfigurationDataNode { const rawVal = VariantConfigurationDataNode._defaultRawVal(CLASS_NAME, { Value: '' }); const props = VariantConfigurationDataNode._propsOf(rawVal); return new VariantConfigurationDataNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): VariantConfigurationDataNode { const props = VariantConfigurationDataNode._propsOf(rawVal); return new VariantConfigurationDataNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
}
