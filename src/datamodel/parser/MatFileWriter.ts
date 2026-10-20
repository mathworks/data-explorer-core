// Copyright 2026 The MathWorks, Inc.
//
// A save of a Level-5 MAT-file (`-v6`, `-v7`): the file it was read from, with what was edited
// written fresh and everything else written as the bytes it was read from.
//
// WHY A SPLICE. A MAT-file is a header and a run of top-level records, each one variable, and
// the last one, unnamed, the subsystem that holds every object of the file. Nothing in a record
// points at another record, and nothing in the subsystem names a variable. So a record nobody
// edited can be written back as its own bytes, compressed as it was, which no re-encode
// reproduces: inflated and deflated again by fflate at level 6, 18 of the 78 compressed records
// of test/parity/artifacts/mat/cases.mat come back as they were. And the reader holds what it
// did not read (a record it could not inflate, a class it does not model) only as bytes. This
// is MATLAB's own update model too: measured against MATLAB R2027a, `save -append` copies every
// record it does not replace byte for byte, a compressed one included, keeps the header's text,
// and writes the subsystem last.
//
// What each record of the file becomes, in the file's order (plan):
//
//   the node it became was deleted         nothing
//   unedited                               its own bytes
//   only renamed                           its element with the name replaced (MatWriter.
//                                          elementNamed), compressed again if it was
//   its value edited, a plain value        written fresh (MatlabVariableNode._matStream),
//                                          named, compressed when the file holds any
//                                          compressed record
//   no node: the subsystem, a record the   its own bytes
//   reader dropped
//
// and a variable added since the read is written fresh, after the last variable and before the
// subsystem. The header keeps its 116 bytes of text and its version and byte-order mark, and
// bytes 116-123 say where the subsystem now starts, which MATLAB trusts without a scan
// (measured against MATLAB R2027a: a stale offset fails the whole load).
//
// "Unedited" is decided by the node's status, which every edit sets (DataNode._markModified),
// and never by whether a value still has the bytes it was read from: those stay on a variable
// after an edit. "Only renamed" is the status, a name that is not the record's, and no edit of
// the value (DataNode._valueEdited).
//
// EVERY DOUBT REFUSES THE SAVE. A save that cannot write a variable as what it is throws a
// MatWriteError naming it, and nothing is written: an object, a function handle or a value the
// reader did not decode, whose edit this writer cannot write; a variable stored after the
// subsystem, where MATLAB does not read it; a file whose records do not tile it, or that was
// opened without them. And before the bytes are handed back they are read again, and a record
// that does not read back as planned refuses the save as well (selfCheck).

import { zlibSync } from 'fflate';
import { inflateZlib } from './Inflate.js';
import { parseMat, functionHandleOf } from './MatParser.js';
import type { MatRecord, MatVariable, ParsedMat } from './MatParser.js';
import { MatBudgetError, MatWriteError, classPhrase, elementNamed, encodeMatVariable } from './MatWriter.js';
import { integerConversion } from './XmlUtils.js';
import { validateMatlabName } from '../matlabName.js';
import type BaseNode from '../node/BaseNode.js';
import type DataNode from '../node/DataNode.js';
import type MatNode from '../node/container/MatNode.js';
import type MatlabVariableNode from '../node/data/MatlabVariableNode.js';

const MI_MATRIX = 14;
const MI_COMPRESSED = 15;

/**
 * The bytes of the MAT-file `matNode` is, as it stands now: what was edited written fresh,
 * everything else as the bytes it was read from. Throws MatWriteError, naming the variable or
 * the file and why, for anything it cannot write as what it is (see the file header), and
 * never hands back bytes that did not read back as planned.
 */
