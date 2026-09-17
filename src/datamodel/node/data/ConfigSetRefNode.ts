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
    // a half-built entry carries. Description is GATED — see ConfigSetNode._serializedOverrides.
    _serializedOverrides(): Record<string, unknown> { return Object.assign({ SourceName: this.SourceName }, this._gatedProps({ Description: this.Description })); }
    static get defaultName(): string { return 'ConfigSetRef'; }
    static createDefault(name: string, parent: BaseNode | null): ConfigSetRefNode { const rawVal = ConfigSetRefNode._defaultRawVal(CLASS_NAME, { SourceName: '' }); const props = ConfigSetRefNode._propsOf(rawVal); return new ConfigSetRefNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ConfigSetRefNode { const props = ConfigSetRefNode._propsOf(rawVal); return new ConfigSetRefNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
}
