// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropSpecification from '../../prop/PropSpecification.js';
import PropDataType from '../../prop/PropDataType.js';
const CLASS_NAME = 'Simulink.VariantVariable';
export default class VariantVariableNode extends SimulinkObjectNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.Specification = props.Specification || ''; }
    get icon() { return 'variant_wsParameters'; }
    get className() { return CLASS_NAME; }
    get displayValue() { return PropSpecification.format(this.Specification); }
    getProperties() { return [PropName, PropSpecification, PropDataType]; }
    // PI layout: schema-driven "General" group (classes/variantVariable.json).
    // UNGATED: the Specification is the variable's whole content. What is special here is the
    // BINARY path below, not this list.
    _serializedOverrides() { return { Specification: this.Specification }; }
    // This class used to override `_getSerializedProperties` to route the binary path through
    // `_mergeProps`, so an EMPTY Specification was not written next to a saveobj envelope: a
    // variant that serializes through saveobj keeps its Specification INSIDE the envelope,
    // where this node cannot see it, so `(props.Specification as string) || ''` above is a
    // default and not a value, and writing it back grew a `<P Name="Specification"
    // Class="char"/>` MATLAB never wrote. The override is gone because SimulinkObjectNode now
    // merges that way for EVERY class — it had to, since VariantBank, VariantBankCoderInfo and
    // VariantConfigurations were growing the same invented property in the binary file for
    // want of the same override (see the class header there).
    static get defaultName() { return 'VariantVariable'; }
    // A saveobj envelope, not a property bag — `{ Specification: '' }` here used to SEGFAULT
    // MATLAB, which destructures this class through a custom load hook and dereferences the
    // NULL `mxGetField` returns for a struct that is not there. Fields, their order and their
    // default values are all measured from a MATLAB-written dictionary; `Choices` is an empty
    // 0x1 struct of Condition/Value rather than `[]`, because loadobj expects a struct there.
    static createDefault(name, parent) { const rawVal = VariantVariableNode._defaultCustomSaveRawVal(CLASS_NAME, ['Choices', 'Specification', 'Bank'], { Choices: VariantVariableNode._emptyStruct(['Condition', 'Value']), Specification: [], Bank: [] }); const props = VariantVariableNode._propsOf(rawVal); return new VariantVariableNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    static parse(rawVal, name, parent) { const props = VariantVariableNode._propsOf(rawVal); return new VariantVariableNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=VariantVariableNode.js.map