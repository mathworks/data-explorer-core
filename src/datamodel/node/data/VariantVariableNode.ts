// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropSpecification from '../../prop/PropSpecification.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.VariantVariable';
export default class VariantVariableNode extends DataNode {
    Specification: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.Specification = (props.Specification as string) || ''; }
    get icon(): string { return 'variant_wsParameters'; }
    get className(): string { return CLASS_NAME; }
    get displayValue(): string { return PropSpecification.format(this.Specification); }
    getProperties(): PropClass[] { return [PropName, PropSpecification, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/variantVariable.json).
    // Through _mergeProps rather than a plain assign so an EMPTY Specification is not
    // written next to a saveobj envelope. A variant that serializes through saveobj keeps
    // its Specification INSIDE the envelope, where this node cannot see it, so
    // `(props.Specification as string) || ''` above is a default and not a value —
    // writing it back grew a `<P Name="Specification" Class="char"/>` MATLAB never wrote.
    _getSerializedProperties(): Record<string, unknown> { return this._mergeProps({ Specification: this.Specification }); }
    serializeValue(): unknown { return this._serializeSimulinkObject({ Specification: this.Specification }); }
    static get defaultName(): string { return 'VariantVariable'; }
    static createDefault(name: string, parent: BaseNode | null): VariantVariableNode { const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { Specification: '' } }] }; const props = rawVal._elements[0]._properties; const serial = { _rawVal: rawVal, _properties: props }; return new VariantVariableNode(name, parent, props as unknown as Record<string, unknown>, serial as unknown as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): VariantVariableNode { const elem = rawVal._elements && (rawVal._elements as unknown[])[0]; const props = ((elem && (elem as Record<string, unknown>)._properties) || {}) as Record<string, unknown>; const serial = { _rawVal: rawVal, _properties: props }; return new VariantVariableNode(name, parent, props, serial as Record<string, unknown>); }
}
