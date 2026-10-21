// Copyright 2026 The MathWorks, Inc.
//
// A save of a `.mat` (session.serializeSource on a MatNode, MatFileWriter.serializeMatFile):
// the file it was read from, with what was edited written fresh and every record nobody touched
// written as the bytes it was read from.
//
// The first sweep holds every Level-5 fixture to the strictest form of that: saved with no edit,
// a file is itself, byte for byte. Then each kind of edit, on cases.mat and on files of objects
// and function handles, read back: the edited value is what the save wrote, every other record is
// its own bytes, in its own order, and the subsystem is last, where the header says it is. A
// `-v6` file, which holds no compressed record, stays one. Then every refusal: a save that cannot
// write a variable as what it is throws, naming it, and hands back nothing.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import type { MatRecord, ParsedMat } from '../src/datamodel/parser/MatParser.js';
import { encodeMatStream, MatBudgetError, MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { compressedRecordOf, serializeMatFile } from '../src/datamodel/parser/MatFileWriter.js';
import { checkMatFile, violationsAdded } from '../src/datamodel/parser/MatFileCheck.js';
import { createSession } from '../src/index.js';
import { CLASS, MI, cellVar, matFile, numericVar, u32le } from './tools/matBytes.js';

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));

// Every `.mat` under test/, recursively, so a fixture added later is swept by default. But not
// test/fixtures/mat-check, MATLAB's verdict corpus, of files edited to break its load rules on
// purpose (test/matFileCheck.test.ts), which has a sweep of its own below.
const MAT_CHECK = join(TEST_ROOT, 'fixtures', 'mat-check');
function matFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (abs !== MAT_CHECK) {
        out.push(...matFilesUnder(abs));
      }
    } else if (entry.isFile() && entry.name.endsWith('.mat')) {
      out.push(abs);
    }
  }
  return out.sort();
}

// The one file of the corpus the reader refuses: a `-v7.3` file is HDF5, not Level 5.
const REFUSED = new Set(['strings_v73.mat']);

const shown = (abs: string) => abs.slice(TEST_ROOT.length);
const basename = (abs: string) => abs.slice(abs.lastIndexOf('/') + 1);

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

const fixture = (rel: string) => arrayBufferOf(new Uint8Array(readFileSync(join(TEST_ROOT, rel))));
const CASES = 'parity/artifacts/mat/cases.mat';

const scalar = (name: string, value: number) => numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, 1], real: [value] });

/** A MatNode opened from `bytes` through the session, as a host opens one, and its edits. */
function opened(bytes: ArrayBuffer, name = 'f.mat') {
  const session = createSession();
  const root: any = session.addMatSource(name, bytes);
  const by = (n: string) => root.children.find((c: any) => c.name === n);
  const edit = (node: any, prop: string, value: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, prop, value);
  };
  const remove = (node: any) => {
    session.setActive(root, node);
    return session.deleteNodeById(node.id);
  };
  // What session.serializeSource hands back for it, which for a MAT-file is always bytes, and
  // which by the rules MATLAB loads a file by (MatFileCheck) is no worse than the file it was
  // read from: as clean as every fixture here is, and adding nothing to one that is not.
  const save = (): Uint8Array => {
    const out = session.serializeSource(name)!;
    expect([out.kind, out.sourceFormat]).toEqual(['binary', 'mat']);
    const saved = (out as { bytes: Uint8Array }).bytes;
    const before = checkMatFile(new Uint8Array(bytes));
    const after = checkMatFile(saved);
    expect(before.length === 0 ? after : violationsAdded(before, after)).toEqual([]);
    return saved;
  };
  return { session, root, by, edit, remove, save };
}

/** `bytes`, read again: the parse, and a tree of it, as a host reopening the saved file has. */
function reopened(bytes: Uint8Array) {
  const parsed = parseMat(arrayBufferOf(bytes));
  const { root, by } = opened(arrayBufferOf(bytes), 'saved.mat');
  return { parsed, root, by };
}

/** What a variable of `bytes` reads back as, by the reader itself: its class, size and value. */
const variableOf = (parsed: ParsedMat, name: string) => {
  const v = parsed.variables.find((x) => x.name === name);
  expect(v, name).toBeDefined();
  return v!;
};

/**
 * Every record of `original` but the ones named `was` is in `saved`, in the same order, as the
 * bytes it was read from; `is` names the records of `saved` that are not (edited, renamed,
 * added).
 */
function expectKept(original: ParsedMat, saved: ParsedMat, { was = [] as string[], is = [] as string[] } = {}) {
  const before = original.records.filter((r) => !was.includes(r.name!));
  const after = saved.records.filter((r) => !is.includes(r.name!));
  expect(after.map((r) => r.name)).toEqual(before.map((r) => r.name));
  after.forEach((r, i) => expect(sameBytes(r.bytes, before[i].bytes), String(r.name)).toBe(true));
}

/** The subsystem is the file's last record, unnamed, and where its header says it is. */
function expectSubsystemLast(saved: ParsedMat) {
  const last: MatRecord = saved.records[saved.records.length - 1];
  expect([last.anonymous, last.name, saved.subsystemOffset]).toEqual([true, '', last.offset]);
  expect(saved.records.filter((r) => r.anonymous)).toEqual([last]);
}

/** The thrown error of `fn`, which must throw. */
function thrownBy(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('did not throw');
}

