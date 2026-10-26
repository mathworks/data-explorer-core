// Copyright 2026 The MathWorks, Inc.

import type BaseNode from '../BaseNode.js';
import type DataNode from '../DataNode.js';
import type { MatVariable } from '../../parser/MatParser.js';
import * as NodeRegistry from '../NodeRegistry.js';
import MatlabVariableNode from './MatlabVariableNode.js';
import StructNode from './StructNode.js';
import { mcosPlaceOf } from '../mcosPlace.js';
import { elementCount } from '../../display/DisplayConvention.js';
import { setOwn } from '../../parser/ownKeys.js';
import { isExactToken, parseComplexNum } from '../../parser/XmlUtils.js';
import { MatWriteError, classPhrase } from '../../parser/MatWriter.js';
import { variableDifference, type McosWrittenCell } from '../../parser/MatFileWriter.js';
import {
  cellValueAt,
  editMcosObjects,
  objectIdOf,
  storedProperties,
  valueCellOf,
  type McosObjectEdits,
  type McosSubsystem,
} from '../../parser/McosSubsystemEdit.js';
import {
  followedDataType,
  hasEditRules,
  objectEditCells,
  propertyEditRefusal,
  propertyValueRefusal,
  savedNameOf,
  valueMemberRefusal,
  type McosHeld,
  type McosObjectHeld,
  type McosPropertyEdit,
} from '../../parser/McosEditRules.js';

// The edits of an MCOS object's properties that a MAT-file's save writes into the subsystem, read
// off the object's typed node: the node a decoded Simulink.Parameter or Simulink.Signal became
// (mcosTypedNode.modelOpaqueMcosVariable), at the top of the file, in a struct field, in a cell, or
// as an element of an object array.
//
// WHICH OBJECT. A node is placed where it was built (mcosPlace.setMcosPlace): its variable,
// whose handle names the object by id, and which element of the handle it is. Two variables that
// hold one handle are two nodes of one object, and their edits are one object's (objectSubsystemEdit).
//
// ONE OBJECT, ONE STATE. Simulink.Parameter and Simulink.Signal are handle classes: after `r = h`
// MATLAB holds one object, and `h.Value = 7` is r's Value too. So the nodes of one object show one
// state (mirrorTwins): the first of them an edit is made at or under is the one every later edit of
// the object is made through (McosTwinGroup.master), and after each, by whatever path, the session
// copies what it holds of each property into the others, which are then edited as well and carry
// the edit to the save, which writes it once. The others take no edit of their own: a copy replaces
// the rows of a Value, and an undo of an edit made at one of those rows would undo nothing. Once
// every node of the object holds what the file holds of it again (its edits undone, say), none is
// its master, and the next edit may be made through any of them. An edit made through a node and
// left on the undo stack under a later edit that brought the object back (7, then 5 typed over it)
// is then one a later copy into that node may have replaced the rows of: undone, it changes nothing,
// and what the node shows is what the save writes.
//
// WHAT CHANGED. Each property a node holds an editor's value of is read off the node as the
// variable a save writes (nodePropertyValue), the converter this package already has for each: a
// Value node's own variable (MatlabVariableNode._var), the one its Parameter would make of a Value
// held bare (NodeRegistry.parseValue), a struct Value's fields each so. It is compared with what
// the object's cell holds (McosSubsystemEdit.cellValueAt): equal, it is not written, which is how an
// undone edit writes nothing; otherwise it is an edit, and the rules (McosEditRules) say which
// cells it writes, or refuse it.
//
// WHAT IS TRUSTED. A property is written only if, as the node held it before any edit, it read back
// as the cell exactly (McosObjectState.exact): otherwise what the node holds of it is not what the
// file holds, and a save that wrote it would change what was not edited, an element of a Value
// beside the one edited, say. That is judged the first time the editor asks about the object,
// which every edit of it does before it is made (MatNode._editRefusal), and kept. The node's other
// properties are held to a fingerprint taken then too (fingerprintOf), so that one this package has
// no rule for, changed by a path that asked no rule, refuses the save rather than being dropped
// from it.

const PARAMETER = 'Simulink.Parameter';
const SIGNAL = 'Simulink.Signal';

/** The properties a node of each class holds an editor's value of, as node fields (nodePropertyValue). */
const NODE_PROPERTIES: Record<string, readonly string[]> = {
  [PARAMETER]: ['Value', 'Min', 'Max', 'Description', 'Unit'],
  [SIGNAL]: ['Min', 'Max', 'Description', 'Unit', 'DataType'],
};

// What each property is when the object holds no value for it, its class default, as MATLAB saves
// none: an edit away from it would have to add a triple to the object's property list.
const DEFAULTS: Record<string, MatVariable> = {
  Value: emptyDouble(),
  Min: emptyDouble(),
  Max: emptyDouble(),
  Description: charOf(''),
  Unit: charOf(''),
  DataType: charOf('auto'),
};

