// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
const CLASS_NAME = 'Simulink.LookupTable';
export default class LookupTableNode extends SimulinkObjectNode {
    Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.Description = (props.Description as string) || ''; }
    get icon(): string { return 'wsLookup'; }
    get className(): string { return CLASS_NAME; }
    // A LookupTable has no scalar "value" — the Value column is empty and not editable.
    get displayValue(): string { return ''; }
    get valueEditable(): boolean { return false; }
    getProperties(): PropClass[] { return [PropName, PropDataType, PropDescription]; }
    // PI layout: schema-driven "General" group (classes/lookupTable.json).
    _serializedOverrides(): Record<string, unknown> { return this._gatedProps({ Description: this.Description }); }
    static get defaultName(): string { return 'LookupTable'; }
    static createDefault(name: string, parent: BaseNode | null): LookupTableNode { const rawVal = LookupTableNode._defaultRawVal(CLASS_NAME); const props = LookupTableNode._propsOf(rawVal); return new LookupTableNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): LookupTableNode { const props = LookupTableNode._propsOf(rawVal); return new LookupTableNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
}
