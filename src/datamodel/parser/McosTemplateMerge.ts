// Copyright 2026 The MathWorks, Inc.

import { unzlibSync } from 'fflate';
import { parseMatrix } from './MatParser.js';
import { encodeMatVariable, MatWriteError } from './MatWriter.js';
import { MCOS_TEMPLATES } from './mcosTemplates.js';
import {
  addClass,
  addClassSystems,
  addValueCell,
  appendCtorList,
  appendDynamicPropsList,
  appendObjectRow,
  appendPvList,
  classNameOf,
  classSystemsOf,
  createSubsystem,
  descriptorCell,
  internString,
  mapObjectReferences,
  McosValueKind,
  objectReferenceElement,
  readDescriptor,
  readSubsystem,
  replaceValueCell,
  structFields,
  valueCellReferences,
  valueCellUsers,
  type McosDescriptor,
  type McosSubsystemRecords,
  type McosTripleRecord,
} from './McosSubsystemCodec.js';

// A new MCOS object in a MAT-file, made the way MATLAB's own `save -append` makes one: from the
// records MATLAB wrote for a default-constructed object of the class (mcosTemplates.ts, saved by
// MATLAB R2023b), copied into the file's subsystem in the order that save writes them, each
// copied record given the next row of its table. Nothing the file holds is renumbered or
// rewritten; everything is appended.
//
// THE ORDER, as MATLAB's append writes a new object (measured against MATLAB R2023b, R2024b and
// R2027a, and in each byte for byte against its own append of the same object):
//
//   - The object's row is numbered first, before the objects it holds, and its constructor-
//     argument list and property list are numbered next, empty.
//   - Then each triple in order: its name interned, then its value — a string interned, a value
//     cell appended, an object held directly copied (numbered then), an object array copied
//     element by element and its reference cell appended after their cells.
//   - Then the object's class row and its dynamic-property list. Which comes first is the
//     release's: R2023b numbers the list after the class row and after the objects the class's
//     defaults struct holds (a ValueType's BusElement); R2024b and R2027a before it. The
//     templates say which (releaseOrder below).
//   - A class row is new per class per save, even when the file holds the class already: MATLAB
//     writes one class row per class per save, its saved data, alias and defaults the template's
//     (McosAppendSession). Strings are interned against the whole table, first match.
//
// WHAT A TEMPLATE BRINGS. Each template is its release's own records, so they say what that
// release writes and the copy follows them: a property list holding every saved property
// (R2023b writes no defaults struct for these classes), enumerated text as a char cell, a
// dynamic-property list where the template object has one (R2023b gives a `string` one too). A
// Simulink.CoderInfo is a 'handle' opaque in a value cell, its own small blob inside it,
// carried as it is; the file's stream is then said to hold 'handle' objects, as MATLAB's save
// says it (addClassSystems). A blob version other than 4.0 on either side is refused, as is any
// cell that names objects past the reach of a copy (valueCellReferences 'nested').
//
// A BUS'S ELEMENTS. A new Bus gets new BusElements in place of its template's empty Elements
// reference (mergeTemplateObject's `elements`). A Bus the file holds gains and loses them through
// its Elements reference cell alone (addBusElements, removeBusElement): MATLAB's own append writes
// the whole Bus again, as a new object, which would change what names it.
//
// WHAT IT RETURNS is what a new top-level variable needs: the root object's id and class row and
// the object reference a class-17 variable element holds (newObjectVariable). Adding that
// variable to the file, and writing the subsystem through verifySubsystem, is the writer's.

/**
 * The classes a new `.mat` variable can be created as here: every one with a template, but the
 * BusElement, which is created only inside a Bus (mergeTemplateObject's `elements`,
 * addBusElements). What a host offers to create in a MAT-file.
 */
export const CREATABLE_MCOS_CLASSES: readonly string[] = Object.freeze(Object.keys(MCOS_TEMPLATES).filter((c) => c !== 'Simulink.BusElement'));

const BUS = 'Simulink.Bus';
const BUS_ELEMENT = 'Simulink.BusElement';
const ELEMENTS = 'Elements_internal';

/** The class rows one save has added, by class: MATLAB's append writes one per class per save. */
export interface McosAppendSession {
  classes: Map<string, number>;
}

