// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
import { OBJECT_ICON } from '../icons.js';
const CLASS_NAME = 'CustomObject';
export default class CustomObjectNode extends SimulinkObjectNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.Description = props.Description || ''; }
    get icon() { return OBJECT_ICON; }
    get className() { return CLASS_NAME; }
    get displayValue() { return '<1x1 ' + CLASS_NAME + '>'; }
    getProperties() { return [PropName, PropValue, PropDataType, PropDescription]; }
    // PI layout: schema-driven "General" group (classes/customObject.json).
    _serializedOverrides() { return this._gatedProps({ Description: this.Description }); }
    static get defaultName() { return 'CustomObject'; }
    static createDefault(name, parent) { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: {} }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new CustomObjectNode(name, parent, props, serial); }
    static parse(rawVal, name, parent) { const elem = rawVal._elements && rawVal._elements[0]; const props = ((elem && elem._properties) || {}); const serial = { _rawVal: rawVal, _properties: props }; return new CustomObjectNode(name, parent, props, serial); }
}
//# sourceMappingURL=CustomObjectNode.js.map