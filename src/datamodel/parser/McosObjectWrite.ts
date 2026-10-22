// Copyright 2026 The MathWorks, Inc.

import { parseMatrix } from './MatParser.js';
import type { MatVariable } from './MatParser.js';
import { MatWriteError } from './MatWriter.js';
import {
  McosValueKind,
  classNameOf,
  cloneSubsystem,
  editHandleCoderInfo,
  insertPvTriple,
  internString,
  propertiesOf,
  readDescriptor,
  readHandleOpaque,
  removePvTriple,
  setProperty,
  valueCellUsers,
  verifySubsystem,
  writeSubsystem,
  type McosCoderInfoSettings,
  type McosSubsystemRecords,
} from './McosSubsystemCodec.js';
import { valueCellOf } from './McosSubsystemEdit.js';
import { publicNameOf } from './McosPropertyRules.js';
import type { McosHeldValue, McosRuleObject, McosTripleOp } from './McosPropertyRules.js';

// The objects of a MAT-file's subsystem as the property rules (McosPropertyRules) read them, and
// their edits written into the subsystem's records through McosSubsystemCodec: a value cell
// swapped, a triple inserted for a property that was at its default, a triple removed for one set
// back to it, each the way MATLAB's own save appends what it adds (the codec's APPEND ONLY). Then
// the subsystem is written from the records and read back against them (verifySubsystem), and only
// then handed to the save, which splices it in as the file's last record.
//
// One path for every object edit of a MAT-file: a cell swap is the case of it that adds nothing,
// and writes the bytes the swap always wrote.

/** The value a whole miMATRIX element holds, read as MatParser reads a matrix, or null where it does not read. */
export function elementValue(element: Uint8Array): MatVariable | null {
  if (element.byteLength < 8) {
    return null;
  }
  const view = new DataView(element.buffer, element.byteOffset, element.byteLength);
  try {
    return parseMatrix(view, 8, view.getUint32(4, true));
  } catch {
    return null;
  }
}

/**
 * What the rules read of object `objectId`: its class, every triple of its property list by saved
 * name, and the fields of its class's defaults struct in the file (the entry of the per-class
 * defaults cell for its class row), which is what an omitted property loads as.
 */
export function ruleObjectOf(sub: McosSubsystemRecords, objectId: number): McosRuleObject {
  const row = sub.blob.objects[objectId];
  if (!row || objectId < 1) {
    throw new MatWriteError(`object ${objectId} is not one of the ${sub.blob.objects.length - 1} the subsystem holds`);
  }
  const held = new Map<string, McosHeldValue>();
  for (const p of propertiesOf(sub, objectId)) {
    const value: McosHeldValue =
      p.flag === McosValueKind.string
        ? { kind: 'str', text: sub.blob.strings[p.value] ?? '' }
        : p.flag === McosValueKind.integer
          ? { kind: 'int', value: p.value }
          : p.flag === McosValueKind.cell
            ? { kind: 'cell', value: heldCellValue(sub, p.value) }
            : { kind: 'other' };
    held.set(p.savedName, value);
  }
  return { className: classNameOf(sub, row.classIndex), held, defaults: defaultsOf(sub, row.classIndex) };
}

// A value cell's value, or null for one that does not read or holds objects (a descriptor), which
// is no value an edit replaces.
function heldCellValue(sub: McosSubsystemRecords, valueIndex: number): MatVariable | null {
  const cell = sub.values[valueIndex];
  if (!cell || readDescriptor(cell)) {
    return null;
  }
  return elementValue(cell);
}

/**
 * What the rules read of the object a 'handle' opaque value cell holds (a CoderInfo saved by MATLAB
 * R2024b or earlier, or from the R2023b templates): object 1 of its own small blob, its class and
 * its triples; no defaults struct, since such an object saves every property. Or why not, as a
 * clause: an opaque that does not read whole.
 */
export function handleRuleObjectOf(cell: Uint8Array): McosRuleObject | string {
  const read = readHandleOpaque(cell);
  if (!read.ok) {
    return "its 'handle' opaque does not read as one this editor writes (" + read.message + ')';
  }
  const h = read.opaque;
  const b = h.blob;
  const row = b.objects[1];
  const cls = row ? b.classes[row.classIndex] : undefined;
  if (!row || !cls) {
    return "its 'handle' opaque holds no object";
  }
  const held = new Map<string, McosHeldValue>();
  for (const t of row.pvList ? b.pvLists[row.pvList] ?? [] : []) {
    const name = b.strings[t.name] ?? '';
    const cellValue = t.flag === McosValueKind.cell ? h.values[t.value] : undefined;
    held.set(
      name,
      t.flag === McosValueKind.string
        ? { kind: 'str', text: b.strings[t.value] ?? '' }
        : t.flag === McosValueKind.integer
          ? { kind: 'int', value: t.value }
          : t.flag === McosValueKind.cell
            ? { kind: 'cell', value: cellValue && !readDescriptor(cellValue) ? elementValue(cellValue) : null }
            : { kind: 'other' },
    );
  }
  const className = (cls.namespace ? b.strings[cls.namespace] + '.' : '') + b.strings[cls.name];
  return { className, held, defaults: new Map(), handle: true };
}

