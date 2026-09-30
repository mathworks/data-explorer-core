// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
const CLASS_NAME = 'Simulink.ConfigSetRef';
export default class ConfigSetRefNode extends SimulinkObjectNode {
    // The reference's own `Name` property, a view of `name` for exactly the reasons
    // ConfigSetNode.ConfigName is one — and the fix for a defect MATLAB demonstrated rather
    // than one reasoned about. MATLAB requires an entry in the config section to be named the
    // same as its value's `Name`, and it enforces that by SILENTLY RENAMING THE ENTRY: a
    // dictionary where the Add gallery had written an entry called `ConfigSetRef` came back
    // from MATLAB holding one called `Reference`, because we wrote no `Name` at all and a
    // default-constructed `Simulink.ConfigSetRef` calls itself `Reference`. The user added one
    // entry and reopened the file to find a differently named one.
    get ConfigName() { return this.name; }
    constructor(name, parent, props, serial) { super(name, parent, serial); this.SourceName = props.SourceName || ''; this.Description = props.Description || ''; }
    get icon() { return this.active ? 'check_configurationReference' : 'configurationReference'; }
    get className() { return CLASS_NAME; }
    // A ConfigSetRef has no scalar "value" — the Value column is empty and not editable.
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    getProperties() { return [PropName, PropDataType, PropDescription]; }
    // PI layout: schema-driven "General" group (classes/configSetRef.json).
    // SourceName is UNGATED, on the same terms as a ConfigSet's Name: a reference that cannot
    // say what it points at is not a reference, so the key is written even as the empty string
    // a half-built entry carries. Name is UNGATED for a stronger reason than fidelity — see
    // ConfigName above: omitting it is what let MATLAB rename the entry out from under us, and
    // writing a view of `name` is also what makes a RENAMED entry save under its new name
    // instead of reverting on reopen. Description is GATED — see
    // ConfigSetNode._serializedOverrides. Key order follows MATLAB's own declaration order for
    // this class (`SourceName` first, `Name` after the override cells), then the gated
    // description.
    _serializedOverrides() { return Object.assign({ SourceName: this.SourceName, Name: this.ConfigName }, this._gatedProps({ Description: this.Description })); }
    // MATLAB's own name for a default-constructed `Simulink.ConfigSetRef`, measured from the
    // `Name` property of one (`<P Name="Name" Class="char">Reference</P>`) rather than derived
    // from the class name. It has to BE that string: the entry name and the value's `Name` are
    // one string as far as MATLAB is concerned, so any other default would be renamed on the
    // first save by a MATLAB that disagrees.
    static get defaultName() { return 'Reference'; }
    static createDefault(name, parent) { const rawVal = ConfigSetRefNode._defaultRawVal(CLASS_NAME, { SourceName: '', Name: name || 'Reference' }); const props = ConfigSetRefNode._propsOf(rawVal); return new ConfigSetRefNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    static parse(rawVal, name, parent) { const props = ConfigSetRefNode._propsOf(rawVal); return new ConfigSetRefNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=ConfigSetRefNode.js.map