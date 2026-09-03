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
    get nameEditable(): boolean;
    get valueEditable(): boolean;
    get isScalarNumeric(): boolean;
    get displayValue(): string;
    _formatScalar(): string;
    _textDims(text: string): number[];
    _formatArray(): string;
    _formatCell(): string;
    _formatString(): string;
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
    _buildArrayChildren(): void;
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
    static parseMatVariable(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode;
    static _createOpaque(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode;
    static createFromMcosDecoded(variable: MatVariable, decoded: {
        value: unknown;
        properties: Record<string, unknown>;
        dimensions: number[];
    }, parent: BaseNode | null): MatlabVariableNode;
    static _createFromMatNumeric(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode;
    static _createFromMatChar(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode;
    static _createFromMatStruct(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode;
    static _createFromMatCell(variable: MatVariable, name: string, parent: BaseNode | null): MatlabVariableNode;
    static get defaultName(): string;
    static createDefault(name: string, parent: BaseNode | null): MatlabVariableNode;
    static _createScalar(value: unknown, type: string, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parse(rawVal: unknown, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseScalar(rawVal: unknown, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseTypedScalar(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
    static parseCdata(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null): MatlabVariableNode;
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