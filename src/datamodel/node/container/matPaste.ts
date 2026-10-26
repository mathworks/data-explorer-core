// Copyright 2026 The MathWorks, Inc.
//
// A paste into a MAT-file: entries a host copied (DataNode.serialize, `{ name, metadata, value }`)
// out of a text or a binary dictionary or out of a MAT-file, made variables of the file, or refused
// whole, naming the entry and why. The importer a dictionary has (SectionNode.parseEntry) builds the
// entry it is handed and leaves the save to refuse what it cannot write; a MAT-file's save writes
// only what this package can write as what it is (MatFileWriter), so a paste is held to that before
// anything is added, by the rules the editor is held to, and never to rules of its own.
//
// TWO WAYS IN, BY WHAT THE VALUE IS.
//
//   a plain MATLAB value     the node a dictionary's reader makes of it (NodeRegistry.parseValue),
//   (numbers, char, logical, as the variable the MAT reader would hand over for it
//   struct, cell, sparse)    (matVariableOfNode), built into the node a file holding it shows
//                            (MatlabVariableNode.parseMatVariable), and written fresh by the save
//                            as any edited value is; refused where the save would refuse it written
//                            so (MatFileWriter.freshWriteRefusal, MatWriter's budget among it).
//   a Simulink object or a   MATLAB's own default object of the class, made as an Add makes it
//   string                   (MatNode.execAddEntry), and each property the file offers an editor
//                            of set to the copied object's, through the setter a user's edit goes
//                            through, with every gate that edit asks (carryObject); then the whole
//                            object as made held to the one copied (objectDifference). No object
//                            is written of its records: a save writes a new object only as one
//                            merged of MATLAB's records of its class, which is what an Add makes.
//
// ALL OR NOTHING. A paste of several entries makes each in turn, in the file, so that each name is
// made unique against the file and the entries made before it; the first one refused takes every
// one made back out, and puts back what making them changed of the file (fileState): the file is
// then what it was, its save the bytes it was. The deep refusal (MatNode.pasteRefusal) is the same
// making of one entry, always taken back, so that it and the paste cannot disagree; the cheap one
// asks only what is known without making anything (cheapRefusal), and the making asks it first.

import type BaseNode from '../BaseNode.js';
import { sourceEditRefusal, type PropClass } from '../BaseNode.js';
import type DataNode from '../DataNode.js';
import { objectValueClassOf } from '../DataNode.js';
import * as NodeRegistry from '../NodeRegistry.js';
import MatlabVariableNode from '../data/MatlabVariableNode.js';
import StructNode from '../data/StructNode.js';
import { emptyDouble } from '../data/matlabValueRules.js';
import type { MatVariable } from '../../parser/MatParser.js';
import { classPhrase, type MatWriteError } from '../../parser/MatWriter.js';
import { freshWriteRefusal, variableDifference } from '../../parser/MatFileWriter.js';
import { isEnumBag } from '../../parser/XmlUtils.js';
import { isEncodedValue } from '../../parser/EncodedValue.js';
import { setOwn } from '../../parser/ownKeys.js';
import { validateMatlabName } from '../../matlabName.js';
import { superclassOf } from '../registeredSubclasses.js';
import { elementCount } from '../../display/DisplayConvention.js';
import { MAT_SHOWN_SAVED_KEYS, matCarriedKeysOf } from '../data/matObjectEdit.js';
import { getSchema } from '../../schema/index.js';
import type MatNode from './MatNode.js';

/**
 * One entry handed to a paste: what DataNode.serialize answers for an entry of a dictionary or a
 * variable of a MAT-file, `{ name, metadata, value }`. A MAT-file has no metadata, and reads none.
 */
export interface PastePayload {
  name: string;
  metadata?: unknown;
  value: unknown;
}

/** A paste refused: why, in words naming the entry and the file, and the entry's name. */
export interface PasteRefused {
  error: true;
  reason: string;
  name?: string;
}

/** A paste made: the variables added, in the order handed over, and what takes them out and back. */
export interface PasteMade {
  nodes: BaseNode[];
  undo: () => void;
  redo: () => void;
}

// What a paste makes an entry as, told from its value's shape alone (classOf).
type PasteKind =
  | { kind: 'plain' }
  | { kind: 'string' }
  | { kind: 'object'; className: string }
  | { kind: 'refused'; why: string };

// The classes a copied object is made as (carryObject): those MAT_CREATABLE_CLASSES holds whose node
// a dictionary's reader makes too, which is all of them but `string`, a value and not an object there.
export const PASTED_OBJECT_CLASSES: readonly string[] = Object.freeze([
  'Simulink.Parameter',
  'Simulink.Signal',
  'Simulink.Bus',
  'Simulink.NumericType',
  'Simulink.AliasType',
  'Simulink.ValueType',
]);

/**
 * The refusal of a paste of `payload` into `mat` known without making anything, in words naming the
 * entry and the file, or null where only making it can tell: the file takes no edit at all
 * (MatNode._fileRefusal); what was handed over is no entry; its name is no MATLAB name; its value is
 * of a kind or a class a MAT-file takes no new variable of (classOf, MatNode._classRefusal). Asked
 * first by the making (makeOne), so that one refused here is refused there.
 */
export function cheapRefusal(mat: MatNode, payload: unknown): string | null {
  const file = mat._fileRefusal();
  const name = payloadName(payload);
  if (file) {
    return cannotPaste(mat, name, editorClause(file));
  }
  if (!isPayload(payload)) {
    return cannotPaste(mat, name, 'what was handed over is not an entry, a name and a value');
  }
  const invalid = validateMatlabName(payload.name);
  if (invalid) {
    return cannotPaste(mat, name, 'it is not a name MATLAB can load (' + invalid + ')');
  }
  const kind = classOf(payload.value);
  if (kind.kind === 'refused') {
    return cannotPaste(mat, name, kind.why);
  }
  const className = madeClassOf(kind);
  if (!className) {
    return null;
  }
  const classRefused = mat._classRefusal(className);
  return classRefused ? cannotPaste(mat, name, 'it is ' + classPhrase(className) + ', and ' + classRefused) : null;
}

/**
 * The paste of `payloads` into `mat`, made: each entry a variable of the file, in order, named as it
 * was or, where the file holds that name already (an entry made before it included), with a counter
 * appended. Or, where any of them is refused, nothing: every one made is taken out again, the file is
 * as it was, and the refusal says which entry and why.
 */
export function pasteInto(mat: MatNode, payloads: readonly unknown[]): PasteMade | PasteRefused {
  // The objects created in the tree found once for the paste, again after each made (MatNode._inLiveScope).
  return mat._inLiveScope(() => pasteIntoNow(mat, payloads));
}

