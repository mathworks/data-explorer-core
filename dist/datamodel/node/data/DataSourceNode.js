// Copyright 2026 The MathWorks, Inc.
import BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropPath from '../../prop/PropPath.js';
import PropStatus from '../../prop/PropStatus.js';
export default class DataSourceNode extends BaseNode {
    constructor(name, parent, fullPath) {
        super(name, parent);
        this.fullPath = fullPath;
        this.resolved = false;
    }
    get isEntry() {
        return true;
    }
    get icon() {
        if (this.name.endsWith('.sldd')) {
            return 'simulinkDataDictionary_FT';
        }
        if (this.name.endsWith('.slx')) {
            return 'simulinkModel_FT';
        }
        return 'matlabWorkspaceFile';
    }
    get displayName() {
        return this.name;
    }
    get displayValue() {
        return this.fullPath;
    }
    get className() {
        if (this.name.endsWith('.sldd')) {
            return 'Data Dictionary';
        }
        if (this.name.endsWith('.slx')) {
            return 'Simulink Model';
        }
        return 'MAT File';
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
        return [PropName, PropPath, PropStatus];
    }
    getPILayout() {
        return [
            { group: 'General', items: [PropName, PropPath, PropStatus] }
        ];
    }
}
//# sourceMappingURL=DataSourceNode.js.map