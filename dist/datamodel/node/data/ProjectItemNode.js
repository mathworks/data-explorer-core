// Copyright 2026 The MathWorks, Inc.
import BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropType from '../../prop/PropType.js';
import PropLocation from '../../prop/PropLocation.js';
import PropLabels from '../../prop/PropLabels.js';
export default class ProjectItemNode extends BaseNode {
    constructor(name, parent, opts) {
        super(name, parent);
        this.projectItemType = opts.itemType;
        this.location = opts.location;
        this.labels = opts.labels || [];
    }
    get isEntry() {
        return true;
    }
    // The icon follows from the item TYPE alone (and, for a file, its extension) —
    // ProjectSectionNode is the only thing that builds these nodes and it sets no
    // icon per item, so there is deliberately no per-node override to consult.
    get icon() {
        const type = this.projectItemType;
        if (type === 'Folder') {
            return 'databaseFolder';
        }
        if (type === 'Path Folder') {
            return 'link_database';
        }
        if (type === 'Label') {
            return 'wsDefault';
        }
        if (type === 'Reference') {
            return 'modelReference';
        }
        // File: pick by extension.
        const lower = this.name.toLowerCase();
        if (lower.endsWith('.slx') || lower.endsWith('.mdl')) {
            return 'simulinkModel_FT';
        }
        if (lower.endsWith('.sldd')) {
            return 'simulinkDataDictionary_FT';
        }
        if (lower.endsWith('.mat')) {
            return 'matlabWorkspaceFile';
        }
        return 'wsDefault';
    }
    get displayName() {
        return this.name;
    }
    get displayValue() {
        return this.location;
    }
    get className() {
        return this.projectItemType;
    }
    get nameEditable() {
        return false;
    }
    get valueEditable() {
        return false;
    }
    getProperties() {
        return [PropName, PropType, PropLocation, PropLabels];
    }
    getPILayout() {
        return [
            { group: 'General', items: [PropName, PropType, PropLocation, PropLabels] },
        ];
    }
}
//# sourceMappingURL=ProjectItemNode.js.map