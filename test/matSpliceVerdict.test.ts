// Copyright 2026 The MathWorks, Inc.
//
// The `.mat` save judges what it wrote by MATLAB's load rules where it changed the file
// (MatFileCheck.violationsAddedBySplice), and no longer by checking the file it read and the
// file it wrote whole, which inflated every compressed record of both at every save and could
// not save a file past the check's budget at all. The answer has to be the one the whole-file
// check gave: `violationsAdded(checkMatFile(read), checkMatFile(written), renamed)`.
//
//   * Over every .mat under test/, MATLAB's verdict corpus included, and a set of saves of each
//     (every variable renamed, every plain one written fresh, every other one deleted, one
//     added, all four at once, and one written as bytes MATLAB fails on; and of the objects in
//     it, every one's properties edited, which writes the subsystem anew, with the four others at
//     once, and a property written into a cell as bytes MATLAB fails on), the splice's verdict is
//     the whole-file one, rule by rule and variable by variable, for every save that reached the
//     check.
//   * Where it may not take the short way, it takes the long one, and says the same.
//   * A file past the check's budget whole saves where it changed little, and the budget is
//     spent on what changed.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zlibSync } from 'fflate';
import { checkMatFile, violationsAdded, violationsAddedBySplice } from '../src/datamodel/parser/MatFileCheck.js';
import type { MatFileOfRecords, MatReadRecord, MatSplicedRecord, MatViolation } from '../src/datamodel/parser/MatFileCheck.js';
import { serializeMatFile } from '../src/datamodel/parser/MatFileWriter.js';
import { MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { createSession } from '../src/index.js';
import { sourceEditRefusal } from '../src/datamodel/node/BaseNode.js';
import { mcosPlaceOf } from '../src/datamodel/node/mcosPlace.js';
import { CLASS, MI, charVar, matFile, numericVar, u32le } from './tools/matBytes.js';

// Every call the writer makes of the splice's verdict, with what it answered.
const calls = vi.hoisted(() => [] as { read: any; written: any; renamed: ReadonlyMap<string, string>; added: MatViolation[] }[]);
vi.mock('../src/datamodel/parser/MatFileCheck.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/datamodel/parser/MatFileCheck.js')>();
  return {
    ...actual,
    violationsAddedBySplice: (read: any, written: any, renamed: ReadonlyMap<string, string> = new Map(), options = {}) => {
      const added = actual.violationsAddedBySplice(read, written, renamed, options);
      calls.push({ read, written, renamed, added });
      return added;
    },
  };
});

// Whether a save writes an object's text property into its cell as miUINT16, which this package's
// reader reads back as written and MATLAB reads one byte a character (`char-type`): a writer that
// broke a rule inside the subsystem, standing in for one.
const uint16Cells = vi.hoisted(() => ({ on: false }));
vi.mock('../src/datamodel/parser/McosSubsystemEdit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/datamodel/parser/McosSubsystemEdit.js')>();
  return {
    ...actual,
    valueCellOf: (v: any) => (uint16Cells.on && v.className === 'char' ? uint16CharStream(String(v.value)).subarray(8) : actual.valueCellOf(v)),
  };
});

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));

function matFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...matFilesUnder(abs));
    } else if (entry.isFile() && entry.name.endsWith('.mat')) {
      out.push(abs);
    }
  }
  return out.sort();
}

// The one file under test/ the reader refuses: a `-v7.3` file is HDF5, not Level 5.
const FILES = matFilesUnder(TEST_ROOT).filter((f) => !f.endsWith('strings_v73.mat'));

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function joined(header: Uint8Array, records: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(header.byteLength + records.reduce((n, r) => n + r.byteLength, 0));
  out.set(header, 0);
  let at = header.byteLength;
  for (const r of records) {
    out.set(r, at);
    at += r.byteLength;
  }
  return out;
}

const readFile = (read: MatFileOfRecords<MatReadRecord>) => joined(read.header, read.records.map((r) => r.bytes));
const writtenFile = (read: MatFileOfRecords<MatReadRecord>, written: MatFileOfRecords<MatSplicedRecord>) =>
  joined(written.header, written.records.map((r) => ('kept' in r ? read.records[r.kept].bytes : r.written)));

