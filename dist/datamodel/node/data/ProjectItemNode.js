// Copyright 2026 The MathWorks, Inc.
import BaseNode from '../BaseNode.js';
import PropName from '../../prop/PropName.js';
import PropType from '../../prop/PropType.js';
import PropLocation from '../../prop/PropLocation.js';
import PropLabels from '../../prop/PropLabels.js';
import { isMatFile, isModelFile, isSlddFile } from '../../fileKinds.js';
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
        // File: pick by extension, through the module that owns the case rule. The
        // fallback differs from DataSourceNode's on purpose — a project's members are
        // arbitrary files (`.m`, `.txt`, an image), so an unrecognised one is generic here,
        // where a model's external data sources can only be the three kinds above.
        if (isModelFile(this.name)) {
            return 'simulinkModel_FT';
        }
        if (isSlddFile(this.name)) {
            return 'simulinkDataDictionary_FT';
        }
        if (isMatFile(this.name)) {
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