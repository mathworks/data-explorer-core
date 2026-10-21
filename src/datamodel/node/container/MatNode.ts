// Copyright 2026 The MathWorks, Inc.

import ContainerNode from '../ContainerNode.js';
import MatlabVariableNode from '../data/MatlabVariableNode.js';
import { attachMcosDecoded, modelOpaqueMcosVariable } from '../data/mcosTypedNode.js';
import { mcosDecodedFor } from '../data/mcosDecodedTable.js';
import type BaseNode from '../BaseNode.js';
import type { PropClass, PIGroupDef } from '../BaseNode.js';
import type { MatVariable } from '../data/MatlabVariableNode.js';
import type { ParseWarning } from '../../parser/ParseWarning.js';
import { reasonOf } from '../../parser/ParseWarning.js';
import { functionHandleOf } from '../../parser/MatParser.js';
import type { MatRecord, ParsedMat } from '../../parser/MatParser.js';
import PropName from '../../prop/PropName.js';
import { MAT_NODE_CEILING } from '../../display/DisplayConvention.js';
import { buildUnderCeiling, buildUncut, chargeNodes } from '../data/matNodeCeiling.js';
import {
  PAST_SUBSYSTEM,
  duplicateWhy,
  freshRefusal,
  renameWhy,
  structureRefusal,
  subsystemElementOf,
  subsystemOf,
  unsavableRefusal,
  unwritableIn,
} from '../../parser/MatFileWriter.js';
import { MatWriteError } from '../../parser/MatWriter.js';
import { readMcosSubsystem, type McosSubsystem } from '../../parser/McosSubsystemEdit.js';
import { objectEditCells } from '../../parser/McosEditRules.js';
import {
  classRefusal,
  memberRefusal,
  nodePropertyValue,
  objectEditsOf,
  objectNodeAt,
  objectNodesUnder,
  objectStateOf,
  objectSubsystemEdit,
  propertyAt,
  propertyRefusal,
  shownDataType,
  mirrorTwins,
  twinGroupsOf,
  twinMasterRefusal,
  twinsTouching,
  type McosObjectState,
  type McosPlannedCell,
  type McosTwin,
  type McosTwinGroup,
} from '../data/mcosObjectEdit.js';
import { mcosPlaceOf } from '../mcosPlace.js';
import { validateMatlabName } from '../../matlabName.js';
import { owningEntryOf } from '../DataNode.js';
import { basenameOf } from '../../fileKinds.js';

// What MatNode.fromParsed builds a tree from: a parse of this package's (ParsedMat), or a
// host's, whose parse may be an older one's, without the records a save splices.
export type MatParse = Pick<ParsedMat, 'header' | 'variables'> &
  Partial<Pick<ParsedMat, 'warnings' | 'headerBytes' | 'subsystemOffset' | 'records' | 'framed' | 'unframed'>>;

export default class MatNode extends ContainerNode {
  header: string;
  dirty: boolean;
  _anonymousElements: MatVariable[];
  // The file as a save splices it (ParsedMat's fields of the same names): its header's 128
  // bytes, every record in it, the subsystem's offset, and whether the records are the file.
  //
  // `records` is null, and so is `headerBytes`, when this tree was not built from records
  // a save can trust: a host's parse that carries none (an older package's, handed to
  // addMatSourceParsed), one whose records are not byte views, or one whose variables are
  // not each the variable of one record. No save of such a tree is safe, and a writer
  // that finds `records` null refuses it, rather than building one out of the variables
  // alone, which loses every record the reader did not read.
  headerBytes: Uint8Array | null;
  records: MatRecord[] | null;
  subsystemOffset: number;
  framed: boolean;
  unframed: { at: number; reason: string } | null;
  // Which node each record became, and the other way round (nodeOf, recordOf). A node is
  // the same object for as long as it is in the tree: an edit changes it in place, a
  // delete takes it out (its `parent` is then no longer this), and its undo puts the same
  // node back. So a record's node, in the tree or not, is what became of the record.
  _recordNodes: Map<MatRecord, BaseNode>;
  _nodeRecords: Map<BaseNode, MatRecord>;
  // What the gate of the editor (_editRefusal) has found: the refusal of the file as a whole
  // (undefined until asked) and the subsystem's record, which no edit changes; what a save would
  // refuse of each variable's value written fresh, kept until an edit of that variable
  // (_nodeEdited) or its leaving or joining the file (addChild, removeChild); and how many
  // variables hold each name, moved with every variable added, removed or renamed, as of
  // `_entriesVersion` (_namespaceHolds).
  _fileVerdict: string | null | undefined;
  _subsystem: MatRecord | null | undefined;
  _valueVerdicts: WeakMap<BaseNode, string | null>;
  _nameCounts: Map<string, number> | null;
  _countedAt: number;
  // Moved by every change to which variables this file holds and what they are called, as a
  // dictionary's section's is (SectionNode._entriesVersion): BaseNode._replaceWith moves it too,
  // so that a slot that changes hands has its names counted again.
  _entriesVersion: number;
  // The subsystem as a save swaps cells in it (_mcosSubsystem), read once, or why it cannot be;
  // and what the editor found of each object's node the first time it asked (_objectState), kept
  // for as long as the node is: what the file holds of the object never changes, and what the
  // node held then is what an edit is told from.
  _objects: { record: MatRecord; subsystem: McosSubsystem } | string | undefined;
  _objectStates: WeakMap<BaseNode, McosObjectState | string>;
  // The nodes of each object two or more nodes of the file are (_twinGroups), found once.
  _twins: McosTwinGroup[] | undefined;

