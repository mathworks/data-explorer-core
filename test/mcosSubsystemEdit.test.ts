// Copyright 2026 The MathWorks, Inc.
//
// McosSubsystemEdit: one property of an MCOS object changed by replacing only the value cell
// that holds it, every other byte of the subsystem kept.
//
//   - Every subsystem a fixture carries — a .mat's last record, a model workspace's
//     trailing element (.slx and .mdl), a binary dictionary's hex and a text one's cdata —
//     reads, re-emits as it was, and takes a swap of each stored value cell for its own
//     bytes back byte for byte; and the strict reader here reads the table McosParser does.
//   - The edits MATLAB R2027a judged (test/fixtures/mat-cellswap, cellswap.truth.json): the
//     editor writes each mutant's subsystem byte for byte, and for 14 of them MATLAB's own
//     save of the same edit; core reads the edited value back out.
//   - What it refuses, and that a refusal writes nothing.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { decodeMatStream, parseMat, type MatVariable } from '../src/datamodel/parser/MatParser.js';
import { parseSlx } from '../src/datamodel/parser/SlxParser.js';
import { parseMdl } from '../src/datamodel/parser/MdlParser.js';
import { uudecode } from '../src/datamodel/parser/CdataCodec.js';
import { decodeMcosVariables, mcosMetaTableOf } from '../src/datamodel/parser/McosParser.js';
import {
  editMcosSubsystem,
  objectIdOf,
  readMcosSubsystem,
  storedProperties,
  valueCellOf,
  type McosSubsystem,
} from '../src/datamodel/parser/McosSubsystemEdit.js';

const ROOTS = ['fixtures', join('parity', 'artifacts')].map((d) => fileURLToPath(new URL(`./${d}/`, import.meta.url)));
const CELLSWAP = fileURLToPath(new URL('./fixtures/mat-cellswap/', import.meta.url));

// Not test/fixtures/mat-check: copies of MATLAB-written files edited to break MATLAB's load rules
// on purpose (test/matFileCheck.test.ts), whose subsystems are not ones MATLAB wrote.
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) return [path];
    return name === 'mat-check' ? [] : filesUnder(path);
  });
}

const arrayBufferOf = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

/** The subsystem of a .mat: its last record, when that is the anonymous one. */
function matSubsystem(bytes: Uint8Array): { parsed: ReturnType<typeof parseMat>; subsystem: Uint8Array } | null {
  const parsed = parseMat(arrayBufferOf(bytes));
  const last = parsed.records[parsed.records.length - 1];
  const raw = last?.anonymous && last.status === 'read' ? last.variable?._rawBytes : null;
  return raw ? { parsed, subsystem: raw } : null;
}

/** The element after the value in a MAT stream, when there is one. */
function streamSubsystem(stream: Uint8Array): Uint8Array | null {
  const decoded = decodeMatStream(stream);
  return decoded.ok && decoded.trailingElements.length > 0 ? decoded.trailingElements[0] : null;
}

interface Found {
  where: string;
  bytes: Uint8Array;
}

/** Every subsystem a fixture carries, in each place one is kept. */
function subsystemsIn(file: string, bytes: Uint8Array, where: string, out: Found[]): void {
  if (file.endsWith('.mat')) {
    // A v7.3 file is HDF5, which keeps its objects another way.
    if (Buffer.from(bytes.subarray(0, 19)).toString('latin1') === 'MATLAB 7.3 MAT-file') return;
    const m = matSubsystem(bytes);
    if (m) out.push({ where, bytes: m.subsystem });
    return;
  }
  if (file.endsWith('.slx')) {
    let ws: { _trailingElements?: Uint8Array[] } | undefined;
    try {
      ws = parseSlx(arrayBufferOf(bytes), file).workspace as never;
    } catch {
      return;
    }
    const sub = ws?._trailingElements?.[0];
    if (sub) out.push({ where: `${where} workspace`, bytes: sub });
    return;
  }
  if (file.endsWith('.mdl')) {
    const sub = parseMdl(arrayBufferOf(bytes), file).workspace._trailingElements?.[0];
    if (sub) out.push({ where: `${where} workspace`, bytes: sub });
    return;
  }
  if (file.endsWith('.sldd')) {
    const texts: [string, string][] = [];
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      for (const [part, data] of Object.entries(unzipSync(bytes))) texts.push([part, Buffer.from(data).toString('latin1')]);
    } else {
      texts.push(['', Buffer.from(bytes).toString('latin1')]);
    }
    for (const [part, text] of texts) {
      let n = 0;
      for (const m of text.matchAll(/Encoding="hex"[^>]*>([^<]*)</g)) {
        const sub = streamSubsystem(Uint8Array.from(Buffer.from(m[1].replace(/\s+/g, ''), 'hex')));
        if (sub) out.push({ where: `${where}::${part} hex ${n++}`, bytes: sub });
      }
      for (const m of text.matchAll(/"_value"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
        const value: string = JSON.parse(`"${m[1]}"`);
        if (!value.startsWith('  %)')) continue;
        const sub = streamSubsystem(uudecode(value));
        if (sub) out.push({ where: `${where}::${part} cdata ${n++}`, bytes: sub });
      }
    }
  }
}

