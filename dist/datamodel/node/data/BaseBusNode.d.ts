import DataNode from '../DataNode.js';
import type { SetPropertyResult } from '../DataNode.js';
import type { PropClass } from '../BaseNode.js';
import type BaseNode from '../BaseNode.js';
import type { ChildAddEdit, ChildUndoRedo } from '../childEdit.js';
import PropName from '../../prop/PropName.js';
import PropDataType from '../../prop/PropDataType.js';
import PropDescription from '../../prop/PropDescription.js';
import PropKind from '../../prop/PropKind.js';
import PropClassAtom from '../../prop/PropClass.js';
export declare function withSourceKeys(atom: PropClass, sourceKeys: string[]): PropClass;
export declare class BaseBusElementNode extends DataNode {
    Description: string;
    constructor(name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>);
    get icon(): string;
    get displayValue(): string;
    get disabled(): boolean;
    get valueEditable(): boolean;
    setProperty(propName: string, stringValue: string): true | SetPropertyResult;
    serializeValue(): unknown;
    _applyElementOverrides(props: Record<string, unknown>): void;
}
export declare class BaseBusNode extends DataNode {
    Description: string;
    constructor(name: string, parent: BaseNode | null, serial: Record<string, unknown>);
    get icon(): string;
    get displayValue(): string;
    get valueEditable(): boolean;
    getProperties(): PropClass[];
    _getSerializedProperties(): Record<string, unknown>;
    /**
     * The properties as a binary dictionary writes them: a bus with no elements has an
     * Elements_internal that is an empty array of its element class, as MATLAB writes one, `<P
     * Name="Elements_internal" Class="Simulink.BusElement" Dimension="0*0"/>` (every one of the
     * 22,225 empty buses and connection buses in the local corpus), wherever its bag says
     * otherwise: `[]`, which a bus emptied here, added here or pasted from a text dictionary
     * carries, wrote `Class="double" Dimension="0*0"`, and `''` `Class="char"`. One read with its
     * class keeps it.
     */
    _xmlProperties(): Record<string, unknown>;
    serializeValue(): unknown;
    canRemoveChild(): boolean;
    removeChildNode(child: BaseNode): void;
    restoreChildNode(child: BaseNode, index: number): void;
    canAddChild(): boolean;
    addChildNode(): BaseNode | null;
    _maxElementId(): number;
    _nextElementId(): string;
    execAddChild(): ChildAddEdit | null;
    execRemoveChild(child?: BaseNode): ChildUndoRedo | null;
    _createElementNode(_name: string, _props: Record<string, unknown>, _serial: Record<string, unknown>): BaseNode | null;
    static ELEMENT_CLASS_NAME: string;
    static _parseElements(rawVal: Record<string, unknown>, name: string, parent: BaseNode | null, BusNodeClass: new (name: string, parent: BaseNode | null, serial: Record<string, unknown>) => BaseBusNode, ElementNodeClass: new (name: string, parent: BaseNode | null, props: Record<string, unknown>, serial: Record<string, unknown>) => BaseBusElementNode): BaseBusNode;
    static _createDefaultBus(name: string, parent: BaseNode | null, BusNodeClass: new (name: string, parent: BaseNode | null, serial: Record<string, unknown>) => BaseBusNode, className: string): BaseBusNode;
}
export { PropName, PropDataType, PropDescription, PropKind, PropClassAtom };
declare const _default: {
    BaseBusNode: typeof BaseBusNode;
    BaseBusElementNode: typeof BaseBusElementNode;
    PropName: typeof PropName;
    PropDataType: typeof PropDataType;
    PropDescription: typeof PropDescription;
    PropKind: typeof PropKind;
    PropClassAtom: typeof PropClassAtom;
};
export default _default;
//# sourceMappingURL=BaseBusNode.d.ts.map