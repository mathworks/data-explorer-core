import BaseNode from './BaseNode.js';
export interface TableColumnConfig {
    columns: string[];
    labels?: Record<string, string>;
}
export default class ContainerNode extends BaseNode {
    get isContainer(): boolean;
    get tableColumnConfig(): TableColumnConfig;
    toRow(): null;
    flatten(): BaseNode[];
}
//# sourceMappingURL=ContainerNode.d.ts.map