// The fields of a node, and the keys of its property bag, that hold the properties above or follow
// from them (a Parameter's Dimensions and Complexity follow its Value, ParameterNode._followValueShape,
// and so does its DataType in a MAT-file, shownDataType), or are where the node stands: what an edit a
// save writes changes, left out of the fingerprint.
const OWN_FIELDS_WRITTEN = new Set(['name', 'parent', 'children', 'metadata', 'serial', 'status', 'Value', 'Min', 'Max', 'Description', 'Unit']);
const BAG_KEYS_WRITTEN: Record<string, readonly string[]> = {
  [PARAMETER]: ['Value', 'Min', 'Max', 'Description', 'DocUnits', 'Dimensions', 'Complexity'],
  [SIGNAL]: ['Min', 'Max', 'Description', 'DocUnits', 'DataType'],
};

/** What a node's object holds, read once, and what the editor judged of the node before any edit. */
export interface McosObjectState {
  objectId: number;
  held: McosObjectHeld;
  // Saved name to the subsystem cell that holds it.
  cellIndex: ReadonlyMap<string, number>;
  // Per property the node holds an editor's value of, judged when this was made: null where the
  // node's value read back as the cell exactly (or, for one the object holds no value for, as its
  // class default), or why not; and, for one that read back as another value, that value.
  exact: ReadonlyMap<string, string | null>;
  asRead: ReadonlyMap<string, MatVariable>;
  // Whether the node had been edited when this was made, by a path that did not ask the editor
  // first: what it holds then is not known to be what was read.
  late: boolean;
  fingerprint: string;
  // The DataType the node showed when this was made, which is the file's while no edit of the
  // Value changes it (shownDataType).
  dataType: string;
}

/** The class of a typed node, as its Class column shows it. */
function classOf(node: BaseNode): string {
  return String((node as DataNode).className || '');
}

/** The node of an object at or above `node`, up to and including `entry`, or null for none. */
export function objectNodeAt(entry: BaseNode, node: BaseNode): BaseNode | null {
  for (let n: BaseNode | null = node; n; n = n.parent) {
    if (mcosPlaceOf(n)) {
      return n;
    }
    if (n === entry) {
      break;
    }
  }
  return null;
}

/** Every node of an object at or under `node`. */
export function objectNodesUnder(node: BaseNode): BaseNode[] {
  const out: BaseNode[] = [];
  const stack: BaseNode[] = [node];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (mcosPlaceOf(n)) {
      out.push(n);
    }
    for (let i = n.children.length - 1; i >= 0; i--) {
      stack.push(n.children[i]);
    }
  }
  return out;
}

/**
 * The property of the object at `object` an edit of `key` at `node` changes, or why it changes
 * none a save writes, as a clause. A key of the object's own row names the property (the Property
 * Inspector's lowerCamel keys, `dimensions`, as MATLAB's `Dimensions`). An edit of a value at or
 * under a Simulink.Parameter's Value node, an element, a struct field, a row added or removed, a
 * struct's field renamed, is of its Value; another column of such a row (its Data Type, which would
 * cast the Value; a Description, which no value has) is of nothing a save writes, nor is the name
 * of a row that is not a struct's field (the table offers an editor for none of these). The name of
 * the object's row, which is not the entry's, is where it stands in a struct or a cell, which a save
 * writes as it was read.
 *
 * `describe` false is for an editor drawn, which asks only whether there is one: the clause, which
 * names the node and the object, each a walk to the root and a label a step, is then not made, and
 * `why` is REFUSED. Made for every refused cell of a file of nested shared handles, it tripled the
 * time the file took to show.
 */
export function propertyAt(object: BaseNode, node: BaseNode, key: string, describe = true): { property: string } | { why: string } {
  const refused = (why: () => string): { why: string } => ({ why: describe ? why() : REFUSED });
  if (node === object) {
    if (key === 'Name' || key === 'name') {
      return refused(() => object.matlabPath + ' is named by where it stands in ' + rootOf(object).name + ', which a save writes as it was read');
    }
    if (key === 'Add') {
      return refused(() => object.matlabPath + ' takes no row added: a save writes its properties, and none of them is one');
    }
    return { property: key.charAt(0).toUpperCase() + key.slice(1) };
  }
  const valueNode = (object as unknown as { _valueNode?: BaseNode | null })._valueNode;
  for (let n: BaseNode | null = node; n && n !== object; n = n.parent) {
    if (n === valueNode && classOf(object) === PARAMETER) {
      if (key !== 'Value' && key !== 'Add' && key !== 'Name' && key !== 'name') {
        return refused(() => node.matlabPath + "'s " + key + ' is not part of the value of ' + object.matlabPath + '.Value, which is all of it a save writes');
      }
      if ((key === 'Name' || key === 'name') && !(node.parent instanceof StructNode)) {
        return refused(() => node.matlabPath + ' is named by where it stands in ' + object.matlabPath + '.Value');
      }
      return { property: 'Value' };
    }
  }
  return refused(() => node.matlabPath + ' is part of ' + object.matlabPath + ', of which a save writes only the properties it takes');
}

/** The `why` of a refusal not described (propertyAt's `describe` false): there is one, and no more. */
export const REFUSED = 'refused';

function rootOf(node: BaseNode): BaseNode {
  let n = node;
  while (n.parent && !(n.parent as unknown as { isContainer?: boolean }).isContainer) {
    n = n.parent;
  }
  return n;
}

/**
 * What the object at `node` holds in `subsystem`, read, and the node's fingerprint as it stands;
 * or why no edit of it can be written, as a clause naming it. For MatNode, which keeps one per
 * node from the first time its editor asks.
 */
