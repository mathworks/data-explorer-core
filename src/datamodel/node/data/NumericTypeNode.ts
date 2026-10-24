// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
import { NUMERIC_TYPE_DEFAULTS, numericTypeSaved } from '../mcosShown.js';
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
    // And the SignednessBool, FixedExponent and SlopeAdjustmentFactor MATLAB saves, where the bag holds
    // the Signedness, FractionLength and Slope it shows of them otherwise: a MAT-file's node's, whose
    // edits set the shown three and whose save writes the saved ones from them (mcosShown.numericTypeSaved).
    // A copy is this bag, and carried the saved three from before the edit.
    _serializedOverrides(): Record<string, unknown> { return { ...this._gatedProps({ Description: this.Description }), ...numericTypeSaved(this.serial._properties as Record<string, unknown>) }; }
    static get defaultName(): string { return 'NumericType'; }
    // Every value of NUMERIC_TYPE_DEFAULTS (mcosShown) is MEASURED from what MATLAB R2027a writes for `Simulink.NumericType`
    // with nothing set, in MATLAB's own alphabetical key order — not a guess at a sensible
    // default. This bag used to be EMPTY, which made a newly added NumericType the one entry in
    // a dictionary that declared no type at all: MATLAB fills the absent keys from its own
    // defaults on load, so the file opened without complaint and the divergence only showed as a
    // diff against a MATLAB-authored dictionary holding the same type.
    // Note the three storage-side spellings — SignednessBool, FixedExponent,
    // SlopeAdjustmentFactor — are what MATLAB SAVES; Signedness/FractionLength/Slope are derived
    // accessors it never writes, so they belong in neither this bag nor a file.
    static createDefault(name: string, parent: BaseNode | null): NumericTypeNode { const rawVal = NumericTypeNode._defaultRawVal(CLASS_NAME, { ...NUMERIC_TYPE_DEFAULTS }); const props = NumericTypeNode._propsOf(rawVal); return new NumericTypeNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
    static parse(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): NumericTypeNode { const props = NumericTypeNode._propsOf(rawVal); return new NumericTypeNode(name, parent, props, { _rawVal: rawVal, _properties: props } as Record<string, unknown>); }
}