function pasteIntoNow(mat: MatNode, payloads: readonly unknown[]): PasteMade | PasteRefused {
  const state = fileState(mat);
  const before = new Set(mat.children);
  const made: { node: BaseNode; undo: () => void; redo: () => void }[] = [];
  for (const payload of payloads) {
    let one: ReturnType<typeof makeOne>;
    try {
      one = makeOne(mat, payload);
    } catch (e) {
      if (!(e instanceof Error)) {
        takeBack(mat, made, before, state);
        throw e;
      }
      // A making that failed some way no refusal says (a value no reader of this package expects):
      // refused all the same, and whatever it left in the file taken out with the rest.
      const name = payloadName(payload);
      one = { error: true, reason: cannotPaste(mat, name, 'it could not be made a variable of the file (' + e.message.replace(/\.$/, '') + ')'), name };
    }
    if ('error' in one) {
      takeBack(mat, made, before, state);
      return one;
    }
    made.push(one);
  }
  state.settle();
  return {
    nodes: made.map((m) => m.node),
    undo: () => {
      for (let i = made.length - 1; i >= 0; i--) {
        made[i].undo();
      }
    },
    redo: () => {
      for (const m of made) {
        m.redo();
      }
    },
  };
}

// The paste refused: every variable `made` taken out again, last first, any other a making left in
// the file that was not in it `before`, and the file's state put back (fileState), whatever the
// taking out throws.
function takeBack(mat: MatNode, made: readonly { undo: () => void }[], before: ReadonlySet<BaseNode>, state: { restore: () => void }): void {
  try {
    for (let i = made.length - 1; i >= 0; i--) {
      made[i].undo();
    }
  } finally {
    for (const child of mat.children.slice()) {
      if (!before.has(child)) {
        mat.removeChild(child);
      }
    }
    state.restore();
  }
}

/**
 * Why a paste of `payload` into `mat` is refused, or null where it would be made: cheapRefusal's
 * answer, or, `deep`, the making itself (pasteInto, of this entry alone), taken back whatever it
 * answers, so that the two cannot disagree.
 */
export function pasteRefusalOf(mat: MatNode, payload: unknown, deep: boolean): string | null {
  if (!deep) {
    return cheapRefusal(mat, payload);
  }
  // What the file is before the paste, put back whatever the paste or its undo does or throws (a
  // refused one puts it back itself: pasteInto).
  const state = fileState(mat);
  const before = new Set(mat.children);
  let made: PasteMade | null = null;
  try {
    const one = pasteInto(mat, [payload]);
    if ('error' in one) {
      return one.reason;
    }
    made = one;
    return null;
  } finally {
    takeBack(mat, made ? [made] : [], before, state);
  }
}

/**
 * The tokens of what a paste or a drop into `mat` takes (MatNode.getAdmittedTypes): a host's
 * prediction of one judges a copied entry by its value's `_array_class`, or 'MatlabVariable' where it
 * has none, which is every plain value and a string. So 'MatlabVariable', and each class of
 * PASTED_OBJECT_CLASSES the file creates an object of (MatNode._classRefusal). None for a file that
 * takes no edit (MatNode._fileRefusal).
 */
export function admittedTypesOf(mat: MatNode): string[] {
  if (mat._fileRefusal()) {
    return [];
  }
  return ['MatlabVariable', ...PASTED_OBJECT_CLASSES.filter((c) => !mat._classRefusal(c))];
}

// ---- One entry --------------------------------------------------------------------------------

// The variable `payload` is made as in `mat`, in the file, and what takes it out and back; or why
// it is refused, with nothing of it left in the file.
function makeOne(mat: MatNode, payload: unknown): { node: BaseNode; undo: () => void; redo: () => void } | PasteRefused {
  const name = payloadName(payload);
  const refuse = (reason: string): PasteRefused => ({ error: true, reason, name });
  const cheap = cheapRefusal(mat, payload);
  if (cheap) {
    return refuse(cheap);
  }
  const p = payload as PastePayload;
  // Named as an Add names a new variable asked for by name (MatNode._newEntryName, the one rule of
  // a dictionary's Add and a MAT-file's): as copied, or with a counter where the file holds that name.
  const { name: unique, invalid } = mat._newEntryName(undefined, p.name);
  if (invalid) {
    return refuse(cannotPaste(mat, name, "'" + unique + "', the name it would be given, is not a name MATLAB can load (" + invalid + ')'));
  }
  let source: DataNode;
  try {
    // Under the name it is to have, so that what it shows (an element's `x(2)`) is what the
    // variable made of it shows.
    source = NodeRegistry.parseValue(p.value, unique, null);
  } catch (e) {
    // A reader's refusal (MatWriter's budget, dims that are no size) or a value no reader makes
    // a node of, which nothing is pasted of either way.
    if (e instanceof Error) {
      return refuse(cannotPaste(mat, name, 'its value could not be read (' + e.message.replace(/\.$/, '') + ')'));
    }
    throw e;
  }
  const kind = classOf(p.value);
  if (kind.kind === 'plain') {
    const strings = new Map<MatVariable, string>();
    const built = plainVariableIn(mat, source, unique, strings);
    if (typeof built === 'string') {
      return refuse(cannotPaste(mat, name, built));
    }
    if (strings.size === 0) {
      return mat._attachNew(built);
    }
    return withStringsMade(mat, built, strings, (why) => refuse(cannotPaste(mat, name, why)));
  }
  // A string or an object: cheapRefusal refused every other kind.
  const carried = carryObject(mat, source, madeClassOf(kind)!, unique);
  return typeof carried === 'string' ? refuse(cannotPaste(mat, name, carried)) : carried;
}

// The node of the plain value `source` (a node of a dictionary's reader, of the copied value) as a
// variable `name` of `mat`, unattached, or why none is written: what the value holds that a save of
// a MAT-file cannot write fresh, said by the save's own rule (MatFileWriter.freshWriteRefusal). With
// `strings`, a string a cell or a struct of it holds is a stand-in char, its text kept there by its
// variable, for withStringsMade to make the object it is once the variable is in the file. In a file
// that makes no string (MatNode._classRefusal), such a string is refused, and no stand-in made.
function plainVariableIn(mat: MatNode, source: DataNode, name: string, strings: Map<MatVariable, string>): BaseNode | string {
  const variable = matVariableOfNode(source, name, mat._classRefusal('string') ? undefined : strings);
  if ('why' in variable) {
    return variable.why;
  }
  let node: DataNode;
  try {
    node = MatlabVariableNode.parseMatVariable(variable, name, mat);
  } catch (e) {
    if (e instanceof Error) {
      return 'its value could not be made a variable of the file (' + e.message.replace(/\.$/, '') + ')';
    }
    throw e;
  }
  // The file's header, which a record is read back after: a file the cheap tier passed has one.
  const refused = freshWriteRefusal(node, mat.headerBytes!);
  return refused ? writerWhy(refused) : node;
}