// A verdict as violationsAdded counts it: by rule, and by variable under its name as read.
const keyed = (added: readonly MatViolation[], renamed: ReadonlyMap<string, string>) =>
  added.map((v) => v.code + ' ' + (v.variable === undefined ? '' : renamed.get(v.variable) ?? v.variable)).sort();

/** A MatNode opened from `bytes` through the session, as a host opens one, and its edits. */
function opened(bytes: ArrayBuffer, name: string) {
  const session = createSession();
  const root: any = session.addMatSource(name, bytes);
  const edit = (node: any, prop: string, value: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, prop, value);
  };
  const remove = (node: any) => {
    session.setActive(root, node);
    return session.deleteNodeById(node.id);
  };
  return { root, edit, remove };
}

const plainOf = (root: any) => root.children.filter((n: any) => n._matWritable?.() === true && !root.recordOf(n)?.variable?.isOpaque);

/** Every node of an object under `root` (mcosPlace), at every depth. */
function objectsOf(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => {
    if (mcosPlaceOf(n)) {
      out.push(n);
    }
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

// Every object's properties `edits` edited, where the gate takes them: a save that writes the
// subsystem anew, with every other record kept.
function editObjects(o: ReturnType<typeof opened>, edits: [string, string][]): void {
  for (const node of objectsOf(o.root)) {
    for (const [key, value] of edits) {
      if (sourceEditRefusal(node, key) === null) {
        o.edit(node, key, value);
      }
    }
  }
}

// Whether a save, as the splice is given it, writes the subsystem anew: a record written in place
// of the one header bytes 116-123 of the file read place it at.
function writesSubsystem(read: MatFileOfRecords<MatReadRecord>, written: MatFileOfRecords<MatSplicedRecord>): boolean {
  const field = read.header.subarray(116, 124);
  const offset = field.every((b) => b === 0x20) ? 0 : Number(new DataView(field.buffer, field.byteOffset, 8).getBigUint64(0, true));
  let at = 128;
  const index = read.records.findIndex((r) => {
    const here = at === offset;
    at += r.bytes.byteLength;
    return here;
  });
  return index >= 0 && written.records.some((r) => 'written' in r && r.replaces === index);
}

// The stream of a char array stored as miUINT16, which this package's reader reads back as
// written and MATLAB reads as the low byte of each unit (`char-type`): what a writer that broke
// a rule would write, standing in for one.
function uint16CharStream(text: string): Uint8Array {
  const units = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    new DataView(units.buffer).setUint16(2 * i, text.charCodeAt(i), true);
  }
  const tag = (type: number, n: number) => joined(u32le(type), [u32le(n)]);
  const body = joined(new Uint8Array(0), [
    tag(MI.UINT32, 8), u32le(CLASS.CHAR), u32le(0),
    tag(MI.INT32, 8), u32le(1), u32le(text.length),
    tag(MI.INT8, 0),
    tag(MI.UINT16, units.length), units, new Uint8Array((8 - (units.length % 8)) % 8),
  ]);
  return joined(new Uint8Array([0, 1, 0x49, 0x4d, 0, 0, 0, 0]), [tag(MI.MATRIX, body.length), body]);
}

// What an object's save types into each object the gate takes it for: text, and a number.
const OBJECT_EDITS: [string, string][] = [['Description', 'zz edited'], ['Value', '7']];

// Each kind of save, and at least how many of the files reach the check with it (measured when
// this was written: 120, 74, 121, 123, 115 and 123, before the objects' fixtures of phase 2 came,
// with which they are 179, 90, 180, 182, 174 and 182; and of the objects' saves, 95, 174 and 27),
// whether it is written to break a rule, and at least how many of its saves write the subsystem
// anew (95, 95 and 27: every save of the file's objects that reached the check).
const SAVES: [string, (o: ReturnType<typeof opened>) => void, number, boolean, number][] = [
  ['every variable renamed', (o) => o.root.children.slice().forEach((n: any, i: number) => o.edit(n, 'Name', 'renamed' + i)), 110, false, 0],
  ['every plain variable written fresh', (o) => plainOf(o.root).forEach((n: any) => n._markModified()), 65, false, 0],
  ['every other variable deleted', (o) => o.root.children.filter((_: any, i: number) => i % 2 === 0).forEach((n: any) => o.remove(n)), 110, false, 0],
  ['a variable added', (o) => o.root.execAddEntry(), 110, false, 0],
  [
    'renamed, written fresh, deleted and added at once',
    (o) => {
      const [first, second, third] = o.root.children;
      first && o.edit(first, 'Name', 'renamedFirst');
      second && plainOf(o.root).includes(second) && second._markModified();
      third && o.remove(third);
      o.root.execAddEntry();
    },
    105,
    false,
    0,
  ],
  [
    'a variable added as bytes that break a rule',
    (o) => {
      const added = o.root.execAddEntry()?.node;
      if (added && o.edit(added, 'Value', "'中文'") === true) {
        added._matStream = () => uint16CharStream('中文');
      }
    },
    110,
    true,
    0,
  ],
  ['every object edited', (o) => editObjects(o, OBJECT_EDITS), 85, false, 85],
  [
    'objects edited, and renamed, written fresh, deleted and added at once',
    (o) => {
      editObjects(o, OBJECT_EDITS);
      const [first, second, third] = o.root.children;
      first && o.edit(first, 'Name', 'renamedFirst');
      second && plainOf(o.root).includes(second) && second._markModified();
      third && o.remove(third);
      o.root.execAddEntry();
    },
    160,
    false,
    85,
  ],
  [
    'an object edited, its text written into its cell as bytes that break a rule',
    (o) => {
      editObjects(o, [['Description', '中文']]);
      uint16Cells.on = true;
    },
    25,
    true,
    25,
  ],
];

describe('the verdict of a save, judged where it changed the file, is the verdict of both files judged whole', () => {
  for (const [what, edit, least, breaks, subsystems] of SAVES) {
    it(what, () => {
      let compared = 0;
      let refusedByIt = 0;
      let subsystemsWritten = 0;
      const notRefused: MatViolation[][] = [];
      for (const file of FILES) {
        const input = new Uint8Array(readFileSync(file));
        const o = opened(arrayBufferOf(input), file.slice(file.lastIndexOf('/') + 1));
        edit(o);
        calls.length = 0;
        try {
          serializeMatFile(o.root);
        } catch (e) {
          expect(e, file).toBeInstanceOf(MatWriteError);
        } finally {
          uint16Cells.on = false;
        }
        for (const { read, written, renamed, added } of calls) {
          subsystemsWritten += writesSubsystem(read, written) ? 1 : 0;
          // The read side is the file, byte for byte.
          const before = readFile(read);
          expect(before.byteLength === input.byteLength && before.every((b, i) => b === input[i]), file).toBe(true);
          const whole = violationsAdded(checkMatFile(before), checkMatFile(writtenFile(read, written)), renamed);
          expect(keyed(added, renamed), `${file}: ${what}`).toEqual(keyed(whole, renamed));
          compared++;
          refusedByIt += added.length > 0 ? 1 : 0;
          if (added.length === 0) {
            notRefused.push(checkMatFile(before));
          }
        }
      }
      // Not vacuous: most of the 137 files reach the check with each kind of save (fewer with
      // a plain variable to write fresh: the corpus holds many of objects alone), and none but
      // the one written to break a rule is refused by either.
      expect(compared, what).toBeGreaterThanOrEqual(least);
      expect(subsystemsWritten, what).toBeGreaterThanOrEqual(subsystems);
      if (breaks) {
        // Refused by both wherever the check reads past the header, which it does not of a file
        // whose header is not a Level-5 one (version-0x0000.mat, version-0x0200.mat): MATLAB
        // loads nothing of it, before the save or after.
        expect(refusedByIt, what).toBeGreaterThanOrEqual(least);
        for (const violations of notRefused) {
          expect(violations.map((v) => v.code), what).toContain('not-level5');
        }
      } else {
        expect(refusedByIt, what).toBe(0);
      }
    });
  }
});

// ---- Files made to break each rule ------------------------------------------------------------

const scalar = (name: string, value: number) => numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, 1], real: [value] });

