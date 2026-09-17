// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
const CLASS_NAME = 'Simulink.ConfigSet';
export default class ConfigSetNode extends SimulinkObjectNode {
    // The config set's own Name property. In a .sldd the entry name and this
    // property are the same string — both parse paths build the node with
    // _properties.Name equal to the entry name — so this is a view of `name`
    // rather than a second copy. It used to be an independently stored field,
    // which let the two drift: renaming the entry moved `name` but left
    // ConfigName stale, and since serializeValue writes ConfigName, the saved
    // file kept the OLD name and the entry reverted on reopen.
    get ConfigName() { return this.name; }
    constructor(name, parent, props, serial) { super(name, parent, serial); this.Description = props.Description || ''; }
    get icon() { return this.active ? 'check_settings' : 'settings'; }
    get className() { return CLASS_NAME; }
    // A ConfigSet has no scalar "value" — the Value column is empty and not editable.
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    getProperties() { return [PropName, PropDataType, PropDescription]; }
    // PI layout: schema-driven "General" group (classes/configSet.json).
    // Name is UNGATED: a config set MATLAB can load has to be able to say what it is called,
    // so the key is written whatever the file carried — and because it is a view of `name`, a
    // renamed entry saves under the new name on both paths. Description is GATED, on the same
    // terms as every other Description in this cluster: a config set whose file never carried
    // one must not gain an empty one on save, or opening a dictionary and saving it with no
    // edits produces a diff in source control. Order follows AliasTypeNode — the identity key
    // the class owns, then the gated description.
    _serializedOverrides() { return Object.assign({ Name: this.ConfigName }, this._gatedProps({ Description: this.Description })); }
    static get defaultName() { return 'Configuration'; }
    static createDefault(name, parent) { const rawVal = ConfigSetNode._defaultRawVal(CLASS_NAME, { Name: name || 'Configuration' }); const props = ConfigSetNode._propsOf(rawVal); return new ConfigSetNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    static parse(rawVal, name, parent) { const props = ConfigSetNode._propsOf(rawVal); return new ConfigSetNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=ConfigSetNode.js.map