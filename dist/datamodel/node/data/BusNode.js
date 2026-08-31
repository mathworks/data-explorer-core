// Copyright 2026 The MathWorks, Inc.
import { BaseBusNode, BaseBusElementNode, PropName, PropDataType, PropDescription, PropKind, PropClassAtom, withSourceKeys } from './BaseBusNode.js';
import PropMin from '../../prop/PropMin.js';
import PropMax from '../../prop/PropMax.js';
import PropUnit from '../../prop/PropUnit.js';
import PropComplexity from '../../prop/PropComplexity.js';
import PropDimensions from '../../prop/PropDimensions.js';
import PropDimensionsMode from '../../prop/PropDimensionsMode.js';
const CLASS_NAME = 'Simulink.Bus';
export class BusElementNode extends BaseBusElementNode {
    constructor(name, parent, props, serial) {
        super(name, parent, props, serial);
        this._rawMin = props.Min_internal !== undefined ? props.Min_internal : props.Min;
        this._rawMax = props.Max_internal !== undefined ? props.Max_internal : props.Max;
        this.Min = BusElementNode._normalizeMinMax(this._rawMin);
        this.Max = BusElementNode._normalizeMinMax(this._rawMax);
        this.Unit = props.DocUnits || props.Unit || '';
        // The element's data type is stored in DataType_internal (falling back to
        // DataType); an unset type means the Simulink default of 'double'.
        const rawDataType = props.DataType_internal !== undefined ? props.DataType_internal : props.DataType;
        this.DataType = rawDataType || 'double';
        this.Complexity = props.Complexity || '';
        this.Dimensions = props.Dimensions;
        this.DimensionsMode = props.DimensionsMode || '';
    }
    static _normalizeMinMax(val) {
        if (Array.isArray(val) && val.length === 0) {
            return undefined;
        }
        return val;
    }
    // A StructType's elements use the struct-element icon; a derived
    // DataInterface's use the arch bus-element icon; a plain Design Data bus's
    // use the workspace bus-element icon.
    get icon() {
        const parent = this.parent;
        if (parent?.isStructType) {
            return 'typeStructElement';
        }
        return parent?.isDerived ? 'typeBusElement' : 'wsBusElement';
    }
    // The element's Class is its object class (Simulink.BusElement), not its
    // mapped data type — that belongs in the Data Type column below.
    get className() { return 'Simulink.BusElement'; }
    // A bus element's mapped data type is a real data type — show it in the column.
    get dataType() { return this.DataType; }
    getProperties() { return [PropName, PropDataType, PropDimensions, PropComplexity, PropDimensionsMode, PropMin, PropMax, PropUnit, PropDescription]; }
    // DataType/Min/Max read the `*_internal` aliased raw keys, so widen their
    // sourceKeys to both spellings — otherwise the alias leaks into "Other".
    getPILayout() {
        // A bus element shares its parent's className resolution path and reads
        // several props through `*_internal` aliases, so it stays override-driven
        // (not schema-keyed) — but opens with the common "General" identity group
        // like every other node, then a "Value Properties" group for its
        // value-semantics. DataType/Min/Max widen sourceKeys to both spellings so
        // the alias the node carries isn't leaked into "Other".
        return [
            { group: 'General', items: [
                    PropName,
                    withSourceKeys(PropDataType, ['DataType', 'DataType_internal']),
                    PropKind, PropClassAtom,
                ] },
            { group: 'Value Properties', items: [
                    PropDimensions, PropComplexity, PropDimensionsMode,
                    withSourceKeys(PropMin, ['Min', 'Min_internal']),
                    withSourceKeys(PropMax, ['Max', 'Max_internal']),
                    PropUnit, PropDescription,
                ] },
        ];
    }
    // Route Min/Max through the shared, MATLAB-verified "finite real double
    // scalar" validator (verified error: "Minimum on element 'x' must be a finite
    // real double scalar value"). Without this override the edit falls through to
    // DataNode's generic numeric path, which wrongly accepts Inf/NaN.
    setProperty(propName, stringValue) {
        if (propName === 'Min' || propName === 'Max') {
            return this._setMinMax(propName, stringValue);
        }
        return super.setProperty(propName, stringValue);
    }
    _applyElementOverrides(props) {
        const sp = this.serial._properties;
        const minKey = 'Min_internal' in sp ? 'Min_internal' : 'Min';
        const maxKey = 'Max_internal' in sp ? 'Max_internal' : 'Max';
        const unitKey = 'DocUnits' in sp ? 'DocUnits' : 'Unit';
        const dtKey = 'DataType_internal' in sp ? 'DataType_internal' : 'DataType';
        if (minKey in sp || this.Min !== undefined) {
            props[minKey] = this.Min !== undefined ? this.Min : this._rawMin;
        }
        if (maxKey in sp || this.Max !== undefined) {
            props[maxKey] = this.Max !== undefined ? this.Max : this._rawMax;
        }
        if (unitKey in sp || this.Unit) {
            props[unitKey] = this.Unit;
        }
        // Only write the data type back when the source had it or it differs from
        // the implicit 'double' default, so untyped elements stay untouched.
        if (dtKey in sp || this.DataType !== 'double') {
            props[dtKey] = this.DataType;
        }
        if ('Description' in sp || this.Description) {
            props.Description = this.Description;
        }
    }
}
export class BusNode extends BaseBusNode {
    constructor() {
        super(...arguments);
        // A derived arch Simulink.Bus is a DataInterface by default, but the
        // systemcomposer catalog may classify it as a StructType (set at parse time).
        this.isStructType = false;
    }
    get icon() {
        if (this.isStructType) {
            return 'typeStruct';
        }
        return super.icon;
    }
    get className() { return CLASS_NAME; }
    _createElementNode(name, props, serial) { return new BusElementNode(name, this, props, serial); }
    static { this.ELEMENT_CLASS_NAME = 'Simulink.BusElement'; }
    static get defaultName() { return 'Bus'; }
    static createDefault(name, parent) { return BaseBusNode._createDefaultBus(name, parent, BusNode, CLASS_NAME); }
    static parse(rawVal, name, parent) { return BaseBusNode._parseElements(rawVal, name, parent, BusNode, BusElementNode); }
}
export default { BusNode, BusElementNode };
//# sourceMappingURL=BusNode.js.map