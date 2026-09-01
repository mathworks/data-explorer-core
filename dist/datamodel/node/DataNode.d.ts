import BaseNode from './BaseNode.js';
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
    _resolveProperty(propName: string): string;
    setProperty(propName: string, stringValue: string): true | SetPropertyResult;
    _setMinMax(propName: 'Min' | 'Max', stringValue: string): true | SetPropertyResult;
    execAddChild(): ChildAddEdit | null;
    execRemoveChild(_child?: BaseNode): ChildUndoRedo | null;
    _markModified(): void;
    _stampLastModified(): void;
    serialize(): unknown;
    _serializeSimulinkObject(propOverrides: Record<string, unknown>): unknown;
    serializeValue(): unknown;
    serializeXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    _serializeSimulinkObjectXml(tagName: string, attrs: Record<string, string> | undefined, indent: number): string;
    _getSerializedProperties(): Record<string, unknown>;
    static serializePropertyXml(name: string, value: unknown, indent: number, ownerNode: DataNode | null): string;
    static _serializeTypedPropertyXml(name: string, value: Record<string, unknown>, indent: number): string;
    static _serializeObjectPropertyXml(name: string, value: Record<string, unknown>, indent: number, ownerNode: DataNode | null): string;
    static _serializeStructPropertyXml(name: string, value: Record<string, unknown>, indent: number): string;
    static _serializeCellPropertyXml(name: string, value: Record<string, unknown>, indent: number): string;
    static _serializeCellElementXml(elem: unknown, indent: number): string;
    static _parseMatrixNums(body: string): number[];
}
//# sourceMappingURL=DataNode.d.ts.map