/** A save's session: hand the same one to every merge of one save, as MATLAB shares its rows. */
export function createAppendSession(): McosAppendSession {
  return { classes: new Map() };
}

/** A new object merged into a subsystem: its id, its class row, and what its variable holds. */
export interface McosNewObject {
  objectId: number;
  classIndex: number;
  // The class the variable shows ('Simulink.Parameter', 'string').
  className: string;
  descriptor: McosDescriptor;
}

/** The class-17 element of a new top-level variable `name` holding `obj`. */
export function newObjectVariable(name: string, obj: McosNewObject): Uint8Array {
  return objectReferenceElement(name, obj.className, obj.descriptor);
}

export interface McosMergeOptions {
  session?: McosAppendSession;
  // For a Simulink.Bus: its elements, new BusElements named so, in order. Names must be unique,
  // which MATLAB checks of every assignment to Elements.
  elements?: readonly string[];
}

const parsed = new Map<string, McosSubsystemRecords>();

/** The template of `className`, as records. Read once; never written to (copies read from it). */
function templateOf(className: string): McosSubsystemRecords {
  const asset = MCOS_TEMPLATES[className];
  if (!asset) {
    throw new MatWriteError(`no template for ${className}: a new object can be created only as ${CREATABLE_MCOS_CLASSES.join(', ')}`);
  }
  let sub = parsed.get(className);
  if (!sub) {
    const r = readSubsystem(unzlibSync(decodeBase64(asset.subsystem)));
    if (!r.ok) {
      throw new MatWriteError(`the ${className} template does not read (${r.reason}): ${r.message}`);
    }
    sub = r.subsystem;
    parsed.set(className, sub);
  }
  return sub;
}

/**
 * An empty subsystem in the templates' shape, for a file that has none: what MATLAB's append
 * writes into such a file before the new object. Every template's layers, blob version and
 * sections are the same; only the class systems its stream says it holds differ, and the
 * `string` template's are MCOS alone. So the shape is that, whatever `className` (which must have
 * a template), and each merge gives the stream the class systems its object brings
 * (addClassSystems): a subsystem whose 'handle' object was merged and dropped again is never said
 * to hold one.
 */
export function createTemplateSubsystem(className: string): McosSubsystemRecords {
  templateOf(className);
  return createSubsystem(templateOf('string'));
}

/**
 * A new object of `className`, default-constructed, merged into `sub`: every record of the
 * template copied in MATLAB's order, with a class row per class new to `options.session`.
 * Returns its id, class row and the reference its variable holds. Throws MatWriteError, having
 * changed nothing, for a class with no template, a subsystem of another blob version, or
 * `elements` for a class that is not a Bus or naming an element twice.
 */
export function mergeTemplateObject(sub: McosSubsystemRecords, className: string, options: McosMergeOptions = {}): McosNewObject {
  const asset = MCOS_TEMPLATES[className];
  if (!asset || !CREATABLE_MCOS_CLASSES.includes(className)) {
    throw new MatWriteError(`no template for ${className}: a new object can be created only as ${CREATABLE_MCOS_CLASSES.join(', ')}`);
  }
  if (options.elements && className !== BUS) {
    throw new MatWriteError(`a ${className} has no elements`);
  }
  uniqueNames(options.elements ?? []);
  const template = templateOf(className);
  sameVersion(sub, template);
  const session = options.session ?? createAppendSession();
  return undoneOnThrow(sub, session, () => mergeInto(sub, asset, template, session, options.elements ?? []));
}