describe('a file saved with no edit is the file, byte for byte', () => {
  const files = matFilesUnder(TEST_ROOT).filter((f) => !REFUSED.has(basename(f)));

  it('sweeps the whole corpus', () => {
    // Lower bounds, so that a mis-filtered list cannot pass the sweep below vacuously.
    expect(files.length).toBeGreaterThanOrEqual(30);
    expect(files.map(basename)).toEqual(expect.arrayContaining(['cases.mat', 'Param.mat', 'strings.mat', 'nested_handles.mat']));
  });

  for (const file of files) {
    it(shown(file), () => {
      const input = fixture(shown(file));
      const { save } = opened(input, basename(file));
      const bytes = save();
      expect(sameBytes(bytes, new Uint8Array(input))).toBe(true);
      // A copy, not a view of what the file was read from: a host may write it anywhere.
      expect(bytes.buffer).not.toBe(input);
    });
  }

  it('a rename undone, the file as it was', () => {
    const input = fixture(CASES);
    const { session, by, edit, save } = opened(input, 'cases.mat');
    expect(edit(by('kp'), 'Name', 'kp2')).toBe(true);
    session.undo();
    expect([by('kp').name, by('kp').status]).toEqual(['kp', 'Modified']);
    expect(sameBytes(save(), new Uint8Array(input))).toBe(true);
  });

  it('a variable deleted and its delete undone, the file as it was', () => {
    const input = fixture(CASES);
    const { session, by, remove, save } = opened(input, 'cases.mat');
    expect(remove(by('aParam'))).toBe(true);
    session.undo();
    expect(sameBytes(save(), new Uint8Array(input))).toBe(true);
  });
});

describe('every variable of every fixture, renamed or written fresh, reads back as itself', () => {
  const files = matFilesUnder(TEST_ROOT).filter((f) => !REFUSED.has(basename(f)));
  // What a host is shown of a file: each variable's name, node class, class, size and value.
  const shownAs = (root: any) => root.children.map((c: any) => [c.name, c.constructor.name, c.className, c.displayValue]);

  for (const file of files) {
    it(`${shown(file)}: every variable renamed, in one save`, () => {
      const { root, edit, save } = opened(fixture(shown(file)), basename(file));
      const before = shownAs(root);
      root.children.forEach((node: any, i: number) => expect(edit(node, 'Name', 'renamed' + i)).toBe(true));
      const { root: again } = reopened(save());
      expect(shownAs(again)).toEqual(before.map(([, ...rest]: any[], i: number) => ['renamed' + i, ...rest]));
    });

    it(`${shown(file)}: every plain variable written fresh, in one save`, () => {
      const { root, save } = opened(fixture(shown(file)), basename(file));
      const before = shownAs(root);
      // An edit that leaves the value as it was, as an undone one does: written fresh all the
      // same (DataNode._valueEdited). Of what MatWriter can write as what it is: an object, a
      // string, a function handle refuse the save (below).
      const plain = root.children.filter((n: any) => n._matWritable?.() === true && !root.recordOf(n).variable.isOpaque);
      plain.forEach((node: any) => node._markModified());
      const bytes = save();
      const { parsed, root: again } = reopened(bytes);
      expect(shownAs(again)).toEqual(before);
      const original = parseMat(fixture(shown(file)));
      const names = plain.map((n: any) => n.name);
      expectKept(original, parsed, { was: names, is: names });
    });
  }
});