export function serializeMatFile(matNode: MatNode): Uint8Array {
  const file = matNode.name;
  const { records, headerBytes } = matNode;
  if (!records || !headerBytes) {
    throw new MatWriteError(
      'Cannot save "' + file + '": it was opened without the records a save writes back, so a save would lose every one '
        + 'this package did not read. Nothing was written.',
    );
  }
  // The records are views of the bytes the file was read from, which a host that transfers
  // them to a worker afterwards empties: what was not edited would be written as nothing.
  const gone = headerBytes.byteLength !== 128 ? { offset: 0, length: 128, bytes: headerBytes } : records.find((r) => r.bytes.byteLength !== r.length);
  if (gone) {
    throw new MatWriteError(
      'Cannot save "' + file + '": the bytes it was read from are no longer held (the ' + (gone.offset === 0 ? 'header' : 'record at byte ' + gone.offset)
        + ' holds ' + gone.bytes.byteLength + ' of its ' + gone.length + '), so what was not edited could not be written as it was. '
        + 'Nothing was written.',
    );
  }
  if (!matNode.framed) {
    const at = matNode.unframed?.at ?? 128;
    const unframedBytes = headerBytes.buffer.byteLength - headerBytes.byteOffset - at;
    throw new MatWriteError(
      'Cannot save "' + file + '": this package could not frame ' + unframedBytes + ' byte(s) of it, from byte ' + at
        + (matNode.unframed ? ' (' + matNode.unframed.reason + ')' : '')
        + ', so a save could not keep them as they are. Nothing was written.',
    );
  }

  const subsystem = subsystemOf(matNode, records);
  const plan = planOf(matNode, records, subsystem);
  // Nothing deleted, renamed, edited or added: the file, as it was read.
  if (plan.length === records.length && plan.every((p, i) => p.kind === 'verbatim' && p.record === records[i])) {
    return concat([headerBytes, ...records.map((r) => r.bytes)]);
  }
  refuseStructure(matNode, records, subsystem);
  const assembled = assemble(headerBytes, plan, subsystem);
  selfCheck(file, assembled.bytes, plan, assembled, headerBytes);
  return assembled.bytes;
}

// ---- The plan: what each record of the file becomes -----------------------------------------

/** One record of the file a save writes, and where its bytes come from. */
type Planned =
  // A record of the file, as its own bytes.
  | { kind: 'verbatim'; record: MatRecord }
  // A record of the file whose variable was only renamed: its element, named `name`.
  | { kind: 'renamed'; record: MatRecord; name: string; bytes: Uint8Array }
  // A value written fresh, named `name`: an edited variable's, read from `record`, or one
  // added since the read, with no record.
  | { kind: 'fresh'; record: MatRecord | null; node: MatlabVariableNode; name: string; bytes: Uint8Array };

/** What has happened to the variable a record became, as a save writes it. */
type Edit = 'none' | 'name' | 'value';

// The record `matNode`'s header says its subsystem starts at, or null when it says there is none,
// or names a byte where no unnamed record starts (refuseStructure). By offset, and not by which
// record has no name: a matrix too short for its own flags reads as unnamed too. And unnamed,
// because a variable the header points at is a variable, whose edit is written or refused as
// any other's, and not passed over as the subsystem it is not.
function subsystemOf(matNode: MatNode, records: MatRecord[]): MatRecord | null {
  if (matNode.subsystemOffset === 0) {
    return null;
  }
  return records.find((r) => r.offset === matNode.subsystemOffset && r.anonymous) ?? null;
}

