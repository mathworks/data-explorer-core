// Copyright 2026 The MathWorks, Inc.

import ContainerNode from '../ContainerNode.js';
import type { TableColumnConfig } from '../ContainerNode.js';
import MatlabVariableNode from '../data/MatlabVariableNode.js';
import type { MatVariable } from '../data/MatlabVariableNode.js';
import ModelBlockNode from '../data/ModelBlockNode.js';
import ConfigSetNode from '../data/ConfigSetNode.js';
import ConfigSetRefNode from '../data/ConfigSetRefNode.js';
import ModelReferenceNode from '../data/ModelReferenceNode.js';
import DataSourceNode from '../data/DataSourceNode.js';
import type BaseNode from '../BaseNode.js';
import { UNWORDED, withArticle } from '../BaseNode.js';
import * as NodeRegistry from '../NodeRegistry.js';
import type { ParsedConfigSet } from '../../parser/SlxParser.js';
import { basenameOf, isModelFile } from '../../fileKinds.js';
import { newEntryName, uniqueName, validateMatlabName } from '../../matlabName.js';
import { oneWrite, textDictionaryForm } from '../../parser/MatWriter.js';

/** The classes a model's Configurations section holds, and is added: as a dictionary's (SectionNode). */
const CONFIG_CLASSES = ['Simulink.ConfigSet', 'Simulink.ConfigSetRef'];

/** What a model answers of its configuration sets (ModelNode.configEditRefusal), asked without importing it. */
interface ConfigSetsHolder {
  configEditRefusal(): string | null;
  /** Whether its sets are in R2026b+'s layout, a part of JSON each. */
  readonly _configSetsInJson: boolean;
}

// The `_properties` of a set's R2026b+ part (`{"_object_class":..., "_properties":{...}}`), or null
// for a part of another layout.
function jsonPartProperties(data: unknown): Record<string, unknown> | null {
  const rec = data as Record<string, unknown> | null;
  const props = rec && typeof rec === 'object' && typeof rec._object_class === 'string' ? rec._properties : null;
  return props && typeof props === 'object' && !Array.isArray(props) ? (props as Record<string, unknown>) : null;
}

export default class ModelSectionNode extends ContainerNode {
  label: string;
  iconId: string;

  constructor(name: string, parent: BaseNode | null, label: string, iconId: string) {
    super(name, parent);
    this.label = label;
    this.iconId = iconId;
  }

  get icon(): string {
    return this.iconId;
  }

  get displayName(): string {
    return this.label;
  }

  get tableColumnConfig(): TableColumnConfig {
    switch (this.name) {
      case 'blocks':
        return { columns: ['Name', 'Value', 'DataType'], labels: { Value: 'Block Type', DataType: 'Uses' } };
      case 'workspace':
        return { columns: ['Name', 'Value', 'DataType', 'UsedBy'] };
      case 'config':
        return { columns: ['Name', 'Description'] };
      default:
        return { columns: ['Name', 'Value', 'DataType', 'UsedBy'] };
    }
  }

  // A model's elements, references and external data are shown and not edited: no save writes
  // them. Its configuration sets are edited where the model's package takes their edits (the
  // Configurations section, below): renamed, described, a reference pointed elsewhere, added and
  // deleted, as a dictionary's are. So an edit of a row in any of those sections is refused, its
  // editors with it, as a MAT-file refuses one its save would not write. BaseNode.sourceEditRefusal
  // asks the first container above an entry, which is this, and every editability getter,
  // structural gate and setter asks it. Without it a section answered nothing and took every edit
  // its nodes take: a config set's rename marked the model dirty and recorded an undo step that no
  // save could keep. A `.slx`'s Model Workspace is no section but a MAT-file's editor
  // (ModelWorkspaceNode), and answers by its rules; a workspace that is a section (a `.mdl`'s, or
  // one whose part does not convert) is one no save writes, and refuses every edit too.
  _editRefusal(entry: BaseNode, node: BaseNode, key: string, describe = true): string | null {
    const why = this.name === 'config' ? this._configKeyRefusal(entry, node, key) : this._notEditedWhy();
    return why === null ? null : describe ? why : UNWORDED;
  }

  /** Why an entry of this section is not deleted, as a clause (the session's deleteRefusal). */
  removeEntryRefusal(node: BaseNode): string | null {
    if (this.name !== 'config') {
      return this._notEditedWhy();
    }
    const refused = this._configRefusal();
    if (refused) {
      return refused;
    }
    if (node.parent !== this) {
      return '"' + this.label + '" holds no such entry';
    }
    // As MATLAB: detachConfigSet refuses the active set (Simulink:ConfigSet:DetachActiveConfigSet).
    return (node as { active?: boolean }).active ? 'it is the active configuration set, which MATLAB does not delete: make another set active first' : null;
  }

