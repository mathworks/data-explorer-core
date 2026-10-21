// Copyright 2026 The MathWorks, Inc.

import { parseMatrix } from './MatParser.js';
import type { MatVariable } from './MatParser.js';
import { encodeMatVariable } from './MatWriter.js';
import { MCOS_HANDLE_MAGIC, objectHandleFromValue } from './McosHandle.js';

// Changes properties of one MCOS object in a MAT subsystem by replacing only the value
// cells that hold them. Every other byte of the subsystem stays as it was read, the
// metadata blob included, so every offset and index in it stays what MATLAB wrote.
//
// WHERE THE BYTES COME FROM. The subsystem is one uint8 [1 N] miMATRIX element, inflated,
// tag included: a .mat's anonymous last record (MatParser keeps it as the anonymous
// variable's `_rawBytes`), and in a MAT stream — a binary dictionary's hex, a text one's
// cdata, a model workspace — the uncompressed element after the value (decodeMatStream's
// `trailingElements[0]`). Its payload is a MAT stream of its own:
//
//   uint8 [1 N] element
//     └ 8-byte preamble, struct{MCOS: …, any other field}, then the rest
//          └ field MCOS: class-17 opaque, type 'MCOS', class 'FileWrapper__'
//               └ cell array [N 1]: {metadata blob, [], value cells…, 3 per-class cells}
//
// WHY ONE CELL IS ENOUGH. A property MATLAB saved away from its class default has a triple
// (name, 1, k) in its object's property list, and its value is cell k + 2. Replacing that
// cell changes nothing the blob says, so only the layers around the cell are re-emitted —
// the cell array, the opaque, the struct, the payload and the element, each with its byte
// count restated and the element's dims [1 N] with it — and every sub-element they hold
// that is not an edited cell goes out byte for byte as read, small tags included.
//
// Measured against MATLAB R2027a (test/fixtures/mat-cellswap): 20 edits written this way —
// a Simulink.Parameter's Value (resized, of another class, complex), Dimensions,
// Description, Max, Unit and DataType, and a Simulink.Signal's InitialValue, on an object
// in a variable, a struct field, a cell, an object array and a handle two variables share,
// in a compressed and an uncompressed file. 19 load as MATLAB's own edit of the same
// object, with no warning, and survive a MATLAB re-save; 14 of the subsystems are byte for
// byte MATLAB's own save of that edit. The tests hold this editor to every one of them.
//
// WHAT IT DOES NOT DECIDE. MATLAB re-runs each property's set method on load, in the order
// of the property list. So a stale derived cell loads re-derived (a Dimensions left [1 1]
// under a 2x3 Value loads [2 3], a Complexity left 'real' under 1+2i loads 'complex'), and
// a setter with a side effect fires on every load: the 20th edit, a DataType of 'double'
// over a single Value, loads with the Value converted and a warning, each time. Which
// properties take an edit, and which other cells go with one, are the caller's to choose: a
// MAT-file's save asks McosEditRules.
//
// WHAT IT REFUSES, rather than write bytes MATLAB could read as something else, is
// McosEditRefusal below. The reader is strict where McosParser's is lenient: McosParser
// shows what it can of a damaged blob, and an edit of one needs every layer to parse
// exactly. The two read the same table, and the tests hold them to agree on every fixture.

/**
 * Why an edit was refused.
 *
 * - `malformed`: a layer does not parse exactly — a byte count that does not tile its
 *   element, a struct without exactly one MCOS field, an opaque that is not a
 *   FileWrapper__, a blob whose segments do not tile, a triple naming a string or a cell
 *   that is not there.
 * - `unsupported`: it parses, as a blob this editor was not measured on: a version other
 *   than 4.0, big-endian, or a file header holding more than the one table MATLAB R2027a
 *   writes there. Any of them could hold a reference to a cell this cannot see.
 * - `bad-object`: the id names no object: 0 (the null object, which MATLAB writes for a
 *   deleted handle), past the object table, or not a whole number.
 * - `not-stored`: the object's property list has no such property. It is at its class
 *   default, and MATLAB saves no value for one, so there is no cell to replace; setting it
 *   means inserting a triple, which moves every later offset in the blob. So is every
 *   property of an object whose class saves it as one payload (its property list is 0).
 * - `not-a-cell`: the property is stored, but not in a cell: as a string-table index (a
 *   Parameter's Complexity, a CoderInfo's StorageClass), an integer, or an object id.
 * - `shared-cell`: another triple — of any object, a constructor argument, or a per-array
 *   property — names the same cell, which a swap would change too. MATLAB writes one cell
 *   per value, and no MATLAB-written file was seen sharing one.
 * - `shared-list`: another object's row names the same property list, whose every cell a swap
 *   would change for both. MATLAB writes a list per object, and no file was seen sharing one.
 * - `object-reference`: the cell, the old one or the new, holds an object reference: a
 *   uint32 whose first word is the handle magic, at any depth, or an object of any kind.
 *   MATLAB turns such a word into an object on load, so the swap would re-point the
 *   object graph, not change a value.
 * - `bad-cell`: the new cell is not one whole nameless miMATRIX whose payloads hold what
 *   its dims declare, or the subsystem it makes is past what its int32 dims can say.
 * - `duplicate-edit`: two edits name one property.
 */