  constructor(name: string) {
    super(name, null);
    this.header = '';
    this.dirty = false;
    this._valueVerdicts = new WeakMap();
    this._nameCounts = null;
    this._countedAt = -1;
    this._entriesVersion = 0;
    this._objectStates = new WeakMap();
    this._anonymousElements = [];
    this.headerBytes = null;
    this.records = null;
    this.subsystemOffset = 0;
    this.framed = false;
    this.unframed = null;
    this._recordNodes = new Map();
    this._nodeRecords = new Map();
  }

  /**
   * The record `node` was read from, or null for a node no record became: a variable added
   * since the file was read, or any node of a tree with no records (`records` null).
   */
  recordOf(node: BaseNode): MatRecord | null {
    return this._nodeRecords.get(node) ?? null;
  }

  /**
   * The node `record` became, whether or not it is still in the tree (a deleted one's
   * `parent` is not this), or null for a record that became no node: the subsystem or
   * another unnamed element (`_anonymousElements`), and a record the reader dropped.
   */
  nodeOf(record: MatRecord): BaseNode | null {
    return this._recordNodes.get(record) ?? null;
  }

  get displayName(): string {
    return this.name;
  }

  // Saved by serializeSource (MatFileWriter), so a file is read-only only when no save of it
  // can be written: opened without its records, its bytes handed away since, its records not
  // tiling it, or its subsystem not where its header says (_fileRefusal).
  get readOnly(): boolean {
    return this._fileRefusal() !== null;
  }

  // An edit of `node`, which is a variable of this file or a node under one (BaseNode.
  // _markSourceDirty): what the gate found of that variable's value is forgotten, and of no other,
  // since nothing a save refuses of a value written fresh is about another variable
  // (freshRefusal). Which names two of them share is counted apart (_namespaceHolds). Forgetting
  // every variable's at every edit re-walked every variable a table showed after each, and each
  // of N renames counted N names again.
  //
  // But for an object other nodes of the file are too (_twinGroups: `r = h`), whose edit is one of
  // every variable holding it, which MATLAB loads it in, whether or not it was copied into their
  // nodes (_mirrorTwins, which marks each of them edited, and so comes here for each, where the
  // session made the edit): what was found of each of those variables is forgotten as well. A
  // variable holding an object is refused written fresh whatever the object's properties
  // (freshRefusal), so nothing found of it changes; it is forgotten all the same, so that nothing
  // kept of a variable is older than the last edit of what MATLAB loads of it.
  _nodeEdited(node: BaseNode): void {
    const entry = owningEntryOf(node);
    if (entry && entry.parent === this) {
      this._valueVerdicts.delete(entry);
    }
    for (const group of twinsTouching(this._twins ?? [], node)) {
      for (const m of group.members) {
        const twin = this._entryOf(m.node);
        if (twin) {
          this._valueVerdicts.delete(twin);
        }
      }
    }
  }

  addChild(child: BaseNode, index?: number): BaseNode {
    super.addChild(child, index);
    this._valueVerdicts.delete(child);
    this._entriesMoved(null, child.name);
    return child;
  }

  removeChild(child: BaseNode): void {
    const before = this.children.length;
    super.removeChild(child);
    if (this.children.length < before) {
      this._valueVerdicts.delete(child);
      this._entriesMoved(child.name, null);
    }
  }

  // One of my variables renamed (DataNode.setProperty): its name's count moves with it.
  _entryRenamed(oldName: string, newName: string): void {
    this._entriesMoved(oldName, newName);
  }

  // A variable of this file stopped being called `gone`, and one started being called `came`
  // (either null): one removed, added or renamed. The version moves, and the counts, when they
  // are of the version before, move with it and go on holding.
  _entriesMoved(gone: string | null, came: string | null): void {
    const held = this._nameCounts !== null && this._countedAt === this._entriesVersion;
    this._entriesVersion++;
    if (!held) {
      return;
    }
    const counts = this._nameCounts!;
    if (gone !== null) {
      const left = (counts.get(gone) ?? 0) - 1;
      if (left > 0) {
        counts.set(gone, left);
      } else {
        counts.delete(gone);
      }
    }
    if (came !== null) {
      counts.set(came, (counts.get(came) ?? 0) + 1);
    }
    this._countedAt = this._entriesVersion;
  }

  // ---- The edits a save of this file can write ----------------------------------------------
  //
  // The editor takes no edit a save of this file would then refuse (MatFileWriter), so that none
  // is made that cannot be kept: the baseline is that no edit taken is one a save then refuses,
  // or writes as something else. One rule, this one, asked by every path an edit takes
  // (BaseNode.sourceEditRefusal): the editors of the table and of the Property Inspector
  // (BaseNode.getPropInfo, nameEditable, valueEditable, descriptionEditable), the gates of a
  // child added or removed (DataNode._encodedReadOnly), each class's setter
  // (DataNode._refuseEncodedEdit, DataNode's rename), and the session's editProperty. Built of the
  // writer's own refusals (unsavableRefusal, structureRefusal, freshRefusal, PAST_SUBSYSTEM,
  // duplicateWhy), so that the two cannot come to disagree.

