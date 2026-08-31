import BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef, RowData } from '../BaseNode.js';
export default class ModelBlockNode extends BaseNode {
    blockType: string;
    paramUsages: Array<{
        property: string;
        value: string;
    }>;
    modelSrcId: string;
    paramSourceId: string | null;
    constructor(name: string, parent: BaseNode | null, blockType: string, paramUsages: Array<{
        property: string;
        value: string;
    }>, modelSrcId: string, paramSourceId: string | null);
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
//# sourceMappingURL=ModelBlockNode.d.ts.map