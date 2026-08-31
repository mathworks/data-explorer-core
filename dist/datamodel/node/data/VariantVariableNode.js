// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import PropName from '../../prop/PropName.js';
import PropSpecification from '../../prop/PropSpecification.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.VariantVariable';
export default class VariantVariableNode extends DataNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.Specification = props.Specification || ''; }
    get icon() { return 'variant_wsParameters'; }
    get className() { return CLASS_NAME; }
    get displayValue() { return PropSpecification.format(this.Specification); }
    getProperties() { return [PropName, PropSpecification, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/variantVariable.json).
    _getSerializedProperties() { const props = Object.assign({}, this.serial._properties); props.Specification = this.Specification; return props; }
    serializeValue() { return this._serializeSimulinkObject({ Specification: this.Specification }); }
    static get defaultName() { return 'VariantVariable'; }
    static createDefault(name, parent) { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { Specification: '' } }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new VariantVariableNode(name, parent, props, serial); }
    static parse(rawVal, name, parent) { const elem = rawVal._elements && rawVal._elements[0]; const props = ((elem && elem._properties) || {}); const serial = { _rawVal: rawVal, _properties: props }; return new VariantVariableNode(name, parent, props, serial); }
}
//# sourceMappingURL=VariantVariableNode.js.map