  execRemoveEntry(node: BaseNode): { undo: () => void; redo: () => void } | null {
    if (this.removeEntryRefusal(node) !== null) {
      return null;
    }
    const index = this.children.indexOf(node);
    this.removeChild(node);
    this._markSourceDirty();
    return {
      undo: () => {
        this.addChild(node, index);
        this._markSourceDirty();
      },
      redo: () => {
        this.removeChild(node);
        this._markSourceDirty();
      },
    };
  }

  /**
   * Why a copy of `entry` is refused, as a clause, or null (the session's copyRefusal asks it): a
   * configuration set of a model whose sets are not in R2026b+'s layout, whose settings the node
   * does not hold (addConfigSetEntry). A reference copies in every layout: its settings are its
   * source and its Description.
   */
  entryCopyRefusal(entry: BaseNode): string | null {
    if (this.name !== 'config' || !(entry instanceof ConfigSetNode) || this._setsInJson()) {
      return null;
    }
    return "a configuration set's settings are copied out of a model saved in R2026b or later, and " + this._earlierLayout() + ': copy it in MATLAB';
  }

  // Whether the model's sets are in R2026b+'s layout (ModelNode._configSetsInJson).
  _setsInJson(): boolean {
    return !!(this.parent as unknown as Partial<ConfigSetsHolder> | null)?._configSetsInJson;
  }

  // The model, saved in an earlier layout than R2026b's, as a refusal names it.
  _earlierLayout(): string {
    return '"' + basenameOf(this.parent?.name ?? '') + "\" is saved in an earlier release's layout";
  }

  /**
   * Why `payload`, an entry copied out of a dictionary or a model (DataNode.serialize), is not pasted
   * into this section, in the words pasteEntries answers, or null where it is (the session's
   * pasteRefusal): a model's configuration sets take a set or a reference, as a dictionary holds
   * one, a set's settings into R2026b+'s layout alone.
   */
  pasteRefusal(payload: unknown): string | null {
    const plan = this._pastePlan([payload]);
    return 'why' in plan ? plan.why : null;
  }

  /**
   * Paste `payloads` as new sets, all of them or none, each named as it was or, where the name is
   * taken, with a counter, as MATLAB names a duplicate (attachConfigSet's allowRename: Fast1), each
   * with every setting it carries, which its part is written with (ConfigSetsWriter). The session
   * files the undo (pasteEntries).
   */
  execPasteEntries(payloads: readonly unknown[]): { nodes: BaseNode[]; undo: () => void; redo: () => void } | { error: true; reason: string } {
    const plan = this._pastePlan(payloads);
    if ('why' in plan) {
      return { error: true, reason: plan.why };
    }
    const nodes = plan.made.map(({ name, className, rawVal }) => {
      const node = className === 'Simulink.ConfigSetRef' ? ConfigSetRefNode.parse(rawVal, name, this) : ConfigSetNode.parse(rawVal, name, this);
      node.active = false;
      node._pasted = true;
      return node;
    });
    const add = () => {
      for (const node of nodes) this.addChild(node);
      this._markSourceDirty();
    };
    const remove = () => {
      for (const node of nodes) this.removeChild(node);
      this._markSourceDirty();
    };
    add();
    return { nodes, undo: remove, redo: add };
  }

