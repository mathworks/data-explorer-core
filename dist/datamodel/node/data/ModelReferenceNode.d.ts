import BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef, RowData } from '../BaseNode.js';
export default class ModelReferenceNode extends BaseNode {
    blockPath: string;
    resolved: boolean;
    constructor(name: string, parent: BaseNode | null, blockPath: string);
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
//# sourceMappingURL=ModelReferenceNode.d.ts.map