export type McosEditRefusal =
  | 'malformed'
  | 'unsupported'
  | 'bad-object'
  | 'not-stored'
  | 'not-a-cell'
  | 'shared-cell'
  | 'shared-list'
  | 'object-reference'
  | 'bad-cell'
  | 'duplicate-edit';

export interface McosRefusal {
  ok: false;
  reason: McosEditRefusal;
  // The property the refusal is about, when it is about one.
  savedName?: string;
  // One clause, for a message: what was wrong.
  message: string;
}

/** One property's new value. */
export interface McosCellEdit {
  // The name MATLAB saved the property under, which is not always its public one: a
  // Simulink.Parameter's Unit is saved as DocUnits.
  savedName: string;
  // One nameless miMATRIX element, tag included (valueCellOf).
  cell: Uint8Array;
}

export type McosEditResult = { ok: true; bytes: Uint8Array } | McosRefusal;

/** One triple of an object's property list, as storedProperties reports it. */
export interface McosStoredProperty {
  savedName: string;
  // How the triple's value is read: 0 a string-table index, 1 a value cell, 2 an integer,
  // 3 an object id.
  flag: number;
  // The FileWrapper__ cell that holds the value, k + 2, for a value cell; null otherwise.
  cellIndex: number | null;
  // Why editMcosSubsystem refuses to swap its cell, or null when it takes a swap.
  refusal: McosEditRefusal | null;
}

export type McosStoredResult = { ok: true; className: string; properties: McosStoredProperty[] } | McosRefusal;

/** A sub-element: its tag, type, payload and length, and where it ends, padding included. */
export interface McosSub {
  at: number;
  type: number;
  data: number;
  bytes: number;
  end: number;
}

/** An miMATRIX element and the sub-elements that tile it. */
export interface McosLayer {
  at: number;
  end: number;
  subs: McosSub[];
}

/** A triple of a property list, constructor-argument list or per-array map, and where it is. */
export interface McosTriple {
  name: number;
  flag: number;
  value: number;
  at: number;
}

/** A row of the object table: words 0, 3 and 4 of its 24 bytes. */
export interface McosObjectRow {
  classId: number;
  ctorList: number;
  pvList: number;
}

/**
 * A subsystem read whole, every position an offset into `bytes`. What readMcosSubsystem
 * gives, for a caller asking several questions of one subsystem.
 */
export interface McosSubsystem {
  readonly bytes: Uint8Array;
  // The uint8 element: flags, dims, name, data.
  readonly outer: McosLayer;
  // The payload's struct, and which of its sub-elements is the MCOS field's value.
  readonly struct: McosLayer;
  readonly mcosField: number;
  // The FileWrapper__ opaque: flags, name, 'MCOS', 'FileWrapper__', the cell array.
  readonly opaque: McosLayer;
  // The cell array: flags, dims, name, then `cells`.
  readonly cellArray: McosLayer;
  readonly cells: McosSub[];
  // The metadata blob: where its byte 0 is, and what it says.
  readonly blobAt: number;
  readonly strings: string[];
  // Each class row's full name, 'pkg.Cls' or 'Cls'; null for one naming a string the table
  // does not hold.
  readonly classes: (string | null)[];
  readonly objects: McosObjectRow[];
  readonly ctorLists: McosTriple[][];
  readonly pvLists: McosTriple[][];
  readonly perArray: McosTriple[];
  // How many value cells there are: cells [2, 2 + valueCells).
  readonly valueCells: number;
  // How many triples name each value cell, and how many object rows each property list.
  readonly references: ReadonlyMap<number, number>;
  readonly listUsers: ReadonlyMap<number, number>;
}

export type McosSubsystemRead = { ok: true; subsystem: McosSubsystem } | McosRefusal;

const MI_INT8 = 1;
const MI_UINT8 = 2;
const MI_INT32 = 5;
const MI_UINT32 = 6;
const MI_MATRIX = 14;

const MX_CELL = 1;
const MX_STRUCT = 2;
const MX_OBJECT = 3;
const MX_CHAR = 4;
const MX_SPARSE = 5;
const MX_UINT8 = 9;
const MX_UINT32 = 13;
const MX_FUNCTION = 16;
const MX_OPAQUE = 17;

// Byte 1 of the array flags word.
const COMPLEX_FLAG = 0x08;

const FLAG_CELL = 1;
const FLAG_WORDS: Record<number, string> = { 0: 'a string-table index', 2: 'an integer', 3: 'an object id' };

// The cells after the value cells in a version-4 subsystem's cell array, three per-class
// tables: saved class information, class aliases, and the class defaults McosParser reads. Other
// versions hold another number of them, and none is read: readLayers counts the value cells by
// this before it reads the blob, and readBlob then refuses a blob of any version but 4.0
// ('unsupported'), so no subsystem read with this count of another version's is ever handed on.
const TRAILING_CELLS = 3;
const INT32_MAX = 0x7fffffff;

const WIDTH: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 7: 4, 9: 8, 12: 8, 13: 8 };

class Refused extends Error {
  constructor(readonly refusal: McosRefusal) {
    super(refusal.message);
  }
}

function fail(reason: McosEditRefusal, message: string, savedName?: string): never {
  throw new Refused(savedName === undefined ? { ok: false, reason, message } : { ok: false, reason, savedName, message });
}

function align8(n: number): number {
  return n + ((8 - (n % 8)) % 8);
}

