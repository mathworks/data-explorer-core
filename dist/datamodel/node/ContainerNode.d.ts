import BaseNode from './BaseNode.js';
export interface TableColumnConfig {
    columns: string[];
    labels?: Record<string, string>;
}
export default class ContainerNode extends BaseNode {
    get isContainer(): boolean;
    get tableColumnConfig(): TableColumnConfig;
    toRow(): null;
    get valueEditable(): boolean;
    _addChildRefusal(describe?: boolean): string | null;
    _removeChildRefusal(_child?: BaseNode, describe?: boolean): string | null;
    flatten(): BaseNode[];
}
//# sourceMappingURL=ContainerNode.d.ts.map