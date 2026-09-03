import BaseNode from './BaseNode.js';
import type { PropClass } from './BaseNode.js';
import type { ChildAddEdit, ChildUndoRedo } from './childEdit.js';
export interface SetPropertyResult {
    error: boolean;
    reason: string;
    invalidValue: string;
    validValue: string;
}
export default class DataNode extends BaseNode {
    metadata: Record<string, unknown> | null;
    serial: Record<string, unknown>;
    status: string;
    Description?: string;
    _rawInput?: unknown;
    rawXml?: string;
    classification?: string;
    constructor(name: string, parent: BaseNode | null, serial?: Record<string, unknown>);
    get kind(): string;
    get dataType(): string;
    get isEntry(): boolean;
    get isDerived(): boolean;
    get lastModified(): string;
    get lastModifiedBy(): string;
    get disabled(): boolean;
    _propFor(propName: string): PropClass | undefined;
    _resolveProperty(propName: string): string;
    setProperty(propName: string, stringValue: string): true | SetPropertyResult;
    _setMinMax(propName: 'Min' | 'Max', stringValue: string): true | SetPropertyResult;
    execAddChild(): ChildAddEdit | null;
    execRemoveChild(_child?: BaseNode): ChildUndoRedo | null;
    _renameField(from: string, to: string): void;
    _markModified(): void;
    _stampLastModified(): void;
    serialize(): unknown;
    _serializeSimulinkObject(propOverrides: Record<string, unknown>): unknown;
    /**
     * The stored property bag with this node's live values written over it.
     *
     * The subtlety is the saveobj envelope. When a class serializes through `saveobj`,
     * MATLAB stores its whole state inside one unnamed `<P Source="saveobj">` and the
     * individual properties are NOT siblings of it — so a node that reads such a property
     * finds nothing, substitutes its own default (VariantVariableNode's
     * `(props.Specification as string) || ''`), and then writes that default back as a
     * sibling. cases.sldd's aVariant grew a `<P Name="Specification" Class="char"/>` next
     * to its envelope for exactly that reason: an empty string MATLAB had never written,
     * standing in for an empty 0x0 double it could not see.
     *
     * So under an envelope an EMPTY override is dropped: it is a default rather than an
     * edit, and the envelope is already the authority on that property. A non-empty
     * override is still written, because silently discarding a real edit is worse than
     * writing a property MATLAB's loadobj may ignore.
     */
    _mergeProps(propOverrides: Record<string, unknown>): Record<string, unknown>;
    serializeValue(): unknown;
    serializeXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    _serializeSimulinkObjectXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    _getSerializedProperties(): Record<string, unknown>;
    /**
     * The identifying attributes of a `<P>`.
     *
     * Almost always `Name="x"`. The exception is MATLAB's saveobj envelope, which a class
     * that serializes through `saveobj` uses to carry its whole state: MATLAB writes
     * `<P Source="saveobj" PropertyType="any" Class="struct">` with NO Name at all, and the
     * reader files it under SAVEOBJ_KEY because a property bag needs a key. Written back as
     * `Name="undefined"` — what an absent @_Name used to produce — MATLAB's loadobj finds
     * no envelope and builds an EMPTY object: cases.sldd's aVariant reopened as a
     * Simulink.VariantVariable with 0 choices where MATLAB wrote 2 (defect 28).
     *
     * Every `<P>` in this file goes through here, so the envelope survives whichever arm of
     * serializePropertyXml its payload takes.
     */
    static pxAttrs(name: string): string;
    static serializePropertyXml(name: string, value: unknown, indent: number, ownerNode: DataNode | null): string;
    /**
     * The `Class="char" Dimension="r*c"` attributes and body of an mxchar literal, or
     * null for anything else — shared by the property and cell-element writers below.
     *
     * mxchar is MATLAB's TEXT-dictionary spelling of a shaped char (character codes, one
     * bracketed group per row); XML wants the plain column-major text under a Dimension
     * (defect 25). Written through the generic typed-value path instead, a char field of
     * a struct went out as `Class="mxchar" Dimension="2*2">97 99 98 100` — a class MATLAB
     * does not have, holding numbers where its characters were.
     */
    static _mxCharXml(value: Record<string, unknown>): {
        dimAttr: string;
        body: string;
    } | null;
    static _serializeTypedPropertyXml(name: string, value: Record<string, unknown>, indent: number): string;
    static _serializeObjectPropertyXml(name: string, value: Record<string, unknown>, indent: number, ownerNode: DataNode | null): string;
    static _serializeStructPropertyXml(name: string, value: Record<string, unknown>, indent: number): string;
    static _serializeCellPropertyXml(name: string, value: Record<string, unknown>, indent: number): string;
    static _serializeCellElementXml(elem: unknown, indent: number): string;
    /**
     * One number out of a typed literal: '3.14159274F', '18446744073709551615U', '-1'.
     *
     * A 64-bit integer comes back as exact decimal TEXT rather than a number, because
     * every value MATLAB's int64/uint64 range holds past 2^53 is one a double does not
     * (XmlUtils.parseExactNum). This routine is the single re-parse point of the XML write
     * path, and it used to be `parseMatlabNum` at four separate call sites: a uint64 read
     * losslessly by BinarySlddParser was still rounded here, one step before the file, so
     * maxU64 went out as 18446744073709552000U — a token now OUT of uint64 range, at which
     * MATLAB's reader abandons the rest of the body and zeroes the value's remaining
     * elements (defects 29 and 30).
     */
    static _numToken(text: string, type: string): number | string;
    static _parseMatrixNums(body: string, type?: string): (number | string)[];
}
//# sourceMappingURL=DataNode.d.ts.map