/**
 * The sub-element whose tag is at `at`, wholly before `limit`, or null. A tag whose upper
 * half is not zero is the small form, of 1 to 4 bytes, and anything else there is no tag.
 */
function subAt(view: DataView, at: number, limit: number): McosSub | null {
  if (at + 8 > limit) {
    return null;
  }
  const word = view.getUint32(at, true);
  const small = word >>> 16;
  if (small !== 0) {
    const type = word & 0xffff;
    return small > 4 || type === 0 ? null : { at, type, data: at + 4, bytes: small, end: at + 8 };
  }
  const bytes = view.getUint32(at + 4, true);
  const end = at + 8 + align8(bytes);
  return end > limit ? null : { at, type: word, data: at + 8, bytes, end };
}

/**
 * The miMATRIX element at `at`, wholly before `limit`, whose sub-elements tile it exactly
 * and open with an array-flags word, or null.
 */
function layerAt(view: DataView, at: number, limit: number): McosLayer | null {
  const tag = subAt(view, at, limit);
  if (!tag || tag.type !== MI_MATRIX || tag.bytes % 8 !== 0) {
    return null;
  }
  const subs: McosSub[] = [];
  for (let p = tag.data; p < tag.end; ) {
    const sub = subAt(view, p, tag.end);
    if (!sub) {
      return null;
    }
    subs.push(sub);
    p = sub.end;
  }
  const flags = subs[0];
  return flags && flags.type === MI_UINT32 && flags.bytes === 8 ? { at, end: tag.end, subs } : null;
}

function classOf(view: DataView, layer: McosLayer): number {
  return view.getUint8(layer.subs[0].data);
}

function isComplex(view: DataView, layer: McosLayer): boolean {
  return (view.getUint8(layer.subs[0].data + 1) & COMPLEX_FLAG) !== 0;
}

/** The extents a dims sub-element holds, or null when it is not one. */
function dimsIn(view: DataView, sub: McosSub | undefined): number[] | null {
  if (!sub || sub.type !== MI_INT32 || sub.bytes < 8 || sub.bytes % 4 !== 0) {
    return null;
  }
  const dims: number[] = [];
  for (let p = sub.data; p < sub.data + sub.bytes; p += 4) {
    const d = view.getInt32(p, true);
    if (d < 0) {
      return null;
    }
    dims.push(d);
  }
  return dims;
}

/**
 * Whether `bytes` from `at` spell `text` and nothing more in a field of `width` bytes: the
 * rest of the field NUL. Compared, not decoded, so a damaged length cannot make a string
 * of a megabyte out of one.
 */
function spells(bytes: Uint8Array, at: number, width: number, text: string): boolean {
  if (width < text.length) {
    return false;
  }
  for (let i = 0; i < width; i++) {
    if (bytes[at + i] !== (i < text.length ? text.charCodeAt(i) : 0)) {
      return false;
    }
  }
  return true;
}

/** The first element of a numeric payload of MAT type `type`, or null for a type that is not one. */
function firstNumber(view: DataView, type: number, at: number): number | bigint | null {
  switch (type) {
    case 1: return view.getInt8(at);
    case 2: return view.getUint8(at);
    case 3: return view.getInt16(at, true);
    case 4: return view.getUint16(at, true);
    case 5: return view.getInt32(at, true);
    case 6: return view.getUint32(at, true);
    case 7: return view.getFloat32(at, true);
    case 9: return view.getFloat64(at, true);
    case 12: return view.getBigInt64(at, true);
    case 13: return view.getBigUint64(at, true);
    default: return null;
  }
}

/**
 * Whether the miMATRIX element at `at` holds an object reference at any depth, or null
 * when it does not parse.
 *
 * MATLAB turns a value cell's object references into objects as it loads it, wherever in
 * the cell they sit, and a reference is a uint32 array whose first word is the handle
 * magic: a nested object's handle, an enumeration's tag, a function handle's marker. So
 * every uint32 in the tree is asked, whatever its shape, which is wider than what MATLAB
 * reads as one — a refusal costs an edit, a miss re-points an object. An object element of
 * any class, which no value cell holds, is taken for one too.
 *
 * `strict`, for a cell from outside: every payload holds what its dims declare, as a cell
 * MATLAB reads as the value meant has to. A numeric payload of other than numel times its
 * width is a shorter or garbage array to MATLAB, not an error. Walked with an explicit
 * stack, so a deep cell has no depth limit here.
 */
