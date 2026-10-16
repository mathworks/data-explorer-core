import ContainerNode from '../ContainerNode.js';
import type { TableColumnConfig } from '../ContainerNode.js';
import ModelSectionNode from './ModelSectionNode.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
import type { MatVariable } from '../data/MatlabVariableNode.js';
import type { BlockParamUsage, ParsedConfigSet } from '../../parser/SlxParser.js';
import type { ParseWarning } from '../../parser/ParseWarning.js';
import type { MaskScope } from '../../maskScope.js';
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
    workspaceDataSource?: string | null;
    configSets: ParsedConfigSet[];
    workspace: MatVariable[];
    blockParamUsages?: BlockParamUsage[];
    masks?: MaskScope[];
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
    /**
     * The MAT file this model's workspace is kept in, as the model recorded it, or null.
     * It is also a child of the dataSources section, with the externals. It is kept here
     * as well because the session's usage engine resolves a name in it right after the
     * model's own workspace and ahead of the dictionaries, and in that section it is one
     * `.mat` among the others. See SlxParser's ParsedSlx.workspaceDataSource.
     */
    workspaceDataSource: string | null;
    rawContents: Record<string, string> | null;
    dirty: boolean;
    blockParamUsages: BlockParamUsage[];
    /**
     * The mask workspaces of this model's masked subsystems, which findUsages needs to
     * resolve a block parameter the way MATLAB does — a name a mask defines belongs to the
     * mask and not to the model workspace. See maskScope.
     */
    masks: MaskScope[];
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