// The file's records, each as a save writes it, in the file's order, and every variable added
// since the read just before the subsystem, or at the end of a file with none, in the order they
// were added. A record that became no node (the subsystem, one the reader dropped) is its own
// bytes. One past the subsystem, which MATLAB does not read, is too, and its edit refuses the
// save: written where it is, MATLAB still would not read it, and moved, what MATLAB loads of the
// file would change. Deleting one changes nothing MATLAB loads, and is written.
function planOf(matNode: MatNode, records: MatRecord[], subsystem: MatRecord | null): Planned[] {
  const compress = records.some((r) => r.compressed);
  const added = matNode.children.filter((c) => matNode.recordOf(c) === null);
  const plan: Planned[] = [];
  const addAdded = () => {
    for (const node of added) {
      plan.push(freshOf(node, null, compress));
    }
  };
  let pastSubsystem = false;
  for (const record of records) {
    if (record === subsystem) {
      addAdded();
      plan.push({ kind: 'verbatim', record });
      pastSubsystem = true;
      continue;
    }
    const node = matNode.nodeOf(record);
    if (!node) {
      plan.push({ kind: 'verbatim', record });
      continue;
    }
    if (node.parent !== matNode) {
      continue;
    }
    const edit = editOf(node, record);
    if (edit === 'none') {
      plan.push({ kind: 'verbatim', record });
    } else if (pastSubsystem) {
      throw refusal(
        node.name,
        'it is stored after the file\'s objects, where MATLAB does not read it, so it would not be read written there, '
          + 'and moved, it would change what MATLAB loads of the file',
      );
    } else if (edit === 'name') {
      plan.push(renamedOf(node, record));
    } else {
      plan.push(freshOf(node, record, compress));
    }
  }
  if (!subsystem) {
    addAdded();
  }
  refuseDuplicates(plan);
  return plan;
}

// What has happened to the variable `record` became, `node`: decided by its status, which every
// edit sets (DataNode._markModified), and by whether anything but its own rename set it
// (DataNode._valueEdited). A rename undone leaves the status set and the name the file's: it is
// unedited. Its name is asked whatever the status, so that a rename made around the API, which
// sets none, is still written as one.
function editOf(node: BaseNode, record: MatRecord): Edit {
  const { status, _valueEdited } = node as DataNode;
  if (status === 'New' || (status === 'Modified' && _valueEdited)) {
    return 'value';
  }
  return node.name !== record.name ? 'name' : 'none';
}

// A save of a file with an unnamed record that is not its subsystem, or whose header puts its
// subsystem where no unnamed record starts, cannot place what it writes where MATLAB reads it:
// measured against MATLAB R2027a, MATLAB lists no variable past the first unnamed record, and a
// header offset that is not the subsystem's fails the whole load. Asked only of a save that
// changes the file: one that does not hands back the bytes it was read from.
function refuseStructure(matNode: MatNode, records: MatRecord[], subsystem: MatRecord | null): void {
  const file = matNode.name;
  const offset = matNode.subsystemOffset;
  if (offset !== 0 && !subsystem) {
    throw new MatWriteError(
      'Cannot save "' + file + '": its header places the file\'s objects at byte ' + offset + ', where '
        + (records.some((r) => r.offset === offset) ? 'a variable is' : 'no record starts') + ', so a save cannot say where they are. '
        + 'Nothing was written.',
    );
  }
  const stray = records.find((r) => r.anonymous && r !== subsystem);
  if (stray) {
    throw new MatWriteError(
      'Cannot save "' + file + '": the record at byte ' + stray.offset + ' holds a value with no name that is not the '
        + 'file\'s objects, and MATLAB reads no variable past one, so a save cannot place an edit where MATLAB reads it. '
        + 'Nothing was written.',
    );
  }
}

// Two records of one name: MATLAB loads one of them (measured against MATLAB R2027a: `load f`
// keeps the last, `load f x` the first). A file that holds two keeps them, as it was read; a
// rename or an addition that would make two is refused, naming the variable.
function refuseDuplicates(plan: Planned[]): void {
  const count = new Map<string | null, number>();
  const nameOf = (p: Planned) => (p.kind === 'verbatim' ? p.record.name : p.name);
  for (const p of plan) {
    count.set(nameOf(p), (count.get(nameOf(p)) ?? 0) + 1);
  }
  for (const p of plan) {
    if (p.kind !== 'verbatim' && count.get(p.name)! > 1) {
      throw refusal(p.name, 'the file would hold two variables named "' + p.name + '", and MATLAB loads only one of them');
    }
  }
}

// The refusal of a save for variable `name`, worded as every refused write is (MatWriter's
// budgetFailure, DataNode's): the variable, why, and that nothing was written.
function refusal(name: string, why: string): MatWriteError {
  return new MatWriteError('Cannot write "' + name + '": ' + why + '. Nothing was written.');
}