/** mergeTemplateObject's copy, once its refusals that need no copy are made. */
function mergeInto(sub: McosSubsystemRecords, asset: (typeof MCOS_TEMPLATES)[string], template: McosSubsystemRecords, session: McosAppendSession, elements: readonly string[]): McosNewObject {
  const copy = new Copier(sub, session);
  const src = new Source(template);
  // A new Bus's elements go where the template's empty Elements reference is: copied first, then
  // the reference to them, as the template's own triple would have been.
  const overrides: Overrides = elements.length === 0 ? {} : {
    [ELEMENTS]: (name) => {
      const ids = copy.elements(elements, null);
      const classIndex = copy.classRow(new Source(templateOf(BUS_ELEMENT)), MCOS_TEMPLATES[BUS_ELEMENT].classIndex);
      return { name, flag: McosValueKind.cell, value: addValueCell(sub, descriptorCell({ dims: elementDims(ids.length), ids, classIndex })) };
    },
  };
  const objectId = copy.object(src, asset.ids[0], overrides);
  const classIndex = copy.classRow(src, asset.classIndex);
  addClassSystems(sub, classSystemsOf(template) ?? []);
  return { objectId, classIndex, className: asset.variableClass, descriptor: { dims: [...asset.dims], ids: [objectId], classIndex } };
}

/** The ids of the elements of Bus object `busId`, in order. */
export function busElementsOf(sub: McosSubsystemRecords, busId: number): number[] {
  return [...readDescriptor(sub.values[elementsCell(sub, busId)])!.ids];
}

/**
 * New BusElements named `names` appended to Bus object `busId`, which the file holds already;
 * returns their ids. MATLAB's append would write the whole Bus again; this appends the elements'
 * records and replaces the Bus's Elements reference cell in place, naming the old elements and
 * then the new, so nothing that names the Bus changes. A reference names one class row for all
 * its elements, so the new ones take the file's BusElement row, their property lists made right
 * against that row's defaults (a property saved exactly when it differs). Measured against
 * MATLAB R2023b, R2024b and R2027a, into Buses each of them wrote: loads equal to the Bus
 * MATLAB's own edit saves.
 */
export function addBusElements(sub: McosSubsystemRecords, busId: number, names: readonly string[], options: { session?: McosAppendSession } = {}): number[] {
  const k = elementsCell(sub, busId);
  const old = readDescriptor(sub.values[k])!;
  const ci = old.classIndex!;
  uniqueNames([...old.ids.map((id) => savedText(sub, id, 'Name')), ...names]);
  const template = templateOf(BUS_ELEMENT);
  sameVersion(sub, template);
  const session = options.session ?? createAppendSession();
  return undoneOnThrow(sub, session, () => {
    const ids = new Copier(sub, session).elements(names, ci);
    const all = [...old.ids, ...ids];
    replaceValueCell(sub, k, descriptorCell({ dims: elementDims(all.length), ids: all, classIndex: ci }), { objectReference: true });
    return ids;
  });
}

/**
 * `fn`'s result; or, when it throws, `sub` and `session` put back as they were before it and the
 * error thrown on: every table it appended to cut back to its length, the value cells and the
 * stream's trailing element restored. Every copy only appends (and a Bus's Elements cell is
 * replaced last), so a merge refused part-way, by a class system the stream cannot be given or a
 * template cell past a copy's reach, changes nothing.
 */
function undoneOnThrow<T>(sub: McosSubsystemRecords, session: McosAppendSession, fn: () => T): T {
  const b = sub.blob;
  const tables: unknown[][] = [b.strings, b.classes, b.ctorLists, b.objects, b.pvLists, b.dynamicProps,
    ...[sub.packages, sub.classData, sub.aliases, sub.defaults].flatMap((c) => (c ? [c.entries as unknown[]] : []))];
  const lengths = tables.map((t) => t.length);
  const values = sub.values.slice();
  const rest = sub.rest;
  const classes = new Map(session.classes);
  try {
    return fn();
  } catch (e) {
    tables.forEach((t, i) => {
      t.length = lengths[i];
    });
    sub.values.length = 0;
    for (const v of values) sub.values.push(v);
    sub.rest = rest;
    session.classes.clear();
    for (const [name, row] of classes) session.classes.set(name, row);
    throw e;
  }
}

/**
 * Element `index` (0-based) taken out of Bus object `busId`; returns its id. Its records stay,
 * named by nothing, as MATLAB's own appends leave the objects they replace; the Bus's Elements
 * reference cell is replaced in place without it, 0x0 once it held the last (as MATLAB saves an
 * emptied Bus, class row kept).
 */