/**
 * `built`, a plain variable a paste makes whose cells and structs hold `strings` (plainVariableIn's
 * stand-ins, by their variables), put in `mat` and each stand-in made the string it stands for, as
 * the strings of a value typed in are (MatNode._makeStrings); then held to the save's own rule, the
 * strings now the objects a save writes. What takes it out and back, or the refusal `refuse` makes
 * of why not, which the paste's taking back undoes (pasteInto).
 */
function withStringsMade(mat: MatNode, built: BaseNode, strings: ReadonlyMap<MatVariable, string>, refuse: (why: string) => PasteRefused): { node: BaseNode; undo: () => void; redo: () => void } | PasteRefused {
  const attached = mat._attachNew(built);
  const standIns: { node: BaseNode; text: string }[] = [];
  const stack: BaseNode[] = [built];
  while (stack.length > 0) {
    const n = stack.pop()!;
    const text = n instanceof MatlabVariableNode && n._matVar ? strings.get(n._matVar) : undefined;
    if (text !== undefined) {
      standIns.push({ node: n, text });
    } else {
      stack.push(...n.children);
    }
  }
  if (standIns.length !== strings.size) {
    return refuse('its strings could not be found in the variable made of it');
  }
  // A variable a paste makes is new, whatever the making of its strings marks it.
  const status = (built as DataNode).status;
  const set = mat._makeStrings(standIns);
  (built as DataNode).status = status;
  if (set !== true) {
    return refuse(set.reason.replace(/^Cannot edit "[^"]*": /, '').replace(/\.$/, ''));
  }
  // None of the stand-ins is in the variable a save writes of it now: each is the string it stood for.
  if (holdsAny((built as MatlabVariableNode)._var, strings)) {
    return refuse('its strings could not be made in the variable written of it');
  }
  const refused = freshWriteRefusal(built, mat.headerBytes!);
  return refused ? refuse(writerWhy(refused)) : attached;
}

// Whether `v` is, or holds at any depth, one of `variables`.
function holdsAny(v: MatVariable | null | undefined, variables: ReadonlyMap<MatVariable, unknown>): boolean {
  if (!v) {
    return false;
  }
  if (variables.has(v)) {
    return true;
  }
  const members = Array.isArray(v.value) && v.className === 'cell' ? (v.value as (MatVariable | null)[]) : [];
  const fields = v.fields ? Object.values(v.fields).flatMap((f) => (Array.isArray(f) ? f : [f])) : [];
  return [...members, ...fields].some((m) => holdsAny(m, variables));
}

/**
 * The variable the MAT reader would hand over for `node`, a node of a plain MATLAB value as any
 * reader of this package makes one (a dictionary's StructNode, a MatlabVariableNode, a ConstantNode),
 * named `name`; or why there is none, as a clause naming what stands in the way by its MATLAB path.
 * A cell or a struct is built of its members, each so; anything else is its own variable
 * (MatlabVariableNode._var), which is what a save of it as a MAT stream encodes.
 *
 * Refused: an object at any depth (a typed node, an opaque MCOS object, an enumeration value), a
 * string at any depth (a MAT-file holds one only as an object), a function handle, a value the reader
 * did not decode.
 */
export function matVariableOfNode(node: BaseNode, name: string, strings?: Map<MatVariable, string>): MatVariable | { why: string } {
  return variableOf(node, name, name, strings);
}

function variableOf(node: BaseNode, name: string, path: string, strings?: Map<MatVariable, string>): MatVariable | { why: string } {
  if (node instanceof StructNode) {
    return structVariableOf(node, name, path, strings);
  }
  if (!(node instanceof MatlabVariableNode)) {
    const cls = String(node.className || 'object');
    return { why: heldAt(path) + classPhrase(cls) + ' object, and a value pasted into a MAT-file holds no object but at its top: a paste writes no new object inside a struct or a cell' };
  }
  if (node._isOpaque) {
    return { why: heldAt(path) + classPhrase(node._opaqueClassName || 'object') + ' object, which this package cannot write as a new variable of a MAT-file' };
  }
  if (node._undecoded) {
    return { why: heldAt(path) + 'a value that was not decoded, which has no value a save could write' };
  }
  if (node._scalarType === 'function_handle') {
    return { why: heldAt(path) + 'a function handle, which this package cannot write into a MAT-file' };
  }
  if (node._kind === 'string' || node._scalarType === 'string') {
    // A string at the top is made as an object (carryObject), of what a dictionary spells one as;
    // one that reaches here is held in another form, a binary dictionary's MAT stream. One a cell or
    // a struct holds is a stand-in, with its text, where the string is to be made (withStringsMade).
    const top = heldAt(path) === 'it is ';
    if (strings && !top) {
      // Its text whatever its length (_stringLiteral); one no text spells (an empty or N-D array,
      // <missing>) is refused, saying which.
      const literal = node._stringLiteral();
      if ('why' in literal) {
        return { why: heldAt(path) + 'a string, which a paste makes anew of its text, and ' + literal.why };
      }
      const standIn: MatVariable = { name, className: 'char', dimensions: [1, 1], isComplex: false, isLogical: false, value: ' ', fields: null };
      strings.set(standIn, literal.text);
      return standIn;
    }
    return {
      why: heldAt(path) + 'a string, which a MAT-file holds only as an object, and '
        + (top ? 'this package makes a new one only of the text a dictionary spells a string in' : 'a paste writes no new object inside a struct or a cell'),
    };
  }
  if (node._kind === 'cell') {
    const members: MatVariable[] = [];
    for (let i = 0; i < node.children.length; i++) {
      const member = variableOf(node.children[i], '', path + '{' + (i + 1) + '}', strings);
      if ('why' in member) {
        return member;
      }
      members.push(member);
    }
    return { name, className: 'cell', dimensions: node._dims.slice(), isComplex: false, isLogical: false, value: members, fields: null };
  }
  if (node._scalarType === 'struct' && !node._unexpandedStruct()) {
    return matlabStructVariableOf(node, name, path, strings);
  }
  const v = node._var;
  if (v._unwritable) {
    return { why: heldAt(path) + v._unwritable };
  }
  // A value of no MATLAB class a MAT-file holds as a plain value: an empty array of objects, say,
  // which a dictionary reads as a value of its class and no elements.
  if (!PLAIN_CLASSES.has(v.className)) {
    return { why: heldAt(path) + 'an empty array of ' + v.className + ' objects, and this package writes no new object into a MAT-file but at its top' };
  }
  return { ...v, name };
}

// The classes of a plain value a MAT reader hands over (MatParser): what a fresh write writes.
const PLAIN_CLASSES: ReadonlySet<string> = new Set([
  'double', 'single', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'char', 'logical', 'cell', 'struct',
]);

// A MatlabVariableNode's struct, built of its members as MatlabVariableNode._buildVarObject builds
// it of their variables: one element's fields its rows; an array's, the rows of its element rows,
// every field any element holds, `[]` where one lacks it; one of no element, the fields it declares.
function matlabStructVariableOf(node: MatlabVariableNode, name: string, path: string, strings?: Map<MatVariable, string>): MatVariable | { why: string } {
  const count = elementCount(node._dims);
  const fields: Record<string, MatVariable | MatVariable[]> = {};
  if (count > 1) {
    const names: string[] = [];
    for (const element of node.children) {
      for (const f of element.children) {
        if (!names.includes(f.name)) {
          names.push(f.name);
        }
      }
    }
    for (const field of names) {
      const held: MatVariable[] = [];
      for (let e = 0; e < node.children.length; e++) {
        const f = node.children[e].children.find((c) => c.name === field);
        const member = f ? variableOf(f, field, path + '(' + (e + 1) + ').' + field, strings) : emptyDouble();
        if ('why' in member) {
          return member;
        }
        held.push(member);
      }
      setOwn<MatVariable | MatVariable[]>(fields, field, held);
    }
  } else {
    if (count === 0) {
      for (const field of node._emptyStructFields ?? []) {
        setOwn<MatVariable | MatVariable[]>(fields, field, []);
      }
    }
    for (const child of node.children) {
      const member = variableOf(child, child.name, path + '.' + child.name, strings);
      if ('why' in member) {
        return member;
      }
      setOwn<MatVariable | MatVariable[]>(fields, child.name, member);
    }
  }
  return { name, className: 'struct', dimensions: node._dims.slice(), isComplex: false, isLogical: false, value: null, fields };
}

// A dictionary's struct (StructNode): one element's fields its rows, an array's the rows of each
// element row, and the fields it declares (`_fields`), which is all a struct of no element holds.
function structVariableOf(node: StructNode, name: string, path: string, strings?: Map<MatVariable, string>): MatVariable | { why: string } {
  const dims = node.dims;
  const count = elementCount(dims);
  const declared = (node.serial._fields as string[] | undefined) ?? [];
  const elements = count > 1 ? node.children : [node];
  const names = declared.slice();
  for (const element of count === 0 ? [] : elements) {
    for (const f of element.children) {
      if (!names.includes(f.name)) {
        names.push(f.name);
      }
    }
  }
  const fields: Record<string, MatVariable | MatVariable[]> = {};
  for (const field of names) {
    const held: MatVariable[] = [];
    for (let e = 0; e < (count === 0 ? 0 : elements.length); e++) {
      const f = elements[e].children.find((c) => c.name === field);
      const member = f ? variableOf(f, field, path + (count > 1 ? '(' + (e + 1) + ')' : '') + '.' + field, strings) : emptyDouble();
      if ('why' in member) {
        return member;
      }
      held.push(member);
    }
    setOwn<MatVariable | MatVariable[]>(fields, field, count === 1 ? held[0] : held);
  }
  return { name, className: 'struct', dimensions: dims.slice(), isComplex: false, isLogical: false, value: null, fields };
}

// `path is ` for a member, and `it is ` for the value itself.
function heldAt(path: string): string {
  return path.includes('.') || path.includes('{') || path.includes('(') ? path + ' is ' : 'it is ';
}

// ---- What a value is ----------------------------------------------------------------------------

// What a paste makes of `value`, by its shape: an object of a class (one element of `_array_class`),
// a string (a dictionary's string array, `["a"]` or `_array_type: 'String'`), or a plain value; or
// why it is none a MAT-file takes. Only the shape is read, nothing is parsed.
function classOf(value: unknown): PasteKind {
  if (value === undefined) {
    return { kind: 'refused', why: 'it holds no value' };
  }
  if (isEncodedValue(value)) {
    return { kind: 'plain' };
  }
  if (Array.isArray(value) && value.length > 0 && value.every((e) => typeof e === 'string')) {
    return { kind: 'string' };
  }
  const o = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (!o) {
    return { kind: 'plain' };
  }
  if (o._array_type === 'String') {
    return { kind: 'string' };
  }
  if (o._type === 'function_handle') {
    return { kind: 'refused', why: 'it is a function handle, which this package cannot write into a MAT-file' };
  }
  if (o._object_class !== undefined) {
    return { kind: 'refused', why: 'it is ' + (o._object_class ? classPhrase(String(o._object_class)) + ' object' : 'an object of no class') + ', which this package cannot write as a new variable of a MAT-file' };
  }
  if (typeof o._array_class === 'string' && o._array_class !== '') {
    const elements = Array.isArray(o._elements) ? o._elements : [];
    const cls = objectValueClassOf(o);
    if (isEnumBag(o)) {
      return { kind: 'refused', why: 'it is a value of the enumeration ' + o._array_class + ', which this package cannot write into a MAT-file' };
    }
    if (elements.length !== 1) {
      const dims = Array.isArray(o._dimensions) ? (o._dimensions as unknown[]).join('x') : String(elements.length);
      return { kind: 'refused', why: 'it is a ' + dims + ' array of ' + o._array_class + ' objects, and this package makes a new object of a MAT-file one at a time' };
    }
    const sup = superclassOf(cls);
    if (sup) {
      return { kind: 'refused', why: 'it is ' + classPhrase(cls) + ', a subclass of ' + sup + ' whose own properties this package does not write, so no new object of it is made in a MAT-file' };
    }
    if (cls === 'Simulink.data.dictionary.EnumTypeDefinition') {
      return { kind: 'refused', why: "it is an enumeration's definition, which a MAT-file does not hold: MATLAB defines an enumeration in a class file or a data dictionary" };
    }
    return { kind: 'object', className: cls };
  }
  return { kind: 'plain' };
}

// The class an entry of `kind` is made an object of, which the file is asked whether it creates one
// of (MatNode._classRefusal) and an Add makes (carryObject): `string` for a string, the copied
// object's class for an object; null for a plain value, or one refused.
function madeClassOf(kind: PasteKind): string | null {
  switch (kind.kind) {
    case 'string':
      return 'string';
    case 'object':
      return kind.className;
    default:
      return null;
  }
}

// ---- An object, made as an Add makes one and set as a user sets it ------------------------------

// MATLAB's default object of `className` as the new variable `name` of `mat` (execAddEntry), each
// property the file offers an editor of set to what `source`, the copied object's node, shows, and
// the whole of it held to `source` (objectDifference); or why it is not made, with nothing of it left.
function carryObject(mat: MatNode, source: DataNode, className: string, name: string): { node: BaseNode; undo: () => void; redo: () => void } | string {
  const added = mat._addObject(className, name);
  if (typeof added === 'string') {
    return added;
  }
  const node = added.node as DataNode;
  let why: string | null;
  try {
    why = carryInto(node, source, className) ?? objectDifference(source, node);
  } catch (e) {
    added.undo();
    throw e;
  }
  if (why) {
    added.undo();
    return why;
  }
  // New, as an Add leaves it: the edits that made it what was copied are of the new object.
  node.status = 'New';
  return added;
}

// Every property of `source` the file offers an editor of on `node` (matObjectEdit.matCarriedKeysOf),
// set where it shows otherwise, as a user's edit sets it: the source's gate first (sourceEditRefusal,
// as the session's editProperty asks it), then the node's setter, with every gate it asks. A Bus's
// elements are rows added to it as Add adds one (execAddChild), each with its name and the
// properties a row offers. Some edits are judged against others (a Min against the Value, a scaling
// against a NumericType's mode), and some set others (a Value its DataType), so the properties are
// set in passes, until one sets nothing more; what is still refused then is the answer. Whether the
// object is then what was copied is objectDifference's to say.
function carryInto(node: DataNode, source: DataNode, className: string): string | null {
  if (className === 'Simulink.Bus') {
    const rows = source.children;
    for (let i = node.children.length; i < rows.length; i++) {
      const add = node.execAddChild?.();
      if (!add) {
        return 'its element ' + rows[i].name + ' could not be added: ' + (sourceEditRefusal(node, 'Add') ?? 'the Bus takes no element row').replace(/\.$/, '');
      }
    }
    // Named as copied, through a name no row holds and none is to: a row added is named `a`, `a1`,
    // …, which may be the name another row is to have (elements `a1` and `a`, in that order).
    const names = rows.map((r) => shownOf(r, 'Name'));
    const held = new Set([...names, ...node.children.map((c) => c.name)]);
    for (const step of ['apart', 'named'] as const) {
      for (let i = 0; i < rows.length; i++) {
        const row = node.children[i] as DataNode;
        const named = names[i];
        if (named === undefined || row.name === named) {
          continue;
        }
        let apart = 'pasted' + i;
        for (let k = 1; held.has(apart); k++) {
          apart = 'pasted' + i + '_' + k;
        }
        const refused = setShown(row, 'Name', step === 'apart' ? apart : named);
        if (refused) {
          return refused;
        }
      }
    }
  }
  const items: { at: DataNode; from: BaseNode; key: string }[] = [];
  const carry = (at: DataNode, from: BaseNode, cls: string) => {
    for (const key of matCarriedKeysOf(cls, [...rowsOf(at).keys()])) {
      items.push({ at, from, key });
    }
  };
  carry(node, source, className);
  if (className === 'Simulink.Bus') {
    source.children.forEach((row, i) => carry(node.children[i] as DataNode, row, 'Simulink.BusElement'));
  }
  // What was copied shows, read once a node: it does not change.
  const copiedRows = new Map<BaseNode, Map<string, string>>();
  const copied = (from: BaseNode, key: string) => {
    let rows = copiedRows.get(from);
    if (!rows) {
      rows = rowsOf(from);
      copiedRows.set(from, rows);
    }
    return rows.get(key);
  };
  for (let pass = 0; pass < CARRY_PASSES; pass++) {
    let changed = false;
    let refused: string | null = null;
    for (const { at, from, key } of items) {
      const want = copied(from, key);
      // Nothing stated (rowsDifference), or what the object made shows already.
      if (want === undefined || want === '' || sameRowText(want, shownOf(at, key) ?? '')) {
        continue;
      }
      const why = setShown(at, key, want);
      if (why) {
        refused ??= why;
      } else {
        changed = true;
      }
    }
    if (!changed) {
      return refused;
    }
  }
  return null;
}

// How many passes carryInto makes at most: each property is set at most once a pass, and an edit
// that waits for another waits one pass.
const CARRY_PASSES = 4;

// `key` of `node` set to `text` as a user's edit sets it, or why it is not, as a clause.
function setShown(node: DataNode, key: string, text: string): string | null {
  const what = (node.matlabPath || node.name) + '.' + key + ' could not be set to ' + JSON.stringify(text) + ': ';
  const gate = sourceEditRefusal(node, key);
  if (gate) {
    return what + editorClause(gate);
  }
  const set = node.setProperty(key, text);
  return set === true ? null : what + editorClause(String(set.reason));
}

// ---- Held to what was copied -----------------------------------------------------------------------

/**
 * Where `made`, the object made of `source`, is not what `source` is, as a clause naming the property
 * by its MATLAB path, or null where it is: every row the two show, by its text (rowsDifference), the
 * value a text does not say whole (a Parameter's Value of an integer class, complex, of a size its
 * text does not hold: valueDifference), and what of the copy's property bag no row shows
 * (bagDifference).
 */
export function objectDifference(source: BaseNode, made: BaseNode): string | null {
  return rowsDifference(source, made, made.name) ?? valueDifference(source, made) ?? bagDifference(source, made, made.name);
}

// Every row `a` shows that `b` shows otherwise, and so on down their child rows, as a clause; the
// first found. A row only one of them shows is compared with nothing shown, ''. Not the name of the
// two at the top, which a paste may have made unique.
function rowsDifference(a: BaseNode, b: BaseNode, path: string): string | null {
  const ra = rowsOf(a);
  const rb = rowsOf(b);
  for (const key of new Set([...ra.keys(), ...rb.keys()])) {
    if (key === 'Name' && path === b.name) {
      continue;
    }
    const was = ra.get(key) ?? '';
    const is = rb.get(key) ?? '';
    if (sameRowText(was, is)) {
      continue;
    }
    // A row what was copied shows empty states nothing where its property bag holds nothing there
    // either: a text dictionary writes no property at its default, and the object made holds
    // MATLAB's default of it. Where the bag does hold a value the row shows nothing of, what the
    // object made shows is not known to be it.
    const held = was === '' ? heldUnshown(a, key) : null;
    if (was !== '' || held) {
      return (path || b.name) + '.' + key + ' would be ' + JSON.stringify(is) + ' where what was copied holds '
        + (held ? held + ', which its row shows nothing of' : JSON.stringify(was));
    }
  }
  if (a.children.length !== b.children.length) {
    return (path || b.name) + ' would hold ' + b.children.length + ' row(s) where what was copied holds ' + a.children.length;
  }
  for (let i = 0; i < a.children.length; i++) {
    const below = rowsDifference(a.children[i], b.children[i], (path || b.name) + '/' + a.children[i].name);
    if (below) {
      return below;
    }
  }
  return null;
}

// What the property bag of `node` holds where its row `key` reads it, said as JSON, where that is a
// value and not nothing ('' or [] or none), or null.
function heldUnshown(node: BaseNode, key: string): string | null {
  const prop = shownProps(node).find((p) => p.key === key);
  if (!prop) {
    return null;
  }
  const bag = bagOf(node);
  const leaves = leavesOf(bag);
  for (const path of bagPathsOf(String(node.className ?? ''), prop)) {
    const value = leaves.has(path) ? leaves.get(path) : bag[path];
    const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
      || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0);
    if (!empty) {
      return path + ' = ' + leafText(value);
    }
  }
  return null;
}