const FOUND: Found[] = [];
for (const root of ROOTS) {
  for (const file of filesUnder(root)) {
    if (!/\.(mat|sldd|slx|mdl)$/i.test(file)) continue;
    subsystemsIn(file, new Uint8Array(readFileSync(file)), file.slice(root.length), FOUND);
  }
}

const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

function read(bytes: Uint8Array): McosSubsystem {
  const r = readMcosSubsystem(bytes);
  if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
  return r.subsystem;
}

describe('every subsystem a fixture carries', () => {
  it('is found in each place one is kept', () => {
    // Floors, measured when this was written: a sweep that found nothing would pass.
    expect(FOUND.length).toBeGreaterThanOrEqual(95);
    const kinds = new Set(FOUND.map((f) => (/ workspace$/.test(f.where) ? 'workspace' : / hex \d+$/.test(f.where) ? 'hex' : 'mat')));
    expect([...kinds].sort()).toEqual(['hex', 'mat', 'workspace']);
  });

  it('reads whole, every layer parsed exactly', () => {
    const refused = FOUND.map((f) => ({ where: f.where, r: readMcosSubsystem(f.bytes) })).filter((x) => !x.r.ok);
    expect(refused.map((x) => `${x.where}: ${(x.r as { message: string }).message}`)).toEqual([]);
  });

  it('re-emits as it was read when nothing is edited', () => {
    for (const f of FOUND) {
      const s = read(f.bytes);
      if (s.objects.length < 2) continue;
      const r = editMcosSubsystem(s, 1, []);
      expect(r.ok && same(r.bytes, f.bytes), f.where).toBe(true);
    }
  });

  it('takes a swap of every stored value cell for its own bytes, and gives the subsystem back byte for byte', () => {
    const refused: Record<string, number> = {};
    let swapped = 0;
    for (const f of FOUND) {
      const s = read(f.bytes);
      for (let id = 1; id < s.objects.length; id++) {
        const stored = storedProperties(s, id);
        expect(stored.ok, `${f.where} object ${id}`).toBe(true);
        if (!stored.ok) continue;
        for (const p of stored.properties) {
          const cell = p.cellIndex === null ? new Uint8Array(0) : f.bytes.subarray(s.cells[p.cellIndex].at, s.cells[p.cellIndex].end);
          const r = editMcosSubsystem(s, id, [{ savedName: p.savedName, cell }]);
          if (p.refusal === null) {
            expect(r.ok && same(r.bytes, f.bytes), `${f.where} object ${id} ${p.savedName}`).toBe(true);
            swapped++;
          } else {
            // The refusal storedProperties reports is the one the editor makes.
            expect(r.ok ? null : r.reason, `${f.where} object ${id} ${p.savedName}`).toBe(p.refusal);
            refused[p.refusal] = (refused[p.refusal] ?? 0) + 1;
          }
        }
      }
    }
    // Measured when this was written: 2313 swaps; 686 cells holding a nested object's handle,
    // and 805 properties stored as a string index, an integer or an object id. MATLAB wrote
    // no shared cell, no cell that does not parse, no triple past the cells.
    expect(swapped).toBeGreaterThanOrEqual(2000);
    expect(Object.keys(refused).sort()).toEqual(['not-a-cell', 'object-reference']);
    expect(refused['object-reference']).toBeGreaterThanOrEqual(600);
    expect(refused['not-a-cell']).toBeGreaterThanOrEqual(700);
  });

  it('takes a value of another size into one cell, and moves no other byte of the subsystem', () => {
    // Three doubles where a cell held anything else: every layer around the cell is restated.
    const cell = valueCellOf({ name: '', className: 'double', dimensions: [1, 3], value: [1, 2, 3], isComplex: false, isLogical: false, fields: null });
    let edited = 0;
    for (const f of FOUND) {
      const s = read(f.bytes);
      for (let id = 1; id < s.objects.length; id++) {
        const stored = storedProperties(s, id);
        const p = stored.ok ? stored.properties.find((x) => x.refusal === null) : undefined;
        if (!p) continue;
        const r = editMcosSubsystem(s, id, [{ savedName: p.savedName, cell }]);
        if (!r.ok) throw new Error(`${f.where}: ${r.message}`);
        const after = read(r.bytes);
        const piece = (x: McosSubsystem, i: number) => x.bytes.subarray(x.cells[i].at, x.cells[i].end);
        expect(after.cells.length, f.where).toBe(s.cells.length);
        for (let i = 0; i < s.cells.length; i++) {
          expect(same(piece(after, i), i === p.cellIndex ? cell : piece(s, i)), `${f.where} object ${id} cell ${i}`).toBe(true);
        }
        // The payload's preamble, the struct's other fields and the rest of the stream.
        const fieldsOf = (x: McosSubsystem) => x.struct.subs.filter((_, i) => i !== x.mcosField).map((sub) => x.bytes.subarray(sub.at, sub.end));
        expect(fieldsOf(after).every((b, i) => same(b, fieldsOf(s)[i])), f.where).toBe(true);
        const tail = (x: McosSubsystem) => x.bytes.subarray(x.struct.end);
        expect(same(tail(after), tail(s)), f.where).toBe(true);
        expect(r.bytes.length - f.bytes.length, f.where).toBe(cell.length - (s.cells[p.cellIndex!].end - s.cells[p.cellIndex!].at));
        edited++;
        break;
      }
    }
    expect(edited).toBeGreaterThanOrEqual(90);
  });

  it('names no value cell from two triples: MATLAB writes one cell per value', () => {
    for (const f of FOUND) {
      const s = read(f.bytes);
      expect([...s.references.values()].every((n) => n === 1), f.where).toBe(true);
    }
  });

  it('reads the table McosParser reads', () => {
    for (const f of FOUND) {
      const s = read(f.bytes);
      const meta = mcosMetaTableOf(f.bytes);
      expect(meta, f.where).not.toBeNull();
      if (!meta) continue;
      // McosParser reads the string table's padding as empty strings past the count.
      expect(meta.strings.slice(0, s.strings.length), f.where).toEqual(s.strings);
      expect(meta.strings.slice(s.strings.length).every((x) => x === ''), f.where).toBe(true);
      expect(meta.classes.map((c) => c.fullName), f.where).toEqual(s.classes.map((c) => c ?? ''));
      expect(meta.objects, f.where).toEqual(s.objects.map((o) => ({ classId: o.classId, blockIdx: o.pvList, type1Idx: o.ctorList })));
      const triples = (lists: { name: number; flag: number; value: number }[][]) => lists.map((l) => l.map((t) => [t.name, t.flag, t.value]));
      expect(meta.blocks, f.where).toEqual(triples(s.pvLists));
      expect(meta.type1Blocks, f.where).toEqual(triples(s.ctorLists));
    }
  });
});

