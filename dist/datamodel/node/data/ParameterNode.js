// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import * as NodeRegistry from '../NodeRegistry.js';
import { formatMatlabNum } from '../../parser/XmlUtils.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropDataType from '../../prop/PropDataType.js';
import PropMin from '../../prop/PropMin.js';
import PropMax from '../../prop/PropMax.js';
import PropUnit from '../../prop/PropUnit.js';
import PropDescription from '../../prop/PropDescription.js';
import MatlabValueParser from '../../parser/MatlabValueParser.js';
import { schemaColumns } from '../schemaBridge.js';
const CLASS_NAME = 'Simulink.Parameter';
export default class ParameterNode extends DataNode {
    constructor(name, parent, props, serial) {
        super(name, parent, serial);
        this.Value = props.Value;
        this._rawMin = props.Min;
        this._rawMax = props.Max;
        this.Min = ParameterNode._normalizeMinMax(props.Min);
        this.Max = ParameterNode._normalizeMinMax(props.Max);
        this.Unit = props.DocUnits || props.Unit || '';
        this.Description = props.Description || '';
    }
    get icon() {
        return this.isDerived ? 'typeConstant' : 'wsParameters';
    }
    get className() {
        return CLASS_NAME;
    }
    get displayValue() {
        if (this.children.length > 0) {
            return this.children[0].displayValue;
        }
        return PropValue.format(this.Value);
    }
    getProperties() {
        return [PropName, PropValue, PropDataType, PropMin, PropMax, PropUnit, PropDescription, ...schemaColumns(this.className)];
    }
    // PI layout is now declarative — see schema/classes/parameter.json `layout`,
    // resolved by the inherited BaseNode.getPILayout via buildPILayout.
    setProperty(propName, stringValue) {
        if (propName === 'Value') {
            const parsed = MatlabValueParser.parse(stringValue);
            if (!parsed) {
                return { error: true, reason: 'Invalid MATLAB expression', invalidValue: stringValue, validValue: this.displayValue };
            }
            // MATLAB rejects cell arrays as Parameter.Value (R2027a probe).
            if (parsed.type === 'cell') {
                return {
                    error: true,
                    reason: 'Invalid value specified for parameter. Value must be a numeric array, fi object, enumerated value, structure whose fields contain valid values, string scalar, or an expression.',
                    invalidValue: stringValue,
                    validValue: this.displayValue,
                };
            }
            if ((parsed.type === 'double' && Array.isArray(parsed.value)) || parsed.type === 'string-array') {
                let rawValue;
                if (parsed.type === 'string-array') {
                    rawValue = { _array_type: 'String', _dimensions: parsed.dims, _elements: parsed.value };
                }
                else if (parsed.dims && parsed.dims[0] > 1) {
                    const rows = parsed.dims[0];
                    const cols = parsed.dims[1];
                    const rowStrs = [];
                    for (let r = 0; r < rows; r++) {
                        const vals = [];
                        // formatMatlabNum, not String: the parser accepts 'Inf'/'NaN' and
                        // hands back the real non-finite numbers, whose JavaScript spelling
                        // ('Infinity') is not a MATLAB literal and is one our own parser
                        // rejects — so String() here would make the value uneditable.
                        for (let c = 0; c < cols; c++) {
                            vals.push(formatMatlabNum(parsed.value[r * cols + c]));
                        }
                        rowStrs.push('[' + vals.join(', ') + ']');
                    }
                    rawValue = { _type: 'double', _value: 'Matrix(' + rows + ',' + cols + ')\n' + rowStrs.join('\n') };
                }
                else {
                    rawValue = parsed.value;
                }
                const childNode = NodeRegistry.parseValue(rawValue, 'Value', this);
                this.children = [];
                this.addChild(childNode);
                this.Value = parsed.value;
                this._markModified();
                return true;
            }
            if (parsed.type === 'complex') {
                const rawValue = { _type: 'cdata', _value: parsed.value };
                const childNode = NodeRegistry.parseValue(rawValue, 'Value', this);
                this.children = [];
                this.addChild(childNode);
                this.Value = parsed.value;
                this._markModified();
                return true;
            }
            this.children = [];
            this.Value = parsed.value;
            this._markModified();
            return true;
        }
        if (propName === 'Min' || propName === 'Max') {
            return this._setMinMax(propName, stringValue);
        }
        return DataNode.prototype.setProperty.call(this, propName, stringValue);
    }
    _getSerializedProperties() {
        let innerValue;
        if (this.children.length > 0) {
            innerValue = this.children[0].serializeValue();
        }
        else {
            innerValue = this.Value;
        }
        const props = Object.assign({}, this.serial._properties);
        if (innerValue !== undefined) {
            props.Value = innerValue;
        }
        if ('Min' in this.serial._properties || this.Min !== undefined) {
            props.Min = this.Min !== undefined ? this.Min : this._rawMin;
        }
        if ('Max' in this.serial._properties || this.Max !== undefined) {
            props.Max = this.Max !== undefined ? this.Max : this._rawMax;
        }
        if ('DocUnits' in this.serial._properties || this.Unit) {
            props.DocUnits = this.Unit;
        }
        if ('Description' in this.serial._properties || this.Description) {
            props.Description = this.Description;
        }
        return props;
    }
    serializeValue() {
        const props = this._getSerializedProperties();
        const result = Object.assign({}, this.serial._rawVal);
        result._elements = [Object.assign({}, result._elements[0], { _properties: props })];
        return result;
    }
    serializeXml(tagName, attrs, indent) {
        return this._serializeSimulinkObjectXml(tagName, attrs, indent);
    }
    static get defaultName() { return 'Param'; }
    static createDefault(name, parent) {
        const rawVal = {
            _array_class: CLASS_NAME,
            _array_type: 'MATLABArray',
            _dimensions: [1, 1],
            _mw_element_type: 'MATLABArray',
            _elements: [{ _properties: { CoderInfo: { _object_class: 'Simulink.CoderInfo', _properties: { CSCPackageName: 'Simulink', CustomAttributes: { _object_class: 'SimulinkCSC.AttribClass_Simulink_Default', _properties: {} }, CustomStorageClass: 'Default', ParameterOrSignal: 'Parameter', StorageClass: 'Auto' } }, Complexity: 'real', Dimensions: -1, Value: 0 } }]
        };
        const props = rawVal._elements[0]._properties;
        const serial = { _rawVal: rawVal, _properties: props };
        return new ParameterNode(name, parent, props, serial);
    }
    static _normalizeMinMax(val) {
        if (Array.isArray(val) && val.length === 0) {
            return undefined;
        }
        return val;
    }
    static parse(rawVal, name, parent) {
        const elem = rawVal._elements && rawVal._elements[0];
        const props = ((elem && elem._properties) || {});
        const serial = { _rawVal: rawVal, _properties: props };
        const node = new ParameterNode(name, parent, props, serial);
        if (props.Value && typeof props.Value === 'object' && !(Array.isArray(props.Value) && props.Value.length === 0)) {
            const childNode = NodeRegistry.parseValue(props.Value, 'Value', node);
            node.addChild(childNode);
        }
        return node;
    }
}
//# sourceMappingURL=ParameterNode.js.map