  _pastePlan(payloads: readonly unknown[]): { made: { name: string; className: string; rawVal: Record<string, unknown> }[] } | { why: string } {
    const into = (name?: string) => 'Cannot paste ' + (name ? '"' + name + '" ' : '') + 'into "' + this.label + '": ';
    const nothing = '. Nothing was pasted.';
    if (this.name !== 'config') {
      return { why: into() + this._notEditedWhy() + nothing };
    }
    const refused = this._configRefusal();
    if (refused) {
      return { why: into() + refused + nothing };
    }
    const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
    if (!Array.isArray(payloads) || !payloads.every(isRecord)) {
      return { why: into() + 'what was handed over is not a list of entries' + nothing };
    }
    const taken = new Set(this.children.map((c) => c.name));
    const made: { name: string; className: string; rawVal: Record<string, unknown> }[] = [];
    for (const payload of payloads as Record<string, unknown>[]) {
      const asked = typeof payload.name === 'string' ? payload.name : '';
      // In a text dictionary's form, which R2026b+'s part of a set is (measured, R2027a): what a
      // binary dictionary's reader keeps of its XML beside the properties (the Source of a dynamic
      // one, XmlUtils.PROPERTY_SOURCE_KEY) is no property, and MATLAB warns of it in a part.
      let value: Record<string, unknown> | null;
      try {
        const form = isRecord(payload.value) ? oneWrite(() => textDictionaryForm(payload.value)) : null;
        value = isRecord(form) ? form : null;
      } catch (e) {
        return { why: into(asked) + 'it could not be written (' + (e as Error).message + ')' + nothing };
      }
      const className = typeof value?._array_class === 'string' ? value._array_class : '';
      if (!CONFIG_CLASSES.includes(className)) {
        return { why: into(asked) + 'the section holds no entry of that class' + nothing };
      }
      const elements = value!._elements;
      const element = Array.isArray(elements) && elements.length === 1 && isRecord(elements[0]) ? elements[0] : null;
      if (!element || !isRecord(element._properties)) {
        return { why: into(asked) + 'it is not one configuration set as a dictionary holds one' + nothing };
      }
      if (className === 'Simulink.ConfigSet' && !this._setsInJson()) {
        return { why: into(asked) + "a configuration set's settings are written into a model saved in R2026b or later, and " + this._earlierLayout() + ': paste it in MATLAB' + nothing };
      }
      const name = uniqueName(asked || (className === 'Simulink.ConfigSetRef' ? 'Reference' : 'Configuration'), (n) => taken.has(n));
      if (this._childNameError(name) !== null) {
        return { why: into(asked) + "'" + name + "' is not a name MATLAB gives a configuration set" + nothing };
      }
      taken.add(name);
      // A copy of its settings, which no later edit of what it was copied out of reaches.
      const props = { ...(JSON.parse(JSON.stringify(element._properties)) as Record<string, unknown>), Name: name };
      made.push({ name, className, rawVal: { _array_class: className, _dimensions: [1, 1], _elements: [{ _id: '1', _properties: props }], _mw_element_type: 'MATLABArray' } });
    }
    return { made };
  }

  /** The classes this section holds and is added: a model's configuration sets', or none. */
  getAllowedTypes(): string[] {
    return this.name === 'config' && this._configRefusal() === null ? [...CONFIG_CLASSES] : [];
  }

  /**
   * Why addEntry makes no entry of `className` here, named `entryName` or the class's default name,
   * in words naming the section, or null where it makes one (the session's addEntryRefusal).
   */
  entryRefusal(className: string, entryName?: string): string | null {
    const why = this._entryPlan(className, entryName);
    return 'why' in why ? 'Cannot add ' + withArticle(className || 'entry') + ' to "' + this.label + '": ' + why.why + '.' : null;
  }

  // A new configuration set of `className`, named `entryName` or the class's default name with a
  // counter where the name is taken: a Simulink.ConfigSet as a dictionary makes one, its Name and
  // the Version of its file's other sets and nothing else, which MATLAB opens as a fresh set of its
  // own release (ConfigSetsWriter); a Simulink.ConfigSetRef pointing nowhere until its source is set.
  execAddEntry(className: string, entryName?: string): { node: BaseNode; undo: () => void; redo: () => void } | null {
    const plan = this._entryPlan(className, entryName);
    if ('why' in plan) {
      return null;
    }
    const node = className === 'Simulink.ConfigSetRef' ? ConfigSetRefNode.createDefault(plan.name, this) : ConfigSetNode.createDefault(plan.name, this);
    node.active = false;
    this.addChild(node);
    this._markSourceDirty();
    return {
      node,
      undo: () => {
        this.removeChild(node);
        this._markSourceDirty();
      },
      redo: () => {
        this.addChild(node);
        this._markSourceDirty();
      },
    };
  }

  _entryPlan(className: string, entryName?: string): { name: string } | { why: string } {
    if (this.name !== 'config') {
      return { why: this._notEditedWhy() };
    }
    const refused = this._configRefusal();
    if (refused) {
      return { why: refused };
    }
    if (!CONFIG_CLASSES.includes(className)) {
      return { why: 'the section holds no entry of that class' };
    }
    const taken = new Set(this.children.map((c) => c.name));
    const base = entryName || (className === 'Simulink.ConfigSetRef' ? 'Reference' : 'Configuration');
    const { name, invalid } = newEntryName(base, (n) => taken.has(n));
    if (invalid !== null) {
      return { why: "'" + name + "' is not a name MATLAB gives a configuration set (" + invalid + ')' };
    }
    return { name };
  }

