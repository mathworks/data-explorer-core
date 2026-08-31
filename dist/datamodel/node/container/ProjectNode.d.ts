import ContainerNode from '../ContainerNode.js';
import type { TableColumnConfig } from '../ContainerNode.js';
import ProjectSectionNode from './ProjectSectionNode.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
import type { ParsedProject } from '../../parser/ProjectParser.js';
export default class ProjectNode extends ContainerNode {
    constructor(name: string);
    get tableColumnConfig(): TableColumnConfig;
    get displayName(): string;
    get readOnly(): boolean;
    get icon(): string;
    get NumberOfEntries(): number;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[];
    getSection(key: string): ProjectSectionNode | null;
    static fromParsed(parsed: ParsedProject, filename: string): ProjectNode;
}
//# sourceMappingURL=ProjectNode.d.ts.map