function holdsObjectReference(view: DataView, at: number, limit: number, strict: boolean): boolean | null {
  const stack: [number, number][] = [[at, limit]];
  while (stack.length > 0) {
    const [p, end] = stack.pop()!;
    const tag = subAt(view, p, end);
    if (!tag || tag.type !== MI_MATRIX) {
      return null;
    }
    // A member with no sub-elements at all is an empty one, and holds nothing.
    if (tag.bytes === 0 && !strict) {
      continue;
    }
    const m = layerAt(view, p, tag.end);
    if (!m) {
      return null;
    }
    const cls = classOf(view, m);
    if (cls === MX_OBJECT || cls === MX_FUNCTION || cls === MX_OPAQUE) {
      return true;
    }
    const dims = dimsIn(view, m.subs[1]);
    if (!dims || m.subs.length < 3) {
      return null;
    }
    const numel = dims.reduce((a, b) => a * b, 1);
    let members: McosSub[] = [];
    if (cls === MX_CELL) {
      members = m.subs.slice(3);
      if (strict && members.length !== numel) {
        return null;
      }
    } else if (cls === MX_STRUCT) {
      const [, , , widthSub, namesSub] = m.subs;
      if (!widthSub || !namesSub || widthSub.type !== MI_INT32 || widthSub.bytes !== 4 || namesSub.type !== MI_INT8) {
        return null;
      }
      const fields = fieldCountOf(view, widthSub, namesSub);
      members = m.subs.slice(5);
      if (!Number.isInteger(fields) || (strict && members.length !== fields * numel)) {
        return null;
      }
    } else if (cls !== MX_CHAR && cls !== MX_SPARSE) {
      if (cls < 6 || cls > 15 || m.subs.length < 4) {
        return null;
      }
      const re = m.subs[3];
      if (cls === MX_UINT32 && re.bytes > 0) {
        if (!WIDTH[re.type] || re.bytes < WIDTH[re.type]) {
          return null;
        }
        const first = firstNumber(view, re.type, re.data);
        if (first !== null && Number(first) === MCOS_HANDLE_MAGIC) {
          return true;
        }
      }
      if (strict && !payloadsFit(m, numel, isComplex(view, m))) {
        return null;
      }
    }
    for (let i = members.length - 1; i >= 0; i--) {
      stack.push([members[i].at, members[i].end]);
    }
  }
  return false;
}

/**
 * How many fields a struct's field-name table names: its bytes over the width each name takes, none
 * for an empty table, and NaN for one that is not whole names (a width of 0 or less over names, or
 * names that do not fill a whole number of widths). For every struct this reads, the subsystem's
 * own (readLayers) and one in a value cell (holdsObjectReference).
 */
function fieldCountOf(view: DataView, widthSub: McosSub, namesSub: McosSub): number {
  const width = view.getInt32(widthSub.data, true);
  return width > 0 ? namesSub.bytes / width : namesSub.bytes === 0 ? 0 : NaN;
}

/** Whether a numeric element's real part, and imaginary part when complex, hold numel values each. */
function payloadsFit(m: McosLayer, numel: number, complex: boolean): boolean {
  const parts = m.subs.slice(3);
  if (parts.length !== (complex ? 2 : 1)) {
    return false;
  }
  return parts.every((part) => WIDTH[part.type] !== undefined && part.bytes === numel * WIDTH[part.type]);
}

/**
 * Reads a subsystem element whole, for a caller asking several questions of one; or refuses
 * it, when a layer does not parse exactly or is one this editor was not measured on.
 */
export function readMcosSubsystem(bytes: Uint8Array): McosSubsystemRead {
  try {
    return { ok: true, subsystem: readLayers(bytes) };
  } catch (e) {
    if (e instanceof Refused) {
      return e.refusal;
    }
    throw e;
  }
}