  /**
   * Why a name typed in for a child of this section is not one, or null where it is (DataNode's
   * rename asks it in place of a MATLAB name's rule): a configuration set's, as MATLAB's
   * set_param(cs, 'Name') takes one, measured on R2027a: not empty, of letters, digits, _, - and
   * spaces.
   */
  _childNameError(text: string): string | null {
    if (this.name !== 'config') {
      return validateMatlabName(text);
    }
    if (text === '') {
      return 'Name for a configuration object cannot be empty.';
    }
    return /^[A-Za-z0-9_\- ]+$/.test(text) ? null : 'Invalid character in name for configuration object. Valid characters are {(a-z), (A-Z), (0-9), _, -} and a space.';
  }

  // Where a set's name is taken, as a rename refused for a duplicate says it (DataNode): the model's
  // configuration sets; undefined in any other section, whose rows are not renamed.
  get _namespaceLabel(): string | undefined {
    return this.name === 'config' ? 'the configuration sets of "' + basenameOf(this.parent?.name ?? '') + '"' : undefined;
  }

  // Why the model's configuration sets take no edit: the model's own answer.
  _configRefusal(): string | null {
    const model = this.parent as unknown as Partial<ConfigSetsHolder> | null;
    return typeof model?.configEditRefusal === 'function' ? model.configEditRefusal() : this._notEditedWhy();
  }

  // Why the key `key` of a row of this section takes no edit: a set's Name and Description, and a
  // reference's source, where the sets are edited; nothing under a set, and no other key.
  _configKeyRefusal(entry: BaseNode, node: BaseNode, key: string): string | null {
    const refused = this._configRefusal();
    if (refused) {
      return refused;
    }
    if (node !== entry) {
      return 'it is part of the configuration set "' + entry.name + '", whose settings are edited in MATLAB';
    }
    const keys = entry instanceof ConfigSetRefNode ? ['Name', 'Description', 'SourceName'] : ['Name', 'Description'];
    return keys.includes(key) ? null : 'a configuration set\'s settings are edited in MATLAB';
  }

  _notEditedWhy(): string {
    return 'it is in the ' + this.label + ' section of "' + (this.parent?.name ?? '') + '", which this editor shows but does not edit';
  }

  // One variable the node builders cannot make a node of refused the whole model: a complex
  // one whose flags word was overwritten with a class the reader does not model (255, say)
  // has no value, and the complex arm read `.re` of its null. The maintainer's ruling of
  // 2026-10-16 (group E, theme 1: show what was read, never refuse the file) catches it here,
  // one variable at a time, and shows it as what was read of it, its name, class and size,
  // not decoded (MatlabVariableNode.createNotDecoded), as a binary dictionary shows the same
  // bytes. It does not warn: a model workspace does not report a value it did not decode
  // (the C-232 ruling).
  //
  // A variable a Simulink text package `.mdl` holds is not a MAT array but the MATLAB-array
  // JSON a text dictionary's entry values are spelled in (MatVariable.json), and it is read
  // by the reader those are: the node it builds is the node a text dictionary shows for the
  // same value, and for a Simulink.Parameter the typed node the `.slx` path builds out of
  // the subsystem's decode. Caught the same way.
  addWorkspaceEntry(entry: MatVariable): BaseNode {
    let node: BaseNode;
    try {
      node =
        entry.json !== undefined
          ? NodeRegistry.parseValue(entry.json, entry.name, this)
          : MatlabVariableNode.parseMatVariable(entry, entry.name, this);
    } catch {
      node = MatlabVariableNode.createNotDecoded(entry, entry.name, this);
    }
    this.addChild(node);
    return node;
  }