export function objectStateOf(subsystem: McosSubsystem, node: BaseNode): McosObjectState | string {
  const path = node.matlabPath;
  const place = mcosPlaceOf(node);
  const objectId = place ? objectIdOf(place.variable.mcosHandle, place.index) : null;
  if (objectId === null) {
    return path + " is not one of the file's objects this editor can find";
  }
  const stored = storedProperties(subsystem, objectId);
  if (!stored.ok) {
    return path + "'s object could not be read as a save writes it (" + stored.message + ')';
  }
  if (stored.className !== classOf(node)) {
    return path + ' is shown as ' + classPhrase(classOf(node)) + ", where the file's object is " + classPhrase(stored.className);
  }
  const entries = new Map<string, McosHeld>();
  const cellIndex = new Map<string, number>();
  for (const p of stored.properties) {
    entries.set(p.savedName, { refusal: p.refusal, value: p.cellIndex === null ? null : cellValueAt(subsystem, p.cellIndex) });
    if (p.cellIndex !== null) {
      cellIndex.set(p.savedName, p.cellIndex);
    }
  }
  const held: McosObjectHeld = { className: stored.className, stored: entries };
  const exact = new Map<string, string | null>();
  const asRead = new Map<string, MatVariable>();
  for (const property of NODE_PROPERTIES[stored.className] ?? []) {
    const named = path + '.' + property;
    const one = entries.get(savedNameOf(stored.className, property)!);
    const reference = one ? one.value : DEFAULTS[property];
    const v = nodePropertyValue(node, property);
    if (typeof v === 'string') {
      exact.set(property, named + ' ' + v);
      continue;
    }
    const difference = reference ? variableDifference(v, reference, named) : named + ' is held in a value that does not read';
    exact.set(property, difference && named + ' is not, as this editor reads it, the value the file holds (' + difference + '), so a save could not write it as it is');
    if (difference) {
      asRead.set(property, v);
    }
  }
  return {
    objectId,
    held,
    cellIndex,
    exact,
    asRead,
    late: !!(node as DataNode)._objectEdited,
    fingerprint: fingerprintOf(node),
    dataType: String((node as unknown as { DataType?: unknown }).DataType ?? ''),
  };
}

/**
 * Why no edit of the object at `node` is taken at all, its class being one with no rules
 * (McosEditRules.hasEditRules), as a clause, or null.
 */
export function classRefusal(state: McosObjectState, node: BaseNode): string | null {
  return hasEditRules(state.held.className) ? null : propertyEditRefusal(state.held, 'Value', node.matlabPath);
}

/**
 * Why an edit of `property` of the object at `node` is refused whatever its value, as a clause, or
 * null where its value decides: not one the node holds an editor's value of, one the rules refuse
 * for the object (McosEditRules.propertyEditRefusal: at its default, an index, an object), one
 * whose value as the node held it did not read back as the file's (McosObjectState.exact), and one
 * whose value now is of a class the rules write none of (McosEditRules.propertyValueRefusal: a
 * sparse Value, which an edit of an element leaves sparse).
 */
export function propertyRefusal(state: McosObjectState, node: BaseNode, property: string): string | null {
  const path = node.matlabPath;
  const cls = state.held.className;
  if (hasEditRules(cls) && savedNameOf(cls, property) !== null && !NODE_PROPERTIES[cls]?.includes(property)) {
    return path + '.' + property + ' is not one this editor edits in ' + classPhrase(cls);
  }
  const refused = propertyEditRefusal(state.held, property, path) ?? state.exact.get(property) ?? null;
  if (refused) {
    return refused;
  }
  const now = nodePropertyValue(node, property);
  return typeof now === 'string' ? path + '.' + property + ' ' + now : propertyValueRefusal(cls, property, now, path);
}

/**
 * propertyRefusal of each object's node and property, found once and kept until an edit at or under
 * the node (forget): what the editor asks of the object at every row under it, and what a Value of N
 * elements costs N to answer once an edit made its rows the value (it is read as the variable a save
 * writes, MatlabVariableNode._var). What else the answer reads, the object's state, never changes.
 * Kept by a MAT-file (MatNode._nodeEdited) and by a dictionary value's stream (mcosStreamEdit), each
 * told of every edit of a node of it (BaseNode._markSourceDirty), which every setter, undo and copy
 * into a twin makes once it has changed the node.
 */
export class McosPropertyVerdicts {
  readonly _byNode = new WeakMap<BaseNode, Map<string, string | null>>();

  of(state: McosObjectState, node: BaseNode, property: string): string | null {
    let held = this._byNode.get(node);
    if (!held) {
      held = new Map();
      this._byNode.set(node, held);
    }
    let verdict = held.get(property);
    if (verdict === undefined) {
      verdict = propertyRefusal(state, node, property);
      held.set(property, verdict);
    }
    return verdict;
  }

  /** An edit at `edited`: what was found of every node at or above it is forgotten. */
  forget(edited: BaseNode): void {
    for (let n: BaseNode | null = edited; n; n = n.parent) {
      this._byNode.delete(n);
    }
  }
}

/**
 * The value of `property` the node of an object holds now, as the variable a save writes, nameless;
 * or why it holds none, as the rest of a clause about the property. `field`, when given, is what the
 * node would hold instead, as the node holds it: a bound as a number or undefined, text as a string,
 * a Value as the value node an edit would make (MatNode._editValueRefusal).
 */