// Whether two rows' texts say one value: the same text, or the same number, a one-element row in
// brackets being its element (`[1]` is `1`, as MATLAB reads both) and blanks around a number nothing.
// Any other text is held to itself exactly, blanks and brackets included: a Description of two blanks
// is not one of none, and a HeaderFile `[abc]` is not `abc`.
function sameRowText(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const x = numberOf(a);
  const y = numberOf(b);
  return x !== null && y !== null && (x === y || (Number.isNaN(x) && Number.isNaN(y)));
}

// The number `text` is, alone or as the one element of a row in brackets, or null for any other text.
function numberOf(text: string): number | null {
  const t = text.trim();
  const inner = (/^\[\s*([^\s,;[\]]+)\s*\]$/.exec(t)?.[1] ?? t).trim();
  if (/^[+-]?inf$/i.test(inner)) {
    return inner.startsWith('-') ? -Infinity : Infinity;
  }
  if (/^nan$/i.test(inner)) {
    return NaN;
  }
  return /^[+-]?(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(inner) ? Number(inner) : null;
}

// The rows `node` shows: its table's columns, then the rows its Property Inspector lays out. A key
// both show is read through the first.
function shownProps(node: BaseNode): PropClass[] {
  return [...node.getProperties(), ...(node.getPILayout() ?? []).flatMap((g) => g.items)];
}

// The text `node` shows in its row `prop` (getPropInfo's displayValue), or '<unreadable>' where
// reading it throws.
function textOf(node: BaseNode, prop: PropClass): string {
  try {
    return String(node.getPropInfo(prop).displayValue ?? '');
  } catch {
    return '<unreadable>';
  }
}

// What `node` shows of each row, by key, each by its text (shownProps, textOf).
function rowsOf(node: BaseNode): Map<string, string> {
  const out = new Map<string, string>();
  for (const prop of shownProps(node)) {
    if (!out.has(prop.key)) {
      out.set(prop.key, textOf(node, prop));
    }
  }
  return out;
}

// The text `node` shows of `key`, or undefined where it shows no such row: rowsOf's, of the one row.
function shownOf(node: BaseNode, key: string): string | undefined {
  const prop = shownProps(node).find((p) => p.key === key);
  return prop ? textOf(node, prop) : undefined;
}

// Where the Value of a Simulink.Parameter made (`made`) is not the Value of `source`, compared as the
// variables a MAT reader would hand over for each (matVariableOfNode), or null.
function valueDifference(source: BaseNode, made: BaseNode): string | null {
  // Its value node, or, for a Value with no rows to show (a scalar), the node its value is
  // (ParameterNode._refuseValueForSource builds the same).
  const valueOf = (n: BaseNode): BaseNode | null => {
    const p = n as unknown as { _valueNode?: BaseNode | null; Value?: unknown };
    if (p._valueNode) {
      return p._valueNode;
    }
    return p._valueNode === undefined ? null : NodeRegistry.parseValue(p.Value === undefined ? [] : p.Value, 'Value', null);
  };
  const a = valueOf(source);
  const b = valueOf(made);
  if (!a && !b) {
    return null;
  }
  const path = made.name + '.Value';
  if (!a || !b) {
    return path + ' would be ' + (b ? 'a value' : 'no value') + ' where what was copied holds ' + (a ? 'one' : 'none');
  }
  const va = matVariableOfNode(a, '');
  const vb = matVariableOfNode(b, '');
  if ('why' in va || 'why' in vb) {
    return 'why' in va ? path + ': ' + va.why.replace(/^it is /, 'what was copied is ') : path + ': ' + (vb as { why: string }).why;
  }
  const what = (v: MatVariable) => (v.isComplex ? 'a complex ' : 'a ') + (v.dimensions ?? []).join('x') + ' ' + (v.isLogical ? 'logical' : v.className);
  if (what(va) !== what(vb)) {
    return path + ' is ' + what(va) + ' in what was copied, and a new Simulink.Parameter of a MAT-file is given its Value as the text it shows, '
      + 'which makes ' + what(vb) + ' of it';
  }
  const differs = variableDifference(va, vb, path);
  return differs ? differs + ': the text a new Simulink.Parameter of a MAT-file is given its Value as does not hold it exactly' : null;
}

// What of the property bag of `source`, the copied object, no row of it shows, held to `made`'s, and
// so on down a Bus's element rows: each property the copy holds there, at any depth of the objects it
// holds (a CoderInfo's CustomStorageClass, a LoggingInfo's DataLogging), as `made` holds it, or as
// MATLAB's default of it that a dictionary writes and a MAT-file's object does not hold
// (UNSHOWN_DEFAULTS); or where not, naming the property. What a row shows, rowsDifference holds.
function bagDifference(source: BaseNode, made: BaseNode, path: string, written: Record<string, unknown> = writtenBagOf(made)): string | null {
  const cls = String(made.className ?? '');
  const covered = coveredPaths(made, cls);
  const held = leavesOf(bagOf(made));
  // As the bags spell them, for the kind of each (kindOf): a typed scalar's `Inf` is a number.
  const copiedAsSpelled = leavesOf(bagOf(source), '', new Map(), true);
  const writes = leavesOf(written, '', new Map(), true);
  for (const [at, value] of leavesOf(bagOf(source))) {
    if (covered.some((c) => at === c || at.startsWith(c + '.'))) {
      // A row shows it, and rowsDifference held its text to the copy's; but one text is a number and
      // a text alike (a Bus element's Dimensions `1`, which System Composer saves as the char '1'),
      // and the object made holds what its editor takes, which is no text where it takes numbers.
      const was = copiedAsSpelled.get(at);
      const is = writes.get(at);
      const kinds = [kindOf(was), kindOf(is)];
      if (kinds[0] !== null && kinds[1] !== null && kinds[0] !== kinds[1]) {
        const said = (v: unknown, kind: 'text' | 'numbers') => (kind === 'text' ? 'the text ' : Array.isArray(v) ? 'the numbers ' : 'the number ') + leafText(leafOf(v));
        return path + '.' + at + ' is ' + said(was, kinds[0]) + ' in what was copied, where the object made holds ' + said(is, kinds[1])
          + ': a MAT-file\'s editor of it takes ' + (kinds[1] === 'text' ? 'text' : 'numbers');
      }
      continue;
    }
    const fallback = UNSHOWN_DEFAULTS[cls]?.[at];
    if (sameLeaf(value, held.get(at)) || (fallback !== undefined && sameLeaf(value, fallback))) {
      continue;
    }
    return path + '.' + at + ' is ' + leafText(value) + ' in what was copied, a property no editor of a MAT-file\'s ' + cls + ' writes, '
      + 'where the object made holds ' + (held.has(at) ? leafText(held.get(at)) : 'its default');
  }
  if (cls === 'Simulink.Bus') {
    const elements = elementBagsOf(written);
    for (let i = 0; i < Math.min(source.children.length, made.children.length); i++) {
      const below = bagDifference(source.children[i], made.children[i], path + '.' + made.children[i].name, elements[i] ?? writtenBagOf(made.children[i]));
      if (below) {
        return below;
      }
    }
  }
  return null;
}

// What `node`, an object made, writes of its properties as a copy of it holds them
// (_getSerializedProperties: its bag, with what its edits set on the node written in), or its bag.
function writtenBagOf(node: BaseNode): Record<string, unknown> {
  const write = (node as unknown as { _getSerializedProperties?: () => Record<string, unknown> })._getSerializedProperties;
  return typeof write === 'function' ? write.call(node) : bagOf(node);
}

// The property bag of each element of a Bus's written Elements_internal (writtenBagOf), in order.
function elementBagsOf(written: Record<string, unknown>): (Record<string, unknown> | undefined)[] {
  const elements = (written.Elements_internal as { _elements?: unknown[] } | undefined)?._elements;
  return Array.isArray(elements) ? elements.map((e) => ((e as { _properties?: Record<string, unknown> } | null)?._properties)) : [];
}

// Whether a leaf is text or numbers (a number, or a list of them), or null for anything else.
// Of a leaf as its bag spells it (leavesOf, `asSpelled`): a bare string is text, as is a typed char;
// a number, a list of them, and a typed number of any class (`{_type: 'double', _value: 'Inf'}`, a
// typed list, a MAT stream, complex text) are numbers.
function kindOf(value: unknown): 'text' | 'numbers' | null {
  if (typeof value === 'string') {
    return value === '' ? null : 'text';
  }
  if (typeof value === 'number' || (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'number'))) {
    return 'numbers';
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const type = (value as { _type?: unknown })._type;
    if (typeof type === 'string') {
      return /^(u?int(8|16|32|64)|double|single|logical|cdata|sparse|complex)$/.test(type) ? 'numbers' : /^(char|mxchar)$/.test(type) ? 'text' : null;
    }
  }
  return null;
}

