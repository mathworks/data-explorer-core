// Copyright 2026 The MathWorks, Inc.
//
// Every plain variable of every Level-5 .mat here, written fresh by a save, is the variable the
// file held: compared with the file's own element, not with what the package's model of it says.
//
// The save's own self-check (MatFileWriter.selfCheck) holds what it wrote to the node's variable
// (MatlabVariableNode._var), and the live MATLAB gate (test/parity/matlab/probe_mat_writeback)
// found two losses that check could not see, because the model carried them too: a complex empty
// rebuilt as a real one once its node was marked edited, and a struct array of no element read
// with no field names, so written with none. MATLAB loaded both as another value. So here each
// variable the writer can write is marked edited without being changed (the mark an edit and its
// undo leave, DataNode._valueEdited), the file is saved, and the record the save wrote for it is
// compared with the record the file held:
//   - by an element walker of the test's own (test/tools/matElements), which reads class, the
//     complex, global, logical and sparse bits, dims, every field name of every struct (of no
//     element too) in order, every member of every cell and struct, every element's value as
//     its class holds it, double and single by their bits (-0 apart from 0), int64 and uint64
//     exactly, a char's code units;
//   - and by the package's reader, the original parse beside the parse of the save: the class,
//     size, complexity, sparsity, field names and order, members and values it reads.
// A NaN's payload is not compared (matElements says why). Any other difference is a value the
// writer changed, and fails here: what the writer cannot write as it was read, it must refuse.
//
// The candidates are what an edit can make the save write fresh: the variables whose edit the
// save takes (MatFileWriter.freshRefusal, the rule the editor offers edits by). A file whose
// save refuses a variable for what only its bytes can say (MatWriter's budget) is saved again
// without it, and the refusal is held to name it.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzlibSync } from 'fflate';
import { parseMat, type MatRecord, type MatVariable } from '../src/datamodel/parser/MatParser.js';
import { freshRefusal } from '../src/datamodel/parser/MatFileWriter.js';
import { MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { createSession } from '../src/index.js';
import { elementDifference, elementValue } from './tools/matElements.js';
import { CLASS, cellVar, matFile, numericVar, structVar } from './tools/matBytes.js';

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));
const MAT_CHECK = join(TEST_ROOT, 'fixtures', 'mat-check');
// The one .mat here the reader refuses: a `-v7.3` file is HDF5, not Level 5.
const REFUSED = new Set(['strings_v73.mat']);

function matFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (abs !== MAT_CHECK) {
        out.push(...matFilesUnder(abs));
      }
    } else if (entry.isFile() && entry.name.endsWith('.mat') && !REFUSED.has(entry.name)) {
      out.push(abs);
    }
  }
  return out.sort();
}

const arrayBufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/** A record's miMATRIX element, its tag included, inflated when the record is compressed. */
function elementOf(record: MatRecord): Uint8Array {
  const view = new DataView(record.bytes.buffer, record.bytes.byteOffset, record.bytes.byteLength);
  return view.getUint32(0, true) === 15 ? unzlibSync(record.bytes.subarray(8, 8 + view.getUint32(4, true))) : record.bytes;
}

// The parts of a parsed variable that are where it came from rather than what it is.
const NOT_THE_VALUE = new Set(['name', '_rawBytes', '_modified', 'mcosHandle']);