// A compressed record of `element`, as MATLAB writes one: its zlib stream in an miCOMPRESSED tag.
const compressed = (element: Uint8Array) => {
  const stream = zlibSync(element, { level: 6 });
  return joined(u32le(MI.COMPRESSED), [u32le(stream.byteLength), stream]);
};

// The file of `records`, as a splice's read side.
function readOf(records: Uint8Array[]): MatFileOfRecords<MatReadRecord> {
  const bytes = new Uint8Array(matFile(records));
  return { header: bytes.subarray(0, 128), records: parseMat(arrayBufferOf(bytes)).records.map((r) => ({ bytes: r.bytes })) };
}

const both = (read: MatFileOfRecords<MatReadRecord>, written: MatFileOfRecords<MatSplicedRecord>, renamed = new Map<string, string>()) => {
  const whole = violationsAdded(checkMatFile(readFile(read)), checkMatFile(writtenFile(read, written)), renamed);
  return [keyed(violationsAddedBySplice(read, written, renamed), renamed), keyed(whole, renamed)];
};

describe('the short way says what the long way says of the rules of where records stand', () => {
  // `b` is a char stored as miUINT8, which MATLAB fails on (`char-type`).
  const read = readOf([scalar('a', 1), charVar('b', 'xy', MI.UINT8), scalar('c', 3)]);
  const header = (offset: bigint) => {
    const h = read.header.slice();
    new DataView(h.buffer).setBigUint64(116, offset, true);
    return h;
  };
  const cases: [string, MatFileOfRecords<MatSplicedRecord>, Map<string, string>, string[]][] = [
    ['a variable added under a name the file holds', { header: read.header, records: [{ kept: 0 }, { kept: 1 }, { kept: 2 }, { written: scalar('a', 2), replaces: null }] }, new Map(), ['duplicate-name a']],
    ['an unnamed record added before the last', { header: read.header, records: [{ kept: 0 }, { written: scalar('', 2), replaces: null }, { kept: 2 }] }, new Map(), ['anonymous-record ']],
    ['a header that places the subsystem where none is', { header: header(136n), records: [{ kept: 0 }, { kept: 1 }, { kept: 2 }] }, new Map(), ['subsystem-offset ']],
    ['a variable renamed, its violation with it', { header: read.header, records: [{ kept: 0 }, { written: charVar('bb', 'xy', MI.UINT8), replaces: 1 }, { kept: 2 }] }, new Map([['bb', 'b']]), []],
    ['a variable renamed, its violation said under its new name alone', { header: read.header, records: [{ kept: 0 }, { written: charVar('bb', 'xy', MI.UINT8), replaces: 1 }, { kept: 2 }] }, new Map(), ['char-type bb']],
    ['a variable written as bytes that break a rule', { header: read.header, records: [{ written: charVar('a', 'xy', MI.UINT8), replaces: 0 }, { kept: 1 }, { kept: 2 }] }, new Map(), ['char-type a']],
    ['the variable that broke one deleted, and another written so', { header: read.header, records: [{ written: charVar('a', 'xy', MI.UINT8), replaces: 0 }, { kept: 2 }] }, new Map(), ['char-type a']],
  ];
  for (const [what, written, renamed, expected] of cases) {
    it(what, () => {
      const [splice, whole] = both(read, written, renamed);
      expect(splice).toEqual(whole);
      expect(splice).toEqual(expected);
    });
  }

  it('a deleted record is checked when what is added could be matched with one of its violations', () => {
    // `end` deleted and `end` added: the added one's `name` violation is the deleted one's.
    const read = readOf([scalar('a', 1), scalar('end', 2)]);
    const [splice, whole] = both(read, { header: read.header, records: [{ kept: 0 }, { written: scalar('end', 3), replaces: null }] });
    expect(splice).toEqual(whole);
    expect(splice).toEqual([]);
  });
});

