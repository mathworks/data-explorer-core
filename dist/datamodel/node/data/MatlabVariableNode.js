// Copyright 2026 The MathWorks, Inc.
import DataNode from '../DataNode.js';
import { matlabVariableKind } from '../../kindMap.js';
import { addChildUndoable, removeChildUndoable } from '../childEdit.js';
import * as NodeRegistry from '../NodeRegistry.js';
import { OBJECT_ICON } from '../icons.js';
import PropName from '../../prop/PropName.js';
import PropValue from '../../prop/PropValue.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
import PropKind from '../../prop/PropKind.js';
import PropClassAtom from '../../prop/PropClass.js';
import MatlabValueParser, { formatMatlabChar, formatMatlabString } from '../../parser/MatlabValueParser.js';
import { NOT_AVAILABLE } from '../../parser/McosParser.js';
import { mcosDecodedFor } from './mcosDecodedTable.js';
import { subscriptLabel } from '../../display/Subscript.js';
import { decodeMatStream } from '../../parser/MatParser.js';
import { isMatCdata, uudecode, uuencode } from '../../parser/CdataCodec.js';
import { encodedClass, encodedStream, encodedXml, hexValue, isEncodedValue, matStreamPrefix, recordDecodeFailure, } from '../../parser/EncodedValue.js';
import { encodeMatStream, matStreamOfElement } from '../../parser/MatWriter.js';
import { EMPTY_CELL, EMPTY_NUMERIC, MAX_EXPANDED_ELEMENTS, effectiveDims, elementCount, needsSummary, overCharBudget, sparseSummaryForm, summaryForm, } from '../../display/DisplayConvention.js';
import { charNeedsShape, charTextFromCodes, escapeXml, formatDoubleXml, formatNumericXml, formatComplexBodyXml, formatComplexNum, formatMatlabNum, formatMxCharSerial, formatNumLiteral, formatMatrixSerial, parseMatlabNum, parseExactNum, parseComplexNum, complexClassTag, isExactToken, isNonzeroElement, needsExactInt, exactForClass, transposeToColumnMajorND, transposeFromColumnMajorND, pad as xmlPad, } from '../../parser/XmlUtils.js';
import { TYPED_NUMERIC_CLASS, classAfterEdit, elementClass, emptyDouble, formatCharMatrix, formatMatrix, formatStringElement, needsTypedLiteral, parseMatrixValue, } from './matlabValueRules.js';
// ---- Node-local tables ----
// The pure rules about a MATLAB VALUE — what class an edit leaves behind, when a
// number needs a typed spelling, how a matrix prints and parses back — live in
// matlabValueRules.ts, which reads no node state and so could stop being part of
// this file. What stays here is the two module-level facts that are about THIS
// NODE's own jobs rather than about the value it holds: the icon a tree row shows
// for an opaque object, and the one MAT-file tag the cdata reader below looks for.
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
    // Not a Simulink class: a `string` reaches the opaque path because MATLAB stores it as
    // an MCOS object, and without this entry the same string array that shows a string icon
    // out of a dictionary showed the default one out of a .mat.
    string: 'wsString',
};
/**
 * Does a binary dictionary have to hold this variable as hex? When it holds a sparse array,
 * an MCOS object, or a value of a class MatParser does not model (a function handle is
 * one) anywhere inside it — the values XML has no spelling for, which is MATLAB's own rule
 * for when it writes `Encoding="hex"` (see _binaryEncoded).
 */
function needsHexInBinary(variable) {
    const stack = [variable];
    while (stack.length > 0) {
        const v = stack.pop();
        if (v.isSparse || v.isOpaque || v.className === 'unknown') {
            return true;
        }
        for (const field of Object.values(v.fields ?? {})) {
            stack.push(...(Array.isArray(field) ? field : [field]));
        }
        if (v.className === 'cell' && Array.isArray(v.value)) {
            for (const cell of v.value) {
                if (cell) {
                    stack.push(cell);
                }
            }
        }
    }
    return false;
}
/**
 * MATLAB's class(value) for a variable, which is what a hex element's `Class` says: a
 * logical is 'logical' however the variable came to be, where the node layer rebuilds one
 * as MAT class uint8 with the logical flag (_buildVarObject).
 */