/** The first difference between two variables the reader made, or null. NaN equals NaN; -0 is not 0. */
function parsedDifference(was: unknown, is: unknown, at: string): string | null {
  const shown = (x: unknown) => (Object.is(x, -0) ? '-0' : String(x));
  if (typeof was === 'number' && typeof is === 'number') {
    return (Number.isNaN(was) && Number.isNaN(is)) || Object.is(was, is) ? null : at + ': ' + shown(was) + ' read, ' + shown(is) + ' written';
  }
  if (was === null || is === null || typeof was !== 'object' || typeof is !== 'object') {
    return was === is ? null : at + ': ' + shown(was) + ' read, ' + shown(is) + ' written';
  }
  if (ArrayBuffer.isView(was) || ArrayBuffer.isView(is)) {
    const a = Array.from(was as ArrayLike<number>);
    const b = Array.from(is as ArrayLike<number>);
    return parsedDifference(a, b, at);
  }
  const keys = (o: object) => Object.keys(o).filter((k) => !NOT_THE_VALUE.has(k) && (o as Record<string, unknown>)[k] !== undefined);
  const a = keys(was);
  const b = keys(is);
  // A struct's field names, in order, are its keys.
  if (a.join(',') !== b.join(',')) {
    return at + ': keys ' + a.join(',') + ' read, ' + b.join(',') + ' written';
  }
  for (const k of a) {
    const d = parsedDifference((was as Record<string, unknown>)[k], (is as Record<string, unknown>)[k], at + '.' + k);
    if (d) {
      return d;
    }
  }
  return null;
}

interface Swept {
  written: string[];
  refused: string[];
  differences: string[];
  unwalked: string[];
}

/** `bytes` opened, its every writable variable marked edited, saved, and each compared with its own record. */
function sweep(file: string, bytes: Uint8Array, refusedBefore: string[] = []): Swept | { saveRefused: string } {
  const session = createSession();
  const root: any = session.addMatSource(file, arrayBufferOf(bytes));
  const candidates = root.children.filter((node: any) => {
    const record = root.recordOf(node);
    return record && !refusedBefore.includes(node.name) && freshRefusal(node, record) === null;
  });
  candidates.forEach((node: any) => node._markModified());
  let saved: Uint8Array;
  try {
    saved = (session.serializeSource(file) as { bytes: Uint8Array }).bytes;
  } catch (e) {
    if (!(e instanceof MatWriteError)) {
      throw e;
    }
    // Refused for a variable's bytes (MatWriter's budget): saved again without it. Anything else
    // refuses the file, which the caller judges.
    const named = candidates.find((node: any) => e.message.startsWith('Cannot write "' + node.name + '"') || e.message.includes('"' + node.name + '"'));
    if (named && refusedBefore.length < candidates.length + refusedBefore.length) {
      return sweep(file, bytes, [...refusedBefore, named.name]);
    }
    return { saveRefused: e.message };
  }
  const before = parseMat(arrayBufferOf(bytes));
  const after = parseMat(arrayBufferOf(saved));
  const out: Swept = { written: [], refused: refusedBefore, differences: [], unwalked: [] };
  for (const node of candidates) {
    const name = node.name;
    const was = before.records.find((r) => r.name === name)!;
    const is = after.records.find((r) => r.name === name)!;
    out.written.push(name);
    let walked: string | null = null;
    try {
      walked = elementDifference(elementValue(elementOf(was)), elementValue(elementOf(is)), name);
    } catch (e) {
      // The file's element is one the walker cannot read (a damaged corpus file): the reader's
      // comparison below still holds it.
      out.unwalked.push(name + ': ' + (e as Error).message);
    }
    if (walked) {
      out.differences.push(walked);
    }
    const parsed = parsedDifference(was.variable as MatVariable, is.variable as MatVariable, name);
    if (parsed) {
      out.differences.push(parsed);
    }
  }
  return out;
}

const fixtureFiles = matFilesUnder(TEST_ROOT);

describe('every plain variable of every .mat, written fresh, is the variable its file held', () => {
  it('sweeps every Level-5 fixture', () => {
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(35);
  });

  let total = 0;
  for (const abs of fixtureFiles) {
    const rel = abs.slice(TEST_ROOT.length);
    it(rel, () => {
      const result = sweep(rel.slice(rel.lastIndexOf('/') + 1), new Uint8Array(readFileSync(abs)));
      expect('saveRefused' in result ? result.saveRefused : null, rel).toBeNull();
      const swept = result as Swept;
      expect(swept.differences, rel).toEqual([]);
      expect(swept.unwalked, rel).toEqual([]);
      total += swept.written.length;
      if (process.env.DEX_SWEEP_COUNTS) console.log(rel, 'written', swept.written.length, 'refused', swept.refused);
    });
  }

  it('and writes over 150 variables fresh doing so', () => {
    expect(total).toBeGreaterThanOrEqual(150);
  });
});

