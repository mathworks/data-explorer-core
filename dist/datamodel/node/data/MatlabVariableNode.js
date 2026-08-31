// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import { matlabVariableKind } from '../../kindMap.js';
import * as NodeRegistry from '../NodeRegistry.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
import PropKind from '../../prop/PropKind.js';
import PropClassAtom from '../../prop/PropClass.js';
import MatlabValueParser from '../../parser/MatlabValueParser.js';
import { NOT_AVAILABLE } from '../../parser/McosParser.js';
import { escapeXml, formatDoubleXml, formatNumericXml, formatComplexXml, transposeToColumnMajor, pad as xmlPad, } from '../../parser/XmlUtils.js';
const MCOS_ICON_MAP = {
    'Simulink.Parameter': 'wsParameters',
    'Simulink.Signal': 'wsSignal',
    'Simulink.Bus': 'wsBus',
    'Simulink.AliasType': 'wsAlias',
    'Simulink.NumericType': 'wsNumeric',
    'Simulink.ConfigSet': 'configurationReference',
    'Simulink.ConfigSetRef': 'configurationReference',
    'Simulink.Variant': 'wsVariant',
    'Simulink.VariantVariable': 'wsVariant',
    'Simulink.VariantControl': 'wsVariant',
    'Simulink.VariantBank': 'wsParameters_bank',
    'Simulink.VariantBankCoderInfo': 'wsParameters_bankCoderInfo',
    'Simulink.LookupTable': 'wsLookup',
    'Simulink.Breakpoint': 'wsSimulinkBreakpoint',
    'Simulink.ValueType': 'wsValue',
};
function formatNum(n) {
    return String(n);
}
function decodeCdata(str) {
    const bits = [];
    for (let i = 0; i < str.length; i++) {
        const v = str.charCodeAt(i) - 0x20;
        for (let b = 5; b >= 0; b--) {
            bits.push((v >> b) & 1);
        }
    }
    const bytes = new Uint8Array(Math.floor(bits.length / 8));
    for (let i = 0; i < bytes.length; i++) {
        let byte = 0;
        for (let b = 0; b < 8; b++) {
            byte = (byte << 1) | bits[i * 8 + b];
        }
        bytes[i] = byte;
    }
    const dv = new DataView(bytes.buffer);
    const rows = dv.getInt32(40, true);
    const cols = dv.getInt32(44, true);
    let offset = 48;
    const nameWord = dv.getUint32(offset, true);
    const nameHigh = (nameWord >> 16) & 0xffff;
    if (nameHigh > 0 && nameHigh <= 4) {
        offset += 8;
    }
    else {
        const nSize = dv.getUint32(offset + 4, true);
        offset += 8 + Math.ceil(nSize / 8) * 8;
    }
    offset += 8;
    const numElements = rows * cols;
    const realParts = [];
    for (let i = 0; i < numElements; i++) {
        realParts.push(dv.getFloat64(offset + i * 8, true));
    }
    offset += Math.ceil((numElements * 8) / 8) * 8;
    offset += 8;
    const imagParts = [];
    for (let i = 0; i < numElements; i++) {
        imagParts.push(dv.getFloat64(offset + i * 8, true));
    }
    return { rows, cols, realParts, imagParts };
}
function formatComplex(real, imag) {
    const r = String(real);
    const im = String(imag);
    if (imag >= 0) {
        return r + '+' + im + 'i';
    }
    return r + im + 'i';
}
function formatMatrix(rows, cols, elements) {
    if (elements.length === 0) {
        return '[]';
    }
    const rowStrs = [];
    for (let r = 0; r < rows; r++) {
        const vals = [];
        for (let c = 0; c < cols; c++) {
            const val = elements[r * cols + c];
            vals.push(val !== undefined ? formatNum(val) : '?');
        }
        rowStrs.push(vals.join(' '));
    }
    return '[' + rowStrs.join('; ') + ']';
}
function parseMatrixValue(raw) {
    const lines = raw._value.split('\n');
    const header = lines[0];
    const dimsMatch = header.match(/^Matrix\((\d+),(\d+)\)$/);
    if (!dimsMatch) {
        return null;
    }
    const rows = parseInt(dimsMatch[1], 10);
    const cols = parseInt(dimsMatch[2], 10);
    const body = lines.slice(1).join('');
    const numbers = [];
    const numMatches = body.match(/-?[\d.]+(?:[eE][+-]?\d+)?/g);
    if (numMatches) {
        numMatches.forEach(function (s) {
            numbers.push(parseFloat(s));
        });
    }
    return { rows, cols, elements: numbers, type: raw._type };
}
export default class MatlabVariableNode extends DataNode {
    constructor(name, parent, serial) {
        super(name, parent, serial);
        this._kind = 'scalar';
        this._scalarValue = 0;
        this._scalarType = 'double';
        this._elements = [];
        this._dims = [1, 1];
        this._rawBytes = null;
        this._matVar = null;
        this._isOpaque = false;
        this._opaqueClassName = null;
        this._mcosProperties = null;
        this._mcosValue = undefined;
        this._mcosDimensions = null;
    }
    get Value() {
        if (this._kind === 'scalar') {
            return this._scalarValue;
        }
        if (this._kind === 'array') {
            return this.children.length > 0
                ? this.children.map(function (c) {
                    return c._scalarValue;
                })
                : this._elements;
        }
        if (this._kind === 'string') {
            return this._elements;
        }
        return null;
    }
    set Value(v) {
        if (this._kind === 'scalar') {
            this._scalarValue = v;
        }
    }
    get elements() {
        return this._elements;
    }
    get dims() {
        return this._dims;
    }
    get arrayType() {
        return this._scalarType;
    }
    get icon() {
        // In the Architectural Data section a plain variable is a derived Constant,
        // shown with the arch-flavored icon rather than the workspace-variable one.
        if (this.isDerived) {
            return 'typeConstant';
        }
        if (this._isOpaque) {
            return MCOS_ICON_MAP[this._opaqueClassName] || 'wsDefault';
        }
        switch (this._kind) {
            case 'scalar':
                if (this._scalarType === 'logical') {
                    return 'wsCheck';
                }
                if (this._scalarType === 'char') {
                    return 'wsCharacter';
                }
                if (this._scalarType === 'string') {
                    return 'wsString';
                }
                if (this._scalarType === 'struct') {
                    return 'wsTree';
                }
                return 'wsDefault';
            case 'array':
                return 'wsDefault';
            case 'cell':
                return 'wsBrackets';
            case 'string':
                return 'wsString';
            default:
                return 'wsDefault';
        }
    }
    get className() {
        if (this._isOpaque) {
            return this._opaqueClassName;
        }
        switch (this._kind) {
            case 'scalar':
                return this._scalarType === 'complex' ? 'double' : this._scalarType;
            case 'array':
                return this._scalarType === 'complex' ? 'double' : this._scalarType;
            case 'cell':
                return 'cell';
            case 'string':
                return 'string';
            default:
                return '';
        }
    }
    // A primitive variable's data type ('double', 'string', 'cell', …) is a real
    // data type and belongs in the DataType column. An opaque MCOS variable's
    // className is a Class name (e.g. 'Simulink.Parameter'), which is Class, not a
    // data type — suppress it here so the column stays type-only.
    get dataType() {
        return this._isOpaque ? '' : this.className;
    }
    // A plain MATLAB variable (scalar, array, cell, struct-like, or opaque MCOS
    // object) is a "MATLAB Variable" in Design Data. In Architectural Data the same
    // variable is a Constant (a derived entry with no other catalog classification),
    // so its Kind follows the section. A catalog classification, if present, still
    // wins (mirrors DataNode.kind).
    get kind() {
        if (this.classification) {
            return super.kind;
        }
        return matlabVariableKind(this.isDerived);
    }
    get nameEditable() {
        if (this.parent && this.parent instanceof MatlabVariableNode) {
            return false;
        }
        // A class property name is fixed by the class definition (see BaseNode).
        if (this.parent?.isObjectPropertyBag) {
            return false;
        }
        return true;
    }
    get valueEditable() {
        if (this._isOpaque) {
            return false;
        }
        if (this._scalarType === 'struct') {
            return false;
        }
        // The "value unrecoverable" placeholder has no real value to edit.
        if (this._scalarValue === NOT_AVAILABLE) {
            return false;
        }
        return true;
    }
    // True when this variable currently holds a SCALAR NUMERIC value — the shape a
    // Constant requires. A live-node counterpart to parsedIsScalarNumeric: it is a
    // 1x1 non-opaque scalar whose type is numeric (double/logical/complex, plus the
    // typed int/single scalars loaded from a file, which also carry _kind 'scalar').
    // Arrays, matrices, cells, structs, char, and string are rejected. Used by the
    // Constant value gate and the Variable→Constant paste/drop gate.
    get isScalarNumeric() {
        if (this._isOpaque) {
            return false;
        }
        if (this._kind !== 'scalar') {
            return false;
        }
        return this._scalarType !== 'struct' && this._scalarType !== 'char' && this._scalarType !== 'string';
    }
    get displayValue() {
        if (this._isOpaque) {
            if (this._mcosValue !== undefined && this._mcosValue !== null) {
                if (typeof this._mcosValue === 'number')
                    return String(this._mcosValue);
                if (typeof this._mcosValue === 'string')
                    return this._mcosValue ? "'" + this._mcosValue + "'" : '<1x1 ' + this._opaqueClassName + '>';
                if (Array.isArray(this._mcosValue)) {
                    const dims = this._mcosDimensions || [1, this._mcosValue.length];
                    return '[' + dims.join('x') + ' ' + (this._opaqueClassName || 'double') + ']';
                }
            }
            return '<1x1 ' + this._opaqueClassName + '>';
        }
        switch (this._kind) {
            case 'scalar':
                return this._formatScalar();
            case 'array':
                return this._formatArray();
            case 'cell':
                return this._formatCell();
            case 'string':
                return this._formatString();
            default:
                return '';
        }
    }
    _formatScalar() {
        // The MCOS decoder's "value unrecoverable" sentinel is a bare-angle-bracket
        // placeholder, not real text — render it unquoted (like `<1x1 class_name>`) so
        // the table styles it gray/italic and gives it no editor, rather than showing
        // it as a quoted, editable string literal.
        if (this._scalarValue === NOT_AVAILABLE) {
            return NOT_AVAILABLE;
        }
        if (this._scalarType === 'char') {
            return "'" + this._scalarValue + "'";
        }
        if (this._scalarType === 'string') {
            return '"' + this._scalarValue + '"';
        }
        if (this._scalarType === 'struct') {
            return '<' + this._dims.join('x') + ' struct>';
        }
        if (this._scalarType === 'logical') {
            return this._scalarValue ? 'true' : 'false';
        }
        return String(this._scalarValue);
    }
    _formatArray() {
        const elems = this.children.length > 0
            ? this.children.map(function (c) {
                return c._scalarValue;
            })
            : this._elements;
        if (this._scalarType === 'logical') {
            const formatted = elems.map(function (v) {
                return v ? 'true' : 'false';
            });
            return formatMatrix(this._dims[0], this._dims[1], formatted);
        }
        return formatMatrix(this._dims[0], this._dims[1], elems);
    }
    _formatCell() {
        if (this.children.length === 0) {
            return '{}';
        }
        const rows = this._dims[0];
        const cols = this._dims[1];
        const rowStrs = [];
        for (let r = 0; r < rows; r++) {
            const vals = [];
            for (let c = 0; c < cols; c++) {
                const child = this.children[r * cols + c];
                vals.push(child ? child.displayValue : '[]');
            }
            rowStrs.push(vals.join(', '));
        }
        const result = '{' + rowStrs.join('; ') + '}';
        if (result.length > 50) {
            return '{' + this._dims.join('x') + ' cell}';
        }
        return result;
    }
    _formatString() {
        const d = this._dims;
        if (d[0] === 1 && d[1] === 1 && this._elements.length === 1) {
            return '"' + this._elements[0] + '"';
        }
        const rows = d[0];
        const cols = d[1];
        const rowStrs = [];
        for (let r = 0; r < rows; r++) {
            const vals = [];
            for (let c = 0; c < cols; c++) {
                const el = this._elements[r * cols + c];
                vals.push('"' + (el !== undefined ? el : '') + '"');
            }
            rowStrs.push(vals.join(' '));
        }
        const strStr = '[' + rowStrs.join('; ') + ']';
        return strStr.length > 50 ? '<' + d.join('x') + ' string>' : strStr;
    }
    getProperties() {
        return [PropName, PropValue, PropDataType, PropDescription];
    }
    getPILayout() {
        // className is dynamic (double/int8/struct/the opaque MCOS class), so this
        // can't be schema-keyed; author the common "General" identity group directly.
        return [{ group: 'General', items: [PropName, PropValue, PropDataType, PropKind, PropClassAtom, PropDescription] }];
    }
    setProperty(propName, stringValue) {
        if (propName === 'Value') {
            if (this._isConstrainedChild()) {
                return this._setConstrainedValue(stringValue);
            }
            const parsed = MatlabValueParser.parse(stringValue);
            if (!parsed) {
                return {
                    error: true,
                    reason: 'Invalid MATLAB expression',
                    invalidValue: stringValue,
                    validValue: this.displayValue,
                };
            }
            this._applyParsed(parsed);
            this._markModified();
            return true;
        }
        return DataNode.prototype.setProperty.call(this, propName, stringValue);
    }
    _isConstrainedChild() {
        if (!this.parent || !(this.parent instanceof MatlabVariableNode)) {
            return false;
        }
        return this.parent._kind === 'array' || this.parent._kind === 'string';
    }
    _setConstrainedValue(stringValue) {
        if (this.parent._kind === 'array') {
            const parsed = MatlabValueParser.parse(stringValue);
            if (!parsed || parsed.type !== 'double' || Array.isArray(parsed.value)) {
                return {
                    error: true,
                    reason: 'Array elements must be scalar numbers',
                    invalidValue: stringValue,
                    validValue: this.displayValue,
                };
            }
            this._scalarValue = parsed.value;
            this._scalarType = 'double';
            this.parent._rawInput = undefined;
            this._markModified();
            return true;
        }
        if (this.parent._kind === 'string') {
            const parsed = MatlabValueParser.parse(stringValue);
            if (!parsed || (parsed.type !== 'char' && parsed.type !== 'string')) {
                return {
                    error: true,
                    reason: 'String elements must be character or string values',
                    invalidValue: stringValue,
                    validValue: this.displayValue,
                };
            }
            this._scalarValue = parsed.value;
            this._scalarType = 'string';
            this._elements = [parsed.value];
            this.parent._rawInput = undefined;
            this._markModified();
            return true;
        }
        return { error: true, reason: 'Cannot edit', invalidValue: stringValue, validValue: this.displayValue };
    }
    _applyParsed(parsed) {
        this.children = [];
        this._matVar = null;
        this._rawInput = undefined;
        if (parsed.type === 'double' && Array.isArray(parsed.value) && parsed.value.length === 1) {
            this._kind = 'scalar';
            this._scalarValue = parsed.value[0];
            this._scalarType = 'double';
            this._dims = [1, 1];
            this.serial = {};
        }
        else if (parsed.type === 'double' && Array.isArray(parsed.value)) {
            this._kind = 'array';
            this._elements = parsed.value;
            this._dims = parsed.dims;
            this._scalarType = 'double';
            if (parsed.dims[0] > 1) {
                this.serial = { _type: 'double', _value: this._buildMatrixString(parsed.dims, parsed.value) };
            }
            else {
                this.serial = this._elements;
            }
            this._buildArrayChildren();
        }
        else if (parsed.type === 'string-array') {
            this._kind = 'string';
            this._elements = parsed.value;
            this._dims = parsed.dims;
            this._scalarType = 'string';
            this.serial = { _array_type: 'String', _dimensions: parsed.dims };
            this._buildStringChildren();
        }
        else if (parsed.type === 'cell') {
            this._kind = 'cell';
            this._dims = parsed.dims;
            this._scalarType = 'double';
            this.serial = { _dimensions: parsed.dims, _mw_element_type: 'MATLABArray' };
            this._buildCellChildren(parsed.value);
        }
        else {
            this._kind = 'scalar';
            this._scalarValue = parsed.value;
            this._scalarType = parsed.type;
            this._dims = [1, 1];
            this.serial = {};
        }
    }
    _buildMatrixString(dims, elements) {
        const rows = dims[0];
        const cols = dims[1];
        const rowStrs = [];
        for (let r = 0; r < rows; r++) {
            const vals = [];
            for (let c = 0; c < cols; c++) {
                vals.push(String(elements[r * cols + c]));
            }
            rowStrs.push('[' + vals.join(', ') + ']');
        }
        return 'Matrix(' + rows + ',' + cols + ')\n' + rowStrs.join('\n');
    }
    _buildArrayChildren() {
        if (this._elements.length <= 1) {
            return;
        }
        for (let i = 0; i < this._elements.length; i++) {
            const child = MatlabVariableNode._createScalar(this._elements[i], 'double', String(i + 1), this);
            this.addChild(child);
        }
    }
    _buildStringChildren() {
        if (this._elements.length <= 1) {
            return;
        }
        for (let i = 0; i < this._elements.length; i++) {
            const child = new MatlabVariableNode(String(i + 1), this, { _dimensions: [1, 1] });
            child._kind = 'string';
            child._elements = [this._elements[i]];
            child._dims = [1, 1];
            child._scalarValue = this._elements[i];
            child._scalarType = 'string';
            this.addChild(child);
        }
    }
    _buildCellChildren(elements) {
        for (let i = 0; i < elements.length; i++) {
            const child = NodeRegistry.parseValue(elements[i], String(i + 1), this);
            this.addChild(child);
        }
    }
    canAddChild() {
        if (this._kind === 'scalar' && this._scalarType === 'struct') {
            return true;
        }
        if (this._kind === 'scalar') {
            return false;
        }
        // A 2-D (or higher) matrix cannot take an appended element and stay
        // rectangular, so Add Child is disabled for cell/string/numeric matrices.
        // Row and column vectors (one dimension is 1) remain addable.
        if ((this._kind === 'array' || this._kind === 'cell' || this._kind === 'string') && this._dims[0] > 1 && this._dims[1] > 1) {
            return false;
        }
        // A scalar (1x1) string is a leaf value, not a string array, so it has no
        // element to add — whether it stands alone or is an element of a parent
        // string array.
        if (this._kind === 'string' && this._dims[0] === 1 && this._dims[1] === 1) {
            return false;
        }
        return true;
    }
    addChildNode() {
        if (this._kind === 'array' && this._elements.length === 0) {
            return this._convertToStructAndAddField();
        }
        if (this._kind === 'scalar' && this._scalarType === 'struct') {
            return this._addStructField();
        }
        if (this._kind === 'array') {
            return this._addArrayChild();
        }
        if (this._kind === 'cell') {
            return this._addCellChild();
        }
        if (this._kind === 'string') {
            return this._addStringChild();
        }
        return null;
    }
    _convertToStructAndAddField() {
        this._kind = 'scalar';
        this._scalarType = 'struct';
        this._scalarValue = null;
        this._elements = [];
        this._dims = [1, 1];
        this.serial = {};
        const child = MatlabVariableNode._createScalar(0, 'double', 'field', this);
        this.addChild(child);
        this._markModified();
        return child;
    }
    _addStructField() {
        const baseName = 'field';
        const existing = new Set(this.children.map((c) => c.name));
        let uniqueName = baseName;
        let i = 1;
        while (existing.has(uniqueName)) {
            uniqueName = baseName + i;
            i++;
        }
        const child = MatlabVariableNode._createScalar(0, 'double', uniqueName, this);
        this.addChild(child);
        this._markModified();
        return child;
    }
    _addArrayChild() {
        const idx = this.children.length + 1;
        const child = MatlabVariableNode._createScalar(0, 'double', String(idx), this);
        this.addChild(child);
        this._elements.push(0);
        this._updateDimsForCount(this._elements.length);
        this._syncArraySerial();
        this._markModified();
        return child;
    }
    _addCellChild() {
        const child = MatlabVariableNode._createScalar(0, 'double', String(this.children.length + 1), this);
        this.addChild(child);
        this._updateDimsForCount(this.children.length);
        if (this.serial._dimensions) {
            this.serial._dimensions = this._dims;
        }
        this._markModified();
        return child;
    }
    _addStringChild() {
        // Build the element as a string-kind node (matching _buildStringChildren) so
        // it serializes as a bare "" element, not a nested [""] array — the latter is
        // what _createScalar('string') would produce via _serializeScalar.
        const child = new MatlabVariableNode(String(this.children.length + 1), this, { _dimensions: [1, 1] });
        child._kind = 'string';
        child._elements = [''];
        child._dims = [1, 1];
        child._scalarValue = '';
        child._scalarType = 'string';
        this.addChild(child);
        this._elements.push('');
        this._updateDimsForCount(this._elements.length);
        this._markModified();
        return child;
    }
    canRemoveChild() {
        if (this._kind === 'scalar') {
            return false;
        }
        // Removing an element from a 2-D (or higher) matrix would break its
        // rectangular shape, so it is disabled for numeric/cell/string matrices.
        // Row and column vectors (one dimension is 1) remain removable.
        if ((this._kind === 'array' || this._kind === 'cell' || this._kind === 'string') && this._dims[0] > 1 && this._dims[1] > 1) {
            return false;
        }
        return this.children.length > 0;
    }
    removeChildNode(child) {
        const idx = this.children.indexOf(child);
        if (idx < 0) {
            return;
        }
        this.removeChild(child);
        if (this._kind === 'array') {
            this._elements.splice(idx, 1);
            this._updateArrayAfterRemove();
        }
        else if (this._kind === 'cell') {
            this._updateCellAfterRemove();
        }
        else if (this._kind === 'string') {
            this._elements.splice(idx, 1);
            this._updateStringAfterRemove();
        }
        this._reindexChildren();
        this._markModified();
    }
    _updateArrayAfterRemove() {
        if (this._elements.length <= 1) {
            if (this._elements.length === 1) {
                this._kind = 'scalar';
                this._scalarValue = this._elements[0];
                this._scalarType = 'double';
                this._dims = [1, 1];
                this._elements = [];
                this.children = [];
                this.serial = {};
            }
            else {
                this._dims = [1, 0];
                this.serial = this._elements;
            }
            return;
        }
        this._updateDimsForCount(this._elements.length);
        this._syncArraySerial();
    }
    _updateCellAfterRemove() {
        if (this.children.length === 0) {
            this._dims = [0, 0];
        }
        else {
            this._updateDimsForCount(this.children.length);
        }
        if (this.serial._dimensions) {
            this.serial._dimensions = this._dims;
        }
    }
    _updateStringAfterRemove() {
        if (this._elements.length <= 1) {
            if (this._elements.length === 1) {
                this._dims = [1, 1];
                this.children = [];
            }
            else {
                this._dims = [1, 0];
            }
            return;
        }
        this._updateDimsForCount(this._elements.length);
    }
    restoreChildNode(child, index) {
        this.children.splice(index, 0, child);
        child.parent = this;
        if (this._kind === 'scalar') {
            this._kind = 'array';
            this._elements = [this._scalarValue];
            this._scalarValue = undefined;
            this._scalarType = undefined;
        }
        if (this._kind === 'array') {
            const val = child._kind === 'scalar' ? child._scalarValue : 0;
            this._elements.splice(index, 0, val);
            this._updateDimsForCount(this._elements.length);
            this._syncArraySerial();
        }
        else if (this._kind === 'cell') {
            this._updateDimsForCount(this.children.length);
            if (this.serial._dimensions) {
                this.serial._dimensions = this._dims;
            }
        }
        else if (this._kind === 'string') {
            const val = child._kind === 'scalar' ? child._scalarValue : '';
            this._elements.splice(index, 0, val);
            this._updateDimsForCount(this._elements.length);
        }
        this._reindexChildren();
        this._markModified();
    }
    execAddChild() {
        if (!this.canAddChild()) {
            return null;
        }
        const wasEmptyArray = this._kind === 'array' && this._elements.length === 0;
        const prevSerial = wasEmptyArray ? { ...this.serial } : null;
        const child = this.addChildNode();
        if (!child) {
            return null;
        }
        const self = this;
        const index = this.children.indexOf(child);
        if (wasEmptyArray) {
            return {
                node: child,
                undo() {
                    self.removeChild(child);
                    self._kind = 'array';
                    self._scalarType = 'double';
                    self._scalarValue = undefined;
                    self._elements = [];
                    self._dims = [0, 0];
                    self.serial = prevSerial;
                    self._markModified();
                },
                redo() {
                    self._convertToStructAndAddField();
                },
            };
        }
        return {
            node: child,
            undo() {
                self.removeChildNode(child);
            },
            redo() {
                self.restoreChildNode(child, index);
            },
        };
    }
    execRemoveChild(child) {
        if (!this.canRemoveChild() || !child) {
            return null;
        }
        const index = this.children.indexOf(child);
        if (index < 0) {
            return null;
        }
        this.removeChildNode(child);
        const self = this;
        return {
            undo() {
                self.restoreChildNode(child, index);
            },
            redo() {
                self.removeChildNode(child);
            },
        };
    }
    _updateDimsForCount(count) {
        if (this._dims[1] === 1) {
            this._dims = [count, 1];
        }
        else {
            this._dims = [1, count];
        }
    }
    _syncArraySerial() {
        if (this._dims[0] > 1) {
            this.serial = { _type: 'double', _value: this._buildMatrixString(this._dims, this._elements) };
        }
        else {
            this.serial = this._elements;
        }
    }
    _reindexChildren() {
        for (let i = 0; i < this.children.length; i++) {
            this.children[i].name = String(i + 1);
        }
    }
    serializeValue() {
        if (this._rawInput !== undefined &&
            this.status !== 'Modified' &&
            !this._rawInput?._emptyDims) {
            return this._rawInput;
        }
        switch (this._kind) {
            case 'scalar':
                return this._serializeScalar();
            case 'array':
                return this._serializeArray();
            case 'cell':
                return this._serializeCell();
            case 'string':
                return this._serializeString();
            default:
                return null;
        }
    }
    _serializeScalar() {
        if (this._scalarType === 'string') {
            return [this._scalarValue];
        }
        if (this._scalarType === 'complex') {
            return { _type: 'cdata', _value: this._scalarValue };
        }
        return this._scalarValue;
    }
    _serializeArray() {
        if (this._elements.length === 0) {
            return [];
        }
        if (this.children.length > 0 && this.serial && this.serial._type) {
            const elems = this.children.map(function (c) {
                return c._scalarValue;
            });
            const rows = this._dims[0];
            const cols = this._dims[1];
            const rowStrs = [];
            for (let r = 0; r < rows; r++) {
                const vals = [];
                for (let c = 0; c < cols; c++) {
                    vals.push(String(elems[r * cols + c]));
                }
                rowStrs.push('[' + vals.join(', ') + ']');
            }
            return {
                _type: this.serial._type,
                _value: 'Matrix(' + rows + ',' + cols + ')\n' + rowStrs.join('\n'),
            };
        }
        if (this.children.length > 0) {
            return this.children.map(function (c) {
                return c.serializeValue();
            });
        }
        return this.serial;
    }
    _serializeCell() {
        const elements = this.children.map(function (child) {
            return child.serializeValue();
        });
        return {
            _array_type: 'Cell',
            _dimensions: this._dims,
            _elements: elements,
            _mw_element_type: this.serial._mw_element_type || 'MATLABArray',
        };
    }
    _serializeString() {
        if (this.parent && this.parent instanceof MatlabVariableNode && this.parent._kind === 'string') {
            return this._elements[0];
        }
        const elements = this.children.length > 0
            ? this.children.map(function (c) {
                return c.serializeValue();
            })
            : this._elements;
        if (this.serial._array_type) {
            return {
                _array_type: 'String',
                _dimensions: this._dims,
                _elements: elements,
                _mw_element_type: this.serial._mw_element_type || 'MATLABArray',
            };
        }
        return elements;
    }
    serializeXml(tagName, attrs, indent) {
        switch (this._kind) {
            case 'scalar':
                return this._serializeScalarXml(tagName, attrs, indent);
            case 'array':
                return this._serializeArrayXml(tagName, attrs, indent);
            case 'cell':
                return this._serializeCellXml(tagName, attrs, indent);
            case 'string':
                return this._serializeStringXml(tagName, attrs, indent);
            default:
                return xmlPad(indent) + '<' + tagName + '/>';
        }
    }
    _serializeScalarXml(tagName, attrs, indent) {
        const p = xmlPad(indent);
        const type = this._scalarType;
        const val = this._scalarValue;
        let attrStr = '';
        if (attrs && attrs.Name) {
            attrStr += ' Name="' + escapeXml(attrs.Name) + '"';
        }
        if (type === 'string') {
            this._kind = 'string';
            this._elements = [val];
            this._dims = [1, 1];
            const result = this._serializeStringXml(tagName, attrs, indent);
            this._kind = 'scalar';
            return result;
        }
        if (type === 'char') {
            if (val === '' || val === null || val === undefined) {
                return p + '<' + tagName + attrStr + ' Class="char"/>';
            }
            return p + '<' + tagName + attrStr + ' Class="char">' + escapeXml(String(val)) + '</' + tagName + '>';
        }
        if (type === 'logical') {
            return p + '<' + tagName + attrStr + ' Class="logical">' + (val ? '1' : '0') + '</' + tagName + '>';
        }
        if (type === 'complex') {
            return (p +
                '<' +
                tagName +
                attrStr +
                ' Class="double" IsComplex="1">' +
                formatComplexXml(String(val)) +
                '</' +
                tagName +
                '>');
        }
        if (type === 'double') {
            return p + '<' + tagName + attrStr + ' Class="double">' + formatDoubleXml(val) + '</' + tagName + '>';
        }
        return (p +
            '<' +
            tagName +
            attrStr +
            ' Class="' +
            type +
            '">' +
            formatNumericXml(val, type) +
            '</' +
            tagName +
            '>');
    }
    _serializeArrayXml(tagName, attrs, indent) {
        const p = xmlPad(indent);
        const type = this._scalarType;
        const dims = this._dims;
        const rows = dims[0];
        const cols = dims[1];
        let attrStr = '';
        if (attrs && attrs.Name) {
            attrStr += ' Name="' + escapeXml(attrs.Name) + '"';
        }
        if (rows === 0 || cols === 0 || (this._elements.length === 0 && this.children.length === 0)) {
            return (p + '<' + tagName + attrStr + ' Class="' + (type || 'double') + '" Dimension="' + rows + '*' + cols + '"/>');
        }
        const elems = this.children.length > 0
            ? this.children.map(function (c) {
                return c._scalarValue;
            })
            : this._elements;
        if (type === 'complex' ||
            (elems.length > 0 && typeof elems[0] === 'string' && elems[0].includes('i'))) {
            const colMajor = transposeToColumnMajor(elems, rows, cols);
            const formatted = colMajor.map(function (v) {
                return formatComplexXml(String(v));
            });
            return (p +
                '<' +
                tagName +
                attrStr +
                ' Class="double" IsComplex="1" Dimension="' +
                rows +
                '*' +
                cols +
                '">' +
                formatted.join(' ') +
                '</' +
                tagName +
                '>');
        }
        const colMajor = transposeToColumnMajor(elems, rows, cols);
        const formatted = colMajor.map(function (v) {
            return formatNumericXml(v, type || 'double');
        });
        const classAttr = type === 'logical' ? 'logical' : type || 'double';
        return (p +
            '<' +
            tagName +
            attrStr +
            ' Class="' +
            classAttr +
            '" Dimension="' +
            rows +
            '*' +
            cols +
            '">' +
            formatted.join(' ') +
            '</' +
            tagName +
            '>');
    }
    _serializeCellXml(tagName, attrs, indent) {
        const p = xmlPad(indent);
        const dims = this._dims;
        let attrStr = '';
        if (attrs && attrs.Name) {
            attrStr += ' Name="' + escapeXml(attrs.Name) + '"';
        }
        if (this.children.length === 0) {
            return p + '<' + tagName + attrStr + ' Class="cell" Dimension="0*0"/>';
        }
        let xml = p + '<' + tagName + attrStr + ' Class="cell" Dimension="' + dims[0] + '*' + dims[1] + '">\n';
        for (const child of this.children) {
            xml += child.serializeXml('Element', {}, indent + 1) + '\n';
        }
        xml += p + '</' + tagName + '>';
        return xml;
    }
    _serializeStringXml(tagName, attrs, indent) {
        const p = xmlPad(indent);
        const ip = xmlPad(indent + 1);
        const ip2 = xmlPad(indent + 2);
        const ip3 = xmlPad(indent + 3);
        const dims = this._dims;
        const elements = this.children.length > 0
            ? this.children.map(function (c) {
                return c._elements
                    ? c._elements[0]
                    : c._scalarValue;
            })
            : this._elements;
        let attrStr = '';
        if (attrs && attrs.Name) {
            attrStr += ' Name="' + escapeXml(attrs.Name) + '"';
        }
        let xml = p + '<' + tagName + attrStr + '>\n';
        xml += ip + '<Element Class="string">\n';
        xml += ip2 + '<P Source="saveobj" PropertyType="any" Class="cell"';
        if (!(dims[0] === 1 && dims[1] === 1)) {
            xml += ' Dimension="' + dims[0] + '*' + dims[1] + '"';
        }
        xml += '>\n';
        for (const str of elements) {
            xml += ip3 + '<Element Class="char">' + escapeXml(str || '') + '</Element>\n';
        }
        xml += ip2 + '</P>\n';
        xml += ip + '</Element>\n';
        xml += p + '</' + tagName + '>';
        return xml;
    }
    get _var() {
        if (this._matVar) {
            return this._matVar;
        }
        return this._buildVarObject();
    }
    _buildVarObject() {
        const matClassName = this._scalarType === 'logical' ? 'uint8' : this._scalarType;
        const v = {
            name: this.name,
            className: this._isOpaque ? this._opaqueClassName : matClassName,
            dimensions: this._dims.slice(),
            isComplex: false,
            isLogical: this._scalarType === 'logical',
            value: null,
            fields: null,
            _rawBytes: this._rawBytes,
            _modified: this.status === 'Modified',
        };
        if (this._isOpaque) {
            v.isOpaque = true;
            v.dimensions = [1, 1];
            return v;
        }
        if (this._scalarType === 'struct') {
            v.className = 'struct';
            const fields = {};
            for (const child of this.children) {
                fields[child.name] = child._var;
            }
            v.fields = fields;
        }
        else if (this._kind === 'scalar') {
            v.value = this._scalarValue;
            if (this._scalarType === 'char') {
                v.className = 'char';
                v.dimensions = [1, typeof this._scalarValue === 'string' ? this._scalarValue.length : 0];
            }
            if (this._scalarType === 'complex') {
                v.className = 'double';
                v.isComplex = true;
                const m = String(this._scalarValue).match(/^([-\d.eE+]+)([+-][\d.eE+]+)i$/);
                if (m) {
                    v.value = [{ re: parseFloat(m[1]), im: parseFloat(m[2]) }];
                }
            }
        }
        else if (this._kind === 'array') {
            const elems = this.children.length > 0
                ? this.children.map(function (c) {
                    return c._scalarValue;
                })
                : this._elements;
            if (this._scalarType === 'complex' ||
                (elems.length > 0 && typeof elems[0] === 'string' && String(elems[0]).includes('i'))) {
                v.className = 'double';
                v.isComplex = true;
                v.value = elems.map(function (s) {
                    const m = String(s).match(/^([-\d.eE+]+)([+-][\d.eE+]+)i$/);
                    return m ? { re: parseFloat(m[1]), im: parseFloat(m[2]) } : { re: 0, im: 0 };
                });
            }
            else {
                v.value = elems.length === 1 ? elems[0] : elems;
            }
        }
        else if (this._kind === 'cell') {
            v.className = 'cell';
            v.value = this.children.map(function (c) {
                return c._var;
            });
        }
        else if (this._kind === 'string') {
            v.className = 'char';
            const str = this._elements.length === 1 ? this._elements[0] : this._elements.join('');
            v.value = str;
            v.dimensions = [1, str.length];
        }
        return v;
    }
    static parseMatVariable(variable, name, parent) {
        if (variable.isOpaque) {
            return MatlabVariableNode._createOpaque(variable, name, parent);
        }
        if (variable.className === 'struct') {
            return MatlabVariableNode._createFromMatStruct(variable, name, parent);
        }
        if (variable.className === 'cell') {
            return MatlabVariableNode._createFromMatCell(variable, name, parent);
        }
        if (variable.className === 'char') {
            return MatlabVariableNode._createFromMatChar(variable, name, parent);
        }
        return MatlabVariableNode._createFromMatNumeric(variable, name, parent);
    }
    static _createOpaque(variable, name, parent) {
        const node = new MatlabVariableNode(name, parent, {});
        node._isOpaque = true;
        node._opaqueClassName = variable.className;
        node._rawBytes = variable._rawBytes || null;
        node._matVar = variable;
        return node;
    }
    static createFromMcosDecoded(variable, decoded, parent) {
        const node = new MatlabVariableNode(variable.name, parent, {});
        node._isOpaque = true;
        node._opaqueClassName = variable.className;
        node._rawBytes = variable._rawBytes || null;
        node._matVar = variable;
        node._mcosProperties = decoded.properties;
        node._mcosValue = decoded.value;
        node._mcosDimensions = decoded.dimensions;
        return node;
    }
    static _createFromMatNumeric(variable, name, parent) {
        const node = new MatlabVariableNode(name, parent, {});
        node._rawBytes = variable._rawBytes || null;
        node._matVar = variable;
        const dims = variable.dimensions;
        const totalElements = dims.reduce((a, b) => a * b, 1);
        if (variable.isComplex) {
            const arr = Array.isArray(variable.value) ? variable.value : [variable.value];
            if (arr.length === 1) {
                node._kind = 'scalar';
                node._scalarType = 'complex';
                const c = arr[0];
                node._scalarValue = c.im >= 0 ? c.re + '+' + c.im + 'i' : c.re + '' + c.im + 'i';
                node._dims = [1, 1];
            }
            else {
                node._kind = 'array';
                node._scalarType = variable.className;
                node._dims = dims.slice();
                node._elements = arr.map(function (c) {
                    return c.im >= 0 ? c.re + '+' + c.im + 'i' : c.re + '' + c.im + 'i';
                });
                node._elements.forEach(function (el, i) {
                    const child = MatlabVariableNode._createScalar(el, 'complex', String(i + 1), node);
                    node.addChild(child);
                });
            }
            return node;
        }
        if (totalElements === 0) {
            node._kind = 'array';
            node._scalarType = variable.className;
            node._dims = dims.slice();
            node._elements = [];
            return node;
        }
        if (totalElements === 1) {
            node._kind = 'scalar';
            node._scalarType = variable.isLogical ? 'logical' : variable.className;
            node._scalarValue = variable.isLogical ? !!variable.value : variable.value;
            node._dims = [1, 1];
            return node;
        }
        node._kind = 'array';
        node._scalarType = variable.isLogical ? 'logical' : variable.className;
        node._dims = dims.slice();
        const values = Array.isArray(variable.value) ? variable.value : [variable.value];
        node._elements = variable.isLogical
            ? values.map(function (v) {
                return v ? 1 : 0;
            })
            : values;
        node._elements.forEach(function (el, i) {
            const child = MatlabVariableNode._createScalar(el, node._scalarType === 'logical' ? 'double' : node._scalarType, String(i + 1), node);
            node.addChild(child);
        });
        return node;
    }
    static _createFromMatChar(variable, name, parent) {
        const node = new MatlabVariableNode(name, parent, {});
        node._rawBytes = variable._rawBytes || null;
        node._matVar = variable;
        node._kind = 'scalar';
        node._scalarType = 'char';
        node._scalarValue = variable.value || '';
        node._dims = variable.dimensions.slice();
        return node;
    }
    static _createFromMatStruct(variable, name, parent) {
        const node = new MatlabVariableNode(name, parent, {});
        node._rawBytes = variable._rawBytes || null;
        node._matVar = variable;
        node._kind = 'scalar';
        node._scalarType = 'struct';
        node._scalarValue = null;
        node._dims = variable.dimensions.slice();
        if (variable.fields) {
            for (const [fieldName, fieldVar] of Object.entries(variable.fields)) {
                const childVar = Array.isArray(fieldVar) ? fieldVar[0] : fieldVar;
                const child = MatlabVariableNode.parseMatVariable(childVar, fieldName, node);
                node.addChild(child);
            }
        }
        return node;
    }
    static _createFromMatCell(variable, name, parent) {
        const node = new MatlabVariableNode(name, parent, {});
        node._rawBytes = variable._rawBytes || null;
        node._matVar = variable;
        node._kind = 'cell';
        node._scalarType = 'double';
        node._dims = variable.dimensions.slice();
        const cells = Array.isArray(variable.value) ? variable.value : [];
        cells.forEach(function (cell, i) {
            if (cell) {
                const child = MatlabVariableNode.parseMatVariable(cell, String(i + 1), node);
                node.addChild(child);
            }
        });
        return node;
    }
    static get defaultName() {
        return 'Var';
    }
    static createDefault(name, parent) {
        return MatlabVariableNode._createScalar(0, 'double', name, parent);
    }
    static _createScalar(value, type, name, parent) {
        const node = new MatlabVariableNode(name, parent, {});
        node._kind = 'scalar';
        node._scalarValue = value;
        node._scalarType = type;
        node._dims = [1, 1];
        return node;
    }
    static parse(rawVal, name, parent) {
        if (rawVal &&
            typeof rawVal === 'object' &&
            rawVal._type &&
            rawVal._emptyDims) {
            const rv = rawVal;
            const node = new MatlabVariableNode(name, parent, rv);
            node._rawInput = rv;
            node._kind = 'array';
            node._elements = [];
            node._dims = rv._emptyDims;
            node._scalarType = rv._type;
            return node;
        }
        if (rawVal &&
            typeof rawVal === 'object' &&
            rawVal._type &&
            rawVal._value !== undefined &&
            typeof rawVal._value === 'string') {
            const rv = rawVal;
            if (rv._value.indexOf('Matrix(') === 0) {
                return MatlabVariableNode.parseTypedArray(rv, name, parent);
            }
            if (rv._value.charAt(0) === '[') {
                return MatlabVariableNode.parseTypedVector(rv, name, parent);
            }
            return MatlabVariableNode.parseTypedScalar(rv, name, parent);
        }
        if (rawVal && typeof rawVal === 'object' && rawVal._array_type === 'Cell') {
            return MatlabVariableNode.parseCell(rawVal, name, parent);
        }
        if (rawVal && typeof rawVal === 'object' && rawVal._array_type === 'String') {
            return MatlabVariableNode.parseStructuredString(rawVal, name, parent);
        }
        if (Array.isArray(rawVal) &&
            rawVal.length > 0 &&
            rawVal.every(function (el) {
                return typeof el === 'string';
            })) {
            return MatlabVariableNode.parsePlainStringArray(rawVal, name, parent);
        }
        if (Array.isArray(rawVal)) {
            return MatlabVariableNode.parseFlatArray(rawVal, name, parent);
        }
        return MatlabVariableNode.parseScalar(rawVal, name, parent);
    }
    static parseScalar(rawVal, name, parent) {
        const node = new MatlabVariableNode(name, parent, {});
        node._rawInput = rawVal;
        node._kind = 'scalar';
        node._scalarValue = rawVal;
        node._dims = [1, 1];
        if (typeof rawVal === 'boolean') {
            node._scalarType = 'logical';
        }
        else if (typeof rawVal === 'number') {
            node._scalarType = 'double';
        }
        else if (typeof rawVal === 'string') {
            node._scalarType = 'char';
        }
        else {
            node._scalarType = 'double';
            node._scalarValue = rawVal === null || rawVal === undefined ? 0 : rawVal;
        }
        return node;
    }
    static parseTypedScalar(rawVal, name, parent) {
        if (rawVal._type === 'cdata') {
            return MatlabVariableNode.parseCdata(rawVal, name, parent);
        }
        const node = new MatlabVariableNode(name, parent, rawVal);
        node._rawInput = rawVal;
        node._kind = 'scalar';
        node._dims = [1, 1];
        node._scalarType = rawVal._type;
        if (rawVal._type === 'logical') {
            const valStr = rawVal._value.replace(/[FU]$/, '');
            node._scalarValue = valStr === '1' || valStr === 'true';
        }
        else {
            const valStr = rawVal._value.replace(/[FU]$/, '');
            if (valStr === 'Inf') {
                node._scalarValue = Infinity;
            }
            else if (valStr === '-Inf') {
                node._scalarValue = -Infinity;
            }
            else if (valStr === 'NaN') {
                node._scalarValue = NaN;
            }
            else {
                node._scalarValue = parseFloat(valStr) || 0;
            }
        }
        return node;
    }
    static parseCdata(rawVal, name, parent) {
        const valStr = rawVal._value;
        if (/^[\d.eE+\-i\s]+$/.test(valStr)) {
            return MatlabVariableNode._parseCdataText(rawVal, name, parent);
        }
        try {
            const { rows, cols, realParts, imagParts } = decodeCdata(valStr);
            const numElements = rows * cols;
            if (numElements === 1) {
                const node = new MatlabVariableNode(name, parent, rawVal);
                node._rawInput = rawVal;
                node._kind = 'scalar';
                node._dims = [1, 1];
                node._scalarType = 'complex';
                node._scalarValue = formatComplex(realParts[0], imagParts[0]);
                return node;
            }
            const rowMajor = [];
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    rowMajor.push(formatComplex(realParts[c * rows + r], imagParts[c * rows + r]));
                }
            }
            const node = new MatlabVariableNode(name, parent, rawVal);
            node._rawInput = rawVal;
            node._kind = 'array';
            node._scalarType = 'double';
            node._dims = [rows, cols];
            node._elements = rowMajor;
            rowMajor.forEach(function (el, i) {
                const child = MatlabVariableNode._createScalar(el, 'complex', String(i + 1), node);
                node.addChild(child);
            });
            return node;
        }
        catch (_e) {
            const node = new MatlabVariableNode(name, parent, rawVal);
            node._rawInput = rawVal;
            node._kind = 'scalar';
            node._dims = [1, 1];
            node._scalarType = 'char';
            node._scalarValue = valStr;
            return node;
        }
    }
    static _parseCdataText(rawVal, name, parent) {
        const colMajorParts = rawVal._value
            .trim()
            .split(/\s+/)
            .map(function (s) {
            return s.replace(/(\d+)\.0(?=[+\-i]|$)/g, '$1');
        });
        if (colMajorParts.length === 1) {
            const node = new MatlabVariableNode(name, parent, rawVal);
            node._rawInput = rawVal;
            node._kind = 'scalar';
            node._dims = [1, 1];
            node._scalarType = 'complex';
            node._scalarValue = colMajorParts[0];
            return node;
        }
        const dims = rawVal._dimensions || [1, colMajorParts.length];
        const rows = dims[0];
        const cols = dims[1];
        const parts = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                parts.push(colMajorParts[c * rows + r]);
            }
        }
        const node = new MatlabVariableNode(name, parent, rawVal);
        node._rawInput = rawVal;
        node._kind = 'array';
        node._scalarType = 'double';
        node._dims = [rows, cols];
        node._elements = parts;
        parts.forEach(function (el, i) {
            const child = MatlabVariableNode._createScalar(el, 'complex', String(i + 1), node);
            node.addChild(child);
        });
        return node;
    }
    static parseTypedVector(rawVal, name, parent) {
        const node = new MatlabVariableNode(name, parent, rawVal);
        node._rawInput = rawVal;
        node._kind = 'array';
        node._scalarType = rawVal._type;
        const inner = rawVal._value.replace(/^\[/, '').replace(/\]$/, '');
        const parts = inner.split(',').map(function (s) {
            return s.trim().replace(/[FU]$/, '');
        });
        if (rawVal._type === 'logical') {
            node._elements = parts.map(function (s) {
                return s === '1' || s === 'true' ? 1 : 0;
            });
        }
        else {
            node._elements = parts.map(function (s) {
                return parseFloat(s) || 0;
            });
        }
        node._dims = [1, node._elements.length];
        if (node._elements.length > 1) {
            node._elements.forEach(function (el, i) {
                const child = MatlabVariableNode._createScalar(el, 'double', String(i + 1), node);
                node.addChild(child);
            });
        }
        return node;
    }
    static parseFlatArray(rawVal, name, parent) {
        const node = new MatlabVariableNode(name, parent, rawVal);
        node._rawInput = rawVal;
        node._kind = 'array';
        node._elements = rawVal;
        node._dims = [1, rawVal.length];
        node._scalarType = 'double';
        if (rawVal.length > 1) {
            rawVal.forEach(function (el, i) {
                const child = MatlabVariableNode._createScalar(el, 'double', String(i + 1), node);
                node.addChild(child);
            });
        }
        return node;
    }
    static parseTypedArray(rawVal, name, parent) {
        const parsed = parseMatrixValue(rawVal);
        if (!parsed) {
            const node = new MatlabVariableNode(name, parent, rawVal);
            node._rawInput = rawVal;
            node._kind = 'array';
            node._elements = [];
            node._dims = [0, 0];
            node._scalarType = rawVal._type;
            return node;
        }
        const node = new MatlabVariableNode(name, parent, rawVal);
        node._rawInput = rawVal;
        node._kind = 'array';
        node._elements = parsed.elements;
        node._dims = [parsed.rows, parsed.cols];
        node._scalarType = parsed.type;
        if (parsed.elements.length > 1) {
            parsed.elements.forEach(function (el, i) {
                const child = MatlabVariableNode._createScalar(el, 'double', String(i + 1), node);
                node.addChild(child);
            });
        }
        return node;
    }
    static parseCell(rawVal, name, parent) {
        const serial = {
            _dimensions: rawVal._dimensions,
            _mw_element_type: rawVal._mw_element_type,
        };
        const node = new MatlabVariableNode(name, parent, serial);
        node._rawInput = rawVal;
        node._kind = 'cell';
        node._dims = rawVal._dimensions || [1, 1];
        if (rawVal._elements && rawVal._elements.length > 0) {
            node._buildCellChildren(rawVal._elements);
        }
        return node;
    }
    static parseStructuredString(rawVal, name, parent) {
        const serial = {
            _array_type: rawVal._array_type,
            _dimensions: rawVal._dimensions,
            _mw_element_type: rawVal._mw_element_type,
        };
        const node = new MatlabVariableNode(name, parent, serial);
        node._rawInput = rawVal;
        node._kind = 'string';
        node._elements = rawVal._elements || [];
        node._dims = rawVal._dimensions || [1, node._elements.length];
        node._scalarType = 'string';
        if (node._elements.length > 1) {
            node._elements.forEach(function (el, i) {
                const child = new MatlabVariableNode(String(i + 1), node, { _dimensions: [1, 1] });
                child._kind = 'string';
                child._elements = [el];
                child._dims = [1, 1];
                child._scalarValue = el;
                child._scalarType = 'string';
                node.addChild(child);
            });
        }
        return node;
    }
    static parsePlainStringArray(rawVal, name, parent) {
        const serial = { _dimensions: [1, rawVal.length] };
        const node = new MatlabVariableNode(name, parent, serial);
        node._rawInput = rawVal;
        node._kind = 'string';
        node._elements = rawVal;
        node._dims = [1, rawVal.length];
        node._scalarType = 'string';
        if (rawVal.length > 1) {
            rawVal.forEach(function (el, i) {
                const child = new MatlabVariableNode(String(i + 1), node, { _dimensions: [1, 1] });
                child._kind = 'string';
                child._elements = [el];
                child._dims = [1, 1];
                child._scalarValue = el;
                child._scalarType = 'string';
                node.addChild(child);
            });
        }
        return node;
    }
}
//# sourceMappingURL=MatlabVariableNode.js.map