export function nodePropertyValue(node: BaseNode, property: string, field?: { value: unknown }): MatVariable | string {
  const own = node as unknown as Record<string, unknown>;
  const held = field ? field.value : property === 'Value' ? undefined : own[property];
  switch (property) {
    case 'Value':
      if (isElementEdit(held)) {
        return elementEditValue(node, held);
      }
      return valueVariable(field ? (held as BaseNode) : bareValueNode(node));
    case 'Min':
    case 'Max':
      if (typeof held === 'number') {
        return doubleOf(held);
      }
      return held === undefined || held === null || (Array.isArray(held) && held.length === 0) ? emptyDouble() : 'is not held as a number';
    case 'Description':
    case 'Unit':
    case 'DataType':
      return typeof held === 'string' ? charOf(held) : 'is not held as text';
    default:
      return 'is not one this editor edits in an object';
  }
}

/**
 * Why `value`, a node built of the text an edit typed into `node`, a field of the struct Value of
 * the Parameter at `object` (or a row under one), is what such a field holds no cell of, as a
 * clause, or null: text, which MATLAB refuses in a Parameter's struct, and anything else the rules
 * do not write (McosEditRules.valueMemberRefusal).
 */
export function memberRefusal(object: BaseNode, node: BaseNode, value: BaseNode): string | null {
  const v = valueVariable(value);
  const what = typeof v === 'string' ? v.replace(/^holds /, '') : valueMemberRefusal(v);
  return what ? node.matlabPath + ' would be ' + what + ', which this editor does not write into ' + classPhrase(classOf(object)) + "'s Value" : null;
}

/**
 * An edit of one element of an array Value, as its setter is about to make it
 * (MatlabVariableNode._setConstrainedValue): the element's row, and the number it is about to hold,
 * or a complex element's text.
 */
export interface ElementEdit {
  element: BaseNode;
  scalar: unknown;
}

function isElementEdit(x: unknown): x is ElementEdit {
  return x !== null && typeof x === 'object' && 'element' in x && 'scalar' in x;
}

// The Value the Parameter at `node` would hold once `edit` is made: its Value's variable, the
// element replaced, at the slot its row has among the array's rows, which is the order the variable
// holds them in (MatlabVariableNode._buildVarObject). Of an element of an array in a struct Value,
// the Value as it is: a struct is not held to a range.
function elementEditValue(node: BaseNode, edit: ElementEdit): MatVariable | string {
  const valueNode = (node as unknown as { _valueNode?: BaseNode | null })._valueNode;
  const now = valueVariable(valueNode ?? bareValueNode(node));
  if (typeof now === 'string' || !valueNode || edit.element.parent !== valueNode) {
    return now;
  }
  const k = valueNode.children.indexOf(edit.element);
  const values = Array.isArray(now.value) ? now.value.slice() : [now.value];
  if (k < 0 || k >= values.length) {
    return now;
  }
  const s = edit.scalar;
  values[k] = !now.isComplex
    ? s
    : typeof s === 'number' || isExactToken(s)
      ? { re: s, im: 0 }
      : parseComplexNum(String(s), now.className) ?? { re: 0, im: 0 };
  return { ...now, value: values.length === 1 && !Array.isArray(now.value) ? values[0] : values };
}

// A Parameter's Value node, or the node it would make of a Value it holds bare (a number, a logical,
// text, none), which a Value with no rows to show is (ParameterNode._adoptValueNode).
function bareValueNode(node: BaseNode): BaseNode {
  const p = node as unknown as { _valueNode?: BaseNode | null; Value?: unknown };
  return p._valueNode ?? NodeRegistry.parseValue(p.Value === undefined ? [] : p.Value, 'Value', null);
}

// The variable a value node is written as: a plain value's own (MatlabVariableNode._var), and a
// struct's built of its fields so; or why it is none.
function valueVariable(node: BaseNode): MatVariable | string {
  if (node instanceof MatlabVariableNode) {
    if (node._undecoded || node._isOpaque) {
      return 'holds ' + (node._undecoded ? 'a value that was not decoded' : classPhrase(node._opaqueClassName || 'object'));
    }
    const v = node._var;
    return v.name === '' ? v : { ...v, name: '' };
  }
  if (node instanceof StructNode) {
    return structVariable(node);
  }
  return 'holds ' + classPhrase(classOf(node) || 'value') + ', which this editor does not write into an object';
}

// A struct Value's variable: a scalar's fields, each its child's variable, and an array's, each the
// list of every element's, in the element order the rows hold (column-major, StructNode.parse).
function structVariable(node: StructNode): MatVariable | string {
  const fields = (node.serial._fields as string[] | undefined) ?? [];
  const dims = node.dims;
  const n = elementCount(dims);
  const out: Record<string, MatVariable | MatVariable[]> = {};
  const memberOf = (holder: BaseNode, field: string): MatVariable | string => {
    const child = holder.children.find((c) => c.name === field);
    return child ? valueVariable(child) : 'holds a struct that lacks its field ' + field;
  };
  if (n === 1 && !node._isElementNode) {
    for (const field of fields) {
      const v = memberOf(node, field);
      if (typeof v === 'string') {
        return v;
      }
      setOwn<MatVariable | MatVariable[]>(out, field, v);
    }
  } else {
    if (node.children.length !== n) {
      return 'holds a struct array of ' + n + ' elements with ' + node.children.length + ' rows';
    }
    for (const field of fields) {
      const each: MatVariable[] = [];
      for (const element of node.children) {
        const v = memberOf(element, field);
        if (typeof v === 'string') {
          return v;
        }
        each.push(v);
      }
      setOwn<MatVariable | MatVariable[]>(out, field, each);
    }
  }
  return { name: '', className: 'struct', dimensions: dims.slice(), isComplex: false, isLogical: false, value: null, fields: out };
}

