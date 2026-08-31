import BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
export interface ProjectItemOpts {
    itemType: string;
    location: string;
    labels?: string[];
    icon?: string;
}
export default class ProjectItemNode extends BaseNode {
    projectItemType: string;
    location: string;
    labels: string[];
    _icon?: string;
    constructor(name: string, parent: BaseNode | null, opts: ProjectItemOpts);
    get isEntry(): boolean;
    get icon(): string;
    get displayName(): string;
    get displayValue(): string;
    get className(): string;
    get nameEditable(): boolean;
    get valueEditable(): boolean;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[];
}
//# sourceMappingURL=ProjectItemNode.d.ts.map