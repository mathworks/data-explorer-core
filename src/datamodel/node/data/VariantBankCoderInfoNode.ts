// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.VariantBankCoderInfo';
export default class VariantBankCoderInfoNode extends SimulinkObjectNode {
    Value: unknown;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.Value = props.Value !== undefined ? props.Value : ''; }
    get icon(): string { return 'wsParameters_bankCoderInfo'; }
    get className(): string { return CLASS_NAME; }
    get displayValue(): string { return PropValue.format(this.Value); }
    getProperties(): PropClass[] { return [PropName, PropValue, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/variantBankCoderInfo.json).
    // UNGATED, as VariantBankNode's Value is.
    _serializedOverrides(): Record<string, unknown> { return { Value: this.Value }; }
    static get defaultName(): string { return 'VariantBankCoderInfo'; }
    static createDefault(name: string, parent: BaseNode | null): VariantBankCoderInfoNode { const rawVal = VariantBankCoderInfoNode._defaultRawVal(CLASS_NAME, { Value: '' }); const props = VariantBankCoderInfoNode._propsOf(rawVal); return new VariantBankCoderInfoNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): VariantBankCoderInfoNode { const props = VariantBankCoderInfoNode._propsOf(rawVal); return new VariantBankCoderInfoNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
}