describe('cases.mat: an edit is written, and every record it did not touch is its own bytes', () => {
  const original = parseMat(fixture(CASES));
  const casesMat = () => opened(fixture(CASES), 'cases.mat');

  it('a value edit', () => {
    const { by, edit, save } = casesMat();
    expect(edit(by('kp'), 'Value', '9')).toBe(true);
    const { parsed, by: again } = reopened(save());
    expect(variableOf(parsed, 'kp')).toMatchObject({ className: 'double', dimensions: [1, 1], value: 9 });
    expect(again('kp').displayValue).toBe('9');
    expectKept(original, parsed, { was: ['kp'], is: ['kp'] });
    expectSubsystemLast(parsed);
    // Written where it was, compressed, as every record of a `-v7` file is.
    expect(parsed.records.map((r) => r.name)).toEqual(original.records.map((r) => r.name));
    expect(parsed.records.find((r) => r.name === 'kp')!.compressed).toBe(true);
  });

  const childEdits: [string, string, (by: (n: string) => any) => any, (v: any) => void][] = [
    ['a matrix element', 'mat2x3', (by) => by('mat2x3').children[0], (v) => expect(v.value).toEqual([9, 2, 3, 4, 5, 6])],
    ['a struct field', 'structScalar', (by) => by('structScalar').children[0], (v) => expect(v.fields.a.value).toBe(9)],
    ['a cell member', 'cellFlat', (by) => by('cellFlat').children[0], (v) => expect(v.value[0].value).toBe(9)],
    [
      "a struct array element's field",
      'struct1x3',
      (by) => by('struct1x3').children[1].children[0],
      (v) => expect(v.fields.a.map((f: any) => f.value)).toEqual([1, 9, 3]),
    ],
  ];
  for (const [what, name, target, check] of childEdits) {
    it(what, () => {
      const { by, edit, save } = casesMat();
      expect(edit(target(by), 'Value', '9')).toBe(true);
      const { parsed } = reopened(save());
      check(variableOf(parsed, name));
      expectKept(original, parsed, { was: [name], is: [name] });
      expectSubsystemLast(parsed);
    });
  }

  it('a reshape', () => {
    const { by, edit, save } = casesMat();
    expect(edit(by('rowVec'), 'Value', '[1 2; 3 4]')).toBe(true);
    const { parsed, by: again } = reopened(save());
    expect(variableOf(parsed, 'rowVec')).toMatchObject({ className: 'double', dimensions: [2, 2], value: [1, 2, 3, 4] });
    expect(again('rowVec').displayValue).toBe('[1 2; 3 4]');
    expectKept(original, parsed, { was: ['rowVec'], is: ['rowVec'] });
  });

  it('a class change', () => {
    const { by, edit, save } = casesMat();
    expect(edit(by('charStr'), 'Value', '[1 2]')).toBe(true);
    const { parsed } = reopened(save());
    expect(variableOf(parsed, 'charStr')).toMatchObject({ className: 'double', dimensions: [1, 2], value: [1, 2] });
    expectKept(original, parsed, { was: ['charStr'], is: ['charStr'] });
  });

  it('a field added to a struct', () => {
    const { session, root, by, save } = casesMat();
    session.setActive(root, by('structScalar'));
    expect(session.addChildTo(by('structScalar').id)).not.toBeNull();
    const { parsed } = reopened(save());
    expect(Object.keys(variableOf(parsed, 'structScalar').fields!)).toEqual(Object.keys(by('structScalar')._var.fields));
    expect(Object.keys(variableOf(parsed, 'structScalar').fields!).length).toBe(3);
    expectKept(original, parsed, { was: ['structScalar'], is: ['structScalar'] });
  });

  it('a rename: the element as it was read, named anew, and compressed again', () => {
    const { by, edit, save } = casesMat();
    expect(edit(by('kp'), 'Name', 'kp2')).toBe(true);
    const { parsed, by: again } = reopened(save());
    expect(parsed.records.map((r) => r.name)).toEqual(original.records.map((r) => (r.name === 'kp' ? 'kp2' : r.name)));
    expect(variableOf(parsed, 'kp2')).toMatchObject({ className: 'double', value: 1.5 });
    expect(again('kp2').displayValue).toBe('1.5');
    expect(parsed.records.find((r) => r.name === 'kp2')!.compressed).toBe(true);
    // The value's bytes are the ones read: the name subelement, the small element at bytes 40-47
    // after the tag, the flags and the dims, is all that changed. Both names fit in it.
    const was = variableOf(original, 'kp')._rawBytes!;
    const is = variableOf(parsed, 'kp2')._rawBytes!;
    expect(is.byteLength).toBe(was.byteLength);
    expect([sameBytes(is.subarray(0, 40), was.subarray(0, 40)), sameBytes(is.subarray(40, 48), was.subarray(40, 48))]).toEqual([true, false]);
    expect(sameBytes(is.subarray(48), was.subarray(48))).toBe(true);
    expectKept(original, parsed, { was: ['kp'], is: ['kp2'] });
    expectSubsystemLast(parsed);
  });

  it("an object variable's rename: the same object, its subsystem as it was", () => {
    const { by, edit, save } = casesMat();
    const value = by('aParam').getPropInfo(by('aParam').getProperties().find((p: any) => p.key === 'Value' || p.name === 'Value')).displayValue;
    expect(edit(by('aParam'), 'Name', 'renamedParam')).toBe(true);
    const { parsed, by: again } = reopened(save());
    const node = again('renamedParam');
    expect([node.constructor.name, node.className]).toEqual(['ParameterNode', 'Simulink.Parameter']);
    expect(node.getPropInfo(node.getProperties().find((p: any) => p.key === 'Value' || p.name === 'Value')).displayValue).toBe(value);
    expect(again('aParam')).toBeUndefined();
    expectKept(original, parsed, { was: ['aParam'], is: ['renamedParam'] });
    expectSubsystemLast(parsed);
  });

  it("a string's rename", () => {
    const { by, edit, save } = casesMat();
    const shownAs = by('strScalar').displayValue;
    expect(edit(by('strScalar'), 'Name', 'str2')).toBe(true);
    const { parsed, by: again } = reopened(save());
    expect([again('str2').className, again('str2').displayValue]).toEqual(['string', shownAs]);
    expectKept(original, parsed, { was: ['strScalar'], is: ['str2'] });
  });

  it('a delete, of a plain variable and of an object variable', () => {
    const { by, remove, save } = casesMat();
    expect(remove(by('kp'))).toBe(true);
    expect(remove(by('aParam'))).toBe(true);
    const { parsed, root } = reopened(save());
    expect(parsed.records.map((r) => r.name)).toEqual(original.records.map((r) => r.name).filter((n) => n !== 'kp' && n !== 'aParam'));
    expect(root.children.length).toBe(original.records.length - 3);
    expectKept(original, parsed, { was: ['kp', 'aParam'] });
    // The subsystem, as it was, at its new offset: an object no variable holds any more is
    // one MATLAB writes itself.
    expectSubsystemLast(parsed);
    expect(parsed.subsystemOffset).toBeLessThan(original.subsystemOffset);
  });

  it('an edit undone: the value read, written fresh', () => {
    const { session, by, edit, save } = casesMat();
    expect(edit(by('mat2x3').children[0], 'Value', '9')).toBe(true);
    session.undo();
    expect(by('mat2x3')._valueEdited).toBe(true);
    const { parsed } = reopened(save());
    expect(variableOf(parsed, 'mat2x3')).toMatchObject({ dimensions: [2, 3], value: [1, 2, 3, 4, 5, 6] });
    expectKept(original, parsed, { was: ['mat2x3'], is: ['mat2x3'] });
  });

  it('a variable added, after the last one and before the subsystem', () => {
    const { root, save } = casesMat();
    root.execAddEntry();
    root.execAddEntry(undefined, 'second');
    const { parsed, by: again } = reopened(save());
    const names = parsed.records.map((r) => r.name);
    expect(names.slice(-3)).toEqual(['var', 'second', '']);
    expect(again('var').displayValue).toBe(root.children.find((c: any) => c.name === 'var').displayValue);
    expect(parsed.records.find((r) => r.name === 'var')!.compressed).toBe(true);
    expectKept(original, parsed, { is: ['var', 'second'] });
    expectSubsystemLast(parsed);
  });

  it('several edits at once', () => {
    const { root, by, edit, remove, save } = casesMat();
    expect(edit(by('kp'), 'Value', '[7 8]')).toBe(true);
    expect(edit(by('scalarD'), 'Name', 'renamedD')).toBe(true);
    expect(edit(by('cellFlat').children[2], 'Value', "'x'")).toBe(true);
    expect(edit(by('aSignal'), 'Name', 'sig2')).toBe(true);
    expect(remove(by('negD'))).toBe(true);
    expect(remove(by('objRow'))).toBe(true);
    root.execAddEntry(undefined, 'added');
    const { parsed } = reopened(save());
    expect(variableOf(parsed, 'kp')).toMatchObject({ dimensions: [1, 2], value: [7, 8] });
    expect(variableOf(parsed, 'renamedD').value).toBe(variableOf(original, 'scalarD').value);
    expect(variableOf(parsed, 'cellFlat').value).toMatchObject([{ value: 1 }, { value: 'two' }, { className: 'char', value: 'x' }]);
    expect(parsed.records.map((r) => r.name)).toEqual([
      ...original.records
        .map((r) => ({ scalarD: 'renamedD', aSignal: 'sig2' } as Record<string, string>)[r.name!] ?? r.name)
        .filter((n) => n !== 'negD' && n !== 'objRow' && n !== ''),
      'added',
      '',
    ]);
    expectKept(original, parsed, { was: ['kp', 'scalarD', 'cellFlat', 'aSignal', 'negD', 'objRow'], is: ['kp', 'renamedD', 'cellFlat', 'sig2', 'added'] });
    expectSubsystemLast(parsed);
  });
});