/** The fields of class row `classIndex`'s defaults struct, read; none where the file holds no 1x1 struct there. */
export function defaultsOf(sub: McosSubsystemRecords, classIndex: number): Map<string, MatVariable> {
  const out = new Map<string, MatVariable>();
  const entry = sub.defaults?.entries[classIndex];
  const v = entry ? elementValue(entry) : null;
  if (!v || v.className !== 'struct' || !v.fields || (v.dimensions ?? []).reduce((a, b) => a * b, 1) !== 1) {
    return out;
  }
  for (const [name, field] of Object.entries(v.fields)) {
    if (!Array.isArray(field) && field) {
      out.set(name, field);
    }
  }
  return out;
}

/**
 * The ids of the objects property `savedName` of object `objectId` holds: the objects its value
 * cell names (a nested object, an array of them: a Bus's Elements_internal), or the one object
 * its triple names; null where it holds none.
 */
export function heldObjectIds(sub: McosSubsystemRecords, objectId: number, savedName: string): number[] | null {
  const p = propertiesOf(sub, objectId).find((t) => t.savedName === savedName);
  if (!p) {
    return null;
  }
  if (p.flag === McosValueKind.object) {
    return [p.value];
  }
  const d = p.flag === McosValueKind.cell && sub.values[p.value] ? readDescriptor(sub.values[p.value]) : null;
  return d ? d.ids : null;
}

/**
 * `ops` made on object `objectId` of `sub`, in place and in order, through the codec's edits: a
 * value set into a cell swaps the cell the triple names, or inserts a triple naming a new cell
 * appended after every other; a text or an integer set replaces its triple in place, or inserts
 * one; a removal takes the triple out and leaves its cell, which nothing names any more. Throws
 * MatWriteError, having made the ops before it, for one the codec refuses (a cell another triple
 * names too), or a value cell this package cannot write, naming the property as a user does.
 */
export function applyTripleOps(sub: McosSubsystemRecords, objectId: number, ops: readonly McosTripleOp[]): void {
  const named = (op: McosTripleOp) => publicNameOf(classNameOf(sub, sub.blob.objects[objectId]?.classIndex ?? 0), op.savedName);
  for (const op of ops) {
    if (op.op === 'remove') {
      removePvTriple(sub, objectId, op.savedName);
      continue;
    }
    if (op.kind === 'cell') {
      const held = propertiesOf(sub, objectId).find((t) => t.savedName === op.savedName);
      if (held && held.flag === McosValueKind.cell && (!sub.values[held.value] || readDescriptor(sub.values[held.value]))) {
        throw new MatWriteError(`${named(op)} holds objects, which an edit of its value does not replace`);
      }
      if (held && held.flag === McosValueKind.cell && valueCellUsers(sub, held.value) > 1) {
        throw new MatWriteError(`${named(op)} holds its value in one place with another property, which writing it would change too`);
      }
      setProperty(sub, objectId, op.savedName, valueCellOf(op.value));
      continue;
    }
    const flag = op.kind === 'str' ? McosValueKind.string : McosValueKind.integer;
    const list = propertiesOf(sub, objectId);
    const at = list.findIndex((t) => t.savedName === op.savedName);
    if (at >= 0 && list[at].flag !== flag) {
      throw new MatWriteError(`${named(op)} is held as another kind of value than the one written`);
    }
    if (op.kind === 'int' && !(Number.isInteger(op.value) && op.value >= 0 && op.value <= 0xffffffff)) {
      throw new MatWriteError(`${named(op)} would be ${op.value}, which is not a whole number from 0 to 4294967295`);
    }
    // A triple replaced keeps the index of its own name.
    const name = at >= 0 ? sub.blob.pvLists[sub.blob.objects[objectId].pvList][at].name : internString(sub, op.savedName);
    const value = op.kind === 'str' ? internString(sub, op.text) : op.value;
    if (at >= 0) {
      removePvTriple(sub, objectId, op.savedName);
    }
    insertPvTriple(sub, objectId, { name, flag, value }, at >= 0 ? at : undefined);
  }
}

/**
 * `ops` made on the CoderInfo a 'handle' opaque holds, the value of property `saved` of object
 * `ownerId`: the opaque rebuilt with its StorageClass, Identifier (saved as Alias) and Alignment as
 * the ops set them, as MATLAB's own save writes it (McosSubsystemCodec.editHandleCoderInfo), and the
 * owner's value cell swapped for it. Throws MatWriteError for what the codec refuses, or an op on
 * any other property.
 */
