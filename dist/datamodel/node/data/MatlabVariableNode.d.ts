import DataNode from '../DataNode.js';
import type { SetPropertyResult } from '../DataNode.js';
import type { PropClass, MatlabVariableKind } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import type { ChildAddEdit, ChildUndoRedo } from '../childEdit.js';
import PropDescription from '../../prop/PropDescription.js';
import PropKind from '../../prop/PropKind.js';
import { type MatVariable } from '../../parser/MatParser.js';
export type { MatVariable };
export default class MatlabVariableNode extends DataNode {
    _kind: MatlabVariableKind;
    _scalarValue: unknown;
    _scalarType: string;
    _elements: unknown[];
    _dims: number[];
    _rawBytes: Uint8Array | null;
    _matVar: MatVariable | null;
    _varStale: boolean;
    _isOpaque: boolean;
    _opaqueClassName: string | null;
    _mcosProperties: Record<string, unknown> | null;
    _mcosValue: unknown;
    _mcosDimensions: number[] | null;
    _preCollapseDims: number[] | null;
    _elementType: string | null;
    constructor(name: string, parent: BaseNode | null, serial?: Record<string, unknown>);
    get Value(): unknown;
    set Value(v: unknown);
    get elements(): unknown[];
    get dims(): number[];
    get arrayType(): string;
    get icon(): string;
    get className(): string;
    get dataType(): string;
    get kind(): string;
    get fixesChildNames(): boolean;
    get nameEditable(): boolean;
    get valueEditable(): boolean;
    get isScalarNumeric(): boolean;
    get displayValue(): string;
    _formatScalar(): string;
    _textDims(text: string): number[];
    _formatArray(): string;
    _formatCell(): string;
    _cellLiteralElement(child: BaseNode): string;
    _formatString(): string;
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
     * null for a kind that has no elements (a scalar, a struct, an object): an empty
     * list is a different and also true answer, meaning an array with nothing in it.
     */
    displayElements(): Array<{
        label: string;
        value: string;
    }> | null;
    get descriptionEditable(): boolean;
    getProperties(): PropClass[];
    getPILayout(): {
        group: string;
        items: (typeof PropKind | typeof PropDescription)[];
    }[];
    setProperty(propName: string, stringValue: string): true | SetPropertyResult;
    _isConstrainedChild(): boolean;
    _setConstrainedValue(stringValue: string): true | SetPropertyResult;
    _markModified(): void;
    _syncElementFromChild(child: BaseNode): void;
    _applyParsed(parsed: {
        type: string;
        value: unknown;
        dims?: number[];
    }): void;
    _buildMatrixString(dims: number[], elements: (number | string)[], type?: string): string;
    _buildArrayChildren(elementType?: string): void;
    private _makeStringElement;
    _buildStringChildren(): void;
    _buildCellChildren(elements: unknown[]): void;
    canAddChild(): boolean;
    addChildNode(): BaseNode | null;
    private _becomeStruct;
    _convertToStructAndAddField(): MatlabVariableNode;
    _addStructField(): MatlabVariableNode;
    _addArrayChild(): MatlabVariableNode;
    _addCellChild(): MatlabVariableNode;
    _addStringChild(): MatlabVariableNode;
    canRemoveChild(): boolean;
    removeChildNode(child: BaseNode): void;
    _updateArrayAfterRemove(): void;
    _updateCellAfterRemove(): void;
    _updateStringAfterRemove(): void;
    restoreChildNode(child: BaseNode, index: number): void;
    execAddChild(): ChildAddEdit | null;
    private _addFirstStructField;
    execRemoveChild(child?: BaseNode): ChildUndoRedo | null;
    private _updateDimsForCount;
    private _syncArraySerial;
    _reindexChildren(): void;
    serializeValue(): unknown;
    /**
     * Is this a complex value? The two tests are the two shapes complexity arrives
     * in: a complex SCALAR carries `_scalarType === 'complex'`, while a complex ARRAY
     * is a plain `double` whose per-element values are the literal text `'1+2i'` —
     * the element nodes are the complex ones, not the parent. `_buildVarObject` has
     * always had to make the same distinction to set `isComplex`, and it asks here so
     * the projection and the serialization cannot disagree about what is complex; a
     * disagreement would mean writing a cdata stream built from a non-complex `_var`.
     */
    _isComplexValue(): boolean;
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
    _complexClass(): string;
    _serializeCdata(): unknown | null;
    _serializeScalar(): unknown;
    _serializeArray(): unknown;
    _serializeStructValue(): unknown;
    _serializeCell(): unknown;
    _serializeString(): unknown;
    serializeXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    _serializeScalarXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    _serializeArrayXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    _serializeCellXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    _serializeStringXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    get _var(): MatVariable;
    _buildVarObject(): MatVariable;
    static parseMatVariable(variable: MatVariable, name: string, parent: BaseNode | null): DataNode;
    static _createOpaque(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode;
    static _createUndecoded(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode;
    static createFromMcosDecoded(variable: MatVariable, decoded: {
        value: unknown;
        properties: Record<string, unknown>;
        dimensions: number[];
        stringElements?: (string | null)[] | null;
    }, parent: BaseNode | null, name?: string): MatlabVariableNode;
    private _adoptStringPayload;
    static _createFromMatNumeric(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode;
    static _createFromMatChar(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode;
    static _createFromMatStruct(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode;
    static _createFromMatCell(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): MatlabVariableNode;
    static _createScalar(value: unknown, type: string, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parse(rawVal: unknown, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseScalar(rawVal: unknown, name: string, parent: BaseNode | null): MatlabVariableNode;
    /**
     * struct([]) out of a text dictionary. Deliberately the same node
     * `_createFromMatStruct` builds for the same value — scalar kind, 'struct' class,
     * a null scalar value and the real extents — so `<0x0 struct>` is what all four
     * channels show and `displayValue`'s struct arm needs no empty case of its own.
     */
    static parseEmptyStruct(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseTypedScalar(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseCdata(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
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
    static _isOwnNonFiniteText(rawVal: Record<string, unknown>): boolean;
    static _parseCdataText(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseTypedVector(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
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
    static parseMxChar(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseFlatArray(rawVal: unknown[], name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseTypedArray(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseCell(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseStructuredString(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parsePlainStringArray(rawVal: string[], name: string, parent: BaseNode | null): MatlabVariableNode;
}
//# sourceMappingURL=MatlabVariableNode.d.ts.map