// Copyright 2026 The MathWorks, Inc.

import BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef, RowData } from '../BaseNode.js';
import type RowCellPool from '../RowCellPool.js';
import PropName from '../../prop/PropName.js';
import PropBlockPath from '../../prop/PropBlockPath.js';
import PropStatus from '../../prop/PropStatus.js';

export default class ModelReferenceNode extends BaseNode {
    blockPath: string;
    resolved: boolean;

    constructor(name: string, parent: BaseNode | null, blockPath: string) {
        super(name, parent);
        this.blockPath = blockPath;
        this.resolved = false;
    }

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
    get id(): string {
        const key = this.name + '@' + this.blockPath;
        return this.parent ? this.parent.id + '/' + key : key;
    }

    get isEntry(): boolean {
        return true;
    }

    get icon(): string {
        return 'modelReference';
    }

    get displayName(): string {
        return this.name;
    }

    get displayValue(): string {
        return this.blockPath;
    }

    get className(): string {
        return 'Model Reference';
    }

    get nameEditable(): boolean {
        return false;
    }

    get valueEditable(): boolean {
        return false;
    }

    // Super without the pool, shared after the rewrite — see DataSourceNode.toRow.
    toRow(pool?: RowCellPool): RowData | null {
        const row = super.toRow();
        if (row) {
            row.Value = { text: row.Value as string, linkTarget: this.name };
        }
        return row && pool ? pool.share(row) : row;
    }

    getProperties(): PropClass[] {
        return [PropName, PropBlockPath, PropStatus];
    }

    getPILayout(): PIGroupDef[] {
        return [
            { group: 'General', items: [PropName, PropBlockPath, PropStatus] }
        ];
    }
}
