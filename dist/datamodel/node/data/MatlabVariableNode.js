// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import { matlabVariableKind } from '../../kindMap.js';
import { addChildUndoable, removeChildUndoable } from '../childEdit.js';
import * as NodeRegistry from '../NodeRegistry.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
import PropKind from '../../prop/PropKind.js';
import PropClassAtom from '../../prop/PropClass.js';
import MatlabValueParser, { formatMatlabChar, formatMatlabString } from '../../parser/MatlabValueParser.js';
import { NOT_AVAILABLE } from '../../parser/McosParser.js';
import { parseMatrix } from '../../parser/MatParser.js';
import { effectiveDims, elementCount, summaryForm } from '../../display/DisplayConvention.js';
import { subscriptLabel } from '../../display/Subscript.js';
import { escapeXml, formatDoubleXml, formatNumericXml, formatComplexXml, formatMatlabNum, parseMatlabNum, transposeToColumnMajorND, transposeFromColumnMajorND, pad as xmlPad, } from '../../parser/XmlUtils.js';
// ---- Pure value helpers ----
// None of these read node state, which is why they are module-local functions and
// not methods: staying off the class is what lets the display getters and the
// static parse entry points at the bottom of the file share them without either
// side owning the other.
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
// An empty 0x0 double, MATLAB's own `[]`. Stands in for a cell slot the parser
// could not read (see _createFromMatCell) and for a struct-array element that no
// longer has one of the array's fields (see _buildVarObject): in both places a
// hole must stay a hole, or every later element slides one slot early.
// A fresh object per call, since the node built from it keeps a reference.
function emptyDouble() {
    return {
        name: '',
        className: 'double',
        dimensions: [0, 0],
        isComplex: false,
        isLogical: false,
        value: [],
        fields: null,
    };
}
// A text .sldd stores a value its XML schema cannot spell as uuencoded bytes:
// six bits per printable character, offset by 0x20. What those bytes CONTAIN is
// an 8-byte preamble followed by one MAT-file miMATRIX element — so decoding
// stops here and MatParser reads the rest. This function used to keep going and
// hand-read a 2-D complex double at fixed offsets (rows at 40, cols at 44),
// which meant every other class MATLAB puts in a cdata came back as garbage
// complex numbers or fell through to a char.
function uudecode(str) {
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
    return bytes;
}
// MAT-file element type miMATRIX: the one thing a cdata payload ever holds.
const MI_MATRIX = 14;
// The MATLAB numeric classes a bare JSON number cannot carry. JSON has ONE number
// type, so an int32 or a single written as a plain number reads back as a double —
// a silent class change, not a rounding nit. `double` needs no tag.
const TYPED_NUMERIC_CLASS = /^(?:u?int(?:8|16|32|64)|single)$/;
// The class a value keeps across an edit. A Value edit sets the VALUE, not the
// class — MATLAB's own `v(:) = 7` on an int32 stays int32, and the Data Type
// column is read-only here — but MatlabValueParser cannot know the class: a bare
// `7` always parses as 'double'. So the node's existing class beats the parser's
// default. Only the integer/single classes qualify: every number is representable
// in them, whereas keeping 'logical' would render `7` as `true`, which MATLAB
// rejects outright.
function classAfterEdit(current, parsedType) {
    return parsedType === 'double' && TYPED_NUMERIC_CLASS.test(current) ? current : parsedType;
}
// The class one ELEMENT of a numeric array carries. One MATLAB array is one class,
// so an element of an int32 array is an int32 and an element of a logical array is a
// logical. The element rows' hardcoded 'double' put 'int32' in the array's Data Type
// column and 'double' in the column of every row beneath it — one value described two
// ways, one of them wrong — and showed a logical array as [true false] over rows
// reading 1 and 0, leaking the 1/0 storage form into the UI.
//
// classAfterEdit's set plus 'logical'. For the integer/single classes this moves the
// Data Type column and nothing else, since they format through formatMatlabNum
// exactly as a double does. 'logical' additionally changes the element's icon and
// text (see icon and _formatScalar), which is the point: the row should look like the
// logical scalar it is, checkbox included. It is also why _setConstrainedValue has a
// logical arm — a row that reads 'true' has to accept 'true'.
//
// Cell and struct children never come through here: they are independent values, and
// their container has no one class to hand down.
function elementClass(arrayClass) {
    return TYPED_NUMERIC_CLASS.test(arrayClass) || arrayClass === 'logical' ? arrayClass : 'double';
}
// True when a scalar has to be written as the format's typed {_type,_value}
// literal rather than a bare JSON value. Both reasons are silent data loss:
// an int32/single written bare reads back as double (see TYPED_NUMERIC_CLASS),
// and JSON has no literal for Inf/NaN — JSON.stringify writes `null`, which reads
// back as 0. A `logical` normally travels as a JS boolean and needs no tag, except
// when it came from an array, whose elements the parser stores as 1/0.
function needsTypedLiteral(type, value) {
    if (TYPED_NUMERIC_CLASS.test(type)) {
        return true;
    }
    if (type === 'logical') {
        return typeof value !== 'boolean';
    }
    return typeof value === 'number' && !isFinite(value);
}
// Rank >= 3 gets a summary whatever its size: `mat2str` itself errors with "Input
// matrix must be 2-D." on an N-D array, so there is no MATLAB literal to match, and
// a bracketed string would be valid 2-D syntax describing only page 1. This is the
// rank half of DisplayConvention.needsSummary; wiring the element-count half into
// every display site is Phase 7's job and moves values MATLAB does have a literal
// for, so the two arrive separately.
function needsPageSummary(dims) {
    return effectiveDims(dims).length > 2;
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
            vals.push(val !== undefined ? formatMatlabNum(val) : '?');
        }
        rowStrs.push(vals.join(' '));
    }
    return '[' + rowStrs.join('; ') + ']';
}
function parseMatrixValue(raw) {
    const lines = raw._value.split('\n');
    const header = lines[0];
    // Rank 3 and up appear as Matrix(2,3,2) — MATLAB's binary dictionary writes a
    // 2x3x2 as Dimension="2*3*2", and BinarySlddParser now carries every extent
    // through. Only the two-group form was matched, so an N-D entry fell through
    // to the [0,0] empty node with all twelve of its elements gone.
    const dimsMatch = header.match(/^Matrix\((\d+(?:,\d+)*)\)$/);
    if (!dimsMatch) {
        return null;
    }
    const dims = dimsMatch[1].split(',').map(function (s) {
        return parseInt(s, 10);
    });
    const body = lines.slice(1).join('');
    const numbers = [];
    // Inf/-Inf/NaN are elements too, and a digits-only pattern would skip them —
    // shifting every later element one slot left and corrupting the whole matrix.
    const numMatches = body.match(/-?(?:[\d.]+(?:[eE][+-]?\d+)?|Inf|NaN)/g);
    if (numMatches) {
        numMatches.forEach(function (s) {
            numbers.push(parseMatlabNum(s));
        });
    }
    // A one-group header (Matrix(5)) has no MATLAB spelling but is cheap to accept
    // as the row vector it must mean, rather than handing back a rank-1 dims array
    // every downstream reader would have to special-case.
    return {
        dims: dims.length >= 2 ? dims : [1, dims[0] || 0],
        elements: numbers,
        type: raw._type,
    };
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
        this._varStale = false;
        this._isOpaque = false;
        this._opaqueClassName = null;
        this._mcosProperties = null;
        this._mcosValue = undefined;
        this._mcosDimensions = null;
        this._preCollapseDims = null;
    }
    // ---- Display: what the table columns show ----
    // Read-only projections of the state above — nothing here mutates (the one
    // exception, _serializeScalarXml's temporary _kind swap, is in the XML section
    // and restores it). Two rules recur: an opaque MCOS object is checked FIRST
    // because its class name and decoded value override the primitive spellings, and
    // once children exist they are the truth for element values while _elements is
    // the fallback for a not-yet-expanded container.
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
                // A logical array is a logical, so it gets the checkbox its scalar form has
                // always had — otherwise the container row looked like a plain double vector
                // while every element row under it carried a checkbox. Numeric classes have
                // no icon of their own: int32 and double are both wsDefault.
                return this._scalarType === 'logical' ? 'wsCheck' : 'wsDefault';
            case 'cell':
                return 'wsBrackets';
            case 'string':
                return 'wsString';
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
                    return this._mcosValue ? formatMatlabChar(this._mcosValue) : '<1x1 ' + this._opaqueClassName + '>';
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
            return formatMatlabChar(String(this._scalarValue));
        }
        if (this._scalarType === 'string') {
            return formatMatlabString(String(this._scalarValue));
        }
        if (this._scalarType === 'struct') {
            return '<' + this._dims.join('x') + ' struct>';
        }
        if (this._scalarType === 'logical') {
            return this._scalarValue ? 'true' : 'false';
        }
        return formatMatlabNum(this._scalarValue);
    }
    _formatArray() {
        // MATLAB has no bracketed literal for rank >= 3 — mat2str answers "Input matrix
        // must be 2-D." — and formatMatrix walks dims[0] x dims[1], so a 2x3x2 rendered
        // as page 1 alone and read as the plain 2x3 sitting beside it in the same
        // dictionary. A summary is the only honest one-line form; the elements are one
        // expand away and all twelve of them are there.
        if (needsPageSummary(this._dims)) {
            return summaryForm(this._dims, this.className);
        }
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
        // Rank >= 3, as in _formatArray: the rows x cols walk below showed four of a
        // 2x2x2's eight cells with nothing to say the other four existed.
        if (needsPageSummary(this._dims)) {
            return summaryForm(this._dims, 'cell');
        }
        const rows = this._dims[0];
        const cols = this._dims[1];
        const rowStrs = [];
        for (let r = 0; r < rows; r++) {
            const vals = [];
            for (let c = 0; c < cols; c++) {
                // A cell's element list is COLUMN-major -- MatParser's cell branch does
                // not transpose, unlike its numeric branch -- so display position (r,c)
                // is list index c*rows+r. Reading r*cols+c here transposed every
                // non-square cell's literal: MATLAB's {1 2 3; 4 5 6} printed as
                // {1, 4, 2; 5, 3, 6}. See test/cellElementOrder.test.ts.
                const child = this.children[c * rows + r];
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
            return formatMatlabString(String(this._elements[0]));
        }
        const rows = d[0];
        const cols = d[1];
        const rowStrs = [];
        for (let r = 0; r < rows; r++) {
            const vals = [];
            for (let c = 0; c < cols; c++) {
                // COLUMN-major, exactly as in _formatCell above: a string array's element
                // list is not transposed on the way in either.
                const el = this._elements[c * rows + r];
                vals.push(formatMatlabString(el !== undefined ? String(el) : ''));
            }
            rowStrs.push(vals.join(' '));
        }
        const strStr = '[' + rowStrs.join('; ') + ']';
        return strStr.length > 50 ? '<' + d.join('x') + ' string>' : strStr;
    }
    // ---- Property set + Property Inspector layout ----
    getProperties() {
        return [PropName, PropValue, PropDataType, PropDescription];
    }
    getPILayout() {
        // className is dynamic (double/int8/struct/the opaque MCOS class), so this
        // can't be schema-keyed; author the common "General" identity group directly.
        return [{ group: 'General', items: [PropName, PropValue, PropDataType, PropKind, PropClassAtom, PropDescription] }];
    }
    // ---- Edit + structural mutation (the only writers of the state above) ----
    // This is the section that makes the class one unit: it is the sole place that
    // reshapes a variable, and every reshape has to keep FOUR representations
    // agreed — _kind/_scalarType, _dims, _elements, and the child nodes — plus the
    // `serial` blob the JSON writer replays. Miss one and the symptom is silent data
    // loss, not a crash, which is what the long comments on the individual methods
    // are recording. The add/remove methods come in canX/xChildNode/execX triples:
    // the gate, the mutation, and the undo/redo wrapper the command stack calls.
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
    // An element of a numeric or string array, whose container fixes what it may
    // hold: one MATLAB array is one class, so an element cannot be retyped the way a
    // free-standing variable can (setProperty's other path). Reached only when
    // _isConstrainedChild() is true, i.e. the parent's kind is 'array' or 'string' —
    // the two the branch below is exhaustive over, which is why it has no third arm.
    _setConstrainedValue(stringValue) {
        const parent = this.parent;
        const isArrayElement = parent._kind === 'array';
        // A logical element is the one array element that does not display as a number,
        // so it is the one with its own accept set: true/false, plus 1/0 for the user who
        // types digits into every other array. Any other number is refused rather than
        // stored, because a logical array cannot hold it — the editor used to take 7 and
        // write {_type:'logical', _value:'[7, 0, 1]'}. MATLAB's own answer to L(1) = 7 is
        // to retype the whole ARRAY to double, which an element editor cannot express, so
        // refusing is the honest one here.
        const isLogicalElement = isArrayElement && parent._scalarType === 'logical';
        const parsed = MatlabValueParser.parse(stringValue);
        let accepted;
        if (isLogicalElement) {
            accepted = parsed?.type === 'logical' || (parsed?.type === 'double' && (parsed.value === 0 || parsed.value === 1));
        }
        else if (isArrayElement) {
            accepted = parsed?.type === 'double' && !Array.isArray(parsed.value);
        }
        else {
            accepted = parsed?.type === 'char' || parsed?.type === 'string';
        }
        if (!parsed || !accepted) {
            return {
                error: true,
                reason: isLogicalElement
                    ? 'Logical array elements must be true or false'
                    : isArrayElement
                        ? 'Array elements must be scalar numbers'
                        : 'String elements must be character or string values',
                invalidValue: stringValue,
                validValue: this.displayValue,
            };
        }
        // 1/0, never the boolean: _elements is the one representation the container's
        // display, its _var snapshot, and the typed literal all read, and the parsers
        // store a logical ARRAY as 1/0 (see parseTypedVector). An edited element must not
        // become the only boolean in it.
        this._scalarValue = isLogicalElement ? (parsed.value ? 1 : 0) : parsed.value;
        // elementClass, not 'double': the container fixes the element's class (this
        // method exists because of that), so re-stating 'double' here flipped an int32
        // element's Data Type column to double the moment its cell was committed.
        this._scalarType = isArrayElement ? elementClass(parent._scalarType) : 'string';
        if (!isArrayElement) {
            // A string-array element is a string-KIND node (see _makeStringElement), and
            // its own display and serialize paths read the text from _elements.
            this._elements = [parsed.value];
        }
        parent._syncElementFromChild(this);
        parent._rawInput = undefined;
        this._markModified();
        return true;
    }
    // Every edit routes through _markModified (DataNode), so this is the one place
    // that catches all of them — value edits, renames, add/remove child, and the
    // schema-prop path. Invalidate the parsed-variable snapshot on this node and on
    // every MatlabVariableNode above it, because the save path reads `_var` from the
    // TOP-LEVEL variable: a struct field's edit has to make the STRUCT's snapshot
    // stale, not just the field's own. See the _var getter for why.
    _markModified() {
        let node = this;
        while (node instanceof MatlabVariableNode) {
            node._varStale = true;
            node = node.parent;
        }
        super._markModified();
    }
    // Push an edited element's new value into this container's _elements slot.
    // _elements and the child nodes are two copies of the same data: the children
    // back the table rows, while _elements backs displayValue, the Value getter,
    // _var, and — once the array collapses back to a scalar or an element is
    // restored by undo — the value that survives. Leaving it stale silently
    // reverts the user's edit at that point.
    _syncElementFromChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0 && idx < this._elements.length) {
            this._elements[idx] = child._scalarValue;
        }
    }
    _applyParsed(parsed) {
        this.children = [];
        this._matVar = null;
        this._rawInput = undefined;
        // The class this node had going in. A numeric edit re-states the VALUE, not the
        // class, so classAfterEdit lets it survive the parser's 'double' default — see
        // its comment. Read before any arm overwrites it.
        const prevType = this._scalarType;
        if (parsed.type === 'double' && Array.isArray(parsed.value) && parsed.value.length === 1) {
            this._kind = 'scalar';
            this._scalarValue = parsed.value[0];
            this._scalarType = classAfterEdit(prevType, 'double');
            this._dims = [1, 1];
            this.serial = {};
        }
        else if (parsed.type === 'double' && Array.isArray(parsed.value)) {
            this._kind = 'array';
            this._elements = parsed.value;
            this._dims = parsed.dims;
            this._scalarType = classAfterEdit(prevType, 'double');
            this._syncArraySerial();
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
            this._scalarType = classAfterEdit(prevType, parsed.type);
            this._dims = [1, 1];
            this.serial = {};
        }
    }
    // The write-side twin of parseMatrixValue: `Matrix(d1,...,dn)` and one bracketed
    // group per row, pages in order. Emitting only rows x cols groups under a
    // `Matrix(r,c)` header dropped every page after the first of an N-D array as
    // soon as anything in the variable was edited.
    _buildMatrixString(dims, elements) {
        const rows = dims[0];
        const cols = dims[1];
        const rowStrs = [];
        const pages = Math.max(1, Math.floor(elements.length / Math.max(1, rows * cols)));
        for (let pg = 0; pg < pages; pg++) {
            const base = pg * rows * cols;
            for (let r = 0; r < rows; r++) {
                const vals = [];
                for (let c = 0; c < cols; c++) {
                    vals.push(formatMatlabNum(elements[base + r * cols + c]));
                }
                rowStrs.push('[' + vals.join(', ') + ']');
            }
        }
        return 'Matrix(' + dims.join(',') + ')\n' + rowStrs.join('\n');
    }
    _buildArrayChildren() {
        if (this._elements.length <= 1) {
            return;
        }
        for (let i = 0; i < this._elements.length; i++) {
            const child = MatlabVariableNode._createScalar(this._elements[i], elementClass(this._scalarType), String(i + 1), this);
            this.addChild(child);
        }
    }
    // One element of a string array, built as a string-KIND node rather than a
    // 'string'-typed scalar: the former serializes as a bare "" element, where
    // _createScalar('string') would produce a nested [""] array via
    // _serializeScalar. Shared by the parse, add, and undo paths so all three
    // build the identical shape — they used to construct it separately, and the
    // undo path's copy read the value back as if it were a scalar-kind child.
    _makeStringElement(name, value) {
        const child = new MatlabVariableNode(name, this, { _dimensions: [1, 1] });
        child._kind = 'string';
        child._elements = [value];
        child._dims = [1, 1];
        child._scalarValue = value;
        child._scalarType = 'string';
        return child;
    }
    _buildStringChildren() {
        if (this._elements.length <= 1) {
            return;
        }
        for (let i = 0; i < this._elements.length; i++) {
            this.addChild(this._makeStringElement(String(i + 1), this._elements[i]));
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
    // Turn an untyped `[]` into an empty 1x1 struct. Kept separate from
    // _convertToStructAndAddField so execAddChild's redo can re-apply the
    // conversion around the ORIGINAL field node instead of a fresh one.
    _becomeStruct() {
        this._kind = 'scalar';
        this._scalarType = 'struct';
        this._scalarValue = null;
        this._elements = [];
        this._dims = [1, 1];
        this.children = [];
        this.serial = {};
    }
    _convertToStructAndAddField() {
        this._becomeStruct();
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
        const child = MatlabVariableNode._createScalar(0, elementClass(this._scalarType), String(idx), this);
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
        const child = this._makeStringElement(String(this.children.length + 1), '');
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
                // Down to one element, so this is a scalar now — which means dropping the
                // surviving element's child row and the [1,n]/[n,1] orientation. Undo has
                // to put both back, so remember the orientation on the way out.
                // _scalarType is deliberately NOT touched: an int32 array whose extra
                // elements were removed is still an int32, and hardcoding 'double' here
                // silently reclassified it (and the XML writer then wrote Class="double").
                this._preCollapseDims = this._dims.slice();
                this._kind = 'scalar';
                this._scalarValue = this._elements[0];
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
                // Down to one element, so this renders as a scalar string: the surviving
                // element loses its child row and the [1,n]/[n,1] orientation goes to
                // [1,1]. Undo has to put both back, so remember the orientation on the
                // way out — the same bookkeeping _updateArrayAfterRemove does.
                this._preCollapseDims = this._dims.slice();
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
        if (this._kind === 'scalar') {
            // Undoing the removal that collapsed this array back to a scalar. The
            // surviving element lost its child row on the way down, so rebuild it here
            // before `child` is spliced in — otherwise the array comes back one element
            // short and every row after `index` shows the wrong value.
            const survivor = MatlabVariableNode._createScalar(this._scalarValue, elementClass(this._scalarType), '1', this);
            this._kind = 'array';
            this._elements = [this._scalarValue];
            this._scalarValue = undefined;
            // _scalarType stays as-is: the collapse preserved the array's MATLAB class on
            // the way down (see _updateArrayAfterRemove), so re-asserting 'double' here
            // would undo a removal by ALSO changing an int32/logical array to a double one.
            // Restore the row/column orientation the collapse discarded.
            this._dims = this._preCollapseDims ?? [1, 1];
            this._preCollapseDims = null;
            this.children = [survivor];
        }
        else if (this._kind === 'string' && this.children.length === 0 && this._elements.length === 1) {
            // The same collapse, for a string array. It stays kind 'string' (a scalar
            // string is still a string), so it needs its own condition — the survivor
            // dropped its child row and the orientation went to [1,1], and without
            // rebuilding both here the undone array comes back with one child for two
            // elements and a transposed shape.
            const survivor = this._makeStringElement('1', this._elements[0]);
            this._dims = this._preCollapseDims ?? [1, 1];
            this._preCollapseDims = null;
            this.children = [survivor];
        }
        this.children.splice(index, 0, child);
        child.parent = this;
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
            // A string-array element is a string-KIND node (see _makeStringElement), so
            // its text lives in _scalarValue regardless of kind. Reading it only when
            // _kind === 'scalar' — as the array branch above legitimately does, since
            // ITS children are scalar-kind — matched nothing here, so every undone
            // element came back as '' and the array silently lost its text.
            const restored = child._scalarValue;
            this._elements.splice(index, 0, typeof restored === 'string' ? restored : '');
            this._updateDimsForCount(this._elements.length);
        }
        this._reindexChildren();
        this._markModified();
    }
    execAddChild() {
        // Adding to an empty `[]` converts it to a struct, and that needs an undo/redo
        // pair the shared wrapper cannot express — see _addFirstStructField. Every
        // other shape takes the generic remove/restore pair.
        if (this._kind === 'array' && this._elements.length === 0) {
            return this.canAddChild() ? this._addFirstStructField() : null;
        }
        return addChildUndoable(this);
    }
    // Add the first field to an empty `[]`, turning it into a 1x1 struct. Undo has to
    // put back the array shape the conversion discarded — removeChildNode/
    // restoreChildNode only move a child within a shape that already exists — and
    // redo has to re-apply the conversion around the SAME field node undo removed.
    // Calling _convertToStructAndAddField again minted a second 'field' instead, so
    // the undo stack's node reference went stale: a following undo removed a node
    // that was no longer in the tree, and each undo/redo cycle left one more orphan
    // field behind.
    _addFirstStructField() {
        const prevSerial = { ...this.serial };
        const child = this._convertToStructAndAddField();
        const self = this;
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
                self._becomeStruct();
                self.addChild(child);
                self._markModified();
            },
        };
    }
    execRemoveChild(child) {
        return removeChildUndoable(this, child);
    }
    _updateDimsForCount(count) {
        if (this._dims[1] === 1) {
            this._dims = [count, 1];
        }
        else {
            this._dims = [1, count];
        }
    }
    // Re-render `serial` from the live _elements after the array's shape changed.
    // _serializeArray reads serial._type to decide whether to emit the typed literal,
    // so the tag is the ONLY carrier of the MATLAB class through the JSON writer:
    // hardcoding 'double' here — or dropping the tag entirely, which the bare
    // element-list form does — turned an int32/single/logical array into a double
    // array on the first add or remove. A matrix keeps the typed literal whatever its
    // class, because Matrix(r,c) has no bare JSON spelling at all.
    _syncArraySerial() {
        const typed = TYPED_NUMERIC_CLASS.test(this._scalarType) || this._scalarType === 'logical';
        if (this._dims[0] > 1 || typed) {
            this.serial = {
                _type: typed ? this._scalarType : 'double',
                _value: this._buildMatrixString(this._dims, this._elements),
            };
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
    // ---- JSON serialization (the .sldd text format) ----
    // Round-trip fidelity first: an untouched value returns its captured `_rawInput`
    // verbatim rather than being re-rendered, so only edited values are rewritten.
    // The recurring hazard is that JSON has no literal for Inf/NaN — JSON.stringify
    // turns them into `null`, which reads back as 0 — so the branches that spot a
    // non-finite number fall back to the format's typed `{_type, _value}` escape
    // hatch, which spells them out as text.
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
        }
    }
    _serializeScalar() {
        if (this._scalarType === 'string') {
            return [this._scalarValue];
        }
        if (this._scalarType === 'struct') {
            // Without this arm a struct falls through to `return this._scalarValue`,
            // which is null for a struct — the entry serializes to null and its
            // contents are gone, silently, on the first save. The .sldd path only
            // escapes because it takes the _rawInput early return; a MODIFIED .sldd
            // struct lands here too. Measured on cases.mat: all five struct entries.
            return this._serializeStructValue();
        }
        if (this._scalarType === 'complex') {
            return { _type: 'cdata', _value: this._scalarValue };
        }
        // The typed form is the format's own escape hatch for a value a bare JSON
        // scalar cannot carry — an integer/single class, or an Inf/NaN. See
        // needsTypedLiteral for why each one loses data written bare.
        if (needsTypedLiteral(this._scalarType, this._scalarValue)) {
            return { _type: this._scalarType, _value: formatMatlabNum(this._scalarValue) };
        }
        return this._scalarValue;
    }
    _serializeArray() {
        if (this._elements.length === 0) {
            return [];
        }
        if (this.children.length === 0) {
            return this.serial;
        }
        const elems = this.children.map(function (c) {
            return c._scalarValue;
        });
        const serialType = this.serial?._type;
        if (serialType) {
            return { _type: serialType, _value: this._buildMatrixString(this._dims, elems) };
        }
        // A bare JSON array cannot carry Inf/NaN (JSON.stringify writes `null`), so
        // fall back to the typed-vector literal, which spells them out as text.
        if (elems.some((v) => typeof v === 'number' && !isFinite(v))) {
            return { _type: 'double', _value: '[' + elems.map(formatMatlabNum).join(', ') + ']' };
        }
        // A bare JSON array has nowhere to carry [2,3] or [2,3,2] either, so a matrix
        // written that way read back as a 1xN — and because the children are row-major
        // even the element order was wrong against MATLAB's column-major
        // linearization. Only a true vector may serialize bare; anything with two
        // spread extents takes the typed Matrix() literal, which is the shaped form
        // both readers already accept (there is no `_array_type: 'Matrix'`).
        const d = effectiveDims(this._dims);
        if (d.length <= 2 && (d[0] === 1 || d[1] === 1)) {
            return this.children.map(function (c) {
                return c.serializeValue();
            });
        }
        return { _type: this._scalarType || 'double', _value: this._buildMatrixString(d, elems) };
    }
    // The `_array_type: 'Struct'` form, rebuilt from the tree. Deliberately the same
    // shape BinarySlddParser.structValue produces and a text .sldd carries in
    // _rawInput, so a struct read from a .mat and written to a dictionary
    // round-trips through the existing reader (NodeClassMap -> StructNode.parse)
    // unchanged.
    _serializeStructValue() {
        const dims = effectiveDims(this._dims);
        // A .mat struct ARRAY hangs its ELEMENTS off this node (named 1..N, each a
        // struct-kind node whose own children are the fields); a 1x1 hangs the fields
        // directly. StructNode owns neither case on the .mat path, so both are here —
        // reading this node's children as fields unconditionally would have named a
        // 2x3's six elements '1'..'6' and written six garbage fields.
        const elementNodes = elementCount(dims) > 1 ? this.children : [this];
        const fields = [];
        const elements = [];
        for (const el of elementNodes) {
            const bag = {};
            for (const child of el.children) {
                const c = child;
                bag[c.name] = c.serializeValue();
                if (!fields.includes(c.name)) {
                    fields.push(c.name);
                }
            }
            elements.push(bag);
        }
        return {
            _array_type: 'Struct',
            _dimensions: dims,
            _elements: elements,
            _fields: fields,
            _mw_element_type: 'MATLABArray',
        };
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
    // ---- XML serialization (the .slx workspace format) ----
    // A parallel set of per-kind writers rather than a reuse of the JSON ones,
    // because the two formats disagree on essentials: XML is explicitly typed by a
    // Class= attribute, carries dimensions as "rows*cols", and — the reason these
    // can't share the JSON traversal — stores matrix elements in COLUMN-major order,
    // hence transposeToColumnMajorND on the way out.
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
        // Every extent, not just the first two: an N-D array written as Dimension="2*3"
        // claimed a shape it does not have AND, because the rank-2 transpose fills only
        // rows x cols slots of its result, emitted the remaining pages as empty text —
        // half a 2x3x2 gone from the .slx on save.
        const dimAttr = dims.join('*');
        let attrStr = '';
        if (attrs && attrs.Name) {
            attrStr += ' Name="' + escapeXml(attrs.Name) + '"';
        }
        if (rows === 0 || cols === 0 || (this._elements.length === 0 && this.children.length === 0)) {
            return (p + '<' + tagName + attrStr + ' Class="' + (type || 'double') + '" Dimension="' + dimAttr + '"/>');
        }
        const elems = this.children.length > 0
            ? this.children.map(function (c) {
                return c._scalarValue;
            })
            : this._elements;
        if (type === 'complex' ||
            (elems.length > 0 && typeof elems[0] === 'string' && elems[0].includes('i'))) {
            const colMajor = transposeToColumnMajorND(elems, dims);
            const formatted = colMajor.map(function (v) {
                return formatComplexXml(String(v));
            });
            return (p +
                '<' +
                tagName +
                attrStr +
                ' Class="double" IsComplex="1" Dimension="' +
                dimAttr +
                '">' +
                formatted.join(' ') +
                '</' +
                tagName +
                '>');
        }
        const colMajor = transposeToColumnMajorND(elems, dims);
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
            dimAttr +
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
        // dims.join, so a 2x3x2 cell keeps its third extent here as it does in
        // _serializeCellPropertyXml and in what MATLAB itself writes.
        let xml = p + '<' + tagName + attrStr + ' Class="cell" Dimension="' + dims.join('*') + '">\n';
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
        if (!(dims.length <= 2 && dims[0] === 1 && dims[1] === 1)) {
            xml += ' Dimension="' + dims.join('*') + '"';
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
    // ---- Binary rebuild: the MatVariable the .mat/.slx save path writes ----
    //
    // The MatVariable the save path writes (MatNode.getVariables, and the .slx
    // workspace splice in ModelNode.serialize).
    //
    // `_matVar` is the variable exactly as the parser read it, kept so an untouched
    // variable round-trips byte-for-byte through its `_rawBytes`. But it is a
    // SNAPSHOT: editing a CHILD of this node — an array element, a struct field, a
    // cell entry — mutates the child nodes, not this object, so returning the
    // snapshot wrote the ORIGINAL value back and silently discarded the edit. Only
    // a whole-variable `setProperty('Value', …)` escaped it, because _applyParsed
    // clears the cache; that made the bug look shape-dependent rather than what it
    // is, an edit-depth one.
    //
    // A numeric array happened to survive because `_elements` is the very array
    // `_matVar.value` points at, so element edits landed in both — an aliasing
    // accident, not a design. Struct fields and cell entries hold child NODES and
    // had no such alias, so their edits were lost outright.
    //
    // So once anything below this node changes, the snapshot is no longer the truth
    // and we rebuild from the live tree. `_rawBytes` stays on the rebuilt variable
    // for the parts of the write path that still replay bytes for untouched values.
    get _var() {
        if (this._matVar && !this._varStale) {
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
            if (elementCount(this._dims) > 1) {
                // A struct ARRAY models one child per ELEMENT, each holding that
                // element's fields, so a field rebuilds as one MatVariable per element
                // in the same column-major order MatParser read. This replaces a
                // replay-from-snapshot compensation that could only ever speak for
                // element 1 — an edit to element 2 was silently discarded on save.
                const fieldNames = [];
                for (const elem of this.children) {
                    for (const f of elem.children) {
                        if (fieldNames.indexOf(f.name) < 0) {
                            fieldNames.push(f.name);
                        }
                    }
                }
                for (const fname of fieldNames) {
                    fields[fname] = this.children.map(function (elem) {
                        const f = elem.children.find(function (c) {
                            return c.name === fname;
                        });
                        // A MATLAB struct array is homogeneous, so every element has every
                        // field — but a whole-value edit ON an element node clears its
                        // children (_applyParsed), and a save must not throw on the way to
                        // the writer. An empty [] holds the element's slot; dropping it would
                        // slide every later element one position early.
                        return f ? f._var : emptyDouble();
                    });
                }
            }
            else {
                for (const child of this.children) {
                    fields[child.name] = child._var;
                }
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
    // ---- Static factories: binary MatVariable -> node ----
    // The entry point is parseMatVariable, which dispatches on the parsed
    // className; the _createFromMat* helpers below are its per-class arms. All of
    // them keep the source `variable` on _matVar and its bytes on _rawBytes, which
    // is what lets an untouched variable round-trip byte-for-byte (see the _var
    // getter). These are statics rather than constructor overloads because the shape
    // isn't known until the value has been inspected.
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
            const child = MatlabVariableNode._createScalar(el, elementClass(node._scalarType), String(i + 1), node);
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
        if (!variable.fields) {
            return node;
        }
        const fieldNames = Object.keys(variable.fields);
        const count = elementCount(node._dims);
        if (count <= 1) {
            for (const fieldName of fieldNames) {
                const fieldVar = variable.fields[fieldName];
                // A 1x1 struct stores the field directly, but tolerate the array form.
                const childVar = Array.isArray(fieldVar) ? fieldVar[0] : fieldVar;
                if (childVar) {
                    node.addChild(MatlabVariableNode.parseMatVariable(childVar, fieldName, node));
                }
            }
            return node;
        }
        // A struct ARRAY gets one child per element, each holding that element's own
        // fields. Keeping only fields[f][0] used to make every element after the
        // first invisible, and forced _buildVarObject to replay them from the parse
        // snapshot on save. MatParser fills fields[f] in MATLAB's column-major
        // order, so element ei is MATLAB's linear index ei+1.
        for (let ei = 0; ei < count; ei++) {
            const elemNode = new MatlabVariableNode(String(ei + 1), node, {});
            elemNode._kind = 'scalar';
            elemNode._scalarType = 'struct';
            elemNode._scalarValue = null;
            elemNode._dims = [1, 1];
            elemNode._displayName = subscriptLabel(name, ei, node._dims, 'column-major', '()');
            for (const fieldName of fieldNames) {
                const fieldVar = variable.fields[fieldName];
                const childVar = Array.isArray(fieldVar) ? fieldVar[ei] : fieldVar;
                if (childVar) {
                    elemNode.addChild(MatlabVariableNode.parseMatVariable(childVar, fieldName, elemNode));
                }
            }
            node.addChild(elemNode);
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
            // MatParser records a slot it could not read as a MATRIX — a truncated or
            // otherwise malformed cell — as null. Skipping those used to COMPACT the
            // child list while _dims kept the declared shape, so every later element
            // slid into the wrong slot: `{[], 2, 3}` displayed as `{2, 3, []}`, and the
            // cell rebuilt for the save path put 2 and 3 one position early. A hole
            // becomes an explicit empty 0x0 double instead, which is both what MATLAB
            // itself shows for an empty cell slot and a value that writes back cleanly.
            const child = MatlabVariableNode.parseMatVariable(cell ?? emptyDouble(), String(i + 1), node);
            node.addChild(child);
        });
        return node;
    }
    // ---- Static factories: JSON value -> node ----
    // `parse` is the single entry point (NodeClassMap routes to it) and the rest are
    // its arms, one per on-disk spelling of a value: the typed {_type,_value}
    // literals, cdata (both the bit-packed and the plain-text complex forms), the
    // structured {_array_type} containers, and the bare JSON scalar/array. They are
    // separate named statics rather than one long switch mainly so the .sldd tests
    // can drive an individual spelling directly. Each stashes the untouched input on
    // `_rawInput` so serializeValue can replay it verbatim.
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
            node._scalarValue = parseMatlabNum(rawVal._value.replace(/[FU]$/, ''));
        }
        return node;
    }
    static parseCdata(rawVal, name, parent) {
        const valStr = rawVal._value;
        if (/^[\d.eE+\-i\s]+$/.test(valStr)) {
            return MatlabVariableNode._parseCdataText(rawVal, name, parent);
        }
        try {
            const bytes = uudecode(valStr);
            const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            // 8-byte preamble, then one miMATRIX element: tag (type, byte count) at 8,
            // payload at 16.
            const tagType = dv.getUint32(8, true);
            const tagSize = dv.getUint32(12, true);
            if (tagType !== MI_MATRIX) {
                throw new Error('cdata is not a MAT matrix element');
            }
            const variable = parseMatrix(dv, 16, tagSize);
            const node = MatlabVariableNode.parseMatVariable(variable, name, parent);
            // parseMatVariable's factories set _matVar/_rawBytes but not _rawInput, and
            // an untouched node writes itself back by replaying _rawInput verbatim. Set
            // it so a cdata entry nobody edited still round-trips byte-identical.
            node._rawInput = rawVal;
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
        // Every extent, and every page. MATLAB writes a complex 2x3x2 as
        // `IsComplex="1" Dimension="2*3*2"` with twelve column-major values, and
        // BinarySlddParser hands all three extents through; a loop over dims[0] x dims[1]
        // consumed six of the twelve and set _dims = [2,3], so a plain open-and-save
        // wrote MATLAB's own file back with its entire second page missing.
        const dims = effectiveDims(rawVal._dimensions || [1, colMajorParts.length]);
        const parts = transposeFromColumnMajorND(colMajorParts, dims);
        const node = new MatlabVariableNode(name, parent, rawVal);
        node._rawInput = rawVal;
        node._kind = 'array';
        node._scalarType = 'double';
        node._dims = dims;
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
            node._elements = parts.map(parseMatlabNum);
        }
        node._dims = [1, node._elements.length];
        if (node._elements.length > 1) {
            node._elements.forEach(function (el, i) {
                const child = MatlabVariableNode._createScalar(el, elementClass(node._scalarType), String(i + 1), node);
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
                // elementClass, not the 'double' literal, even though the class above IS
                // 'double': every element builder states the rule the same way, so none of
                // them can drift out of step with the container again.
                const child = MatlabVariableNode._createScalar(el, elementClass(node._scalarType), String(i + 1), node);
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
        node._dims = parsed.dims.slice();
        node._scalarType = parsed.type;
        if (parsed.elements.length > 1) {
            parsed.elements.forEach(function (el, i) {
                const child = MatlabVariableNode._createScalar(el, elementClass(node._scalarType), String(i + 1), node);
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