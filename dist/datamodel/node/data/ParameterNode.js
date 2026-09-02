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
        this._valueNode = null;
        // 'auto' when the key is absent, because that is MATLAB's default and not a
        // missing value: a text sldd omits DataType for a default-typed Parameter
        // while a binary one writes DataType="auto", so reading absence literally
        // showed the same parameter as blank in one format and 'auto' in the other.
        // Display-only — _getSerializedProperties copies the on-disk properties, so
        // nothing writes this default back into a file that did not have it.
        this.DataType = props.DataType || 'auto';
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
    // A Parameter's declared data type IS a real data type ('int16', 'boolean',
    // 'auto', an AliasType/enum/typedef name), so it belongs in the Data Type
    // column — DataNode returns '' there because most object classes have none.
    // Without this the column and the PI label were blank for every Parameter in
    // every dictionary, and once scalar values started showing inline (no Value
    // child row to carry it) the type had nowhere left to appear.
    get dataType() {
        return this.DataType;
    }
    get displayValue() {
        if (this._valueNode) {
            return this._valueNode.displayValue;
        }
        return PropValue.format(this.Value);
    }
    // Model `rawValue` as this Parameter's Value, giving it a tree row only when
    // the resulting node has children — array elements or struct fields, i.e. the
    // only cases where expanding the row reveals anything. A SCALAR of any class
    // is already shown whole in this Parameter's own Value column, so a row for it
    // would be an expander onto a single restatement of the cell above it.
    //
    // The on-disk spelling must not decide this. A plain double scalar is written
    // as a bare number, but int16(500), Inf, and 3+4i are all written as
    // { _type, _value } wrapper objects — and gating on "is the raw value an
    // object" (what this replaced) therefore gave a row to some scalars and not
    // others, and gave the same Inf parameter a row in a JSON dictionary but not
    // in a binary one, where our own reader hands back a bare number.
    //
    // Holding the node while hiding it (rather than not building it) is what keeps
    // the wrapper alive: it is the node's serializeValue that writes int16/cdata
    // back out, so a scalar that displayed inline off a bare `this.Value` would
    // save as an untyped double — silent retyping of the user's data.
    //
    // Deliberately scoped to Simulink.Parameter: every other class, including a
    // custom object that happens to have a Value property, keeps the general
    // expansion rule and shows a row for whatever its value parses into.
    _adoptValueNode(rawValue) {
        const valueNode = NodeRegistry.parseValue(rawValue, 'Value', this);
        this.children = [];
        this._valueNode = valueNode;
        if (valueNode.children.length > 0) {
            this.addChild(valueNode);
        }
    }
    // Re-decide the Value row after an element or field was added to / removed from
    // the value node — the same rule _adoptValueNode applies at parse time, now that
    // an edit has moved the value across the line. Deleting [1 2] down to one element
    // collapses the value node to the scalar 1, and without this the Parameter kept a
    // childless Value row (an expander onto nothing) until the file was reloaded.
    childStructureChanged(child) {
        if (child !== this._valueNode) {
            return;
        }
        if (child.children.length > 0) {
            if (this.children.length === 0) {
                this.addChild(child);
            }
            return;
        }
        // Not removeChild: that nulls the child's parent, and this node lives on as
        // _valueNode — it still formats and serializes the value, so it has to keep
        // pointing back at this Parameter.
        this.children = [];
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
                this._adoptValueNode(rawValue);
                this.Value = parsed.value;
                this._markModified();
                return true;
            }
            if (parsed.type === 'complex') {
                this._adoptValueNode({ _type: 'cdata', _value: parsed.value });
                this.Value = parsed.value;
                this._markModified();
                return true;
            }
            this.children = [];
            this._valueNode = null;
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
        if (this._valueNode) {
            innerValue = this._valueNode.serializeValue();
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
            node._adoptValueNode(props.Value);
        }
        return node;
    }
}
//# sourceMappingURL=ParameterNode.js.map