// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
const CLASS_NAME = 'Simulink.NumericType';
export default class NumericTypeNode extends SimulinkObjectNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.Description = props.Description || ''; }
    get icon() { return this.isDerived ? 'typeNumeric' : 'wsNumeric'; }
    get className() { return CLASS_NAME; }
    // A NumericType has no scalar "value" — the Value column is empty and not
    // editable (the class name is surfaced in the Data Type column).
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    getProperties() { return [PropName, PropDataType, PropDescription]; }
    // PI layout is schema-driven (schema/classes/numericType.json).
    _serializedOverrides() { return this._gatedProps({ Description: this.Description }); }
    static get defaultName() { return 'NumericType'; }
    static createDefault(name, parent) { const rawVal = NumericTypeNode._defaultRawVal(CLASS_NAME); const props = NumericTypeNode._propsOf(rawVal); return new NumericTypeNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    static parse(rawVal, name, parent) { const props = NumericTypeNode._propsOf(rawVal); return new NumericTypeNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=NumericTypeNode.js.map