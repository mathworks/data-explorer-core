// Copyright 2026 The MathWorks, Inc.
import ContainerNode from '../ContainerNode.js';
import ProjectSectionNode from './ProjectSectionNode.js';
import PropName from '../../prop/PropName.js';
const SECTION_DEFS = [
    { key: 'files', label: 'Project Files', icon: 'databaseFolder' },
    { key: 'path', label: 'Project Path', icon: 'link_database' },
    { key: 'labels', label: 'Labels', icon: 'databaseFolder' },
    { key: 'references', label: 'References', icon: 'modelReference' },
];
export default class ProjectNode extends ContainerNode {
    constructor(name) {
        super(name, null);
        SECTION_DEFS.forEach((def) => {
            this.addChild(new ProjectSectionNode(def.key, this, def.label, def.icon));
        });
    }
    get tableColumnConfig() {
        return { columns: ['Name', 'Type', 'Location', 'Labels'] };
    }
    get displayName() {
        return this.name;
    }
    get readOnly() {
        return true;
    }
    // The format an out-of-process host is told this source is, since SourceDTO
    // carries this field and nothing else in the projection names the format. It is
    // the format rather than the encoding on purpose: SlddNode's `sourceFormat` is
    // 'json' or 'xml' because a .sldd really comes in two encodings and it keys its
    // own icon and FileFormat off which, whereas a .prj comes in exactly one — a zip
    // of XML documents — so 'xml' would say nothing here while handing a project the
    // token a dictionary uses for a different meaning. Anything later switching on
    // this field (a serializer choosing a writer, say) must not mistake a project for
    // an XML-flavoured dictionary. A getter, not a field: unlike a .sldd's, this
    // cannot change once the file is read.
    get sourceFormat() {
        return 'prj';
    }
    get icon() {
        // A dedicated project icon ships in media/icons/simulink_project.svg.
        return 'simulink_project';
    }
    get NumberOfEntries() {
        let count = 0;
        this.children.forEach((section) => {
            count += section.children.length;
        });
        return count;
    }
    getProperties() {
        return [PropName];
    }
    getPILayout() {
        return [{ group: 'General', items: [PropName] }];
    }
    getSection(key) {
        return this.children.find((c) => c.name === key) || null;
    }
    static fromParsed(parsed, filename) {
        const node = new ProjectNode(filename);
        // Resolve per-file label ids (e.g. a GUID) to their display names via the
        // label catalog, so the table shows "Reviewed" rather than the raw UUID.
        const labelName = new Map();
        for (const label of parsed.labels) {
            if (label.id) {
                labelName.set(label.id, label.name);
            }
        }
        const filesSection = node.getSection('files');
        for (const file of parsed.files) {
            const resolved = {
                ...file,
                labels: file.labels.map((id) => labelName.get(id) ?? id),
            };
            filesSection.addFileEntry(resolved);
        }
        const pathSection = node.getSection('path');
        for (const folder of parsed.pathFolders) {
            pathSection.addPathEntry(folder);
        }
        const labelsSection = node.getSection('labels');
        for (const label of parsed.labels) {
            labelsSection.addLabelEntry(label);
        }
        const refsSection = node.getSection('references');
        for (const ref of parsed.references) {
            refsSection.addReferenceEntry(ref);
        }
        return node;
    }
}
//# sourceMappingURL=ProjectNode.js.map