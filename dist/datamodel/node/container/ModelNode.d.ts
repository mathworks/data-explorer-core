import ContainerNode from '../ContainerNode.js';
import type { TableColumnConfig } from '../ContainerNode.js';
import ModelSectionNode from './ModelSectionNode.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
import type { MatVariable } from '../data/MatlabVariableNode.js';
import type { BlockParamUsage, ParsedConfigSet } from '../../parser/SlxParser.js';
import type { ParseWarning } from '../../parser/ParseWarning.js';
export interface ParsedSlx {
    name: string;
    release: string;
    creator: string;
    lastModified: string;
    uuid: string;
    dataDictionary: string | null;
    modelReferences: {
        blockPath: string;
        modelName: string;
    }[];
    externalDataSources: string[];
    configSets: ParsedConfigSet[];
    workspace: MatVariable[];
    blockParamUsages?: BlockParamUsage[];
    rawContents: Record<string, string> | null;
    zipEntries: Record<string, Uint8Array> | null;
    warnings?: ParseWarning[];
}
export default class ModelNode extends ContainerNode {
    release: string;
    creator: string;
    lastModified: string;
    uuid: string;
    dataDictionary: string | null;
    rawContents: Record<string, string> | null;
    dirty: boolean;
    blockParamUsages: BlockParamUsage[];
    _zipEntries: Record<string, Uint8Array> | null;
    _workspaceVars: MatVariable[] | null;
    constructor(name: string);
    get tableColumnConfig(): TableColumnConfig;
    get displayName(): string;
    get readOnly(): boolean;
    get sourceFormat(): string;
    get icon(): string;
    get Release(): string;
    get NumberOfEntries(): number;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[];
    getSection(key: string): ModelSectionNode | null;
    serialize(): unknown;
    static fromParsed(parsed: ParsedSlx, filename: string): ModelNode;
}
//# sourceMappingURL=ModelNode.d.ts.map