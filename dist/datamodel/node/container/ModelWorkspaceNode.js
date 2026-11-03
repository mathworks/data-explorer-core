// Copyright 2026 The MathWorks, Inc.
import MatNode from './MatNode.js';
import ContainerNode from '../ContainerNode.js';
import { parseMat } from '../../parser/MatParser.js';
import { matOfWorkspaceStream } from '../../parser/ModelWorkspaceStream.js';
import { basenameOf } from '../../fileKinds.js';
import { EMPTY_WORKSPACE, WORKSPACE_MAT_PART, WORKSPACE_STREAM_PART, handedAway, packageRefusal } from '../../parser/ModelPackage.js';
export { WORKSPACE_MAT_PART, WORKSPACE_STREAM_PART };
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
    constructor() {
        super('workspace');
        this.label = 'Model Workspace';
        this.iconId = 'databaseFolderWorkspace';
        // The part the workspace was read from, or null where the model held none; and of a stream
        // (R2019b+), what was read of it to convert back (ModelWorkspaceStream.workspaceStreamOfMat).
        this._part = null;
        this._streamRead = null;
        // Why no edit of it would be kept, whatever the MAT-file's rules say, as a sentence; or null.
        this._modelRefusal = null;
    }
    get icon() {
        return this.iconId;
    }
    get displayName() {
        return this.label;
    }
    get tableColumnConfig() {
        return { columns: ['Name', 'Value', 'DataType', 'UsedBy'] };
    }
    // A section's, not a MAT-file's: it is a part of the model, which says what it is.
    getProperties() {
        return ContainerNode.prototype.getProperties.call(this);
    }
    getPILayout() {
        return ContainerNode.prototype.getPILayout.call(this);
    }
    get _noun() {
        return 'model workspace';
    }
    // A model workspace does not report a value it did not decode (the C-232 ruling), as the
    // section it replaces did not.
    get _warnsUndecoded() {
        return false;
    }
    /** The model's file, which a save of the workspace is a save of. */
    get _saveLabel() {
        return this._modelName;
    }
    get _namespaceLabel() {
        return this._modelName;
    }
    get _modelName() {
        const model = this.parent;
        return model ? basenameOf(model.name) || model.name : this.name;
    }
    // Of the workspace (its source), then of the model's package (a save of which the workspace's is
    // part of), then of the MAT-file it is edited as. A package's verdict is found once, and asked
    // again only of a part handed away since, as a MAT-file's is (MatNode._fileRefusal).
    _fileRefusal() {
        if (this._modelRefusal) {
            return this._modelRefusal;
        }
        const model = this.parent;
        if (model && (this._packageVerdict === undefined || (this._packageVerdict === null && this._partHandedAway(model)))) {
            const why = packageRefusal(model);
            this._packageVerdict = why ? 'Cannot edit "' + this._modelName + '": ' + why + '.' : null;
        }
        return this._packageVerdict ?? super._fileRefusal();
    }
    _partHandedAway(model) {
        const part = this._part ? model._zipEntries?.[this._part] : undefined;
        return part !== undefined && handedAway(part);
    }
    /**
     * The Model Workspace of `parsed`, a `.slx`'s parse, as a MAT-file's editor, or null where its part
     * is not one this converts into a MAT-file exactly, or the parse holds no parts at all (a host's
     * parse without them, a `.mdl`): the model then shows it as before, a section of what was read,
     * which takes no edit. `warnings` gets what building it found that the model reports: the
     * objects the decoder could not read, as the section did. What the MAT-file's own reader says of
     * a part the model's reader already read is not said twice.
     */
    static ofModel(parsed, filename, warnings) {
        const entries = parsed.zipEntries;
        if (!entries) {
            return null;
        }
        const stream = own(entries, WORKSPACE_STREAM_PART);
        const legacy = own(entries, WORKSPACE_MAT_PART);
        let mat;
        let read = null;
        let part = null;
        try {
            if (stream) {
                if (stream[0] === 0x7b) {
                    // A text package `.mdl`'s workspace, which is JSON, under the stream's name.
                    return null;
                }
                const made = matOfWorkspaceStream(stream);
                if (!made.ok) {
                    return null;
                }
                mat = parseMat(bufferOf(made.mat));
                read = made.read;
                part = WORKSPACE_STREAM_PART;
            }
            else if (legacy) {
                mat = parseMat(bufferOf(legacy));
                part = WORKSPACE_MAT_PART;
            }
            else {
                const made = matOfWorkspaceStream(EMPTY_WORKSPACE);
                if (!made.ok) {
                    return null;
                }
                mat = parseMat(bufferOf(made.mat));
                read = made.read;
            }
        }
        catch {
            return null;
        }
        // What building the tree finds goes to the model's list; what the MAT-file's own reader found
        // of the part stays out of it, as the model's reader reported the part itself.
        const node = MatNode._populate(new ModelWorkspaceNode(), { ...mat, warnings: warnings ?? [] }, { nodeCeiling: Infinity });
        node._part = part;
        node._streamRead = read;
        node._modelRefusal = sourceRefusal(basenameOf(filename) || filename, parsed);
        return node;
    }
}
// Why no edit of a workspace the model makes anew from another source as it opens would be kept, as
// MatNode._fileRefusal says one; or null for a workspace the model keeps.
function sourceRefusal(model, parsed) {
    const source = parsed.workspaceSource ?? 'Model File';
    if (source === 'Model File') {
        return null;
    }
    const from = source === 'MAT-File'
        ? 'is loaded from the MAT-file ' + (parsed.workspaceDataSource ? '"' + parsed.workspaceDataSource + '" ' : '') + 'each time the model opens'
        : source === 'MATLAB File'
            ? 'is made by running a MATLAB file each time the model opens'
            : source === 'MATLAB Code'
                ? 'is made by running MATLAB code kept in the model each time the model opens'
                : 'is made from its data source, ' + source + ', each time the model opens';
    return 'Cannot edit "' + model + '": its Model Workspace ' + from + ', so an edit of it here would not be kept.';
}
function own(entries, name) {
    return Object.prototype.hasOwnProperty.call(entries, name) ? entries[name] : null;
}
function bufferOf(bytes) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
//# sourceMappingURL=ModelWorkspaceNode.js.map