// Copyright 2026 The MathWorks, Inc.

import MatNode from './MatNode.js';
import ContainerNode from '../ContainerNode.js';
import type { TableColumnConfig } from '../ContainerNode.js';
import type BaseNode from '../BaseNode.js';
import type { PIGroupDef, PropClass, SourceOfferedEditor, SourceRetyped, SourceSetResult } from '../BaseNode.js';
import { UNWORDED, withArticle } from '../BaseNode.js';
import { mcosEnumerationOf } from '../mcosPlace.js';
import { parseMat } from '../../parser/MatParser.js';
import type { ParsedMat } from '../../parser/MatParser.js';
import { matOfWorkspaceStream, type WorkspaceStreamRead } from '../../parser/ModelWorkspaceStream.js';
import type { ParseWarning } from '../../parser/ParseWarning.js';
import { basenameOf } from '../../fileKinds.js';
import { EMPTY_WORKSPACE, WORKSPACE_MAT_PART, WORKSPACE_STREAM_PART, handedAway, packageRefusal, type ModelPackage } from '../../parser/ModelPackage.js';

export { WORKSPACE_MAT_PART, WORKSPACE_STREAM_PART };

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
  label = 'Model Workspace';
  iconId = 'databaseFolderWorkspace';
  // The part the workspace was read from, or null where the model held none; and of a stream
  // (R2019b+), what was read of it to convert back (ModelWorkspaceStream.workspaceStreamOfMat).
  _part: string | null = null;
  _streamRead: WorkspaceStreamRead | null = null;
  // Why no edit of it would be kept, whatever the MAT-file's rules say, as a sentence; or null.
  _modelRefusal: string | null = null;
  // Why no save of the model's package can be written (ModelPackage.packageRefusal), found once.
  _packageVerdict: string | null | undefined;

  constructor() {
    super('workspace');
  }

  get icon(): string {
    return this.iconId;
  }

  get displayName(): string {
    return this.label;
  }

  get tableColumnConfig(): TableColumnConfig {
    return { columns: ['Name', 'Value', 'DataType', 'UsedBy'] };
  }

  // A section's, not a MAT-file's: it is a part of the model, which says what it is.
  getProperties(): PropClass[] {
    return ContainerNode.prototype.getProperties.call(this);
  }

  getPILayout(): PIGroupDef[] | null {
    return ContainerNode.prototype.getPILayout.call(this);
  }

  get _noun(): string {
    return 'model workspace';
  }

  // A model workspace does not report a value it did not decode (the C-232 ruling), as the
  // section it replaces did not.
  get _warnsUndecoded(): boolean {
    return false;
  }

  /** The model's file, which a save of the workspace is a save of. */
  get _saveLabel(): string {
    return this._modelName;
  }

  get _namespaceLabel(): string {
    return this._modelName;
  }

  get _modelName(): string {
    const model = this.parent;
    return model ? basenameOf(model.name) || model.name : this.name;
  }

  // Of the workspace (its source), then of the model's package (a save of which the workspace's is
  // part of), then of the MAT-file it is edited as. A package's verdict is found once, and asked
  // again only of a part handed away since, as a MAT-file's is (MatNode._fileRefusal).
  _fileRefusal(): string | null {
    if (this._modelRefusal) {
      return this._modelRefusal;
    }
    const model = this.parent as unknown as ModelPackage | null;
    if (model && (this._packageVerdict === undefined || (this._packageVerdict === null && this._partHandedAway(model)))) {
      const why = packageRefusal(model);
      this._packageVerdict = why ? 'Cannot edit "' + this._modelName + '": ' + why + '.' : null;
    }
    return this._packageVerdict ?? super._fileRefusal();
  }

  // ---- What a model workspace keeps of what a MAT-file holds --------------------------------
  //
  // Every rule of a MAT-file's editor is asked first (super), and then what a model workspace keeps
  // of what it takes, measured on R2027a (test/parity/matlab/probe_workspace_limits.m):
  //   - Simulink uses no bus, alias type or enumeration definition from a model workspace ("should
  //     only be created in the base workspace or data dictionary"), so none is created or pasted;
  //   - a Signal keeps the storage class Auto alone: one holding another is set to Auto, with a
  //     warning, as the model opens; a Parameter keeps any but a custom one, which is set to
  //     Model default, silently, and which a MAT-file's editor neither offers nor takes;
  //   - a model argument (ParameterArgumentNames) whose variable is gone, or no longer a number, a
  //     fi, an enumeration, a scalar struct or a Parameter, is dropped from the model as it opens,
  //     with a warning; so an argument's variable is not renamed or deleted here, nor typed over
  //     with a value of another kind;
  //   - a variable a block of the model uses by name is not renamed or deleted here, which would
  //     leave the block naming nothing (a rename in MATLAB's Model Explorer renames its uses too).

  _classRefusal(className: string): string | null {
    if (NOT_USED_FROM_A_MODEL_WORKSPACE.has(className)) {
      return withArticle(className) + ' is not used by Simulink from a model workspace: define it in the base workspace or a data dictionary';
    }
    return super._classRefusal(className);
  }

  // A Signal's storage class offers no editor: Auto is the one it keeps. A Parameter's is a MAT-file's,
  // which offers no custom storage class either.
  _offeredEditor(entry: BaseNode, node: BaseNode, key: string): SourceOfferedEditor | null {
    return key === 'storageClass' && isSignal(node) ? null : super._offeredEditor(entry, node, key);
  }

  _editRefusal(entry: BaseNode, node: BaseNode, key: string, describe = true): string | null {
    const refused = super._editRefusal(entry, node, key, describe);
    if (refused) {
      return refused;
    }
    let why: string | null = null;
    if (key === 'storageClass' && isSignal(node)) {
      why = "a Signal in a model workspace keeps the storage class Auto alone, which MATLAB sets it to as it opens the model";
    } else if (node === entry && (key === 'Name' || key === 'name')) {
      why = this._keptNameWhy(entry, 'renamed');
    }
    return why === null ? null : describe ? 'Cannot ' + (key === 'storageClass' ? 'edit' : 'rename') + ' "' + (node.matlabPath || node.name) + '": ' + why + '.' : UNWORDED;
  }

  removeEntryRefusal(node: BaseNode): string | null {
    return super.removeEntryRefusal(node) ?? this._keptNameWhy(node, 'deleted');
  }

  _valueRefusal(entry: BaseNode, node: BaseNode, value: BaseNode): string | null {
    const refused = super._valueRefusal(entry, node, value);
    if (refused || node !== entry || !this._isArgument(entry.name) || argumentValueTaken(value)) {
      return refused;
    }
    return 'Cannot edit "' + entry.name + '": ' + argumentWhy(entry.name, String((value as unknown as { className?: string }).className ?? 'value'));
  }

  _retype(entry: BaseNode, node: BaseNode, key: string, text: string): SourceRetyped | Exclude<SourceSetResult, true> | null {
    if (node === entry && key === 'Value' && this._isArgument(entry.name)) {
      const retyped = super._retype(entry, node, key, text);
      if (retyped && 'node' in retyped && !argumentValueTaken(retyped.node)) {
        retyped.undo();
        return { error: true, reason: 'Cannot edit "' + entry.name + '": ' + argumentWhy(entry.name, String((retyped.node as unknown as { className?: string }).className ?? 'value')), invalidValue: text, validValue: node.displayValue };
      }
      return retyped;
    }
    return super._retype(entry, node, key, text);
  }

  /** Whether `name` is one of the model's arguments (ParameterArgumentNames). */
  _isArgument(name: string): boolean {
    const args = (this.parent as unknown as { modelArguments?: string[] } | null)?.modelArguments;
    return Array.isArray(args) && args.includes(name);
  }

  // Why the variable `node` is not `done` (renamed, deleted) here, as a clause, or null: it is an
  // argument of the model, or a block of the model uses it by name (the Usage its row shows).
  _keptNameWhy(node: BaseNode, done: 'renamed' | 'deleted'): string | null {
    if (node.parent !== this) {
      return null;
    }
    if (this._isArgument(node.name)) {
      return 'it is an argument of the model, which MATLAB drops, with a warning, as it opens a model whose workspace holds no variable of its name';
    }
    let root: BaseNode = this;
    while (root.parent) {
      root = root.parent;
    }
    const resolve = (root as unknown as { _usageResolver?: (id: string) => { blockName: string }[] })._usageResolver;
    const usages = typeof resolve === 'function' ? resolve(node.id) : [];
    if (!usages || usages.length === 0) {
      return null;
    }
    const blocks = [...new Set(usages.map((u) => u.blockName))];
    const named = blocks.slice(0, 3).map((b) => '"' + b + '"').join(', ') + (blocks.length > 3 ? ' and ' + (blocks.length - 3) + ' more' : '');
    return 'the model\'s block' + (blocks.length > 1 ? 's ' : ' ') + named + (blocks.length > 1 ? ' use' : ' uses') + ' it by name, and would find no '
      + 'variable of that name once it is ' + done + ' here';
  }

  _partHandedAway(model: ModelPackage): boolean {
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
  static ofModel(parsed: WorkspaceOfModel, filename: string, warnings: ParseWarning[] | undefined): ModelWorkspaceNode | null {
    const entries = parsed.zipEntries;
    if (!entries) {
      return null;
    }
    const stream = own(entries, WORKSPACE_STREAM_PART);
    const legacy = own(entries, WORKSPACE_MAT_PART);
    let mat: ParsedMat;
    let read: WorkspaceStreamRead | null = null;
    let part: string | null = null;
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
      } else if (legacy) {
        mat = parseMat(bufferOf(legacy));
        part = WORKSPACE_MAT_PART;
      } else {
        const made = matOfWorkspaceStream(EMPTY_WORKSPACE);
        if (!made.ok) {
          return null;
        }
        mat = parseMat(bufferOf(made.mat));
        read = made.read;
      }
    } catch {
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
function sourceRefusal(model: string, parsed: WorkspaceOfModel): string | null {
  const source = parsed.workspaceSource ?? 'Model File';
  if (source === 'Model File') {
    return null;
  }
  const from =
    source === 'MAT-File'
      ? 'is loaded from the MAT-file ' + (parsed.workspaceDataSource ? '"' + parsed.workspaceDataSource + '" ' : '') + 'each time the model opens'
      : source === 'MATLAB File'
        ? 'is made by running a MATLAB file each time the model opens'
        : source === 'MATLAB Code'
          ? 'is made by running MATLAB code kept in the model each time the model opens'
          : 'is made from its data source, ' + source + ', each time the model opens';
  return 'Cannot edit "' + model + '": its Model Workspace ' + from + ', so an edit of it here would not be kept.';
}

// The classes Simulink does not use from a model workspace (measured on R2027a): a bus of any kind
// as a block's data type, an alias type, an enumeration's definition.
const NOT_USED_FROM_A_MODEL_WORKSPACE: ReadonlySet<string> = new Set([
  'Simulink.Bus',
  'Simulink.ConnectionBus',
  'Simulink.ServiceBus',
  'Simulink.AliasType',
  'Simulink.data.dictionary.EnumTypeDefinition',
]);

const ARGUMENT_CLASSES: ReadonlySet<string> = new Set(['double', 'single', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'embedded.fi', 'Simulink.Parameter']);

function isSignal(node: BaseNode): boolean {
  const cls = String((node as unknown as { className?: string }).className ?? '');
  return cls === 'Simulink.Signal' || cls === 'mpt.Signal';
}

// Whether a model argument's variable may hold `value`: what MATLAB keeps an argument of, a number,
// a fi, an enumeration value, a scalar struct, or a Parameter.
function argumentValueTaken(value: BaseNode): boolean {
  const v = value as unknown as { className?: string; _dims?: number[] };
  const cls = String(v.className ?? '');
  if (ARGUMENT_CLASSES.has(cls) || mcosEnumerationOf(value)) {
    return true;
  }
  return cls === 'struct' && (v._dims ?? [1, 1]).every((d) => d === 1);
}

function argumentWhy(name: string, cls: string): string {
  return '"' + name + '" is an argument of the model, which holds a number, a fi, an enumeration value, a scalar struct or a Simulink.Parameter, and MATLAB drops, with a warning, an argument holding ' + withArticle(cls) + '.';
}

function own(entries: Record<string, Uint8Array>, name: string): Uint8Array | null {
  return Object.prototype.hasOwnProperty.call(entries, name) ? entries[name] : null;
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