describe('where the short way does not hold, the splice checks both files whole, or as far as the whole check reads them', () => {
  it('a record kept twice: its violation is counted twice, as the whole check counts it', () => {
    const read = readOf([scalar('a', 1), scalar('end', 2)]);
    const [splice, whole] = both(read, { header: read.header, records: [{ kept: 0 }, { kept: 1 }, { kept: 1 }] });
    expect(splice).toEqual(whole);
    expect(splice).toEqual(['duplicate-name end', 'name end']);
  });

  it('a record kept and replaced', () => {
    const read = readOf([scalar('a', 1), scalar('end', 2)]);
    const [splice, whole] = both(read, { header: read.header, records: [{ kept: 1 }, { written: scalar('end', 3), replaces: 1 }] });
    expect(splice).toEqual(whole);
    expect(splice).toEqual(['duplicate-name end', 'name end']);
  });

  it('a kept record holding a name the renames map: its violation is compared under the other name, as the whole check compares it', () => {
    // 'end' breaks `name`; renaming `a` to it maps 'end' to 'a', and the kept record's violation
    // with it.
    const read = readOf([scalar('a', 1), scalar('end', 2)]);
    const renamed = new Map([['end', 'a']]);
    const [splice, whole] = both(read, { header: read.header, records: [{ written: scalar('end', 1), replaces: 0 }, { kept: 1 }] }, renamed);
    expect(splice).toEqual(whole);
    expect(splice.length).toBeGreaterThan(0);
  });

  it('a record whose tag the walk reads as padding: a top-level type above 255', () => {
    const odd = joined(u32le(0x100), [u32le(8), new Uint8Array(8)]);
    const read = readOf([scalar('a', 1), odd]);
    const [splice, whole] = both(read, { header: read.header, records: [{ kept: 1 }, { written: scalar('end', 1), replaces: null }] });
    expect(splice).toEqual(whole);
    // The walk stops at the padding it takes the record for, so the record after it is not seen.
    expect(splice).toEqual([]);
  });

  it('a header the check reads no further than, on both sides', () => {
    const read = readOf([scalar('a', 1)]);
    const header = read.header.slice();
    header[125] = 0x02;
    const off = { header, records: read.records };
    const [splice, whole] = both(off, { header, records: [{ written: scalar('end', 1), replaces: 0 }] });
    expect(splice).toEqual(whole);
    expect(splice).toEqual([]);
  });

});

