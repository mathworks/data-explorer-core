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
    static createDefault(name: string, parent: BaseNode | null): CustomObjectNode { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: {} }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new CustomObjectNode(name, parent, props as unknown as Record<string, unknown>, serial as unknown as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): CustomObjectNode { const elem = rawVal._elements && (rawVal._elements as unknown[])[0]; const props = ((elem && (elem as Record<string, unknown>)._properties) || {}) as Record<string, unknown>; const serial = { _rawVal: rawVal, _properties: props }; return new CustomObjectNode(name, parent, props, serial as Record<string, unknown>); }
}
