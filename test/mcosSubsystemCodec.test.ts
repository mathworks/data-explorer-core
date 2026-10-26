// Copyright 2026 The MathWorks, Inc.
//
// McosSubsystemCodec: a MAT subsystem read whole into records, written back from them, edited by
// appending, and the written bytes held to the records meant.
//
//   - Every subsystem the test tree holds (.mat files, model workspaces in .slx and .mdl, binary
//     dictionaries' hex values): read, written back byte for byte, verified; read as the cell
//     swap's strict reader reads it; every object reference and `string` payload in them
//     encoded again as MATLAB wrote it.
//   - The edits MATLAB R2027a judged (test/fixtures/mcos-codec, cases.json): property triples
//     inserted and removed, `string` variables added and edited, a subsystem created where there
//     was none — the codec's edits write each mutant's subsystem byte for byte, and where the
//     mutant is MATLAB's own save of the edit, MATLAB's.
//   - The edits' rules (append only, the null lists, the per-class cells) and what the reader
//     refuses and the self-check catches: stale offsets, sections cut short, a string table
//     written in another order.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzlibSync } from 'fflate';
import { parseMat, type MatVariable } from '../src/datamodel/parser/MatParser.js';
import { editMcosSubsystem, readMcosSubsystem, objectIdOf, valueCellOf } from '../src/datamodel/parser/McosSubsystemEdit.js';
import {
  addClass,
  addClassSystems,
  addObject,
  addStringObject,
  addValueCell,
  appendCtorList,
  appendDynamicPropsList,
  appendObjectRow,
  appendPvList,
  classNameOf,
  cloneSubsystem,
  createSubsystem,
  descriptorCell,
  findClass,
  insertPvTriple,
  internString,
  internStrings,
  McosValueKind,
  measuredVersion,
  objectReferenceElement,
  propertiesOf,
  readDescriptor,
  readStringPayload,
  readSubsystem,
  removePvTriple,
  replaceValueCell,
  setProperty,
  stringObjectOf,
  stringPayloadCell,
  structFieldNames,
  valueCellUsers,
  verifySubsystem,
  writeSubsystem,
  type McosSubsystemRecords,
} from '../src/datamodel/parser/McosSubsystemCodec.js';
import { MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { fixtureSubsystems, matSubsystemOf } from './tools/mcosFixtureSubsystems.js';

const GOLDEN = fileURLToPath(new URL('./fixtures/mcos-codec/', import.meta.url));
const FOUND = fixtureSubsystems();

const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

// The subsystems MATLAB R2023b or R2024b wrote, or a merge of R2023b's templates made: the template
// merge's fixtures, the 'handle' opaque CoderInfo edits (test/mcosHandleOpaque.test.ts), and the
// older releases' files the creation gate, the struct field rename gate and the rules' parity
// cases start from, whose names say their release.
const byOlderRelease = (where: string): boolean =>
  where.startsWith('fixtures/mcos-templates/') ||
  where.startsWith('fixtures/mcos-handle/') ||
  /^fixtures\/mat-edits-gate\/r2[34]\//.test(where) ||
  where.startsWith('fixtures/string-containers/r2023b/') ||
  where.startsWith('fixtures/edit-bash/r2023b/') ||
  where.startsWith('fixtures/nd-shapes/r2023b/') ||
  where.startsWith('fixtures/mat-enum-members/r2023b/') ||
  where.startsWith('fixtures/mat-param-struct-text/r2023b/') ||
  where.startsWith('fixtures/mat-char/r2023b/') ||
  /^fixtures\/mat-(create-gate|field-rename)\/targets\/[^/]*_r202[34]b\.mat/.test(where) ||
  /^fixtures\/mcos-rules-parity\/originals\/(ci|r)2[34]_/.test(where);

function read(bytes: Uint8Array): McosSubsystemRecords {
  const r = readSubsystem(bytes);
  if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
  return r.subsystem;
}

describe('every subsystem the test tree holds', () => {
  it('is found in each place one is kept', () => {
    // Measured when this was written: 181 subsystems in 150 files — 134 in .mat files (the
    // mat-check copies among them), 38 in binary dictionaries' hex values, 9 model workspaces.
    expect(FOUND.length).toBeGreaterThanOrEqual(181);
    const kinds: Record<string, number> = {};
    for (const f of FOUND) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
    expect(kinds.mat).toBeGreaterThanOrEqual(134);
    expect(kinds.hex).toBeGreaterThanOrEqual(38);
    expect(kinds.workspace).toBeGreaterThanOrEqual(9);
  });

  it('reads whole and writes back byte for byte', () => {
    const wrong = FOUND.flatMap((f) => {
      const r = readSubsystem(f.bytes);
      if (!r.ok) return [`${f.where}: ${r.reason}: ${r.message}`];
      return same(writeSubsystem(r.subsystem), f.bytes) ? [] : [`${f.where}: writes back as other bytes`];
    });
    expect(wrong).toEqual([]);
  });

  it('verifies against its own records, and its copy writes the same bytes', () => {
    for (const f of FOUND) {
      const s = read(f.bytes);
      expect(verifySubsystem(f.bytes, s), f.where).toEqual({ ok: true });
      expect(same(writeSubsystem(cloneSubsystem(s)), f.bytes), f.where).toBe(true);
    }
  });

  it('holds sections no MATLAB-written fixture fills only in their empty form, so their records are read from these', () => {
    // The probe behind cases.json had MATLAB write dynamic properties and a removed-property map
    // from user classes (ft_dyn.mat, ft_ces.mat in test/fixtures/mcos-codec); the per-array map
    // and value pointers it could not make MATLAB write.
    // MATLAB R2023b writes no file header section at all, where R2027a writes one holding an
    // empty per-array map; the R2023b-written subsystems are the template merge's fixtures (and
    // the R2024b-written ones of the CoderInfo edits).
    const all = FOUND.map((f) => ({ where: f.where, b: read(f.bytes).blob }));
    expect(all.every(({ b }) => b.major === 4 && b.minor === 0)).toBe(true);
    expect(all.every(({ b }) => b.valuePointers.length === 0 && (b.fileHeader === null || b.fileHeader.perArray?.length === 0))).toBe(true);
    const headerless = all.filter(({ b }) => b.fileHeader === null);
    expect(headerless.length).toBeGreaterThan(0);
    expect(headerless.filter(({ where }) => !byOlderRelease(where)).map(({ where }) => where)).toEqual([]);
    expect(all.some(({ b }) => b.dynamicProps.length > 0)).toBe(true);
  });

  it('reads the table the cell swap\'s strict reader reads', () => {
    for (const f of FOUND) {
      const s = read(f.bytes);
      const strict = readMcosSubsystem(f.bytes);
      expect(strict.ok, f.where).toBe(true);
      if (!strict.ok) continue;
      const t = strict.subsystem;
      expect(s.blob.strings, f.where).toEqual(t.strings);
      expect(s.blob.classes.map((_, i) => (i === 0 ? '' : classNameOf(s, i))), f.where).toEqual(t.classes.map((c) => c ?? ''));
      expect(s.blob.objects.map((o) => ({ classId: o.classIndex, ctorList: o.ctorList, pvList: o.pvList })), f.where).toEqual(t.objects);
      const triples = (lists: { name: number; flag: number; value: number }[][]) => lists.map((l) => l.map((x) => [x.name, x.flag, x.value]));
      expect(triples(s.blob.pvLists), f.where).toEqual(triples(t.pvLists));
      expect(triples(s.blob.ctorLists), f.where).toEqual(triples(t.ctorLists));
      expect(s.values.length, f.where).toBe(t.valueCells);
      s.values.forEach((cell, k) => expect(same(cell, t.bytes.subarray(t.cells[k + 2].at, t.cells[k + 2].end)), `${f.where} cell ${k}`).toBe(true));
    }
  });
});

describe('the values MATLAB writes into a subsystem, encoded again', () => {
  it('writes every object reference a value cell holds as MATLAB wrote it', () => {
    let n = 0;
    for (const f of FOUND) {
      for (const cell of read(f.bytes).values) {
        const d = readDescriptor(cell);
        if (!d) continue;
        expect(same(descriptorCell(d), cell), f.where).toBe(true);
        n++;
      }
    }
    // Measured when this was written: a nested object's handle in 686 cells of the fixtures
    // the cell swap sweeps, more here with the mat-check copies.
    expect(n).toBeGreaterThanOrEqual(686);
  });

  it("writes every `string` object's payload as MATLAB wrote it", () => {
    let n = 0;
    for (const f of FOUND) {
      const s = read(f.bytes);
      for (let id = 1; id < s.blob.objects.length; id++) {
        if (classNameOf(s, s.blob.objects[id].classIndex) !== 'string') continue;
        const str = stringObjectOf(s, id);
        expect(str, `${f.where} object ${id}`).not.toBeNull();
        expect(same(stringPayloadCell(str!.texts, str!.dims), s.values[str!.valueIndex]), `${f.where} object ${id}`).toBe(true);
        n++;
      }
    }
    expect(n).toBeGreaterThanOrEqual(20);
  });
});

// ---- The edits MATLAB judged --------------------------------------------------------------------

type ValueSpec = { char: string } | { double: number[]; data: number[] };
type Op =
  | ['set', string, string, ValueSpec]
  | ['del', string, string]
  | ['newstr' | 'editstr', string, (string | null)[], number[]];

interface GoldenCase {
  name: string;
  original: string;
  mutant: string;
  matlabSave?: string;
  sameAsMatlabSave?: boolean;
  statements: string[];
  ops: Op[];
}

const CASES: { matlabVersion: string; cases: GoldenCase[] } = JSON.parse(readFileSync(join(GOLDEN, 'cases.json'), 'utf8'));
const golden = (name: string): Uint8Array => new Uint8Array(readFileSync(join(GOLDEN, name)));

const arrayBufferOf = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

/** The object id a MATLAB path names in a .mat: 'p', 's.p', 'c{1}', 'arr(2)'. */
function objectAt(file: Uint8Array, path: string): number {
  const variables = parseMat(arrayBufferOf(file)).variables;
  const [, root, rest] = /^(\w+)(.*)$/.exec(path)!;
  let variable = variables.find((v) => v.name === root)!;
  let index = 0;
  for (const [, field, cell, element] of rest.matchAll(/\.(\w+)|\{(\d+)\}|\((\d+)\)/g)) {
    if (field) variable = variable.fields![field] as MatVariable;
    else if (cell) variable = (variable.value as MatVariable[])[Number(cell) - 1];
    else index = Number(element) - 1;
  }
  const id = objectIdOf(variable.mcosHandle, index);
  if (id === null) throw new Error(`${path} names no object`);
  return id;
}

function cellOf(spec: ValueSpec): Uint8Array {
  const v: MatVariable = 'char' in spec
    ? { name: '', className: 'char', dimensions: [1, spec.char.length], value: spec.char, isComplex: false, isLogical: false, fields: null }
    : { name: '', className: 'double', dimensions: spec.double, value: spec.data.length === 1 ? spec.data[0] : spec.data, isComplex: false, isLogical: false, fields: null };
  return valueCellOf(v);
}

/** A .mat's record named `name`, inflated: the element as written, tag included. */
function recordNamed(file: Uint8Array, name: string): Uint8Array | null {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  for (let at = 128; at + 8 <= file.length; ) {
    const type = view.getUint32(at, true);
    const size = view.getUint32(at + 4, true);
    const element = type === 15 ? unzlibSync(file.subarray(at + 8, at + 8 + size)) : file.subarray(at, at + 8 + size);
    at += type === 15 ? 8 + size : 8 + size + ((8 - (size % 8)) % 8);
    const e = new DataView(element.buffer, element.byteOffset, element.byteLength);
    // flags, then (but for class 17) dims, then the name.
    let p = 24;
    if (element[16] !== 17) p += 8 + e.getUint32(28, true) + ((8 - (e.getUint32(28, true) % 8)) % 8);
    const word = e.getUint32(p, true);
    const [n, at0] = word >>> 16 ? [word >>> 16, p + 4] : [e.getUint32(p + 4, true), p + 8];
    if (Buffer.from(element.subarray(at0, at0 + n)).toString('utf8') === name) return element;
  }
  return null;
}

interface Applied {
  bytes: Uint8Array;
  intended: McosSubsystemRecords;
  // The class-17 element of each new string variable.
  variables: Map<string, Uint8Array>;
}

/** The case's ops applied by the codec's edits to the original's subsystem, and written. */
function applyOps(c: GoldenCase): Applied {
  const file = golden(c.original);
  const original = matSubsystemOf(file);
  const sub = original ? read(original) : createSubsystem();
  const variables = new Map<string, Uint8Array>();
  for (const op of c.ops) {
    if (op[0] === 'set') {
      setProperty(sub, objectAt(file, op[1]), op[2], cellOf(op[3]));
    } else if (op[0] === 'del') {
      expect(removePvTriple(sub, objectAt(file, op[1]), op[2]), `${c.name} ${op[1]}.${op[2]}`).not.toBeNull();
    } else if (op[0] === 'newstr') {
      // The probe's writer used the file's string class row where there is one, as MATLAB's own
      // full save does; a new one otherwise.
      const existing = findClass(sub, 'string');
      const s = addStringObject(sub, op[2], op[3], existing || undefined);
      variables.set(op[1], objectReferenceElement(op[1], 'string', { dims: [1, 1], ids: [s.objectId], classIndex: s.classIndex }));
    } else {
      const str = stringObjectOf(sub, objectAt(file, op[1]));
      expect(str, `${c.name} ${op[1]}`).not.toBeNull();
      replaceValueCell(sub, str!.valueIndex, stringPayloadCell(op[2], op[3]));
    }
  }
  return { bytes: writeSubsystem(sub), intended: sub, variables };
}

describe('the edits MATLAB R2027a judged', () => {
  it('are the probe this suite is held to', () => {
    expect(CASES.matlabVersion).toMatch(/R2027a/);
    expect(CASES.cases.length).toBe(26);
    // Every claim to be MATLAB's own save is held to the save, kept beside it.
    expect(CASES.cases.filter((c) => c.sameAsMatlabSave && !c.matlabSave).map((c) => c.name)).toEqual([]);
    const ops = new Set(CASES.cases.flatMap((c) => c.ops.map((o) => o[0])));
    expect([...ops].sort()).toEqual(['del', 'editstr', 'newstr', 'set']);
  });

  for (const c of CASES.cases) {
    describe(`${c.name}: ${c.statements.join(' ')}`, () => {
      const applied = applyOps(c);
      const mutant = golden(c.mutant);

      it('writes the subsystem MATLAB loaded as its own edit, byte for byte', () => {
        expect(same(applied.bytes, matSubsystemOf(mutant)!)).toBe(true);
      });

      it('and it reads back as the records meant', () => {
        expect(verifySubsystem(applied.bytes, applied.intended)).toEqual({ ok: true });
      });

      if (c.matlabSave) {
        it("which is MATLAB's own save of the edit", () => {
          expect(c.sameAsMatlabSave).toBe(true);
          expect(same(applied.bytes, matSubsystemOf(golden(c.matlabSave!))!)).toBe(true);
        });
      }

      for (const [name, element] of applied.variables) {
        it(`writes ${name}'s class-17 element as the mutant holds it${c.matlabSave ? ", and as MATLAB's own save does" : ''}`, () => {
          expect(same(element, recordNamed(mutant, name)!)).toBe(true);
          if (c.matlabSave) expect(same(element, recordNamed(golden(c.matlabSave), name)!)).toBe(true);
        });
      }
    });
  }

  it('leaves the removed property\'s cell in place, named by nothing', () => {
    const c = CASES.cases.find((x) => x.name === 'b_two')!;
    const before = read(matSubsystemOf(golden(c.original))!);
    const { intended } = applyOps(c);
    expect(intended.values.length).toBe(before.values.length);
    const id = objectAt(golden(c.original), 't');
    const gone = propertiesOf(before, id).filter((p) => p.savedName === 'Description' || p.savedName === 'Min');
    expect(gone.map((p) => p.flag)).toEqual([McosValueKind.cell, McosValueKind.cell]);
    for (const p of gone) expect(valueCellUsers(intended, p.value)).toBe(0);
  });

  it('gives a file whose objects all saved property lists the null constructor-argument list first', () => {
    // fx_configset_str: the rule the probe found live — a first list written as list 0 made
    // MATLAB fail to load the string.
    const c = CASES.cases.find((x) => x.name === 'fx_configset_str')!;
    expect(read(matSubsystemOf(golden(c.original))!).blob.ctorLists).toEqual([]);
    const { intended } = applyOps(c);
    expect(intended.blob.ctorLists.length).toBe(2);
    expect(intended.blob.ctorLists[0]).toEqual([]);
    expect(intended.blob.objects[intended.blob.objects.length - 1].ctorList).toBe(1);
  });
});

// ---- The edits' rules ---------------------------------------------------------------------------

const D_MULTI = golden('d_multi.mat');
const multi = (): McosSubsystemRecords => read(matSubsystemOf(D_MULTI)!);
const double = (x: number): Uint8Array => valueCellOf({ name: '', className: 'double', dimensions: [1, 1], value: x, isComplex: false, isLogical: false, fields: null });

function writesAndVerifies(s: McosSubsystemRecords): Uint8Array {
  const bytes = writeSubsystem(s);
  expect(verifySubsystem(bytes, s)).toEqual({ ok: true });
  return bytes;
}

describe('the edits', () => {
  it('intern a string once, a new one last, and the empty string as index 0', () => {
    const s = multi();
    const n = s.blob.strings.length;
    expect(internString(s, 'Value')).toBe(s.blob.strings.indexOf('Value'));
    expect(internString(s, 'NotYetThere')).toBe(n);
    expect(internString(s, 'NotYetThere')).toBe(n);
    expect(internStrings(s, ['Value', 'Other', 'NotYetThere'])).toEqual([s.blob.strings.indexOf('Value'), n + 1, n]);
    expect(internString(s, '')).toBe(0);
    expect(() => internString(s, 'a\0b')).toThrow(MatWriteError);
    expect(s.blob.strings.length).toBe(n + 2);
    writesAndVerifies(s);
  });

  it('add a class row fresh, with an entry in every per-class cell, its name interned before its namespace', () => {
    const s = multi();
    const rows = s.blob.classes.length;
    const first = findClass(s, 'Simulink.Parameter');
    expect(first).toBeGreaterThan(0);
    expect(addClass(s, { name: 'Simulink.Parameter' })).toBe(rows);
    expect(findClass(s, 'Simulink.Parameter')).toBe(first);
    const n = s.blob.strings.length;
    const ci = addClass(s, { name: 'pkg.inner.Fresh', version: [1, 2, 0, 0], alias: 'pkg.inner.Renamed' });
    expect(s.blob.strings.slice(n)).toEqual(['Fresh', 'pkg.inner', 'pkg.inner.Renamed']);
    expect(classNameOf(s, ci)).toBe('pkg.inner.Fresh');
    expect(s.blob.classes[ci].version).toEqual([1, 2, 0, 0]);
    for (const cell of [s.classData!, s.aliases!, s.defaults!]) expect(cell.entries.length).toBe(rows + 2);
    expect(s.aliases!.entries[ci]).toBe(n + 2);
    expect(structFieldNames(s.defaults!.entries[ci])).toEqual([]);
    expect(s.packages).toBeNull();
    expect(() => addClass(s, { name: 'x.Y', packageName: 'x' })).toThrow(MatWriteError);
    writesAndVerifies(s);
  });

  it("intern a defaults struct's field names after the class's own strings", () => {
    const s = multi();
    const defaults = s.defaults!.entries.find((e) => (structFieldNames(e) ?? []).length > 0)!;
    const fields = structFieldNames(defaults)!;
    const t = createSubsystem();
    addClass(t, { name: 'ns.Cls', defaults });
    expect(t.blob.strings).toEqual(['', 'Cls', 'ns', ...new Set(fields)]);
    writesAndVerifies(t);
  });

  it('add objects with the null lists a subsystem lacks, and a dynamic-property list of its own to each saved by properties', () => {
    const s = createSubsystem();
    expect(s.blob.ctorLists).toEqual([]);
    expect(s.blob.pvLists).toEqual([[]]);
    expect(s.blob.dynamicProps).toEqual([]);
    const ci = addClass(s, { name: 'ns.Cls' });
    const value = internString(s, 'Value');
    const k = addValueCell(s, double(3));
    const a = addObject(s, { classIndex: ci, pv: [{ name: value, flag: McosValueKind.cell, value: k }] });
    expect(s.blob.objects[a]).toEqual({ classIndex: ci, child: 0, sibling: 0, ctorList: 0, pvList: 1, dynamicProps: 1 });
    expect(s.blob.dynamicProps).toEqual([[], []]);
    expect(s.blob.ctorLists).toEqual([]);
    const b = addObject(s, { classIndex: ci, pv: [], dynamicProps: [a] });
    expect(s.blob.objects[b]).toMatchObject({ pvList: 2, dynamicProps: 2 });
    expect(s.blob.dynamicProps[2]).toEqual([a]);
    const c = addObject(s, { classIndex: ci, ctor: [{ name: internString(s, 'any'), flag: McosValueKind.cell, value: k }] });
    expect(s.blob.ctorLists.length).toBe(2);
    expect(s.blob.objects[c]).toMatchObject({ ctorList: 1, pvList: 0, dynamicProps: 0 });
    expect(() => addObject(s, { classIndex: 0 })).toThrow(MatWriteError);
    expect(() => addObject(s, { classIndex: ci + 1 })).toThrow(MatWriteError);
    expect(() => addObject(s, { classIndex: ci, ctor: [], dynamicProps: [] })).toThrow(MatWriteError);
    writesAndVerifies(s);
  });

  it('hand out an id before the objects it holds, as MATLAB numbers them, and refuse a row left unfilled', () => {
    const s = createSubsystem();
    const ci = addClass(s, { name: 'ns.Parent' });
    const parent = appendObjectRow(s);
    const list = appendPvList(s);
    const child = addObject(s, { classIndex: addClass(s, { name: 'ns.Child' }), pv: [] });
    const holds = addValueCell(s, descriptorCell({ dims: [1, 1], ids: [child], classIndex: s.blob.objects[child].classIndex }));
    s.blob.pvLists[list].push({ name: internString(s, 'Kid'), flag: McosValueKind.cell, value: holds });
    const unfilled = writeSubsystem(s);
    expect(verifySubsystem(unfilled, s)).toMatchObject({ ok: false, reason: 'refused' });
    Object.assign(s.blob.objects[parent], { classIndex: ci, pvList: list, dynamicProps: appendDynamicPropsList(s) });
    expect([parent, child]).toEqual([1, 2]);
    expect(s.blob.dynamicProps).toEqual([[], [], []]);
    expect(appendCtorList(s)).toBe(1);
    writesAndVerifies(s);
  });

  it('insert a triple where asked, and refuse one the list holds, a list shared, an object saved as one payload', () => {
    const s = multi();
    const id = objectAt(D_MULTI, 'a');
    const before = propertiesOf(s, id);
    const name = internString(s, 'Unlisted');
    const k = addValueCell(s, double(1));
    expect(insertPvTriple(s, id, { name, flag: McosValueKind.cell, value: k }, 1)).toBe(1);
    expect(propertiesOf(s, id).map((p) => p.savedName)).toEqual([before[0].savedName, 'Unlisted', ...before.slice(1).map((p) => p.savedName)]);
    expect(() => insertPvTriple(s, id, { name, flag: McosValueKind.cell, value: k })).toThrow(/already/);
    expect(() => insertPvTriple(s, id, { name: internString(s, 'Other'), flag: 1, value: k }, 99)).toThrow(MatWriteError);
    writesAndVerifies(s);

    const shared = multi();
    const other = objectAt(D_MULTI, 'b');
    shared.blob.objects[other].pvList = shared.blob.objects[id].pvList;
    expect(() => insertPvTriple(shared, id, { name, flag: 1, value: 0 })).toThrow(/another object/);
    expect(() => removePvTriple(shared, id, 'Value')).toThrow(/another object/);

    const strs = read(matSubsystemOf(golden('s_objs.mat'))!);
    const str = objectAt(golden('s_objs.mat'), 'str0');
    expect(() => insertPvTriple(strs, str, { name: 1, flag: 1, value: 0 })).toThrow(/one payload/);
    expect(propertiesOf(strs, str)).toEqual([]);
  });

  it('remove a triple and keep its cell, and say so when there is none', () => {
    const s = multi();
    const id = objectAt(D_MULTI, 'b');
    const cells = s.values.length;
    const t = removePvTriple(s, id, 'Description');
    expect(t && t.flag).toBe(McosValueKind.cell);
    expect(s.values.length).toBe(cells);
    expect(valueCellUsers(s, t!.value)).toBe(0);
    expect(removePvTriple(s, id, 'Description')).toBeNull();
    writesAndVerifies(s);
  });

  it('set a property by swapping its cell, re-typing its triple in place, or inserting one', () => {
    const s = multi();
    const id = objectAt(D_MULTI, 'a');
    const props = propertiesOf(s, id);
    const stored = props.find((p) => p.flag === McosValueKind.cell)!;
    const word = props.find((p) => p.flag === McosValueKind.string)!;
    const cells = s.values.length;
    expect(setProperty(s, id, stored.savedName, double(42))).toEqual({ op: 'swap', valueIndex: stored.value, position: props.indexOf(stored) });
    expect(same(s.values[stored.value], double(42))).toBe(true);
    expect(s.values.length).toBe(cells);
    expect(setProperty(s, id, word.savedName, double(1))).toEqual({ op: 'retype', valueIndex: cells, position: props.indexOf(word) });
    expect(setProperty(s, id, 'Brand_New', double(2))).toEqual({ op: 'insert', valueIndex: cells + 1, position: props.length });
    expect(propertiesOf(s, id).map((p) => p.savedName)).toEqual([...props.map((p) => p.savedName), 'Brand_New']);
    writesAndVerifies(s);

    const shared = multi();
    shared.blob.pvLists[shared.blob.objects[objectAt(D_MULTI, 'b')].pvList].push({ name: 0, flag: McosValueKind.cell, value: stored.value });
    expect(() => setProperty(shared, id, stored.savedName, double(1))).toThrow(/another triple/);
    expect(() => setProperty(s, id, 'Brand_New', new Uint8Array(8))).toThrow(MatWriteError);
    expect(() => setProperty(s, id, 'Other', double(1), -1)).toThrow(MatWriteError);
    expect(propertiesOf(s, id).some((p) => p.savedName === 'Other')).toBe(false);
  });

  it('append and replace value cells, each one whole element', () => {
    const s = multi();
    const k = addValueCell(s, double(1));
    expect(k).toBe(s.values.length - 1);
    replaceValueCell(s, k, double(2));
    expect(same(s.values[k], double(2))).toBe(true);
    expect(addValueCell(s, Uint8Array.of(14, 0, 0, 0, 0, 0, 0, 0))).toBe(k + 1);
    expect(() => addValueCell(s, double(1).subarray(0, 24))).toThrow(MatWriteError);
    expect(() => replaceValueCell(s, s.values.length, double(1))).toThrow(MatWriteError);
    writesAndVerifies(s);
  });

  it('copy a subsystem so that an edit of the copy leaves it as it was', () => {
    const s = multi();
    const bytes = writeSubsystem(s);
    const copy = cloneSubsystem(s);
    addStringObject(copy, ['x'], [1, 1]);
    setProperty(copy, objectAt(D_MULTI, 'a'), 'Fresh', double(1));
    expect(same(writeSubsystem(s), bytes)).toBe(true);
    expect(same(writeSubsystem(copy), bytes)).toBe(false);
  });
});

describe('object references and string payloads', () => {
  it('encode an object reference and read it back, and refuse ids its dims do not say', () => {
    for (const d of [{ dims: [1, 1], ids: [3], classIndex: 2 }, { dims: [2, 3], ids: [1, 2, 3, 4, 5, 6], classIndex: 1 }, { dims: [1, 2], ids: [0, 4], classIndex: null }]) {
      expect(readDescriptor(descriptorCell(d))).toEqual(d);
      expect(readDescriptor(objectReferenceElement('v', 'ns.Cls', d))).toEqual(d);
    }
    expect(() => descriptorCell({ dims: [1, 2], ids: [1], classIndex: 1 })).toThrow(MatWriteError);
    expect(readDescriptor(double(1))).toBeNull();
  });

  it('encode string arrays MATLAB writes — empty, missing, non-ASCII, a column, none — and read them back', () => {
    for (const [texts, dims] of [[[''], [1, 1]], [['x', null, 'z'], [1, 3]], [['héllo ✓ 😀'], [1, 1]], [['p', 'q'], [2, 1]], [[], [0, 0]], [[null], [1, 1]]] as [(string | null)[], number[]][]) {
      expect(readStringPayload(stringPayloadCell(texts, dims))).toEqual({ dims, texts });
    }
    expect(() => stringPayloadCell(['a'], [1, 2])).toThrow(MatWriteError);
    expect(readStringPayload(double(1))).toBeNull();
  });

  it("add a string object as one constructor argument of type 'any', interned before the class", () => {
    const s = createSubsystem();
    const r = addStringObject(s, ['one'], [1, 1]);
    expect(s.blob.strings).toEqual(['', 'any', 'string']);
    expect(r).toEqual({ objectId: 1, classIndex: 1, valueIndex: 0 });
    expect(s.blob.ctorLists).toEqual([[], [{ name: 1, flag: McosValueKind.cell, value: 0 }]]);
    expect(s.blob.objects[1]).toEqual({ classIndex: 1, child: 0, sibling: 0, ctorList: 1, pvList: 0, dynamicProps: 0 });
    expect(stringObjectOf(s, 1)).toEqual({ valueIndex: 0, dims: [1, 1], texts: ['one'] });
    const again = addStringObject(s, ['two'], [1, 1], r.classIndex);
    expect(again.classIndex).toBe(r.classIndex);
    expect(() => addStringObject(s, ['x'], [1, 1], 0)).toThrow(MatWriteError);
    writesAndVerifies(s);
  });
});

describe('a subsystem from nothing', () => {
  it("is MATLAB R2027a's shape: null records only, which reads back as itself", () => {
    const s = createSubsystem();
    const bytes = writesAndVerifies(s);
    const back = read(bytes);
    expect(back.blob.objects.length).toBe(1);
    expect(back.blob.classes.length).toBe(1);
    expect(back.values).toEqual([]);
    // The stream's own uint8 [1 88] element: its tag, flags, dims, name and data tag, then 88 bytes.
    expect(back.rest.length).toBe(56 + 88);
  });

  it("in another subsystem's shape is the same, for every subsystem MATLAB R2027a wrote into a .mat", () => {
    // Every .mat subsystem but those an older release wrote or a merge of R2023b's templates made
    // (the next test).
    const empty = writeSubsystem(createSubsystem());
    const mats = FOUND.filter((f) => f.kind === 'mat' && !byOlderRelease(f.where));
    const other = mats.filter((f) => !same(writeSubsystem(createSubsystem(read(f.bytes))), empty));
    expect(other.map((f) => f.where)).toEqual([]);
  });

  it("in the shape of the template merge's fixtures is R2027a's or R2023b's, each with or without 'handle' objects", () => {
    // R2023b writes no file header, and a stream that holds a 'handle' opaque says so; a merge
    // keeps the file's header and adds 'handle' where it brings one.
    const shape = (header: boolean, handle: boolean): Uint8Array => {
      const s = createSubsystem();
      if (!header) s.blob.fileHeader = null;
      if (handle) addClassSystems(s, ['handle']);
      return writeSubsystem(s);
    };
    const shapes = [shape(true, false), shape(true, true), shape(false, false), shape(false, true)];
    const mats = FOUND.filter((f) => f.kind === 'mat' && f.where.startsWith('fixtures/mcos-templates/'));
    expect(mats.length).toBeGreaterThanOrEqual(94);
    const seen = mats.map((f) => shapes.findIndex((x) => same(writeSubsystem(createSubsystem(read(f.bytes))), x)));
    expect(seen.filter((i) => i < 0)).toEqual([]);
    expect(new Set(seen).size).toBe(4);
  });
});

// ---- What is refused, and what the self-check catches -------------------------------------------

const D_PARAM = golden('d_param.mat');

/** Where byte 0 of a subsystem's metadata blob is (the cell swap's reader says). */
function blobAt(bytes: Uint8Array): number {
  const r = readMcosSubsystem(bytes);
  if (!r.ok) throw new Error(r.message);
  return r.subsystem.blobAt;
}

/** `edit` applied to d_param's subsystem and written, with the blob's eight offsets put back as they were. */
function staleOffsets(edit: (s: McosSubsystemRecords) => void): { bytes: Uint8Array; intended: McosSubsystemRecords } {
  const original = matSubsystemOf(D_PARAM)!;
  const s = read(original);
  edit(s);
  const bytes = writeSubsystem(s).slice();
  const at = blobAt(bytes);
  const was = original.subarray(blobAt(original) + 8, blobAt(original) + 40);
  expect(same(bytes.subarray(at + 8, at + 40), was)).toBe(false);
  bytes.set(was, at + 8);
  return { bytes, intended: s };
}

function refusal(bytes: Uint8Array): { reason: string; message: string } {
  const r = readSubsystem(bytes);
  return r.ok ? { reason: 'accepted', message: '' } : { reason: r.reason, message: r.message };
}

describe('what the reader refuses, and the self-check catches', () => {
  // The probe's three stale-offset controls: MATLAB R2027a loaded the first two equal to its own
  // edit, with the lists past the change misassigned; the third failed to load.
  it('refuses offsets left stale by a property list that grew', () => {
    const { bytes, intended } = staleOffsets((s) => setProperty(s, objectAt(D_PARAM, 'p'), 'Description', valueCellOf({ name: '', className: 'char', dimensions: [1, 13], value: 'a description', isComplex: false, isLogical: false, fields: null })));
    expect(refusal(bytes)).toMatchObject({ reason: 'malformed' });
    expect(verifySubsystem(bytes, intended)).toMatchObject({ ok: false, reason: 'refused' });
  });

  it('refuses offsets left stale by a property list that shrank', () => {
    const original = read(matSubsystemOf(D_PARAM)!);
    const id = objectAt(D_PARAM, 'p');
    const name = propertiesOf(original, id)[0].savedName;
    const { bytes, intended } = staleOffsets((s) => removePvTriple(s, id, name));
    expect(refusal(bytes)).toMatchObject({ reason: 'malformed' });
    expect(verifySubsystem(bytes, intended)).toMatchObject({ ok: false, reason: 'refused' });
  });

  it('refuses offsets left stale by a new class and object', () => {
    const { bytes, intended } = staleOffsets((s) => addStringObject(s, ['new'], [1, 1]));
    expect(refusal(bytes)).toMatchObject({ reason: 'malformed' });
    expect(verifySubsystem(bytes, intended)).toMatchObject({ ok: false, reason: 'refused' });
  });

  it('refuses a section cut short: a list, the string table, an offset into a section, the element', () => {
    const original = matSubsystemOf(D_PARAM)!;
    const s = read(original);
    const at = blobAt(original);
    const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
    const offsets = (b: Uint8Array) => Array.from({ length: 8 }, (_, i) => view(b).getUint32(at + 8 + 4 * i, true));
    const patched = (f: (b: Uint8Array) => void) => {
      const b = original.slice();
      f(b);
      return refusal(b);
    };
    // The last property list claims a triple more than its section holds.
    const lastList = s.blob.pvLists.length - 1;
    let listAt = offsets(original)[3];
    for (let i = 0; i < lastList; i++) listAt += 8 * Math.ceil((4 + 12 * s.blob.pvLists[i].length) / 8);
    expect(patched((b) => view(b).setUint32(at + listAt, s.blob.pvLists[lastList].length + 1, true))).toMatchObject({ reason: 'malformed', message: expect.stringMatching(/runs past/) });
    // More strings than the table holds. (One or two more read as empty strings in its zero
    // padding, which is what such a table would say, and write back as the same bytes; eight
    // more cannot fit in padding of at most seven.)
    expect(patched((b) => view(b).setUint32(at + 4, s.blob.strings.length + 7, true))).toMatchObject({ reason: 'malformed', message: expect.stringMatching(/string table/) });
    // The object table said to start a row late.
    expect(patched((b) => view(b).setUint32(at + 16, offsets(original)[2] + 8, true))).toMatchObject({ reason: 'malformed' });
    // The element short of its last 8 bytes.
    expect(refusal(original.subarray(0, original.length - 8))).toMatchObject({ reason: 'malformed' });
  });

  it('reads a string table written in another order, which only the self-check catches', () => {
    const s = read(matSubsystemOf(D_PARAM)!);
    setProperty(s, objectAt(D_PARAM, 'p'), 'Max', double(10));
    const reordered = cloneSubsystem(s);
    const t = reordered.blob.strings;
    [t[1], t[2]] = [t[2], t[1]];
    const bytes = writeSubsystem(reordered);
    // Nothing in the bytes says the order is wrong: every name lands, on the wrong string.
    expect(readSubsystem(bytes).ok).toBe(true);
    expect(verifySubsystem(bytes, s)).toEqual({ ok: false, reason: 'differs', message: expect.stringContaining('blob.strings[1]') });
  });

  it('catches a record other than meant: a triple, a value cell, a per-class entry', () => {
    const s = read(matSubsystemOf(D_PARAM)!);
    const bytes = writeSubsystem(s);
    const triple = cloneSubsystem(s);
    triple.blob.pvLists[1][0].value ^= 1;
    expect(verifySubsystem(bytes, triple)).toMatchObject({ ok: false, reason: 'differs', message: expect.stringContaining('blob.pvLists[1][0]') });
    const cell = cloneSubsystem(s);
    cell.values[0] = double(123);
    expect(verifySubsystem(bytes, cell)).toMatchObject({ ok: false, reason: 'differs', message: expect.stringContaining('values[0]') });
    const alias = cloneSubsystem(s);
    alias.aliases!.entries[1] = 1;
    expect(verifySubsystem(bytes, alias)).toMatchObject({ ok: false, reason: 'differs', message: expect.stringContaining('aliases.entries[1]') });
  });

  it('refuses a record that names what is not there', () => {
    const s = read(matSubsystemOf(D_PARAM)!);
    const cases: [string, (x: McosSubsystemRecords) => void][] = [
      ['a value cell', (x) => x.blob.pvLists[1].push({ name: 1, flag: McosValueKind.cell, value: x.values.length })],
      ['a string', (x) => x.blob.pvLists[1].push({ name: x.blob.strings.length, flag: McosValueKind.integer, value: 0 })],
      ['an object', (x) => x.blob.pvLists[1].push({ name: 1, flag: McosValueKind.object, value: x.blob.objects.length })],
      ['a class row', (x) => (x.blob.objects[1].classIndex = x.blob.classes.length)],
      ['a property list', (x) => (x.blob.objects[1].pvList = x.blob.pvLists.length)],
      ['a value kind', (x) => x.blob.pvLists[1].push({ name: 1, flag: 4, value: 0 })],
    ];
    for (const [what, f] of cases) {
      const x = cloneSubsystem(s);
      f(x);
      const bytes = writeSubsystem(x);
      expect(refusal(bytes).reason, what).toBe('malformed');
      expect(verifySubsystem(bytes, x), what).toMatchObject({ ok: false, reason: 'refused' });
    }
  });

  it('refuses a blob version and a byte order it was not measured on', () => {
    const original = matSubsystemOf(D_PARAM)!;
    const at = blobAt(original);
    for (const [byte, value] of [[0, 3], [0, 6], [1, 1], [2, 1]]) {
      const b = original.slice();
      b[at + byte] = value;
      expect(refusal(b).reason, `byte ${byte} = ${value}`).toBe('unsupported');
    }
  });

  it('refuses what it would write back as other bytes', () => {
    const original = matSubsystemOf(D_PARAM)!;
    const at = blobAt(original);
    const classesAt = new DataView(original.buffer, original.byteOffset).getUint32(at + 8, true);
    const unused = original.slice();
    unused[at + classesAt + 12] = 1;
    expect(refusal(unused)).toMatchObject({ reason: 'not-canonical' });
  });

  it('writes no records no subsystem can say', () => {
    const s = read(matSubsystemOf(D_PARAM)!);
    const extra = cloneSubsystem(s);
    extra.defaults!.entries.push(extra.defaults!.entries[0]);
    expect(() => writeSubsystem(extra)).toThrow(/defaults cell holds/);
    const nul = cloneSubsystem(s);
    nul.blob.strings.push('a\0b');
    expect(() => writeSubsystem(nul)).toThrow(MatWriteError);
    const version = cloneSubsystem(s);
    version.blob.major = 5;
    expect(() => writeSubsystem(version)).toThrow(/per-class cells/);
    const negative = cloneSubsystem(s);
    negative.blob.pvLists[1][0].value = -1;
    expect(() => writeSubsystem(negative)).toThrow(MatWriteError);
  });
});

// ---- The null records, the self-check against the subsystem as read, the measured version -------

const NULL_OBJECT = { classIndex: 0, child: 0, sibling: 0, ctorList: 0, pvList: 0, dynamicProps: 0 };

describe('a subsystem whose object table is empty', () => {
  const hex0 = FOUND.find((f) => f.where === 'fixtures/display/dispcat_bin.sldd::data/chunk0.xml hex 0')!;

  it("is one MATLAB writes: a dictionary's enumeration value, and a .mat holding only a value of an enumeration class with no superclass", () => {
    expect(read(hex0.bytes).blob.objects).toEqual([]);
    const s = read(matSubsystemOf(golden('s_enum_only.mat'))!);
    expect(s.blob.objects).toEqual([]);
    expect(s.blob.pvLists).toEqual([]);
    expect(s.blob.classes.length).toBe(2);
  });

  it('gives its first object id 1, after the null object and the null property list', () => {
    // Measured against MATLAB R2027a: a `string` written there as object 0, with no null object
    // before it, made MATLAB's load fail with a segmentation violation; written after them, it
    // loads as the string (str_enum_only, which is MATLAB's own save byte for byte).
    const s = read(hex0.bytes);
    const original = cloneSubsystem(s);
    expect(addStringObject(s, ['new'], [1, 1])).toMatchObject({ objectId: 1 });
    expect(s.blob.objects[0]).toEqual(NULL_OBJECT);
    expect(s.blob.pvLists).toEqual([[]]);
    expect(s.blob.ctorLists[0]).toEqual([]);
    expect(verifySubsystem(writeSubsystem(s), s, original)).toEqual({ ok: true });
    expect(addObject(read(hex0.bytes), { classIndex: 1, pv: [] })).toBe(1);
    expect(appendObjectRow(read(hex0.bytes))).toBe(1);
  });

  it('and a class table with no row gets the null class first, with its per-class entries', () => {
    const s = createSubsystem();
    s.blob.classes = [];
    s.classData!.entries = [];
    s.aliases!.entries = [];
    s.defaults!.entries = [];
    expect(addClass(s, { name: 'ns.Cls' })).toBe(1);
    expect(s.blob.classes[0]).toEqual({ namespace: 0, name: 0, version: [0, 0, 0, 0] });
    expect([s.classData!.entries.length, s.aliases!.entries, s.defaults!.entries.length]).toEqual([2, [0, 0], 2]);
    writesAndVerifies(s);
  });

  it('refuses a null object or a null class row that is not all zeros', () => {
    const original = matSubsystemOf(D_PARAM)!;
    const at = blobAt(original);
    const view = new DataView(original.buffer, original.byteOffset, original.byteLength);
    const [classesAt, , objectsAt] = [0, 1, 2].map((i) => view.getUint32(at + 8 + 4 * i, true));
    for (const [where, what] of [[classesAt + 4, 'null class'], [objectsAt, 'null object'], [objectsAt + 16, 'null object']] as [number, string][]) {
      const b = original.slice();
      b[at + where] = 1;
      expect(refusal(b), what).toMatchObject({ reason: 'malformed', message: expect.stringContaining(what) });
    }
  });
});

describe('the self-check against the subsystem as read', () => {
  const edited = (f: (s: McosSubsystemRecords) => void): { s: McosSubsystemRecords; original: McosSubsystemRecords } => {
    const s = read(matSubsystemOf(D_MULTI)!);
    const original = cloneSubsystem(s);
    f(s);
    return { s, original };
  };
  const verdict = (x: { s: McosSubsystemRecords; original: McosSubsystemRecords }) => verifySubsystem(writeSubsystem(x.s), x.s, x.original);

  it('passes edits that only append, an object row handed out before and filled after', () => {
    const x = edited((s) => {
      addStringObject(s, ['a'], [1, 1]);
      setProperty(s, objectAt(D_MULTI, 'a'), 'Fresh', double(1));
      removePvTriple(s, objectAt(D_MULTI, 'b'), 'Description');
    });
    expect(verdict(x)).toEqual({ ok: true });
    const s = read(matSubsystemOf(D_MULTI)!);
    const id = appendObjectRow(s);
    const original = cloneSubsystem(s);
    Object.assign(s.blob.objects[id], { classIndex: 1, pvList: appendPvList(s), dynamicProps: appendDynamicPropsList(s) });
    expect(verifySubsystem(writeSubsystem(s), s, original)).toEqual({ ok: true });
  });

  it('catches what reads back as meant and renumbers: a string moved, a row spliced in, an entry replaced, a cell dropped', () => {
    // Each reads back as the records meant; only the subsystem as read says they renumbered.
    const cases: [string, (s: McosSubsystemRecords) => void, string][] = [
      ['strings', (s) => { const t = s.blob.strings; [t[1], t[2]] = [t[2], t[1]]; }, 'strings 1'],
      ['class rows', (s) => (s.blob.classes[1] = { ...s.blob.classes[1], name: s.blob.classes[2].name }), 'class rows 1'],
      ['defaults', (s) => (s.defaults!.entries[1] = s.defaults!.entries[2]), 'defaults entries 1'],
    ];
    for (const [what, f, message] of cases) {
      const x = edited(f);
      expect(verifySubsystem(writeSubsystem(x.s), x.s), what).toMatchObject({ ok: true });
      expect(verdict(x), what).toMatchObject({ ok: false, reason: 'broken', message: expect.stringContaining(message) });
    }
    // An object row spliced in moves every later one under the references that name them.
    expect(verdict(edited((s) => s.blob.objects.splice(1, 0, { ...s.blob.objects[1] })))).toMatchObject({ ok: false, reason: 'broken', message: expect.stringContaining('object') });
    // A value cell nothing names, dropped: every reference still lands.
    const s = read(matSubsystemOf(D_MULTI)!);
    addValueCell(s, double(1));
    const original = cloneSubsystem(s);
    s.values.pop();
    expect(verifySubsystem(writeSubsystem(s), s)).toEqual({ ok: true });
    expect(verifySubsystem(writeSubsystem(s), s, original)).toMatchObject({ ok: false, reason: 'broken', message: expect.stringContaining('value cells') });
  });

  it('catches an object reference naming an object past the table, or one object of another class row', () => {
    const past = edited((s) => addValueCell(s, descriptorCell({ dims: [1, 1], ids: [99], classIndex: 1 })));
    expect(verifySubsystem(writeSubsystem(past.s), past.s)).toMatchObject({ ok: false, reason: 'broken', message: expect.stringContaining('object 99') });
    const other = edited((s) => addValueCell(s, descriptorCell({ dims: [1, 1], ids: [1], classIndex: s.blob.objects[1].classIndex + 1 })));
    expect(verdict(other)).toMatchObject({ ok: false, reason: 'broken', message: expect.stringContaining('as one of class row') });
  });

  it("passes an array's reference naming its objects' common superclass, as MATLAB writes a ConfigSet's components", () => {
    const configset = matSubsystemOf(new Uint8Array(readFileSync(join(GOLDEN, '../mcos/configset.mat'))))!;
    const s = read(configset);
    const mixed = s.values.map(readDescriptor).filter((d) => d && d.ids.some((id) => id && s.blob.objects[id].classIndex !== d.classIndex));
    expect(mixed.length).toBeGreaterThan(0);
    expect(verifySubsystem(configset, s, cloneSubsystem(s))).toEqual({ ok: true });
  });

  it('refuses every byte of a written subsystem changed, two ways each', () => {
    const bytes = matSubsystemOf(D_PARAM)!;
    const s = read(bytes);
    let accepted = 0;
    for (let i = 0; i < bytes.length; i++) {
      for (const flip of [0x01, 0x80]) {
        const b = bytes.slice();
        b[i] ^= flip;
        if (verifySubsystem(b, s, s).ok) accepted++;
      }
    }
    expect(accepted).toBe(0);
  });
});

describe('a version-5.0 subsystem', () => {
  // None MATLAB wrote was ever seen: this one is a 4.0 fixture given the package-name cell a 5.0
  // blob is documented to hold, one uint32 per class row.
  const v5 = (): Uint8Array => {
    const s = read(matSubsystemOf(D_PARAM)!);
    s.blob.major = 5;
    s.packages = { flags: Uint8Array.of(6, 0, 0, 0, 8, 0, 0, 0, 13, 0, 0, 0, 0, 0, 0, 0), name: s.aliases!.name, entries: s.blob.classes.map(() => 0) };
    return writeSubsystem(s);
  };

  it('is read, and written back as read, for display', () => {
    const bytes = v5();
    const s = read(bytes);
    expect([s.blob.major, s.packages?.entries.length]).toEqual([5, s.blob.classes.length]);
    expect(same(writeSubsystem(s), bytes)).toBe(true);
    expect(verifySubsystem(bytes, s, s)).toEqual({ ok: true });
    expect(measuredVersion(s)).toBe(false);
    expect(measuredVersion(read(matSubsystemOf(D_PARAM)!))).toBe(true);
  });

  it('takes no edit, and the cell swap refuses it', () => {
    const s = read(v5());
    const id = objectAt(D_PARAM, 'p');
    const k = propertiesOf(s, id).find((p) => p.flag === McosValueKind.cell)!;
    const edits: [string, () => unknown][] = [
      ['internString', () => internString(s, 'x')],
      ['addClass', () => addClass(s, { name: 'x.Y' })],
      ['appendObjectRow', () => appendObjectRow(s)],
      ['appendCtorList', () => appendCtorList(s)],
      ['appendPvList', () => appendPvList(s)],
      ['appendDynamicPropsList', () => appendDynamicPropsList(s)],
      ['addObject', () => addObject(s, { classIndex: 1, pv: [] })],
      ['addValueCell', () => addValueCell(s, double(1))],
      ['replaceValueCell', () => replaceValueCell(s, k.value, double(1))],
      ['insertPvTriple', () => insertPvTriple(s, id, { name: 1, flag: 2, value: 0 })],
      ['removePvTriple', () => removePvTriple(s, id, k.savedName)],
      ['setProperty', () => setProperty(s, id, k.savedName, double(1))],
      ['addStringObject', () => addStringObject(s, ['x'], [1, 1])],
    ];
    const bytes = writeSubsystem(s);
    for (const [what, f] of edits) expect(f, what).toThrow(/version 5.0/);
    expect(same(writeSubsystem(s), bytes)).toBe(true);
    expect(editMcosSubsystem(v5(), id, [{ savedName: k.savedName, cell: double(1) }])).toMatchObject({ ok: false, reason: 'unsupported' });
  });
});

describe('object references, which an edit replaces only when told to', () => {
  const coderInfo = () => {
    const s = read(matSubsystemOf(D_PARAM)!);
    const id = objectAt(D_PARAM, 'p');
    const p = propertiesOf(s, id).find((x) => x.savedName === 'CoderInfo')!;
    expect(readDescriptor(s.values[p.value])).not.toBeNull();
    return { s, id, k: p.value };
  };

  it("refuses to swap a nested object's reference for a value, or a value for a reference", () => {
    const { s, id, k } = coderInfo();
    expect(() => setProperty(s, id, 'CoderInfo', double(1))).toThrow(/object reference/);
    expect(() => replaceValueCell(s, k, double(1))).toThrow(/object reference/);
    const plain = propertiesOf(s, id).find((p) => p.flag === McosValueKind.cell && !readDescriptor(s.values[p.value]))!;
    const reference = descriptorCell({ dims: [1, 1], ids: [1], classIndex: s.blob.objects[1].classIndex });
    expect(() => replaceValueCell(s, plain.value, reference)).toThrow(/object reference/);
    expect(() => setProperty(s, id, 'Brand_New', reference)).toThrow(/object reference/);
    s.blob.pvLists[s.blob.objects[id].pvList].push({ name: internString(s, 'Held'), flag: McosValueKind.object, value: 1 });
    expect(() => setProperty(s, id, 'Held', double(1))).toThrow(/names an object/);
  });

  it('replaces one when told to, as a merge pointing a property at objects it adds does', () => {
    const { s, id, k } = coderInfo();
    const reference = descriptorCell({ dims: [1, 1], ids: [1], classIndex: s.blob.objects[1].classIndex });
    expect(setProperty(s, id, 'CoderInfo', reference, undefined, { objectReference: true })).toMatchObject({ op: 'swap', valueIndex: k });
    replaceValueCell(s, k, reference, { objectReference: true });
    expect(same(s.values[k], reference)).toBe(true);
  });
});

describe('records hold bytes of their own', () => {
  it('share no constant between two subsystems, or two class rows', () => {
    const a = createSubsystem();
    const b = createSubsystem();
    a.preamble[0] = 9;
    expect(b.preamble[0]).toBe(0);
    expect(a.classData!.entries[0]).not.toBe(b.classData!.entries[0]);
    const x = addClass(a, { name: 'p.A' });
    const y = addClass(a, { name: 'p.B' });
    expect(a.defaults!.entries[x]).not.toBe(a.defaults!.entries[y]);
    expect(a.classData!.entries[x]).not.toBe(a.classData!.entries[y]);
  });

  it('write no byte field past its range', () => {
    const s = read(matSubsystemOf(D_PARAM)!);
    const version = cloneSubsystem(s);
    version.blob.classes[1].version = [256, 0, 0, 0];
    expect(() => writeSubsystem(version)).toThrow(/not a uint8/);
    const reserved = cloneSubsystem(s);
    reserved.blob.reserved = 300;
    expect(() => writeSubsystem(reserved)).toThrow(/not a uint8/);
  });
});
