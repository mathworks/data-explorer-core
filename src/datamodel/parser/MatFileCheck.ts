// src/datamodel/parser/MatFileCheck.ts
// Copyright 2026 The MathWorks, Inc.
//
// Whether MATLAB loads a Level-5 MAT-file, judged by the rules MATLAB loads one by, and not by
// this package's own reader.
//
// WHY A SECOND READER. `parseMat` is built to open whatever it can, which is right for a
// viewer and wrong for a judge. It clamps every declared length to the bytes present, takes a
// zero tag for the end of the variables, reads char data stored as miUTF32 or miUINT8, and
// lists a variable stored after the subsystem. MATLAB does none of that. Of the 36 files in the
// MATLAB-verdict corpus (test/fixtures/mat-check) that MATLAB does not load as stored, because
// the load fails or a variable comes back missing or changed, `parseMat` opens all 36, and 32
// of them without a single warning (measured when this was written). So a `.mat` this package
// writes and then reads back proves only that the package agrees with itself. This module is
// the other judge: it reads no value, and it lists every place a file breaks a rule MATLAB
// applies at `load`, as a MatViolation. It shares no reading code with MatParser, so none of
// the reader's repairs can leak into a verdict.
//
// THE RULES. Each was measured against MATLAB R2027a (27.1 prerelease, maca64) with `S =
// load(f)` on copies of MATLAB-written files edited one byte range at a time
// (test/fixtures/mat-check/verdicts.json holds the files and MATLAB's verdict on each):
//
//   * the header: bytes 124-125 are the version 0x0100 and 126-127 the endian mark 'IM' (0x0000
//     and 0x0200 fail, and 0x0200 makes MATLAB try HDF5); neither 16-bit half of bytes 0-3 is
//     zero (a header of NULs fails: MATLAB takes the file for Level 4);
//   * the records tile the file from byte 128 to its last byte. A plain record is its tag and
//     its declared bytes, a multiple of 8 (one cut short, or missing its final pad, fails); a
//     compressed one is its tag and exactly its zlib stream, with no padding after it (zero
//     padding to 8 fails), and nothing follows the last record (3, 8 or 100 zero bytes fail);
//   * a record is an miMATRIX, or an miCOMPRESSED whose RFC 1950 zlib stream inflates to one
//     miMATRIX and nothing else (zlib levels 0, 1, 6 and 9 all load);
//   * header bytes 116-123 are the offset of the subsystem's record (the objects' data), or 0
//     when there is none. MATLAB trusts the offset and never looks for the record: a stale,
//     zeroed or space-filled one fails the whole load;
//   * the subsystem is the last record and the only unnamed one. MATLAB stops listing variables
//     at the first unnamed record, so a variable after it is silently missing from the load
//     (the load succeeds, and `whos -file` still lists it);
//   * a variable's name is a MATLAB identifier in valid UTF-8: '1abc' and 'café' fail `S =
//     load(f)`, 'end' loads as 'end_', and a name that is not UTF-8 crashed MATLAB;
//   * char data is miUTF8 holding as many UTF-16 units as the array's elements, or miUTF16, or
//     miUINT16 below U+0100: miUTF32, miUINT8 and miINT8 fail, a surrogate in miUINT16 fails,
//     and CJK in miUINT16 loads keeping only the low byte of each unit, with no warning;
//   * every element is readable: one bad variable fails the whole-file load.
//
// Some rules were not probed, deliberately: what MATLAB writes is plain, and a file that breaks
// it is one no MATLAB was seen to write. Only a double is ever stored in a narrower type than
// its class (every other numeric class is stored in its own), every sub-element fills its
// matrix exactly, and every data sub-element holds as many elements as its dimensions say.
// They are checked as MATLAB writes them (`int-storage`, `nbytes`, `data-size`, `element`).
//
// WHERE IT IS STRICTER THAN MATLAB, on purpose, so the save path never writes a file that
// loads only by luck. Each is listed with its reason in test/matFileCheck.test.ts: a name
// stored twice (it loads, but `load f` keeps the last copy and `load f x` the first); bytes
// after the subsystem's record, which MATLAB's load never reads; a zlib stream whose Adler-32
// trailer is not the record's last four bytes.
//
// WHAT IT IS FOR. The `.mat` save checks the file it writes, and refuses to return it if it has
// a violation the original did not. A violation is therefore said with the variable it is in,
// when that has a readable name, so two files can be compared by variable rather than by an
// offset an edit moved (violationsAdded).
//
// BOUNDED. A file's bytes say how much work reading them is, and a hostile one can say a lot:
// a few kilobytes of zlib inflate to gigabytes, and a cell can declare a billion elements. So
// the check spends a budget of inflated bytes and of matrices walked (MatCheckOptions), and
// stops when either runs out, with a `budget` note saying where. It never throws: whatever the
// bytes, the answer is a list.

import { InflateCeilingError, inflateZlib, MAT_RECORD_INFLATE_CEILING } from './Inflate.js';
import { MAX_NESTING } from './MatParser.js';
import { reasonOf } from './ParseWarning.js';

/**
 * What a MatViolation is about. Each is one rule MATLAB applies at `load`:
 *
 * - `short-file`: fewer than the 128 bytes of a header;
 * - `not-level5`: the version (bytes 124-125) or the endian mark (126-127) is not a Level-5
 *   file's, or the two disagree;
 * - `level4-lookalike`: a 16-bit half of bytes 0-3 is zero, so MATLAB reads the file as Level 4;
 * - `big-endian`: an 'MI' file, noted and not checked further (this package does not read one);
 * - `framing`: the records do not tile the file from byte 128 to its end: one is cut short, one
 *   is not a whole number of 8-byte words, or bytes follow or pad them;
 * - `top-level-type`: a record that is neither miMATRIX nor miCOMPRESSED;
 * - `empty-matrix`: a record holding an miMATRIX of 0 bytes;
 * - `compressed-wrapper`: a compressed record that is not one zlib stream of one miMATRIX;
 * - `subsystem-offset`: header bytes 116-123 do not point at the subsystem's record, or are 0
 *   with a subsystem in the file;
 * - `subsystem-not-last`: a record after the subsystem, which MATLAB silently leaves out;
 * - `anonymous-record`: an unnamed record that is not the subsystem, where MATLAB stops listing;
 * - `name`: a variable name that is not valid UTF-8, not an identifier, or a keyword (an empty
 *   one is an `anonymous-record`);
 * - `duplicate-name`: two records of one name;
 * - `char-type`: char data in a type MATLAB does not read as text, or reads wrong;
 * - `utf8-count`: miUTF8 char data whose UTF-16 length is not the array's element count;
 * - `nbytes`: a matrix its sub-elements do not fill exactly;
 * - `int-storage`: a numeric array of a class other than double, stored in a type other than
 *   its class's own;
 * - `element`: a sub-element MATLAB cannot read where it stands: array flags, dimensions or a
 *   name of the wrong type, an unknown class or data type, a small tag of more than 4 bytes, a
 *   container member that is not a matrix;
 * - `data-size`: a data sub-element holding more or fewer elements than the dimensions say;
 * - `budget`: the check stopped here, and nothing from here on was checked.
 */