// The paths into `node`'s bag its rows show (bagPathsOf), the saved keys a row shows under another
// name (matObjectEdit.MAT_SHOWN_SAVED_KEYS: a NumericType's FixedExponent, which its FractionLength
// shows; and the Signedness a dictionary saves beside them), and of a Bus its element rows.
function coveredPaths(node: BaseNode, cls: string): string[] {
  const out: string[] = [...MAT_SHOWN_SAVED_KEYS, 'Elements', ...(cls === 'Simulink.NumericType' ? ['Signedness'] : [])];
  for (const prop of shownProps(node)) {
    out.push(...bagPathsOf(cls, prop));
  }
  return out;
}

// The paths into the bag of a node of `cls` its row `prop` reads: a schema row's whole source path
// ('CoderInfo.StorageClass'), any other row's own keys ('Value', 'DocUnits').
function bagPathsOf(cls: string, prop: PropClass): string[] {
  const sourcePath = (getSchema(cls) ?? []).find((p) => p.key === prop.key)?.sourcePath;
  return sourcePath !== undefined ? [sourcePath] : (prop.sourceKeys ?? [prop.nodeProperty ?? prop.key]);
}

// A node's property bag as it holds it (DataNode.serial), or none.
function bagOf(node: BaseNode): Record<string, unknown> {
  return ((node as unknown as { serial?: { _properties?: Record<string, unknown> } }).serial?._properties) ?? {};
}

