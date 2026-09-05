import ContainerNode from '../ContainerNode.js';
import type { TableColumnConfig } from '../ContainerNode.js';
import type { MatVariable } from '../data/MatlabVariableNode.js';
import type BaseNode from '../BaseNode.js';
import type { ParsedConfigSet } from '../../parser/SlxParser.js';
export default class ModelSectionNode extends ContainerNode {
    label: string;
    iconId: string;
    constructor(name: string, parent: BaseNode | null, label: string, iconId: string);
    get icon(): string;
    get displayName(): string;
    get tableColumnConfig(): TableColumnConfig;
    addWorkspaceEntry(entry: MatVariable): BaseNode;
    addConfigSetEntry(cfg: ParsedConfigSet): BaseNode;
    addReferenceEntry(ref: {
        blockPath: string;
        modelName: string;
    }, defaultExt?: string): BaseNode;
    addBlockEntry(blockName: string, blockType: string, paramUsages: Array<{
        property: string;
        value: string;
    }>, modelSrcId: string, paramSourceId: string | null): BaseNode;
    addDataSourceEntry(path: string): BaseNode;
}
//# sourceMappingURL=ModelSectionNode.d.ts.map