// A name this writer puts in an element: a valid MATLAB name, by the rule a rename is held to
// (matlabName), which is stricter than MATLAB's and holds for older releases. A variable added
// by a caller that named it itself (MatNode.execAddEntry) has had no other check.
function refuseName(name: string): void {
  const error = validateMatlabName(name);
  if (error) {
    throw refusal(name, 'it is not a name MATLAB can load (' + error + ')');
  }
}

// ---- What a renamed or an edited record is written as -----------------------------------------

// The record of a variable only renamed: its element as read, with the name subelement replaced
// (MatWriter.elementNamed) and every other byte copied, compressed again when it was. An object
// variable, a function handle and a value the reader did not decode are renamed so as well:
// nothing of them but their name is written.
function renamedOf(node: BaseNode, record: MatRecord): Planned {
  const name = node.name;
  refuseName(name);
  const element = elementOfRecord(record);
  const named = element ? elementNamed(element, name) : null;
  if (!named) {
    throw refusal(name, 'the record it was read from, at byte ' + record.offset + ', is not a whole element whose name can be replaced, so it cannot be renamed');
  }
  return { kind: 'renamed', record, name, bytes: recordBytes(named, record.compressed) };
}

// The record of a value written fresh: `node`'s, an edited variable read from `record` or one
// added since, named, and compressed when the file holds any compressed record, so that a `-v6`
// file, which holds none and is readable by every MATLAB, stays one.
//
// Only a plain MATLAB value is written fresh. A variable that was an object, a string, a function
// handle or a value the reader did not decode is refused when anything but its name changed, as
// is a typed object's node, whatever it holds now: this writer has no encoder for an object, and
// the record's own bytes, which are the only thing it could write, are no longer the value.
function freshOf(node: BaseNode, record: MatRecord | null, compress: boolean): Planned {
  const name = node.name;
  refuseName(name);
  const was = record?.variable ? notPlain(record.variable) : null;
  const value = valueNodeOf(node);
  if (was || !value) {
    const what = was ?? classPhrase(String((node as DataNode).className || 'object'));
    throw refusal(name, 'it is ' + what + ', which a MAT-file save writes only as it was read, or renamed, so its edit cannot be saved');
  }
  const named = elementNamed(freshElement(value), name);
  if (!named) {
    throw refusal(name, 'the element written for it has no name to replace');
  }
  return { kind: 'fresh', record, node: value, name, bytes: recordBytes(named, compress) };
}

// `node` as the node of a plain MATLAB value, or null for a node of another class: a typed
// object's (a ParameterNode, a BusNode). Asked of what the node does rather than of its class,
// which this layer does not import (test/moduleBoundaries): a MatlabVariableNode, and only it,
// writes its value as a MAT stream.
function valueNodeOf(node: BaseNode): MatlabVariableNode | null {
  const v = node as unknown as Partial<MatlabVariableNode>;
  return typeof v._matStream === 'function' && typeof v._matWritable === 'function' ? (v as MatlabVariableNode) : null;
}

// What a variable read as `v` is, in words, when it is not a plain MATLAB value; null when it is.
function notPlain(v: MatVariable): string | null {
  if (v.isOpaque) {
    return classPhrase(v.className || 'object');
  }
  if (functionHandleOf(v) || v.className === 'function_handle') {
    return 'a function handle';
  }
  if (v.className === 'unknown' || v.undecoded) {
    return 'a value that was not decoded';
  }
  return null;
}

