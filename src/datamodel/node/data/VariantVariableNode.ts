// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropSpecification from '../../prop/PropSpecification.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.VariantVariable';
export default class VariantVariableNode extends SimulinkObjectNode {
    Specification: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) { super(name, parent, serial); this.Specification = (props.Specification as string) || ''; }
    get icon(): string { return 'variant_wsParameters'; }
    get className(): string { return CLASS_NAME; }
    get displayValue(): string { return PropSpecification.format(this.Specification); }
    getProperties(): PropClass[] { return [PropName, PropSpecification, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/variantVariable.json).
    // UNGATED: the Specification is the variable's whole content. What is special here is the
    // BINARY path below, not this list.
    _serializedOverrides(): Record<string, unknown> { return { Specification: this.Specification }; }
    // The one class that overrides the binary path, to reach it through _mergeProps rather
    // than the plain assign SimulinkObjectNode uses, so an EMPTY Specification is not written
    // next to a saveobj envelope. A variant that serializes through saveobj keeps its
    // Specification INSIDE the envelope, where this node cannot see it, so
    // `(props.Specification as string) || ''` above is a default and not a value — writing it
    // back grew a `<P Name="Specification" Class="char"/>` MATLAB never wrote. The list it
    // merges is the same one the text path merges; only the merge differs.
    _getSerializedProperties(): Record<string, unknown> { return this._mergeProps(this._serializedOverrides()); }
    static get defaultName(): string { return 'VariantVariable'; }
    static createDefault(name: string, parent: BaseNode | null): VariantVariableNode { const rawVal = VariantVariableNode._defaultRawVal(CLASS_NAME, { Specification: '' }); const props = VariantVariableNode._propsOf(rawVal); return new VariantVariableNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): VariantVariableNode { const props = VariantVariableNode._propsOf(rawVal); return new VariantVariableNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
}