/**
 * Every edit of the object at `node`: each property the node holds an editor's value of whose
 * value is not the cell's, with `pending`, an edit about to be made, in place of what the node holds
 * of it; or why one cannot be written, as a clause. A property the node holds no value of a save can
 * write (a Value of a class it has no converter for) is not one the editor offered, and is taken as
 * it was read; one held at its default is an edit only where the node holds another value.
 */
export function objectEditsOf(
  state: McosObjectState,
  node: BaseNode,
  pending?: { property: string; value: MatVariable },
): { edits: McosPropertyEdit[] } | { why: string } {
  const cls = state.held.className;
  const path = node.matlabPath;
  const edits: McosPropertyEdit[] = [];
  for (const property of NODE_PROPERTIES[cls] ?? []) {
    const named = path + '.' + property;
    const v = pending?.property === property ? pending.value : nodePropertyValue(node, property);
    const exact = state.exact.get(property) ?? null;
    const asRead = state.asRead.get(property);
    if (typeof v === 'string') {
      // No value a save writes: as it was read, where it was none then either.
      if (asRead || exact === null) {
        return { why: named + ' ' + v };
      }
      continue;
    }
    const held = state.held.stored.get(savedNameOf(cls, property)!);
    const reference = held ? held.value : DEFAULTS[property];
    if (reference && !variableDifference(v, reference, named)) {
      continue;
    }
    if (exact !== null) {
      // Never the file's: unedited where it is what the node held before any edit.
      if (!state.late && asRead && !variableDifference(v, asRead, named)) {
        continue;
      }
      return { why: exact };
    }
    const refused = propertyEditRefusal(state.held, property, path);
    if (refused) {
      return { why: refused };
    }
    edits.push({ property, value: v });
  }
  return { edits };
}

/**
 * The DataType the Simulink.Parameter at `node` loads with once saved, as its node is to show it
 * (ParameterNode._followSourceDataType): the text the save co-writes into its DataType cell with an
 * edit of its Value, as MATLAB's own `p.Value = v` re-derives it (McosEditRules: an int16 v makes
 * it 'int16', a double v over an int16 Value 'auto'), or else the DataType as it was read. Null for
 * another class, or where the node's edits cannot be written, which the save refuses anyway.
 *
 * Only a DataType the object holds a cell for is co-written. One it holds none for is at its class
 * default, which MATLAB re-derives from the Value as it loads the object, and is shown as read, as a
 * file read again shows it. One it holds is MATLAB's after each edit of the Value in turn
 * (nodeFollowedDataType), not after one from the file's: "abc" and then 7 typed over a single
 * Parameter's 5 make it 'auto'.
 */
export function shownDataType(state: McosObjectState, node: BaseNode): string | null {
  if (state.held.className !== PARAMETER) {
    return null;
  }
  const found = objectEditsOf(state, node);
  if ('why' in found) {
    return null;
  }
  const followed = nodeFollowedDataType(state, node);
  if (!found.edits.some((e) => e.property === 'Value') && (followed === null || followed === state.dataType)) {
    return state.dataType;
  }
  const ruled = objectEditCells(state.held, found.edits, node.matlabPath, followed ?? undefined);
  if (!ruled.ok) {
    return null;
  }
  // None written where the one followed to is the file's.
  const written = ruled.cells.find((c) => c.savedName === 'DataType');
  return written && typeof written.value.value === 'string' ? written.value.value : followed ?? state.dataType;
}

/**
 * The DataType the Simulink.Parameter at `node` follows to with the Value `value` (the node's own,
 * by default; an edit's about to be made): McosEditRules.followedDataType of the Value class the node
 * last followed (ParameterNode._classFollowed) and the DataType it shows. Null for a Value the node
 * holds none of a save writes, and where the rules derive it from the file's.
 */
export function nodeFollowedDataType(state: McosObjectState, node: BaseNode, value?: MatVariable): string | null {
  const v = value ?? nodePropertyValue(node, 'Value');
  if (typeof v === 'string') {
    return null;
  }
  const { before, shown } = dataTypeFollowedFrom(node, state.dataType);
  return followedDataType(state.held, v, before, shown);
}

/**
 * What the Simulink.Parameter at `node` follows its DataType on from at the next edit of its Value,
 * in a MAT-file and in a dictionary's MAT stream alike (matObjectEdit.dataTypeShownFor,
 * nodeFollowedDataType): the Value class it last followed (ParameterNode._classFollowed, which an
 * undo puts back), undefined until it has, and the DataType it shows, `read` where it shows none.
 */