export type MatViolationCode =
  | 'short-file'
  | 'not-level5'
  | 'level4-lookalike'
  | 'big-endian'
  | 'framing'
  | 'top-level-type'
  | 'empty-matrix'
  | 'compressed-wrapper'
  | 'subsystem-offset'
  | 'subsystem-not-last'
  | 'anonymous-record'
  | 'name'
  | 'duplicate-name'
  | 'char-type'
  | 'utf8-count'
  | 'nbytes'
  | 'int-storage'
  | 'element'
  | 'data-size'
  | 'budget';

/** One rule a MAT-file breaks, and where. */
export interface MatViolation {
  code: MatViolationCode;
  /**
   * The byte of the file it is at. Inside a compressed record that is the record's own tag,
   * since the bytes at fault exist only inflated; the message gives their place in the
   * inflated payload. For a header field (`subsystem-offset`) it is the field.
   */
  at: number;
  /** What is wrong, and what MATLAB does with it, in a sentence a user can be shown. */
  message: string;
  /** The variable it is in, when its record has a name that could be read. */
  variable?: string;
}

/** How much one check may spend. Past either budget it stops with a `budget` note. */
export interface MatCheckOptions {
  /** Matrices walked, top-level and nested together. Defaults to MAT_CHECK_ELEMENT_BUDGET. */
  maxElements?: number;
  /** Bytes inflated from compressed records, over the whole file. Defaults to MAT_CHECK_INFLATE_BUDGET. */
  maxInflatedBytes?: number;
}

/**
 * How many matrices one check walks, at most: 2^24. A matrix costs the check a few tag reads,
 * and 2^24 of them is a struct array of 1.6 million elements and ten fields each.
 */
export const MAT_CHECK_ELEMENT_BUDGET = 2 ** 24;

/**
 * How many bytes one check inflates, at most, over every compressed record of the file: 1 GiB.
 * The check inflates one record at a time and drops it, so this bounds time more than memory;
 * the largest record in the corpus `parseMat` is measured against inflates to 114 MB.
 */
export const MAT_CHECK_INFLATE_BUDGET = 2 ** 30;

const MI_INT8 = 1;
const MI_UINT8 = 2;
const MI_INT16 = 3;
const MI_UINT16 = 4;
const MI_INT32 = 5;
const MI_UINT32 = 6;
const MI_SINGLE = 7;
const MI_DOUBLE = 9;
const MI_INT64 = 12;
const MI_UINT64 = 13;
const MI_MATRIX = 14;
const MI_COMPRESSED = 15;
const MI_UTF8 = 16;
const MI_UTF16 = 17;

const TYPE_NAMES: Record<number, string> = {
  [MI_INT8]: 'miINT8', [MI_UINT8]: 'miUINT8', [MI_INT16]: 'miINT16', [MI_UINT16]: 'miUINT16',
  [MI_INT32]: 'miINT32', [MI_UINT32]: 'miUINT32', [MI_SINGLE]: 'miSINGLE', [MI_DOUBLE]: 'miDOUBLE',
  [MI_INT64]: 'miINT64', [MI_UINT64]: 'miUINT64', [MI_MATRIX]: 'miMATRIX', [MI_COMPRESSED]: 'miCOMPRESSED',
  [MI_UTF8]: 'miUTF8', [MI_UTF16]: 'miUTF16', 18: 'miUTF32',
};

/** The bytes one element of each numeric data type takes. */
const WIDTH: Record<number, number> = {
  [MI_INT8]: 1, [MI_UINT8]: 1, [MI_INT16]: 2, [MI_UINT16]: 2, [MI_INT32]: 4, [MI_UINT32]: 4,
  [MI_SINGLE]: 4, [MI_DOUBLE]: 8, [MI_INT64]: 8, [MI_UINT64]: 8,
};

const MX_CELL = 1;
const MX_STRUCT = 2;
const MX_OBJECT = 3;
const MX_CHAR = 4;
const MX_SPARSE = 5;
const MX_DOUBLE = 6;
const MX_SINGLE = 7;
const MX_UINT8 = 9;
const MX_FUNCTION = 16;
const MX_OPAQUE = 17;

const CLASS_NAMES: Record<number, string> = {
  1: 'cell', 2: 'struct', 3: 'object', 4: 'char', 5: 'sparse', 6: 'double', 7: 'single',
  8: 'int8', 9: 'uint8', 10: 'int16', 11: 'uint16', 12: 'int32', 13: 'uint32', 14: 'int64',
  15: 'uint64', 16: 'function_handle', 17: 'opaque',
};

/** The one data type each numeric class but double is stored in. */
const OWN_TYPE: Record<number, number> = {
  7: MI_SINGLE, 8: MI_INT8, 9: MI_UINT8, 10: MI_INT16, 11: MI_UINT16, 12: MI_INT32,
  13: MI_UINT32, 14: MI_INT64, 15: MI_UINT64,
};

// The array flags' bits above the class byte.
const LOGICAL_BIT = 0x200;
const COMPLEX_BIT = 0x800;
const SPARSE_BIT = 0x1000;

// MATLAB's keywords (iskeyword), which a variable name may not be: the same list
// datamodel/matlabName.ts holds, restated because this folder imports nothing from there.
const KEYWORDS = new Set([
  'break', 'case', 'catch', 'classdef', 'continue', 'else', 'elseif', 'end', 'for', 'function',
  'global', 'if', 'otherwise', 'parfor', 'persistent', 'return', 'spmd', 'switch', 'try', 'while',
]);

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

// Fatal, so bytes that are not UTF-8 are said to be, and keeping a BOM, so a name or a text
// that opens with one is not read as one without it.
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const looseUtf8 = new TextDecoder('utf-8', { ignoreBOM: true });

// The MAT stream a subsystem's uint8 data opens with: the version 0x0100 and 'IM'.
const STREAM_MAGIC = [0x00, 0x01, 0x49, 0x4d];

/** Thrown inside a check when a budget runs out, and turned into its `budget` note. */
class OutOfBudget extends Error {
  constructor(readonly at: number, message: string) {
    super(message);
    this.name = 'OutOfBudget';
  }
}

/**
 * The bytes a matrix is read out of: the file itself, or a compressed record's payload,
 * inflated. `fileAt` is the file offset a violation at `o` is reported at, and `where` says
 * where `o` is, in words.
 */
interface Space {
  view: DataView;
  fileAt(o: number): number;
  where(o: number): string;
}

function fileSpace(view: DataView): Space {
  return { view, fileAt: (o) => o, where: (o) => `Byte ${o}` };
}

function payloadSpace(view: DataView, record: number): Space {
  return {
    view,
    fileAt: () => record,
    where: (o) => `Byte ${o} of the compressed record at byte ${record}, inflated,`,
  };
}

/** What the placement rules need of one top-level record. */
interface RecordInfo {
  at: number;
  /** Its variable's name; '' for an unnamed one, null when the name could not be read. */
  name: string | null;
  /** It is unnamed and holds subsystem data: uint8 bytes that open as a MAT stream. */
  subsystem: boolean;
}

