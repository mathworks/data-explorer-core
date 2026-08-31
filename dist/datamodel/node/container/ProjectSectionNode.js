// Copyright 2026 The MathWorks, Inc.
import ContainerNode from '../ContainerNode.js';
import ProjectItemNode from '../data/ProjectItemNode.js';
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
        const name = folder.split(/[/\\]/).filter((p) => p.length > 0).pop() || folder;
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