// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
const CLASS_NAME = 'Simulink.ValueType';
export default class ValueTypeNode extends SimulinkObjectNode {
    Description: string;
    DataType: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.Description = (props.Description as string) || ''; this.DataType = (props.DataType as string) || 'double'; }
    get icon(): string { return this.isDerived ? 'typeSignalUI' : 'wsValue'; }
    get className(): string { return CLASS_NAME; }
    // The DataType column shows the ValueType's underlying DataType property
    // (defaulting to 'double'), not the class name or the arch kind.
    get dataType(): string { return this.DataType; }
    // A ValueType has no scalar "value" — the Value column is empty and not
    // editable (the DataType is surfaced in the Data Type column).
    get displayValue(): string { return ''; }
    get valueEditable(): boolean { return false; }
    getProperties(): PropClass[] { return [PropName, PropDataType, PropDescription]; }
    // PI layout is schema-driven (schema/classes/valueType.json).
    // DataType spells its own gate rather than going through _gatedProps: 'double' is what an
    // ABSENT DataType means, and it is also truthy, so the shared truthiness test would write
    // that default back into every ValueType a dictionary never declared one for. Compared
    // against the default instead, only a type the file stated or the model changed is saved.
    _serializedOverrides(): Record<string, unknown> { const sp = this.serial._properties as Record<string, unknown>; const overrides: Record<string, unknown> = {}; if ('DataType' in sp || this.DataType !== 'double') { overrides.DataType = this.DataType; } return Object.assign(overrides, this._gatedProps({ Description: this.Description })); }
    static get defaultName(): string { return 'ValueType'; }
    static createDefault(name: string, parent: BaseNode | null): ValueTypeNode { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: {} }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new ValueTypeNode(name, parent, props as unknown as Record<string, unknown>, serial as unknown as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): ValueTypeNode { const elem = rawVal._elements && (rawVal._elements as unknown[])[0]; const props = ((elem && (elem as Record<string, unknown>)._properties) || {}) as Record<string, unknown>; const serial = { _rawVal: rawVal, _properties: props }; return new ValueTypeNode(name, parent, props, serial as Record<string, unknown>); }
}