export function removeBusElement(sub: McosSubsystemRecords, busId: number, index: number): number {
  const k = elementsCell(sub, busId);
  const old = readDescriptor(sub.values[k])!;
  if (!Number.isInteger(index) || index < 0 || index >= old.ids.length) {
    throw new MatWriteError(`the Bus has ${old.ids.length} elements, and no element ${index}`);
  }
  const ids = old.ids.filter((_, i) => i !== index);
  replaceValueCell(sub, k, descriptorCell({ dims: elementDims(ids.length), ids, classIndex: old.classIndex }), { objectReference: true });
  return old.ids[index];
}

// ---- The copy -------------------------------------------------------------------------------------

/** A template being copied: its records, and the row each of its objects got in the target. */
class Source {
  readonly ids = new Map<number, number>();
  constructor(readonly sub: McosSubsystemRecords) {}
}

/** Per triple, by saved name, a value to write in place of the template's: (name) => triple. */
type Overrides = Record<string, (name: number) => McosTripleRecord>;

class Copier {
  private readonly ipAfterClass: boolean;

  constructor(
    private readonly sub: McosSubsystemRecords,
    private readonly session: McosAppendSession,
  ) {
    this.ipAfterClass = releaseOrder().ipAfterClass;
  }

  /** Object `tid` of `src`, copied with its lists, triples and class row; returns its new id. */
  object(src: Source, tid: number, overrides: Overrides = {}, drop: ReadonlySet<string> = new Set()): number {
    const done = src.ids.get(tid);
    if (done !== undefined) {
      return done;
    }
    const t = src.sub.blob;
    const row = t.objects[tid];
    if (row.child || row.sibling || (row.dynamicProps && t.dynamicProps[row.dynamicProps].length) || (t.removedProps ?? []).some((r) => r.objectId === tid)) {
      throw new MatWriteError(`the ${classNameOf(src.sub, row.classIndex)} template holds what a copy is not measured on: linked objects, dynamic properties or removed ones`);
    }
    const id = appendObjectRow(this.sub);
    src.ids.set(tid, id);
    const ctor = row.ctorList ? appendCtorList(this.sub) : 0;
    const pv = row.pvList ? appendPvList(this.sub) : 0;
    if (row.ctorList) {
      for (const tr of t.ctorLists[row.ctorList]) this.sub.blob.ctorLists[ctor].push(this.triple(src, tr, {}));
    }
    if (row.pvList) {
      for (const tr of t.pvLists[row.pvList]) {
        if (!drop.has(t.strings[tr.name])) this.sub.blob.pvLists[pv].push(this.triple(src, tr, overrides));
      }
    }
    let classIndex = 0;
    let dynamicProps = 0;
    if (this.ipAfterClass) classIndex = this.classRow(src, row.classIndex);
    if (row.dynamicProps) dynamicProps = appendDynamicPropsList(this.sub);
    if (!this.ipAfterClass) classIndex = this.classRow(src, row.classIndex);
    Object.assign(this.sub.blob.objects[id], { classIndex, ctorList: ctor, pvList: pv, dynamicProps });
    return id;
  }

  private triple(src: Source, tr: McosTripleRecord, overrides: Overrides): McosTripleRecord {
    const t = src.sub.blob;
    const saved = t.strings[tr.name];
    const name = internString(this.sub, saved);
    const override = overrides[saved];
    if (override) {
      return override(name);
    }
    switch (tr.flag) {
      case McosValueKind.string:
        return { name, flag: tr.flag, value: internString(this.sub, t.strings[tr.value]) };
      case McosValueKind.integer:
        return { name, flag: tr.flag, value: tr.value };
      case McosValueKind.object:
        return { name, flag: tr.flag, value: this.object(src, tr.value) };
      case McosValueKind.cell:
        return { name, flag: tr.flag, value: addValueCell(this.sub, this.cell(src, src.sub.values[tr.value], saved)) };
      default:
        throw new MatWriteError(`the template's ${saved} is of value kind ${tr.flag}`);
    }
  }

  /** A template value cell as the target holds it: as it is, or an object reference written again. */
  private cell(src: Source, cell: Uint8Array, saved: string): Uint8Array {
    const refs = valueCellReferences(cell);
    if (refs === 'nested') {
      throw new MatWriteError(`the template's ${saved} names objects inside its value, which a copy cannot reach`);
    }
    // The template's bytes are read once for the process: what goes into a record is a copy.
    return refs === 'none' ? cell.slice() : descriptorCell(this.reference(src, readDescriptor(cell)!));
  }

