import type { Bracket, ElementOrder } from '../display/Subscript.js';
import type RowCellPool from './RowCellPool.js';
export interface PropClass {
    key: string;
    displayName: string;
    column?: string | null;
    editor: string;
    nodeProperty?: string;
    readValue?: (node: BaseNode) => string;
    readOptions?: (node: BaseNode) => string[];
    unformat?: (text: string) => string;
    sourceKeys?: string[];
    format: (value: unknown) => string;
}
export interface PropInfo {
    key: string;
    displayName: string;
    value: unknown;
    displayValue: string;
    editable: boolean;
    editor: string;
    options?: string[];
}
export interface RowData {
    ID: string;
    parent: string | null;
    Status: string;
    Name?: {
        label: string;
        iconId: string;
        disabled: boolean;
        editable: boolean;
        element: boolean;
    };
    Value?: unknown;
    _valueEditable?: boolean;
    _descriptionEditable?: boolean;
    DataType?: string | {
        prefix?: string;
        text: string;
        linkTarget?: string;
    };
    Class?: string;
    Kind?: string;
    Description?: string;
    UsedBy?: string | {
        text: string;
        linkTarget?: string;
    } | {
        links: {
            text: string;
            linkTarget: string;
        }[];
    };
    [key: string]: unknown;
}
/**
 * How a node reaches the reverse-usage index, which lives on the SESSION.
 *
 * A node has no reference to a session and must not acquire one: this package is
 * consumed by a VS Code extension, a CLI and an RPC server, and a node reaching for a
 * session would be reaching for whichever of them happened to build it. So the session
 * stamps this callback onto each source ROOT as it registers it — the same place, and in
 * the same way, registerSource already stamps `meta` and `warnings` — and a node walks
 * up to its root to find one, the walk `_markSourceDirty` already makes for the `dirty`
 * flag. Injection, not a dependency: nothing here imports the session, and a tree no
 * session registered simply has no resolver (see _usedByCell).
 *
 * Deliberately NARROWER than the session's own `NodeUsage`: the two fields a link cell
 * can hold, and nothing else. Naming NodeUsage here would have BaseNode import a type
 * from core for two thirds of it, and the narrow shape records at the seam exactly how
 * much of a usage a row is allowed to know. `NodeUsage[]` satisfies this, and stops
 * satisfying it the day either field is renamed — which is where that check belongs.
 */
export type UsageResolver = (nodeId: string) => {
    blockName: string;
    linkTarget: string;
}[];
/**
 * How a node reaches the forward TYPE index, which lives on the SESSION.
 *
 * The mirror of UsageResolver above, on the same seam and for the same reason: `UsedBy`
 * asks "what references this definition", a Data Type cell asks "which definition does
 * this name reach", and neither question is one a node can answer from inside itself.
 * Stamped on the source root by registerSource; a node walks up to find it.
 *
 * Takes the type NAME, not the cell text: the split of `Bus: artFsAimCmd` into a plain
 * qualifier and a linked name is a presentation decision that belongs with the cell (see
 * typeLinkCell), and pushing it across this seam would make the session responsible for
 * how a column reads. Returns the link target, or null when the name reaches nothing —
 * null rather than a throw, because a name with no definition behind it is the ordinary
 * case (every built-in type is one).
 */
export type TypeLinkResolver = (typeName: string) => string | null;
export interface PIGroupDef {
    group: string;
    items: PropClass[];
}
export interface PIObject {
    propertySheet: {
        properties: unknown[];
        groups: unknown[];
    };
    objects: unknown[];
    showGroups: boolean;
    showDefaultGroup: boolean;
}
export type MatlabVariableKind = 'scalar' | 'array' | 'cell' | 'string';
export interface ElementSubscript {
    index: number;
    dims: number[] | undefined;
    order: ElementOrder;
    bracket: Bracket;
}
export default class BaseNode {
    name: string;
    parent: BaseNode | null;
    children: BaseNode[];
    _displayName?: string;
    _subscript?: ElementSubscript;
    _kind?: MatlabVariableKind;
    _dims?: number[];
    constructor(name: string, parent: BaseNode | null);
    get id(): string;
    get icon(): string;
    get className(): string;
    get kind(): string;
    get dataType(): string;
    get displayValue(): string;
    get disabled(): boolean;
    get isIndexedName(): boolean;
    get isElementName(): boolean;
    get isObjectPropertyBag(): boolean;
    get nameEditable(): boolean;
    childStructureChanged(_child: BaseNode): void;
    canAddChild(): boolean;
    addChildNode(): BaseNode | null;
    addChild(child: BaseNode, index?: number): BaseNode;
    removeChild(child: BaseNode): void;
    _replaceWith(newNode: BaseNode): boolean;
    _invalidateTypeLinkIndex(): void;
    _markSourceDirty(): void;
    _usedByCell(): RowData['UsedBy'] | undefined;
    _typeLinkCell(cellText: unknown): RowData['DataType'] | undefined;
    flatten(): BaseNode[];
    get displayName(): string;
    get valueEditable(): boolean;
    get descriptionEditable(): boolean;
    getPropInfo(PropClassRef: PropClass): PropInfo;
    toRow(pool?: RowCellPool): RowData | null;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[] | null;
    toPIObject(): PIObject | null;
    serialize(): unknown;
}
//# sourceMappingURL=BaseNode.d.ts.map