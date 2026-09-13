// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropCondition from '../../prop/PropCondition.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.VariantExpression';
export default class VariantExpressionNode extends SimulinkObjectNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.Condition = props.Condition || ''; }
    get icon() { return 'wsVariant'; }
    get className() { return CLASS_NAME; }
    get displayValue() { return PropCondition.format(this.Condition); }
    getProperties() { return [PropName, PropCondition, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/variantExpression.json).
    // UNGATED: the Condition is the expression itself, so it is written whether or not the
    // file carried the key.
    _serializedOverrides() { return { Condition: this.Condition }; }
    static get defaultName() { return 'VariantExpression'; }
    static createDefault(name, parent) { const rawVal = VariantExpressionNode._defaultRawVal(CLASS_NAME, { Condition: '' }); const props = VariantExpressionNode._propsOf(rawVal); return new VariantExpressionNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    static parse(rawVal, name, parent) { const props = VariantExpressionNode._propsOf(rawVal); return new VariantExpressionNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=VariantExpressionNode.js.map