// Every property of `bag` by its dotted path, into each object it holds (a `{_object_class,
// _properties}`, or an object array of one element, as a binary dictionary spells one), its value a
// leaf: a typed scalar its number or text, anything else as it is; or, `asSpelled`, every leaf as the
// bag spells it.
function leavesOf(bag: Record<string, unknown>, prefix = '', out = new Map<string, unknown>(), asSpelled = false): Map<string, unknown> {
  for (const [key, value] of Object.entries(bag)) {
    if (key === '_id') {
      continue;
    }
    const inner = objectBagOf(value);
    if (inner) {
      leavesOf(inner, prefix + key + '.', out, asSpelled);
    } else {
      out.set(prefix + key, asSpelled ? value : leafOf(value));
    }
  }
  return out;
}

// The property bag of `value` where it is one object (leavesOf), or null.
function objectBagOf(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const o = value as Record<string, unknown>;
  if (typeof o._object_class === 'string' && o._properties && typeof o._properties === 'object') {
    return o._properties as Record<string, unknown>;
  }
  const elements = o._elements;
  if (typeof o._array_class === 'string' && Array.isArray(elements) && elements.length === 1 && elementCount((o._dimensions as number[]) ?? [1, 1]) === 1) {
    const props = (elements[0] as { _properties?: unknown } | null)?._properties;
    return props && typeof props === 'object' ? (props as Record<string, unknown>) : {};
  }
  return null;
}

