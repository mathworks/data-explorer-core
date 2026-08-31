// Copyright 2026 The MathWorks, Inc.
import BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropBlockPath from '../../prop/PropBlockPath.js';
import PropStatus from '../../prop/PropStatus.js';
export default class ModelReferenceNode extends BaseNode {
    constructor(name, parent, blockPath) {
        super(name, parent);
        this.blockPath = blockPath;
        this.resolved = false;
    }
    get isEntry() {
        return true;
    }
    get icon() {
        return 'modelReference';
    }
    get displayName() {
        return this.name;
    }
    get displayValue() {
        return this.blockPath;
    }
    get className() {
        return 'Model Reference';
    }
    get nameEditable() {
        return false;
    }
    get valueEditable() {
        return false;
    }
    toRow() {
        const row = super.toRow();
        if (row) {
            row.Value = { text: row.Value, linkTarget: this.name };
        }
        return row;
    }
    getProperties() {
        return [PropName, PropBlockPath, PropStatus];
    }
    getPILayout() {
        return [
            { group: 'General', items: [PropName, PropBlockPath, PropStatus] }
        ];
    }
}
//# sourceMappingURL=ModelReferenceNode.js.map