describe('a rename into a name of another length restates the element and the record', () => {
  for (const [from, to] of [
    ['kp', 'kpWithAMuchLongerName'],
    ['structNest', 'sN'],
    ['aParam', 'p'],
  ]) {
    it(`${from} -> ${to}`, () => {
      const original = parseMat(fixture(CASES));
      const { by, edit, save } = opened(fixture(CASES), 'cases.mat');
      const before = by(from).displayValue;
      expect(edit(by(from), 'Name', to)).toBe(true);
      const { parsed, by: again } = reopened(save());
      expect(again(to).displayValue).toBe(before);
      expect(again(to).constructor.name).toBe(by(to).constructor.name);
      expectKept(original, parsed, { was: [from], is: [to] });
      expectSubsystemLast(parsed);
    });
  }
});

describe('function handles and the objects of a file: written as read, renamed, deleted', () => {
  const FH = 'fixtures/display/dispcat_opaque.mat';

  it('a function handle renamed, another deleted', () => {
    const original = parseMat(fixture(FH));
    const { by, edit, remove, save } = opened(fixture(FH), 'dispcat_opaque.mat');
    expect(edit(by('fh_sin'), 'Name', 'sinHandle')).toBe(true);
    expect(remove(by('fh_anon'))).toBe(true);
    const { parsed, by: again } = reopened(save());
    expect([again('sinHandle').className, again('sinHandle').displayValue]).toEqual(['function_handle', '@sin']);
    expect(again('fh_anon')).toBeUndefined();
    expectKept(original, parsed, { was: ['fh_sin', 'fh_anon'], is: ['sinHandle'] });
    expectSubsystemLast(parsed);
  });

  it('every object variable of a file renamed reads back as the same object', () => {
    const FILE = 'fixtures/mcos/nested_objects.mat';
    const { root, edit, save } = opened(fixture(FILE), 'nested_objects.mat');
    const shownAs = (r: any) => r.children.map((c: any) => [c.constructor.name, c.className, c.displayValue]);
    const before = shownAs(root);
    for (const node of [...root.children]) {
      expect(edit(node, 'Name', node.name + 'R')).toBe(true);
    }
    const { root: again } = reopened(save());
    expect(again.children.map((c: any) => c.name)).toEqual(root.children.map((c: any) => c.name));
    expect(shownAs(again)).toEqual(before);
  });
});

describe('a -v6 file, which holds no compressed record, stays one', () => {
  it('nested_handles.mat: a variable added is written plain', () => {
    const FILE = 'fixtures/display/nested_handles.mat';
    const original = parseMat(fixture(FILE));
    expect(original.records.some((r) => r.compressed)).toBe(false);
    const { root, save } = opened(fixture(FILE), 'nested_handles.mat');
    root.execAddEntry();
    const { parsed } = reopened(save());
    expect(parsed.records.map((r) => r.compressed)).toEqual(parsed.records.map(() => false));
    expect(parsed.records.map((r) => r.name).slice(-2)).toEqual(['var', '']);
    // A plain record is 8-byte aligned, its tag's nbytes a whole number of words.
    const added = parsed.records.find((r) => r.name === 'var')!;
    expect([added.offset % 8, added.length % 8]).toEqual([0, 0]);
    expectKept(original, parsed, { is: ['var'] });
    expectSubsystemLast(parsed);
  });

  it('hexobj_values.mat: a plain variable edited is written plain', () => {
    const FILE = 'fixtures/sparse/hexobj_values.mat';
    const original = parseMat(fixture(FILE));
    const { by, edit, save } = opened(fixture(FILE), 'hexobj_values.mat');
    expect(edit(by('control'), 'Value', '[1 2 3]')).toBe(true);
    const { parsed } = reopened(save());
    expect(parsed.records.every((r) => !r.compressed)).toBe(true);
    expect(variableOf(parsed, 'control')).toMatchObject({ dimensions: [1, 3], value: [1, 2, 3] });
    expectKept(original, parsed, { was: ['control'], is: ['control'] });
    expectSubsystemLast(parsed);
  });

  it('a file with no subsystem keeps its header bytes 116-123 as they were', () => {
    const spaces = new Uint8Array(matFile([scalar('a', 1), scalar('b', 2)]));
    spaces.fill(0x20, 116, 124);
    const { root, by, edit, save } = opened(arrayBufferOf(spaces));
    expect(root.subsystemOffset).toBe(0);
    expect(edit(by('a'), 'Value', '5')).toBe(true);
    root.execAddEntry();
    const bytes = save();
    expect(sameBytes(bytes.subarray(0, 128), spaces.subarray(0, 128))).toBe(true);
    const { parsed } = reopened(bytes);
    expect(parsed.records.map((r) => [r.name, r.compressed])).toEqual([['a', false], ['b', false], ['var', false]]);
    expect(variableOf(parsed, 'a').value).toBe(5);
  });
});