  /** A template's object reference, its objects copied first and then its class row. */
  private reference(src: Source, d: McosDescriptor): McosDescriptor {
    const ids = d.ids.map((id) => (id ? this.object(src, id) : 0));
    return { dims: [...d.dims], ids, classIndex: d.classIndex === null ? null : this.classRow(src, d.classIndex) };
  }

  /** The session's row for class `ci` of `src`, a new one with the template's entries when it has none. */
  classRow(src: Source, ci: number): number {
    const name = classNameOf(src.sub, ci);
    const have = this.session.classes.get(name);
    if (have !== undefined) {
      return have;
    }
    const t = src.sub;
    const alias = t.aliases?.entries[ci] ? t.blob.strings[t.aliases.entries[ci]] : undefined;
    const defaults = t.defaults?.entries[ci]?.slice();
    const row = addClass(this.sub, { name, version: t.blob.classes[ci].version, classData: t.classData?.entries[ci]?.slice(), defaults, ...(alias ? { alias } : {}) });
    this.session.classes.set(name, row);
    // The objects a defaults struct holds (a ValueType's BusElement) are copied too, after the
    // class row, and the struct written again naming their new rows, as MATLAB's append does.
    if (defaults && valueCellReferences(defaults) !== 'none') {
      this.sub.defaults!.entries[row] = mapObjectReferences(defaults, (d) => this.reference(src, d));
    }
    return row;
  }

  /**
   * New BusElements named `names`, copied from the BusElement template in order; returns their
   * ids. In class row `fileRow`, an existing Bus's, their property lists made right against its
   * defaults (rebased); with null, in the session's row, as the elements of a new Bus.
   */
  elements(names: readonly string[], fileRow: number | null): number[] {
    const asset = MCOS_TEMPLATES[BUS_ELEMENT];
    const had = this.session.classes.get(BUS_ELEMENT);
    if (fileRow !== null) this.session.classes.set(BUS_ELEMENT, fileRow);
    try {
      return names.map((n) => {
        const src = new Source(templateOf(BUS_ELEMENT));
        const drop = fileRow === null ? new Set<string>() : rebased(src.sub, asset.ids[0], this.sub, fileRow);
        // The template's own Name cell is kept for its own name ('a'), MATLAB's bytes for it.
        const named: Overrides = n === savedText(src.sub, asset.ids[0], 'Name') ? {} : { Name: (name) => ({ name, flag: McosValueKind.cell, value: addValueCell(this.sub, charCell(n)) }) };
        return this.object(src, asset.ids[0], named, drop);
      });
    } finally {
      if (fileRow !== null) {
        if (had === undefined) this.session.classes.delete(BUS_ELEMENT);
        else this.session.classes.set(BUS_ELEMENT, had);
      }
    }
  }
}

// ---- Helpers --------------------------------------------------------------------------------------

/**
 * The saved names of the BusElement template's triples to leave out when its copy takes the
 * file's class row `fileRow`: those whose value is that row's default, which MATLAB saves no
 * triple for. The template's own defaults struct must then say nothing the file's does not:
 * R2023b's says nothing at all.
 */
function rebased(t: McosSubsystemRecords, tid: number, sub: McosSubsystemRecords, fileRow: number): Set<string> {
  const drop = new Set<string>();
  const own = structFields(t.defaults!.entries[t.blob.objects[tid].classIndex]);
  const theirs = structFields(sub.defaults?.entries[fileRow] ?? new Uint8Array(0)) ?? [];
  if (own === null || own.length > 0) {
    throw new MatWriteError("the BusElement template's defaults struct is not the empty one a copy into another class row is measured on");
  }
  for (const tr of t.blob.pvLists[t.blob.objects[tid].pvList]) {
    const saved = t.blob.strings[tr.name];
    const d = theirs.find((f) => f.name === saved);
    if (tr.flag === McosValueKind.cell && d && sameBytes(t.values[tr.value], d.value)) drop.add(saved);
  }
  return drop;
}

