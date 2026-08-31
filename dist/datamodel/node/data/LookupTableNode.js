// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
const CLASS_NAME = 'Simulink.LookupTable';
export default class LookupTableNode extends DataNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.Description = props.Description || ''; }
    get icon() { return 'wsLookup'; }
    get className() { return CLASS_NAME; }
    // A LookupTable has no scalar "value" — the Value column is empty and not editable.
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    getProperties() { return [PropName, PropDataType, PropDescription]; }
    // PI layout: schema-driven "General" group (classes/lookupTable.json).
    _getSerializedProperties() { const props = Object.assign({}, this.serial._properties); if ('Description' in this.serial._properties || this.Description) {
        props.Description = this.Description;
    } return props; }
    serializeValue() { const overrides = {}; if ('Description' in this.serial._properties || this.Description) {
        overrides.Description = this.Description;
    } return this._serializeSimulinkObject(overrides); }
    static get defaultName() { return 'LookupTable'; }
    static createDefault(name, parent) { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: {} }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new LookupTableNode(name, parent, props, serial); }
    static parse(rawVal, name, parent) { const elem = rawVal._elements && rawVal._elements[0]; const props = ((elem && elem._properties) || {}); const serial = { _rawVal: rawVal, _properties: props }; return new LookupTableNode(name, parent, props, serial); }
}
//# sourceMappingURL=LookupTableNode.js.map