export function dataTypeFollowedFrom(node: BaseNode, read: string): { before: string | undefined; shown: string } {
  const parameter = node as unknown as { DataType?: unknown; _classFollowed?: string };
  return { before: parameter._classFollowed, shown: String(parameter.DataType ?? read) };
}

/** What a node holds that a save does not write, as text to compare: see the file header. */
export function fingerprintOf(node: BaseNode): string {
  const cls = classOf(node);
  const own: Record<string, unknown> = {};
  for (const key of Object.keys(node)) {
    if (!key.startsWith('_') && !OWN_FIELDS_WRITTEN.has(key) && key !== 'DataType') {
      own[key] = (node as unknown as Record<string, unknown>)[key];
    }
  }
  const bag: Record<string, unknown> = { ...((node as DataNode).serial?._properties as Record<string, unknown> | undefined) };
  for (const key of BAG_KEYS_WRITTEN[cls] ?? []) {
    delete bag[key];
  }
  try {
    return JSON.stringify([own, bag], (_k, x) => (typeof x === 'bigint' ? x.toString() + 'n' : x));
  } catch (e) {
    return 'not fingerprinted: ' + (e instanceof Error ? e.message : String(e));
  }
}

/** The nodes of a file that are one object, two variables holding one handle (`r = h`), say. */
export interface McosTwinGroup {
  members: McosTwin[];
  // The node the first edit of the object was made at or under, through which every later one is
  // made, or null before any; kept until every node of the object holds what the file holds of it
  // again (mirrorTwins, and see the file header).
  master: BaseNode | null;
  // Why a node of them does not show what the master holds, as a clause, or null: a copy into it
  // would not have read back as the value copied (mirrorTwins), and was not made.
  diverged: string | null;
}

/** One node of an object other nodes are too, and what it shows of the object as read (twinOf). */
export interface McosTwin {
  node: BaseNode;
  state: McosObjectState;
  shown: ReadonlyMap<string, MatVariable | string>;
}

/**
 * The nodes of each object two or more of `nodes` are, of a class whose properties a save writes,
 * each a twin showing what the file holds of the object (twinOf): the groups of a MAT-file
 * (MatNode._twinGroups) and of a dictionary value's stream (mcosStreamEdit), found before any edit
 * of one. `stateOf` is what the editor judged of a node (MatNode._objectState), made now for one
 * it has not judged yet.
 */
export function twinGroupsOf(nodes: readonly BaseNode[], stateOf: (node: BaseNode) => McosObjectState | string): McosTwinGroup[] {
  const byId = new Map<number, BaseNode[]>();
  for (const node of nodes) {
    const place = mcosPlaceOf(node);
    const id = place ? objectIdOf(place.variable.mcosHandle, place.index) : null;
    if (id !== null) {
      byId.set(id, [...(byId.get(id) ?? []), node]);
    }
  }
  const groups: McosTwinGroup[] = [];
  for (const same of byId.values()) {
    if (same.length < 2) {
      continue;
    }
    const members: McosTwin[] = [];
    for (const node of same) {
      const state = stateOf(node);
      if (typeof state !== 'string' && hasEditRules(state.held.className)) {
        members.push(twinOf(node, state));
      }
    }
    if (members.length > 1) {
      groups.push({ members, master: null, diverged: null });
    }
  }
  return groups;
}

/** Each node of `groups`, and the group it is in: what the editor looks a node's twins up by. */
export function twinGroupByNode(groups: readonly McosTwinGroup[]): Map<BaseNode, McosTwinGroup> {
  const byNode = new Map<BaseNode, McosTwinGroup>();
  for (const group of groups) {
    for (const { node } of group.members) {
      byNode.set(node, group);
    }
  }
  return byNode;
}

/** The groups of `groups` with a node at or under `root`, or one `root` is at or under: the objects an edit there can reach. */
export function twinsTouching(groups: readonly McosTwinGroup[], root: BaseNode): McosTwinGroup[] {
  return groups.filter((g) => g.members.some((m) => isAtOrUnder(m.node, root) || isAtOrUnder(root, m.node)));
}

/**
 * Why `object`, a node of `group`, takes no edit of its own, as a clause, or null: an edit of the
 * object was made through another node of it, its master, through which every later one is made
 * (mirrorTwins). `inTree` says whether a node is in its file's tree still, which a master is not
 * once its variable is deleted.
 */
export function twinMasterRefusal(group: McosTwinGroup, object: BaseNode, inTree: (node: BaseNode) => boolean): string | null {
  const master = group.master;
  if (!master || master === object) {
    return null;
  }
  const one = object.matlabPath + ' is one object with ' + master.matlabPath + ' (one handle), and ' + master.matlabPath;
  const why = inTree(master)
    ? one + ' holds an edit of it: the object is edited through ' + master.matlabPath + ', and ' + object.matlabPath + ' shows each edit'
    : one + ', which holds an edit of it, is deleted: ' + object.matlabPath + ' takes no edit of its own until that delete is undone, or the file is read again';
  return group.diverged ? why + ' (' + group.diverged + ')' : why;
}

function isAtOrUnder(node: BaseNode, root: BaseNode): boolean {
  for (let n: BaseNode | null = node; n; n = n.parent) {
    if (n === root) {
      return true;
    }
  }
  return false;
}