describe('the marker that tells a rename from a value edit (DataNode._valueEdited)', () => {
  const casesMat = () => opened(fixture(CASES), 'cases.mat');

  it("is not set by an entry's own rename, of a plain variable or an object", () => {
    const { by, edit } = casesMat();
    expect(edit(by('kp'), 'Name', 'kp2')).toBe(true);
    expect(edit(by('aParam'), 'Name', 'p2')).toBe(true);
    expect([by('kp2').status, by('kp2')._valueEdited, by('p2').status, by('p2')._valueEdited]).toEqual(['Modified', undefined, 'Modified', undefined]);
  });

  it("is set by a value edit, an element's, and an object's property edit, which the editor takes none of", () => {
    const { by, edit } = casesMat();
    expect(edit(by('kp'), 'Value', '2')).toBe(true);
    expect(edit(by('mat2x3').children[3], 'Value', '2')).toBe(true);
    // A MAT-file takes no edit of an object's properties (MatNode._editRefusal, test/matEditGate.test.ts),
    // and one refused marks nothing. Made around the editor, it marks the object.
    expect(edit(by('aParam'), 'Value', '3')).toMatchObject({ error: true });
    expect(by('aParam')._valueEdited).toBeUndefined();
    by('aParam')._markModified();
    expect(['kp', 'mat2x3', 'aParam'].map((n) => by(n)._valueEdited)).toEqual([true, true, true]);
    // On the entry only.
    expect(by('mat2x3').children[3]._valueEdited).toBeUndefined();
  });

  it("is set by the rename of anything under the entry, a bus element's, which changes the entry's value", () => {
    const { by, edit, save } = casesMat();
    const element = by('aBus').children[0];
    // Refused by the editor, as every edit of an object of a MAT-file but its own rename is; made
    // around it, as DataNode.setProperty's rename makes one.
    expect(edit(element, 'Name', 'renamedElement')).toMatchObject({ error: true });
    element.name = 'renamedElement';
    element._markModified('name');
    expect([by('aBus').status, by('aBus')._valueEdited]).toEqual(['Modified', true]);
    // And a bus is an object, whose edit this writer cannot write.
    expect(thrownBy(save).message).toBe(
      'Cannot write "aBus": it is a Simulink.Bus, which a MAT-file save writes only as it was read, or renamed, so its edit cannot be saved. Nothing was written.',
    );
  });
});