// ---- The budget -------------------------------------------------------------------------------

describe('a file past the check\'s budget whole is checked, and saved, where it changed', () => {
  // Three compressed records, two of them a MiB of zeros each, under a budget of 1.5 MiB of
  // inflated bytes: checked whole, the file stops at the budget; the splice spends it on what
  // changed, the records written and the ones they replace.
  const MIB = 2 ** 20;
  const big = (name: string) => numericVar({ name, cls: CLASS.UINT8, dimensions: [1, MIB], real: [], rawReal: new Uint8Array(MIB) });
  const input = matFile([compressed(scalar('a', 1)), compressed(big('big1')), compressed(big('big2'))]);
  const budget = { maxInflatedBytes: 1.5 * MIB };

  it('is past the budget, whole', () => {
    expect(checkMatFile(new Uint8Array(input), budget).map((v) => v.code)).toEqual(['budget']);
    expect(checkMatFile(new Uint8Array(input))).toEqual([]);
  });

  it('saves a rename of a small variable, and of a big one the budget holds', () => {
    for (const name of ['a', 'big1']) {
      const o = opened(input, 'big.mat');
      const node = o.root.children.find((c: any) => c.name === name);
      expect(o.edit(node, 'Name', name + 'Renamed'), name).toBe(true);
      const saved = serializeMatFile(o.root, budget);
      expect(parseMat(arrayBufferOf(saved)).variables.map((v) => v.name), name).toEqual(
        ['a', 'big1', 'big2'].map((n) => (n === name ? name + 'Renamed' : n)),
      );
      // Checked whole without a budget, it adds nothing.
      expect(violationsAdded(checkMatFile(new Uint8Array(input)), checkMatFile(saved), new Map([[name + 'Renamed', name]])), name).toEqual([]);
    }
  });

  it('saves an edit of the small variable, and a delete of a big one', () => {
    const o = opened(input, 'big.mat');
    expect(o.edit(o.root.children[0], 'Value', '7')).toBe(true);
    expect(o.remove(o.root.children[2])).toBe(true);
    const parsed = parseMat(arrayBufferOf(serializeMatFile(o.root, budget)));
    expect(parsed.variables.map((v) => [v.name, v.name === 'a' ? v.value : v.dimensions])).toEqual([['a', 7], ['big1', [1, MIB]]]);
  });

  it('refuses, saying it could not verify it, a rename of a variable past the budget itself', () => {
    const o = opened(input, 'big.mat');
    expect(o.edit(o.root.children[1], 'Name', 'big1Renamed')).toBe(true);
    let thrown: unknown;
    try {
      serializeMatFile(o.root, { maxInflatedBytes: MIB / 2 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(MatWriteError);
    expect((thrown as Error).message).toMatch(
      /^Cannot save "big\.mat": the file written for it could not be verified within the check's budget against the rules MATLAB loads a file by \(The check stopped at byte \d+, at more than the 524288 bytes one check inflates, so nothing from there on was checked\), so it is not known to load\. Nothing was written\.$/,
    );
  });
});
