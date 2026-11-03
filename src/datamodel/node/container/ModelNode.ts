// Copyright 2026 The MathWorks, Inc.

import ContainerNode from '../ContainerNode.js';
import type { TableColumnConfig } from '../ContainerNode.js';
import ModelSectionNode from './ModelSectionNode.js';
import ModelWorkspaceNode from './ModelWorkspaceNode.js';
import ConfigSetNode from '../data/ConfigSetNode.js';
import ConfigSetRefNode from '../data/ConfigSetRefNode.js';
import { ActiveMarkError, withActiveSet } from '../../parser/ActiveConfigMark.js';
import { packageRefusal } from '../../parser/ModelPackage.js';
import { attachMcosDecoded, modelOpaqueMcosVariable } from '../data/mcosTypedNode.js';
import { mcosDecodedFor } from '../data/mcosDecodedTable.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
import type { MatVariable } from '../data/MatlabVariableNode.js';
import type { BlockParamUsage, ParsedConfigSet } from '../../parser/SlxParser.js';
import type { ParseWarning } from '../../parser/ParseWarning.js';
import type { MaskScope } from '../../maskScope.js';
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

// What fromParsed needs, which is deliberately WIDER than SlxParser's own
// ParsedSlx: nullable rawContents/zipEntries and an optional blockParamUsages let
// a host that reconstructed only part of a model (or a test) build a ModelNode,
// while SlxParser's stricter result stays assignable to this. Do not "unify" the
// two by narrowing this one — that would make the partial callers cast.
export interface ParsedSlx {
  name: string;
  release: string;
  creator: string;
  lastModified: string;
  uuid: string;
  dataDictionary: string | null;
  modelReferences: { blockPath: string; modelName: string }[];
  externalDataSources: string[];
  // Optional here and required on SlxParser's, for the reason `warnings` gives below: a
  // host parse from before the field existed has none, and its model then resolves as it
  // always did, with this file among the externals.
  workspaceDataSource?: string | null;
  // Optional here and required on SlxParser's, for the reason `warnings` gives below: a host parse
  // from before the fields existed has none, and its model then reads as one keeping its own
  // workspace, with no arguments.
  workspaceSource?: string;
  modelArguments?: string[];
  configSets: ParsedConfigSet[];
  workspace: MatVariable[];
  blockParamUsages?: BlockParamUsage[];
  masks?: MaskScope[];
  rawContents: Record<string, string> | null;
  zipEntries: Record<string, Uint8Array> | null;
  // Optional here and required on SlxParser's, which keeps that one assignable to this:
  // a host reconstructing part of a model has no warnings array, and a degrade found
  // during construction then has nowhere to go and is dropped, exactly as before. What
  // it must NOT do is make such a caller invent one.
  warnings?: ParseWarning[];
}