// A typed scalar (`{_type: 'int32', _value: '-1'}`) as its number, a typed text as its text; else as it is.
function leafOf(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if (typeof o._type === 'string' && typeof o._value === 'string' && Object.keys(o).every((k) => k === '_type' || k === '_value')) {
      // MATLAB's own spelling of a number, `Inf`, `-Inf` and `NaN` among them (numberOf).
      const n = /^u?int(8|16|32|64)$|^double$|^single$/.test(o._type) ? numberOf(o._value) : null;
      return n === null ? o._value : n;
    }
  }
  return value;
}

// Whether two leaves are one value: compared as JSON, but with a number that JSON has no spelling of
// (an infinity, NaN, -0), which it writes as null or 0, as itself.
function sameLeaf(a: unknown, b: unknown): boolean {
  return leafKey(a) === leafKey(b);
}

function leafKey(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0)) ? '\u0000' + (Object.is(v, -0) ? '-0' : String(v)) : v)) ?? 'undefined';
}

// A leaf as a refusal says it: a number as MATLAB writes one (Inf, -Inf, NaN), a list of them in
// brackets, text quoted, anything else as JSON with its numbers so.
function leafText(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isNaN(value) ? 'NaN' : value === Infinity ? 'Inf' : value === -Infinity ? '-Inf' : String(value);
  }
  if (Array.isArray(value) && value.every((v) => typeof v === 'number')) {
    return '[' + value.map(leafText).join(' ') + ']';
  }
  return leafKey(value).replace(/"\\u0000([^"]*)"/g, '$1');
}

