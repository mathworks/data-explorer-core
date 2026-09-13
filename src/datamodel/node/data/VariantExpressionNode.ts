// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropCondition from '../../prop/PropCondition.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.VariantExpression';
export default class VariantExpressionNode extends SimulinkObjectNode {
    Condition: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.Condition = (props.Condition as string) || ''; }
    get icon(): string { return 'wsVariant'; }
    get className(): string { return CLASS_NAME; }
    get displayValue(): string { return PropCondition.format(this.Condition); }
    getProperties(): PropClass[] { return [PropName, PropCondition, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/variantExpression.json).
    // UNGATED: the Condition is the expression itself, so it is written whether or not the
    // file carried the key.
    _serializedOverrides(): Record<string, unknown> { return { Condition: this.Condition }; }
    static get defaultName(): string { return 'VariantExpression'; }
    static createDefault(name: string, parent: BaseNode | null): VariantExpressionNode { const rawVal = VariantExpressionNode._defaultRawVal(CLASS_NAME, { Condition: '' }); const props = VariantExpressionNode._propsOf(rawVal); return new VariantExpressionNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): VariantExpressionNode { const props = VariantExpressionNode._propsOf(rawVal); return new VariantExpressionNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
}
