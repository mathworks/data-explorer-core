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
import type { ParsedConfigSet } from '../../parser/SlxParser.js';
import { basenameOf, isModelFile } from '../../fileKinds.js';

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

  addWorkspaceEntry(entry: MatVariable): BaseNode {
    const node = MatlabVariableNode.parseMatVariable(entry, entry.name, this);
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
    const rawVal = {
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