// The editor takes none of the edits below (MatNode._editRefusal, test/matEditGate.test.ts): each is
// made around it, by the marks every edit leaves (DataNode._markModified), so that the writer's own
// refusal, which the editor's is built from, is held to as well.
describe('a save that cannot write a variable as what it is is refused, naming it, and nothing is written', () => {
  const editRefused = (name: string, what: string) =>
    `Cannot write "${name}": it is ${what}, which a MAT-file save writes only as it was read, or renamed, so its edit cannot be saved. Nothing was written.`;

  it("an object's property edited; the variable deleted, the file saves", () => {
    const { by, edit, remove, save } = opened(fixture(CASES), 'cases.mat');
    expect(edit(by('aParam'), 'Value', '7')).toMatchObject({ error: true });
    by('aParam')._markModified();
    const thrown = thrownBy(save);
    expect([thrown instanceof MatWriteError, thrown.message]).toEqual([true, editRefused('aParam', 'a Simulink.Parameter')]);
    expect(remove(by('aParam'))).toBe(true);
    expect(reopened(save()).by('aParam')).toBeUndefined();
  });

  it('a string edited', () => {
    const { by, edit, save } = opened(fixture(CASES), 'cases.mat');
    expect(edit(by('strScalar'), 'Value', '"xyz"')).toMatchObject({ error: true });
    by('strScalar')._markModified();
    expect(thrownBy(save).message).toBe(editRefused('strScalar', 'a string'));
  });

  it('a struct holding an object, edited at another field', () => {
    const { by, edit, save } = opened(fixture('fixtures/mcos/complex_objects.mat'), 'complex_objects.mat');
    const z = by('s').children.find((c: any) => c.name === 'z');
    expect(edit(z, 'Value', '5')).toMatchObject({ error: true });
    z._markModified();
    expect(thrownBy(save).message).toBe(
      'Cannot write "s": s.p is a Simulink.Parameter, which this package cannot write into a MAT-file. Nothing was written.',
    );
  });

  it('a function handle edited, which the table does not offer, around it', () => {
    const { by, edit, save } = opened(fixture('fixtures/display/dispcat_opaque.mat'), 'dispcat_opaque.mat');
    expect(edit(by('fh_sin'), 'Value', '@cos')).toMatchObject({ error: true });
    by('fh_sin')._markModified();
    expect(thrownBy(save).message).toBe(editRefused('fh_sin', 'a function handle'));
  });

  it('a value the reader did not decode, edited around the table', () => {
    const z = numericVar({ name: 'z', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [3], imag: [4] });
    // Byte 16 of the matrix is its array-flags data: class 255, and the complex flag kept.
    z[16] = 0xff;
    const { by, save } = opened(matFile([scalar('a', 1), z]));
    expect(by('z').displayValue).toContain('not decoded');
    by('z')._markModified();
    expect(thrownBy(save).message).toBe(editRefused('z', 'a value that was not decoded'));
  });

  describe('a variable stored after the subsystem, which MATLAB does not read', () => {
    // Param.mat, and after its subsystem a plain double: a file MATLAB lists `late` in with
    // `whos -file` and does not load.
    const late = () => {
      const param = new Uint8Array(fixture('fixtures/mcos/Param.mat'));
      return arrayBufferOf(concat([param, scalar('late', 4)]));
    };

    it('renamed or edited, refuses the save', () => {
      for (const [prop, value] of [['Name', 'late2'], ['Value', '5']]) {
        const { by, edit, save } = opened(late());
        const node = by('late');
        expect(edit(node, prop, value)).toMatchObject({ error: true });
        if (prop === 'Name') {
          node.name = value;
        }
        node._markModified(prop === 'Name' ? 'name' : 'value');
        expect(thrownBy(save).message).toBe(
          `Cannot write "${by(prop === 'Name' ? 'late2' : 'late').name}": it is stored after the file's objects, where MATLAB does not read it, `
            + 'so it would not be read written there, and moved, it would change what MATLAB loads of the file. Nothing was written.',
        );
      }
    });

    it('unedited, is written where it was; deleted, is gone', () => {
      const original = parseMat(late());
      {
        const { by, edit, save } = opened(late());
        expect(edit(by('Param'), 'Name', 'P')).toBe(true);
        const { parsed } = reopened(save());
        expect(parsed.records.map((r) => r.name)).toEqual(['P', '', 'late']);
        expect(parsed.subsystemOffset).toBe(parsed.records[1].offset);
        expectKept(original, parsed, { was: ['Param'], is: ['P'] });
      }
      {
        const { by, remove, root, save } = opened(late());
        expect(remove(by('late'))).toBe(true);
        root.execAddEntry();
        const { parsed } = reopened(save());
        expect(parsed.records.map((r) => r.name)).toEqual(['Param', 'var', '']);
        expectSubsystemLast(parsed);
      }
    });
  });

  it('a file whose records do not tile it', () => {
    const bytes = matFile([scalar('a', 1), scalar('b', 2)], { trailing: new Uint8Array(8) });
    const { root, by, edit, save } = opened(bytes);
    expect(root.framed).toBe(false);
    // Unedited too: the bytes past the records are not records to write back.
    const at = root.unframed.at;
    const refusal = `Cannot save "f.mat": this package could not frame 8 byte(s) of it, from byte ${at} (${root.unframed.reason}), `
      + 'so a save could not keep them as they are. Nothing was written.';
    expect(thrownBy(save).message).toBe(refusal);
    expect(edit(by('a'), 'Value', '3')).toMatchObject({ error: true });
    by('a')._markModified();
    expect(thrownBy(save).message).toBe(refusal);
  });

  it("a file opened from a host's parse that carries no records", () => {
    const session = createSession();
    const { header, variables } = parseMat(fixture(CASES));
    session.addMatSourceParsed('older.mat', { header, variables });
    expect(() => session.serializeSource('older.mat')).toThrow(
      'Cannot save "older.mat": it was opened without the records a save writes back, so a save would lose every one this package did not read. Nothing was written.',
    );
  });

  it('a file whose bytes the host has since handed away', () => {
    const input = fixture(CASES);
    const { by, edit, save } = opened(input, 'cases.mat');
    expect(edit(by('kp'), 'Value', '3')).toBe(true);
    // Transferred, as a host posting it to a worker does: every view of it is now empty.
    structuredClone(input, { transfer: [input] });
    expect(thrownBy(save).message).toBe(
      'Cannot save "cases.mat": the bytes it was read from are no longer held (the header holds 0 of its 128), so what was not edited '
        + 'could not be written as it was. Nothing was written.',
    );
  });

  it("a header that places the subsystem where there is none, edited; unedited, it is the file", () => {
    const bytes = new Uint8Array(fixture(CASES));
    new DataView(bytes.buffer).setBigUint64(116, 200n, true);
    const { by, edit, save } = opened(arrayBufferOf(bytes), 'cases.mat');
    expect(sameBytes(save(), bytes)).toBe(true);
    expect(edit(by('kp'), 'Value', '3')).toMatchObject({ error: true });
    by('kp')._markModified();
    expect(thrownBy(save).message).toBe(
      'Cannot save "cases.mat": its header places the file\'s objects at byte 200, where no record starts, so a save cannot say where they are. Nothing was written.',
    );
  });

  it("a header that places the subsystem at a variable: the variable's edit is refused, not passed over", () => {
    const bytes = new Uint8Array(matFile([scalar('a', 1), scalar('b', 2)]));
    const { root, by, edit, save } = opened(arrayBufferOf(bytes));
    const at = root.records[1].offset;
    new DataView(bytes.buffer).setBigUint64(116, BigInt(at), true);
    const again = opened(arrayBufferOf(bytes));
    expect(sameBytes(again.save(), bytes)).toBe(true);
    expect(again.edit(again.by('b'), 'Value', '5')).toMatchObject({ error: true });
    again.by('b')._markModified();
    expect(thrownBy(again.save).message).toBe(
      `Cannot save "f.mat": its header places the file's objects at byte ${at}, where a variable is, so a save cannot say where they are. `
        + 'Nothing was written.',
    );
    // The file as it was, with its header saying none, saves the edit.
    expect(edit(by('b'), 'Value', '5')).toBe(true);
    expect(variableOf(reopened(save()).parsed, 'b').value).toBe(5);
  });

  it('an unnamed record that is not the subsystem', () => {
    const { root, by, edit, save } = opened(matFile([scalar('a', 1), scalar('', 2), scalar('b', 3)]));
    expect(edit(by('a'), 'Value', '5')).toMatchObject({ error: true });
    by('a')._markModified();
    expect(thrownBy(save).message).toBe(
      `Cannot save "f.mat": the record at byte ${root.records[1].offset} holds a value with no name that is not the file's objects, `
        + 'and MATLAB reads no variable past one, so a save cannot place an edit where MATLAB reads it. Nothing was written.',
    );
  });

  it('a value read short, whose holes are a value the file did not hold, and past the budget no save', () => {
    // A cell declaring 1x600000 and holding one element: written fresh, the 599,999 it does not
    // hold would each be the empty double MatWriter writes for a hole, past the unbacked-bytes
    // budget. So it is written only as it was read (freshRefusal, shortIn), whatever its size.
    for (const declared of [600000, 3]) {
      const { by, edit, save } = opened(matFile([cellVar('big', [scalar('', 1)], [1, declared])]));
      expect(edit(by('big').children[0], 'Value', '2'), String(declared)).toMatchObject({ error: true });
      by('big').children[0]._markModified();
      expect(thrownBy(save).message, String(declared)).toBe(
        `Cannot write "big": big is a 1x${declared} cell holding 1 of the ${declared} elements it declares, and a save would write the ones it does not hold as empty. Nothing was written.`,
      );
    }
    // Unbacked, MatWriter refuses it for its budget, restated naming the variable, as a dictionary's save does.
    const { by } = opened(matFile([cellVar('big', [scalar('', 1)], [1, 600000])]));
    const thrown = thrownBy(() => by('big')._matStream()) as MatBudgetError;
    expect([thrown instanceof MatBudgetError, thrown.entry, thrown.reason]).toEqual([true, 'big', 'budget']);
    expect(thrown.message).toMatch(/^Cannot write "big": big is a 1x600000 cell holding 1 of its 600000 elements, /);
    // And met writing a variable a save writes fresh, it is the save's refusal, as MatWriter threw
    // it: the stream of an edited variable stands in for one past the budget.
    const edited = opened(fixture(CASES), 'cases.mat');
    expect(edited.edit(edited.by('kp'), 'Value', '9')).toBe(true);
    edited.by('kp')._matStream = () => {
      throw thrown;
    };
    expect(thrownBy(() => serializeMatFile(edited.root))).toBe(thrown);
  });

  it('a file of more bytes than the runtime holds in one buffer, refused naming it, and not as its RangeError', () => {
    for (const add of [false, true]) {
      const { root } = opened(matFile([scalar('a', 1)]));
      // A record standing in for one of 2^53 bytes, which no typed array is: the copy of the
      // file unedited, and the file assembled around an addition, are each refused for it.
      Object.assign(root.records[0], { length: 2 ** 53, bytes: { byteLength: 2 ** 53 } });
      if (add) {
        root.execAddEntry();
      }
      const thrown = thrownBy(() => serializeMatFile(root));
      expect(thrown, String(add)).toBeInstanceOf(MatWriteError);
      expect(thrown.message, String(add)).toMatch(
        /^Cannot save "f\.mat": the file written for it would be \d{16} bytes, more than this runtime holds in one buffer\. Nothing was written\.$/,
      );
    }
  });

  it('a compressed stream of 4 GiB or more, whose length its record cannot say, is refused', () => {
    // A stream standing in for one of 2^32 bytes: the record's tag says its length in 32 bits,
    // and written, it would say 0.
    const thrown = thrownBy(() => compressedRecordOf({ byteLength: 2 ** 32 } as Uint8Array, 'big'));
    expect([thrown instanceof MatWriteError, thrown.message]).toEqual([
      true,
      'Cannot write "big": compressed, its element is a stream of 4294967296 bytes, more than the 4 GiB a record can say it holds. Nothing was written.',
    ]);
    // One that a tag can say is written as its tag and itself.
    expect(Array.from(compressedRecordOf(new Uint8Array([7, 8]), 'small'))).toEqual([15, 0, 0, 0, 2, 0, 0, 0, 7, 8]);
  });

  it('a variable added under a name that is no MATLAB name, or one the file holds already', () => {
    for (const [name, why] of [
      ['1bad', 'it is not a name MATLAB can load (Invalid MATLAB name. Must start with a letter and contain only letters, digits, and underscores)'],
      ['end', "it is not a name MATLAB can load ('end' is a reserved MATLAB keyword)"],
      ['kp', 'the file holds another variable named "kp", and MATLAB loads only one of them'],
    ]) {
      const { root, save } = opened(fixture(CASES), 'cases.mat');
      // Refused by the editor (MatNode.execAddEntry); added around it, under its own name.
      expect(root.execAddEntry(undefined, name), name).toBeNull();
      root.execAddEntry().node.name = name;
      expect(thrownBy(save).message, name).toBe(`Cannot write "${name}": ${why}. Nothing was written.`);
    }
  });

  it('a file that holds two variables of one name keeps both, as read', () => {
    const { by, root, save } = opened(matFile([scalar('a', 1), scalar('a', 2), scalar('b', 3)]));
    expect(root.children.map((c: any) => c.name)).toEqual(['a', 'a', 'b']);
    root.execAddEntry();
    expect(by('b')).toBeDefined();
    const { parsed } = reopened(save());
    expect(parsed.variables.map((v) => [v.name, v.value])).toEqual([['a', 1], ['a', 2], ['b', 3], ['var', 0]]);
  });

  it('a record that does not read back as the value it was written from (the self-check)', () => {
    const { by, edit, save } = opened(fixture(CASES), 'cases.mat');
    expect(edit(by('kp'), 'Value', '9')).toBe(true);
    // The stream written for it, standing in for a writer that wrote another value.
    by('kp')._matStream = () => encodeMatStream({ ...by('kp')._var, value: 10 });
    expect(thrownBy(save).message).toBe(
      'Cannot save "cases.mat": the file written for it did not read back as written: kp: its element 1 reads back as 10 where 9 was written. Nothing was written.',
    );
  });
});