function readLayers(bytes: Uint8Array): McosSubsystem {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The element: uint8 [1 N], its data the N bytes of the payload.
  const outer = layerAt(view, 0, bytes.length);
  if (!outer || outer.end !== bytes.length) {
    fail('malformed', 'the subsystem is not one whole MAT element');
  }
  const outerDims = dimsIn(view, outer.subs[1]);
  const data = outer.subs[3];
  if (outer.subs.length !== 4 || classOf(view, outer) !== MX_UINT8 || isComplex(view, outer) || data.type !== MI_UINT8) {
    fail('malformed', 'the subsystem is not a uint8 array');
  }
  if (!outerDims || outerDims.length !== 2 || outerDims[0] !== 1 || outerDims[1] !== data.bytes) {
    fail('malformed', `the subsystem's dims do not say its ${data.bytes} bytes as [1 ${data.bytes}]`);
  }

  // The payload: an 8-byte preamble that says it is little-endian, the struct, the rest.
  const payloadEnd = data.data + data.bytes;
  if (data.bytes < 16) {
    fail('malformed', `the subsystem's payload is ${data.bytes} bytes, too short to hold a struct`);
  }
  const endian = String.fromCharCode(bytes[data.data + 2], bytes[data.data + 3]);
  if (endian !== 'IM') {
    fail(endian === 'MI' ? 'unsupported' : 'malformed', endian === 'MI' ? "the subsystem's payload is big-endian" : "the subsystem's payload has no endian mark");
  }
  const struct = layerAt(view, data.data + 8, payloadEnd);
  if (!struct || classOf(view, struct) !== MX_STRUCT) {
    fail('malformed', "the subsystem's payload does not open with a whole struct");
  }

  // The struct: flags, dims [1 1], name, field-name width, field names, one value per field.
  const structDims = dimsIn(view, struct.subs[1]);
  const [, , , widthSub, namesSub] = struct.subs;
  if (!structDims || structDims.length !== 2 || structDims[0] !== 1 || structDims[1] !== 1 || !widthSub || !namesSub
    || widthSub.type !== MI_INT32 || widthSub.bytes !== 4 || namesSub.type !== MI_INT8) {
    fail('malformed', "the subsystem's struct is not one struct with a field-name table");
  }
  const width = view.getInt32(widthSub.data, true);
  const fieldCount = fieldCountOf(view, widthSub, namesSub);
  if (!Number.isInteger(fieldCount) || struct.subs.length !== 5 + fieldCount) {
    fail('malformed', "the subsystem's struct does not hold one value per field it names");
  }
  const mcos: number[] = [];
  for (let f = 0; f < fieldCount; f++) {
    if (spells(bytes, namesSub.data + f * width, width, 'MCOS')) mcos.push(f);
  }
  if (mcos.length !== 1) {
    fail('malformed', `the subsystem's struct has ${mcos.length} MCOS fields, and an edit needs one`);
  }
  const mcosField = 5 + mcos[0];

  // The field: class-17 opaque, type 'MCOS', class 'FileWrapper__', and its cell array.
  const field = struct.subs[mcosField];
  const opaque = layerAt(view, field.at, field.end);
  if (!opaque || opaque.end !== field.end || classOf(view, opaque) !== MX_OPAQUE || opaque.subs.length !== 5
    || !spells(bytes, opaque.subs[2].data, opaque.subs[2].bytes, 'MCOS')
    || !spells(bytes, opaque.subs[3].data, opaque.subs[3].bytes, 'FileWrapper__')) {
    fail('malformed', "the subsystem's MCOS field is not a FileWrapper__ opaque");
  }
  const holder = opaque.subs[4];
  const cellArray = layerAt(view, holder.at, holder.end);
  const cellDims = cellArray ? dimsIn(view, cellArray.subs[1]) : null;
  if (!cellArray || cellArray.end !== holder.end || classOf(view, cellArray) !== MX_CELL || !cellDims || cellArray.subs.length < 3) {
    fail('malformed', "the subsystem's FileWrapper__ holds no whole cell array");
  }
  const cells = cellArray.subs.slice(3);
  if (cellDims.reduce((a, b) => a * b, 1) !== cells.length || cells.some((c) => c.type !== MI_MATRIX)) {
    fail('malformed', "the subsystem's cell array does not hold the cells its dims declare");
  }
  const valueCells = cells.length - 2 - TRAILING_CELLS;
  if (valueCells < 0) {
    fail('malformed', `the subsystem's cell array holds ${cells.length} cells, fewer than the ${2 + TRAILING_CELLS} around its values`);
  }

  // Cell 0: the metadata blob, a uint8 array.
  const blobCell = layerAt(view, cells[0].at, cells[0].end);
  const blobDims = blobCell ? dimsIn(view, blobCell.subs[1]) : null;
  const blob = blobCell?.subs[3];
  if (!blobCell || !blob || blobCell.subs.length !== 4 || classOf(view, blobCell) !== MX_UINT8 || blob.type !== MI_UINT8
    || !blobDims || blobDims.reduce((a, b) => a * b, 1) !== blob.bytes) {
    fail('malformed', "the subsystem's first cell is not its metadata blob");
  }

  const table = readBlob(view, blob.data, blob.bytes);
  const references = new Map<number, number>();
  for (const t of [...table.ctorLists.flat(), ...table.pvLists.flat(), ...table.perArray]) {
    if (t.flag === FLAG_CELL) {
      references.set(t.value, (references.get(t.value) ?? 0) + 1);
    }
  }
  const listUsers = new Map<number, number>();
  for (const row of table.objects) {
    if (row.pvList !== 0) {
      listUsers.set(row.pvList, (listUsers.get(row.pvList) ?? 0) + 1);
    }
  }
  return { bytes, outer, struct, mcosField, opaque, cellArray, cells, blobAt: blob.data, ...table, valueCells, references, listUsers };
}

type BlobTable = Pick<McosSubsystem, 'strings' | 'classes' | 'objects' | 'ctorLists' | 'pvLists' | 'perArray'>;

/**
 * The metadata blob of `length` bytes at `at`.
 *
 * Its header: a version (major, minor), a big-endian flag and a reserved byte, the string
 * count, then where each of eight segments starts, each ending where the next starts — the
 * class table, the constructor-argument lists, the object table, the property lists, then
 * dynamic properties, value pointers and removed properties, which hold no cell index, and
 * last the file header. That header is a count of tables and where each is; the one MATLAB
 * R2027a writes, the per-array property map, holds triples like the lists do.
 */