  /**
   * Why an edit of `key` at `node`, which is `entry` or a node under it, is refused, as a
   * message naming the variable or the file, or null where a save of this file writes it.
   * `key` is 'Name' for `node`'s own name, and a property's key for anything else: 'Value'
   * for a value typed in, a child added or removed, and an element's or a field's edit.
   *
   *   - every edit, of a file no save of which can be written (_fileRefusal), its variables'
   *     delete and the addition of one included (execRemoveEntry, execAddEntry);
   *   - every edit of a variable stored after the subsystem, its name included: MATLAB does
   *     not read it there, and moved, what MATLAB loads would change. It can be deleted;
   *   - a variable's own name: taken, and written as its record with the name replaced;
   *   - a property of an MCOS object, at the top of the file, in a struct field or a cell, or an
   *     element of an object array (anything at or under its node, mcosObjectEdit.objectNodeAt),
   *     which a save writes into the subsystem cell that holds it and leaves the variable's
   *     record as it was: taken where the rules for the object take it whatever its value
   *     (_objectKeyRefusal; _editValueRefusal judges the value);
   *   - anything else, which writes the variable fresh: refused where the writer refuses that
   *     (freshRefusal: an object's typed node, a string, a function handle, a value not
   *     decoded, and a variable holding one at any depth), or where another variable of the
   *     file has its name;
   *   - and Add ('Add', MatlabVariableNode.canAddChild) on a struct that is not 1x1 or is an
   *     element of one, which is written, but not as the tree shows it. Add gives a struct a
   *     field row of its own: the rows of a struct array are its elements, so the row was an
   *     element of no fields the save did not write; a 0x0 struct's field was written with no
   *     element to hold it, which reads back as no field; and a field added to one element of
   *     a struct array is written into every element, as MATLAB adds one, `[]` in the others,
   *     which the tree did not show.
   */
  _editRefusal(entry: BaseNode, node: BaseNode, key: string): string | null {
    const file = this._fileRefusal();
    if (file) {
      return file;
    }
    const record = this.recordOf(entry);
    const subsystem = this._subsystemRecord();
    if (record && subsystem && record.offset > subsystem.offset) {
      return cannotEdit(entry.name, PAST_SUBSYSTEM);
    }
    if (node === entry && (key === 'Name' || key === 'name')) {
      return null;
    }
    const object = objectNodeAt(entry, node);
    if (object) {
      return this._objectKeyRefusal(entry, object, node, key);
    }
    let verdict = this._valueVerdicts.get(entry);
    if (verdict === undefined) {
      const refused = freshRefusal(entry, record);
      verdict = refused ? editRefusalOf(refused) : null;
      this._valueVerdicts.set(entry, verdict);
    }
    if (!verdict && this._namespaceHolds(entry.name) > 1) {
      verdict = cannotEdit(entry.name, duplicateWhy(entry.name));
    }
    if (!verdict && key === 'Add') {
      const array = [node, node.parent].find((n) => isStruct(n) && n._dims.reduce((a, b) => a * b, 1) !== 1) as MatlabVariableNode | undefined;
      if (array) {
        return cannotEdit(
          entry.name,
          array.matlabPath + ' is a ' + array._dims.join('x') + ' struct, whose fields a save writes into every element of it or none, '
            + 'and Add gives one struct a field of its own',
        );
      }
    }
    return verdict;
  }

  /**
   * Why an edit of `key` at `node`, at or under `object`, the node of an MCOS object in `entry`, is
   * refused whatever its value, or null where the value decides (_editValueRefusal): the edit of a
   * variable one of two of one name (duplicateWhy), of a part of the object that is no property a
   * save writes (mcosObjectEdit.propertyAt), of a file whose objects a save cannot read, of an
   * object it cannot find in them, and of a property the rules refuse (propertyRefusal). The
   * object's state is what this asks first, and is made then (_objectState).
   */
  _objectKeyRefusal(entry: BaseNode, object: BaseNode, node: BaseNode, key: string): string | null {
    if (this._namespaceHolds(entry.name) > 1) {
      return cannotEdit(entry.name, duplicateWhy(entry.name));
    }
    const state = this._objectState(object);
    if (typeof state === 'string') {
      return cannotEdit(entry.name, state);
    }
    const at = propertyAt(object, node, key);
    const refused = classRefusal(state, object) ?? ('why' in at ? at.why : propertyRefusal(state, object, at.property)) ?? this._twinRefusal(object);
    return refused ? cannotEdit(entry.name, refused) : null;
  }

  /**
   * Why no edit of the object at `object` is taken for the other nodes that are the same object
   * (_twinGroups), each of which an edit is copied into (_mirrorTwins), as a clause, or null: an
   * edit of the object was made through another of them, its master, through which every later one
   * is made; or one of them is in a variable no edit of which a save writes, stored after the
   * subsystem, or one of two of one name.
   */
  _twinRefusal(object: BaseNode): string | null {
    const group = this._twinGroupOf(object);
    if (!group) {
      return null;
    }
    const mastered = twinMasterRefusal(group, object, (n) => this._entryOf(n) !== null);
    if (mastered) {
      return mastered;
    }
    const subsystem = this._subsystemRecord();
    for (const { node } of group.members) {
      const entry = this._entryOf(node);
      if (node === object || !entry) {
        continue;
      }
      const record = this.recordOf(entry);
      const why = record && subsystem && record.offset > subsystem.offset
        ? 'the variable ' + entry.name + ' holds it too, and ' + PAST_SUBSYSTEM
        : this._namespaceHolds(entry.name) > 1
          ? 'the variable ' + entry.name + ' holds it too, and ' + duplicateWhy(entry.name)
          : null;
      if (why) {
        return object.matlabPath + ' is one object with ' + node.matlabPath + ' (one handle), and ' + why;
      }
    }
    return null;
  }