describe("MATLAB's verdict corpus (test/fixtures/mat-check): a save adds nothing MATLAB refuses, or is refused", () => {
  // Copies of MATLAB-written files, most edited one byte range at a time to break a rule MATLAB
  // loads a file by, with MATLAB's verdict on each. Whatever a file breaks as read, a save of it
  // either breaks no rule it did not break (MatFileCheck.violationsAdded, by rule and variable,
  // a renamed variable by its old name), or throws, naming why, and hands back nothing.
  const verdicts: { file: string; matlab: string }[] = JSON.parse(readFileSync(join(MAT_CHECK, 'verdicts.json'), 'utf8'));
  const edits: [string, (o: ReturnType<typeof opened>) => Map<string, string>][] = [
    ['no edit', () => new Map()],
    [
      'every variable renamed',
      (o) => {
        const renamed = new Map<string, string>();
        o.root.children.forEach((node: any, i: number) => {
          const was = node.name;
          if (o.edit(node, 'Name', 'renamed' + i) === true) {
            renamed.set('renamed' + i, was);
          }
        });
        return renamed;
      },
    ],
    [
      'every plain variable written fresh',
      (o) => {
        for (const node of o.root.children.filter((n: any) => n._matWritable?.() === true && !o.root.recordOf(n)?.variable?.isOpaque)) {
          node._markModified();
        }
        return new Map();
      },
    ],
    [
      'a variable added',
      (o) => {
        o.root.execAddEntry();
        return new Map();
      },
    ],
  ];

  for (const [what, edit] of edits) {
    it(what, () => {
      let saved = 0;
      for (const { file, matlab } of verdicts) {
        const input = arrayBufferOf(new Uint8Array(readFileSync(join(MAT_CHECK, file))));
        const before = checkMatFile(new Uint8Array(input));
        const o = opened(input, file);
        const renamed = edit(o);
        let bytes: Uint8Array;
        try {
          bytes = serializeMatFile(o.root);
        } catch (e) {
          expect(e, file).toBeInstanceOf(MatWriteError);
          expect((e as Error).message, file).toMatch(/^Cannot (save|write) "/);
          continue;
        }
        expect(violationsAdded(before, checkMatFile(bytes), renamed), file).toEqual([]);
        if (what === 'no edit') {
          expect(sameBytes(bytes, new Uint8Array(input)), file).toBe(true);
        }
        if (matlab === 'loads') {
          saved++;
        }
      }
      // Not vacuous: of the 64 files MATLAB loads, all but a few are saved. The ones refused are
      // refused for what they hold: 8 zero bytes after the subsystem, which this package does not
      // frame; a name of 70 characters, longer than the 63 a rename is held to; two variables of
      // one name, one of them edited.
      expect(saved, what).toBeGreaterThanOrEqual(verdicts.filter((v) => v.matlab === 'loads').length - 4);
    });
  }
});

describe('the strict check, of the bytes about to be handed back (MatFileCheck)', () => {
  it("a file that breaks a rule as read is saved renamed, its variable's violation matched under the old name", () => {
    // char-latin1-uint8.mat holds a char stored as miUINT8, which MATLAB fails to load
    // (`char-type`). Renamed, the record is its own bytes but for the name, so the violation is
    // the one the file had: matched as the variable's under the name the file gave it (the map
    // violationsAdded takes runs from the new name to the old), the save is not refused.
    const FILE = join(MAT_CHECK, 'char-latin1-uint8.mat');
    const input = arrayBufferOf(new Uint8Array(readFileSync(FILE)));
    const before = checkMatFile(new Uint8Array(input));
    expect(before.map((v) => v.code)).toEqual(['char-type']);
    const { root, edit } = opened(input, 'char-latin1-uint8.mat');
    const [node] = root.children;
    const was = node.name;
    expect(edit(node, 'Name', 'renamedChar')).toBe(true);
    const after = checkMatFile(serializeMatFile(root));
    expect(after.map((v) => [v.code, v.variable])).toEqual([['char-type', 'renamedChar']]);
    expect(violationsAdded(before, after, new Map([['renamedChar', was]]))).toEqual([]);
    expect(violationsAdded(before, after).map((v) => v.code)).toEqual(['char-type']);
  });

  it('refuses a save whose bytes break a rule the file read did not, though they read back as written', () => {
    const { by, edit, save } = opened(fixture(CASES), 'cases.mat');
    expect(edit(by('charStr'), 'Value', "'中文'")).toBe(true);
    // The stream written for it, standing in for a writer that stored the text as miUINT16, which
    // this package's reader reads back as written and MATLAB reads as the low byte of each unit.
    const stream = (text: string) => {
      const units = new Uint8Array(text.length * 2);
      for (let i = 0; i < text.length; i++) {
        new DataView(units.buffer).setUint16(2 * i, text.charCodeAt(i), true);
      }
      const tag = (type: number, n: number) => concat([u32le(type), u32le(n)]);
      const body = concat([
        tag(MI.UINT32, 8), u32le(CLASS.CHAR), u32le(0),
        tag(MI.INT32, 8), u32le(1), u32le(text.length),
        tag(MI.INT8, 0),
        tag(MI.UINT16, units.length), units, new Uint8Array((8 - (units.length % 8)) % 8),
      ]);
      return concat([new Uint8Array([0, 1, 0x49, 0x4d, 0, 0, 0, 0]), tag(MI.MATRIX, body.length), body]);
    };
    by('charStr')._matStream = () => stream('中文');
    const thrown = thrownBy(save);
    expect(thrown).toBeInstanceOf(MatWriteError);
    expect(thrown.message).toMatch(
      /^Cannot save "cases\.mat": the file written for it breaks a rule MATLAB loads a file by, which the file it was read from does not: .*charStr.* Nothing was written\.$/,
    );
  });
});