function readBlob(view: DataView, at: number, length: number): BlobTable {
  if (length < 40) {
    fail('malformed', `the metadata blob is ${length} bytes, short of its 40-byte header`);
  }
  const u8 = (o: number) => view.getUint8(at + o);
  const u32 = (o: number) => view.getUint32(at + o, true);
  if (u8(2) !== 0) {
    fail('unsupported', 'the metadata blob is big-endian');
  }
  if (u8(0) !== 4 || u8(1) !== 0) {
    fail('unsupported', `the metadata blob is version ${u8(0)}.${u8(1)}, and this editor was measured on 4.0 only`);
  }
  const starts: number[] = [];
  for (let i = 0; i < 8; i++) {
    const s = u32(8 + 4 * i);
    if (s < (starts[i - 1] ?? 40) || s > length || s % 8 !== 0) {
      fail('malformed', `the metadata blob's segment ${i} starts at ${s}, out of order or out of its ${length} bytes`);
    }
    starts.push(s);
  }
  const [classesAt, ctorAt, objectsAt, pvAt, dynamicAt, , , headerAt] = starts;

  // Strings: NUL-terminated from byte 40, index 0 the empty string.
  const decoder = new TextDecoder();
  const strings = [''];
  const count = u32(4);
  for (let p = 40, i = 0; i < count; i++) {
    let e = p;
    while (e < classesAt && u8(e) !== 0) e++;
    if (e >= classesAt) {
      fail('malformed', `the metadata blob's string table holds fewer than the ${count} strings it declares`);
    }
    strings.push(decoder.decode(new Uint8Array(view.buffer, view.byteOffset + at + p, e - p)));
    p = e + 1;
  }
  const stringAt = (i: number): string | null => (i < strings.length ? strings[i] : null);

  if ((ctorAt - classesAt) % 16 !== 0 || (pvAt - objectsAt) % 24 !== 0) {
    fail('malformed', "the metadata blob's class or object table is not whole rows");
  }
  const classes: (string | null)[] = [];
  for (let p = classesAt; p < ctorAt; p += 16) {
    const pkg = stringAt(u32(p));
    const cls = stringAt(u32(p + 4));
    classes.push(pkg === null || cls === null ? null : pkg ? pkg + '.' + cls : cls);
  }
  const objects: McosObjectRow[] = [];
  for (let p = objectsAt; p < pvAt; p += 24) {
    objects.push({ classId: u32(p), ctorList: u32(p + 12), pvList: u32(p + 16) });
  }

  // Each list: a count, then that many 12-byte triples, padded to 8; the lists tile their segment.
  const listsIn = (from: number, to: number, what: string): McosTriple[][] => {
    const lists: McosTriple[][] = [];
    for (let p = from; p < to; ) {
      const n = p + 4 <= to ? u32(p) : -1;
      const next = p + align8(4 + 12 * n);
      if (n < 0 || next > to) {
        fail('malformed', `a list of the metadata blob's ${what} runs past the segment's end`);
      }
      const list: McosTriple[] = [];
      for (let q = p + 4; q < p + 4 + 12 * n; q += 12) {
        list.push({ name: u32(q), flag: u32(q + 4), value: u32(q + 8), at: at + q });
      }
      lists.push(list);
      p = next;
    }
    return lists;
  };
  const ctorLists = listsIn(ctorAt, objectsAt, 'constructor arguments');
  const pvLists = listsIn(pvAt, dynamicAt, 'property lists');

  // The file header, when there is one: [count, where each table is…], padded to 8, and the
  // per-array map right after it: [entries, (index, n, n triples)…], padded to 8, to the end.
  const perArray: McosTriple[] = [];
  if (headerAt < length) {
    const tables = headerAt + 4 <= length ? u32(headerAt) : -1;
    const mapAt = headerAt + align8(4 + 4 * tables);
    if (tables < 0 || mapAt > length) {
      fail('malformed', "the metadata blob's file header runs past its end");
    }
    if (tables > 1) {
      fail('unsupported', `the metadata blob's file header holds ${tables} tables, and this editor reads only the first, the per-array properties`);
    }
    if (tables === 1) {
      if (u32(headerAt + 4) !== mapAt || mapAt + 4 > length) {
        fail('unsupported', "the metadata blob's per-array map is not where its file header ends");
      }
      let q = mapAt + 4;
      for (let entries = u32(mapAt); entries > 0; entries--) {
        const n = q + 8 <= length ? u32(q + 4) : -1;
        if (n < 0 || q + 8 + 12 * n > length) {
          fail('malformed', "the metadata blob's per-array map runs past its end");
        }
        for (let r = q + 8; r < q + 8 + 12 * n; r += 12) {
          perArray.push({ name: u32(r), flag: u32(r + 4), value: u32(r + 8), at: at + r });
        }
        q += 8 + 12 * n;
      }
      if (mapAt + align8(q - mapAt) !== length) {
        fail('unsupported', 'the metadata blob holds bytes past its per-array map');
      }
    } else if (mapAt !== length) {
      fail('unsupported', 'the metadata blob holds bytes past its file header');
    }
  }
  return { strings, classes, objects, ctorLists, pvLists, perArray };
}

function subsystemOf(subsystem: Uint8Array | McosSubsystem): McosSubsystem {
  return subsystem instanceof Uint8Array ? readLayers(subsystem) : subsystem;
}

/**
 * The object row `objectId` names, its property list, and why no cell of the list takes a swap
 * whatever the property, or null: another object's row names the list too (`shared-list`).
 */
function objectAt(s: McosSubsystem, objectId: number): { className: string; list: McosTriple[]; ownSave: boolean; shared: McosRefusal | null } {
  if (!Number.isInteger(objectId) || objectId < 1 || objectId >= s.objects.length) {
    fail('bad-object', `object ${objectId} is not one of the ${Math.max(0, s.objects.length - 1)} objects the subsystem holds`);
  }
  const row = s.objects[objectId];
  const className = s.classes[row.classId];
  if (className === undefined || className === null) {
    fail('malformed', `object ${objectId} names class ${row.classId}, which the class table does not hold`);
  }
  // List 0 is no list: an object that names it saved itself as one payload, through its
  // class's own save (a `string`'s text, a saveobj result), and has no property triples.
  if (row.pvList === 0) {
    return { className, list: [], ownSave: true, shared: null };
  }
  const list = s.pvLists[row.pvList];
  if (!list) {
    fail('malformed', `object ${objectId} names property list ${row.pvList}, and the blob holds ${s.pvLists.length}`);
  }
  if (list.some((t) => t.name < 1 || t.name >= s.strings.length)) {
    fail('malformed', `object ${objectId}'s property list names a string the table does not hold`);
  }
  const others = (s.listUsers.get(row.pvList) ?? 0) - 1;
  const shared: McosRefusal | null = others > 0
    ? { ok: false, reason: 'shared-list', message: `object ${objectId}'s property list is named by ${others} other object${others === 1 ? '' : 's'} as well` }
    : null;
  return { className, list, ownSave: false, shared };
}