  /**
   * The nodes of each object two or more nodes of this file are, two variables holding one handle
   * (`r = h`) or a struct holding it in two fields, of a class whose properties a save writes; found
   * once, the first time an editor asks, which is before any edit of one: each node's state is made
   * then (_objectState), and what it shows of the object (mcosObjectEdit.twinOf). A node a variable's
   * delete takes out of the tree is still in its group, and is passed over while it is out
   * (_attachedTwins).
   */
  _twinGroups(): McosTwinGroup[] {
    if (this._twins === undefined) {
      this._twins = twinGroupsOf(objectNodesUnder(this), (n) => this._objectState(n));
    }
    return this._twins;
  }

  /** The group of the nodes that are the object `object` is, or null where no other node is it. */
  _twinGroupOf(object: BaseNode): McosTwinGroup | null {
    if (!mcosPlaceOf(object)) {
      return null;
    }
    return this._twinGroups().find((g) => g.members.some((m) => m.node === object)) ?? null;
  }

  /** The members of `group` in the tree now, or none where fewer than two are. */
  _attachedTwins(group: McosTwinGroup): McosTwin[] {
    const attached = group.members.filter((m) => this._entryOf(m.node) !== null);
    return attached.length > 1 ? attached : [];
  }

  /**
   * The nodes an edit at or under `root` is copied into (_mirrorTwins) that are not at or under it:
   * the other nodes of every object at or above or under `root`, for the session to keep its index of
   * them as it keeps the index of `root` (DataModel.mutateSubtree).
   */
  _twinsOutside(root: BaseNode): BaseNode[] {
    const out: BaseNode[] = [];
    for (const group of this._twinsTouching(root)) {
      for (const { node } of this._attachedTwins(group)) {
        if (!isAtOrUnder(node, root)) {
          out.push(node);
        }
      }
    }
    return out;
  }

  /**
   * After an edit at or under `root`, made by any path: every other node of an object it reached
   * shows the object as the edit left it (mcosObjectEdit.mirrorTwins), and is edited so. Answers the
   * nodes copied into. Asked by the session after every edit it makes or wraps (DataModel.mutateSubtree,
   * addChildTo, deleteNodeById, and the undo and redo of each).
   */
  _mirrorTwins(root: BaseNode): BaseNode[] {
    const copied: BaseNode[] = [];
    for (const group of this._twinsTouching(root)) {
      const members = this._attachedTwins(group);
      if (members.length > 1) {
        copied.push(...mirrorTwins(group, members));
      }
    }
    return copied;
  }

  // The groups with a node at or under `root`, or one `root` is at or under: the objects an edit
  // there can reach. None before an editor asked about any object of the file (_twinGroups), which
  // every edit of one does first: no group is made for an edit that reached none.
  _twinsTouching(root: BaseNode): McosTwinGroup[] {
    if (this._twins === undefined && !objectNodeAt(this._entryOf(root) ?? root, root) && objectNodesUnder(root).length === 0) {
      return [];
    }
    return twinsTouching(this._twinGroups(), root);
  }

  // The variable `node` is in, `node` itself for one, or null for a node not in this file's tree.
  _entryOf(node: BaseNode): BaseNode | null {
    let n: BaseNode = node;
    while (n.parent && n.parent !== this) {
      n = n.parent;
    }
    return n.parent === this && this.children.includes(n) ? n : null;
  }

  /**
   * Why `value`, what an edit of `key` at `node` (of `entry`) is about to make the property hold,
   * as the node would hold it (a bound as a number or undefined, text as a string, a Value as the
   * value node the edit makes), cannot be written into this file, or null where it can, or where
   * `node` is no object's. Judged with the object's other edits as the save will judge them
   * (McosEditRules.objectEditCells): a Min above its Max, a Value out of its DataType's range.
   * Asked by the setters before they set it (BaseNode.sourceValueRefusal), so that the edit is not
   * taken, rather than taken and then refused by the save.
   */
  _editValueRefusal(entry: BaseNode, node: BaseNode, key: string, value: unknown): string | null {
    const object = objectNodeAt(entry, node);
    if (!object) {
      return null;
    }
    const keyRefused = this._objectKeyRefusal(entry, object, node, key);
    if (keyRefused) {
      return keyRefused;
    }
    const state = this._objectState(object) as McosObjectState;
    const at = propertyAt(object, node, key) as { property: string };
    // A struct row of a Value takes a row added or removed, and an edit of each of its fields: a
    // value typed over it whole is text no setter makes a value of.
    if (at.property === 'Value' && typeof value === 'string' && node !== object && (node as unknown as { className?: string }).className === 'struct') {
      return cannotEdit(entry.name, node.matlabPath + ' is a struct, which takes an edit of each of its fields, and not a value typed over it whole');
    }
    const pending = nodePropertyValue(object, at.property, { value });
    if (typeof pending === 'string') {
      return cannotEdit(entry.name, object.matlabPath + '.' + at.property + ' ' + pending);
    }
    const found = objectEditsOf(state, object, { property: at.property, value: pending });
    if ('why' in found) {
      return cannotEdit(entry.name, found.why);
    }
    const ruled = objectEditCells(state.held, found.edits, object.matlabPath);
    return ruled.ok ? null : cannotEdit(entry.name, ruled.message);
  }