/** A sub-element's tag, in either of the format's two spellings. */
interface Tag {
  type: number;
  /** The payload bytes it declares. */
  n: number;
  /** Where its payload starts. */
  data: number;
  /** Where the next sub-element starts: past the payload and its pad to 8 bytes. */
  next: number;
}

/** What `readHeader` reads of a matrix: everything before its class's own sub-elements. */
interface MatrixHead {
  cls: number;
  flags: number;
  dims: number[];
  numel: number;
  name: Uint8Array;
  /** Where the class's own sub-elements start. */
  p: number;
}

class Check {
  readonly out: MatViolation[] = [];
  readonly maxElements: number;
  readonly maxInflated: number;
  elementsLeft: number;
  inflateLeft: number;
  /** The record being checked, for a `budget` note on a throw nobody expected. */
  cursor = 128;
  /** The variable whose record is being checked, once its name is read. */
  variable: string | undefined;
  /** Whether the walk is inside the subsystem's stream, which belongs to no variable. */
  inSubsystem = false;

  constructor(options: MatCheckOptions) {
    this.maxElements = options.maxElements ?? MAT_CHECK_ELEMENT_BUDGET;
    this.maxInflated = options.maxInflatedBytes ?? MAT_CHECK_INFLATE_BUDGET;
    this.elementsLeft = this.maxElements;
    this.inflateLeft = this.maxInflated;
  }

  /** A violation of the file as a whole, or of one record seen from outside it. */
  file(code: MatViolationCode, at: number, message: string, variable?: string): void {
    const v: MatViolation = { code, at, message };
    if (variable) v.variable = variable;
    this.out.push(v);
  }

  /** A violation inside a matrix, said with where it is and whose it is. */
  report(code: MatViolationCode, space: Space, o: number, text: string): void {
    const whose = this.inSubsystem
      ? ' (in the subsystem, the data of the objects in the file)'
      : this.variable ? ` (in "${this.variable}")` : '';
    const v: MatViolation = { code, at: space.fileAt(o), message: `${space.where(o)}${whose}: ${text}.` };
    if (this.variable && !this.inSubsystem) v.variable = this.variable;
    this.out.push(v);
  }

  /** One more matrix walked, or the end of the check. */
  spend(space: Space, o: number): void {
    if (--this.elementsLeft < 0) {
      throw new OutOfBudget(space.fileAt(o), `more than the ${this.maxElements} matrices one check walks`);
    }
  }
}

/**
 * Check a Level-5 MAT-file against the rules MATLAB loads one by (see the top of this file),
 * and list every place it breaks one, in file order. An empty list means MATLAB loads the
 * file, every variable in it, as stored. Pure and synchronous, and it never throws: bytes that
 * are not a MAT-file at all are a violation too.
 */
export function checkMatFile(bytes: Uint8Array, options: MatCheckOptions = {}): MatViolation[] {
  const check = new Check(options);
  try {
    checkFile(check, bytes);
  } catch (err) {
    // A budget run out, or, if this module has a defect, any other throw: either way the
    // check did not finish, and that is said rather than thrown, at the record it was in.
    const at = err instanceof OutOfBudget ? err.at : check.cursor;
    const why = err instanceof OutOfBudget ? err.message : `an error in the check itself (${reasonOf(err)})`;
    check.file('budget', at, `The check stopped at byte ${at}, at ${why}, so nothing from there on was checked.`);
  }
  // Stable, so the violations of one place keep the order they were found in.
  return check.out.sort((a, b) => a.at - b.at);
}

/**
 * What one variable's miMATRIX element (its tag and body, as a record holds it inflated) breaks
 * of the rules MATLAB reads a matrix by, at any depth: its char data, its storage, how its
 * sub-elements fill it, its name. Not the rules of a file (its header, framing, compression,
 * placement), which only a whole file has: those are checkMatFile's. Every `at` is 0, the
 * element's own start, and each message says where in the element. Asked of a variable as it was
 * read, whose element is in memory already, so nothing is inflated; and like checkMatFile it never
 * throws, and stops at its budget with a `budget` note.
 */
export function checkMatElement(element: Uint8Array, options: MatCheckOptions = {}): MatViolation[] {
  const check = new Check(options);
  const view = new DataView(element.buffer, element.byteOffset, element.byteLength);
  const space: Space = { view, fileAt: () => 0, where: (o) => `Byte ${o} of its element` };
  try {
    if (element.byteLength < 8) {
      check.file('element', 0, `The element holds ${element.byteLength} byte(s), fewer than one element's tag.`);
    } else if (view.getUint32(0, true) !== MI_MATRIX) {
      check.file('element', 0, `The element is a data element of ${typeName(view.getUint32(0, true))}, not a matrix.`);
    } else {
      topMatrix(check, space, 0, 8, Math.min(8 + view.getUint32(4, true), element.byteLength));
    }
  } catch (err) {
    const why = err instanceof OutOfBudget ? err.message : `an error in the check itself (${reasonOf(err)})`;
    check.file('budget', 0, `The check of the element stopped at ${why}, so nothing from there on was checked.`, check.variable);
  }
  return check.out;
}

/**
 * The violations of `after` that `before` does not have: what a rewrite of a file added to it.
 *
 * Matched by code and variable, never by offset or message, which an edit anywhere before a
 * record moves; and counted, so a third violation of one kind in one variable is added where
 * the original had two. `renamed` maps a variable's name in `after` to its name in `before`.
 * A `budget` note in `after` is always added: a check that did not finish proves nothing about
 * what it did not reach, whatever the original's check reached.
 */
export function violationsAdded(
  before: readonly MatViolation[],
  after: readonly MatViolation[],
  renamed: ReadonlyMap<string, string> = new Map(),
): MatViolation[] {
  const key = (code: MatViolationCode, variable: string | undefined) => `${code}\u0000${variable ?? ''}`;
  const held = new Map<string, number>();
  for (const v of before) {
    const k = key(v.code, v.variable);
    held.set(k, (held.get(k) ?? 0) + 1);
  }
  const added: MatViolation[] = [];
  for (const v of after) {
    const k = key(v.code, v.variable === undefined ? undefined : renamed.get(v.variable) ?? v.variable);
    const left = held.get(k) ?? 0;
    if (v.code === 'budget' || left === 0) {
      added.push(v);
    } else {
      held.set(k, left - 1);
    }
  }
  return added;
}