// ---- The edits MATLAB judged ---------------------------------------------------------

interface ValueSpec {
  className: string;
  dimensions: number[];
  value: unknown;
  isComplex?: boolean;
  isLogical?: boolean;
}

interface SwapCase {
  name: string;
  note: string;
  original: string;
  mutant: string | null;
  matlabSave: string | null;
  path: string;
  objectId: number;
  edits: { savedName: string; value: ValueSpec; cell: number | null }[];
  matlab: 'PASS' | 'FAIL' | null;
  sameAsMatlabSave: boolean | null;
}

const TRUTH: { matlabVersion: string; cases: SwapCase[] } = JSON.parse(readFileSync(join(CELLSWAP, 'cellswap.truth.json'), 'utf8'));

const cellswap = (name: string): Uint8Array => new Uint8Array(readFileSync(join(CELLSWAP, name)));

function opened(name: string): { parsed: ReturnType<typeof parseMat>; subsystem: Uint8Array } {
  const m = matSubsystem(cellswap(name));
  if (!m) throw new Error(`${name} has no subsystem`);
  return m;
}

const variableOf = (spec: ValueSpec): MatVariable => ({
  name: '',
  className: spec.className,
  dimensions: spec.dimensions,
  value: spec.value,
  isComplex: !!spec.isComplex,
  isLogical: !!spec.isLogical,
  fields: null,
});

