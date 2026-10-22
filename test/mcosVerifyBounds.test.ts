// Copyright 2026 The MathWorks, Inc.
//
// What verifySubsystem holds an edit to, against the subsystem as read, and what a template merge
// leaves when it refuses: a writer's mistakes that read back as the records meant, which MATLAB
// would load with no warning.
//
//   - Records no edit writes; a new object's lists; every reference an edit wrote; a 'handle'
//     opaque replaced or merged; the class systems the stream says it holds.
//   - With `edited`, that the edits stayed on their objects and properties; with `variables`, that
//     a created variable names its own new objects.
//   - A merge refused part-way changes nothing; an empty subsystem says it holds MCOS objects
//     alone; a merged record holds bytes of its own.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  addClassSystems,
  addValueCell,
  appendPvList,
  classSystemsOf,
  cloneSubsystem,
  createSubsystem,
  descriptorCell,
  editHandleCoderInfo,
  propertiesOf,
  readHandleOpaque,
  readSubsystem,
  replaceValueCell,
  setProperty,
  stringObjectOf,
  stringPayloadCell,
  verifySubsystem,
  writeHandleOpaque,
  writeSubsystem,
  type McosSubsystemRecords,
  type McosVerifyOptions,
} from '../src/datamodel/parser/McosSubsystemCodec.js';
import { addBusElements, busElementsOf, createAppendSession, createTemplateSubsystem, mergeTemplateObject, newObjectVariable } from '../src/datamodel/parser/McosTemplateMerge.js';
import { valueCellOf } from '../src/datamodel/parser/McosSubsystemEdit.js';
import { MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { matSubsystemOf } from './tools/mcosFixtureSubsystems.js';

const fixture = (path: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${path}`, import.meta.url))));
const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const double = (x: number): Uint8Array => valueCellOf({ name: '', className: 'double', dimensions: [1, 1], value: x, isComplex: false, isLogical: false, fields: null });

function read(bytes: Uint8Array): McosSubsystemRecords {
  const r = readSubsystem(bytes);
  if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
  return r.subsystem;
}

const MIXED = read(matSubsystemOf(fixture('mcos-templates/targets/r2027a/mixed.mat'))!);

/** MIXED with a Bus of three elements and a Parameter merged in, one save: what each case starts from. */
function merged(): { sub: McosSubsystemRecords; bus: number; busRow: number; par: number; parRow: number; elementsCell: number; variables: Uint8Array[] } {
  const sub = cloneSubsystem(MIXED);
  const session = createAppendSession();
  const b = mergeTemplateObject(sub, 'Simulink.Bus', { session, elements: ['a', 'b', 'c'] });
  const p = mergeTemplateObject(sub, 'Simulink.Parameter', { session });
  const elementsCell = propertiesOf(sub, b.objectId).find((t) => t.savedName === 'Elements_internal')!.value;
  return { sub, bus: b.objectId, busRow: b.classIndex, par: p.objectId, parRow: p.classIndex, elementsCell, variables: [newObjectVariable('b', b), newObjectVariable('p', p)] };
}

const check = (sub: McosSubsystemRecords, options: McosVerifyOptions = { edited: [] }) => verifySubsystem(writeSubsystem(sub), sub, MIXED, options);
const broken = (text: string) => ({ ok: false, reason: 'broken', message: expect.stringContaining(text) });

describe('a merge, held to the subsystem it started from', () => {
  it('verifies, and its variables name what they should', () => {
    const m = merged();
    expect(check(m.sub, { edited: [], variables: { created: m.variables } })).toEqual({ ok: true });
  });

  it("refuses a new Bus's Elements naming another class's object, the Bus, one twice, object 0, or the file's own element", () => {
    const cases: [string, (m: ReturnType<typeof merged>) => number[], string][] = [
      ['the Parameter', (m) => [m.par, ...busElementsOf(m.sub, m.bus).slice(1)], 'as one of class row'],
      ['the Bus itself', (m) => [...busElementsOf(m.sub, m.bus).slice(0, 2), m.bus], 'as one of class row'],
      ['an element twice', (m) => { const e = busElementsOf(m.sub, m.bus); return [e[0], e[0], e[2]]; }, 'twice'],
      ['object 0', (m) => [0, ...busElementsOf(m.sub, m.bus).slice(1)], 'names object 0'],
    ];
    for (const [what, ids, message] of cases) {
      const m = merged();
      m.sub.values[m.elementsCell] = descriptorCell({ dims: [3, 1], ids: ids(m), classIndex: m.sub.blob.objects[busElementsOf(m.sub, m.bus)[1]].classIndex });
      expect(check(m.sub), what).toMatchObject(broken(message));
    }
    // A BusElement of the file's own, under its own row, named by two Buses.
    const m = merged();
    const fileBus = [...MIXED.blob.objects.keys()].find((id) => id > 0 && MIXED.blob.classes[MIXED.blob.objects[id].classIndex] && propertiesOf(MIXED, id).some((t) => t.savedName === 'Elements_internal'))!;
    const own = busElementsOf(MIXED, fileBus)[0];
    m.sub.values[m.elementsCell] = descriptorCell({ dims: [1, 1], ids: [own], classIndex: MIXED.blob.objects[own].classIndex });
    expect(check(m.sub)).toMatchObject(broken('another value cell names too'));
  });

  it('refuses a nested reference to an object past the table, and a new object sharing a list', () => {
    const nested = merged();
    const cell = valueCellOf({ name: '', className: 'cell', dimensions: [1, 1], value: [{ name: '', className: 'uint32', dimensions: [6, 1], value: [0xdd000000, 2, 1, 1, 999, 1], isComplex: false, isLogical: false, fields: null }], isComplex: false, isLogical: false, fields: null });
    setProperty(nested.sub, nested.par, 'Description', cell, undefined, { objectReference: true });
    expect(check(nested.sub, { edited: [{ objectId: nested.par }] })).toMatchObject(broken('object 999'));
    for (const list of ['pvList', 'dynamicProps'] as const) {
      const m = merged();
      m.sub.blob.objects[m.par][list] = m.sub.blob.objects[m.bus][list];
      expect(check(m.sub), list).toMatchObject(broken('which another object names'));
    }
  });

  it('refuses a new object holding another directly, or a created variable an object holds', () => {
    const m = merged();
    const list = m.sub.blob.pvLists[m.sub.blob.objects[m.par].pvList];
    list.find((t) => m.sub.blob.strings[t.name] === 'Description')!.flag = 3;
    list.find((t) => m.sub.blob.strings[t.name] === 'Description')!.value = MIXED.blob.objects.length - 1;
    expect(check(m.sub)).toMatchObject(broken('not one the edits made'));
    list.find((t) => m.sub.blob.strings[t.name] === 'Description')!.value = m.bus;
    expect(check(m.sub, { edited: [], variables: { created: m.variables } })).toMatchObject(broken('which an object of the subsystem holds'));
  });

  it('refuses a stream that says it holds no handle objects beside a CoderInfo, or that it does with none', () => {
    const m = merged();
    m.sub.rest = MIXED.rest;
    expect(check(m.sub)).toMatchObject(broken("does not say it holds 'handle' objects"));
    const s = cloneSubsystem(MIXED);
    addClassSystems(s, ['handle']);
    expect(check(s)).toMatchObject(broken("no 'handle' opaque"));
  });

  it('refuses records no edit writes changed', () => {
    const cases: [string, (s: McosSubsystemRecords) => void][] = [
      ['preamble', (s) => (s.preamble = Uint8Array.of(0, 2, 0x49, 0x4d, 0, 0, 0, 0))],
      ['blob version', (s) => (s.blob.reserved = 1)],
      ['file header', (s) => (s.blob.fileHeader = null)],
      ['removed properties', (s) => (s.blob.removedProps = null)],
    ];
    for (const [what, f] of cases) {
      const s = cloneSubsystem(MIXED);
      f(s);
      expect(check(s), what).toMatchObject(broken(what));
    }
  });
});

describe('an edit, held to the objects and properties it was for', () => {
  const id = [...MIXED.blob.objects.keys()].find((i) => i > 0 && propertiesOf(MIXED, i).some((t) => t.savedName === 'Description' && t.flag === 1))!;

  it('passes a property set on the object named, and the edits of a string payload', () => {
    const s = cloneSubsystem(MIXED);
    setProperty(s, id, 'Description', valueCellOf({ name: '', className: 'char', dimensions: [1, 3], value: 'new', isComplex: false, isLogical: false, fields: null }));
    expect(check(s, { edited: [{ objectId: id, properties: ['Description'] }] })).toEqual({ ok: true });
    const str = [...MIXED.blob.objects.keys()].find((i) => i > 0 && stringObjectOf(MIXED, i));
    if (str !== undefined) {
      const t = cloneSubsystem(MIXED);
      replaceValueCell(t, stringObjectOf(t, str)!.valueIndex, stringPayloadCell(['x'], [1, 1]));
      expect(check(t, { edited: [{ objectId: str, properties: ['any'] }] })).toEqual({ ok: true });
    }
  });

  it('refuses a value cell spliced out, a triple dropped or re-pointed, a list reordered, another property changed', () => {
    const cases: [string, (s: McosSubsystemRecords) => void, McosVerifyOptions['edited'], string][] = [
      ['a cell spliced out', (s) => { s.values.splice(0, 1); s.values.push(s.values[0]); }, [], 'value cell'],
      ['a triple dropped', (s) => { s.blob.pvLists[s.blob.objects[id].pvList].pop(); }, [], `object ${id}`],
      ['a list reversed', (s) => { s.blob.pvLists[s.blob.objects[id].pvList].reverse(); }, [], `object ${id}`],
      ['a triple re-pointed', (s) => { const k = addValueCell(s, double(1)); s.blob.pvLists[s.blob.objects[id].pvList].find((t) => t.flag === 1)!.value = k; }, [], `object ${id}`],
      ['another property', (s) => { setProperty(s, id, 'Description', double(2)); }, [{ objectId: id, properties: ['Max'] }], 'which no property edited names'],
      ['another triple', (s) => { s.blob.pvLists[s.blob.objects[id].pvList].pop(); }, [{ objectId: id, properties: ['NotHeld'] }], 'other than in the properties named'],
    ];
    for (const [what, f, edited, message] of cases) {
      const s = cloneSubsystem(MIXED);
      f(s);
      expect(check(s, { edited }), what).toMatchObject({ ok: false, reason: expect.stringMatching(/broken|refused/) });
      const verdict = check(s, { edited });
      if (verdict.ok === false && verdict.reason === 'broken') expect(verdict.message, what).toContain(message);
    }
  });
});

describe("a 'handle' opaque CoderInfo, held to its own records", () => {
  const withCoderInfo = () => {
    const m = merged();
    const k = propertiesOf(m.sub, m.par).find((t) => t.savedName === 'CoderInfo')!.value;
    return { ...m, k };
  };

  it('passes an edited CoderInfo swapped in, and refuses an opaque of another class, of an unmeasured storage class or naming itself', () => {
    const m = withCoderInfo();
    const edited = editHandleCoderInfo(m.sub.values[m.k], { StorageClass: 'ExportedGlobal' });
    if (!edited.ok) throw new Error(edited.message);
    const original = cloneSubsystem(m.sub);
    setProperty(m.sub, m.par, 'CoderInfo', edited.cell, undefined, { handleOpaque: true });
    expect(verifySubsystem(writeSubsystem(m.sub), m.sub, original, { edited: [{ objectId: m.par, properties: ['CoderInfo'] }] })).toEqual({ ok: true });

    const mutate = (f: (h: NonNullable<ReturnType<typeof readHandleOpaque> & { ok: true }>['opaque']) => void) => {
      const x = withCoderInfo();
      const h = readHandleOpaque(x.sub.values[x.k]);
      if (!h.ok) throw new Error(h.message);
      f(h.opaque);
      x.sub.values[x.k] = writeHandleOpaque(h.opaque);
      return check(x.sub);
    };
    expect(mutate((h) => (h.blob.objects[1].classIndex = 2))).toMatchObject(broken('whose object 1 is'));
    expect(mutate((h) => {
      const t = h.blob.pvLists[h.blob.objects[1].pvList].find((x) => h.blob.strings[x.name] === 'StorageClass')!;
      h.blob.strings.push('NotMeasured');
      t.value = h.blob.strings.length - 1;
    })).toMatchObject(broken('NotMeasured'));
    expect(mutate((h) => {
      const t = h.blob.pvLists[h.blob.objects[1].pvList].find((x) => h.blob.strings[x.name] === 'CustomAttributes')!;
      h.values[t.value] = descriptorCell({ dims: [1, 1], ids: [1], classIndex: null });
    })).toMatchObject(broken('itself'));
  });

  it("refuses one replaced by an opaque of other objects, though it reads whole", () => {
    const m = withCoderInfo();
    const original = cloneSubsystem(m.sub);
    const h = readHandleOpaque(m.sub.values[m.k]);
    if (!h.ok) throw new Error(h.message);
    h.opaque.blob.objects.push({ ...h.opaque.blob.objects[2], pvList: appendPvListOf(h.opaque) });
    m.sub.values[m.k] = writeHandleOpaque(h.opaque);
    expect(verifySubsystem(writeSubsystem(m.sub), m.sub, original)).toMatchObject(broken("replaced by one with other objects"));
  });
});

/** A new empty property list of a 'handle' opaque's blob. */
function appendPvListOf(h: { blob: McosSubsystemRecords['blob'] }): number {
  h.blob.pvLists.push([]);
  return h.blob.pvLists.length - 1;
}

describe('a created variable, held to the records', () => {
  it('refuses one naming object 0, an object past the table, one of another row or class, or another variable\'s', () => {
    const m = merged();
    const element = (name: string, className: string, ids: number[], classIndex: number) => newObjectVariable(name, { objectId: ids[0], classIndex, className, descriptor: { dims: [1, ids.length], ids, classIndex } });
    const cases: [string, Uint8Array, string][] = [
      ['object 0', element('x', 'Simulink.Parameter', [0], m.parRow), 'names object 0'],
      ['past the table', element('x', 'Simulink.Parameter', [m.sub.blob.objects.length], m.parRow), 'and the table holds'],
      ['another row', element('x', 'Simulink.Parameter', [m.par], m.busRow), 'shows class Simulink.Parameter'],
      ['another class', element('x', 'Simulink.Bus', [m.par], m.parRow), 'shows class Simulink.Bus'],
      ["the file's own", element('x', 'Simulink.Bus', [m.bus], m.busRow), 'another variable names too'],
    ];
    for (const [what, created, message] of cases) {
      expect(check(m.sub, { edited: [], variables: { created: [created], kept: [m.variables[0]] } }), what).toMatchObject(broken(message));
    }
  });
});

describe('a merge', () => {
  it('refused part-way changes nothing, its session included', () => {
    const sub = cloneSubsystem(MIXED);
    sub.rest = Uint8Array.of(14, 0, 0, 0, 0, 0, 0, 0);
    const before = writeSubsystem(sub);
    const session = createAppendSession();
    expect(() => mergeTemplateObject(sub, 'Simulink.Parameter', { session })).toThrow(MatWriteError);
    expect(same(writeSubsystem(sub), before)).toBe(true);
    expect(session.classes.size).toBe(0);
  });

  it("starts a file with none from a subsystem that holds MCOS objects alone, and says 'handle' once one is merged", () => {
    const sub = createTemplateSubsystem('Simulink.Parameter');
    expect(classSystemsOf(sub)).toEqual(['MCOS']);
    mergeTemplateObject(sub, 'string');
    expect(classSystemsOf(sub)).toEqual(['MCOS']);
    mergeTemplateObject(sub, 'Simulink.Parameter');
    expect(classSystemsOf(sub)).toEqual(['MCOS', 'handle']);
  });

  it('writes no class system beside one the stream holds that no merge was measured with', () => {
    const sub = createSubsystem();
    addClassSystems(sub, ['java']);
    expect(() => addClassSystems(sub, ['handle'])).toThrow(/java/);
    expect(() => mergeTemplateObject(sub, 'Simulink.Parameter')).toThrow(MatWriteError);
    expect(classSystemsOf(sub)).toEqual(['MCOS', 'java']);
  });

  it("holds bytes of its own, so that writing into one merge's records changes no later merge", () => {
    const first = cloneSubsystem(MIXED);
    mergeTemplateObject(first, 'Simulink.Parameter');
    const second = cloneSubsystem(MIXED);
    mergeTemplateObject(second, 'Simulink.Parameter');
    for (const cell of first.values.slice(MIXED.values.length)) cell.fill(0);
    first.rest.fill(0);
    const third = cloneSubsystem(MIXED);
    mergeTemplateObject(third, 'Simulink.Parameter');
    expect(third.values.slice(MIXED.values.length).every((c, i) => same(c, second.values[MIXED.values.length + i]))).toBe(true);
    const a = createTemplateSubsystem('string');
    a.rest.fill(0);
    expect(classSystemsOf(createTemplateSubsystem('string'))).toEqual(['MCOS']);
  });

  it('adding Bus elements, refused part-way, changes nothing', () => {
    const m = merged();
    const before = writeSubsystem(m.sub);
    expect(() => addBusElements(m.sub, m.bus, ['a'])).toThrow(MatWriteError);
    expect(same(writeSubsystem(m.sub), before)).toBe(true);
  });
});
