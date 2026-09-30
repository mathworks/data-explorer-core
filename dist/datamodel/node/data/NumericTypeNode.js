// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
const CLASS_NAME = 'Simulink.NumericType';
export default class NumericTypeNode extends SimulinkObjectNode {
    constructor(name, parent, props, serial) { super(name, parent, serial); this.Description = props.Description || ''; }
    get icon() { return this.isDerived ? 'typeNumeric' : 'wsNumeric'; }
    get className() { return CLASS_NAME; }
    // A NumericType has no scalar "value" — the Value column is empty and not
    // editable (the class name is surfaced in the Data Type column).
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    getProperties() { return [PropName, PropDataType, PropDescription]; }
    // PI layout is schema-driven (schema/classes/numericType.json).
    _serializedOverrides() { return this._gatedProps({ Description: this.Description }); }
    static get defaultName() { return 'NumericType'; }
    // Every value below is MEASURED from what MATLAB R2027a writes for `Simulink.NumericType`
    // with nothing set, in MATLAB's own alphabetical key order — not a guess at a sensible
    // default. This bag used to be EMPTY, which made a newly added NumericType the one entry in
    // a dictionary that declared no type at all: MATLAB fills the absent keys from its own
    // defaults on load, so the file opened without complaint and the divergence only showed as a
    // diff against a MATLAB-authored dictionary holding the same type.
    // Note the three storage-side spellings — SignednessBool, FixedExponent,
    // SlopeAdjustmentFactor — are what MATLAB SAVES; Signedness/FractionLength/Slope are derived
    // accessors it never writes, so they belong in neither this bag nor a file.
    static createDefault(name, parent) { const rawVal = NumericTypeNode._defaultRawVal(CLASS_NAME, { Bias: 0, DataScope: 'Auto', DataTypeMode: 'Double', DataTypeOverride: 'Inherit', Description: '', FixedExponent: 0, HeaderFile: '', IsAlias: false, SignednessBool: true, SlopeAdjustmentFactor: 1, WordLength: 64 }); const props = NumericTypeNode._propsOf(rawVal); return new NumericTypeNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    static parse(rawVal, name, parent) { const props = NumericTypeNode._propsOf(rawVal); return new NumericTypeNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=NumericTypeNode.js.map