function checkFile(check: Check, bytes: Uint8Array): void {
  if (bytes.byteLength < 128) {
    check.file('short-file', 0, `The file holds ${bytes.byteLength} bytes, fewer than the 128 of a MAT-file's header.`);
    return;
  }
  if (!checkHeader(check, bytes)) {
    return;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = subsystemOffset(view, bytes);
  const records = walkRecords(check, view, bytes, offset);
  checkPlacement(check, records, offset, bytes.byteLength);
}

/** Whether the rest of the file is a Level-5 one to check, having said what the header breaks. */
function checkHeader(check: Check, bytes: Uint8Array): boolean {
  // MATLAB looks at the first four bytes before anything else, and a zero in either 16-bit
  // half of them makes it read the file as Level 4: a header text that opens with NULs.
  if ((bytes[0] | bytes[1]) === 0 || (bytes[2] | bytes[3]) === 0) {
    check.file('level4-lookalike', 0, 'A 16-bit half of the header\'s first four bytes is zero, so MATLAB reads '
      + 'the file as a Level 4 MAT-file and fails the load. The header text must not open with NUL bytes.');
  }
  const mark = String.fromCharCode(bytes[126], bytes[127]);
  const version = `${hex2(bytes[124])} ${hex2(bytes[125])}`;
  if (mark === 'MI' && bytes[124] === 0x01 && bytes[125] === 0x00) {
    check.file('big-endian', 126, 'The file is big-endian (\'MI\'). MATLAB reads one, but this package does not, '
      + 'so nothing after the header was checked.');
    return false;
  }
  if (mark !== 'IM' && mark !== 'MI') {
    check.file('not-level5', 126, `Header bytes 126-127 are ${hex2(bytes[126])} ${hex2(bytes[127])}, not the endian mark `
      + '\'IM\' of a Level-5 MAT-file, so MATLAB does not read it as one.');
    return false;
  }
  if (mark === 'IM' && !(bytes[124] === 0x00 && bytes[125] === 0x01)) {
    check.file('not-level5', 124, bytes[124] === 0x00 && bytes[125] === 0x02
      ? 'Header bytes 124-125 are 00 02, the version 0x0200 of a -v7.3 (HDF5) file, which is not a Level-5 MAT-file.'
      : `Header bytes 124-125 are ${version}, where a Level-5 MAT-file holds the version 0x0100 (bytes 00 01), `
        + 'so MATLAB fails the load.');
    return false;
  }
  if (mark === 'MI') {
    check.file('not-level5', 124, `Header bytes 124-125 are ${version}, and a big-endian ('MI') file holds the version `
      + '0x0100 as bytes 01 00: the version and the endian mark disagree, so MATLAB fails the load.');
    return false;
  }
  return true;
}

function hex2(b: number): string {
  return b.toString(16).padStart(2, '0');
}

/** Header bytes 116-123: the subsystem's offset, where eight spaces mean 0 as zeros do. */
function subsystemOffset(view: DataView, bytes: Uint8Array): number {
  if (bytes.subarray(116, 124).every((b) => b === 0x20)) {
    return 0;
  }
  return view.getUint32(120, true) * 2 ** 32 + view.getUint32(116, true);
}

/**
 * Every record from byte 128 to the end of the file, each checked, and what the placement
 * rules need of each. The walk is MATLAB's: a record is its 8-byte tag and the bytes the tag
 * declares, and the next one starts right after them, whatever the alignment.
 */
function walkRecords(check: Check, view: DataView, bytes: Uint8Array, offset: number): RecordInfo[] {
  const records: RecordInfo[] = [];
  const file = fileSpace(view);
  const length = bytes.byteLength;
  let at = 128;
  while (at < length) {
    check.cursor = at;
    check.variable = undefined;
    if (bytes[at] === 0) {
      // No record tag opens with a zero byte (a record's type is 14 or 15), so this is padding,
      // or the bytes after the last record, or a tag of type 0. Said once, as what it is.
      const zeros = zeroRun(bytes, at);
      const last = records[records.length - 1];
      if (at + zeros === length && last !== undefined && last.at === offset && last.subsystem) {
        // Measured: MATLAB loads a file with 8 zero bytes after its subsystem, because its
        // load stops reading at the subsystem. They are no record all the same, and what
        // MATLAB's own `save -append`, which reads past the subsystem, makes of them is not
        // known, so they are said as the bytes that do not frame they are.
        check.file('framing', at, `The file ends with ${zeros} zero byte(s) after the subsystem's record, which are no `
          + 'record: MATLAB\'s load does not read past the subsystem, but MATLAB writes nothing after it.');
        break;
      }
      if (at + zeros === length) {
        const after = last === undefined ? 'its header' : 'its last record';
        check.file('framing', at, zeros < 8
          ? `The file ends with ${zeros} zero byte(s) after ${after}, fewer than a record's tag: `
            + 'MATLAB fails the load. Nothing may follow the last record.'
          : `The file ends with ${zeros} zero bytes after ${after}, which MATLAB reads as a record of type 0, `
            + 'and fails the load. Nothing may follow the last record.');
        break;
      }
      if (zeros < 8 && at + zeros + 8 <= length && isRecordType(view.getUint32(at + zeros, true))) {
        check.file('framing', at, `${zeros} zero byte(s) at byte ${at} pad the record before them: MATLAB reads the `
          + 'next record right where the last one\'s declared bytes end, and a compressed record is never padded, so '
          + 'it fails the load.');
        at += zeros;
        continue;
      }
      const word = at + 4 <= length ? view.getUint32(at, true) : 0;
      check.file('framing', at, `The bytes at ${at} are no record's tag (they read as ${typeName(word)}): MATLAB `
        + 'fails the load, and nothing after them was checked.');
      break;
    }
    if (length - at < 8) {
      check.file('framing', at, `The file ends ${length - at} byte(s) into a record's tag: MATLAB fails the load.`);
      break;
    }
    const type = view.getUint32(at, true);
    const n = view.getUint32(at + 4, true);
    if (at + 8 + n > length) {
      check.file('framing', at, `The record at byte ${at} declares ${n} bytes, and the file holds ${length - at - 8} `
        + 'after its tag: it is cut short, and MATLAB fails the load.');
      break;
    }
    if (type === MI_MATRIX) {
      records.push(plainRecord(check, file, at, n));
    } else if (type === MI_COMPRESSED) {
      records.push(compressedRecord(check, bytes.subarray(at + 8, at + 8 + n), at));
    } else {
      check.file('top-level-type', at, `The record at byte ${at} is a data element of ${typeName(type)}: a variable is `
        + 'stored as an miMATRIX or an miCOMPRESSED, and MATLAB fails the load on anything else.');
    }
    at += 8 + n;
  }
  return records;
}

function zeroRun(bytes: Uint8Array, at: number): number {
  let end = at;
  while (end < bytes.byteLength && bytes[end] === 0) end++;
  return end - at;
}

function isRecordType(word: number): boolean {
  return word === MI_MATRIX || word === MI_COMPRESSED;
}

function typeName(type: number): string {
  return TYPE_NAMES[type] ?? `type ${type}`;
}

function plainRecord(check: Check, file: Space, at: number, n: number): RecordInfo {
  if (n === 0) {
    check.file('empty-matrix', at, `The record at byte ${at} is an miMATRIX of 0 bytes: MATLAB fails the load. `
      + 'Only a matrix inside another may be empty.');
    return { at, name: null, subsystem: false };
  }
  const info = topMatrix(check, file, at, at + 8, at + 8 + n);
  if (n % 8 !== 0) {
    check.file('framing', at, `The record at byte ${at} declares ${n} bytes, not a whole number of 8-byte words: `
      + 'a plain record ends padded to 8 bytes, so this one is missing its final pad, and MATLAB fails the load.',
    info.name || undefined);
  }
  return info;
}

/**
 * A compressed record: one zlib stream (RFC 1950) that inflates to one miMATRIX and nothing
 * else, and ends at the record's last byte. Its matrix is then checked in the inflated bytes.
 */
function compressedRecord(check: Check, payload: Uint8Array, at: number): RecordInfo {
  const unread: RecordInfo = { at, name: null, subsystem: false };
  // Said once the record's name is known, if it can be, and ahead of what its matrix breaks.
  const faults: string[] = [];
  const fault = (text: string): void => {
    faults.push(`The compressed record at byte ${at} ${text}.`);
  };
  const first = check.out.length;
  const done = (info: RecordInfo): RecordInfo => {
    const said = faults.map((message) => {
      const v: MatViolation = { code: 'compressed-wrapper', at, message };
      if (info.name) v.variable = info.name;
      return v;
    });
    check.out.splice(first, 0, ...said);
    return info;
  };
  const head = zlibHeaderFault(payload);
  if (head) {
    fault(`${head}: MATLAB inflates a record only as a zlib stream, and fails the load`);
    return done(unread);
  }
  const ceiling = Math.min(check.inflateLeft, MAT_RECORD_INFLATE_CEILING);
  let inflated: Uint8Array;
  try {
    inflated = inflateZlib(payload, ceiling);
  } catch (err) {
    if (err instanceof InflateCeilingError) {
      if (ceiling < MAT_RECORD_INFLATE_CEILING) {
        throw new OutOfBudget(at, `more than the ${check.maxInflated} bytes one check inflates`);
      }
      fault(`inflates to more than the ${MAT_RECORD_INFLATE_CEILING} bytes one record of a -v7 file can hold`);
      return done(unread);
    }
    fault(`does not inflate (${reasonOf(err)}): MATLAB fails the load`);
    return done(unread);
  }
  check.inflateLeft -= inflated.byteLength;
  // The stream ends with the Adler-32 of what it inflates to, so a record whose last four
  // bytes are that checksum ends where its stream does. Anything else is bytes after the
  // stream, which MATLAB's record never has, or a checksum that is wrong.
  const trailer = new DataView(payload.buffer, payload.byteOffset + payload.byteLength - 4, 4).getUint32(0, false);
  if (trailer !== adler32(inflated)) {
    fault('does not end with its zlib stream\'s checksum: bytes follow the stream inside the record, or the '
      + 'checksum is wrong. MATLAB writes a record as exactly its stream');
  }
  if (inflated.byteLength < 8) {
    fault(`inflates to ${inflated.byteLength} byte(s), fewer than one element's tag: MATLAB fails the load`);
    return done(unread);
  }
  const view = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
  const type = view.getUint32(0, true);
  const n = view.getUint32(4, true);
  if (type === MI_COMPRESSED) {
    fault('inflates to another compressed record: MATLAB never nests one, and fails the load');
    return done(unread);
  }
  if (type !== MI_MATRIX) {
    fault(`inflates to a data element of ${typeName(type)}, where a record holds a matrix: MATLAB fails the load`);
    return done(unread);
  }
  if (n === 0) {
    check.file('empty-matrix', at, `The compressed record at byte ${at} holds an miMATRIX of 0 bytes: MATLAB fails `
      + 'the load. Only a matrix inside another may be empty.');
    return done(unread);
  }
  const held = inflated.byteLength - 8;
  if (n > held) {
    fault(`holds a matrix that declares ${n} bytes, and it inflates to ${held} after the matrix's tag: `
      + 'the matrix is cut short, and MATLAB fails the load');
  } else if (n < held) {
    fault(`inflates to ${held - n} byte(s) after its matrix: MATLAB's record holds one matrix and nothing after it`);
  }
  return done(topMatrix(check, payloadSpace(view, at), at, 8, 8 + Math.min(n, held)));
}

/**
 * Why `payload` is not a zlib stream by its first two bytes, or null when it opens like one:
 * compression method 8 (deflate) with a window of at most 32 KiB, a header check that holds,
 * and no preset dictionary, which MATLAB does not supply.
 */
function zlibHeaderFault(payload: Uint8Array): string | null {
  if (payload.byteLength < 6) {
    return `holds ${payload.byteLength} byte(s), fewer than the smallest zlib stream`;
  }
  const cmf = payload[0];
  const flg = payload[1];
  if (cmf === 0x1f && flg === 0x8b) {
    return 'is a gzip stream, not a zlib one';
  }
  if ((cmf & 0x0f) !== 8 || cmf >> 4 > 7 || ((cmf << 8) | flg) % 31 !== 0) {
    return `does not open with a zlib header (it opens ${hex2(cmf)} ${hex2(flg)}; raw deflate has none)`;
  }
  if (flg & 0x20) {
    return 'is a zlib stream that needs a preset dictionary';
  }
  return null;
}

/** RFC 1950's checksum of `bytes`. */
function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  const n = bytes.byteLength;
  for (let i = 0; i < n;) {
    // 5552 bytes is the most the sums take before they must be reduced to stay exact in 32 bits,
    // and so certainly within a double.
    const stop = Math.min(n, i + 5552);
    for (; i < stop; i++) {
      a += bytes[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return (b * 65536 + a) >>> 0;
}

/**
 * The tag of the sub-element at `o`, which has to end by `end`, or null when it does not, or
 * when its small form declares more than the 4 bytes it can hold. Both are said here, so a
 * caller that gets null stops reading the matrix and adds nothing.
 */
function readTag(check: Check, space: Space, o: number, end: number, what: string): Tag | null {
  if (o + 8 > end) {
    check.report('nbytes', space, o, `the matrix ends ${end - o} byte(s) into the tag of its ${what}, so its `
      + 'sub-elements do not fill it: MATLAB fails the load');
    return null;
  }
  const word = space.view.getUint32(o, true);
  const small = word >>> 16;
  if (small !== 0) {
    // The small form: the count in the upper half of the first word, the data in the second.
    if (small > 4) {
      check.report('element', space, o, `the ${what} has a small tag declaring ${small} bytes, more than the 4 `
        + 'it holds: MATLAB fails the load');
      return null;
    }
    return { type: word & 0xffff, n: small, data: o + 4, next: o + 8 };
  }
  const n = space.view.getUint32(o + 4, true);
  // A matrix inside another is its tag and its declared bytes; a primitive is padded to 8.
  const next = o + 8 + (word === MI_MATRIX ? n : align8(n));
  if (next > end) {
    const size = word === MI_MATRIX || n % 8 === 0 ? `${n} bytes` : `${n} bytes, ${align8(n)} with its pad,`;
    check.report('nbytes', space, o, `the ${what} declares ${size} and the matrix holding it has `
      + `${Math.max(0, end - o - 8)} left after its tag: MATLAB fails the load`);
    return null;
  }
  return { type: word, n, data: o + 8, next };
}

function align8(n: number): number {
  return n + ((8 - (n % 8)) % 8);
}

/** A top-level record's matrix: checked, and what the placement rules need of it. */
function topMatrix(check: Check, space: Space, at: number, start: number, end: number): RecordInfo {
  const info: RecordInfo = { at, name: null, subsystem: false };
  check.spend(space, start);
  const head = readHeader(check, space, start, end);
  if (!head) {
    return info;
  }
  info.name = recordName(check, at, head.name);
  const stream = info.name === '' ? subsystemStream(space, head, end) : null;
  info.subsystem = stream !== null;
  const p = classBody(check, space, head, end, 0);
  if (p !== null) {
    fillsExactly(check, space, p, end);
  }
  if (stream !== null) {
    checkSubsystem(check, space, stream.start, stream.end);
  }
  return info;
}

/**
 * A variable's name, having said what is wrong with it: '' for none, and for bytes that are
 * not UTF-8 the name as far as it reads, so the violation can still say whose it is.
 */
function recordName(check: Check, at: number, bytes: Uint8Array): string {
  if (bytes.byteLength === 0) {
    return '';
  }
  let name: string;
  try {
    name = strictUtf8.decode(bytes);
  } catch {
    name = looseUtf8.decode(bytes);
    check.variable = name;
    check.file('name', at, `The variable name at byte ${at} is not valid UTF-8 (bytes ${Array.from(bytes, hex2).join(' ')}): `
      + 'MATLAB crashes reading it, in `load` and in `whos -file` alike.', name);
    return name;
  }
  check.variable = name;
  if (!IDENTIFIER.test(name)) {
    check.file('name', at, `The variable name "${name}" at byte ${at} is not a MATLAB identifier (a letter, then `
      + 'letters, digits and underscores): `S = load(f)` fails on it, and `load(f)` leaves it out.', name);
  } else if (KEYWORDS.has(name)) {
    check.file('name', at, `The variable name "${name}" at byte ${at} is a MATLAB keyword: MATLAB loads it as `
      + `"${name}_", with a warning.`, name);
  }
  return name;
}

/**
 * Everything before a matrix's class's own sub-elements: the array flags, the dimensions
 * (which an opaque has none of), the name. Null, having said why, when they are not there to
 * read as MATLAB reads them.
 */
function readHeader(check: Check, space: Space, start: number, end: number): MatrixHead | null {
  const view = space.view;
  const flagsTag = readTag(check, space, start, end, 'array flags');
  if (!flagsTag) {
    return null;
  }
  if (flagsTag.type !== MI_UINT32 || flagsTag.n !== 8) {
    check.report('element', space, start, `the matrix's array flags are ${flagsTag.n} byte(s) of ${typeName(flagsTag.type)}, `
      + 'where MATLAB writes and reads two miUINT32 words: it fails the load');
    return null;
  }
  const flags = view.getUint32(flagsTag.data, true);
  const cls = flags & 0xff;
  if (cls < MX_CELL || cls > MX_OPAQUE) {
    check.report('element', space, start, `the matrix's array class is ${cls}, which is no class MATLAB reads: `
      + 'it fails the load');
    return null;
  }
  let p = flagsTag.next;
  const dims: number[] = [];
  let numel = 1;
  if (cls !== MX_OPAQUE) {
    const dimsTag = readTag(check, space, p, end, 'dimensions');
    if (!dimsTag) {
      return null;
    }
    if (dimsTag.type !== MI_INT32 || dimsTag.n % 4 !== 0 || dimsTag.n < 8) {
      check.report('element', space, p, `the matrix's dimensions are ${dimsTag.n} byte(s) of ${typeName(dimsTag.type)}, `
        + 'where MATLAB writes and reads two or more miINT32 extents: it fails the load');
      return null;
    }
    for (let i = 0; i < dimsTag.n; i += 4) {
      const extent = view.getInt32(dimsTag.data + i, true);
      if (extent < 0) {
        check.report('element', space, p, `the matrix's dimension ${i / 4 + 1} is ${extent}, which is no size: `
          + 'MATLAB fails the load');
        return null;
      }
      dims.push(extent);
      numel *= extent;
    }
    p = dimsTag.next;
  }
  const nameTag = readTag(check, space, p, end, 'name');
  if (!nameTag) {
    return null;
  }
  if (nameTag.type !== MI_INT8 && nameTag.type !== MI_UINT8) {
    check.report('element', space, p, `the matrix's name is ${typeName(nameTag.type)}, where MATLAB writes an `
      + 'miINT8 one: it fails the load');
    return null;
  }
  const name = new Uint8Array(view.buffer, view.byteOffset + nameTag.data, nameTag.n);
  return { cls, flags, dims, numel, name, p: nameTag.next };
}

/** A matrix inside another: a cell's member, a struct's field, an object's data. */
function nestedMatrix(check: Check, space: Space, start: number, end: number, depth: number): void {
  check.spend(space, start);
  if (depth > MAX_NESTING) {
    throw new OutOfBudget(space.fileAt(start), `a matrix nested more than ${MAX_NESTING} levels deep`);
  }
  const head = readHeader(check, space, start, end);
  if (!head) {
    return;
  }
  const p = classBody(check, space, head, end, depth);
  if (p !== null) {
    fillsExactly(check, space, p, end);
  }
}

/** A matrix whose class's sub-elements end at `p` holds nothing after them. */
function fillsExactly(check: Check, space: Space, p: number, end: number): void {
  if (p !== end) {
    check.report('nbytes', space, p, `${end - p} byte(s) follow the matrix's last sub-element inside it: MATLAB reads `
      + 'a matrix as its sub-elements back to back, and they must fill it exactly');
  }
}

/**
 * The sub-elements a matrix of `head.cls` holds after its name, checked: where they end, or
 * null when a fault already said means the rest cannot be read.
 */
function classBody(check: Check, space: Space, head: MatrixHead, end: number, depth: number): number | null {
  const cls = head.cls;
  switch (cls) {
    case MX_CELL:
      return members(check, space, head.p, end, head.numel, depth, 'cell member');
    case MX_STRUCT:
      return structBody(check, space, head, head.p, end, depth);
    case MX_OBJECT: {
      const p = className(check, space, head.p, end);
      return p === null ? null : structBody(check, space, head, p, end, depth);
    }
    case MX_CHAR:
      return charBody(check, space, head, end);
    case MX_SPARSE:
      return sparseBody(check, space, head, end);
    case MX_FUNCTION:
      return members(check, space, head.p, end, head.numel, depth, 'function handle member');
    case MX_OPAQUE: {
      const sub = className(check, space, head.p, end, 'subsystem name');
      const p = sub === null ? null : className(check, space, sub, end);
      return p === null ? null : members(check, space, p, end, 1, depth, 'object data');
    }
    default:
      return head.flags & SPARSE_BIT ? sparseBody(check, space, head, end) : numericBody(check, space, head, end);
  }
}

/**
 * `count` matrices back to back from `p`, each checked: a cell's members, a struct's fields
 * (element by element, field by field), a function handle's parts, an object's data.
 */
function members(check: Check, space: Space, p: number, end: number, count: number, depth: number, what: string): number | null {
  for (let i = 0; i < count; i++) {
    if (p >= end) {
      check.report('nbytes', space, p, `the matrix holds ${i} of the ${count} ${what}(s) it declares: MATLAB fails the load`);
      return null;
    }
    const tag = readTag(check, space, p, end, `${what} ${i + 1}`);
    if (!tag) {
      return null;
    }
    if (tag.type !== MI_MATRIX) {
      check.report('element', space, p, `${what} ${i + 1} is a data element of ${typeName(tag.type)}, where MATLAB `
        + 'reads only a matrix: it fails the load');
      return null;
    }
    // An empty matrix here is a member MATLAB reads as [], and has no sub-elements to check,
    // but it is spent as one: a billion of them is still a billion reads.
    if (tag.n > 0) {
      nestedMatrix(check, space, tag.data, tag.next, depth + 1);
    } else {
      check.spend(space, p);
    }
    p = tag.next;
  }
  return p;
}

/** An miINT8 name after a matrix's own: an object's class name, an opaque's subsystem name. */
function className(check: Check, space: Space, p: number, end: number, what = 'class name'): number | null {
  const tag = readTag(check, space, p, end, what);
  if (!tag) {
    return null;
  }
  if ((tag.type !== MI_INT8 && tag.type !== MI_UINT8) || tag.n === 0) {
    check.report('element', space, p, `the object's ${what} is ${tag.n} byte(s) of ${typeName(tag.type)}, where MATLAB `
      + 'writes a name in miINT8: it fails the load');
    return null;
  }
  return tag.next;
}

/** A struct's (or an object's) field-name length, its field names, then every field's value. */
function structBody(check: Check, space: Space, head: MatrixHead, p: number, end: number, depth: number): number | null {
  const widthTag = readTag(check, space, p, end, 'field-name length');
  if (!widthTag) {
    return null;
  }
  if (widthTag.type !== MI_INT32 || widthTag.n !== 4) {
    check.report('element', space, p, `the struct's field-name length is ${widthTag.n} byte(s) of ${typeName(widthTag.type)}, `
      + 'where MATLAB writes one miINT32: it fails the load');
    return null;
  }
  const width = space.view.getInt32(widthTag.data, true);
  const namesTag = readTag(check, space, widthTag.next, end, 'field names');
  if (!namesTag) {
    return null;
  }
  if (namesTag.type !== MI_INT8 && namesTag.type !== MI_UINT8) {
    check.report('element', space, widthTag.next, `the struct's field names are ${typeName(namesTag.type)}, where MATLAB `
      + 'writes miINT8: it fails the load');
    return null;
  }
  if (width <= 0 && namesTag.n > 0) {
    check.report('element', space, p, `the struct's field-name length is ${width}, with ${namesTag.n} byte(s) of names: `
      + 'MATLAB fails the load');
    return null;
  }
  // MATLAB counts the fields as the names' bytes over the length, whole names only.
  const fields = width > 0 ? Math.floor(namesTag.n / width) : 0;
  return members(check, space, namesTag.next, end, head.numel * fields, depth, 'field value');
}

/**
 * A char array's data: miUTF8 holding as many UTF-16 units as the array's elements, miUTF16
 * of two bytes each, or miUINT16 below U+0100 (MATLAB keeps only the low byte of a unit above
 * it, and fails on a surrogate). A complex char array MATLAB does not load at all.
 */
function charBody(check: Check, space: Space, head: MatrixHead, end: number): number | null {
  const tag = readTag(check, space, head.p, end, 'char data');
  if (!tag) {
    return null;
  }
  const numel = head.numel;
  const view = space.view;
  switch (tag.type) {
    case MI_UTF8: {
      let text: string | null = null;
      try {
        text = strictUtf8.decode(new Uint8Array(view.buffer, view.byteOffset + tag.data, tag.n));
      } catch {
        check.report('char-type', space, head.p, 'the char array\'s miUTF8 data is not valid UTF-8');
      }
      if (text !== null && text.length !== numel) {
        check.report('utf8-count', space, head.p, `the char array's miUTF8 data is ${text.length} UTF-16 unit(s) of text, `
          + `and the array has ${numel} element(s): MATLAB fails the load`);
      }
      break;
    }
    case MI_UTF16:
      if (tag.n !== 2 * numel) {
        check.report('data-size', space, head.p, `the char array's miUTF16 data is ${tag.n} byte(s), and the array has `
          + `${numel} element(s) of 2 bytes each`);
      }
      break;
    case MI_UINT16:
      if (tag.n !== 2 * numel) {
        check.report('data-size', space, head.p, `the char array's miUINT16 data is ${tag.n} byte(s), and the array has `
          + `${numel} element(s) of 2 bytes each`);
      }
      for (let o = tag.data; o + 2 <= tag.data + tag.n; o += 2) {
        const unit = view.getUint16(o, true);
        if (unit > 0xff) {
          check.report('char-type', space, head.p, `the char array's miUINT16 data holds U+${unit.toString(16).toUpperCase().padStart(4, '0')}: `
            + 'MATLAB reads miUINT16 text one byte a character, keeping only the low byte of a unit above U+00FF '
            + 'and failing on a surrogate. Text beyond U+00FF is stored as miUTF8 or miUTF16');
          break;
        }
      }
      break;
    default:
      check.report('char-type', space, head.p, `the char array's data is ${typeName(tag.type)}: MATLAB reads char data `
        + 'only as miUTF8, miUTF16 or miUINT16, and fails the load');
  }
  let p = tag.next;
  if (head.flags & COMPLEX_BIT) {
    check.report('char-type', space, head.p, 'the char array is marked complex, and MATLAB loads a complex char array '
      + 'as nothing');
    const imag = readTag(check, space, p, end, 'imaginary char data');
    if (!imag) {
      return null;
    }
    p = imag.next;
  }
  return p;
}

/**
 * A full numeric array's real part, and its imaginary part when it is complex. A double may be
 * stored in any numeric type (MATLAB narrows integral doubles to the smallest that holds them);
 * every other class only in its own.
 */
function numericBody(check: Check, space: Space, head: MatrixHead, end: number): number | null {
  let p = head.p;
  for (const part of head.flags & COMPLEX_BIT ? ['real part', 'imaginary part'] : ['data']) {
    const tag = readTag(check, space, p, end, part);
    if (!tag) {
      return null;
    }
    checkNumbers(check, space, p, head, tag, part, head.numel);
    p = tag.next;
  }
  return p;
}

/** One numeric part's type and size, against its array's class and `count` elements. */
function checkNumbers(check: Check, space: Space, o: number, head: MatrixHead, tag: Tag, part: string, count: number): void {
  const logical = head.flags & LOGICAL_BIT && head.cls === MX_UINT8;
  const what = logical ? 'logical' : head.cls === MX_SPARSE ? 'sparse' : CLASS_NAMES[head.cls];
  const width = WIDTH[tag.type];
  const own = OWN_TYPE[head.cls];
  if (own !== undefined && tag.type !== own) {
    check.report('int-storage', space, o, `the ${what} array's ${part} is stored as ${typeName(tag.type)}, and MATLAB `
      + `stores a ${what} array only as ${typeName(own)}: only a double is ever stored in a narrower type`);
    return;
  }
  if (width === undefined) {
    check.report('element', space, o, `the ${what} array's ${part} is ${typeName(tag.type)}, which MATLAB does not `
      + 'read as numbers: it fails the load');
    return;
  }
  if (tag.n % width !== 0 || tag.n / width !== count) {
    check.report('data-size', space, o, `the ${what} array's ${part} is ${tag.n} byte(s) of ${typeName(tag.type)}, and it `
      + `has ${count} element(s) of ${width} byte(s) each`);
  }
}

/**
 * A sparse array: its row indices, its column starts (one per column and one more), its
 * non-zeros, and their imaginary parts when it is complex. MATLAB has sparse arrays of double,
 * single and logical class only.
 */
function sparseBody(check: Check, space: Space, head: MatrixHead, end: number): number | null {
  const cls = head.cls;
  const logical = (head.flags & LOGICAL_BIT) !== 0;
  if (!(cls === MX_SPARSE || cls === MX_DOUBLE || cls === MX_SINGLE || (cls === MX_UINT8 && logical))) {
    check.report('element', space, head.p, `the matrix is a sparse ${CLASS_NAMES[cls]} array, and MATLAB has sparse `
      + 'arrays of double, single and logical class only');
  }
  if (head.dims.length !== 2) {
    check.report('element', space, head.p, `the sparse array has ${head.dims.length} dimensions, and a sparse array has 2`);
  }
  const ir = readTag(check, space, head.p, end, 'row indices');
  if (!ir) {
    return null;
  }
  const jc = readTag(check, space, ir.next, end, 'column starts');
  if (!jc) {
    return null;
  }
  for (const [tag, o, part] of [[ir, head.p, 'row indices'], [jc, ir.next, 'column starts']] as const) {
    if (tag.type !== MI_INT32) {
      check.report('element', space, o, `the sparse array's ${part} are ${typeName(tag.type)}, where MATLAB writes `
        + 'miINT32');
    }
  }
  const nonZeros = ir.type === MI_INT32 ? ir.n / 4 : Math.floor(ir.n / (WIDTH[ir.type] ?? 1));
  if (jc.type === MI_INT32 && head.dims.length === 2 && jc.n !== 4 * (head.dims[1] + 1)) {
    check.report('data-size', space, ir.next, `the sparse array's column starts are ${jc.n / 4} miINT32, and it has `
      + `${head.dims[1]} column(s), which take one more`);
  }
  let p = jc.next;
  for (const part of head.flags & COMPLEX_BIT ? ['real non-zeros', 'imaginary non-zeros'] : ['non-zeros']) {
    const tag = readTag(check, space, p, end, part);
    if (!tag) {
      return null;
    }
    checkNumbers(check, space, p, { ...head, cls: cls === MX_SPARSE && logical ? MX_UINT8 : cls }, tag, part, nonZeros);
    p = tag.next;
  }
  return p;
}

/**
 * Where the subsystem data an unnamed record holds is, or null when it holds none: the data of
 * a real uint8 array, opening as a MAT stream does (00 01 49 4D). Read without a word said,
 * since `classBody` checks the same sub-element as the array's data.
 */
function subsystemStream(space: Space, head: MatrixHead, end: number): { start: number; end: number } | null {
  const view = space.view;
  if (head.cls !== MX_UINT8 || head.flags & (LOGICAL_BIT | COMPLEX_BIT | SPARSE_BIT) || head.p + 16 > end) {
    return null;
  }
  const n = view.getUint32(head.p + 4, true);
  const start = head.p + 8;
  if (view.getUint32(head.p, true) !== MI_UINT8 || n < 8 || start + n > end) {
    return null;
  }
  return STREAM_MAGIC.every((b, i) => view.getUint8(start + i) === b) ? { start, end: start + n } : null;
}

/**
 * The subsystem's stream, checked as MATLAB reads it when it loads an object: its 8-byte
 * preamble, then matrices back to back to its last byte. The second half of the preamble's
 * reserved word says the stream's tags are 32-bit, as in every file MATLAB was seen writing;
 * a stream that says otherwise is not walked.
 */
function checkSubsystem(check: Check, space: Space, start: number, end: number): void {
  if (space.view.getUint16(start + 4, true) !== 0) {
    return;
  }
  check.inSubsystem = true;
  try {
    let o = start + 8;
    while (o < end) {
      const element = readTag(check, space, o, end, 'subsystem element');
      if (!element) {
        return;
      }
      if (element.type !== MI_MATRIX) {
        check.report('element', space, o, `the subsystem's stream holds a data element of ${typeName(element.type)}, `
          + 'where it holds only matrices');
        return;
      }
      if (element.n > 0) {
        nestedMatrix(check, space, element.data, element.next, 1);
      } else {
        check.spend(space, o);
      }
      o = element.next;
    }
  } finally {
    check.inSubsystem = false;
  }
}

/**
 * The rules about where records are: the header's offset points at the subsystem, the
 * subsystem is last, no other record is unnamed, no name is stored twice.
 */
function checkPlacement(check: Check, records: RecordInfo[], offset: number, length: number): void {
  let subsystem = -1;
  if (offset !== 0) {
    const i = records.findIndex((r) => r.at === offset);
    const record = records[i];
    const field = `Header bytes 116-123 give the subsystem's offset as ${offset}`;
    const fails = 'MATLAB reads the objects in the file only from there, and fails the load';
    if (!record) {
      check.file('subsystem-offset', 116, offset < 128 || offset >= length
        ? `${field}, outside the file's records: ${fails}.`
        : `${field}, where no record starts: ${fails}.`);
    } else if (record.name === null) {
      // The record there could not be read, which is said where it is.
    } else if (record.name !== '') {
      check.file('subsystem-offset', 116, `${field}, which is variable "${record.name}", not the subsystem: ${fails}.`);
    } else if (!record.subsystem) {
      check.file('subsystem-offset', 116, `${field}, an unnamed record that holds no subsystem data: ${fails}.`);
    } else {
      subsystem = i;
    }
  } else {
    for (const r of records) {
      if (r.subsystem) {
        check.file('subsystem-offset', 116, `Header bytes 116-123 say the file has no subsystem, and the record at byte `
          + `${r.at} is one: MATLAB then reads none of the objects in the file, and fails the load.`);
      }
    }
  }
  if (subsystem >= 0) {
    for (const r of records.slice(subsystem + 1)) {
      const what = r.name ? `Variable "${r.name}"` : `The record at byte ${r.at}`;
      check.file('subsystem-not-last', r.at, `${what} is stored after the subsystem (byte ${records[subsystem].at}): `
        + 'MATLAB stops reading variables at the subsystem, so `load` silently leaves it out.', r.name || undefined);
    }
  }
  records.forEach((r, i) => {
    if (r.name !== '' || i === subsystem) {
      return;
    }
    const after = records.length - i - 1;
    const what = r.subsystem
      ? `The record at byte ${r.at} holds subsystem data, and the header's offset does not point at it`
      : `The record at byte ${r.at} has no name`;
    check.file('anonymous-record', r.at, `${what}: MATLAB stops reading variables at the first unnamed record, which `
      + 'is the subsystem\'s place'
      + (after > 0 ? `, so \`load\` silently leaves out the ${after} record(s) after it.` : ', and leaves it out of `load`.'));
  });
  const first = new Map<string, number>();
  for (const r of records) {
    if (!r.name) {
      continue;
    }
    const seen = first.get(r.name);
    if (seen === undefined) {
      first.set(r.name, r.at);
    } else {
      check.file('duplicate-name', r.at, `Variable "${r.name}" is stored again at byte ${r.at} (first at byte ${seen}): `
        + 'MATLAB loads both, `load(f)` keeping the last and `load(f, name)` the first.', r.name);
    }
  }
}
