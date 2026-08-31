import ContainerNode from '../ContainerNode.js';
import type { TableColumnConfig } from '../ContainerNode.js';
import type BaseNode from '../BaseNode.js';
import type { ProjectFile, ProjectLabel, ProjectReference } from '../../parser/ProjectParser.js';
export default class ProjectSectionNode extends ContainerNode {
    label: string;
    iconId: string;
    constructor(name: string, parent: BaseNode | null, label: string, iconId: string);
    get icon(): string;
    get displayName(): string;
    get tableColumnConfig(): TableColumnConfig;
    addFileEntry(file: ProjectFile): BaseNode;
    addPathEntry(folder: string): BaseNode;
    addLabelEntry(label: ProjectLabel): BaseNode;
    addReferenceEntry(ref: ProjectReference): BaseNode;
}
//# sourceMappingURL=ProjectSectionNode.d.ts.map