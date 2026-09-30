// Copyright 2026 The MathWorks, Inc.
import ContainerNode from '../ContainerNode.js';
import ProjectItemNode from '../data/ProjectItemNode.js';
/** What to call the project root in a list of path folders. See addPathEntry. */
const ROOT_FOLDER_NAME = '(project root)';
export default class ProjectSectionNode extends ContainerNode {
    constructor(name, parent, label, iconId) {
        super(name, parent);
        this.label = label;
        this.iconId = iconId;
    }
    get icon() {
        return this.iconId;
    }
    get displayName() {
        return this.label;
    }
    get tableColumnConfig() {
        return { columns: ['Name', 'Type', 'Location', 'Labels'] };
    }
    addFileEntry(file) {
        const name = file.path.split(/[/\\]/).pop() || file.path;
        const node = new ProjectItemNode(name, this, {
            itemType: file.isFolder ? 'Folder' : 'File',
            location: file.path,
            labels: file.labels,
        });
        this.addChild(node);
        return node;
    }
    addPathEntry(folder) {
        // The project ROOT is on the path, and the store spells it as the EMPTY
        // string — so unlike every other entry it has no segment to be named by, and
        // the usual "show the path itself" fallback leaves a blank row. It is
        // normally the first folder MATLAB adds, so this is the common first row and
        // not an edge case. Only '' is the root: a degenerate path like '/' is still
        // shown verbatim, since that one at least says something.
        const name = folder === ''
            ? ROOT_FOLDER_NAME
            : folder.split(/[/\\]/).filter((p) => p.length > 0).pop() || folder;
        const node = new ProjectItemNode(name, this, {
            itemType: 'Path Folder',
            location: folder,
        });
        this.addChild(node);
        return node;
    }
    addLabelEntry(label) {
        const node = new ProjectItemNode(label.name, this, {
            itemType: 'Label',
            location: label.category,
        });
        this.addChild(node);
        return node;
    }
    addReferenceEntry(ref) {
        const node = new ProjectItemNode(ref.name ?? ref.id, this, {
            itemType: 'Reference',
            location: ref.id,
        });
        this.addChild(node);
        return node;
    }
}
//# sourceMappingURL=ProjectSectionNode.js.map