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
    static createDefault(name, parent) { const rawVal = CustomObjectNode._defaultRawVal(CLASS_NAME); const props = CustomObjectNode._propsOf(rawVal); return new CustomObjectNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    static parse(rawVal, name, parent) { const props = CustomObjectNode._propsOf(rawVal); return new CustomObjectNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=CustomObjectNode.js.map