// The miMATRIX element `node`'s value is, with the empty name a stream's value has: the stream it
// is written as in a dictionary (_matStream), which writes a sparse array no element row edited
// and a struct array with no element rows as the bytes they were read from, and anything else as
// MatWriter writes it. Refused, naming what in it this writer cannot write, when it holds what
// MatWriter has no variable for or would write as what it is not (_matWritable): an object, a
// string, a function handle, a value not decoded. And refused, finally, as a dictionary's save
// refuses it, for a value with no form at all (_heldNone, _refuseNoSize) or past MatWriter's
// budget, restated naming the variable (_budgetFailure).
function freshElement(node: MatlabVariableNode): Uint8Array {
  const unwritable = unwritableIn(node);
  if (unwritable) {
    throw refusal(node.name, unwritable.path + ' is ' + unwritable.what + ', which this package cannot write into a MAT-file');
  }
  if (node._heldNone()) {
    throw node._heldNoneRefusal();
  }
  node._refuseNoSize();
  const stream = node._matStream();
  if (stream) {
    return stream.subarray(8);
  }
  // _matStream answers null for a refusal of MatWriter's other than its budget's: asked again,
  // for its reason.
  try {
    encodeMatVariable(node._var);
  } catch (e) {
    if (e instanceof MatBudgetError) {
      throw node._budgetFailure(e);
    }
    if (e instanceof MatWriteError) {
      throw refusal(node.name, e.message);
    }
    throw e;
  }
  throw refusal(node.name, 'no MAT element could be written for it');
}

// The first node at or under `node` that MatWriter cannot write as what it is (the rule of
// MatlabVariableNode._matWritable), with its MATLAB path and what it is, or null for none.
function unwritableIn(at: BaseNode): { path: string; what: string } | null {
  const node = valueNodeOf(at);
  if (!node) {
    return { path: at.matlabPath, what: classPhrase(String((at as DataNode).className || 'object')) };
  }
  if (node._matWritable()) {
    return null;
  }
  if (node._isOpaque) {
    return { path: node.matlabPath, what: classPhrase(node._opaqueClassName || 'object') };
  }
  if (node._undecoded) {
    return { path: node.matlabPath, what: 'a value that was not decoded' };
  }
  if (node._scalarType === 'string' || node._scalarType === 'function_handle') {
    return { path: node.matlabPath, what: node._scalarType === 'string' ? 'a string' : 'a function handle' };
  }
  for (const child of node.children) {
    const below = unwritableIn(child);
    if (below) {
      return below;
    }
  }
  return { path: node.matlabPath, what: 'a value MatWriter has no variable for' };
}

// The miMATRIX element a record holds: its own bytes for a plain one, its payload inflated for a
// compressed one. Null when there is no whole element, or bytes after it: a record that is not
// one MATLAB writes is not one to rename.
function elementOfRecord(record: MatRecord): Uint8Array | null {
  const bytes = record.bytes;
  if (bytes.byteLength < 8) {
    return null;
  }
  const nbytes = u32At(bytes, 4);
  if (!record.compressed) {
    return u32At(bytes, 0) === MI_MATRIX && 8 + nbytes <= bytes.byteLength ? bytes.subarray(0, 8 + nbytes) : null;
  }
  let inflated: Uint8Array;
  try {
    inflated = inflateZlib(bytes.subarray(8, 8 + nbytes));
  } catch {
    return null;
  }
  if (inflated.byteLength < 8 || u32At(inflated, 0) !== MI_MATRIX) {
    return null;
  }
  return 8 + u32At(inflated, 4) === inflated.byteLength ? inflated : null;
}

// A top-level record of `element`: the element itself, which MatWriter pads to 8 bytes as a plain
// record must be, or its zlib stream (RFC 1950, which MATLAB requires; level 6, MATLAB's default)
// in an miCOMPRESSED tag, with no padding after it, as MATLAB writes one.
function recordBytes(element: Uint8Array, compress: boolean): Uint8Array {
  if (!compress) {
    return element;
  }
  const stream = zlibSync(element, { level: 6 });
  return concat([u32le(MI_COMPRESSED), u32le(stream.byteLength), stream]);
}

// ---- Assembly ---------------------------------------------------------------------------------

/** The bytes of the plan, each planned record's offset in them, and the subsystem's, or null. */
interface Assembled {
  bytes: Uint8Array;
  offsets: number[];
  subsystemAt: number | null;
}