  /**
   * What `key` of `node`, of `entry`, follows to once its edits are saved, for the node to show
   * (BaseNode.sourceFollowedProperty), or undefined: the DataType of a Simulink.Parameter's node, as
   * the save writes it with an edit of the Value (mcosObjectEdit.shownDataType). Nothing else, and
   * nothing for a node that is no object's, or one whose object a save cannot find.
   */
  _followedProperty(entry: BaseNode, node: BaseNode, key: string): unknown {
    if (key !== 'DataType' || objectNodeAt(entry, node) !== node) {
      return undefined;
    }
    const state = this._objectState(node);
    return typeof state === 'string' ? undefined : shownDataType(state, node) ?? undefined;
  }

  /**
   * The subsystem of this file as a save swaps cells in it: its record, and its element read whole
   * (McosSubsystemEdit.readMcosSubsystem); or why no object's edit can be written, read once.
   */
  _mcosSubsystem(): { record: MatRecord; subsystem: McosSubsystem } | string {
    if (this._objects === undefined) {
      const record = this._subsystemRecord();
      const element = record ? subsystemElementOf(record) : null;
      const read = element ? readMcosSubsystem(element) : null;
      this._objects = !record
        ? 'the file holds no objects for a save to write an edit into'
        : !read
          ? "the file's objects are not held in one whole element a save can rewrite"
          : read.ok
            ? { record, subsystem: read.subsystem }
            : "the file's objects could not be read as a save rewrites them (" + read.message + ')';
    }
    return this._objects;
  }

  /**
   * What the file holds of the object at `object`, and what its node held the first time this was
   * asked (mcosObjectEdit.objectStateOf), or why no edit of it can be written; made once a node,
   * the first time the editor asks about the object, which every edit of it does before it is
   * made, and kept.
   */
  _objectState(object: BaseNode): McosObjectState | string {
    let state = this._objectStates.get(object);
    if (state === undefined) {
      const objects = this._mcosSubsystem();
      state = typeof objects === 'string' ? objects : objectStateOf(objects.subsystem, object);
      this._objectStates.set(object, state);
    }
    return state;
  }

  /**
   * For the save (MatFileWriter): the subsystem's record and its element with every edit of an
   * object under `entries` written into its cells, and the cells written; or null where none of
   * them holds one. `entries` are the variables whose edits reached objects only, whose records are
   * written as they were. Throws MatWriteError for an edit it cannot write
   * (mcosObjectEdit.objectSubsystemEdit).
   */
  _objectSubsystemEdit(entries: readonly BaseNode[]): { record: MatRecord; element: Uint8Array; cells: McosPlannedCell[] } | null {
    const entryOf = new Map<BaseNode, string>();
    for (const entry of entries) {
      for (const object of objectNodesUnder(entry)) {
        if ((object as unknown as { _objectEdited?: boolean })._objectEdited) {
          entryOf.set(object, entry.name);
        }
      }
    }
    if (entryOf.size === 0) {
      return null;
    }
    const objects = this._mcosSubsystem();
    if (typeof objects === 'string') {
      const [name] = entryOf.values();
      throw new MatWriteError('Cannot write "' + name + '": ' + objects + '. Nothing was written.');
    }
    const written = objectSubsystemEdit(objects.subsystem, [...entryOf.keys()], (n) => this._objectState(n), (n) => entryOf.get(n)!);
    return written && { record: objects.record, ...written };
  }

  /**
   * Why `value`, a node built of the text an edit typed in for `node`, of `entry`, cannot be
   * written into this file, or null where it can: a string, which MatWriter has no MAT class
   * for. Asked of the edit before it is made (MatlabVariableNode.setProperty), so that a value
   * that would leave the variable one a save refuses (freshRefusal) is never taken. A value typed
   * as a Simulink.Parameter's whole Value, on its Value row, is the object's, and judged as one
   * (_editValueRefusal); one typed into a field of its struct Value, as what such a field may hold
   * (mcosObjectEdit.memberRefusal).
   */
  _valueRefusal(entry: BaseNode, node: BaseNode, value: BaseNode): string | null {
    const object = objectNodeAt(entry, node);
    if (object && (object as unknown as { _valueNode?: BaseNode | null })._valueNode === node) {
      return this._editValueRefusal(entry, node, 'Value', value);
    }
    if (object) {
      const refused = memberRefusal(object, node, value);
      if (refused) {
        return cannotEdit(entry.name, refused);
      }
    }
    const unwritable = unwritableIn(value);
    if (!unwritable) {
      return null;
    }
    const is = unwritable.path === value.matlabPath ? ' would be ' : ' would hold ';
    return cannotEdit(entry.name, (node.matlabPath || entry.name) + is + unwritable.what + ', which this package cannot write into a MAT-file');
  }

  /**
   * Why `node`, a variable of this file, cannot be renamed, or null where it can: its record is not
   * one whole element whose name a save can replace (MatFileWriter.renameWhy), which only a damaged
   * file holds. Asked by the rename itself (DataNode.setProperty) and not by the editability
   * getters, as finding out inflates the record: a rename refused so is refused before it is made.
   */
  _renameRefusal(node: BaseNode): string | null {
    const record = this.recordOf(node);
    const why = record ? renameWhy(record) : null;
    return why ? cannotEdit(node.name, why) : null;
  }

