// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropBaseType from '../../prop/PropBaseType.js';
import PropDescription from '../../prop/PropDescription.js';
const CLASS_NAME = 'Simulink.AliasType';
export default class AliasTypeNode extends SimulinkObjectNode {
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
    // BaseType is UNGATED: an alias with no base type is not a type at all, so MATLAB gets
    // the key even as the empty string a half-built entry carries. It is named first because
    // that is the order a bag that lacks both keys reads on disk.
    _serializedOverrides() { return Object.assign({ BaseType: this.BaseType }, this._gatedProps({ Description: this.Description })); }
    static get defaultName() { return 'AliasType'; }
    static createDefault(name, parent) { const rawVal = AliasTypeNode._defaultRawVal(CLASS_NAME, { BaseType: 'double', DataScope: 'Auto', Description: '', HeaderFile: '' }); const props = AliasTypeNode._propsOf(rawVal); return new AliasTypeNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    static parse(rawVal, name, parent) { const props = AliasTypeNode._propsOf(rawVal); return new AliasTypeNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=AliasTypeNode.js.map