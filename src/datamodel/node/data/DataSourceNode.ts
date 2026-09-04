// Copyright 2026 The MathWorks, Inc.

import BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef, RowData } from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropPath from '../../prop/PropPath.js';
import PropStatus from '../../prop/PropStatus.js';

export default class DataSourceNode extends BaseNode {
    fullPath: string;
    resolved: boolean;

    constructor(name: string, parent: BaseNode | null, fullPath: string) {
        super(name, parent);
        this.fullPath = fullPath;
        this.resolved = false;
    }

    get isEntry(): boolean {
        return true;
    }

    get icon(): string {
        if (this.name.endsWith('.sldd')) { return 'simulinkDataDictionary_FT'; }
        // A `.mdl` is a Simulink model too — the same thing in an older container —
        // so it gets the model icon rather than falling through to the MAT default.
        if (this.name.endsWith('.slx') || this.name.endsWith('.mdl')) { return 'simulinkModel_FT'; }
        return 'matlabWorkspaceFile';
    }

    get displayName(): string {
        return this.name;
    }

    get displayValue(): string {
        return this.fullPath;
    }

    get className(): string {
        if (this.name.endsWith('.sldd')) { return 'Data Dictionary'; }
        if (this.name.endsWith('.slx') || this.name.endsWith('.mdl')) { return 'Simulink Model'; }
        return 'MAT File';
    }

    get nameEditable(): boolean {
        return false;
    }

    get valueEditable(): boolean {
        return false;
    }

    toRow(): RowData | null {
        const row = super.toRow();
        if (row) {
            row.Value = { text: row.Value as string, linkTarget: this.name };
        }
        return row;
    }

    getProperties(): PropClass[] {
        return [PropName, PropPath, PropStatus];
    }

    getPILayout(): PIGroupDef[] {
        return [
            { group: 'General', items: [PropName, PropPath, PropStatus] }
        ];
    }
}