  /** Why no edit of this file is taken, or null (unsavableRefusal, structureRefusal). */
  _fileRefusal(): string | null {
    // A host that hands the bytes away empties every view of them at once, the header's
    // first, so a verdict of none is asked again only once that happened.
    const gone = this.headerBytes !== null && this.headerBytes.byteLength !== 128;
    if (this._fileVerdict === undefined || (gone && this._fileVerdict === null)) {
      const refused = unsavableRefusal(this) ?? structureRefusal(this, this.records!, this._subsystemRecord());
      this._fileVerdict = refused ? editRefusalOf(refused) : null;
    }
    return this._fileVerdict;
  }

  /** The subsystem's record (MatFileWriter.subsystemOf), found once: the records never change. */
  _subsystemRecord(): MatRecord | null {
    if (this._subsystem === undefined) {
      this._subsystem = this.records ? subsystemOf(this, this.records) : null;
    }
    return this._subsystem;
  }

  /**
   * How many variables of the file a save writes under `name`: the variables in the tree, and
   * each record that became none (one the reader dropped) under its own name, as a save writes
   * it (MatFileWriter.refuseDuplicates). A rename into a name another holds is refused for it
   * (DataNode.setProperty), naming this file (_namespaceLabel).
   *
   * Counted when first asked, and moved with every variable added, removed or renamed after
   * (_entriesMoved), so that a rename costs a lookup and not a count of every name: as a
   * dictionary's are (SectionNode._namespaceHolds, F1-23).
   *
   * A record the reader dropped without a name, one that does not inflate or holds no matrix,
   * is counted under none: what it would be called is not known, so an added or renamed
   * variable is not held to it (MatFileWriter.refuseDuplicates, likewise). Every such record
   * already breaks a rule MATLAB loads a file by (MatFileCheck: `compressed-wrapper`,
   * `top-level-type`), and for all of them but one past the inflate ceiling that is a rule
   * MATLAB fails the whole load on: no variable of the file is loaded beside it, whatever its name.
   */
  _namespaceHolds(name: string): number {
    if (!this._nameCounts || this._countedAt !== this._entriesVersion) {
      const counts = new Map<string, number>();
      const add = (n: string) => counts.set(n, (counts.get(n) ?? 0) + 1);
      for (const child of this.children) {
        add(child.name);
      }
      for (const record of this.records ?? []) {
        if (record.name && !this.nodeOf(record)) {
          add(record.name);
        }
      }
      this._nameCounts = counts;
      this._countedAt = this._entriesVersion;
    }
    return this._nameCounts.get(name) ?? 0;
  }

  /** Where a rename into a name already held is said to collide (DataNode.setProperty): this file. */
  get _namespaceLabel(): string {
    return basenameOf(this.name) || this.name;
  }

  // The format an out-of-process host is told this source is, since SourceDTO carries
  // this field and nothing else in the projection names the format. One value, unlike
  // ModelNode's three: a MAT-file has on-disk levels (4, 5, 7, 7.3) but only one of them
  // ever reaches this class — MatParser reads the Level-5 framing that `-v7` also uses,
  // and refuses `-v7.3` with a throw because it is HDF5, so no MatNode exists for one.
  // A level would therefore describe the reader's single supported case rather than
  // distinguish anything a consumer could act on. `header` keeps the file's own claim
  // for anyone who wants the detail. A getter, as ProjectNode's is: this cannot change
  // once the file is read.
  get sourceFormat(): string {
    return 'mat';
  }

  get icon(): string {
    return 'matlabWorkspaceFile';
  }

  get NumberOfEntries(): number {
    return this.children.length;
  }

  getProperties(): PropClass[] {
    return [PropName];
  }

  getPILayout(): PIGroupDef[] {
    return [{ group: 'General', items: [PropName] }];
  }

  getSection(): null {
    return null;
  }

  // A new variable is the double 0, named `entryName`, or `var` with a counter appended if that
  // is taken. The only class it takes is a plain variable's: a save writes no object (freshRefusal).
  // Null, adding nothing, for a file no save of which can be written (_fileRefusal), for any other
  // class, and for a name that is no MATLAB name or one the file holds already, by the rule a rename
  // is held to: a save would refuse each.
  execAddEntry(className?: string, entryName?: string): { node: BaseNode; undo: () => void; redo: () => void } | null {
    if (this._fileRefusal() || (className && !PLAIN_VARIABLE_CLASSES.has(className))) {
      return null;
    }
    if (entryName && (validateMatlabName(entryName) || this._namespaceHolds(entryName) > 0)) {
      return null;
    }
    const name = entryName || this._uniqueName('var');
    const node = MatlabVariableNode.createDefault(name, this);
    this.addChild(node);
    this.dirty = true;
    return {
      node,
      undo: () => {
        this.removeChild(node);
        this.dirty = true;
      },
      redo: () => {
        this.addChild(node);
        this.dirty = true;
      },
    };
  }

  // Not a name any variable of the file holds, a record the reader dropped included (_namespaceHolds).
  _uniqueName(baseName: string): string {
    if (this._namespaceHolds(baseName) === 0) {
      return baseName;
    }
    let i = 1;
    while (this._namespaceHolds(baseName + i) > 0) {
      i++;
    }
    return baseName + i;
  }

  // A delete is written by any save, of any variable, one stored after the subsystem and an object
  // included; refused only in a file no save of which can be written (_fileRefusal).
  execRemoveEntry(node: BaseNode): { undo: () => void; redo: () => void } | null {
    const index = this.children.indexOf(node);
    if (index < 0 || this._fileRefusal()) {
      return null;
    }
    this.removeChild(node);
    this.dirty = true;
    return {
      undo: () => {
        this.addChild(node, index);
        this.dirty = true;
      },
      redo: () => {
        this.removeChild(node);
        this.dirty = true;
      },
    };
  }