// The header and the planned records, back to back. The header is the file's own: its text
// (bytes 0-115, which MATLAB keeps on `-append` and never reads), and its version and byte-order
// mark (124-127). Bytes 116-123 are the subsystem's new offset, a little-endian uint64, or, in a
// file with no subsystem, the file's own: zeros or spaces, both of which MATLAB reads as none.
function assemble(headerBytes: Uint8Array, plan: Planned[], subsystem: MatRecord | null): Assembled {
  const header = headerBytes.slice();
  const parts: Uint8Array[] = [header];
  const offsets: number[] = [];
  let subsystemAt: number | null = null;
  let at = header.byteLength;
  for (const p of plan) {
    const bytes = p.kind === 'verbatim' ? p.record.bytes : p.bytes;
    offsets.push(at);
    if (p.kind === 'verbatim' && p.record === subsystem) {
      subsystemAt = at;
    }
    parts.push(bytes);
    at += bytes.byteLength;
  }
  if (subsystemAt !== null) {
    new DataView(header.buffer, header.byteOffset, header.byteLength).setBigUint64(116, BigInt(subsystemAt), true);
  }
  return { bytes: concat(parts), offsets, subsystemAt };
}

// ---- The self-check ---------------------------------------------------------------------------
//
// The bytes about to be handed back, read again by this package's reader, against the plan: the
// header kept, and saying where the subsystem now is; the records the ones planned, at the offsets
// planned, and every one of them framed; each record written as its own bytes those bytes; each
// renamed one named as planned and, but for its name, its element byte for byte; each written
// fresh named as planned and reading back as the value it was written from, its class, size and
// every element. Any difference refuses the save.
//
// This proves what was written is what was planned, and not that MATLAB loads it: this reader
// reads files MATLAB refuses.

function selfCheck(file: string, bytes: Uint8Array, plan: Planned[], assembled: Assembled, headerBytes: Uint8Array): void {
  const fail = (why: string): never => {
    throw new MatWriteError('Cannot save "' + file + '": the file written for it did not read back as written: ' + why + '. Nothing was written.');
  };
  let parsed: ParsedMat;
  try {
    // `bytes` is the whole of its buffer (concat), which the reader may take as it is.
    parsed = parseMat(bytes.buffer as ArrayBuffer);
  } catch (e) {
    return fail('it does not open (' + (e instanceof Error ? e.message : String(e)) + ')');
  }
  if (!parsed.framed) {
    return fail('its records do not tile it (' + (parsed.unframed?.reason ?? '') + ')');
  }
  const head = parsed.headerBytes;
  if (!sameBytes(head.subarray(0, 116), headerBytes.subarray(0, 116)) || !sameBytes(head.subarray(124), headerBytes.subarray(124))) {
    return fail('its header is not the one it was read with');
  }
  const subsystemSaid = assembled.subsystemAt ?? 0;
  if (parsed.subsystemOffset !== subsystemSaid) {
    return fail('its header places its objects at byte ' + parsed.subsystemOffset + ', and they are at byte ' + subsystemSaid);
  }
  if (parsed.records.length !== plan.length) {
    return fail('it holds ' + parsed.records.length + ' record(s) where ' + plan.length + ' were written');
  }
  plan.forEach((p, i) => {
    const got = parsed.records[i];
    const at = assembled.offsets[i];
    if (got.offset !== at) {
      fail('a record starts at byte ' + got.offset + ' where one was written at byte ' + at);
    }
    if (p.kind === 'verbatim') {
      if (!sameBytes(got.bytes, p.record.bytes)) {
        fail('the record at byte ' + at + ' is not the bytes it was read from');
      }
      return;
    }
    if (got.status !== 'read' || got.anonymous || got.name !== p.name || got.variable?.name !== p.name) {
      fail('the record at byte ' + at + ', written as "' + p.name + '", reads as ' + (got.status === 'read' ? '"' + got.name + '"' : 'no variable'));
    }
    if (p.kind === 'renamed') {
      const before = elementOfRecord(p.record);
      const after = elementOfRecord(got);
      const unnamed = (e: Uint8Array | null) => (e ? elementNamed(e, '') : null);
      const was = unnamed(before);
      const is = unnamed(after);
      if (!was || !is || !sameBytes(was, is)) {
        fail('"' + p.name + '" is not, but for its name, the element it was read as');
      }
      return;
    }
    const difference = differs(p.node._var, got.variable, p.name);
    if (difference) {
      fail(difference);
    }
  });
}