  addConfigSetEntry(cfg: ParsedConfigSet): BaseNode {
    // The SLX config section uses the SAME node classes as the SLDD path
    // (ConfigSetNode / ConfigSetRefNode) so presentation is identical — empty,
    // non-editable Value and Data Type. The SLX-only "active" state is carried
    // on the shared node and surfaces through the icon, not a Value suffix.
    //
    // `cfg.objectClass` is already normalized by the parser, which is the point: this
    // used to read `data._object_class` itself and so only ever recognised a reference
    // in the R2026b+ JSON layout, silently calling one a plain `Simulink.ConfigSet` in
    // all four XML eras (where the class is an ATTRIBUTE) and in the classic `.mdl`.
    // Anything other than a positive `Simulink.ConfigSetRef` stays an ordinary set.
    const objectClass =
      cfg.objectClass === 'Simulink.ConfigSetRef' ? 'Simulink.ConfigSetRef' : 'Simulink.ConfigSet';
    // A reference's whole content is what it points AT, and `ConfigSetRefNode` reads
    // that from `SourceName`. Passing only `Name` left every SLX-sourced reference
    // showing an empty source — including in the one layout whose class was recognised.
    const props: Record<string, unknown> = { Name: cfg.name };
    if (objectClass === 'Simulink.ConfigSetRef' && cfg.sourceName) {
      props.SourceName = cfg.sourceName;
    }
    // The set's own Description, as the file holds it: shown, and edited where the model's sets are.
    if (cfg.description) {
      props.Description = cfg.description;
    }
    // R2026b+'s layout holds a set in its part as a text dictionary holds it in an entry, the same
    // `_properties` byte for byte (measured, R2027a): so the node is the dictionary's, every setting
    // in it, which a copy carries and a dictionary pastes whole. Another layout's set is its name, its
    // Description and a reference's source, which a copy of a set does not carry (entryCopyRefusal).
    const part = jsonPartProperties(cfg.data);
    const rawVal = part
      ? { _array_class: objectClass, _dimensions: [1, 1], _elements: [{ _id: '1', _properties: part }], _mw_element_type: 'MATLABArray' }
      : {
          _array_class: objectClass,
          _array_type: 'MATLABArray',
          _dimensions: [1, 1],
          _mw_element_type: 'MATLABArray',
          _elements: [{ _properties: props }],
        };
    const node =
      objectClass === 'Simulink.ConfigSetRef'
        ? ConfigSetRefNode.parse(rawVal, cfg.name, this)
        : ConfigSetNode.parse(rawVal, cfg.name, this);
    node.active = cfg.active;
    // Which of the sets as read it is, by its place: what a save of the model's sets edits.
    node._readIndex = this.children.length;
    this.addChild(node);
    return node;
  }

  // A model file names its references WITHOUT an extension, but the entry has to be
  // a filename: it doubles as the link target used to jump to that model once it is
  // loaded. `defaultExt` is the parent model's own extension, because a reference is
  // far likelier to be the same generation of file as the model referencing it — a
  // legacy `.mdl` hierarchy is legacy throughout — and a `.mdl` model whose children
  // were all labelled `.slx` would link to nothing.
  //
  // `isModelFile` decides whether the name is already complete, rather than a regex
  // spelled here: that is the same question this package publishes an answer to, and a
  // second copy of it is a second opinion about whether `plant.MDL` needs completing —
  // which would produce `plant.MDL.slx`, a link to nothing.
  //
  // Required, with no `.slx` default: a default would be a THIRD answer to "which
  // extension" — one a caller that forgot the parent's would take silently. The guess
  // belongs to `fileKinds.refModelExt`, and the point of it living there is that every
  // caller makes it the same way. No caller ever took the default; omitting the argument
  // is now a compile error rather than a `.mdl` hierarchy labelled `.slx`.
  addReferenceEntry(ref: { blockPath: string; modelName: string }, defaultExt: string): BaseNode {
    const named = isModelFile(ref.modelName);
    const node = new ModelReferenceNode(named ? ref.modelName : ref.modelName + defaultExt, this, ref.blockPath);
    this.addChild(node);
    return node;
  }

  // `blockName` is the name the FILE records, blank included; `sid` is what the entry
  // is identified by; `systemPath` is where in the model it sits. See blockIdentity for
  // why those are three arguments and not one.
  addBlockEntry(
    blockName: string,
    blockType: string,
    paramUsages: Array<{ property: string; value: string }>,
    modelSrcId: string,
    paramSourceId: string | null,
    sid = '',
    systemPath = '',
  ): BaseNode {
    const node = new ModelBlockNode(
      blockName,
      this,
      blockType,
      paramUsages,
      modelSrcId,
      paramSourceId,
      sid,
      systemPath,
    );
    this.addChild(node);
    return node;
  }

  addDataSourceEntry(path: string): BaseNode {
    // `path` is whatever MATLAB wrote into the model, so a model saved on Windows records
    // `..\shared\signals.mat`. Splitting on `/` alone left that entire string as the
    // node's name — a path in the Name column and a path as the link target — while the
    // link still resolved, because `refBasename` does split on both. `basenameOf` is the
    // one place that rule lives.
    const node = new DataSourceNode(basenameOf(path), this, path);
    this.addChild(node);
    return node;
  }
}
