// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
import { OBJECT_ICON } from '../icons.js';
const CLASS_NAME = 'CustomObject';
export default class CustomObjectNode extends SimulinkObjectNode {
    Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.Description = (props.Description as string) || ''; }
    get icon(): string { return OBJECT_ICON; }
    get className(): string { return CLASS_NAME; }
    get displayValue(): string { return '<1x1 ' + CLASS_NAME + '>'; }
    getProperties(): PropClass[] { return [PropName, PropValue, PropDataType, PropDescription]; }
    // PI layout: schema-driven "General" group (classes/customObject.json).
    _serializedOverrides(): Record<string, unknown> { return this._gatedProps({ Description: this.Description }); }
    static get defaultName(): string { return 'CustomObject'; }
    static createDefault(name: string, parent: BaseNode | null): CustomObjectNode { const rawVal = CustomObjectNode._defaultRawVal(CLASS_NAME); const props = CustomObjectNode._propsOf(rawVal); return new CustomObjectNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): CustomObjectNode { const props = CustomObjectNode._propsOf(rawVal); return new CustomObjectNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
}