/** The variable a MATLAB path names, 'p', 's.p', 'c{1}' or 'arr(2)', and which of its elements. */
function atPath(variables: MatVariable[], path: string): { variable: MatVariable; index: number } {
  const [, root, rest] = /^(\w+)(.*)$/.exec(path)!;
  let variable = variables.find((v) => v.name === root)!;
  let index = 0;
  for (const [, field, cell, element] of rest.matchAll(/\.(\w+)|\{(\d+)\}|\((\d+)\)/g)) {
    if (field) variable = variable.fields![field] as MatVariable;
    else if (cell) variable = (variable.value as MatVariable[])[Number(cell) - 1];
    else index = Number(element) - 1;
  }
  return { variable, index };
}

/** What core's decoder reads of the object at `path`, against `subsystem`. */
function decodedAt(variables: MatVariable[], path: string, subsystem: Uint8Array): Record<string, unknown> {
  const { variable, index } = atPath(variables, path);
  const decoded = decodeMcosVariables(subsystem, [variable]).get(variable);
  if (!decoded) throw new Error(`core did not decode ${path}`);
  return decoded.elements[index];
}

describe('the edits MATLAB R2027a judged', () => {
  it('are the probe this suite is held to', () => {
    expect(TRUTH.matlabVersion).toMatch(/R2027a/);
    expect(TRUTH.cases.length).toBe(21);
    expect(TRUTH.cases.filter((c) => c.matlab === 'PASS').length).toBe(19);
    expect(TRUTH.cases.filter((c) => c.sameAsMatlabSave).length).toBe(14);
  });

  for (const c of TRUTH.cases.filter((x) => x.mutant)) {
    describe(`${c.name} (MATLAB: ${c.matlab}): ${c.note}`, () => {
      const { parsed, subsystem } = opened(c.original);
      const { variable, index } = atPath(parsed.variables, c.path);
      const id = objectIdOf(variable.mcosHandle, index);
      const edits = c.edits.map((e) => ({ savedName: e.savedName, cell: valueCellOf(variableOf(e.value)) }));
      const result = id === null ? null : editMcosSubsystem(subsystem, id, edits);
      const ours = result?.ok ? result.bytes : null;

      it('finds the object and the cells the probe swapped', () => {
        expect(id).toBe(c.objectId);
        const stored = storedProperties(subsystem, id!);
        expect(stored.ok).toBe(true);
        if (!stored.ok) return;
        for (const e of c.edits) {
          const p = stored.properties.find((x) => x.savedName === e.savedName);
          expect(p, e.savedName).toMatchObject({ flag: 1, cellIndex: e.cell, refusal: null });
        }
      });

      it("writes the subsystem MATLAB judged, byte for byte", () => {
        expect(result?.ok).toBe(true);
        expect(same(ours!, opened(c.mutant!).subsystem)).toBe(true);
      });

      it(c.sameAsMatlabSave ? "which is MATLAB's own save of the same edit" : "which is not MATLAB's own save of the edit, as the truth file records", () => {
        expect(same(ours!, opened(c.matlabSave!).subsystem)).toBe(c.sameAsMatlabSave);
      });

      it('and core reads the edited object back as it reads the mutant', () => {
        const mutant = opened(c.mutant!);
        const fromOurs = decodedAt(parsed.variables, c.path, ours!);
        expect(fromOurs).toEqual(decodedAt(mutant.parsed.variables, c.path, mutant.subsystem));
        const before = decodedAt(parsed.variables, c.path, subsystem);
        for (const e of c.edits) {
          expect(fromOurs[e.savedName], e.savedName).not.toEqual(before[e.savedName]);
        }
      });
    });
  }

  it('reads each edited value back as the value written', () => {
    const shown: Record<string, unknown> = {};
    for (const c of TRUTH.cases.filter((x) => x.mutant)) {
      const { parsed, subsystem } = opened(c.original);
      const { variable, index } = atPath(parsed.variables, c.path);
      const r = editMcosSubsystem(subsystem, objectIdOf(variable.mcosHandle, index)!, c.edits.map((e) => ({ savedName: e.savedName, cell: valueCellOf(variableOf(e.value)) })));
      if (!r.ok) throw new Error(r.message);
      const bag = decodedAt(parsed.variables, c.path, r.bytes);
      for (const e of c.edits) shown[`${c.name}.${e.savedName}`] = bag[e.savedName];
    }
    // Core's own spellings: a typed scalar's class and text, a matrix's Matrix() literal, a
    // complex value's cdata text.
    expect(shown).toEqual({
      'basic_same_class.Value': 7,
      'basic_v6.Value': 7,
      'resize_value_only.Value': { _type: 'double', _value: 'Matrix(2,3)\n[[1.0, 2.0, 3.0]; [4.0, 5.0, 6.0]]' },
      'resize_value_and_dims.Value': { _type: 'double', _value: 'Matrix(2,3)\n[[1.0, 2.0, 3.0]; [4.0, 5.0, 6.0]]' },
      'resize_value_and_dims.Dimensions': [2, 3],
      'class_int16.Value': { _type: 'int16', _value: '-4' },
      'class_logical.Value': true,
      'complex_value_only.Value': { _type: 'cdata', _value: '1+2i' },
      'typed_value.Value': { _type: 'single', _value: '3.5F' },
      'typed_description.Description': 'new description',
      'typed_max.Max': 100,
      'typed_value_over_max.Value': { _type: 'single', _value: '20F' },
      'typed_datatype.DataType': 'double',
      'typed_datatype_with_value.DataType': 'double',
      'typed_datatype_with_value.Value': 2.5,
      'typed_unit.DocUnits': 'km',
      'nested_struct.Value': 9,
      'nested_cell.Value': 9,
      'nested_array.Value': 22,
      'shared_handle.Value': 7,
      'signal_initial.InitialValue': '4',
      'zero_value.Value': 5,
    });
  });

  it('refuses the one MATLAB left at its default: there is no cell to swap', () => {
    const c = TRUTH.cases.find((x) => x.name === 'default_value')!;
    expect(c.mutant).toBeNull();
    const { parsed, subsystem } = opened(c.original);
    const { variable, index } = atPath(parsed.variables, c.path);
    const id = objectIdOf(variable.mcosHandle, index)!;
    expect(id).toBe(c.objectId);
    const r = editMcosSubsystem(subsystem, id, [{ savedName: 'Value', cell: valueCellOf(variableOf(c.edits[0].value)) }]);
    expect(r).toMatchObject({ ok: false, reason: 'not-stored', savedName: 'Value' });
    const stored = storedProperties(subsystem, id);
    expect(stored.ok && stored.properties.map((p) => p.savedName)).toEqual(['Complexity', 'Dimensions', 'CoderInfo']);
  });
});