/** A node of the object `state` describes, as one of its twins, showing what the file holds of it. */
export function twinOf(node: BaseNode, state: McosObjectState): McosTwin {
  const shown = new Map<string, MatVariable | string>();
  for (const property of NODE_PROPERTIES[state.held.className] ?? []) {
    const held = state.held.stored.get(savedNameOf(state.held.className, property)!);
    shown.set(property, state.asRead.get(property) ?? (held ? held.value ?? nodePropertyValue(node, property) : DEFAULTS[property]));
  }
  return { node, state, shown };
}

/**
 * Brings the nodes `members` of one object back in step after an edit at or under one of them
 * (MatNode._mirrorTwins, and a dictionary value's stream's, mcosStreamEdit). The first edit of the
 * object makes the node it reached the group's master (the first in the tree, of two an edit made
 * around the session reached at once); then each property another node holds a value of the master
 * does not is copied from the master into it (copyObjectProperty), and it is marked edited
 * (DataNode._markModified), as it is: what MATLAB loads of it changed, and if the master is deleted,
 * it still carries the edit to the save. Answers the nodes copied into. With the master out of the
 * tree (its variable deleted), nothing is copied. And once every node of the group, in the tree or
 * not, holds what the file holds of the object again, the group has no master: the next edit makes
 * one of whichever node it is made through.
 *
 * A copy is made only where it reads back as the value copied, as the save reads both
 * (nodePropertyValue); one that would not is not made, said in `group.diverged`, and tried again
 * after the next edit. Each node's property is read once a call: a Value is read as the variable a
 * save writes, which costs each of its elements.
 */
export function mirrorTwins(group: McosTwinGroup, members: readonly McosTwin[]): BaseNode[] {
  const cls = members[0].state.held.className;
  const properties = NODE_PROPERTIES[cls] ?? [];
  const read = new Map<McosTwin, Map<string, MatVariable | string>>();
  const valueOf = (m: McosTwin, property: string): MatVariable | string => {
    let of = read.get(m);
    if (!of) {
      of = new Map();
      read.set(m, of);
    }
    let v = of.get(property);
    if (v === undefined) {
      v = nodePropertyValue(m.node, property);
      of.set(property, v);
    }
    return v;
  };
  if (!group.master) {
    const changed = members.find((m) => properties.some((p) => !sameHeld(valueOf(m, p), m.shown.get(p), p)));
    group.master = changed ? changed.node : null;
  }
  const master = members.find((m) => m.node === group.master);
  const copied = new Set<BaseNode>();
  if (master) {
    group.diverged = null;
    for (const property of properties) {
      const want = valueOf(master, property);
      for (const m of members) {
        if (m === master || sameHeld(valueOf(m, property), want, property)) {
          continue;
        }
        const why = copyObjectProperty(master.node, m.node, property, want);
        if (why) {
          group.diverged ??= m.node.matlabPath + ' could not be shown as ' + master.node.matlabPath + "'s edit leaves their object (" + why + '), and shows it as it was before';
          continue;
        }
        copied.add(m.node);
      }
    }
    // Each node in the tree holds the master's now; one out of it, what it held as it left.
    const atFile = (m: McosTwin) => properties.every((p) => sameHeld(members.includes(m) ? valueOf(master, p) : nodePropertyValue(m.node, p), m.shown.get(p), p));
    if (!group.diverged && atFile(master) && group.members.every(atFile)) {
      group.master = null;
    }
  }
  for (const node of copied) {
    (node as DataNode)._markModified();
  }
  return [...copied];
}

// Whether two readings of one property (nodePropertyValue) are one value.
function sameHeld(a: MatVariable | string | undefined, b: MatVariable | string | undefined, property: string): boolean {
  if (typeof a === 'string' || typeof b === 'string' || a === undefined || b === undefined) {
    return a === b;
  }
  return variableDifference(a, b, property) === null;
}

/**
 * Copies `property` of the object at `from` into `to`, another node of the same object, as `from`
 * holds it, or answers why it does not, as a clause, having changed nothing: a bound or text by its
 * field; a Simulink.Parameter's Value as the node its Value is (built from what that node writes,
 * NodeRegistry.parseValue, the form both nodes were built of when read), with the Dimensions,
 * Complexity and DataType that follow it (ParameterNode._followValueShape). Not where the copy would
 * not read back as the value it copies. `want` is `from`'s, as nodePropertyValue reads it.
 */
export function copyObjectProperty(from: BaseNode, to: BaseNode, property: string, want: MatVariable | string = nodePropertyValue(from, property)): string | null {
  const source = from as unknown as Record<string, unknown>;
  const target = to as unknown as Record<string, unknown>;
  if (property !== 'Value') {
    target[property] = source[property];
    return null;
  }
  const fromValue = (from as unknown as { _valueNode?: DataNode | null })._valueNode ?? null;
  // A copy of its own: the master's value written holds the lists its node edits in place (a
  // struct's field names), so adopted as it was, a field the master deleted next was gone from the
  // twin's value but not its rows, and no later copy was made, the two reading alike.
  const raw = fromValue ? structuredClone(fromValue.serializeValue()) : undefined;
  const made = fromValue ? NodeRegistry.parseValue(raw, 'Value', null) : null;
  const got = made ? valueVariable(made) : want;
  const difference = typeof want === 'string' || typeof got === 'string' ? (want === got ? null : 'it holds no value a save writes') : variableDifference(got, want, 'Value');
  if (difference) {
    return difference;
  }
  const parameter = to as unknown as { _adoptValueNode(raw: unknown): void; _valueNode: unknown; children: BaseNode[]; Value: unknown; _followValueShape(): void };
  if (fromValue) {
    parameter._adoptValueNode(raw);
  } else {
    parameter._valueNode = null;
    parameter.children = [];
  }
  parameter.Value = source.Value;
  parameter._followValueShape();
  return null;
}