/** Why the cell of `t` cannot be swapped, or null when it can. */
function swapRefusal(s: McosSubsystem, t: McosTriple): McosRefusal | null {
  const savedName = s.strings[t.name];
  if (t.flag !== FLAG_CELL) {
    const as = FLAG_WORDS[t.flag] ?? `value kind ${t.flag}`;
    return { ok: false, reason: 'not-a-cell', savedName, message: `${savedName} is stored as ${as}, not in a value cell` };
  }
  if (t.value >= s.valueCells) {
    return { ok: false, reason: 'malformed', savedName, message: `${savedName} names value cell ${t.value}, and the subsystem holds ${s.valueCells}` };
  }
  const others = (s.references.get(t.value) ?? 0) - 1;
  if (others > 0) {
    return { ok: false, reason: 'shared-cell', savedName, message: `${savedName}'s value cell is named by ${others} other triple${others === 1 ? '' : 's'} as well` };
  }
  const cell = s.cells[t.value + 2];
  const view = new DataView(s.bytes.buffer, s.bytes.byteOffset, s.bytes.byteLength);
  const held = holdsObjectReference(view, cell.at, cell.end, false);
  if (held === null) {
    return { ok: false, reason: 'malformed', savedName, message: `${savedName}'s value cell does not parse` };
  }
  return held
    ? { ok: false, reason: 'object-reference', savedName, message: `${savedName}'s value cell holds an object reference, not a value` }
    : null;
}

/** Why `cell` cannot go into a subsystem as a value, or null when it can. */
function newCellRefusal(cell: Uint8Array, savedName: string): McosRefusal | null {
  const view = new DataView(cell.buffer, cell.byteOffset, cell.byteLength);
  const m = layerAt(view, 0, cell.length);
  if (!m || m.end !== cell.length) {
    return { ok: false, reason: 'bad-cell', savedName, message: `the new value of ${savedName} is not one whole MAT element` };
  }
  const cls = classOf(view, m);
  const name = m.subs[2];
  if (cls !== MX_OBJECT && cls !== MX_FUNCTION && cls !== MX_OPAQUE && (!name || name.type !== MI_INT8 || name.bytes !== 0)) {
    return { ok: false, reason: 'bad-cell', savedName, message: `the new value of ${savedName} carries a name, which a cell does not` };
  }
  const held = holdsObjectReference(view, 0, cell.length, true);
  if (held === null) {
    return { ok: false, reason: 'bad-cell', savedName, message: `the new value of ${savedName} does not hold what its dims declare` };
  }
  return held
    ? { ok: false, reason: 'object-reference', savedName, message: `the new value of ${savedName} holds an object reference, not a value` }
    : null;
}

/**
 * Every property object `objectId` saved a triple for, in the order of its property list,
 * and whether editMcosSubsystem takes a swap of each: what the node layer decides
 * editability by. A property it does not list is at its class default, and takes none.
 */
export function storedProperties(subsystem: Uint8Array | McosSubsystem, objectId: number): McosStoredResult {
  try {
    const s = subsystemOf(subsystem);
    const { className, list, shared } = objectAt(s, objectId);
    const properties = list.map((t): McosStoredProperty => ({
      savedName: s.strings[t.name],
      flag: t.flag,
      cellIndex: t.flag === FLAG_CELL ? t.value + 2 : null,
      refusal: shared?.reason ?? swapRefusal(s, t)?.reason ?? null,
    }));
    return { ok: true, className, properties };
  } catch (e) {
    if (e instanceof Refused) {
      return e.refusal;
    }
    throw e;
  }
}

/**
 * The subsystem with the value cells of object `objectId`'s properties replaced, one per
 * edit, and every other byte as it was; or why not, for the first edit refused (nothing is
 * written then). No edits is the subsystem re-emitted as it was read.
 */
export function editMcosSubsystem(
  subsystem: Uint8Array | McosSubsystem,
  objectId: number,
  edits: readonly McosCellEdit[],
): McosEditResult {
  return editMcosObjects(subsystem, [{ objectId, edits }]);
}

/** The edits of one object, for editMcosObjects. */
export interface McosObjectEdits {
  objectId: number;
  edits: readonly McosCellEdit[];
}

/**
 * editMcosSubsystem for the edits of several objects at once, the subsystem re-emitted once around
 * all of them; or why not, for the first edit refused (nothing is written then). An object named
 * twice is refused, as one property edited twice is: its edits are one list.
 */
