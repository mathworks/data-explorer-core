import BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef, RowData } from '../BaseNode.js';
export default class DataSourceNode extends BaseNode {
    fullPath: string;
    resolved: boolean;
    constructor(name: string, parent: BaseNode | null, fullPath: string);
    get isEntry(): boolean;
    get icon(): string;
    get displayName(): string;
    get displayValue(): string;
    get className(): string;
    get nameEditable(): boolean;
    get valueEditable(): boolean;
    toRow(): RowData | null;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[];
}
//# sourceMappingURL=DataSourceNode.d.ts.map