import BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef, RowData } from '../BaseNode.js';
import type RowCellPool from '../RowCellPool.js';
export default class ModelReferenceNode extends BaseNode {
    blockPath: string;
    resolved: boolean;
    constructor(name: string, parent: BaseNode | null, blockPath: string);
    /**
     * `…/references/plant.slx@top/A`: the referenced name, then the referencing block's path.
     *
     * The name is the FILE a reference points at, so a model that references `plant` from
     * two Model blocks has two rows named `plant.slx`, and the inherited id gave both
     * `…/references/plant.slx`. A node id is what findNodeById resolves, what a row is keyed
     * by and what a selection is remembered as, so two nodes with one id were two rows the
     * host could not tell apart, and the session index kept only one of them. The block path
     * is unique per Model block, which makes the id unique whatever characters it holds.
     *
     * ModelBlockNode.id is the precedent: it keys a block on its SID for the same reason.
     * The name, the Name column and the link target (`this.name`) are unchanged.
     */
    get id(): string;
    get isEntry(): boolean;
    get icon(): string;
    get displayName(): string;
    get displayValue(): string;
    get className(): string;
    get nameEditable(): boolean;
    get valueEditable(): boolean;
    toRow(pool?: RowCellPool): RowData | null;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[];
}
//# sourceMappingURL=ModelReferenceNode.d.ts.map