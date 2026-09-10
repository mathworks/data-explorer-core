// Copyright 2026 The MathWorks, Inc.
import BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropPath from '../../prop/PropPath.js';
import PropStatus from '../../prop/PropStatus.js';
import { isModelFile, isSlddFile } from '../../fileKinds.js';
export default class DataSourceNode extends BaseNode {
    constructor(name, parent, fullPath) {
        super(name, parent);
        this.fullPath = fullPath;
        this.resolved = false;
    }
    get isEntry() {
        return true;
    }
    /**
     * The one classification behind BOTH the icon and the class name.
     *
     * These were two independent chains of `endsWith`, which is two answers to one
     * question: a kind added to one and not the other shows a dictionary icon on a row
     * labelled 'MAT File'. They were also both case-SENSITIVE, while `refBasename` —
     * which is what actually RESOLVES this source against the workspace — is not. So a
     * model naming `Params.SLDD`, exactly as its author typed it, got a working link and a
     * MAT-file presentation, and no part of that looks like a bug from either side.
     * Deriving from `fileKinds` puts the case rule where the rest of this package keeps it.
     */
    get presentation() {
        if (isSlddFile(this.name)) {
            return { icon: 'simulinkDataDictionary_FT', className: 'Data Dictionary' };
        }
        // A `.mdl` is a Simulink model too — the same thing in an older container —
        // so it gets the model icon rather than falling through to the MAT default.
        if (isModelFile(this.name)) {
            return { icon: 'simulinkModel_FT', className: 'Simulink Model' };
        }
        // A model's external data sources are dictionaries, models and MAT-files, so an
        // extension none of those tests recognise is presented as the last of them rather
        // than as nothing at all.
        return { icon: 'matlabWorkspaceFile', className: 'MAT File' };
    }
    get icon() {
        return this.presentation.icon;
    }
    get displayName() {
        return this.name;
    }
    get displayValue() {
        return this.fullPath;
    }
    get className() {
        return this.presentation.className;
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