// Where the value read back, `read`, is not the value `model` it was written from, in words, or
// null where it is that value: the same class, complexity, storage and size, the same members of a
// cell, the same fields of a struct in the same order, and each element the same number as its
// class holds it. MatWriter's own rules are taken as the model's meaning, not its result: an
// integer element as MATLAB converts it to the class, a single's as a float32, a member a cell or
// a struct does not hold as the empty double written for it.
function differs(model: MatVariable | null | undefined, read: MatVariable | null | undefined, at: string): string | null {
  const m = model ?? EMPTY_DOUBLE;
  const r = read ?? EMPTY_DOUBLE;
  const cls = classOf(m);
  const said = (what: string, was: string, is: string) => at + ': its ' + what + ' reads back as ' + is + ' where ' + was + ' was written';
  if (classOf(r) !== cls) {
    return said('class', cls, classOf(r));
  }
  const md = dimsOf(m);
  if (md.join('x') !== r.dimensions.join('x')) {
    return said('size', md.join('x'), r.dimensions.join('x'));
  }
  if (!!m.isComplex !== !!r.isComplex || !!m.isSparse !== !!r.isSparse) {
    return said('storage', storageOf(m), storageOf(r));
  }
  const n = md.reduce((a, b) => a * b, 1);
  if (m.isSparse) {
    return sparseDiffers(m, r, cls, at);
  }
  if (cls === 'cell') {
    const mc = flatValues(m.value) as (MatVariable | null)[];
    const rc = flatValues(r.value) as (MatVariable | null)[];
    for (let i = 0; i < n; i++) {
      const d = differs(mc[i], rc[i], at + '{' + (i + 1) + '}');
      if (d) {
        return d;
      }
    }
    return null;
  }
  if (cls === 'struct') {
    const mf = m.fields ?? {};
    const rf = r.fields ?? {};
    const names = Object.keys(mf);
    if (names.join(',') !== Object.keys(rf).join(',')) {
      return said('fields', names.join(', ') || 'none', Object.keys(rf).join(', ') || 'none');
    }
    for (let e = 0; e < n; e++) {
      for (const name of names) {
        const d = differs(memberOf(mf[name], e, n), memberOf(rf[name], e, n), at + (n === 1 ? '' : '(' + (e + 1) + ')') + '.' + name);
        if (d) {
          return d;
        }
      }
    }
    return null;
  }
  if (cls === 'char') {
    const was = String(m.value ?? '');
    const is = String(r.value ?? '');
    return was === is ? null : said('text', JSON.stringify(was), JSON.stringify(is));
  }
  const mv = flatValues(m.value);
  const rv = flatValues(r.value);
  if (mv.length !== n || rv.length !== n) {
    return said('element count', String(mv.length), String(rv.length));
  }
  const same = sameNumberFor(cls);
  for (let i = 0; i < n; i++) {
    for (const part of m.isComplex ? (['re', 'im'] as const) : (['re'] as const)) {
      const was = partOf(mv[i], part);
      const is = partOf(rv[i], part);
      if (!same(was, is)) {
        return said('element ' + (i + 1) + (m.isComplex ? ' (' + (part === 're' ? 'real' : 'imaginary') + ' part)' : ''), String(was), String(is));
      }
    }
  }
  return null;
}