/** The value index of Bus object `busId`'s Elements reference, a cell no other triple names. */
function elementsCell(sub: McosSubsystemRecords, busId: number): number {
  const row = sub.blob.objects[busId];
  if (!row || busId < 1 || classNameOf(sub, row.classIndex) !== BUS || !row.pvList) {
    throw new MatWriteError(`object ${busId} is not a Simulink.Bus saved by its properties`);
  }
  const tr = sub.blob.pvLists[row.pvList].find((x) => sub.blob.strings[x.name] === ELEMENTS);
  const d = tr && tr.flag === McosValueKind.cell ? readDescriptor(sub.values[tr.value]) : null;
  if (!tr || !d || d.classIndex === null || classNameOf(sub, d.classIndex) !== BUS_ELEMENT || d.ids.some((id) => id < 1)) {
    throw new MatWriteError("the Bus's elements are not a reference to BusElements of one class row, the shape MATLAB saves");
  }
  if (valueCellUsers(sub, tr.value) > 1) {
    throw new MatWriteError("the Bus's elements cell is named by another triple as well");
  }
  return tr.value;
}

/** The text object `id` saves property `saved` as, or '' when it saves no char row there. */
function savedText(sub: McosSubsystemRecords, id: number, saved: string): string {
  const row = sub.blob.objects[id];
  const tr = row?.pvList ? sub.blob.pvLists[row.pvList].find((x) => sub.blob.strings[x.name] === saved) : undefined;
  if (!tr || tr.flag !== McosValueKind.cell) {
    return '';
  }
  const cell = sub.values[tr.value];
  try {
    const v = parseMatrix(new DataView(cell.buffer, cell.byteOffset, cell.byteLength), 8, cell.length - 8);
    return v.className === 'char' && typeof v.value === 'string' ? v.value : '';
  } catch {
    return '';
  }
}

/** A Bus's Elements as MATLAB stores them: a column, whatever was assigned; 0x0 when none. */
function elementDims(n: number): number[] {
  return n ? [n, 1] : [0, 0];
}

function uniqueNames(names: readonly string[]): void {
  for (const [i, n] of names.entries()) {
    if (!n || names.indexOf(n) !== i) {
      throw new MatWriteError(n ? `a Bus cannot hold two elements named '${n}'` : 'a Bus element needs a name');
    }
  }
}

function sameVersion(sub: McosSubsystemRecords, template: McosSubsystemRecords): void {
  const [a, b] = [sub.blob, template.blob];
  if (a.major !== 4 || a.minor !== 0 || b.major !== a.major || b.minor !== a.minor) {
    throw new MatWriteError(`a subsystem of blob version ${a.major}.${a.minor} is not one a template of version ${b.major}.${b.minor} is merged into`);
  }
}

/** The value cell of char row `text`, as MATLAB saves a property's text. */
function charCell(text: string): Uint8Array {
  return encodeMatVariable({ name: '', className: 'char', dimensions: [1, text.length], value: text, isComplex: false, isLogical: false, fields: null });
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

let order: { ipAfterClass: boolean } | null = null;

/**
 * Which the templates' release numbers first, an object's class row or its dynamic-property
 * list: the ValueType template says, since its defaults struct holds a BusElement, and the
 * release that numbers the class row first (and with it that BusElement) gives the BusElement
 * the lower list.
 */
function releaseOrder(): { ipAfterClass: boolean } {
  if (!order) {
    const t = templateOf('Simulink.ValueType');
    const root = MCOS_TEMPLATES['Simulink.ValueType'].ids[0];
    const others = t.blob.objects.filter((o, i) => i > 0 && i !== root && o.dynamicProps);
    order = { ipAfterClass: others.length > 0 && t.blob.objects[root].dynamicProps > Math.max(...others.map((o) => o.dynamicProps)) };
  }
  return order;
}

// Base64, decoded here rather than through atob/Buffer: this package is consumed in both Node
// and a browser, and neither global is available in both.
const B64 = (() => {
  const table = new Int8Array(256).fill(-1);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i;
  return table;
})();

function decodeBase64(text: string): Uint8Array {
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const v = B64[text.charCodeAt(i) & 0xff];
    if (v < 0) continue;
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.slice(0, n);
}
