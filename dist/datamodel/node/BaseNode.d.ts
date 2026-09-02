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
    DataType?: string | {
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
export default class BaseNode {
    name: string;
    parent: BaseNode | null;
    children: BaseNode[];
    _displayName?: string;
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
    _markSourceDirty(): void;
    flatten(): BaseNode[];
    get displayName(): string;
    get valueEditable(): boolean;
    getPropInfo(PropClassRef: PropClass): PropInfo;
    toRow(): RowData | null;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[] | null;
    toPIObject(): PIObject | null;
    serialize(): unknown;
}
//# sourceMappingURL=BaseNode.d.ts.map