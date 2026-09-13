// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
const CLASS_NAME = 'Simulink.NumericType';
export default class NumericTypeNode extends SimulinkObjectNode {
    Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.Description = (props.Description as string) || ''; }
    get icon(): string { return this.isDerived ? 'typeNumeric' : 'wsNumeric'; }
    get className(): string { return CLASS_NAME; }
    // A NumericType has no scalar "value" — the Value column is empty and not
    // editable (the class name is surfaced in the Data Type column).
    get displayValue(): string { return ''; }
    get valueEditable(): boolean { return false; }
    getProperties(): PropClass[] { return [PropName, PropDataType, PropDescription]; }
    // PI layout is schema-driven (schema/classes/numericType.json).
    _serializedOverrides(): Record<string, unknown> { return this._gatedProps({ Description: this.Description }); }
    static get defaultName(): string { return 'NumericType'; }
    static createDefault(name: string, parent: BaseNode | null): NumericTypeNode { const rawVal = NumericTypeNode._defaultRawVal(CLASS_NAME); const props = NumericTypeNode._propsOf(rawVal); return new NumericTypeNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): NumericTypeNode { const props = NumericTypeNode._propsOf(rawVal); return new NumericTypeNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
}