// ---- What it refuses -----------------------------------------------------------------

const MAGIC = 0xdd000000;
const BASIC = opened('pv_basic.mat');
const BASIC_SUB = read(BASIC.subsystem);
const P = objectIdOf(atPath(BASIC.parsed.variables, 'p').variable.mcosHandle)!;
const Q = objectIdOf(atPath(BASIC.parsed.variables, 'q').variable.mcosHandle)!;
const STR = objectIdOf(atPath(BASIC.parsed.variables, 'str').variable.mcosHandle)!;
const seven = (): Uint8Array => valueCellOf(variableOf({ className: 'double', dimensions: [1, 1], value: 7 }));

/** A copy of `bytes` with the uint32 at `at` set to `word`. */
function patched(bytes: Uint8Array, at: number, word: number): Uint8Array {
  const out = bytes.slice();
  new DataView(out.buffer).setUint32(at, word >>> 0, true);
  return out;
}

function tripleOf(s: McosSubsystem, id: number, savedName: string) {
  return s.pvLists[s.objects[id].pvList].find((t) => s.strings[t.name] === savedName)!;
}

function refusalOf(bytes: Uint8Array, id: number, savedName = 'Value', cell = seven()): string {
  const r = editMcosSubsystem(bytes, id, [{ savedName, cell }]);
  expect('bytes' in r).toBe(!!r.ok);
  return r.ok ? 'ok' : r.reason;
}