describe("and of every file of MATLAB's verdict corpus core opens (test/fixtures/mat-check)", () => {
  const verdicts: { file: string; matlab: string }[] = JSON.parse(readFileSync(join(MAT_CHECK, 'verdicts.json'), 'utf8'));

  it('each variable written fresh is the one the file held, or its save is refused', () => {
    let written = 0;
    const differences: string[] = [];
    for (const { file, matlab } of verdicts) {
      const bytes = new Uint8Array(readFileSync(join(MAT_CHECK, file)));
      let result: ReturnType<typeof sweep>;
      try {
        result = sweep(file, bytes);
      } catch (e) {
        // A file core does not open.
        expect((e as Error).message, file).toBeTruthy();
        continue;
      }
      if ('saveRefused' in result) {
        expect(result.saveRefused, file).toMatch(/^Cannot (save|write) "/);
        continue;
      }
      written += result.written.length;
      // A file MATLAB loads is held to every part of its elements; one it refuses was damaged on
      // purpose, and its damaged part may be one the walker does not read.
      if (matlab === 'loads') {
        expect(result.unwalked, file).toEqual([]);
      }
      differences.push(...result.differences.map((d) => file + ': ' + d));
    }
    expect(differences).toEqual([]);
    if (process.env.DEX_SWEEP_COUNTS) console.log('corpus written', written);
    expect(written).toBeGreaterThanOrEqual(150);
  });
});

describe('and of the values no fixture holds, built byte by byte', () => {
  // A variable `save` marks global (its array flags' bit 0x04): the flag is the variable's, and
  // nothing but the record's bytes holds it.
  const global = (element: Uint8Array) => {
    const out = element.slice();
    out[17] |= 0x04;
    return out;
  };
  const es = (dims: number[]) => structVar('', ['a', 'bb'], [], dims);
  const cx = (dims: number[], cls: number = CLASS.DOUBLE) => numericVar({ name: '', cls, dimensions: dims, real: [], imag: [] });
  const one = numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [1] });
  const file = new Uint8Array(
    matFile([
      global(numericVar({ name: 'g', cls: CLASS.DOUBLE, dimensions: [1, 2], real: [1, 2] })),
      global(structVar('gs', ['es'], [{ es: es([0, 0]) }])),
      numericVar({ name: 'negZero', cls: CLASS.DOUBLE, dimensions: [1, 3], real: [-0, 0, -0], imag: [-0, -0, 3] }),
      numericVar({ name: 'negZeroScalar', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [-0], imag: [-0] }),
      numericVar({ name: 'negZeroSingle', cls: CLASS.SINGLE, dimensions: [1, 2], real: [-0, 1], imag: [2, -0] }),
      numericVar({ name: 'realNegZero', cls: CLASS.DOUBLE, dimensions: [1, 2], real: [-0, 1] }),
      numericVar({ name: 'cx03s', cls: CLASS.SINGLE, dimensions: [0, 3], real: [], imag: [] }),
      numericVar({ name: 'cxNd', cls: CLASS.INT16, dimensions: [0, 2, 2], real: [], imag: [] }),
      structVar('esNd', ['a', 'bb'], [], [0, 0, 2]),
      cellVar('c', [es([0, 0]), cx([1, 0]), es([2, 0]), cx([0, 3], CLASS.SINGLE)], [1, 4]),
      structVar('sa', ['es', 'x'], [{ es: es([0, 0]), x: one }, { es: es([1, 0]), x: one }], [1, 2]),
      structVar('nested', ['inner'], [{ inner: structVar('', ['deep'], [{ deep: es([0, 1]) }]) }]),
    ]),
  );

  it('each is written fresh as the variable the file held: global, -0 parts, empties with fields and complexity', () => {
    const result = sweep('built.mat', file);
    expect('saveRefused' in result ? result.saveRefused : null).toBeNull();
    const swept = result as Swept;
    expect(swept.written.length).toBe(12);
    expect(swept.differences).toEqual([]);
    expect(swept.unwalked).toEqual([]);
  });
});
