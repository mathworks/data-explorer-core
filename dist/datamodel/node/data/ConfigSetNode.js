// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
const CLASS_NAME = 'Simulink.ConfigSet';
// The Version of a fresh Simulink.ConfigSet (`get_param(Simulink.ConfigSet, 'Version')`) in each
// release, read 2026-10-30 in that release itself. It is the config set's schema version, not a
// spelling of the release: R2025b's is R2025a's, and R2026b's has a third part.
const VERSION_OF_RELEASE = {
    R2023b: '23.1.0',
    R2024a: '24.0.0',
    R2024b: '24.1.0',
    R2025a: '25.0.0',
    R2025b: '25.0.0',
    R2026a: '26.0.0',
    R2026b: '26.1.1',
    R2027a: '27.0.0',
};
// For a release not in the table, or none: R2023b's, the oldest measured. R2023b and R2027a both
// load a set stamped with it as their own fresh one (R2027a does so for any Version from 10.0.0 up).
const FALLBACK_VERSION = '23.1.0';
/**
 * The Version MATLAB stamps on a config set saved by the release that wrote the dictionary holding
 * `section` (SlddNode.Release), as VERSION_OF_RELEASE states it, or FALLBACK_VERSION where the release
 * is not in it or is unknown (a hand-built file, a section of no dictionary).
 */
function versionFor(section) {
    const release = section?.parent?.Release;
    return typeof release === 'string' && Object.prototype.hasOwnProperty.call(VERSION_OF_RELEASE, release) ? VERSION_OF_RELEASE[release] : FALLBACK_VERSION;
}
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
    // With the Version MATLAB stamps on a config set it saves (versionFor): without one, R2027a loads
    // the set as one an old release saved, and gives PropagateSignalLabelsOutOfModel 'off' where its
    // own fresh set has 'on' (open-questions 15a). Nothing else is written: MATLAB fills in the rest.
    static createDefault(name, parent) { const rawVal = ConfigSetNode._defaultRawVal(CLASS_NAME, { Name: name || 'Configuration', Version: versionFor(parent) }); const props = ConfigSetNode._propsOf(rawVal); return new ConfigSetNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    static parse(rawVal, name, parent) { const props = ConfigSetNode._propsOf(rawVal); return new ConfigSetNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=ConfigSetNode.js.map