function matlabClassOf(variable) {
    return variable.isLogical ? 'logical' : variable.className;
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
        this._isSparse = false;
        this._sparseSlots = null;
        this._undecoded = false;
        this._opaqueClassName = null;
        this._mcosProperties = null;
        this._mcosValue = undefined;
        this._mcosDimensions = null;
        this._preCollapseDims = null;
        this._elementType = null;
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
            return this._liveElements();
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
    /**
     * Every element of this array as it stands, edits included, row-major: the value the
     * writers and the projections read. Off the child rows where they are the elements —
     * an edit lands in the row first — and off `_elements` otherwise: an array never
     * expanded, and a sparse one, whose rows are only its non-zeros. A sparse row's edit
     * reaches `_elements` as it is made (_syncElementFromChild), so the whole value is
     * there.
     */
    _liveElements() {
        if (this._isSparse || this.children.length === 0) {
            return this._elements;
        }
        return this.children.map(function (c) {
            return c._scalarValue;
        });
    }
    get dims() {
        // An opaque MCOS object's shape is the one the decoder recovered, not _dims —
        // which no opaque path ever sets, so it is the [1,1] the constructor left. That
        // was the only shape available while the decoder had nothing better; a `string`
        // now carries MATLAB's own size() from its payload, and a 1x3 reporting 1x1 here
        // would contradict the summary the same node displays.
        if (this._isOpaque) {
            return this._mcosDimensions || this._dims;
        }
        // A char is measured in CHARACTERS, and the bare-JSON-string channel hands one
        // over with no shape at all, so _dims is [1,1] there however long the text is.
        // Reporting that made the accessor the only channel disagreeing with MATLAB's
        // size(): the display, the writers and the .mat snapshot all read _textDims, and
        // a consumer asking for the 1x4 'it''s' was told 1x1 (defect 25).
        if (this._kind === 'scalar' && this._scalarType === 'char') {
            return this._textDims(this._scalarValue === null || this._scalarValue === undefined ? '' : String(this._scalarValue));
        }
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
            // An MCOS object of a class with no branded icon is still an OBJECT, so it
            // gets the object glyph rather than the plain-variable one — the same answer
            // the dictionary path's ObjectNode gives for the same class.
            return MCOS_ICON_MAP[this._opaqueClassName] || OBJECT_ICON;
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
                // The pre-MCOS class-3 object, which reaches the scalar arm as a recorded-
                // but-undecoded placeholder whose `_scalarType` is the class MATLAB wrote
                // ('object' — see MatParser's CLASS_NAMES). Not decoding it is a limit of
                // the reader; calling it a plain variable in the tree would be a claim
                // about the DATA, and the placeholder in its Value cell already says so.
                if (this._scalarType === 'object') {
                    return OBJECT_ICON;
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
        if (this._isOpaque) {
            // `string` is the one exception: it arrives as an opaque MCOS object because
            // MATLAB implements it as one, but it IS a MATLAB data type, so a string
            // variable out of a .mat belongs in the DataType column alongside the one out
            // of a dictionary rather than showing a blank cell.
            return this._opaqueClassName === 'string' ? 'string' : '';
        }
        return this.className;
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
    // The rule just below, said from the parent's side so a child of ANOTHER class obeys
    // it too: a decoded MCOS object in a struct field is a ParameterNode or a BusNode, and
    // without this its name alone among the fields offered a rename. That rename could
    // not reach the file either — it does not mark the struct's `_var` stale, so the
    // struct would go on describing the field by its old name.
    get fixesChildNames() {
        return true;
    }
    get nameEditable() {
        // Inside a value still in its encoded stream, the names are part of the stream; the
        // node holding the stream keeps its own (BaseNode.nameEditable says the same).
        if (this._encodedReadOnly && !this._encoded) {
            return false;
        }
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
        // An ELEMENT of an opaque value is as read-only as the value: a decoded `string`
        // array is the first opaque node with children at all, and its elements display real
        // editable-looking text ("alpha"), so without this they would have offered an editor
        // whose commit could not reach the file.
        if (this.parent instanceof MatlabVariableNode && this.parent._isOpaque) {
            return false;
        }
        if (this._scalarType === 'struct') {
            return false;
        }
        // Nothing here writes a function handle except by replaying the one it was read as.
        if (this._scalarType === 'function_handle') {
            return false;
        }
        // The "value unrecoverable" placeholder has no real value to edit.
        if (this._scalarValue === NOT_AVAILABLE) {
            return false;
        }
        // A cell whose literal shows an element as a summary (_literalRoundTrips): the
        // literal is not the cell's value, so it is not an editor's seed.
        if (this._kind === 'cell' && !this._literalRoundTrips()) {
            return false;
        }
        // Then BaseNode's rule: a value that DISPLAYS as a <mxn class> summary gets no
        // editor. It has to be consulted here too — returning a bare `true` shadowed
        // it, so a summarized 2x3x2 offered an editor seeded with the text
        // '<2x3x2 double>', and committing that cell unchanged replaced twelve
        // elements with an unparseable string.
        return super.valueEditable;
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
            // A `string` whose payload decoded is an opaque node that nonetheless HAS a value:
            // _adoptStringPayload gave it the same _kind/_dims/_elements a dictionary string
            // array carries, so it renders through the one string formatter and matches the
            // other three formats character for character. A payload that did not decode never
            // adopts that kind, stays the scalar-kind shell the constructor made, and falls
            // through to the summary below — which is still its true shape.
            if (this._kind === 'string') {
                return this._formatString();
            }
            if (this._mcosValue !== undefined && this._mcosValue !== null) {
                if (typeof this._mcosValue === 'number')
                    return String(this._mcosValue);
                if (typeof this._mcosValue === 'string')
                    return this._mcosValue
                        ? formatMatlabChar(this._mcosValue)
                        : summaryForm(this._mcosDimensions || [1, 1], this._opaqueClassName || 'double');
                if (Array.isArray(this._mcosValue)) {
                    const dims = this._mcosDimensions || [1, this._mcosValue.length];
                    // Angle brackets, like every other summary: square brackets read as a
                    // MATLAB literal, and the consumer table keys its gray/italic styling
                    // (and its no-editor rule) on the angle-bracket form.
                    return summaryForm(dims, this._opaqueClassName || 'double');
                }
            }
            // No value to print: the shape and the class are all there is. The shape used
            // to be a hardcoded [1,1], which is right for every scalar object and wrong for
            // a `string` array — one object holding a 1x3 displayed as <1x1 string>.
            return summaryForm(this._mcosDimensions || [1, 1], this._opaqueClassName || 'double');
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
        if (this._undecoded) {
            return String(this._scalarValue);
        }
        // char and a scalar string have no child rows, so the cell is the only place
        // the value is ever visible and the char budget is the only rule that applies:
        // a realistic description shows in full, a 1500-character blob does not take
        // the row over. Summarized at the value's real 1xN size, which is what MATLAB's
        // size() reports for a char row vector — the JS-string parse path stores [1,1]
        // because it never knew the length, so derive it when _dims cannot account for
        // the characters.
        if (this._scalarType === 'char') {
            const s = String(this._scalarValue);
            const dims = this._textDims(s);
            // Rank >= 3 gets the summary every other class gets there: there is no MATLAB
            // one-line print of a 2x3x2, of chars or of anything else. It used to print as
            // one quoted 12-character string, which is not the value — it is the storage.
            if (dims.length > 2) {
                return summaryForm(dims, 'char');
            }
            // A char with more than one ROW is a char MATRIX and prints as one. The old
            // single-quoted spelling showed MATLAB's 2x2 ['ab'; 'cd'] as 'acbd' — the
            // column-major storage read out as if it were text, so both the shape and the
            // reading order were wrong on screen (defect 25).
            const text = dims[0] > 1 ? formatCharMatrix(s, dims) : formatMatlabChar(s);
            return overCharBudget(text) ? summaryForm(dims, 'char') : text;
        }
        // A string scalar stays 1x1 however long its text is — a MATLAB string holds
        // the text, it is not made of it — so no _textDims here.
        if (this._scalarType === 'string') {
            const text = formatMatlabString(String(this._scalarValue));
            return overCharBudget(text) ? summaryForm(this._dims, 'string') : text;
        }
        if (this._scalarType === 'struct') {
            // Always a summary, at every size: MATLAB never prints a struct inline.
            // summaryForm normalizes through effectiveDims, so a struct whose _dims was
            // never set prints '<1x1 struct>' rather than the '< struct>' the raw join
            // produced.
            return summaryForm(this._dims, 'struct');
        }
        if (this._scalarType === 'logical') {
            return this._scalarValue ? 'true' : 'false';
        }
        if (this._scalarType === 'function_handle') {
            // MATLAB's own display: `@sin` for a named function, the text as it stands for an
            // anonymous one, which already opens with its `@`.
            const text = String(this._scalarValue);
            return text.startsWith('@') ? text : '@' + text;
        }
        return formatMatlabNum(this._scalarValue);
    }
    // The real extents of a char value. _dims wins when it accounts for every
    // character (a 2x5 char array from a .mat file, MATLAB's mxchar literal, a
    // Dimension= attribute), otherwise the value came in as a bare JSON string that
    // never carried a shape — so it is a plain row vector and its length is its second
    // extent. Empty text is 0x0, which is what MATLAB's '' is: numel 0 and isempty
    // true, where the [1,1] the string path leaves behind would claim one character.
    //
    // Every channel that needs a char's shape reads it from here — the display, the
    // `dims` accessor, both .sldd writers and the .mat writer — so there is one answer
    // rather than five.
    _textDims(text) {
        if (text === '') {
            return elementCount(this._dims) === 0 ? this._dims : [0, 0];
        }
        return elementCount(this._dims) === text.length ? this._dims : [1, text.length];
    }
    _formatArray() {
        // A sparse array is its summary at every size, empty included, and never a dense
        // literal (DisplayConvention.sparseSummaryForm says why); its non-zeros are its rows.
        if (this._isSparse) {
            return sparseSummaryForm(this._dims, this.className);
        }
        const elems = this._liveElements();
        if (elems.length === 0) {
            return EMPTY_NUMERIC;
        }
        // Rank >= 3 (mat2str answers "Input matrix must be 2-D." — a bracketed string
        // would be valid 2-D syntax describing only page 1), or more elements than a
        // one-line literal should carry. The elements are expandable child rows, so
        // the count rule applies and the user loses nothing: they are one click away.
        if (needsSummary(this._dims)) {
            return summaryForm(this._dims, this.className);
        }
        const formatted = this._scalarType === 'logical'
            ? elems.map(function (v) {
                return v ? 'true' : 'false';
            })
            : elems;
        const text = formatMatrix(this._dims[0], this._dims[1], formatted);
        // The count rule alone is not a bound on LENGTH: ten 200-character elements
        // are still a 2000-character cell. The char budget is the runaway guard.
        return overCharBudget(text) ? summaryForm(this._dims, this.className) : text;
    }
    _formatCell() {
        if (this.children.length === 0) {
            return EMPTY_CELL;
        }
        // Rank >= 3 (the rows x cols walk below showed four of a 2x2x2's eight cells
        // with nothing to say the other four existed), or past the element budget.
        if (needsSummary(this._dims)) {
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
                vals.push(child ? this._cellLiteralElement(child) : EMPTY_NUMERIC);
            }
            rowStrs.push(vals.join(', '));
        }
        const text = '{' + rowStrs.join('; ') + '}';
        // Under the element budget but over the char budget: a 1x4 cell of 300-char
        // strings is a 1200-character table cell. Angle brackets, not the old
        // '{1x4 cell}' — only the angle form reads as a summary downstream.
        return overCharBudget(text) ? summaryForm(this._dims, 'cell') : text;
    }
    // One element as this cell's one-line literal spells it: its own displayValue, except
    // for an MCOS object read out of a .mat file or a model workspace, which keeps EXACTLY
    // the token it printed here before the container decoded nested objects — `<1x1
    // Class>`, whatever the object's shape: `{<1x1 Simulink.Parameter>, 9}`, not `{42, 9}`,
    // and `<1x1 string>` for a 1x3 string or a 0x0 one. The element's own row shows the
    // object, shape and all; what MATLAB prints for a container of objects is a separate
    // question, and this literal is deliberately left as it was until that one is answered.
    // `[1, 1]` is therefore not a guess at a shape: it is the old token, which never had
    // one, because an undecoded opaque was never told its dimensions.
    //
    // Only a cell parsed out of MAT bytes (`_matVar` set) is affected, and in one of those
    // every element node is parseMatVariable's: a node of any class but this one is a
    // decoded object, and an opaque one of this class is an object decoded or not. A cell
    // from a dictionary builds its elements through the registry and is left alone. A cell
    // nested in this one prints its own literal by the same rule.
    _cellLiteralElement(child) {
        if (this._matVar) {
            if (!(child instanceof MatlabVariableNode)) {
                return summaryForm([1, 1], child.className);
            }
            if (child._isOpaque) {
                return summaryForm([1, 1], child._opaqueClassName || 'double');
            }
        }
        return child.displayValue;
    }
    /**
     * Is this cell's one-line literal its value written out? Not when an element's token in
     * it is a summary — a sparse array's `<1x3 sparse double>` at any size, a large array's
     * `<4x3 double>`, a struct's, an object's — or a nested cell's literal holds one: a
     * summary is not the value, and the literal read back as text makes it char cells.
     */
    _literalRoundTrips() {
        return this.children.every((c) => {
            const token = this._cellLiteralElement(c);
            if (token.charAt(0) === '<' && token.charAt(token.length - 1) === '>') {
                return false;
            }
            return !(c instanceof MatlabVariableNode && c._kind === 'cell') || c._literalRoundTrips();
        });
    }
    _formatString() {
        const d = this._dims;
        if (d[0] === 1 && d[1] === 1 && this._elements.length === 1) {
            // A scalar string has no child rows, so the char budget is the rule — same
            // as the char arm of _formatScalar.
            const text = formatStringElement(this._elements[0]);
            return overCharBudget(text) ? summaryForm(d, 'string') : text;
        }
        if (needsSummary(d)) {
            return summaryForm(d, 'string');
        }
        // strings(0,0) — the empty-value spelling, as _formatArray and _formatCell do for
        // their own kinds. Without this the loops below produce a bare '[]', which is not the
        // convention's spelling and is one character from a scalar that happens to be empty.
        if (this._elements.length === 0) {
            return EMPTY_NUMERIC;
        }
        const rows = d[0];
        const cols = d[1];
        const rowStrs = [];
        for (let r = 0; r < rows; r++) {
            const vals = [];
            for (let c = 0; c < cols; c++) {
                // COLUMN-major, exactly as in _formatCell above: a string array's element
                // list is not transposed on the way in either.
                vals.push(formatStringElement(this._elements[c * rows + r]));
            }
            rowStrs.push(vals.join(' '));
        }
        const text = '[' + rowStrs.join('; ') + ']';
        return overCharBudget(text) ? summaryForm(d, 'string') : text;
    }
    /**
     * Every element's label and displayed value — the two strings an element ROW
     * carries — whether or not this array was expanded into element children.
     *
     * The consuming extension's Variable Editor grid is drawn from these. It used to
     * read them off the child nodes, which tied a read-only panel the user opens
     * deliberately to a decision made for the TABLE: MAX_EXPANDED_ELEMENTS stops a
     * 1000x1000 from becoming a million rows nobody scrolls, and took the grid's data
     * with it. This accessor is the separation. The table's limit stays where it is,
     * and the panel asks for the elements when it is opened — so the cost of a million
     * of them is paid by the gesture that wanted them, and by nothing else.
     *
     * `label` is the subscript form, from the same function BaseNode.displayName calls
     * and with the same order/bracket rules; `value` is the element's displayValue.
     * Where the children DO exist they ARE the answer — not a second derivation of it —
     * so the two paths cannot drift apart. test/displayElements.test.ts pins that
     * agreement rather than either path alone.
     *
     * One exception, and it is the cell literal's: an MCOS object in a cell parsed out of
     * MAT bytes is spelled as _cellLiteralElement spells it, `<1x1 Class>`, because the
     * grid is part of the cell's own presentation and that did not change when nested
     * objects started to decode. The element's ROW shows the object; the grid and the
     * one-line literal show what they always did, and agree with each other.
     *
     * And one array whose children are not its elements: a sparse one's rows are its
     * non-zeros, and the grid is still every element, zeros included, each labelled with
     * both subscripts as its rows are. The grid places a cell by its label and draws
     * nothing for a matrix with a cell unlabelled, so a list of the non-zeros would leave
     * every sparse matrix without one. Every row is one of these entries.
     *
     * null for a kind that has no elements (a scalar, a struct, an object): an empty
     * list is a different and also true answer, meaning an array with nothing in it.
     */
    displayElements() {
        if (this._kind !== 'array' && this._kind !== 'cell' && this._kind !== 'string') {
            return null;
        }
        if (this.children.length > 0 && !this._isSparse) {
            return this.children.map((c) => ({
                label: c.displayName,
                value: this._kind === 'cell' ? this._cellLiteralElement(c) : c.displayValue,
            }));
        }
        const name = this.displayName;
        const dims = this._dims;
        // BaseNode.displayName's own split, for the reason recorded there: only numeric
        // is row-major, because only the numeric branch of the parse is transposed.
        const order = this._kind === 'array' ? 'row-major' : 'column-major';
        const bracket = this._kind === 'cell' ? '{}' : '()';
        // ONE scratch element node, re-seeded per element rather than one node per
        // element: a million allocations to read a million numbers is most of the cost
        // this accessor exists to avoid. Going through a real element node's own getter
        // is what guarantees the text is what an expanded child would have shown — the
        // numeric precision, the char and string budgets, and the `<unavailable>`
        // sentinel are all rules in _formatScalar/_formatString, and a second formatter
        // here would be a second answer.
        const scratch = this._kind === 'string'
            ? this._makeStringElement('1', '')
            : MatlabVariableNode._createScalar(0, this._elementType || elementClass(this._scalarType), '1', null);
        const isString = scratch._kind === 'string';
        const out = new Array(this._elements.length);
        for (let i = 0; i < this._elements.length; i++) {
            // In place, both of them: the scratch's own array is reused so that reading N
            // elements allocates nothing per element beyond the answer itself.
            if (isString) {
                scratch._elements[0] = this._elements[i];
            }
            else {
                scratch._scalarValue = this._elements[i];
            }
            out[i] = {
                label: subscriptLabel(name, i, dims, order, bracket, this._isSparse),
                value: scratch.displayValue,
            };
        }
        return out;
    }
    // ---- Property set + Property Inspector layout ----
    // A plain variable goes out as `{name, metadata, value}` — there is no property bag
    // in that shape, and serializeValue emits the VALUE alone. So a Description set here
    // could only ever live until the file was read again. The prop stays declared (the
    // column and the inspector field exist for every row); what changes is that neither
    // offers an editor, and setProperty refuses it.
    get descriptionEditable() {
        return false;
    }
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
        // A value still in the encoded stream it was read from is read-only (DataNode._refuseEncodedEdit).
        const encodedRefusal = this._refuseEncodedEdit(propName, stringValue);
        if (encodedRefusal) {
            return encodedRefusal;
        }
        if (propName === 'Value') {
            if (this._scalarType === 'function_handle') {
                return {
                    error: true,
                    reason: 'A function handle is shown here but cannot be edited.',
                    invalidValue: stringValue,
                    validValue: this.displayValue,
                };
            }
            // The editor valueEditable withholds, refused here too for a caller that asks
            // directly — and so never recorded for an undo, which restores the text the cell
            // displayed: `<1x3 sparse double>` read back as three char cells.
            if (this._kind === 'cell' && !this._literalRoundTrips()) {
                return {
                    error: true,
                    reason: 'This cell shows an element as a summary, which is not its value. Edit the element instead.',
                    invalidValue: stringValue,
                    validValue: this.displayValue,
                };
            }
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
            // _applyParsed rebuilds this node's children from the text, so restating a
            // value crosses the same has-children/has-none line an add or a remove does
            // (childEdit.ts notifies for those). A parent whose row for this node depends
            // on its shape — a Simulink.Parameter's Value row — has to follow, or a matrix
            // retyped as a scalar leaves it holding an expander onto nothing until the file
            // is re-read. The notification goes both ways: the same hook brings the row
            // back when a hidden scalar value node grows elements.
            this.parent?.childStructureChanged(this);
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
        // An element of a decoded `string` out of a .mat/.slx MCOS subsystem. `valueEditable`
        // already withholds the editor, so a consumer that honors it never gets here; this is
        // the second gate for one that calls setProperty directly, because accepting the text
        // would update the node and leave the file's own bytes — which is what gets written
        // back — saying something else.
        if (parent._isOpaque) {
            return {
                error: true,
                reason: 'This value is read-only',
                invalidValue: stringValue,
                validValue: this.displayValue,
            };
        }
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
            // A char MATRIX is refused: one element of a string array holds one piece of
            // text, and MATLAB errors on `s(1) = ['ab'; 'cd']` for the size. `dims` is
            // present on exactly the multi-row chars (charFromRows), so it is the test.
            accepted = (parsed?.type === 'char' && !parsed.dims) || parsed?.type === 'string';
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
        // elementClass, not 'double': the container fixes the element's class (this
        // method exists because of that), so re-stating 'double' here flipped an int32
        // element's Data Type column to double the moment its cell was committed.
        this._scalarType = isArrayElement ? elementClass(parent._scalarType) : 'string';
        // 1/0, never the boolean: _elements is the one representation the container's
        // display, its _var snapshot, and the typed literal all read, and the parsers
        // store a logical ARRAY as 1/0 (see parseTypedVector). An edited element must not
        // become the only boolean in it.
        //
        // exactForClass on the numeric arm for the same reason as _applyParsed: a uint64
        // array's element is the one element that can be an integer no double holds, and
        // the container's class — read one line above — is what says so.
        this._scalarValue = isLogicalElement
            ? (parsed.value ? 1 : 0)
            : isArrayElement
                ? exactForClass(parsed.value, this._scalarType)
                : parsed.value;
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
    //
    // A sparse array's k-th row is not its k-th element (_sparseSlots): the row's own
    // slot is where its edit goes. Into the k-th, it changed a different element than the
    // one the row is labelled with — and the row's own kept its old value in every save.
    _syncElementFromChild(child) {
        const idx = this.children.indexOf(child);
        const slot = this._sparseSlots ? this._sparseSlots[idx] : idx;
        if (idx >= 0 && slot !== undefined && slot < this._elements.length) {
            this._elements[slot] = child._scalarValue;
        }
    }
    _applyParsed(parsed) {
        this.children = [];
        this._matVar = null;
        this._rawInput = undefined;
        // A value typed in whole is the full array MATLAB makes of the same literal; only an
        // element edit leaves the array sparse.
        this._isSparse = false;
        this._sparseSlots = null;
        // And it is a value, not a reader's placeholder for one: left set, a char typed over
        // a value too large to decode displayed without its quotes.
        this._undecoded = false;
        // The class this node had going in. A numeric edit re-states the VALUE, not the
        // class, so classAfterEdit lets it survive the parser's 'double' default — see
        // its comment. Read before any arm overwrites it.
        const prevType = this._scalarType;
        // exactForClass, not the parser's token as-is: MatlabValueParser hands back exact
        // decimal TEXT for an integer a double cannot hold (defect 42 — typing intmax('uint64')
        // used to store 18446744073709552000), and this is the one edit path that knows the
        // class the value is about to have, so it is the one that can say whether the text
        // form is meaningful. Under int64/uint64 it is kept and the writers spell it
        // untouched; under any other class it collapses to the double, which is what MATLAB
        // itself stores for a bare decimal literal. Hence _scalarType is computed FIRST here.
        if (parsed.type === 'double' && Array.isArray(parsed.value) && parsed.value.length === 1) {
            this._kind = 'scalar';
            this._scalarType = classAfterEdit(prevType, 'double');
            this._scalarValue = exactForClass(parsed.value[0], this._scalarType);
            this._dims = [1, 1];
            this.serial = {};
        }
        else if (parsed.type === 'double' && Array.isArray(parsed.value)) {
            this._kind = 'array';
            this._scalarType = classAfterEdit(prevType, 'double');
            this._elements = parsed.value.map((v) => exactForClass(v, this._scalarType));
            this._dims = parsed.dims;
            this._syncArraySerial();
            this._buildArrayChildren();
        }
        else if (parsed.type === 'logical' && Array.isArray(parsed.value)) {
            // `[true false true]` — the literal MATLAB's own mat2str prints for a logical array,
            // and the text this entry's Value cell displays. classAfterEdit is deliberately not
            // consulted: it exists to let a class the parser cannot see survive a bare numeric
            // edit, and here the literal states the class itself. The 1-element case collapses to
            // a scalar for the same reason the double arm above does — `[true]` is 1x1 — and
            // _scalarValue is a boolean there because that is what a logical scalar stores and
            // what the JSON writer emits (a bare `true`, as boolT is written).
            this._scalarType = 'logical';
            this._dims = parsed.dims;
            if (parsed.value.length === 1) {
                this._kind = 'scalar';
                this._scalarValue = !!parsed.value[0];
                this._dims = [1, 1];
                this.serial = {};
            }
            else {
                this._kind = 'array';
                this._elements = parsed.value;
                this._syncArraySerial();
                this._buildArrayChildren();
            }
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
            this._scalarType = classAfterEdit(prevType, parsed.type);
            // The bare-scalar arm (`5`, `18446744073709551615`) shares this branch with char,
            // string, logical and complex, so the exact-token narrowing is gated on the parsed
            // TYPE: a char value can be all digits ('123'), and exactForClass would turn it
            // into a number.
            this._scalarValue = parsed.type === 'double' ? exactForClass(parsed.value, this._scalarType) : parsed.value;
            // A char is the one scalar-KIND value that can be bigger than 1x1: it is stored
            // as one string, so ['ab'; 'cd'] arrives here as the 4-character 'acbd' with
            // dims [2,2] beside it (see charFromRows). Forcing [1, 1] made committing a char
            // matrix's OWN displayed value reshape it — the display, both writers and the
            // subscripts all read _dims, so the 2x2 came back as a 1x1 holding four
            // characters in column-major order, which is text nobody typed (defect 25).
            this._dims = parsed.dims ? parsed.dims.slice() : [1, 1];
            this.serial = {};
        }
    }
    // The write-side twin of parseMatrixValue. This used to be its own loop, and it
    // spelled the body differently from BinarySlddParser's copy — newline-joined rows
    // rather than bracketed groups, and formatMatlabNum for every class rather than
    // MATLAB's typed literals. MATLAB reads the newline form as a 1x0 EMPTY matrix, so
    // editing any multi-row matrix in an uncompressed-text dictionary silently threw
    // the value away. Both writers now go through XmlUtils.formatMatrixSerial, which
    // carries the MATLAB evidence for each spelling.
    // `elements` is widened to admit a string because an int64/uint64 element is exact
    // decimal TEXT (parseTypedVector); formatNumLiteral, under formatMatrixSerial, carries
    // one through untouched and appends the class's own suffix.
    _buildMatrixString(dims, elements, type) {
        return formatMatrixSerial(elements, dims, type || this._scalarType || 'double');
    }
    // THE ONLY PLACE AN ARRAY GROWS ONE CHILD PER ELEMENT. Every parse path — text,
    // binary, .mat, complex, typed vector, typed array — calls this instead of writing
    // its own loop. Six of them used to write their own, with the `length > 1` guard
    // spelled three times and missing three times; the comment at the .mat flat-array
    // site already said why ("every element builder states the rule the same way, so
    // none of them can drift out of step with the container again") but said it by
    // convention, which lasted exactly until there were two rules to agree on. The
    // second rule is the cap, and a cap honoured by five builders out of six is not a
    // cap at all.
    //
    // The two guards are the same shape and mean opposite things: a scalar has nothing
    // BELOW it to expand, an array past MAX_EXPANDED_ELEMENTS has too much. Both leave
    // `_elements` as the one copy of the value, which every reader here already falls
    // back to — see the cap's own note in DisplayConvention for why it has to be
    // all-or-nothing, and `_buildCellChildren` for why cells are exempt.
    //
    // `elementType` is for the one container whose elements are NOT of its own class:
    // a complex array stores `_scalarType` 'double' (that is what it serializes as)
    // while each element is a 'complex' scalar. Defaulting to elementClass(_scalarType)
    // keeps every other caller honest by silence.
    _buildArrayChildren(elementType) {
        // Recorded BEFORE either guard, so the array the cap refuses to expand still
        // knows what its elements are. displayElements is the reader (below); it is the
        // one path that has to format an element with no element node to read it off.
        const type = elementType || elementClass(this._scalarType);
        this._elementType = type;
        if (this._isSparse) {
            this._buildSparseChildren(type);
            return;
        }
        if (this._elements.length <= 1 || this._elements.length > MAX_EXPANDED_ELEMENTS) {
            return;
        }
        for (let i = 0; i < this._elements.length; i++) {
            const child = MatlabVariableNode._createScalar(this._elements[i], type, String(i + 1), this);
            this.addChild(child);
        }
    }
    // A sparse array's rows: one per NON-ZERO, in MATLAB's column-major order — the order
    // its own display lists them in, `(row,col) value` — each labelled with both of its
    // subscripts (BaseNode.ElementSubscript's `full`), a vector's and a 1x1's too, and
    // valued as any element row is. An all-zero one has none, and nothing adds one: a
    // sparse array takes no Add or Remove (canAddChild, canRemoveChild).
    //
    // The value stays `_elements`, every element row-major, because that is what every
    // writer and every projection reads (_liveElements); each row records which slot of
    // it is its own (_sparseSlots), which is where an edit to the row goes. A non-zero is
    // MATLAB's nnz() test (XmlUtils.isNonzeroElement), so it is decided from the values
    // and holds for every reader the value can come from — MatParser, this package's own
    // `sparse` literal, the MCOS decoder's stream — none of which has to say which
    // elements its file stored.
    //
    // The row budget counts rows, so it counts non-zeros: a 1000x1000 with five non-zeros
    // has its five, where its million elements were past the budget and it had none.
    _buildSparseChildren(type) {
        const d = effectiveDims(this._dims);
        const rows = d[0];
        const cols = d.length > 1 ? d[1] : 1;
        const slots = [];
        const subscripts = [];
        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                const slot = r * cols + c;
                if (isNonzeroElement(this._elements[slot])) {
                    slots.push(slot);
                    subscripts.push(c * rows + r);
                }
            }
        }
        this._sparseSlots = slots;
        if (slots.length > MAX_EXPANDED_ELEMENTS) {
            return;
        }
        for (let k = 0; k < slots.length; k++) {
            const child = MatlabVariableNode._createScalar(this._elements[slots[k]], type, String(k + 1), this);
            child._subscript = { index: subscripts[k], dims: this._dims, order: 'column-major', bracket: '()', full: true };
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
    // Every string-array parse path calls this — the inline literal, the structured
    // `_array_type: 'String'` form, and the bare JSON list of strings. The latter two
    // used to build the identical child inline instead, which is how they came to be
    // the two element loops the cap did NOT reach: a 10,000-element string array from
    // either of them expanded in full while the same array written as a literal did
    // not. That is the shape of defect this choke point exists to make impossible, so
    // the lesson is the one _buildArrayChildren's note already records — a rule obeyed
    // by most of the paths is not a rule.
    _buildStringChildren() {
        if (this._elements.length <= 1 || this._elements.length > MAX_EXPANDED_ELEMENTS) {
            return;
        }
        for (let i = 0; i < this._elements.length; i++) {
            this.addChild(this._makeStringElement(String(i + 1), this._elements[i]));
        }
    }
    // NOT capped, unlike the two above, and this is the reason: a cell's children are
    // its ONLY copy. Its elements arrive as an argument and are never kept in
    // `_elements` — a cell element is a whole node, not a scalar — so there is nothing
    // to fall back to. `_serializeCellXml` says what the cap would cost here: with no
    // children it writes `Dimension="0*0"`, i.e. it would save the value away. A huge
    // cell is also far rarer than a huge numeric matrix, which is the shape that
    // actually arrives. Pinned by test/largeArrayNotExpanded.test.ts.
    _buildCellChildren(elements) {
        for (let i = 0; i < elements.length; i++) {
            const child = NodeRegistry.parseValue(elements[i], String(i + 1), this);
            this.addChild(child);
        }
    }
    canAddChild() {
        // An opaque MCOS value is read-only in both directions: its bytes go back out
        // verbatim because nothing here writes a .mat MCOS subsystem. Before a `string`
        // decoded, no opaque node had a _kind that reached the vector case below, so this
        // gate was never exercised — a decoded 1x3 string would have offered Add Child and
        // then dropped the added element on save. A value still in the encoded stream it was
        // read from is read-only the same way, for the same reason (DataNode._encodedReadOnly).
        if (this._isOpaque || this._encodedReadOnly) {
            return false;
        }
        // A sparse array's rows are its non-zeros, so there is no element row to add that
        // would not be one: nothing in the tree adds a non-zero. (An empty one is no
        // exception — Add turns an empty `[]` into a struct, which a sparse array is not.)
        if (this._isSparse) {
            return false;
        }
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
        // Read-only in both directions, as in canAddChild.
        if (this._isOpaque || this._encodedReadOnly) {
            return false;
        }
        // Nor does a sparse array give one up: removing a non-zero from a vector shortens
        // the array, and the rows left would no longer be the non-zeros of what is left.
        if (this._isSparse) {
            return false;
        }
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
            const serialType = typed ? this._scalarType : 'double';
            this.serial = {
                _type: serialType,
                // The literal's own suffixes have to agree with the tag: MATLAB reads a
                // suffixless body as double whatever _type says.
                _value: this._buildMatrixString(this._dims, this._elements, serialType),
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
        // `_rawInput` alone says the value is untouched: every edit drops it (_markModified)
        // except a rename, which leaves the value as it was (DataNode.setProperty). The entry's
        // 'Modified' status is not asked — a renamed entry has it, and its value is still the
        // one it was read as.
        if (this._rawInput !== undefined && !this._rawInput?._emptyDims) {
            // Complex TEXT included, which is not a text dictionary's form: DataNode.serialize
            // turns it into one on the way into such a file (MatWriter.textDictionaryForm).
            return this._rawInput;
        }
        // Rank >= 3 leaves the literal grammar behind entirely: there is no spelling
        // for it. Every `Matrix(d1,d2,d3)` candidate reads back as an empty 1x0 and
        // the two constructor expressions read back as the scalar 0, while MATLAB's
        // own dictionary stores every N-D value of every kind as a cdata byte stream
        // (defect 22, evidence in parser/MatWriter). So this is not an alternative to
        // the branches below — it is the only form that survives, and they are
        // rank-2-only by construction.
        //
        // Complex has no literal spelling either, and unlike rank it has none at ANY
        // shape. MATLAB's own text dictionary stores a complex SCALAR and a complex
        // VECTOR as cdata byte streams exactly as it does a rank-3 array — cases.sldd's
        // own bytes for cplxScalar and cplxVec are both streams. What we emitted
        // instead, `{_type: 'cdata', _value: '3+4i'}`, is the form the BINARY dictionary
        // uses for the same property, and MATLAB reads it back out of a TEXT dictionary
        // as an empty 1x0 double — the same signature defects 19 and 22 had. So this was
        // data loss on the first save of any edited complex value, not churn (defect 24,
        // measured by probe_writeback).
        //
        // The stream is right for the XML channel too: _serializeTypedPropertyXml
        // discriminates on isMatCdata and hands a stream back to the node to write its
        // own `Class="double" IsComplex="1"` property, which is exactly the plain-text
        // form the binary dictionary wants. One serialization, both formats.
        //
        // A sparse array is the third value with no literal spelling worth having: MATLAB's
        // text dictionary stores every one as a stream of its non-zeros (make_sparse_fixtures.m
        // grades that), and MatWriter writes MATLAB's own bytes for one. The `sparse` literal
        // this used to fall to was right only for a real double MATRIX; through it a complex
        // sparse array read back as an empty 1x0, a column as a row, a non-finite one
        // reshaped, and a logical or single one full. One too large for the reader to decode
        // has nothing BUT its stream (_matStream): the arms below would write the text of its
        // placeholder, as a char.
        if (effectiveDims(this._dims).length > 2 || this._isComplexValue() || this._isSparse) {
            const cdata = this._serializeCdata();
            if (cdata) {
                return cdata;
            }
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
    /**
     * Is this a complex value? The two tests are the two shapes complexity arrives
     * in: a complex SCALAR carries `_scalarType === 'complex'`, while a complex ARRAY
     * is a plain `double` whose per-element values are the literal text `'1+2i'` —
     * the element nodes are the complex ones, not the parent. `_buildVarObject` has
     * always had to make the same distinction to set `isComplex`, and it asks here so
     * the projection and the serialization cannot disagree about what is complex; a
     * disagreement would mean writing a cdata stream built from a non-complex `_var`.
     */
    _isComplexValue() {
        if (this._scalarType === 'complex') {
            return true;
        }
        if (this._kind !== 'array') {
            return false;
        }
        const elems = this._liveElements();
        // ANY element, not the first: the element editor takes only a real number, so after
        // x(1) = 7 the first element is the number 7 and the rest are still complex, and
        // asking the first alone wrote [7+0i NaN+0i 3-4i] out as the real [7 0 3].
        return elems.some((e) => typeof e === 'string' && e.includes('i'));
    }
    /**
     * The MATLAB class of a complex value: what its writers spell, where the node's own
     * type says nothing about it. An ARRAY carries it as its `_scalarType` (int16, single,
     * …), as every reader sets it. A SCALAR's type is 'complex', which has no class, so the
     * class is read off what the value was read from, while that is still the value: the
     * variable a .mat or a text dictionary's stream gave (`_matVar`), or the envelope a
     * binary dictionary or the MCOS decoder gave (`_rawInput`). A value edit clears both
     * (_applyParsed), and an edited complex scalar is a double, as the literal typed for it
     * is in MATLAB. Not `_var`: a rename marks the snapshot stale without changing the
     * value, and the rebuilt variable is where this class is needed, not where it is read.
     */
    _complexClass() {
        if (this._kind === 'array') {
            return complexClassTag(this._scalarType) ?? 'double';
        }
        const fromVar = this._matVar ? this._matVar.className : undefined;
        const fromEnvelope = this._rawInput?._class;
        return complexClassTag(fromVar) ?? complexClassTag(fromEnvelope) ?? 'double';
    }
    // A value with no literal spelling — rank >= 3, or complex at any rank — as the
    // `{_type: 'cdata'}` byte stream MATLAB uses for it. `_var` is the same live-tree
    // rebuild the .mat and .slx writers use, so an edit anywhere below this node is
    // already in it (_markModified marks the whole chain stale).
    //
    // Returns null for a value MatWriter refuses — an MCOS opaque, a class it has no
    // MAT code for. Those have no stream spelling in this format at ALL, so the choice
    // is between the rank-2 form the branches below produce, which at least leaves a
    // readable file, and failing the whole save. It falls through.
    _serializeCdata() {
        const bytes = this._matStream();
        return bytes ? { _type: 'cdata', _value: uuencode(bytes) } : null;
    }
    /**
     * The MAT stream this value is — `getByteStreamFromArray(value)` — or null when this
     * package cannot make it. In order:
     *   - the stream it was read from, while that is still the value (a text dictionary's
     *     cdata, untouched or only renamed);
     *   - for a value the reader recorded without decoding (`_undecoded`: a sparse array
     *     past MatParser's dense limit), the element it was read from, re-framed as a stream
     *     (MatWriter.matStreamOfElement) — nothing else holds its values, and without this a
     *     copy of one out of a .mat wrote the text of its placeholder;
     *   - otherwise what MatWriter writes for the live value, which is MATLAB's own bytes for
     *     a sparse array (MatWriter.encodeSparse); null for what MatWriter refuses.
     */
    _matStream() {
        const raw = this._rawInput;
        if (raw && isMatCdata(raw)) {
            const bytes = matStreamPrefix(uudecode(raw._value));
            if (bytes) {
                return bytes;
            }
        }
        if (this._undecoded) {
            return this._rawBytes ? matStreamOfElement(this._rawBytes) : null;
        }
        try {
            return encodeMatStream(this._var);
        }
        catch (_e) {
            return null;
        }
    }
    _serializeScalar() {
        if (this._scalarType === 'string') {
            return [this._scalarValue];
        }
        if (this._scalarType === 'char') {
            // A bare JSON string is a 1xN char and nothing else, so a char that is not a row
            // takes MATLAB's `mxchar` envelope — the character CODES under a Matrix() header,
            // which is exactly how MATLAB's own char_text.sldd spells charCol, charMat and
            // charMat23, and how typed_text.sldd spells the char field of sCharMat.
            //
            // Without this arm a 2x2 went out as the bare string "acbd": MATLAB reopened it
            // as a 1x4 char whose characters were in column-major order, so the shape was
            // gone and the text itself was scrambled (defect 25). Rank >= 3 never reaches
            // here — serializeValue takes the cdata branch first, which is what MATLAB writes
            // for an N-D char too.
            const text = this._scalarValue === null || this._scalarValue === undefined ? '' : String(this._scalarValue);
            const dims = this._textDims(text);
            if (text !== '' && charNeedsShape(dims)) {
                return { _type: 'mxchar', _value: formatMxCharSerial(text, dims) };
            }
            return text;
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
            // Unreachable for a complex value MatWriter can encode — serializeValue takes
            // the byte-stream branch above first, because MATLAB reads THIS spelling back
            // out of a text dictionary as an empty 1x0 (defect 24). It stays as the
            // fallback for the value the writer refuses, where a readable-but-lossy
            // property still beats failing the save, and as the form the binary
            // dictionary's XML ultimately carries.
            return { _type: 'cdata', _value: this._scalarValue };
        }
        // The typed form is the format's own escape hatch for a value a bare JSON
        // scalar cannot carry — an integer/single class, or an Inf/NaN. See
        // needsTypedLiteral for why each one loses data written bare.
        //
        // formatNumLiteral, not formatMatlabNum: the suffix belongs to the literal.
        // MATLAB's own thirty-odd typed scalars in cases.sldd spell it exactly the way
        // formatNumLiteral does — unsigned takes 'U' (`7U`, `255U`, `0U`), single takes
        // 'F' (`3.14159274F`), a signed integer takes neither (`7`, `-128`), and a
        // non-finite double is `Inf`/`-Inf`/`NaN`. We were writing formatMatlabNum's bare
        // number for all of them, so a modified single scalar went out as
        // `{"_type": "single", "_value": "3.5"}` where MATLAB writes `"3.5F"`. That one
        // is churn rather than loss — asked directly, MATLAB reads the suffix-less form
        // back as a single, because the `_type` tag carries the class (probe_writeback,
        // deepsig on typed/sTyped reports `b:single[1 1]`) — but the array path already
        // went through formatNumLiteral, so the same value spelled itself two ways
        // depending only on whether it had siblings.
        if (needsTypedLiteral(this._scalarType, this._scalarValue)) {
            return { _type: this._scalarType, _value: formatNumLiteral(this._scalarValue, this._scalarType) };
        }
        return this._scalarValue;
    }
    _serializeArray() {
        if (this._elements.length === 0) {
            return [];
        }
        // Not for a sparse array, whose rows are not its elements: one with no rows (all
        // zero, or past the row budget) still has every element to write.
        if (this.children.length === 0 && !this._isSparse) {
            return this.serial;
        }
        const elems = this._liveElements();
        const serialType = this.serial?._type;
        if (serialType) {
            return {
                _type: serialType,
                _value: this._buildMatrixString(this._dims, elems, serialType),
            };
        }
        // A bare JSON array cannot carry Inf/NaN (JSON.stringify writes `null`), so
        // fall back to the typed-vector literal, which spells them out as text — for a ROW,
        // which is all that literal can say. A column or a matrix takes the Matrix() literal
        // below, which spells them too: a 2x2 [Inf 0; -Inf NaN] copied out of a .mat went out
        // as the row `[Inf, 0, -Inf, NaN]`, and MATLAB read it back 1x4.
        const d = effectiveDims(this._dims);
        const isRow = d.length <= 2 && d[0] === 1;
        if (isRow && elems.some((v) => typeof v === 'number' && !isFinite(v))) {
            return { _type: 'double', _value: '[' + elems.map(formatMatlabNum).join(', ') + ']' };
        }
        // A bare JSON array has nowhere to carry [2,3] or [2,3,2] either, so a matrix
        // written that way read back as a 1xN — and because the children are row-major
        // even the element order was wrong against MATLAB's column-major
        // linearization. Only a true vector may serialize bare; anything with two
        // spread extents takes the typed Matrix() literal, which is the shaped form
        // both readers already accept (there is no `_array_type: 'Matrix'`).
        //
        // A vector of a class the bare form cannot carry is NOT one of those vectors.
        // MATLAB spells such a vector as ONE typed literal for the whole array —
        // `{"_type": "int32", "_value": "[1, 2]"}` — at the top level, in a struct
        // field and in a cell element alike (probe_typed_shapes.m), never as a JSON
        // list of per-element literals. The list is what mapping serializeValue over
        // the children produces, since each child needs its own tag, and it is not
        // merely an unusual spelling: serializeValue is shared with the XML channel,
        // where DataNode.serializePropertyXml String()-joined the objects and wrote
        // `Class="double" Dimension="1*2">[object Object] [object Object]` for an
        // int32 struct field. That is a corrupt property, not a lossy one. The rule is
        // _syncArraySerial's, which has always had it right for the edit path; only the
        // no-serial path (a value that reached us from a .mat or .slx rather than from a
        // text dictionary) fell through to the children.
        //
        // Nor is a COLUMN: a bare list is a row, so a 5x1 copied out of a .mat went out as
        // [0, 3, 0, 0, 5] and MATLAB read it back 1x5. A column states its shape, as a
        // typed column does (defect 21).
        const typed = TYPED_NUMERIC_CLASS.test(this._scalarType) || this._scalarType === 'logical';
        if (!typed && isRow) {
            // A finite double element is its own bare number (the non-finite went out above),
            // which is all a sparse array's elements can be by here: the bare numbers, then,
            // where its rows are not all of them.
            if (this._isSparse) {
                return elems.slice();
            }
            return this.children.map(function (c) {
                return c.serializeValue();
            });
        }
        // A typed ROW vector comes out of formatMatrixSerial bare, `[1, 2]`, which is
        // MATLAB's own spelling for it and the one BinarySlddParser's read path has always
        // produced; only a column or a matrix states its shape (defect 21).
        //
        // A sparse array reaches here only when MatWriter could not write its stream
        // (serializeValue asks that first). A sparse DOUBLE matrix then keeps the `sparse`
        // tag it always went out with: MATLAB reads `{"_type": "sparse", "_value":
        // "Matrix(…)"}` back as the sparse double it was (measured), where `double` would
        // make it a full one. Its class used to BE 'sparse', which is how the tag got there;
        // it is 'double' now (MatParser), so the storage is asked for by name.
        const matrixType = this._isSparse && this._scalarType === 'double' ? 'sparse' : this._scalarType || 'double';
        return { _type: matrixType, _value: this._buildMatrixString(d, elems, matrixType) };
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
        // Complex text nobody edited goes back as the text it was read from, through the
        // writer that spells complex text (DataNode._complexTextXml). For a value the node
        // read as numbers that is the same bytes the arms below would write; it matters for
        // the value it could not read — a binary dictionary's own text with a NaN or Inf part,
        // which parseCdata shows as a quoted char (see _isOwnNonFiniteText) — which the char
        // arm used to write back as `Class="char"`, so a save that edited nothing turned
        // MATLAB's [Inf NaN -2 5000i] into a char row. (Untouched or only renamed, as
        // serializeValue asks it.)
        const raw = this._rawInput;
        const attrStr = attrs && attrs.Name ? ' Name="' + escapeXml(attrs.Name) + '"' : '';
        if (raw && raw._type === 'cdata' && !isMatCdata(raw)) {
            return DataNode._complexTextXml(tagName, attrStr, raw, indent);
        }
        // A sparse array has no XML spelling: `Class="sparse"` makes MATLAB's reader segfault,
        // and `Class="double"` with every element is the full array, a different variable. So
        // wherever one is written — a struct field, a cell element, a Simulink.Parameter's
        // Value; an entry is written by serializeEntryToXml through _binaryEncoded — it is the
        // hex element of its own MAT stream. MATLAB itself only ever puts hex around a whole
        // entry, but it reads one in each of those three places back as the sparse array it
        // was, values, class and complexity equal (R2027a, measured on sparse_text.sldd's st,
        // c, pSp, pSpComplex and pSpLogical pasted into a binary dictionary this way).
        if (this._isSparse) {
            const hex = this._hexValue(indent);
            if (hex) {
                return encodedXml(tagName, attrStr, hex, indent);
            }
        }
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
        // A value the reader did not decode, with no stream of its own to write it as (see
        // serializeXml and _matStream, which every one this package reads from a file has):
        // all there is to write is its placeholder. Escaped, whatever the class beside it says
        // — the numeric arms below write their text as it stands, and `<10000000x2 double, not
        // decoded>` unescaped inside a Class="double" element made the whole dictionary
        // something MATLAB would not open.
        if (this._undecoded) {
            return p + '<' + tagName + attrStr + ' Class="' + escapeXml(type) + '">' + escapeXml(String(val)) + '</' + tagName + '>';
        }
        if (type === 'string') {
            this._kind = 'string';
            this._elements = [val];
            this._dims = [1, 1];
            const result = this._serializeStringXml(tagName, attrs, indent);
            this._kind = 'scalar';
            return result;
        }
        if (type === 'struct') {
            // Without this arm a struct falls through to the numeric tail below and the
            // WHOLE entry writes as `Class="struct">0` — every field and every element
            // gone. This is the XML twin of the _serializeScalar hole Phase 6 closed for
            // JSON, and it is the worse half: the binary dictionary writer goes through
            // serializeXml, and MATLAB does not merely read the result as an empty
            // struct, it refuses the file. Substituting that byte sequence for
            // struct2x3's value in MATLAB's own binary cases.sldd makes
            // Simulink.data.dictionary.open answer "Failed to open file".
            //
            // StructNode already writes MATLAB's own spelling for this exact value bag
            // (Class="struct" Dimension="2*3*2" with one <Element> per element), so route
            // through it rather than growing a second struct-XML writer that could drift
            // from the first. _serializeStructValue produces the `_array_type: 'Struct'`
            // form NodeClassMap maps to StructNode.
            const bag = this._serializeStructValue();
            return NodeRegistry.parseValue(bag, this.name, null).serializeXml(tagName, attrs, indent);
        }
        if (type === 'char') {
            if (val === '' || val === null || val === undefined) {
                // MATLAB writes the empty char with neither a body nor a Dimension, whatever
                // its 0x0/1x0 extents say — char_binary.sldd's charEmpty.
                return p + '<' + tagName + attrStr + ' Class="char"/>';
            }
            // The text is already MATLAB's column-major storage order, which is the order
            // this body wants: its own 2x2 ['ab'; 'cd'] is `Dimension="2*2">acbd`. Only the
            // Dimension was missing, so every char BUT a row went out claiming 1xN — a 3x1
            // came back transposed and a 2x3x2 came back flat (defect 25). A row and an
            // empty char carry no attribute, exactly as MATLAB leaves them.
            const text = String(val);
            const dims = this._textDims(text);
            const dimAttr = charNeedsShape(dims) ? ' Dimension="' + dims.join('*') + '"' : '';
            return p + '<' + tagName + attrStr + ' Class="char"' + dimAttr + '>' + escapeXml(text) + '</' + tagName + '>';
        }
        if (type === 'logical') {
            return p + '<' + tagName + attrStr + ' Class="logical">' + (val ? '1' : '0') + '</' + tagName + '>';
        }
        if (type === 'complex') {
            const cls = this._complexClass();
            return (p +
                '<' +
                tagName +
                attrStr +
                ' Class="' +
                cls +
                '" IsComplex="1">' +
                formatComplexBodyXml(String(val), cls) +
                '</' +
                tagName +
                '>');
        }
        if (type === 'double') {
            return p + '<' + tagName + attrStr + ' Class="double">' + formatDoubleXml(val) + '</' + tagName + '>';
        }
        // No `as number`: an int64/uint64 scalar holds exact decimal TEXT (parseTypedScalar),
        // and formatNumericXml writes one verbatim instead of rounding it through a double.
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
        const elems = this._liveElements();
        if (this._isComplexValue()) {
            const colMajor = transposeToColumnMajorND(elems, dims);
            const cls = this._complexClass();
            const formatted = colMajor.map(function (v) {
                // An element edited to a real number is that number plus 0i (see _buildVarObject).
                const text = typeof v === 'number' || isExactToken(v) ? formatComplexNum(v, 0) : String(v);
                return formatComplexBodyXml(text, cls);
            });
            return (p +
                '<' +
                tagName +
                attrStr +
                ' Class="' +
                cls +
                '" IsComplex="1" Dimension="' +
                dimAttr +
                '">' +
                formatted.join(' ') +
                '</' +
                tagName +
                '>');
        }
        // No `as number` on the element: an int64/uint64 element is an exact decimal
        // STRING (parseTypedVector), and formatNumericXml passes one through verbatim
        // rather than rounding it back into a double (defect 29).
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
        // The envelope itself lives on DataNode, because an object PROPERTY holding a string
        // has to write the identical thing (see _stringEnvelopeXml). This method keeps only
        // what is the entry's own: its tag, its Name attribute, and reading the elements off
        // the live children rather than the stored list.
        return (p +
            '<' +
            tagName +
            attrStr +
            '>\n' +
            DataNode._stringEnvelopeXml(elements, this._dims, indent) +
            p +
            '</' +
            tagName +
            '>');
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
            // So MatWriter writes it as sparse storage: its class is a full one's, and the full
            // array it would write otherwise is a different variable (MatWriter.encodeMatVariable).
            ...(this._isSparse ? { isSparse: true } : {}),
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
                // A char array's shape is NOT its text length. `[1, len]` flattened every
                // char matrix the moment it was modified: MATLAB's own
                // reshape('abcdefghijkl', [2 3 2]) went back into a dictionary as a 1x12
                // row, which MATLAB then read back as one — the value survived, its shape
                // did not. _textDims is the same rule the display uses: _dims wins when it
                // accounts for every character, otherwise the value really is a row vector
                // (the JS-string parse path never knew a length to put in _dims).
                v.dimensions = this._textDims(typeof this._scalarValue === 'string' ? this._scalarValue : '');
            }
            if (this._scalarType === 'complex') {
                // The class the value has (_complexClass), and its parts read by the one reader
                // of complex text, which knows Inf and NaN: the pattern this used,
                // `^([-\d.eE+]+)([+-][\d.eE+]+)i$`, matched neither, so complex(1, Inf) went out
                // as the real 0 and an int8 one as a double.
                v.className = this._complexClass();
                v.isComplex = true;
                const pair = parseComplexNum(String(this._scalarValue), v.className);
                if (pair) {
                    v.value = [pair];
                }
            }
        }
        else if (this._kind === 'array') {
            const elems = this._liveElements();
            if (this._isComplexValue()) {
                // As the scalar arm above: a NaN or Inf element used to become 0+0i here, and
                // an int16 array a double one. An element edited to a real number (the element
                // editor takes only those) is that number plus 0i, as MATLAB makes x(2) = 9 of a
                // complex x; it was 0+0i.
                const cls = this._complexClass();
                v.className = cls;
                v.isComplex = true;
                v.value = elems.map(function (s) {
                    if (typeof s === 'number' || isExactToken(s)) {
                        return { re: s, im: 0 };
                    }
                    return parseComplexNum(String(s), cls) ?? { re: 0, im: 0 };
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
    // Returns a DataNode rather than a MatlabVariableNode for the opaque arm's sake: a
    // decoded MCOS object is whatever node its class has — a ParameterNode, a BusNode —
    // and every other arm still answers a MatlabVariableNode.
    static parseMatVariable(variable, name, parent) {
        if (variable.isOpaque) {
            // An MCOS object the container decoded (attachMcosDecoded) — a struct field or a
            // cell element, since a top-level one is built by the container itself — becomes
            // the node the same object gets at top level, under the field name or cell index
            // it was given. Without a decode, or if that builds nothing, it is the opaque
            // summary it always was.
            const decoded = mcosDecodedFor(variable);
            if (decoded) {
                const node = NodeRegistry.modelMcosVariable(variable, decoded, name, parent);
                if (node) {
                    return node;
                }
            }
            return MatlabVariableNode._createOpaque(variable, name, parent);
        }
        // A variable the parser RECORDED WITHOUT DECODING (MatParser's `undecoded`): a
        // pre-MCOS class-3 object, or a sparse matrix whose declared size is past what the
        // reader materializes. Its value is one placeholder string standing for the whole
        // variable rather than an element list, so it takes the scalar shape at every
        // declared size — checked before the class dispatch because the class name is a
        // real one ('object', 'sparse') and would otherwise route to the numeric arm.
        //
        // It has to be its own arm rather than a fall-through: the numeric arm read the
        // placeholder as a one-element list, so a 1x3 object printed as the MATLAB matrix
        // literal `[<1x3 object, not decoded>]`, OFFERED AN EDITOR (the no-editor rule
        // keys on the angle brackets, which a matrix literal wraps out of position), and
        // grew one child row claiming to be element 1 of 3 — three claims about a value
        // nothing read, and an editor whose commit could not reach the file.
        if (variable.undecoded) {
            return MatlabVariableNode._createUndecoded(variable, name, parent);
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
    // A recorded-but-not-decoded variable: one row, the parser's placeholder as its
    // whole value, no children, and no editor (the placeholder is angle-bracketed, which
    // is what BaseNode.valueEditable withholds the editor for). `_scalarType` is the
    // parser's class name, so the DataType column still says what the FILE says the
    // variable is — 'object', or a too-large sparse array's 'double' — which is the part
    // that was read.
    static _createUndecoded(variable, name, parent) {
        const node = new MatlabVariableNode(name, parent, {});
        node._rawBytes = variable._rawBytes || null;
        node._matVar = variable;
        node._isSparse = !!variable.isSparse;
        node._undecoded = true;
        node._kind = 'scalar';
        node._scalarType = variable.className;
        node._scalarValue = variable.value;
        node._dims = variable.dimensions.slice();
        return node;
    }
    static createFromMcosDecoded(variable, decoded, parent, 
    // The variable's own name, unless it is nested: then the field name or cell index.
    name = variable.name) {
        const node = new MatlabVariableNode(name, parent, {});
        node._isOpaque = true;
        node._opaqueClassName = variable.className;
        node._rawBytes = variable._rawBytes || null;
        node._matVar = variable;
        node._mcosProperties = decoded.properties;
        node._mcosValue = decoded.value;
        node._mcosDimensions = decoded.dimensions;
        if (decoded.stringElements) {
            node._adoptStringPayload(decoded.dimensions, decoded.stringElements);
        }
        return node;
    }
    // Give a decoded `string` the state a string array carries on every other path, so one
    // formatter, one child-label rule and one serializer cover all four formats. STAYS
    // OPAQUE: `_isOpaque` is what withholds the editor and the add/remove-child actions, and
    // what keeps `_var` handing back the variable's own bytes verbatim on save. Nothing in
    // this package writes a .mat MCOS subsystem, so a writable string here would be a value
    // typed into a node whose bytes go out unchanged — silent data loss, not an edit.
    _adoptStringPayload(dims, elements) {
        this._kind = 'string';
        this._scalarType = 'string';
        // COLUMN-major, which is the order the payload stores and the order _formatString and
        // BaseNode.displayName both read a string-kind node's elements in. No transpose.
        this._elements = elements.slice();
        this._dims = dims.slice();
        // The dimensioned envelope a text/binary .sldd uses for a string array. Set so that a
        // string COPIED out of a .mat into a dictionary carries its shape with it rather than
        // flattening to a bare element list (_serializeString reads _array_type to choose).
        this.serial = {
            _array_type: 'String',
            _dimensions: dims.slice(),
            _mw_element_type: 'MATLABArray',
        };
        this._buildStringChildren();
    }
    static _createFromMatNumeric(variable, name, parent) {
        const node = new MatlabVariableNode(name, parent, {});
        node._rawBytes = variable._rawBytes || null;
        node._matVar = variable;
        node._isSparse = !!variable.isSparse;
        const dims = variable.dimensions;
        const totalElements = dims.reduce((a, b) => a * b, 1);
        // A 1x1 SPARSE array takes the array arms below, not the scalar ones: it shows its
        // summary like every sparse array, so its one element, when it is not zero, needs the
        // row a scalar does not have, or its value would be nowhere on screen.
        if (variable.isComplex) {
            const arr = Array.isArray(variable.value) ? variable.value : [variable.value];
            if (arr.length === 1 && !variable.isSparse) {
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
                node._buildArrayChildren('complex');
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
        if (totalElements === 1 && !variable.isSparse) {
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
        node._buildArrayChildren();
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
            // Derived, not baked: see BaseNode.ElementSubscript.
            elemNode._subscript = { index: ei, dims: node._dims, order: 'column-major', bracket: '()' };
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
        // First, because its text is a byte stream and every arm below would read it as
        // something else — the typed-scalar arm as a number, which is how a binary
        // dictionary's hex values all came to show 1494. NodeClassMap.parseValue asks before
        // it gets here; this is for a caller that reaches parse directly.
        if (isEncodedValue(rawVal)) {
            return MatlabVariableNode.parseEncoded(rawVal, name, parent);
        }
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
            // Before the shape dispatch, because 'mxchar' wears the Matrix() header but is
            // not a numeric array: its numbers are character CODES, and read as numbers they
            // produced a matrix of 97s and 98s typed with a class MATLAB has no such thing as
            // (defect 25).
            if (rv._type === 'mxchar') {
                return MatlabVariableNode.parseMxChar(rv, name, parent);
            }
            // Before the typed-scalar arm, whose parseFloat read the handle's text as the
            // number 0: a text dictionary's `{"_type": "function_handle", "_value": "sin"}`
            // showed `0`, editable.
            if (rv._type === 'function_handle') {
                return MatlabVariableNode.parseFunctionHandle(rv, name, parent);
            }
            // Also before the shape dispatch, and for the same reason. `{_type: 'struct',
            // _value: '[]'}` is MATLAB's only text spelling for struct([]) — the sole
            // _type:'struct' in the whole corpus. Read on its leading '[' it went to
            // parseTypedVector, which took the empty literal for one element of 0 and
            // showed the 0x0 struct as `[0]` with dims 1x1. A struct with FIELDS never
            // arrives this way: MATLAB writes `_array_type: 'Struct'` for rank <= 2 and a
            // cdata byte stream for rank >= 3.
            if (rv._type === 'struct' && /^\[\s*\]$/.test(rv._value)) {
                return MatlabVariableNode.parseEmptyStruct(rv, name, parent);
            }
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
    /**
     * struct([]) out of a text dictionary. Deliberately the same node
     * `_createFromMatStruct` builds for the same value — scalar kind, 'struct' class,
     * a null scalar value and the real extents — so `<0x0 struct>` is what all four
     * channels show and `displayValue`'s struct arm needs no empty case of its own.
     */
    static parseEmptyStruct(rawVal, name, parent) {
        const node = new MatlabVariableNode(name, parent, rawVal);
        node._rawInput = rawVal;
        node._kind = 'scalar';
        node._scalarType = 'struct';
        node._scalarValue = null;
        node._dims = [0, 0];
        return node;
    }
    /**
     * A function handle: `{_type: 'function_handle', _value: 'sin'}` — a text dictionary's
     * spelling of one, and the MCOS decoder's for a handle stored as an object's property
     * (McosParser.functionHandleText). Shown as MATLAB shows it, `@sin`, and read-only: the
     * only writer that spells one is this node replaying the literal it was read from.
     */
    static parseFunctionHandle(rawVal, name, parent) {
        const node = new MatlabVariableNode(name, parent, rawVal);
        node._rawInput = rawVal;
        node._kind = 'scalar';
        node._dims = [1, 1];
        node._scalarType = 'function_handle';
        node._scalarValue = String(rawVal._value);
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
        const bare = rawVal._value.replace(/[FU]$/, '');
        if (rawVal._type === 'logical') {
            node._scalarValue = bare === '1' || bare === 'true';
        }
        else if (needsExactInt(node._scalarType)) {
            // Exact decimal TEXT, not a number: cases.sldd's maxU64 is 18446744073709551615,
            // which parseMatlabNum rounds to 18446744073709552000 — a value now OUT of uint64
            // range, which MATLAB refuses on read (defect 29). _scalarValue is `unknown` and
            // needsTypedLiteral keys off the CLASS, so the writer still spells it
            // `Class="uint64"` with the 'U' suffix, from the digits MATLAB itself wrote.
            node._scalarValue = parseExactNum(bare);
        }
        else {
            node._scalarValue = parseMatlabNum(bare);
        }
        return node;
    }
    /**
     * A value a binary dictionary stored as an encoded byte stream (parser/EncodedValue),
     * decoded into the node the same value gets everywhere else.
     *
     * The bytes are `getByteStreamFromArray(value)`: the same MAT stream a text dictionary
     * carries as cdata (parseCdata) and a model workspace as its .mxarray part, so they go
     * through the reader those use — MatParser.decodeMatStream for the framing and the
     * array, and, for an MCOS object, the stream's own trailing subsystem element decoded
     * exactly as ModelNode decodes a workspace's (attachMcosDecoded, reached through the
     * registry). parseMatVariable then builds what it builds for that variable anywhere: a
     * sparse array is a numeric array, a struct a struct, a Simulink.Parameter the
     * ParameterNode a text dictionary's twin of it is.
     *
     * Whatever node comes back writes the stream back as it was read, for as long as nothing
     * changes the value (DataNode._adoptEncoded), and everything at or under it is read-only
     * (DataNode._refuseEncodedEdit): nothing in this package writes a new one for every value
     * a stream can hold.
     *
     * A stream that does not read — not hex, not a MAT stream, shorter than it says, or an
     * array class MatParser does not model — is the placeholder below, never a number. An
     * MCOS object whose subsystem does not decode is the opaque `<1x1 CLASS>` it is
     * everywhere else.
     *
     * And one that reads but does not DECODE — whose bytes are framed right and say
     * something the readers or the node builders below cannot make sense of — is the same
     * placeholder: the stream is one entry's value, and a throw out of here failed the open
     * of the whole dictionary, every other entry with it, where 1.36.1 opened it (it read
     * the hex as a number) and a text dictionary's cdata reader catches the same throw. The
     * failure is recorded for the dictionary's warnings (EncodedValue.recordDecodeFailure,
     * which SlddNode.parse collects per entry), and the bytes are written back unchanged.
     */
    static parseEncoded(encoded, name, parent) {
        const stream = encodedStream(encoded);
        if (!stream.bytes) {
            return MatlabVariableNode._createEncodedPlaceholder(encoded, name, parent, null);
        }
        const decoded = decodeMatStream(stream.bytes);
        if (!decoded.ok) {
            recordDecodeFailure(decoded.reason);
            return MatlabVariableNode._createEncodedPlaceholder(encoded, name, parent, null);
        }
        const outer = decoded.variable;
        const dims = outer.dimensions;
        if (outer.className === 'unknown') {
            return MatlabVariableNode._createEncodedPlaceholder(encoded, name, parent, dims);
        }
        try {
            NodeRegistry.attachMcosDecoded(decoded.trailingElements[0], [outer]);
            const node = MatlabVariableNode.parseMatVariable(outer, name, parent);
            node._adoptEncoded(encoded);
            return node;
        }
        catch (e) {
            recordDecodeFailure('its MAT stream did not decode (' + (e instanceof Error ? e.message : String(e)) + ')');
            return MatlabVariableNode._createEncodedPlaceholder(encoded, name, parent, dims);
        }
    }
    /**
     * An encoded value whose bytes say nothing this reader can show: one row, `<CLASS, not
     * decoded>` — `<RxC CLASS, not decoded>` when the stream got as far as its size — and no
     * children. The class is the one the element names, which is MATLAB's `class(value)`.
     * Angle-bracketed like every summary (MatParser's `undecodedValue` is the same
     * spelling), so it is styled as one and offered no editor; it would be refused one anyway
     * (_refuseEncodedEdit). What it must never be is a number read out of the text, which is
     * what every hex value used to show.
     */
    static _createEncodedPlaceholder(encoded, name, parent, dims) {
        const node = new MatlabVariableNode(name, parent, {});
        const cls = encodedClass(encoded) || 'double';
        const shape = dims && dims.length >= 2 ? dims.join('x') + ' ' : '';
        node._kind = 'scalar';
        node._undecoded = true;
        node._scalarType = cls;
        node._scalarValue = '<' + shape + cls + ', not decoded>';
        node._dims = dims && dims.length >= 2 ? dims.slice() : [1, 1];
        node._adoptEncoded(encoded);
        return node;
    }
    /**
     * A text dictionary's MAT stream that a binary dictionary can only hold as hex, as the
     * hex MATLAB writes for it — or null.
     *
     * MATLAB writes a binary dictionary entry as `Encoding="hex"` exactly when its value holds
     * a sparse array or a function handle anywhere inside it (make_sparse_fixtures.m grades
     * that on every entry), and an MCOS object rides in the same stream with its subsystem.
     * Such a value in a TEXT dictionary is a cdata stream of the very same bytes (character
     * for character: the fixture's text twin of spDiag is uuencode of the binary's hex), so
     * an untouched one pasted from text into binary goes in as those bytes, under MATLAB's
     * own `Class` — class(value) — and layout. Rebuilt as XML instead it would be the full
     * array, a different variable; and the XML spelling it had before this, `Class="sparse"`,
     * made MATLAB's reader segfault (measured).
     *
     * That is while the stream is still the value — untouched, or only renamed (DataNode
     * keeps `_rawInput` across a rename and drops it for every other edit). Once anything
     * else has changed it, or for a value that never was a stream (a cell bag, a variable
     * out of a .mat), the stream is the one MatWriter writes for the live value: MATLAB's
     * own bytes for a sparse array (MatWriter.encodeSparse) and for the cell around one.
     * Without that, an element edit or a rename of a pasted sparse array wrote it full, and
     * one too large to decode wrote the text of its placeholder. A value MatWriter cannot
     * write — an MCOS object, a function handle — has no hex this package can make, and
     * takes its XML as before.
     */
    _binaryEncoded() {
        return this._hexValue(2);
    }
    /**
     * This value as a binary dictionary's hex element at `indent`, when it can only be one
     * and this package can make it — see _binaryEncoded for the entry, serializeXml for one
     * further down — or null.
     */
    _hexValue(indent) {
        // A value READ from hex writes that hex back itself, byte for byte (_adoptEncoded):
        // not this, which would be the stream re-encoded — MATLAB's bytes for MATLAB's own
        // stream, but not the element's layout, and not a damaged stream's bytes at all.
        if (this._encoded) {
            return null;
        }
        const raw = this._rawInput;
        if (raw && isMatCdata(raw) && this._matVar) {
            // The stream it was read from, which is MATLAB's own bytes whatever it holds.
            if (!needsHexInBinary(this._matVar)) {
                return null;
            }
            const bytes = matStreamPrefix(uudecode(raw._value));
            if (bytes) {
                return hexValue(bytes, matlabClassOf(this._matVar), indent);
            }
        }
        // Otherwise the stream _matStream makes, for a sparse array and for a cell holding one:
        // MATLAB's own bytes (the tests hold MatWriter to that), or for a sparse array too
        // large to decode the element it was read from. A struct is not written whole: its
        // XML carries each sparse field as that field's own hex element (serializeXml), the
        // form MATLAB was measured reading back, where MatWriter's struct stream is not byte
        // for byte the one MATLAB writes.
        //
        // Nor is a cell holding a value that is still a stream of its own (a binary
        // dictionary's nested hex element, _adoptEncoded): written whole, that member would
        // be re-encoded from what it decoded to rather than replayed as read. Its XML writes
        // the member back byte for byte.
        //
        // Nor a cell holding anything MatWriter cannot write as what it is (_matWritable):
        // written whole, every Simulink object in it went out as a 0x0 double and every
        // string as a char, and MATLAB read the cell back that way. Its XML writes each
        // element as itself, and each sparse one as a hex element of its own (serializeXml),
        // which MATLAB reads back as the cell it was.
        if (!this._isSparse && !(this._kind === 'cell' && this._holdsSparse() && !this._holdsEncoded() && this._matWritable())) {
            return null;
        }
        const bytes = this._matStream();
        return bytes ? hexValue(bytes, matlabClassOf(this._var), indent) : null;
    }
    /**
     * Is there a sparse array at or under this node? Asked of the nodes rather than of
     * `_var`, so that a save does not rebuild every entry's variable to find out: only a
     * cell and a struct hold values of their own, and an array's children are its elements.
     */
    _holdsSparse() {
        if (this._isSparse) {
            return true;
        }
        if (this._kind !== 'cell' && this._scalarType !== 'struct') {
            return false;
        }
        return this.children.some((c) => c instanceof MatlabVariableNode && c._holdsSparse());
    }
    /**
     * Can MatWriter write this value as the value it is? Not an MCOS object (it refuses
     * one), and not a value whose rebuilt variable (_var) is not the value: a string, which
     * it writes as a char; a function handle; a reader's placeholder for a value it did not
     * decode; and, inside a cell or a struct, any node of another class — a Simulink object,
     * a struct read from a dictionary — which has no `_var` at all and went out as a 0x0
     * double.
     */
    _matWritable() {
        // A string array and its elements alike say 'string' here.
        if (this._isOpaque || this._undecoded || this._scalarType === 'string' || this._scalarType === 'function_handle') {
            return false;
        }
        if (this._kind === 'cell' || this._scalarType === 'struct') {
            return this.children.every((c) => c instanceof MatlabVariableNode && c._matWritable());
        }
        return true;
    }
    /** Is there a value still in an encoded stream of its own under this cell or struct? */
    _holdsEncoded() {
        if (this._kind !== 'cell' && this._scalarType !== 'struct') {
            return false;
        }
        return this.children.some((c) => !!c._encoded || (c instanceof MatlabVariableNode && c._holdsEncoded()));
    }
    /**
     * An object whose class nothing in the file names: `<1x1 object>`, the summary of an
     * object of no known class, with the object glyph and no editor. Its bag is replayed
     * untouched, as every value read from a file is.
     */
    static createUnnamedObject(rawVal, name, parent) {
        const node = new MatlabVariableNode(name, parent, {});
        node._rawInput = rawVal;
        node._kind = 'scalar';
        node._undecoded = true;
        node._scalarType = 'object';
        node._scalarValue = '<1x1 object>';
        node._dims = [1, 1];
        return node;
    }
    static parseCdata(rawVal, name, parent) {
        const valStr = rawVal._value;
        if (/^[\d.eE+\-i\s]+$/.test(valStr) || MatlabVariableNode._isOwnNonFiniteText(rawVal)) {
            return MatlabVariableNode._parseCdataText(rawVal, name, parent);
        }
        try {
            // The six-bit text is a MAT stream (MatParser.decodeMatStream reads it, as it reads
            // every venue's); one that is not shows as the char it is, below.
            const stream = decodeMatStream(uudecode(valStr));
            if (!stream.ok) {
                throw new Error('cdata is not a MAT stream: ' + stream.reason);
            }
            const variable = stream.variable;
            // Always a MatlabVariableNode here: only the opaque arm builds anything else, and
            // only for a variable a container attached a decode to (mcosDecodedTable), which
            // one parsed out of a cdata stream a line above has not had the chance to be.
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
    /**
     * Complex text with an Inf or NaN part that this package wrote itself, which the test
     * above does not admit: McosParser.complexPropertyValue marks the envelope `_nonFinite`
     * when it spells such a part, and every element has to read as one.
     *
     * The test stays closed to the binary dictionary's own non-finite text on purpose.
     * MATLAB writes complex(1, NaN) there as `1.0NaNi` and its own reader takes
     * `1.0NaNi -Inf+2.0i` back as two REAL elements (complex_binary_sldd.truth.json's
     * pNonFinite), so what that text means is an open question, and that copy keeps the
     * quoted-char fallback below (test/parity/matlab/DESIGN.md, defect 57). The decoder's
     * text has no such question — it is formatComplexNum's spelling of numbers MATLAB's own
     * .mat bytes hold — and through the fallback a single NaN turned a whole complex array
     * into one char: `[1+2i NaN 3-4i]` showed `'1+2i NaN+0i 3-4i'`, class char, no rows,
     * where the plain .mat variable beside it showed three complex doubles.
     */
    static _isOwnNonFiniteText(rawVal) {
        if (rawVal._nonFinite !== true || typeof rawVal._value !== 'string') {
            return false;
        }
        const parts = rawVal._value.trim().split(/\s+/);
        return parts.length > 0 && parts.every((t) => parseComplexNum(t) !== null);
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
        // The value's own class where the envelope records one (complexClassTag), which is how
        // the container summarizes and types itself — `<1x60 int16>`, as a plain .mat
        // variable and a text dictionary show the same value. It was 'double' for every
        // complex array, whatever MATLAB's class() said. The elements stay 'complex' scalars,
        // as they are in every venue.
        node._scalarType = complexClassTag(rawVal._class) ?? 'double';
        node._dims = dims;
        node._elements = parts;
        node._buildArrayChildren('complex');
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
        else if (needsExactInt(node._scalarType)) {
            // See parseTypedScalar: a 64-bit element is exact decimal TEXT. This is the arm
            // typed_text.sldd's u64Vec2 takes, and rounding it here cost more than the one
            // element — MATLAB abandons the REST of an array's body at the first out-of-range
            // token, so a perfectly representable neighbour came back zero too (defect 30).
            node._elements = parts.map(parseExactNum);
        }
        else {
            node._elements = parts.map(parseMatlabNum);
        }
        node._dims = [1, node._elements.length];
        node._buildArrayChildren();
        return node;
    }
    /**
     * MATLAB's `mxchar` literal: a char array of rank >= 2, spelled as character CODES
     * under a `Matrix(r,c)` header with one bracketed group per ROW.
     *
     * It becomes the same node a .mat or a binary dictionary produces for the same value
     * — one char-KIND scalar holding the whole text in MATLAB's column-major storage
     * order, with the real extents on _dims. So `['ab'; 'cd']` reads identically out of
     * all three channels, and the writers (_serializeScalar, _serializeScalarXml,
     * _buildVarObject) each spell it their own way from that single representation.
     *
     * Read as a numeric array instead — which is what the Matrix() dispatch did before
     * this arm existed — the value came back as a 2x2 of 97/98/99/100 with dataType
     * 'mxchar', displayed `[97 98; 99 100]`, and had no char anything about it.
     */
    static parseMxChar(rawVal, name, parent) {
        const node = new MatlabVariableNode(name, parent, rawVal);
        node._rawInput = rawVal;
        node._kind = 'scalar';
        node._scalarType = 'char';
        const parsed = parseMatrixValue(rawVal);
        if (!parsed) {
            // No header to read. MATLAB never writes this — it spells a row as a bare JSON
            // string, never as a headerless mxchar — but a value with no shape to honour is
            // the row it must mean, and the text is its own body.
            const text = String(rawVal._value ?? '');
            node._scalarValue = text;
            node._dims = [1, text.length];
            return node;
        }
        node._dims = parsed.dims.slice();
        // .map(Number) because parseMatrixValue is typed for the 64-bit case now; a char
        // code is never one, so every element here is already a number.
        node._scalarValue = charTextFromCodes(parsed.elements.map(Number), parsed.dims);
        return node;
    }
    static parseFlatArray(rawVal, name, parent) {
        const node = new MatlabVariableNode(name, parent, rawVal);
        node._rawInput = rawVal;
        node._kind = 'array';
        node._elements = rawVal;
        // 0x0 for an empty, not [1, 0]: a bare `[]` is what MATLAB writes for `[]`,
        // whose `size` is 0x0, and the binary dictionary, the .slx and the .mat all
        // report 0x0 for the same value — only the text path said 1x0. 1x0 is the
        // shape of `x=1; x(1)=[]`, which is what _updateArrayAfterRemove produces and
        // is a different value; nothing was removed from a stored `[]`.
        node._dims = rawVal.length === 0 ? [0, 0] : [1, rawVal.length];
        node._scalarType = 'double';
        // _buildArrayChildren, not a loop here: it owns the element class, the
        // single-element guard and the expansion cap, so this path cannot drift out of
        // step with the container or with the other five parse paths again.
        node._buildArrayChildren();
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
            node._scalarType = rawVal._type === 'sparse' ? 'double' : rawVal._type;
            node._isSparse = rawVal._type === 'sparse';
            return node;
        }
        const node = new MatlabVariableNode(name, parent, rawVal);
        node._rawInput = rawVal;
        node._kind = 'array';
        node._elements = parsed.elements;
        node._dims = parsed.dims.slice();
        node._scalarType = parsed.type;
        // This package's own spelling of an edited sparse double (_serializeArray), read back:
        // a sparse double, as MATLAB reads it.
        if (parsed.type === 'sparse') {
            node._scalarType = 'double';
            node._isSparse = true;
        }
        node._buildArrayChildren();
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
        node._buildStringChildren();
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
        node._buildStringChildren();
        return node;
    }
}
//# sourceMappingURL=MatlabVariableNode.js.map