export function editMcosObjects(subsystem: Uint8Array | McosSubsystem, objects: readonly McosObjectEdits[]): McosEditResult {
  try {
    const s = subsystemOf(subsystem);
    const replaced = new Map<number, Uint8Array>();
    const seen = new Set<number>();
    for (const { objectId, edits } of objects) {
      if (seen.has(objectId)) {
        fail('duplicate-edit', `object ${objectId} is edited twice`);
      }
      seen.add(objectId);
      const { list, ownSave, shared } = objectAt(s, objectId);
      if (shared && edits.length > 0) {
        throw new Refused({ ...shared, savedName: edits[0].savedName });
      }
      const named = new Set<string>();
      for (const { savedName, cell } of edits) {
        if (named.has(savedName)) {
          fail('duplicate-edit', `${savedName} is edited twice`, savedName);
        }
        named.add(savedName);
        const hits = list.filter((t) => s.strings[t.name] === savedName);
        if (hits.length > 1) {
          fail('malformed', `object ${objectId}'s property list holds ${savedName} ${hits.length} times`, savedName);
        }
        if (hits.length === 0) {
          fail('not-stored', ownSave
            ? `object ${objectId} saved itself as one payload, and holds no ${savedName} to replace`
            : `object ${objectId} saved no value for ${savedName}: it is at its class default, and has no cell to replace`, savedName);
        }
        const refusal = swapRefusal(s, hits[0]) ?? newCellRefusal(cell, savedName);
        if (refusal) {
          throw new Refused(refusal);
        }
        replaced.set(hits[0].value + 2, cell);
      }
    }
    return { ok: true, bytes: rebuild(s, replaced) };
  } catch (e) {
    if (e instanceof Refused) {
      return e.refusal;
    }
    throw e;
  }
}

/**
 * What value cell `cellIndex` of the subsystem holds, read as MatParser reads a matrix (which is
 * how McosParser reads the same cell into an object's property), or null for an index past the
 * cells or a cell that does not read.
 */
export function cellValueAt(subsystem: McosSubsystem, cellIndex: number): MatVariable | null {
  const cell = subsystem.cells[cellIndex];
  if (!cell) {
    return null;
  }
  try {
    return parseMatrix(new DataView(subsystem.bytes.buffer, subsystem.bytes.byteOffset, subsystem.bytes.byteLength), cell.data, cell.bytes);
  } catch {
    return null;
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) {
    total += p.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A long-form tag: type, then byte count. */
function tag(type: number, bytes: number): Uint8Array {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setUint32(0, type, true);
  view.setUint32(4, bytes, true);
  return out;
}

function matrixOf(parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);
  return concat([tag(MI_MATRIX, body.length), body]);
}

/**
 * The subsystem re-emitted around its cells, `replaced` in place of the ones it names: the
 * cell array, the opaque, the struct, the payload and the element, each tag restated and
 * every other sub-element the bytes it was read as.
 */
function rebuild(s: McosSubsystem, replaced: ReadonlyMap<number, Uint8Array>): Uint8Array {
  const b = s.bytes;
  const piece = (sub: McosSub): Uint8Array => b.subarray(sub.at, sub.end);
  const cells = s.cells.map((cell, i) => replaced.get(i) ?? piece(cell));
  const cellArray = matrixOf([...s.cellArray.subs.slice(0, 3).map(piece), ...cells]);
  const opaque = matrixOf([...s.opaque.subs.slice(0, 4).map(piece), cellArray]);
  const struct = matrixOf(s.struct.subs.map((sub, i) => (i === s.mcosField ? opaque : piece(sub))));
  const data = s.outer.subs[3];
  const preamble = b.subarray(data.data, data.data + 8);
  const rest = b.subarray(s.struct.end, data.data + data.bytes);
  const n = preamble.length + struct.length + rest.length;
  if (n > INT32_MAX) {
    fail('bad-cell', `the subsystem would be ${n} bytes, past what its int32 dims can say`);
  }
  const dims = new Uint8Array(8);
  new DataView(dims.buffer).setInt32(0, 1, true);
  new DataView(dims.buffer).setInt32(4, n, true);
  return matrixOf([
    piece(s.outer.subs[0]),
    concat([tag(MI_INT32, 8), dims]),
    piece(s.outer.subs[2]),
    tag(MI_UINT8, n),
    preamble,
    struct,
    rest,
    new Uint8Array(align8(n) - n),
  ]);
}

/**
 * The id of element `index` (0-based, column-major, MATLAB's order) of the objects a handle
 * names, or null when it names none there: an index past its elements, or the null object 0,
 * which MATLAB writes for a deleted handle. The handle is MatVariable's `mcosHandle`, or the
 * words [0xDD000000, ndims, dims…, ids…, classIdx] as they are held (McosHandle.ts).
 */
export function objectIdOf(handle: { dims: number[]; ids: number[] } | number[] | null | undefined, index = 0): number | null {
  if (!handle) {
    return null;
  }
  let ids: number[];
  if (Array.isArray(handle)) {
    const parsed = handle.length >= 5 && handle[0] === MCOS_HANDLE_MAGIC ? objectHandleFromValue(handle) : null;
    if (!parsed) {
      return null;
    }
    ids = parsed.ids;
  } else {
    ids = handle.ids;
  }
  if (!Number.isInteger(index) || index < 0 || index >= ids.length) {
    return null;
  }
  const id = ids[index];
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * A fresh value cell for `v`: MatWriter's nameless miMATRIX, which keeps the two rules MATLAB
 * writes a subsystem cell by — a payload of 1 to 4 bytes takes the small tag, and a value
 * goes out in its own class's type, never narrowed (a double 5 is miDOUBLE) — so the cell of
 * a value MATLAB would have saved is the cell MATLAB saves. Throws MatWriteError for a value
 * MatWriter cannot write, an object among them.
 */
export function valueCellOf(v: MatVariable): Uint8Array {
  return encodeMatVariable(v);
}
