// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
const CLASS_NAME = 'Simulink.NumericType';
export default class NumericTypeNode extends DataNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.Description = props.Description || ''; }
    get icon() { return this.isDerived ? 'typeNumeric' : 'wsNumeric'; }
    get className() { return CLASS_NAME; }
    // A NumericType has no scalar "value" — the Value column is empty and not
    // editable (the class name is surfaced in the Data Type column).
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    getProperties() { return [PropName, PropDataType, PropDescription]; }
    // PI layout is schema-driven (schema/classes/numericType.json).
    _getSerializedProperties() { const props = Object.assign({}, this.serial._properties); if ('Description' in this.serial._properties || this.Description) {
        props.Description = this.Description;
    } return props; }
    serializeValue() { const overrides = {}; if ('Description' in this.serial._properties || this.Description) {
        overrides.Description = this.Description;
    } return this._serializeSimulinkObject(overrides); }
    static get defaultName() { return 'NumericType'; }
    static createDefault(name, parent) { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: {} }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new NumericTypeNode(name, parent, props, serial); }
    static parse(rawVal, name, parent) { const elem = rawVal._elements && rawVal._elements[0]; const props = ((elem && elem._properties) || {}); const serial = { _rawVal: rawVal, _properties: props }; return new NumericTypeNode(name, parent, props, serial); }
}
//# sourceMappingURL=NumericTypeNode.js.map