  getVariables(): MatVariable[] {
    const variables: MatVariable[] = [];
    for (const child of this.children) {
      // Typed Simulink nodes (ParameterNode, SignalNode) have no `_var` — they
      // come from the read-only MCOS path and are never serialized back.
      const v = (child as unknown as { _var?: MatVariable })._var;
      if (v) {
        variables.push(v);
      }
    }
    for (const anon of this._anonymousElements) {
      variables.push(anon);
    }
    return variables;
  }

  // `warnings` is optional in the parameter type rather than required because a host
  // that hands over an older parse has none — the same reason addMatSourceParsed reads
  // `result.warnings` defensively. When it IS there it is the array addMatSource passes
  // to registerSource after this returns, so a degrade appended during construction
  // reaches the source node.
  //
  // The tree is built under the file's node ceiling (matNodeCeiling; DisplayConvention's
  // MAT_NODE_CEILING unless `options.nodeCeiling` says otherwise, which tests do): every
  // variable is listed and counted, each container under one is built with all its rows or
  // none, depth first, so the first values in the file are the whole ones, and an MCOS
  // object's typed node is built whole and counted (buildUncut). One warning says how many
  // containers have no rows and names the first ('part-not-expanded'). A parse handed over with
  // no warnings array (an older host's) is given one for it, which is the array addMatSource
  // and addMatSourceParsed pass on: both read it after this returns.
  //
  // Each node built of a record is bound to it (recordOf, nodeOf), whatever node it is: a
  // plain variable, an MCOS object's typed node, a function handle, one shown as not
  // decoded. A parse with no records, or whose records do not cover its variables one for
  // one, binds none and keeps none (`records` null).
  static fromParsed(parsed: MatParse, filename: string, options: { nodeCeiling?: number } = {}): MatNode {
    const node = new MatNode(filename);
    node.header = parsed.header;
    const records = heldRecords(parsed);

    // A .mat file keeps the MCOS blob in an anonymous trailing element. Every opaque in
    // the file, nested or not, comes back carrying its own decode, and what the decoder
    // could not read of one is a warning on the file.
    const anonElement = parsed.variables.find((v) => v._anonymous);
    attachMcosDecoded(anonElement?._rawBytes, parsed.variables, parsed.warnings);

    const ceiling = options.nodeCeiling ?? MAT_NODE_CEILING;
    const recordOf = records ? new Map(records.filter((r) => r.variable).map((r) => [r.variable!, r])) : null;
    const { cut, firstCut } = buildUnderCeiling<void, MatlabVariableNode>(ceiling, () =>
      MatNode._addVariables(node, parsed, recordOf),
    );
    if (cut > 0 && firstCut) {
      const warnings = parsed.warnings ?? (parsed.warnings = []);
      warnings.push(notExpandedWarning(firstCut.matlabPath, cut, ceiling));
    }
    if (records && bindsEveryRecord(node, records, parsed.variables)) {
      node.headerBytes = parsed.headerBytes!;
      node.records = records;
      node.subsystemOffset = parsed.subsystemOffset ?? 0;
      node.framed = parsed.framed === true;
      node.unframed = parsed.unframed ?? null;
    } else {
      node._recordNodes.clear();
      node._nodeRecords.clear();
    }
    return node;
  }

  _bindRecord(child: BaseNode, record: MatRecord | undefined): void {
    if (record) {
      this._recordNodes.set(record, child);
      this._nodeRecords.set(child, record);
    }
  }

  // Every variable as a row of `node`, in the file's order, under the ceiling fromParsed arms:
  // all of them counted first, and none refused (matNodeCeiling.chargeNodes), so that the rows
  // under them are what is left, and a tree is never more nodes than the ceiling or the
  // variables, whichever is more.
  //
  // `recordOf` is each variable's record, by identity (MatRecord.variable), and every node
  // made of a variable is bound to it here, the one place all four kinds are made.
  static _addVariables(
    node: MatNode,
    parsed: { variables: MatVariable[]; warnings?: ParseWarning[] },
    recordOf: ReadonlyMap<MatVariable, MatRecord> | null = null,
  ): void {
    chargeNodes(parsed.variables.filter((v) => !v._anonymous).length);
    for (const variable of parsed.variables) {
      if ((variable as unknown as { _anonymous?: boolean })._anonymous) {
        node._anonymousElements.push(variable);
        continue;
      }
      const record = recordOf?.get(variable);
      const add = (child: BaseNode) => {
        node.addChild(child);
        node._bindRecord(child, record);
      };
      if (variable.isOpaque) {
        const mcosNode = buildUncut(() => modelOpaqueMcosVariable(variable, mcosDecodedFor(variable), node, parsed.warnings));
        if (mcosNode) {
          add(mcosNode);
          continue;
        }
      }
      // A function handle, as MatParser read it (functionHandleOf), is the node a text
      // dictionary's is, `{_type: 'function_handle', _value: 'sin'}`: `@sin`, class
      // function_handle, no editor. It showed `null`, editable, class `unknown`, as the
      // numeric scalar its unmodelled class made it; an empty one `[ ]` of class `unknown`.
      const handle = functionHandleOf(variable);
      if (handle) {
        const value = handle.text === null ? 'Matrix(' + variable.dimensions.join(',') + ')' : handle.text;
        add(MatlabVariableNode.parse({ _type: 'function_handle', _value: value }, variable.name, node));
        continue;
      }
      add(variableNodeOf(variable, node, parsed.warnings));
    }
  }
}

