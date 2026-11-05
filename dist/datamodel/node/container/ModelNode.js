// Copyright 2026 The MathWorks, Inc.
import ContainerNode from '../ContainerNode.js';
import ModelSectionNode from './ModelSectionNode.js';
import ModelWorkspaceNode from './ModelWorkspaceNode.js';
import ConfigSetNode from '../data/ConfigSetNode.js';
import ConfigSetRefNode from '../data/ConfigSetRefNode.js';
import { ActiveMarkError, withActiveSet } from '../../parser/ActiveConfigMark.js';
import { ConfigSetsError, withConfigSets } from '../../parser/ConfigSetsWriter.js';
import { packageRefusal } from '../../parser/ModelPackage.js';
import { attachMcosDecoded, modelOpaqueMcosVariable } from '../data/mcosTypedNode.js';
import { mcosDecodedFor } from '../data/mcosDecodedTable.js';
import PropName from '../../prop/PropName.js';
import PropRelease from '../../prop/PropRelease.js';
import { blockKey } from '../../blockIdentity.js';
import { extOf, refModelExt } from '../../fileKinds.js';
const SECTION_DEFS = [
    { key: 'blocks', label: 'Model Elements', icon: 'blocks' },
    { key: 'workspace', label: 'Model Workspace', icon: 'databaseFolderWorkspace' },
    { key: 'config', label: 'Configurations', icon: 'databaseFolderConfiguration' },
    { key: 'references', label: 'Model References', icon: 'modelReference' },
    { key: 'dataSources', label: 'External Data', icon: 'link_database' },
];
function sameNames(a, b) {
    return a.length === b.length && a.every((n, i) => n === b[i]);
}
export default class ModelNode extends ContainerNode {
    constructor(name) {
        super(name, null);
        this.release = '';
        this.creator = '';
        this.lastModified = '';
        this.uuid = '';
        this.dataDictionary = null;
        this.workspaceDataSource = null;
        this.workspaceSource = 'Model File';
        this.modelArguments = [];
        this.rawContents = null;
        this._ownDirty = false;
        this.blockParamUsages = [];
        this.masks = [];
        this._zipEntries = null;
        this._activeAsRead = null;
        this._configAsRead = [];
        SECTION_DEFS.forEach((def) => {
            this.addChild(new ModelSectionNode(def.key, this, def.label, def.icon));
        });
    }
    get tableColumnConfig() {
        return { columns: ['Name', 'Value', 'DataType', 'UsedBy'], labels: { DataType: 'Type', UsedBy: 'Usage' } };
    }
    /**
     * Whether the model has unsaved changes: its own, or its Model Workspace's, which marks itself
     * dirty as a MAT-file does (MatNode's execAddEntry, execRemoveEntry and retype, and a paste's put
     * back). Set false (a save, a revert), both are clean.
     */
    get dirty() {
        const workspace = this.getSection('workspace');
        return this._ownDirty || (workspace instanceof ModelWorkspaceNode && workspace.dirty);
    }
    set dirty(value) {
        this._ownDirty = value;
        const workspace = this.getSection('workspace');
        if (!value && workspace instanceof ModelWorkspaceNode) {
            workspace.dirty = false;
        }
    }
    /**
     * Why the last addEntry into this model added nothing, as its Model Workspace says (the session's
     * addEntryRefusal of the active source), or null.
     */
    addEntryRefusal() {
        const workspace = this.getSection('workspace');
        return workspace instanceof ModelWorkspaceNode ? workspace.addEntryRefusal() : null;
    }
    get displayName() {
        return this.name;
    }
    /** The configuration set active now, or null where none is (a `.mdl`, which marks none). */
    get activeConfigSet() {
        const sets = (this.getSection('config')?.children ?? []);
        return sets.find((c) => c.active) ?? null;
    }
    /**
     * Why `set` is not made the model's active configuration set, as a clause, or null where it is:
     * it is no set of this model, it is the active one already, no save of the model can be written
     * (ModelPackage.packageRefusal), or the mark its package keeps of the active set cannot be moved
     * (ActiveConfigMark). A reference is made active as a set is, with a warning (activeSetCaution).
     */
    activeSetRefusal(set) {
        const config = this.getSection('config');
        if (!(set instanceof ConfigSetNode || set instanceof ConfigSetRefNode) || set.parent !== config) {
            return 'it is not a configuration set of a model';
        }
        if (set.active) {
            return 'it is the active one already';
        }
        const refused = packageRefusal(this);
        if (refused) {
            return refused;
        }
        // The mark moved in the package as its sets now are: a set renamed or added since is marked
        // by the name it has.
        try {
            withActiveSet(this._configEdited({ ...this._zipEntries }), set.name);
        }
        catch (e) {
            if (e instanceof ActiveMarkError || e instanceof ConfigSetsError) {
                return e.message;
            }
            throw e;
        }
        return null;
    }
    /**
     * Why the model's configuration sets take no edit, as a clause, or null where they do: no save of
     * the model can be written (ModelPackage.packageRefusal, a `.mdl` among them), or its package is
     * not laid out as MATLAB writes it (ConfigSetsWriter, asked of the sets as read, of one more added
     * and of the last one deleted: the edits that touch the most of the package).
     */
    configEditRefusal() {
        if (this._configVerdict === undefined) {
            this._configVerdict = packageRefusal(this);
            if (this._configVerdict === null) {
                const asRead = this._configAsRead;
                const kept = asRead.map((s, read) => ({ ...s, read }));
                let name = 'Configuration';
                for (let i = 1; asRead.some((s) => s.name === name); i++)
                    name = 'Configuration' + i;
                const added = { read: null, name, className: 'Simulink.ConfigSet', description: '', sourceName: '' };
                try {
                    for (const sets of [kept, [...kept, added], ...(kept.length > 1 ? [kept.slice(0, -1)] : [])]) {
                        withConfigSets(this._zipEntries, asRead, sets, { hasDictionary: !!this.dataDictionary });
                    }
                }
                catch (e) {
                    if (!(e instanceof ConfigSetsError)) {
                        throw e;
                    }
                    this._configVerdict = e.message;
                }
            }
        }
        return this._configVerdict;
    }
    /** Whether the model's sets are in R2026b+'s layout, a part of JSON each, which a set's settings travel in. */
    get _configSetsInJson() {
        return !!this._zipEntries && Object.prototype.hasOwnProperty.call(this._zipEntries, 'simulink/configSetInfo.json');
    }
    /** The sets a save writes, where they are not the sets as read (each as it now is), or null. */
    get _configSetsToWrite() {
        const sets = (this.getSection('config')?.children ?? []);
        const now = sets.map((s) => ({
            read: s._readIndex ?? null,
            name: s.name,
            className: s instanceof ConfigSetRefNode ? 'Simulink.ConfigSetRef' : 'Simulink.ConfigSet',
            description: s.Description ?? '',
            sourceName: s instanceof ConfigSetRefNode ? s.SourceName : '',
            // A set pasted in: its settings, which its part is written with.
            ...(s._readIndex === undefined && s._pasted ? { content: s.serial._properties } : {}),
        }));
        const asRead = this._configAsRead;
        const same = now.length === asRead.length &&
            now.every((s, i) => s.read === i && s.name === asRead[i].name && s.description === asRead[i].description && s.sourceName === asRead[i].sourceName);
        return same ? null : now;
    }
    /**
     * `entries`, the package's members, with the configuration sets as they now are written into them
     * (ConfigSetsWriter): changed in place and answered. Throws ConfigSetsError, saying why.
     */
    _configEdited(entries) {
        const sets = this._configSetsToWrite;
        if (sets === null) {
            return entries;
        }
        const changes = withConfigSets(this._zipEntries, this._configAsRead, sets, { hasDictionary: !!this.dataDictionary });
        for (const [member, bytes] of Object.entries(changes)) {
            if (bytes === null) {
                delete entries[member];
            }
            else {
                entries[member] = bytes;
            }
        }
        return entries;
    }
    /**
     * What making `set` active cannot check, where it is made active and is a reference, as a
     * sentence, or null: MATLAB uses a reference only once it finds the set it refers to, in the
     * model's data dictionary or, with none, the base workspace (probe_active_config_set.m), which
     * this editor cannot look in without MATLAB.
     */
    activeSetCaution(set) {
        if (!(set instanceof ConfigSetRefNode) || this.activeSetRefusal(set) !== null) {
            return null;
        }
        const where = this.dataDictionary ? 'in the data dictionary "' + this.dataDictionary + '"' : 'in the base workspace';
        return '"' + set.name + '" refers to the configuration set "' + set.SourceName + '" ' + where +
            '. Without MATLAB this editor cannot check that the set is there: open the model in MATLAB to confirm.';
    }
    /** Make `set` the active configuration set, and answer the one that was, which no longer is. */
    _makeActive(set) {
        const was = this.activeConfigSet;
        if (was) {
            was.active = false;
        }
        set.active = true;
        return was;
    }
    /** The name of the set a save marks active, where it is not the one marked as read, or null. */
    get _activeSetToWrite() {
        const now = this.activeConfigSet;
        if (!now) {
            return null;
        }
        // The set marked as read, by its place among the sets as read, whatever it is called now.
        const asRead = this._configAsRead.findIndex((s) => s.active);
        return now._readIndex !== undefined && now._readIndex === asRead ? null : now.name;
    }
    // Whether nothing of the model takes an edit a save writes: its Model Workspace is the one part of
    // it edited, a `.slx`'s, where the model keeps it and its package can be written back
    // (ModelWorkspaceNode._fileRefusal, which asks ModelPackage.packageRefusal); every other section
    // is shown and not edited.
    get readOnly() {
        const workspace = this.getSection('workspace');
        return !(workspace instanceof ModelWorkspaceNode) || workspace.readOnly;
    }
    // The format an out-of-process host is told this source is, since SourceDTO carries
    // this field and nothing else in the projection names the format. Three values rather
    // than one per extension, because a Simulink model on disk really comes in three
    // shapes and `.mdl` covers two of them: the classic single flat text file, and the
    // modern OPC package which is a zip of parts exactly as a `.slx` is. Derived, not
    // stored, for the reason ProjectNode gives: this cannot change once the file is read,
    // and a field could drift from the parse that set it.
    //
    // Read off the CONTENT first and the name only to separate the two package cases.
    // `_zipEntries` is non-null exactly when the file yielded OPC PARTS — a real zip's
    // entries for a `.slx`, or the parts decodeTextPackage recovered from a text package
    // `.mdl`'s framing, which MdlParser hands to the same parseModelParts — and null
    // only for the classic single flat text file. It is NOT "which parser ran": both
    // flavours of `.mdl` go through parseMdl. This is the same test `serialize()` below
    // already makes to decide whether it has an archive to summarize. A srcId with no
    // recognisable extension (an opaque host URI) therefore still answers 'slx' for a
    // package and 'mdl' for flat text rather than guessing from a name it lacks.
    //
    // One wrinkle, reported as what was READ rather than what the file was: a package
    // truncated before its first part survives falls through to the classic grammar
    // reader, which finds the compatibility stub a modern `.mdl` opens with, so this
    // answers 'mdl'. Nothing on the node distinguishes that case — both fields are null
    // on that path — and the `source-unreadable` warning the reader files is what tells a
    // host the file was more than the stub. Deriving a format from a warning would be
    // worse than understating one.
    // Note 'xml' is deliberately NOT used for the package cases even though the parts are
    // XML in older releases: that token means a compressed-binary dictionary elsewhere,
    // and a consumer switching on this field must not mistake a model for one.
    get sourceFormat() {
        if (!this._zipEntries) {
            return 'mdl';
        }
        return extOf(this.name) === '.mdl' ? 'mdl-package' : 'slx';
    }
    get icon() {
        return 'simulink';
    }
    get Release() {
        return this.release;
    }
    get NumberOfEntries() {
        let count = 0;
        this.children.forEach((section) => {
            count += section.children.length;
        });
        return count;
    }
    getProperties() {
        return [PropName, PropRelease];
    }
    getPILayout() {
        return [{ group: 'General', items: [PropName, PropRelease] }];
    }
    getSection(key) {
        return this.children.find((c) => c.name === key) || null;
    }
    serialize() {
        if (!this._zipEntries) {
            return {
                model: this.name,
                release: this.release,
                uuid: this.uuid,
                dataDictionary: this.dataDictionary || '(none)',
                modelReferences: this.getSection('references').children.map((c) => c.name),
                externalDataSources: this.getSection('dataSources').children.map((c) => c.name),
                configSets: this.getSection('config').children.map((c) => c.name),
                workspace: '... (' + this.getSection('workspace').children.length + ' entries)',
                archiveFiles: this.rawContents ? Object.keys(this.rawContents) : [],
            };
        }
        // The parts as read, a copy. An edit of the Model Workspace is not folded back into the parse's
        // variables: the workspace is a MAT-file's editor, whose save is session.serializeSource, and a
        // parse a host shares between documents must not change under it.
        return Object.assign({}, this._zipEntries);
    }
    static fromParsed(parsed, filename) {
        const node = new ModelNode(filename);
        node.release = parsed.release;
        node.creator = parsed.creator;
        node.lastModified = parsed.lastModified;
        node.uuid = parsed.uuid;
        node.dataDictionary = parsed.dataDictionary;
        // A string or nothing: a host parse may predate the field, and one that crossed a
        // worker boundary is plain data with no type behind it.
        node.workspaceDataSource =
            typeof parsed.workspaceDataSource === 'string' && parsed.workspaceDataSource !== ''
                ? parsed.workspaceDataSource
                : null;
        node.workspaceSource = typeof parsed.workspaceSource === 'string' && parsed.workspaceSource !== '' ? parsed.workspaceSource : 'Model File';
        node.modelArguments = Array.isArray(parsed.modelArguments) ? parsed.modelArguments.filter((n) => typeof n === 'string') : [];
        node.rawContents = parsed.rawContents || null;
        node._zipEntries = parsed.zipEntries || null;
        node.blockParamUsages = parsed.blockParamUsages || [];
        node.masks = parsed.masks || [];
        // Populate blocks section from blockParamUsages — ONE ROW PER BLOCK, keyed by the
        // block's SID and not by its name. A name is unique within a system only, so
        // grouping on it merged every same-named block in the model into a single row:
        // a shipped demo model's four `Gain` blocks arrived as one row reading
        // `Gain=Mq, Gain=Zw, Gain=Kf, Gain=Zw`, four blocks' parameters under one name with
        // a duplicate that was really two blocks. See blockIdentity.
        //
        // A parsed usage carries the name, the type and the system path as well as the SID,
        // and the first usage of a block settles all of them: they are properties of the
        // block, repeated on every usage of it, so any of them would do.
        if (parsed.blockParamUsages && parsed.blockParamUsages.length > 0) {
            const blocksSection = node.getSection('blocks');
            const blockMap = new Map();
            for (const usage of parsed.blockParamUsages) {
                const key = blockKey(usage.blockName, usage.sid ?? '');
                if (!blockMap.has(key)) {
                    blockMap.set(key, {
                        name: usage.blockName,
                        type: usage.blockType,
                        sid: usage.sid ?? '',
                        systemPath: usage.systemPath ?? '',
                        usages: [],
                    });
                }
                blockMap.get(key).usages.push({
                    property: usage.paramProperty,
                    value: usage.paramValue,
                });
            }
            const paramSourceId = parsed.dataDictionary || null;
            for (const info of blockMap.values()) {
                blocksSection.addBlockEntry(info.name, info.type, info.usages, filename, paramSourceId, info.sid, info.systemPath);
            }
        }
        // The Model Workspace of a `.slx` is a MAT-file's editor over its part, where the part converts
        // into a MAT-file exactly (ModelWorkspaceNode.ofModel), in place of the section; every other
        // workspace is the section built of what was read, as before, which takes no edit.
        const workspace = ModelWorkspaceNode.ofModel(parsed, filename, parsed.warnings);
        // Built of the part, and so of the variables the parse holds, unless a host's parse holds
        // others than its parts do: then it is the section of the variables the host handed over.
        if (workspace && sameNames(workspace.children.map((c) => c.name), parsed.workspace.map((v) => v.name))) {
            const at = node.children.findIndex((c) => c.name === 'workspace');
            node.removeChild(node.children[at]);
            node.addChild(workspace, at);
        }
        else {
            ModelNode._addWorkspaceSection(node, parsed);
        }
        // Populate config sets section
        const cfgSection = node.getSection('config');
        for (const cfg of parsed.configSets) {
            cfgSection.addConfigSetEntry(cfg);
        }
        node._activeAsRead = parsed.configSets.find((c) => c.active)?.name ?? null;
        node._configAsRead = parsed.configSets.map((c) => ({
            name: c.name,
            className: c.objectClass === 'Simulink.ConfigSetRef' ? 'Simulink.ConfigSetRef' : 'Simulink.ConfigSet',
            description: c.description ?? '',
            sourceName: c.objectClass === 'Simulink.ConfigSetRef' ? c.sourceName : '',
            active: !!c.active,
        }));
        // Populate model references section
        const refSection = node.getSection('references');
        const refExt = refModelExt(filename);
        for (const ref of parsed.modelReferences) {
            refSection.addReferenceEntry(ref, refExt);
        }
        // Populate external data sources section
        const dsSection = node.getSection('dataSources');
        if (parsed.dataDictionary) {
            dsSection.addDataSourceEntry(parsed.dataDictionary);
        }
        for (const path of parsed.externalDataSources) {
            dsSection.addDataSourceEntry(path);
        }
        return node;
    }
    // The workspace as a section of what was read, with MCOS decoding: a `.mdl`'s, a host's parse
    // that holds no parts, or a part that does not convert into a MAT-file exactly.
    static _addWorkspaceSection(node, parsed) {
        const wsSection = node.getSection('workspace');
        const wsVars = parsed.workspace;
        const trailingElements = wsVars._trailingElements;
        // An .slx model workspace keeps the MCOS blob in its own trailing-element list.
        // Every opaque in the workspace, nested or not, comes back carrying its own decode, and
        // what the decoder could not read of one is a warning on the model.
        attachMcosDecoded(trailingElements?.[0], wsVars, parsed.warnings);
        for (const entry of wsVars) {
            if (entry.isOpaque) {
                // `parsed.warnings` is the very array addModelSource hands to registerSource
                // after this returns, so a degrade appended here reaches the source node. It is
                // the same list the part readers wrote into: one list per file, whichever layer
                // the loss was found in.
                const mcosNode = modelOpaqueMcosVariable(entry, mcosDecodedFor(entry), wsSection, parsed.warnings);
                if (mcosNode) {
                    wsSection.addChild(mcosNode);
                    continue;
                }
            }
            wsSection.addWorkspaceEntry(entry);
        }
    }
}
//# sourceMappingURL=ModelNode.js.map