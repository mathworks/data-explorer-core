// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropMin from '../../prop/PropMin.js';
import PropMax from '../../prop/PropMax.js';
import PropUnit from '../../prop/PropUnit.js';
import PropDescription from '../../prop/PropDescription.js';
import { withSourceKeys } from './BaseBusNode.js';
import { schemaColumns } from '../schemaBridge.js';
const CLASS_NAME = 'Simulink.Signal';
export default class SignalNode extends DataNode {
    constructor(name, parent, props, serial) {
        super(name, parent, serial);
        // A Signal's declared data type, on the same terms as ParameterNode's:
        // 'auto' when the key is absent, because that is MATLAB's default and not a
        // missing value. Both `DataType_internal` and `DataType` are read for the
        // same reason BusNode reads both — a .sldd may store either spelling.
        // Display-only; _getSerializedProperties copies the on-disk bag, so this
        // default is never written back into a file that did not have it.
        const rawDataType = props.DataType_internal !== undefined ? props.DataType_internal : props.DataType;
        this.DataType = rawDataType || 'auto';
        this.Min = props.Min;
        this.Max = props.Max;
        this.Unit = props.DocUnits || props.Unit || '';
        this.Description = props.Description || '';
    }
    get icon() { return this.isDerived ? 'serviceInterfaces' : 'wsSignal'; }
    // Report the class the FILE actually holds — same reason as ParameterNode's:
    // mpt.Signal is parsed by this node and must still show as mpt.Signal in the
    // Class column, inheriting only the treatment. CLASS_NAME is the fallback for a
    // node with no parsed value behind it.
    get className() { const raw = this.serial._rawVal; return (raw && raw._array_class) || CLASS_NAME; }
    // A Signal has no scalar "value" — the Value column is empty and not editable.
    get displayValue() { return ''; }
    get valueEditable() { return false; }
    // Same argument as ParameterNode.dataType: a Signal's DataType IS a real data
    // type ('single', 'boolean', 'auto', an AliasType name), so it belongs in the
    // Data Type column. Without this the column and the PI row were blank for
    // every Signal in every channel even though all four carry the key.
    get dataType() { return this.DataType; }
    getProperties() { return [PropName, withSourceKeys(PropDataType, ['DataType', 'DataType_internal']), PropMin, PropMax, PropUnit, PropDescription, ...schemaColumns(this.className)]; }
    // PI layout is now declarative — see schema/classes/signal.json `layout`,
    // resolved by the inherited BaseNode.getPILayout via buildPILayout.
    setProperty(propName, stringValue) {
        if (propName === 'Min' || propName === 'Max') {
            return this._setMinMax(propName, stringValue);
        }
        return DataNode.prototype.setProperty.call(this, propName, stringValue);
    }
    _getSerializedProperties() {
        const sp = this.serial._properties;
        const unitKey = 'DocUnits' in sp ? 'DocUnits' : 'Unit';
        const props = Object.assign({}, sp);
        if ('Min' in sp || this.Min !== undefined) {
            props.Min = this.Min !== undefined ? this.Min : [];
        }
        if ('Max' in sp || this.Max !== undefined) {
            props.Max = this.Max !== undefined ? this.Max : [];
        }
        if (unitKey in sp || this.Unit) {
            props[unitKey] = this.Unit;
        }
        if ('Description' in sp || this.Description) {
            props.Description = this.Description;
        }
        return props;
    }
    serializeValue() {
        const sp = this.serial._properties;
        const unitKey = 'DocUnits' in sp ? 'DocUnits' : 'Unit';
        const overrides = {};
        if ('Min' in sp || this.Min !== undefined) {
            overrides.Min = this.Min;
        }
        if ('Max' in sp || this.Max !== undefined) {
            overrides.Max = this.Max;
        }
        if (unitKey in sp || this.Unit) {
            overrides[unitKey] = this.Unit;
        }
        if ('Description' in sp || this.Description) {
            overrides.Description = this.Description;
        }
        return this._serializeSimulinkObject(overrides);
    }
    static get defaultName() { return 'Signal'; }
    static createDefault(name, parent) {
        const rawVal = { _array_class: CLASS_NAME, _array_type: 'MATLABArray', _dimensions: [1, 1], _mw_element_type: 'MATLABArray', _elements: [{ _properties: { CoderInfo: { _object_class: 'Simulink.CoderInfo', _properties: { CSCPackageName: 'Simulink', CustomAttributes: { _object_class: 'SimulinkCSC.AttribClass_Simulink_Default', _properties: {} }, CustomStorageClass: 'Default', ParameterOrSignal: 'Signal', StorageClass: 'Auto' } }, LoggingInfo: { _object_class: 'Simulink.LoggingInfo', _properties: {} } } }] };
        const props = rawVal._elements[0]._properties;
        const serial = { _rawVal: rawVal, _properties: props };
        return new SignalNode(name, parent, props, serial);
    }
    static parse(rawVal, name, parent) {
        const elem = rawVal._elements && rawVal._elements[0];
        const props = ((elem && elem._properties) || {});
        const serial = { _rawVal: rawVal, _properties: props };
        return new SignalNode(name, parent, props, serial);
    }
}
//# sourceMappingURL=SignalNode.js.map