// The properties of an object's bag no row shows that a dictionary writes and a MAT-file's object,
// as this package reads one, does not hold, with MATLAB's default of each: what a copy may hold of
// them for the object made, which holds none, to be what was copied. Measured on every Parameter and
// Signal of the repo's text and binary dictionaries.
const CODER_INFO_DEFAULTS = (of: 'Parameter' | 'Signal'): Record<string, unknown> => ({
  'CoderInfo.CustomStorageClass': 'Default',
  'CoderInfo.CSCPackageName': 'Simulink',
  'CoderInfo.ParameterOrSignal': of,
  'CoderInfo.TypeQualifier': '',
  'CoderInfo.IsCSCPackageOverridden': false,
  'CoderInfo.HasCoderInfo': true,
});
const UNSHOWN_DEFAULTS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  'Simulink.Parameter': CODER_INFO_DEFAULTS('Parameter'),
  'Simulink.Signal': {
    ...CODER_INFO_DEFAULTS('Signal'),
    'LoggingInfo.DataLogging': false,
    'LoggingInfo.NameMode': false,
    'LoggingInfo.LoggingName': '',
    'LoggingInfo.DecimateData': false,
    'LoggingInfo.Decimation': 2,
    'LoggingInfo.LimitDataPoints': false,
    'LoggingInfo.MaxPoints': 5000,
  },
};

// ---- What a copy of a variable carries ---------------------------------------------------------

/**
 * Where `payload`, what `node`, a plain value of a MAT-file or of a dictionary, copies as (its
 * serialize()), reads back as another value than the one `node` holds, as a clause, or null where it
 * reads back as it (or `node` is no plain value, which its own paste holds to what it is): read as a
 * dictionary's reader reads a copy (NodeRegistry.parseValue), and held to `node` as landedDifference
 * holds it. An empty of a class or a size a copy does not spell (a MAT-file's int8 0x3, a logical
 * 1x0) reads back as a double 0x0.
 */
export function copyDifference(node: BaseNode, payload: { value: unknown }, ofMatFile: boolean): string | null {
  return node instanceof MatlabVariableNode ? landedDifference(node, NodeRegistry.parseValue(payload.value, node.name, null), ofMatFile) : null;
}

/**
 * Where `landed`, a node of what a copy of `node` became somewhere (a copy read back, an entry a
 * dictionary wrote and read again), is another value than `node`, a plain value, holds, as a clause, or
 * null: both as the variable a MAT reader would hand over (matVariableOfNode); of a MAT-file's
 * variable, the one its save writes (MatlabVariableNode._var), which a container the node ceiling
 * built without its rows still has whole. Null too where either is no plain value.
 */
export function landedDifference(node: BaseNode, landed: BaseNode, ofMatFile: boolean): string | null {
  if (!(node instanceof MatlabVariableNode)) {
    return null;
  }
  const own = matVariableOfNode(node, node.name);
  if ('why' in own) {
    return null;
  }
  const back = matVariableOfNode(landed, node.name);
  return 'why' in back ? null : variableDifference(ofMatFile ? node._var : own, back, node.name);
}

// ---- What a paste changes of the file ----------------------------------------------------------------

/**
 * What of `mat` making an entry can change beside its children, held now: put back by `restore`, where
 * what was made is taken out again (a refusal, the deep refusal), so that the file is what it was; or
 * kept, `settle`. The objects created since the read (`_creation`: what each made was merged into, a
 * copy of the file's subsystem that only grows), what was found of the file's objects with the made
 * ones in the tree (which nodes are one object, by object id: a later creation would be given the id
 * the one taken out had), the last Add's refusal, which a host reads after its Add, and `dirty`.
 */
function fileState(mat: MatNode): { restore: () => void; settle: () => void } {
  const creation = mat._creation;
  const held = creation ? { ...creation, created: new Map(creation.created), rows: new Map(creation.rows) } : undefined;
  const twins = mat._twins;
  const twinOf = mat._twinOf;
  const byId = mat._objectNodesById;
  const rebuilt = mat._rebuilt;
  const addRefused = mat._addRefused;
  const dirty = mat.dirty;
  return {
    restore: () => {
      if (creation && held) {
        Object.assign(creation, held);
        mat._creation = creation;
      } else {
        mat._creation = undefined;
      }
      mat._twins = twins;
      mat._twinOf = twinOf;
      mat._objectNodesById = byId;
      mat._rebuilt = rebuilt;
      mat._addRefused = addRefused;
      mat.dirty = dirty;
    },
    settle: () => {
      mat._addRefused = addRefused;
    },
  };
}

// ---- Words -------------------------------------------------------------------------------------------

function isPayload(payload: unknown): payload is PastePayload {
  return payload !== null && typeof payload === 'object' && typeof (payload as PastePayload).name === 'string' && 'value' in (payload as object);
}

function payloadName(payload: unknown): string {
  const name = payload !== null && typeof payload === 'object' ? (payload as { name?: unknown }).name : undefined;
  return typeof name === 'string' ? name : '';
}

// A refused paste, in words naming the entry and the file: `Cannot paste "x" into "f.mat": …. Nothing was pasted.`
export function cannotPaste(mat: MatNode, name: string, why: string): string {
  return 'Cannot paste ' + (name ? '"' + name + '" ' : '') + 'into "' + mat._namespaceLabel + '": ' + why.replace(/\.$/, '') + '. Nothing was pasted.';
}

// The editor's words (`Cannot edit "x": why.`), as the clause they state.
function editorClause(reason: string): string {
  return reason.replace(/^Cannot edit "[^"]*": /, '').replace(/\.$/, '');
}

// A refusal of the writer's (`Cannot write "x": …. Nothing was written.`), as the clause it states:
// a paste's, and a copy's (DataModel's copyRefusal).
export function writerWhy(e: MatWriteError): string {
  return e.message.replace(/^Cannot (?:write|save) "[^"]*": /, '').replace(/ Nothing was written\.$/, '').replace(/\.$/, '');
}
