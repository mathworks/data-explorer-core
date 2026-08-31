// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import PropName from '../../prop/PropName.js';
import PropBaseType from '../../prop/PropBaseType.js';
import PropDescription from '../../prop/PropDescription.js';
const CLASS_NAME = 'Simulink.AliasType';
export default class AliasTypeNode extends DataNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.BaseType = props.BaseType || ''; this.Description = props.Description || ''; }
    get icon() { return this.isDerived ? 'typeAlias' : 'wsAlias'; }
    get className() { return CLASS_NAME; }
    // An alias has no "value" — its base type ("double") is surfaced in the Data
    // Type column via PropBaseType. The Value column is therefore empty and not
    // editable.
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    // Table columns: PropBaseType owns the Data Type column, so PropDataType (which
    // would show the class name 'Simulink.AliasType') is omitted here.
    getProperties() { return [PropName, PropBaseType, PropDescription]; }
    // PI layout is schema-driven (schema/classes/aliasType.json).
    _getSerializedProperties() { const props = Object.assign({}, this.serial._properties); props.BaseType = this.BaseType; if ('Description' in this.serial._properties || this.Description) {
        props.Description = this.Description;
    } return props; }
    serializeValue() { const overrides = { BaseType: this.BaseType }; if ('Description' in this.serial._properties || this.Description) {
        overrides.Description = this.Description;
    } return this._serializeSimulinkObject(overrides); }
    static get defaultName() { return 'AliasType'; }
    static createDefault(name, parent) { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { BaseType: 'double', DataScope: 'Auto', Description: '', HeaderFile: '' } }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new AliasTypeNode(name, parent, props, serial); }
    static parse(rawVal, name, parent) { const elem = rawVal._elements && rawVal._elements[0]; const props = ((elem && elem._properties) || {}); const serial = { _rawVal: rawVal, _properties: props }; return new AliasTypeNode(name, parent, props, serial); }
}
//# sourceMappingURL=AliasTypeNode.js.map