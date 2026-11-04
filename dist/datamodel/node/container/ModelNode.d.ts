import ContainerNode from '../ContainerNode.js';
import type { TableColumnConfig } from '../ContainerNode.js';
import ModelSectionNode from './ModelSectionNode.js';
import ModelWorkspaceNode from './ModelWorkspaceNode.js';
import ConfigSetNode from '../data/ConfigSetNode.js';
import ConfigSetRefNode from '../data/ConfigSetRefNode.js';
import { type SetState, type SetToWrite } from '../../parser/ConfigSetsWriter.js';
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
    workspaceSource?: string;
    modelArguments?: string[];
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
    /** Where the model workspace's variables come from: 'Model File', or 'MAT-File', 'MATLAB File', 'MATLAB Code'. See SlxParser's ParsedSlx.workspaceSource. */
    workspaceSource: string;
    /** The model's arguments, names of its workspace variables (ParameterArgumentNames). */
    modelArguments: string[];
    rawContents: Record<string, string> | null;
    _ownDirty: boolean;
    blockParamUsages: BlockParamUsage[];
    /**
     * The mask workspaces of this model's masked subsystems, which findUsages needs to
     * resolve a block parameter the way MATLAB does — a name a mask defines belongs to the
     * mask and not to the model workspace. See maskScope.
     */
    masks: MaskScope[];
    _zipEntries: Record<string, Uint8Array> | null;
    /** The configuration set the package marked active as it was read, by name, or null. */
    _activeAsRead: string | null;
    /** The configuration sets as read, in the package's order: what a save of the sets edits. */
    _configAsRead: (SetState & {
        active: boolean;
    })[];
    _configVerdict?: string | null;
    constructor(name: string);
    get tableColumnConfig(): TableColumnConfig;
    /**
     * Whether the model has unsaved changes: its own, or its Model Workspace's, which marks itself
     * dirty as a MAT-file does (MatNode's execAddEntry, execRemoveEntry and retype, and a paste's put
     * back). Set false (a save, a revert), both are clean.
     */
    get dirty(): boolean;
    set dirty(value: boolean);
    /**
     * Why the last addEntry into this model added nothing, as its Model Workspace says (the session's
     * addEntryRefusal of the active source), or null.
     */
    addEntryRefusal(): string | null;
    get displayName(): string;
    /** The configuration set active now, or null where none is (a `.mdl`, which marks none). */
    get activeConfigSet(): ConfigSetNode | ConfigSetRefNode | null;
    /**
     * Why `set` is not made the model's active configuration set, as a clause, or null where it is:
     * it is no set of this model, it is the active one already, no save of the model can be written
     * (ModelPackage.packageRefusal), or the mark its package keeps of the active set cannot be moved
     * (ActiveConfigMark). A reference is made active as a set is, with a warning (activeSetCaution).
     */
    activeSetRefusal(set: unknown): string | null;
    /**
     * Why the model's configuration sets take no edit, as a clause, or null where they do: no save of
     * the model can be written (ModelPackage.packageRefusal, a `.mdl` among them), or its package is
     * not laid out as MATLAB writes it (ConfigSetsWriter, asked of the sets as read, of one more added
     * and of the last one deleted: the edits that touch the most of the package).
     */
    configEditRefusal(): string | null;
    /** The sets a save writes, where they are not the sets as read (each as it now is), or null. */
    get _configSetsToWrite(): SetToWrite[] | null;
    /**
     * `entries`, the package's members, with the configuration sets as they now are written into them
     * (ConfigSetsWriter): changed in place and answered. Throws ConfigSetsError, saying why.
     */
    _configEdited(entries: Record<string, Uint8Array>): Record<string, Uint8Array>;
    /**
     * What making `set` active cannot check, where it is made active and is a reference, as a
     * sentence, or null: MATLAB uses a reference only once it finds the set it refers to, in the
     * model's data dictionary or, with none, the base workspace (probe_active_config_set.m), which
     * this editor cannot look in without MATLAB.
     */
    activeSetCaution(set: unknown): string | null;
    /** Make `set` the active configuration set, and answer the one that was, which no longer is. */
    _makeActive(set: ConfigSetNode | ConfigSetRefNode): ConfigSetNode | ConfigSetRefNode | null;
    /** The name of the set a save marks active, where it is not the one marked as read, or null. */
    get _activeSetToWrite(): string | null;
    get readOnly(): boolean;
    get sourceFormat(): string;
    get icon(): string;
    get Release(): string;
    get NumberOfEntries(): number;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[];
    getSection(key: 'workspace'): ModelSectionNode | ModelWorkspaceNode | null;
    getSection(key: string): ModelSectionNode | null;
    serialize(): unknown;
    static fromParsed(parsed: ParsedSlx, filename: string): ModelNode;
    static _addWorkspaceSection(node: ModelNode, parsed: ParsedSlx): void;
}
//# sourceMappingURL=ModelNode.d.ts.map