// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
const CLASS_NAME = 'Simulink.ConfigSet';
export default class ConfigSetNode extends SimulinkObjectNode {
    // A real top-level property of a MATLAB config set, and the ONLY one of the four its
    // Property Inspector shows that a file reliably carries — see configSetSchemaProps.test.ts
    // for why StartTime/StopTime/SystemTargetFile/SourceLocation are deliberately unmodeled.
    // The field is not optional decoration: `description` is a key in schemaBridge's
    // ATOM_BY_KEY, so the layout row reads THIS field rather than the schema descriptor's
    // sourcePath. Until it existed the row rendered blank and, because toPIObject adds every
    // layout key to shownKeys, the raw Description was suppressed from the "Other" group as
    // well — a Description in the file, unreachable in the UI.
    Description: string;
    // The config set's own Name property. In a .sldd the entry name and this
    // property are the same string — both parse paths build the node with
    // _properties.Name equal to the entry name — so this is a view of `name`
    // rather than a second copy. It used to be an independently stored field,
    // which let the two drift: renaming the entry moved `name` but left
    // ConfigName stale, and since serializeValue writes ConfigName, the saved
    // file kept the OLD name and the entry reverted on reopen.
    get ConfigName(): string { return this.name; }
    // Whether this is the model's active configuration. Set only by the SLX
    // parser (which knows the active state); undefined on the SLDD path, where
    // it is treated as inactive — the SLDD icon is unchanged.
    active?: boolean;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.Description = (props.Description as string) || ''; }
    get icon(): string { return this.active ? 'check_settings' : 'settings'; }
    get className(): string { return CLASS_NAME; }
    // A ConfigSet has no scalar "value" — the Value column is empty and not editable.
    get displayValue(): string { return ''; }
    get valueEditable(): boolean { return false; }
    getProperties(): PropClass[] { return [PropName, PropDataType, PropDescription]; }
    // PI layout: schema-driven "General" group (classes/configSet.json).
    // Name is UNGATED: a config set MATLAB can load has to be able to say what it is called,
    // so the key is written whatever the file carried — and because it is a view of `name`, a
    // renamed entry saves under the new name on both paths. Description is GATED, on the same
    // terms as every other Description in this cluster: a config set whose file never carried
    // one must not gain an empty one on save, or opening a dictionary and saving it with no
    // edits produces a diff in source control. Order follows AliasTypeNode — the identity key
    // the class owns, then the gated description.
    _serializedOverrides(): Record<string, unknown> { return Object.assign({ Name: this.ConfigName }, this._gatedProps({ Description: this.Description })); }
    static get defaultName(): string { return 'Configuration'; }
    static createDefault(name: string, parent: BaseNode | null): ConfigSetNode { const rawVal = ConfigSetNode._defaultRawVal(CLASS_NAME, { Name: name || 'Configuration' }); const props = ConfigSetNode._propsOf(rawVal); return new ConfigSetNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ConfigSetNode { const props = ConfigSetNode._propsOf(rawVal); return new ConfigSetNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
}