export function applyHandleOps(sub: McosSubsystemRecords, ownerId: number, saved: string, ops: readonly McosTripleOp[]): void {
  const t = propertiesOf(sub, ownerId).find((p) => p.savedName === saved && p.flag === McosValueKind.cell);
  if (!t) {
    throw new MatWriteError(`object ${ownerId} holds no ${saved}`);
  }
  const edits: Partial<McosCoderInfoSettings> = {};
  for (const op of ops) {
    if (op.op === 'remove') {
      throw new MatWriteError(`${saved}.${publicNameOf('Simulink.CoderInfo', op.savedName)} is always saved, and is not removed`);
    }
    const text = op.kind === 'str' ? op.text : op.kind === 'cell' && typeof op.value.value === 'string' ? op.value.value : op.kind === 'cell' && (op.value.dimensions ?? []).includes(0) ? '' : null;
    const number = op.kind === 'int' ? op.value : op.kind === 'cell' && typeof op.value.value === 'number' ? op.value.value : null;
    if (op.savedName === 'StorageClass' && text !== null) {
      edits.StorageClass = text;
    } else if (op.savedName === 'Alias' && text !== null) {
      edits.Identifier = text;
    } else if (op.savedName === 'Alignment' && number !== null) {
      edits.Alignment = number;
    } else {
      throw new MatWriteError(`${saved}.${publicNameOf('Simulink.CoderInfo', op.savedName)} is not one of the properties an edit writes of a CoderInfo held as this one is`);
    }
  }
  const edited = editHandleCoderInfo(sub.values[t.value], edits);
  if (!edited.ok) {
    throw new MatWriteError(`${saved} could not be edited (${edited.message})`);
  }
  setProperty(sub, ownerId, saved, edited.cell, undefined, { handleOpaque: true });
}

/**
 * The ops of each object of one save, by object id; of the CoderInfo of a 'handle' opaque, by the
 * id of the object that holds it and the property it is (`handleOf`, 'CoderInfo').
 */
export interface McosObjectOps {
  objectId: number;
  ops: readonly McosTripleOp[];
  handleOf?: string;
}

/**
 * The subsystem `records` hold with `objects`' ops made, written, and read back against the
 * records meant (verifySubsystem): its element, and those records; or why not, as a clause.
 * `records` are left as they were. `more`, when given, makes the save's other edits of the records
 * (a `string` variable's) before the subsystem is written, and `also` names the objects and
 * properties it writes. The element is held to the edited records, and they to `records`, every
 * object and property no edit names as it was (editedObjects), unless `verify` is false: a save's
 * self-check verifies the element as it lands in the file (MatFileWriter.subsystemRecordsDiffer),
 * once.
 */
export function writeObjectEdits(
  records: McosSubsystemRecords,
  objects: readonly McosObjectOps[],
  more?: (sub: McosSubsystemRecords) => void,
  also: readonly McosEditedObject[] = [],
  verify = true,
): { ok: true; element: Uint8Array; records: McosSubsystemRecords } | { ok: false; message: string } {
  const sub = cloneSubsystem(records);
  let element: Uint8Array;
  try {
    for (const { objectId, ops, handleOf } of objects) {
      if (handleOf) {
        applyHandleOps(sub, objectId, handleOf, ops);
      } else {
        applyTripleOps(sub, objectId, ops);
      }
    }
    more?.(sub);
    element = writeSubsystem(sub);
  } catch (e) {
    if (e instanceof MatWriteError) {
      return { ok: false, message: e.message };
    }
    throw e;
  }
  const verdict = verify ? verifySubsystem(element, sub, records, { edited: editedObjects(objects, also) }) : ({ ok: true } as const);
  return verdict.ok ? { ok: true, element, records: sub } : { ok: false, message: verdict.message };
}

/**
 * The objects of a subsystem `objects`' ops and `also` edit, each with the saved names of the
 * properties they write: of a 'handle' opaque, the property holding it; of an object saved as one
 * payload (a `string`), 'any'. What the codec holds a written subsystem's edits to
 * (verifySubsystem's `edited`): every other object, property and value cell as it was read.
 */
export function editedObjects(objects: readonly McosObjectOps[], also: readonly McosEditedObject[] = []): McosEditedObject[] {
  const byId = new Map<number, Set<string>>();
  const add = (objectId: number, names: readonly string[]) => {
    const set = byId.get(objectId) ?? new Set<string>();
    names.forEach((n) => set.add(n));
    byId.set(objectId, set);
  };
  for (const { objectId, ops, handleOf } of objects) {
    add(objectId, handleOf ? [handleOf] : ops.map((o) => o.savedName));
  }
  for (const { objectId, properties } of also) {
    add(objectId, properties);
  }
  return [...byId].map(([objectId, names]) => ({ objectId, properties: [...names] }));
}

/** An object a save's edits write, and the saved names of the properties they write of it. */
export interface McosEditedObject {
  objectId: number;
  properties: readonly string[];
}