// The classes a variable added to a file may be asked for as (execAddEntry): none, the one a
// dictionary's plain variable is added as, and a double's.
const PLAIN_VARIABLE_CLASSES = new Set(['MatlabVariable', 'double']);

// A refusal of the writer's, `Cannot save "f.mat": …. Nothing was written.`, as the editor says
// it of an edit it does not take: `Cannot edit "f.mat": ….`
function editRefusalOf(e: MatWriteError): string {
  return e.message.replace(/^Cannot (?:save|write) /, 'Cannot edit ').replace(/ Nothing was written\.$/, '');
}

function isStruct(node: BaseNode | null): node is MatlabVariableNode {
  return node instanceof MatlabVariableNode && node._kind === 'scalar' && node._scalarType === 'struct';
}

// Whether `node` is `root` or under it.
function isAtOrUnder(node: BaseNode, root: BaseNode): boolean {
  for (let n: BaseNode | null = node; n; n = n.parent) {
    if (n === root) {
      return true;
    }
  }
  return false;
}

function cannotEdit(name: string, why: string): string {
  return 'Cannot edit "' + name + '": ' + why + '.';
}

// The records of `parsed` a save can splice, or null: none for a host's parse that carries
// none, and none for one whose header or records are not byte views as long as they say,
// which no reader of this package hands over. Views are told by ArrayBuffer.isView, which
// answers for one made in another realm (a worker's, structured-cloned here) as well.
function heldRecords(parsed: MatParse): MatRecord[] | null {
  const { headerBytes, records } = parsed;
  if (!Array.isArray(records) || !ArrayBuffer.isView(headerBytes) || headerBytes.byteLength !== 128) {
    return null;
  }
  const whole = records.every((r) => r && ArrayBuffer.isView(r.bytes) && r.bytes.byteLength === r.length);
  return whole ? records : null;
}

// Whether the tree `node` was built as is bound one for one: every variable the variable of
// exactly one record, and every node bound to the record of the variable it was made of (an
// unnamed element is made into no node, and is in `_anonymousElements`). A parse whose
// records were made apart from its variables, or whose variables a host changed since,
// binds short, and its records are not this tree's to splice.
function bindsEveryRecord(node: MatNode, records: MatRecord[], variables: MatVariable[]): boolean {
  const withVariable = records.filter((r) => r.variable);
  const ofRecords = new Set(withVariable.map((r) => r.variable));
  return (
    ofRecords.size === withVariable.length &&
    ofRecords.size === variables.length &&
    variables.every((v) => ofRecords.has(v)) &&
    node._nodeRecords.size === node.children.length
  );
}

// The file's one word about its node ceiling, which is not a loss, as `duplicate-id` is not
// (ParseWarning): every value in it is read, and copied whole. `part` is the first container
// built without its rows, in the order the tree is built, and the count is of the others.
function notExpandedWarning(part: string, cut: number, ceiling: number): ParseWarning {
  const others = cut - 1;
  const what =
    others === 0
      ? `"${part}" is shown without its contents`
      : `"${part}" and ${withCommas(others)} other ${others === 1 ? 'value' : 'values'} are shown without their contents`;
  const copy = others === 0 ? 'Copying it copies it whole.' : 'Copying one copies it whole.';
  return {
    code: 'part-not-expanded',
    message: `${what}: this file holds more than ${withCommas(ceiling)} values to show. ${copy}`,
    part,
  };
}

function withCommas(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// One variable the node builders cannot make a node of refused the whole file: a complex one
// whose flags word was overwritten with a class the reader does not model (255, say) has no
// value, and the complex arm read `.re` of its null, at the top of the file or inside a cell
// or a struct. The maintainer's ruling of 2026-10-16 (group E, theme 1: warn and show what
// was read, never refuse the file) catches it one variable at a time and shows it as what was
// read of it, its name, class and size, not decoded (MatlabVariableNode.createNotDecoded), as
// ModelSectionNode.addWorkspaceEntry does for a model workspace.
//
// The file says why once. MatParser already names a value of a class it does not model,
// wherever it stands (collectUndecoded: `z`, `c{1}`, `s.a`), and that warning is the one
// loss, so a variable it names, or names a piece of, gets no second one. A variable nothing
// names (a host's parse, say, from a reader that did not report it) gets one here.
function variableNodeOf(variable: MatVariable, parent: MatNode, warnings: ParseWarning[] | undefined): BaseNode {
  try {
    return MatlabVariableNode.parseMatVariable(variable, variable.name, parent);
  } catch (e) {
    const name = variable.name;
    if (warnings && !warnings.some((w) => namesPieceOf(w.part, name))) {
      warnings.push({
        code: 'part-unreadable',
        message: `"${name}" could not be read (${reasonOf(e)}), so it is shown as not decoded.`,
        part: name,
      });
    }
    return MatlabVariableNode.createNotDecoded(variable, name, parent);
  }
}

// Whether a warning's part is the variable `name` or a piece of it, as MatParser names a piece:
// `name.field`, `name(2).field`, `name{3}`.
function namesPieceOf(part: string | undefined, name: string): boolean {
  if (part === undefined || !part.startsWith(name)) {
    return false;
  }
  return part.length === name.length || '.({'.includes(part[name.length]);
}
