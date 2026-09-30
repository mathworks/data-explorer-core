// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
const CLASS_NAME = 'Simulink.ConfigSetRef';
export default class ConfigSetRefNode extends SimulinkObjectNode {
    // The reference's whole content: the name of the config set it points AT. Stored and
    // saved from the start; it now also has a PI row, through the schema descriptor
    // `sourceName` (classes/configSetRef.json) rather than through a node atom — which is
    // sound only because the row is read-only. The descriptor hydrates
    // `serial._properties.SourceName`, so an EDIT would land on this field and leave the row
    // showing the untouched bag; if this ever becomes editable it has to move to an atom, for
    // the reason ValueTypeNode.getPILayout records at length.
    //
    // One fixed sourcePath is enough despite the era-varying spelling (`SourceName` in
    // R2021a+, `WSVarName` in R2018a and earlier) because the normalization happens upstream:
    // SlxParser reads either into ParsedConfigSet.sourceName and
    // ModelSectionNode.addConfigSetEntry writes it back as `props.SourceName`, so by the time
    // a node sees it the key is always spelled one way.
    SourceName: string;
    // See ConfigSetNode.Description — the same field for the same reason (the `description`
    // layout key resolves to an atom that reads the node field, not the schema sourcePath).
    Description: string;
    // The reference's own `Name` property, a view of `name` for exactly the reasons
    // ConfigSetNode.ConfigName is one — and the fix for a defect MATLAB demonstrated rather
    // than one reasoned about. MATLAB requires an entry in the config section to be named the
    // same as its value's `Name`, and it enforces that by SILENTLY RENAMING THE ENTRY: a
    // dictionary where the Add gallery had written an entry called `ConfigSetRef` came back
    // from MATLAB holding one called `Reference`, because we wrote no `Name` at all and a
    // default-constructed `Simulink.ConfigSetRef` calls itself `Reference`. The user added one
    // entry and reopened the file to find a differently named one.
    get ConfigName(): string { return this.name; }
    // See ConfigSetNode.active — set by the SLX parser only.
    active?: boolean;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.SourceName = (props.SourceName as string) || ''; this.Description = (props.Description as string) || ''; }
    get icon(): string { return this.active ? 'check_configurationReference' : 'configurationReference'; }
    get className(): string { return CLASS_NAME; }
    // A ConfigSetRef has no scalar "value" — the Value column is empty and not editable.
    get displayValue(): string { return ''; }
    get valueEditable(): boolean { return false; }
    getProperties(): PropClass[] { return [PropName, PropDataType, PropDescription]; }
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
    _serializedOverrides(): Record<string, unknown> { return Object.assign({ SourceName: this.SourceName, Name: this.ConfigName }, this._gatedProps({ Description: this.Description })); }
    // MATLAB's own name for a default-constructed `Simulink.ConfigSetRef`, measured from the
    // `Name` property of one (`<P Name="Name" Class="char">Reference</P>`) rather than derived
    // from the class name. It has to BE that string: the entry name and the value's `Name` are
    // one string as far as MATLAB is concerned, so any other default would be renamed on the
    // first save by a MATLAB that disagrees.
    static get defaultName(): string { return 'Reference'; }
    static createDefault(name: string, parent: BaseNode | null): ConfigSetRefNode { const rawVal = ConfigSetRefNode._defaultRawVal(CLASS_NAME, { SourceName: '', Name: name || 'Reference' }); const props = ConfigSetRefNode._propsOf(rawVal); return new ConfigSetRefNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ConfigSetRefNode { const props = ConfigSetRefNode._propsOf(rawVal); return new ConfigSetRefNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
}