describe('what the editor refuses, writing nothing', () => {
  it('a property at its class default, or one the object never had', () => {
    expect(P).toBe(1);
    expect(refusalOf(BASIC.subsystem, P, 'NoSuchProperty')).toBe('not-stored');
    // A string saved itself as one payload, through its class's own save.
    const r = editMcosSubsystem(BASIC.subsystem, STR, [{ savedName: 'any', cell: seven() }]);
    expect(r).toMatchObject({ ok: false, reason: 'not-stored', message: expect.stringContaining('one payload') });
    expect(storedProperties(BASIC.subsystem, STR)).toEqual({ ok: true, className: 'string', properties: [] });
  });

  it('a property stored as a string-table index, not in a cell: Complexity', () => {
    const r = editMcosSubsystem(BASIC.subsystem, P, [{ savedName: 'Complexity', cell: seven() }]);
    expect(r).toMatchObject({ ok: false, reason: 'not-a-cell', savedName: 'Complexity', message: expect.stringContaining('string-table index') });
  });

  it("a cell holding an object reference: the Parameter's CoderInfo", () => {
    expect(refusalOf(BASIC.subsystem, P, 'CoderInfo')).toBe('object-reference');
  });

  it('a new value holding an object reference, at any depth', () => {
    const handle = variableOf({ className: 'uint32', dimensions: [6, 1], value: [MAGIC, 2, 1, 1, 1, 1] });
    expect(refusalOf(BASIC.subsystem, P, 'Value', valueCellOf(handle))).toBe('object-reference');
    const inCell = { ...variableOf({ className: 'cell', dimensions: [1, 2], value: [variableOf({ className: 'double', dimensions: [1, 1], value: 1 }), handle] }) };
    expect(refusalOf(BASIC.subsystem, P, 'Value', valueCellOf(inCell))).toBe('object-reference');
    const inStruct: MatVariable = { ...variableOf({ className: 'struct', dimensions: [1, 1], value: null }), fields: { EnumerationInstanceTag: variableOf({ className: 'uint32', dimensions: [1, 1], value: MAGIC }) } };
    expect(refusalOf(BASIC.subsystem, P, 'Value', valueCellOf(inStruct))).toBe('object-reference');
    // A uint32 that does not open with the magic is a value.
    const plain = variableOf({ className: 'uint32', dimensions: [1, 2], value: [5, MAGIC] });
    expect(refusalOf(BASIC.subsystem, P, 'Value', valueCellOf(plain))).toBe('ok');
  });

  it('an id that names no object', () => {
    for (const id of [0, -1, 1.5, NaN, BASIC_SUB.objects.length]) {
      expect(refusalOf(BASIC.subsystem, id), String(id)).toBe('bad-object');
      expect(storedProperties(BASIC.subsystem, id)).toMatchObject({ ok: false, reason: 'bad-object' });
    }
  });

  it('a cell another triple names too, of another object or a constructor argument', () => {
    const k = tripleOf(BASIC_SUB, P, 'Value').value;
    // q's Value made to name p's Value cell.
    const fromQ = patched(BASIC.subsystem, tripleOf(BASIC_SUB, Q, 'Value').at + 8, k);
    expect(refusalOf(fromQ, P)).toBe('shared-cell');
    expect(refusalOf(fromQ, Q)).toBe('shared-cell');
    const stored = storedProperties(fromQ, P);
    expect(stored.ok && stored.properties.find((p) => p.savedName === 'Value')?.refusal).toBe('shared-cell');
    // The string's payload, its one constructor argument, made to name it.
    const ctor = BASIC_SUB.ctorLists[BASIC_SUB.objects[STR].ctorList][0];
    expect(BASIC_SUB.strings[ctor.name]).toBe('any');
    expect(refusalOf(patched(BASIC.subsystem, ctor.at + 8, k), P)).toBe('shared-cell');
    // And p's other cells still swap.
    expect(refusalOf(fromQ, P, 'Dimensions', valueCellOf(variableOf({ className: 'double', dimensions: [1, 2], value: [1, 1] })))).toBe('ok');
  });

  it('two edits of one property', () => {
    const r = editMcosSubsystem(BASIC.subsystem, P, [{ savedName: 'Value', cell: seven() }, { savedName: 'Value', cell: seven() }]);
    expect(r).toMatchObject({ ok: false, reason: 'duplicate-edit', savedName: 'Value' });
  });

  it('a new value that is not one whole nameless element holding what its dims declare', () => {
    expect(refusalOf(BASIC.subsystem, P, 'Value', new Uint8Array(16))).toBe('bad-cell');
    expect(refusalOf(BASIC.subsystem, P, 'Value', seven().subarray(0, 40))).toBe('bad-cell');
    expect(refusalOf(BASIC.subsystem, P, 'Value', new Uint8Array([...seven(), 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('bad-cell');
    // A top-level variable's element carries its name.
    const x = opened('pv_basic_v6.mat').parsed.variables.find((v) => v.name === 'x')!;
    expect(refusalOf(BASIC.subsystem, P, 'Value', x._rawBytes!)).toBe('bad-cell');
    // Dims of [1 2] over the one double the payload holds.
    const short = seven();
    new DataView(short.buffer).setInt32(36, 2, true);
    expect(refusalOf(BASIC.subsystem, P, 'Value', short)).toBe('bad-cell');
    // A cell declaring two members and holding one.
    const cell = valueCellOf(variableOf({ className: 'cell', dimensions: [1, 1], value: [variableOf({ className: 'double', dimensions: [1, 1], value: 1 })] }));
    new DataView(cell.buffer).setInt32(36, 2, true);
    expect(refusalOf(BASIC.subsystem, P, 'Value', cell)).toBe('bad-cell');
  });

  it('a layer that does not parse exactly', () => {
    const b = BASIC.subsystem;
    const s = BASIC_SUB;
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const malformed: [string, Uint8Array, RegExp][] = [
      ['cut short', b.subarray(0, b.length - 8), /not one whole MAT element/],
      ['a byte past its end', new Uint8Array([...b, 0]), /not one whole MAT element/],
      ['an outer byte count past its end', patched(b, 4, b.length), /not one whole MAT element/],
      ['its dims not [1 N]', patched(b, s.outer.subs[1].data + 4, s.outer.subs[3].bytes - 8), /dims do not say/],
      ['no FileWrapper__', patched(b, s.opaque.subs[3].data, 0x58585858), /not a FileWrapper__ opaque/],
      ['no MCOS field', patched(b, s.struct.subs[4].data, 0x534f434e), /has 0 MCOS fields/],
      ['a cell array whose dims are not its cells', patched(b, s.cellArray.subs[1].data, s.cells.length + 1), /does not hold the cells its dims declare/],
      ['segments out of order', patched(b, s.blobAt + 8 + 4 * 3, 40), /segment 3 starts at 40/],
      ['a property list running past its segment', patched(b, tripleOf(s, P, 'Value').at - 4, 1000), /property lists runs past/],
      ['an object naming a property list the blob does not hold', patched(b, s.blobAt + view.getUint32(s.blobAt + 16, true) + 24 * P + 16, 999), /names property list 999/],
      ['a triple naming a string the table does not hold', patched(b, tripleOf(s, P, 'Value').at, 9999), /names a string the table does not hold/],
      ['a triple naming a cell past the cells', patched(b, tripleOf(s, P, 'Value').at + 8, s.valueCells), /names value cell 15, and the subsystem holds 15/],
    ];
    for (const [what, bytes, message] of malformed) {
      expect(editMcosSubsystem(bytes, P, [{ savedName: 'Value', cell: seven() }]), what).toMatchObject({ ok: false, reason: 'malformed', message: expect.stringMatching(message) });
    }
  });

  it('a blob it was not measured on', () => {
    const b = BASIC.subsystem;
    const s = BASIC_SUB;
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const header2 = s.blobAt + view.getUint32(s.blobAt + 8 + 4 * 7, true);
    const unsupported: [string, Uint8Array, RegExp][] = [
      ['version 5', patched(b, s.blobAt, view.getUint32(s.blobAt, true) + 1), /version 5\.0/],
      ['big-endian', patched(b, s.blobAt, view.getUint32(s.blobAt, true) | 0x10000), /blob is big-endian/],
      ['a big-endian payload', patched(b, s.outer.subs[3].data, 0x494d0100), /payload is big-endian/],
      ['a file header of two tables', patched(b, header2, 2), /holds 2 tables/],
    ];
    for (const [what, bytes, message] of unsupported) {
      expect(editMcosSubsystem(bytes, P, [{ savedName: 'Value', cell: seven() }]), what).toMatchObject({ ok: false, reason: 'unsupported', message: expect.stringMatching(message) });
    }
  });

  it('nothing it is handed is changed, refused or not', () => {
    const before = BASIC.subsystem.slice();
    const cell = seven();
    const cellBefore = cell.slice();
    expect(editMcosSubsystem(BASIC.subsystem, P, [{ savedName: 'Value', cell }]).ok).toBe(true);
    expect(editMcosSubsystem(BASIC.subsystem, P, [{ savedName: 'Complexity', cell }]).ok).toBe(false);
    expect(same(BASIC.subsystem, before) && same(cell, cellBefore)).toBe(true);
  });

  it('the first refusal of several edits is the answer', () => {
    const r = editMcosSubsystem(BASIC.subsystem, P, [{ savedName: 'Value', cell: seven() }, { savedName: 'Complexity', cell: seven() }]);
    expect(r).toMatchObject({ ok: false, reason: 'not-a-cell', savedName: 'Complexity' });
  });
});

describe('objectIdOf', () => {
  it("reads element k of a handle, MatParser's or its words", () => {
    const arr = opened('pv_nested.mat').parsed.variables.find((v) => v.name === 'arr')!;
    expect(arr.mcosHandle).toEqual({ dims: [1, 2], ids: [1, 4] });
    expect([objectIdOf(arr.mcosHandle, 0), objectIdOf(arr.mcosHandle, 1), objectIdOf(arr.mcosHandle)]).toEqual([1, 4, 1]);
    expect(objectIdOf([MAGIC, 2, 1, 2, 1, 4, 3], 1)).toBe(4);
  });

  it('is null where the handle names no object', () => {
    expect(objectIdOf({ dims: [1, 2], ids: [1, 4] }, 2)).toBeNull();
    expect(objectIdOf({ dims: [1, 2], ids: [1, 4] }, -1)).toBeNull();
    expect(objectIdOf({ dims: [1, 1], ids: [0] })).toBeNull();
    expect(objectIdOf([5, 2, 1, 1, 1])).toBeNull();
    expect(objectIdOf([MAGIC, 2, 1, 3, 1, 4])).toBeNull();
    expect(objectIdOf(null)).toBeNull();
    expect(objectIdOf(undefined)).toBeNull();
  });
});

describe('valueCellOf', () => {
  it("writes MATLAB's small tag for a payload of 1 to 4 bytes, and never narrows", () => {
    const view = (u8: Uint8Array) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    // [tag 8][flags 16][dims 16][name 8][data…]: the data's tag is at byte 48.
    const double = valueCellOf(variableOf({ className: 'double', dimensions: [1, 1], value: 5 }));
    expect([view(double).getUint32(48, true), view(double).getUint32(52, true)]).toEqual([9, 8]);
    const km = valueCellOf(variableOf({ className: 'char', dimensions: [1, 2], value: 'km' }));
    expect(view(km).getUint32(48, true)).toBe((2 << 16) | 16);
    expect(km.length).toBe(56);
  });

  it('refuses what MatWriter cannot write', () => {
    expect(() => valueCellOf({ ...variableOf({ className: 'Simulink.Parameter', dimensions: [1, 1], value: null }), isOpaque: true })).toThrow(/MCOS opaque/);
  });
});