// A sparse array's non-zeros, compared as a set of (row, column) to value: the order a writer
// puts them in is its own, and an explicit zero is not a non-zero MATLAB keeps.
function sparseDiffers(m: MatVariable, r: MatVariable, cls: string, at: string): string | null {
  const ms = m.sparse;
  const rs = r.sparse;
  if (!ms || !rs) {
    return at + ': it holds no non-zeros to compare';
  }
  const same = sameNumberFor(cls);
  const entries = (s: NonNullable<MatVariable['sparse']>) => {
    const out = new Map<string, [number, number]>();
    for (let k = 0; k < s.row.length; k++) {
      const re = s.re[k];
      const im = s.im ? s.im[k] : 0;
      if (re !== 0 || im !== 0) {
        out.set(s.row[k] + ',' + s.col[k], [re, im]);
      }
    }
    return out;
  };
  const was = entries(ms);
  const is = entries(rs);
  if (was.size !== is.size) {
    return at + ': it reads back with ' + is.size + ' non-zero(s) where ' + was.size + ' were written';
  }
  for (const [where, [re, im]] of was) {
    const got = is.get(where);
    if (!got || !same(re, got[0]) || !same(im, got[1])) {
      const [row, col] = where.split(',').map(Number);
      return at + ': its non-zero at (' + (row + 1) + ',' + (col + 1) + ') does not read back as written';
    }
  }
  return null;
}

const EMPTY_DOUBLE: MatVariable = { name: '', className: 'double', dimensions: [0, 0], isComplex: false, isLogical: false, value: null, fields: null };

const INTEGER_CLASS = /^u?int(?:8|16|32|64)$/;

// MATLAB's class of `v`: a logical array is class uint8 with the logical flag, in a file and in
// the variable the node layer hands MatWriter.
function classOf(v: MatVariable): string {
  return v.isLogical || v.className === 'logical' ? 'logical' : v.className;
}

function storageOf(v: MatVariable): string {
  return (v.isSparse ? 'sparse' : 'full') + (v.isComplex ? ' complex' : ' real');
}

// Whether two elements of class `cls` are the one number the class holds: an integer class's as
// MATLAB converts a value to it (integerConversion: rounded, saturated, NaN as 0), a logical's as a
// uint8, a single's as a float32, and a double's as itself, NaN equal to NaN and -0 not to 0.
function sameNumberFor(cls: string): (a: unknown, b: unknown) => boolean {
  if (INTEGER_CLASS.test(cls) || cls === 'logical') {
    const to = integerConversion(cls === 'logical' ? 'uint8' : cls);
    return (a, b) => String(to(a)) === String(to(b));
  }
  if (cls === 'single') {
    return (a, b) => Object.is(Math.fround(Number(a)), Math.fround(Number(b)));
  }
  return (a, b) => Object.is(Number(a), Number(b));
}

// One part of a numeric element: a complex one is `{re, im}`, and a real one its real part, with
// an imaginary part of 0.
function partOf(x: unknown, part: 're' | 'im'): unknown {
  if (x !== null && typeof x === 'object' && 're' in (x as Record<string, unknown>)) {
    return (x as Record<string, unknown>)[part];
  }
  return part === 're' ? x : 0;
}

// Element `e` of `n` of a struct field: a struct array holds one variable per element, a 1x1
// struct the variable itself (MatVariable.fields).
function memberOf(held: MatVariable | MatVariable[] | undefined, e: number, n: number): MatVariable | undefined {
  return Array.isArray(held) ? held[e] : n === 1 ? held : undefined;
}

// A MAT element has at least two dimensions; a variable may say fewer (MatWriter.dimsOf).
function dimsOf(v: MatVariable): number[] {
  const d = (v.dimensions || []).slice();
  while (d.length < 2) {
    d.push(1);
  }
  return d;
}

// The values of a variable as one list: MatParser leaves a 1x1 a bare value and an empty one null.
function flatValues(value: unknown): unknown[] {
  if (value === null || value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

// ---- Bytes ------------------------------------------------------------------------------------

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) {
    total += p.byteLength;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

function u32le(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n >>> 0, true);
  return out;
}

function u32At(bytes: Uint8Array, at: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
