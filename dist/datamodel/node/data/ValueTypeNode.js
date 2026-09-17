// Copyright 2026 The MathWorks, Inc.
import SimulinkObjectNode from '../SimulinkObjectNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
import PropKind from '../../prop/PropKind.js';
import PropClassAtom from '../../prop/PropClass.js';
import PropMin from '../../prop/PropMin.js';
import PropMax from '../../prop/PropMax.js';
import PropUnit from '../../prop/PropUnit.js';
import PropComplexity from '../../prop/PropComplexity.js';
import PropDimensions from '../../prop/PropDimensions.js';
import PropDimensionsMode from '../../prop/PropDimensionsMode.js';
const CLASS_NAME = 'Simulink.ValueType';
export default class ValueTypeNode extends SimulinkObjectNode {
    constructor(name, parent, props, serial) {
        super(name, parent, serial);
        this.Description = props.Description || '';
        this.DataType = props.DataType || 'double';
        this.Dimensions = props.Dimensions;
        // MATLAB's defaults for a ValueType that declares neither (probed on a live object):
        // 'real' and 'Fixed' — NOT the 'auto' a Simulink.Signal defaults to, which is why
        // schema/classes/valueType.json overrides the shared dimensionsMode descriptor's
        // default per class rather than changing it there. That JSON default feeds the TABLE
        // column (via schemaColumns) while this fallback feeds the Property Inspector, so both
        // have to say Fixed; valueTypeValueProps.test.ts asserts the two agree rather than
        // asserting each on its own. Display values only: the gates in _serializedOverrides
        // compare against the same literals, so a ValueType the file left silent saves silent.
        this.Complexity = props.Complexity || 'real';
        this.DimensionsMode = props.DimensionsMode || 'Fixed';
        // No `*_internal` alias reading, unlike BusElementNode: a probe wrote a ValueType with
        // every property non-default and the dictionary came back with flat keys only. That
        // aliasing is specific to bus elements in SLX XML, so looking for it here would be
        // inventing a spelling MATLAB does not use.
        this.Min = ValueTypeNode._normalizeMinMax(props.Min);
        this.Max = ValueTypeNode._normalizeMinMax(props.Max);
        // `Unit` FIRST, the opposite order from SignalNode/BusElementNode: MATLAB serializes a
        // Simulink.ValueType's unit as `Unit` and a Simulink.Parameter's or Signal's as
        // `DocUnits` (both measured off dictionaries MATLAB wrote). Both spellings are read so
        // a file written either way displays, but this class's own canonical key wins.
        this.Unit = props.Unit || props.DocUnits || '';
    }
    get icon() { return this.isDerived ? 'typeSignalUI' : 'wsValue'; }
    get className() { return CLASS_NAME; }
    // The DataType column shows the ValueType's underlying DataType property
    // (defaulting to 'double'), not the class name or the arch kind.
    get dataType() { return this.DataType; }
    // A ValueType has no scalar "value" — the Value column is empty and not
    // editable (the DataType is surfaced in the Data Type column).
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    getProperties() { return [PropName, PropDataType, PropDimensions, PropComplexity, PropDimensionsMode, PropMin, PropMax, PropUnit, PropDescription]; }
    // Override-driven rather than schema-driven, even though schema/classes/valueType.json
    // carries a layout with exactly these groups and this order — the JSON stays, because it
    // is what schemaColumns reads for the table's dimensionsMode column, and the two are
    // pinned against each other by test/valueTypeValueProps.test.ts.
    //
    // The reason is that `complexity` and `dimensionsMode` are NOT in schemaBridge's
    // ATOM_BY_KEY, so the schema route resolves them to the raw descriptor, whose readValue
    // hydrates from `serial._properties`. That is right for a read-only projection and wrong
    // the moment the property becomes an editable node field: an edit lands on the field, the
    // table re-reads the field and updates, and the PI keeps reading the untouched source bag
    // — the same value showing two different things in two panes. (trySetSchemaProperty
    // cannot close that gap: both descriptors are `editor: 'label'`, so it declines them and
    // nothing writes back into the bag.) Going through the atoms makes both panes read the
    // one field. BusElementNode is override-driven for the same reason.
    getPILayout() {
        return [
            { group: 'General', items: [PropName, PropDataType, PropKind, PropClassAtom] },
            { group: 'Value Properties', items: [
                    PropDimensions, PropComplexity,
                    PropMin, PropMax, PropUnit,
                    PropDimensionsMode, PropDescription,
                ] },
        ];
    }
    // Min/Max take the shared, MATLAB-verified "finite real double scalar" validator rather
    // than DataNode's generic numeric path, which wrongly accepts Inf/NaN; the two enums take
    // the shared enumeral check, which reads its legal set from the prop atom's readOptions so
    // the values accepted here and the values the dropdown offers cannot diverge.
    setProperty(propName, stringValue) {
        if (propName === 'Min' || propName === 'Max') {
            return this._setMinMax(propName, stringValue);
        }
        const notAnEnumeral = this._rejectUnknownEnumeral(propName, stringValue);
        if (notAnEnumeral) {
            return notAnEnumeral;
        }
        return super.setProperty(propName, stringValue);
    }
    // Keys in MATLAB's own order (alphabetical, as it writes them), so a ValueType that gains
    // a key still reads the way a MATLAB-written one does. Every gate here says the same
    // thing: write the key if the FILE carried it, or if the live value is something other
    // than what its absence means. DataType and the two enums spell that out against their
    // default rather than going through _gatedProps, because each default is truthy and the
    // shared truthiness test would write it back into every ValueType a dictionary never
    // declared one for; the enums also need `this.X &&` so a CLEAR (which stores '') reads as
    // absence and not as a value. Dimensions is deliberately absent: it is read-only, so
    // there is no live value to write over the bag both paths already merge the file's own
    // keys from.
    _serializedOverrides() {
        const sp = this.serial._properties;
        const unitKey = 'DocUnits' in sp ? 'DocUnits' : 'Unit';
        const overrides = {};
        if ('Complexity' in sp || (this.Complexity && this.Complexity !== 'real')) {
            overrides.Complexity = this.Complexity;
        }
        if ('DataType' in sp || this.DataType !== 'double') {
            overrides.DataType = this.DataType;
        }
        Object.assign(overrides, this._gatedProps({ Description: this.Description }));
        if ('DimensionsMode' in sp || (this.DimensionsMode && this.DimensionsMode !== 'Fixed')) {
            overrides.DimensionsMode = this.DimensionsMode;
        }
        // A cleared bound goes out as `[]` — MATLAB's own empty — and not as the value the
        // file held there, so emptying the Minimum box does not silently save the old number
        // back. See BusElementNode._applyElementOverrides for the full note.
        if ('Max' in sp || this.Max !== undefined) {
            overrides.Max = this.Max !== undefined ? this.Max : [];
        }
        if ('Min' in sp || this.Min !== undefined) {
            overrides.Min = this.Min !== undefined ? this.Min : [];
        }
        if (unitKey in sp || this.Unit) {
            overrides[unitKey] = this.Unit;
        }
        return overrides;
    }
    static get defaultName() { return 'ValueType'; }
    static createDefault(name, parent) { const rawVal = ValueTypeNode._defaultRawVal(CLASS_NAME); const props = ValueTypeNode._propsOf(rawVal); return new ValueTypeNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
    static parse(rawVal, name, parent) { const props = ValueTypeNode._propsOf(rawVal); return new ValueTypeNode(name, parent, props, { _rawVal: rawVal, _properties: props }); }
}
//# sourceMappingURL=ValueTypeNode.js.map