import MatNode from './MatNode.js';
import type { TableColumnConfig } from '../ContainerNode.js';
import type { PIGroupDef, PropClass } from '../BaseNode.js';
import { type WorkspaceStreamRead } from '../../parser/ModelWorkspaceStream.js';
import type { ParseWarning } from '../../parser/ParseWarning.js';
/** Where a `.slx` keeps its model workspace from R2019b: MATLAB's getByteStreamFromArray of a struct of the variables. */
export declare const WORKSPACE_STREAM_PART = "simulink/modelWorkspace.mxarray";
/** Where a `.slx` kept it before R2019b: a whole MAT-file. */
export declare const WORKSPACE_MAT_PART = "simulink/modelworkspace.mat";
/** What a model is read as for its workspace: ModelNode.fromParsed's parse, as wide as that one is. */
export interface WorkspaceOfModel {
    zipEntries: Record<string, Uint8Array> | null;
    workspaceSource?: string;
    workspaceDataSource?: string | null;
}
/**
 * A model's Model Workspace, as a `.slx` keeps it: a MAT-file's editor over the MAT-file the
 * workspace part converts into (ModelWorkspaceStream), under the model, so that every rule of a
 * MAT-file's editor applies to it (BaseNode.sourceEditRefusal asks the first container above an
 * entry, which is this) and what a save of it writes converts back into the part. It shows as the
 * section it replaces did: its label, its icon, its columns and its key, `workspace`, which every
 * id of a variable in it starts with.
 *
 * It takes no edit where a save of the model would not keep one (_modelRefusal): a workspace the
 * model makes anew from another source each time it opens (WSDataSource), which holds no part.
 */
export default class ModelWorkspaceNode extends MatNode {
    label: string;
    iconId: string;
    _part: string | null;
    _streamRead: WorkspaceStreamRead | null;
    _modelRefusal: string | null;
    constructor();
    get icon(): string;
    get displayName(): string;
    get tableColumnConfig(): TableColumnConfig;
    getProperties(): PropClass[];
    getPILayout(): PIGroupDef[] | null;
    get _noun(): string;
    get _warnsUndecoded(): boolean;
    /** The model's file, which a save of the workspace is a save of. */
    get _saveLabel(): string;
    get _namespaceLabel(): string;
    get _modelName(): string;
    _fileRefusal(): string | null;
    /**
     * The Model Workspace of `parsed`, a `.slx`'s parse, as a MAT-file's editor, or null where its part
     * is not one this converts into a MAT-file exactly, or the parse holds no parts at all (a host's
     * parse without them, a `.mdl`): the model then shows it as before, a section of what was read,
     * which takes no edit. `warnings` gets what building it found that the model reports: the
     * objects the decoder could not read, as the section did. What the MAT-file's own reader says of
     * a part the model's reader already read is not said twice.
     */
    static ofModel(parsed: WorkspaceOfModel, filename: string, warnings: ParseWarning[] | undefined): ModelWorkspaceNode | null;
}
//# sourceMappingURL=ModelWorkspaceNode.d.ts.map