function sameNames(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((n, i) => n === b[i]);
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
  // Its own unsaved changes, beside its Model Workspace's (dirty).
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

  constructor(name: string) {
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

    SECTION_DEFS.forEach((def) => {
      this.addChild(new ModelSectionNode(def.key, this, def.label, def.icon));
    });
  }

  get tableColumnConfig(): TableColumnConfig {
    return { columns: ['Name', 'Value', 'DataType', 'UsedBy'], labels: { DataType: 'Type', UsedBy: 'Usage' } };
  }

  /**
   * Whether the model has unsaved changes: its own, or its Model Workspace's, which marks itself
   * dirty as a MAT-file does (MatNode's execAddEntry, execRemoveEntry and retype, and a paste's put
   * back). Set false (a save, a revert), both are clean.
   */
  get dirty(): boolean {
    const workspace = this.getSection('workspace');
    return this._ownDirty || (workspace instanceof ModelWorkspaceNode && workspace.dirty);
  }

  set dirty(value: boolean) {
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
  addEntryRefusal(): string | null {
    const workspace = this.getSection('workspace');
    return workspace instanceof ModelWorkspaceNode ? workspace.addEntryRefusal() : null;
  }

  get displayName(): string {
    return this.name;
  }

  /** The configuration set active now, or null where none is (a `.mdl`, which marks none). */
  get activeConfigSet(): ConfigSetNode | ConfigSetRefNode | null {
    const sets = (this.getSection('config')?.children ?? []) as (ConfigSetNode | ConfigSetRefNode)[];
    return sets.find((c) => c.active) ?? null;
  }

  /**
   * Why `set` is not made the model's active configuration set, as a clause, or null where it is:
   * it is no set of this model, it is the active one already, no save of the model can be written
   * (ModelPackage.packageRefusal), or the mark its package keeps of the active set cannot be moved
   * (ActiveConfigMark). A reference is made active as a set is, with a warning (activeSetCaution).
   */
  activeSetRefusal(set: unknown): string | null {
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
    try {
      withActiveSet(this._zipEntries!, set.name);
    } catch (e) {
      if (e instanceof ActiveMarkError) {
        return e.message;
      }
      throw e;
    }
    return null;
  }

  /**
   * What making `set` active cannot check, where it is made active and is a reference, as a
   * sentence, or null: MATLAB uses a reference only once it finds the set it refers to, in the
   * model's data dictionary or, with none, the base workspace (probe_active_config_set.m), which
   * this editor cannot look in without MATLAB.
   */
  activeSetCaution(set: unknown): string | null {
    if (!(set instanceof ConfigSetRefNode) || this.activeSetRefusal(set) !== null) {
      return null;
    }
    const where = this.dataDictionary ? 'in the data dictionary "' + this.dataDictionary + '"' : 'in the base workspace';
    return '"' + set.name + '" refers to the configuration set "' + set.SourceName + '" ' + where +
      '. Without MATLAB this editor cannot check that the set is there: open the model in MATLAB to confirm.';
  }

  /** Make `set` the active configuration set, and answer the one that was, which no longer is. */
  _makeActive(set: ConfigSetNode | ConfigSetRefNode): ConfigSetNode | ConfigSetRefNode | null {
    const was = this.activeConfigSet;
    if (was) {
      was.active = false;
    }
    set.active = true;
    return was;
  }

  /** The name of the set a save marks active, where it is not the one marked as read, or null. */
  get _activeSetToWrite(): string | null {
    const now = this.activeConfigSet?.name ?? null;
    return now !== null && now !== this._activeAsRead ? now : null;
  }

  // Whether nothing of the model takes an edit a save writes: its Model Workspace is the one part of
  // it edited, a `.slx`'s, where the model keeps it and its package can be written back
  // (ModelWorkspaceNode._fileRefusal, which asks ModelPackage.packageRefusal); every other section
  // is shown and not edited.
  get readOnly(): boolean {
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
  get sourceFormat(): string {
    if (!this._zipEntries) {
      return 'mdl';
    }
    return extOf(this.name) === '.mdl' ? 'mdl-package' : 'slx';
  }

  get icon(): string {
    return 'simulink';
  }

  get Release(): string {
    return this.release;
  }

  get NumberOfEntries(): number {
    let count = 0;
    this.children.forEach((section) => {
      count += section.children.length;
    });
    return count;
  }

  getProperties(): PropClass[] {
    return [PropName, PropRelease];
  }

  getPILayout(): PIGroupDef[] {
    return [{ group: 'General', items: [PropName, PropRelease] }];
  }

  // The Model Workspace of a `.slx` is a ModelWorkspaceNode (a MAT-file's editor); every other
  // section, and the workspace of a `.mdl`, a ModelSectionNode.
  getSection(key: 'workspace'): ModelSectionNode | ModelWorkspaceNode | null;
  getSection(key: string): ModelSectionNode | null;
  getSection(key: string): ModelSectionNode | ModelWorkspaceNode | null {
    return (this.children.find((c) => c.name === key) as ModelSectionNode | ModelWorkspaceNode) || null;
  }

  serialize(): unknown {
    if (!this._zipEntries) {
      return {
        model: this.name,
        release: this.release,
        uuid: this.uuid,
        dataDictionary: this.dataDictionary || '(none)',
        modelReferences: this.getSection('references')!.children.map((c) => c.name),
        externalDataSources: this.getSection('dataSources')!.children.map((c) => c.name),
        configSets: this.getSection('config')!.children.map((c) => c.name),
        workspace: '... (' + this.getSection('workspace')!.children.length + ' entries)',
        archiveFiles: this.rawContents ? Object.keys(this.rawContents) : [],
      };
    }

    // The parts as read, a copy. An edit of the Model Workspace is not folded back into the parse's
    // variables: the workspace is a MAT-file's editor, whose save is session.serializeSource, and a
    // parse a host shares between documents must not change under it.
    return Object.assign({}, this._zipEntries);
  }

  static fromParsed(parsed: ParsedSlx, filename: string): ModelNode {
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
      const blocksSection = node.getSection('blocks')!;
      const blockMap = new Map<
        string,
        {
          name: string;
          type: string;
          sid: string;
          systemPath: string;
          usages: Array<{ property: string; value: string }>;
        }
      >();
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
        blockMap.get(key)!.usages.push({
          property: usage.paramProperty,
          value: usage.paramValue,
        });
      }
      const paramSourceId = parsed.dataDictionary || null;
      for (const info of blockMap.values()) {
        blocksSection.addBlockEntry(
          info.name,
          info.type,
          info.usages,
          filename,
          paramSourceId,
          info.sid,
          info.systemPath,
        );
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
    } else {
      ModelNode._addWorkspaceSection(node, parsed);
    }

    // Populate config sets section
    const cfgSection = node.getSection('config')!;
    for (const cfg of parsed.configSets) {
      cfgSection.addConfigSetEntry(cfg);
    }
    node._activeAsRead = parsed.configSets.find((c) => c.active)?.name ?? null;

    // Populate model references section
    const refSection = node.getSection('references')!;
    const refExt = refModelExt(filename);
    for (const ref of parsed.modelReferences) {
      refSection.addReferenceEntry(ref, refExt);
    }

    // Populate external data sources section
    const dsSection = node.getSection('dataSources')!;
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
  static _addWorkspaceSection(node: ModelNode, parsed: ParsedSlx): void {
    const wsSection = node.getSection('workspace') as ModelSectionNode;
    const wsVars = parsed.workspace;
    const trailingElements = (wsVars as unknown as { _trailingElements?: Uint8Array[] })._trailingElements;
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
