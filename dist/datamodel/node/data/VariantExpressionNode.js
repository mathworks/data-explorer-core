// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import PropName from '../../prop/PropName.js';
import PropCondition from '../../prop/PropCondition.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.VariantExpression';
export default class VariantExpressionNode extends DataNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.Condition = props.Condition || ''; }
    get icon() { return 'wsVariant'; }
    get className() { return CLASS_NAME; }
    get displayValue() { return PropCondition.format(this.Condition); }
    getProperties() { return [PropName, PropCondition, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/variantExpression.json).
    _getSerializedProperties() { const props = Object.assign({}, this.serial._properties); props.Condition = this.Condition; return props; }
    serializeValue() { return this._serializeSimulinkObject({ Condition: this.Condition }); }
    static get defaultName() { return 'VariantExpression'; }
    static createDefault(name, parent) { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { Condition: '' } }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new VariantExpressionNode(name, parent, props, serial); }
    static parse(rawVal, name, parent) { const elem = rawVal._elements && rawVal._elements[0]; const props = ((elem && elem._properties) || {}); const serial = { _rawVal: rawVal, _properties: props }; return new VariantExpressionNode(name, parent, props, serial); }
}
//# sourceMappingURL=VariantExpressionNode.js.map