/** One cell an edit of objects writes, for the save's self-check (MatFileWriter.subsystemCellsDiffer). */
export type McosPlannedCell = McosWrittenCell;

/**
 * The subsystem element with every edit of the objects at `nodes` written into its cells, and the
 * cells written; or null where none of them holds an edit (each as it was read, or edited back).
 * Throws MatWriteError, naming the variable an object is in and why, for an object or an edit it
 * cannot write: one its editor would not have offered, one the rules refuse, two nodes of one object
 * edited to two values of one property, one a path the editor did not judge changed.
 *
 * `stateOf` is what the editor judged of each node (MatNode._objectState), and `entryOf` the
 * variable a node is in, for the message.
 */
export function objectSubsystemEdit(
  subsystem: McosSubsystem,
  nodes: readonly BaseNode[],
  stateOf: (node: BaseNode) => McosObjectState | string,
  entryOf: (node: BaseNode) => string,
): { element: Uint8Array; cells: McosPlannedCell[] } | null {
  const refuse = (node: BaseNode, why: string): never => {
    throw new MatWriteError('Cannot write "' + entryOf(node) + '": ' + why + '. Nothing was written.');
  };
  // Each object's edits, merged over the nodes that are it, and the node each edit came from.
  const byObject = new Map<number, { state: McosObjectState; node: BaseNode; edits: Map<string, { value: MatVariable; node: BaseNode }> }>();
  for (const node of nodes) {
    const state = stateOf(node);
    if (typeof state === 'string') {
      refuse(node, state);
    }
    const s = state as McosObjectState;
    if (!hasEditRules(s.held.className)) {
      refuse(node, propertyEditRefusal(s.held, 'Value', node.matlabPath)!);
    }
    const followed = s.held.className === PARAMETER ? shownDataType(s, node) : null;
    if (fingerprintOf(node) !== s.fingerprint || (followed !== null && (node as unknown as { DataType?: unknown }).DataType !== followed)) {
      refuse(node, node.matlabPath + ' holds an edit of a property a save does not write into ' + classPhrase(s.held.className));
    }
    const found = objectEditsOf(s, node);
    if ('why' in found) {
      refuse(node, found.why);
    }
    const object = byObject.get(s.objectId) ?? { state: s, node, edits: new Map() };
    byObject.set(s.objectId, object);
    for (const { property, value } of (found as { edits: McosPropertyEdit[] }).edits) {
      const other = object.edits.get(property);
      if (other && variableDifference(value, other.value, node.matlabPath + '.' + property)) {
        refuse(node, node.matlabPath + ' and ' + other.node.matlabPath + ' are one object, whose ' + property + ' they were edited to two values of');
      }
      object.edits.set(property, { value, node });
    }
  }
  const objects: McosObjectEdits[] = [];
  const cells: McosPlannedCell[] = [];
  for (const [objectId, { state, node, edits }] of byObject) {
    // A Parameter's DataType, written with its Value, and alone where the Value was typed back to
    // the file's after another class (nodeFollowedDataType).
    const followed = state.held.className === PARAMETER ? nodeFollowedDataType(state, node) : null;
    if (edits.size === 0 && followed === null) {
      continue;
    }
    const ruled = objectEditCells(state.held, [...edits].map(([property, { value }]) => ({ property, value })), node.matlabPath, followed ?? undefined);
    if (!ruled.ok) {
      return refuse(edits.get(ruled.property)?.node ?? node, ruled.message);
    }
    if (ruled.cells.length === 0) {
      continue;
    }
    const written: { savedName: string; cell: Uint8Array }[] = [];
    for (const { savedName, value } of ruled.cells) {
      let cell: Uint8Array;
      try {
        cell = valueCellOf(value);
      } catch (e) {
        if (e instanceof MatWriteError) {
          return refuse(node, node.matlabPath + '.' + savedName + ' could not be written (' + e.message + ')');
        }
        throw e;
      }
      written.push({ savedName, cell });
      cells.push({ objectId, cellIndex: state.cellIndex.get(savedName)!, savedName, value });
    }
    objects.push({ objectId, edits: written });
  }
  if (objects.length === 0) {
    return null;
  }
  const result = editMcosObjects(subsystem, objects);
  if (!result.ok) {
    return refuse(nodes[0], "the file's objects could not be written (" + result.message + ')');
  }
  return { element: result.bytes, cells };
}

function emptyDouble(): MatVariable {
  return { name: '', className: 'double', dimensions: [0, 0], isComplex: false, isLogical: false, value: [], fields: null };
}

function doubleOf(x: number): MatVariable {
  return { name: '', className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value: x, fields: null };
}

function charOf(text: string): MatVariable {
  return { name: '', className: 'char', dimensions: text === '' ? [0, 0] : [1, text.length], isComplex: false, isLogical: false, value: text, fields: null };
}
