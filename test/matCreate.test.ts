// Copyright 2026 The MathWorks, Inc.
//
// A variable created in a MAT-file through the session, as a host creates one (MatNode
// getAllowedTypes, execAddEntry): MATLAB's default object of each class core has a template of,
// merged into the subsystem the save writes, and the variable naming it; a Bus's element rows added
// and removed; each row a created object offers edited; the add undone, redone, and deleted.
//
// Against the template merges MATLAB judged (test/fixtures/mcos-templates, cases.json; see
// test/mcosTemplateGoldens.test.ts): every new variable of each class, into a file with objects of
// its class, of other classes only, and with no subsystem, written by R2023b or R2027a, and the
// elements added to and removed from a Bus a file holds, save the file MATLAB loaded, every record
// element for element, the target's own records as their bytes. A new Bus given elements here is
// a Bus merged and its elements then added (addBusElements), which the merge's records do not
// order as MATLAB's own save of a new Bus does: those are held to the records written and to what
// they read back as, and MATLAB's verdict on them is the creation gate's (the README in the
// research probes, tierb/gate-create).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzlibSync, zlibSync } from 'fflate';
import { createSession } from '../src/index.js';
import { sourceEditRefusal } from '../src/datamodel/node/BaseNode.js';
import { CREATABLE_MCOS_CLASSES, createTemplateSubsystem } from '../src/datamodel/parser/McosTemplateMerge.js';
import { MAT_CREATABLE_CLASSES } from '../src/index.js';
import { objectReferenceElement, readDescriptor, readSubsystem, verifySubsystem, writeSubsystem, type McosSubsystemRecords } from '../src/datamodel/parser/McosSubsystemCodec.js';

const DIR = fileURLToPath(new URL('./fixtures/mcos-templates/', import.meta.url));
const read = (path: string): Uint8Array => new Uint8Array(readFileSync(DIR + path));
const bufferOf = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

type Op =
  | { op: 'new'; var: string; tpl: string; elements: string[] }
  | { op: 'add'; var: string; names: string[] }
  | { op: 'remove'; var: string; index: number };

interface Case {
  name: string;
  into: 'r2023b' | 'r2027a';
  target: string;
  matlab: string;
  ops: Op[];
  verdicts: Record<string, string>;
}

const CASES = (JSON.parse(readFileSync(DIR + 'cases.json', 'utf8')) as { cases: Case[] }).cases;

/** A MAT-file opened through the session, as a host opens one, and what a host does to it. */
function opened(bytes: Uint8Array) {
  const session = createSession();
  const root: any = session.addMatSource('f.mat', bufferOf(bytes));
  session.setActiveContext(root);
  const by = (name: string): any => root.children.find((c: any) => c.name === name);
  const edit = (node: any, prop: string, value: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, prop, value);
  };
  const add = (className: string, name?: string): any => {
    session.setActiveContext(root);
    return session.addEntry('', className, name);
  };
  const addElement = (bus: any): any => session.addChildTo(bus.id);
  const remove = (node: any): boolean => {
    session.setActive(root, node);
    return session.deleteNodeById(node.id);
  };
  const save = (): Uint8Array => (session.serializeSource('f.mat') as { bytes: Uint8Array }).bytes;
  return { session, root, by, edit, add, addElement, remove, save };
}

interface Rec {
  raw: Uint8Array;
  element: Uint8Array;
  subsystem: boolean;
  compressed: boolean;
}

/** A Level-5 file's records, after the 128-byte header; the subsystem is the one its header names. */
function records(bytes: Uint8Array): Rec[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at0 = Number(view.getBigUint64(116, true));
  const out: Rec[] = [];
  for (let at = 128; at + 8 <= bytes.length; ) {
    const type = view.getUint32(at, true);
    const size = view.getUint32(at + 4, true);
    const end = at + 8 + size + (type === 15 ? 0 : (8 - (size % 8)) % 8);
    const element = type === 15 ? unzlibSync(bytes.subarray(at + 8, at + 8 + size)) : bytes.subarray(at, at + 8 + size);
    out.push({ raw: bytes.subarray(at, end), element, subsystem: at === at0, compressed: type === 15 });
    at = end;
  }
  return out;
}

/** Where the records of `a` and `b` differ, element for element, or null. */
function recordsDiffer(a: Uint8Array, b: Uint8Array): string | null {
  const [x, y] = [records(a), records(b)];
  if (x.length !== y.length) {
    return x.length + ' records, and ' + y.length;
  }
  const at = x.findIndex((r, i) => r.subsystem !== y[i].subsystem || r.compressed !== y[i].compressed || !same(r.element, y[i].element));
  return at < 0 ? null : 'record ' + at;
}

function subsystemOf(bytes: Uint8Array): { element: Uint8Array; records: McosSubsystemRecords } | null {
  const own = records(bytes).find((r) => r.subsystem);
  if (!own) {
    return null;
  }
  const r = readSubsystem(own.element);
  if (!r.ok) {
    throw new Error(r.message);
  }
  return { element: own.element, records: r.subsystem };
}

/** Every property a node shows, its table's columns and the rows only its Property Inspector shows. */
function propsOf(node: any): any[] {
  const columns = node.getProperties();
  const keys = new Set(columns.map((p: any) => p.key));
  return [...columns, ...(node.getPILayout() ?? []).flatMap((g: any) => g.items).filter((p: any) => !keys.has(p.key))];
}

/** What a node shows, everywhere a host looks: each property's text, and each row under it. */
function shown(node: any): string[] {
  const out = propsOf(node).map((p: any) => `${p.key} = ${node.getPropInfo(p).displayValue}`);
  node.children.forEach((c: any, i: number) => out.push(`${i} [${shown(c).join('; ')}]`));
  return [node.name, node.className, ...out];
}

/** The case's ops, made through the session on its target. */
function replayed(c: Case) {
  const o = opened(read(`targets/${c.into}/${c.target}.mat`));
  const named = (bus: any, name: string) => {
    const row = o.addElement(bus);
    expect(row, c.name).not.toBeNull();
    if (row.name !== name) {
      expect(o.edit(row, 'Name', name), c.name).toBe(true);
    }
  };
  for (const op of c.ops) {
    if (op.op === 'new') {
      const node = o.add(op.tpl, op.var);
      expect([node?.name, node?.className, node?.status], c.name).toEqual([op.var, op.tpl, 'New']);
      op.elements.forEach((name) => named(node, name));
    } else if (op.op === 'add') {
      op.names.forEach((name) => named(o.by(op.var), name));
    } else {
      expect(o.remove(o.by(op.var).children[op.index - 1]), c.name).toBe(true);
    }
  }
  return o;
}

// What a gallery offers and execAddEntry takes, exactly: every class with a template but a
// LookupTable and a Breakpoint, whose nodes offer no editor of what they hold.
const NOT_CREATED = ['Simulink.LookupTable', 'Simulink.Breakpoint'];
const OFFERED = ['MatlabVariable', 'MatlabStruct', ...CREATABLE_MCOS_CLASSES.filter((c) => !NOT_CREATED.includes(c))];
const CREATED = OFFERED;

describe('the classes a MAT-file takes a new variable of', () => {
  it('every class with a template, in a file with objects and in one with none, each its node as the file will hold it', () => {
    // The default name, class and glyph of each, as a host's gallery tile shows it.
    const tiles: Record<string, [string, string, string]> = {
      MatlabVariable: ['var', 'double', 'wsDefault'],
      MatlabStruct: ['Struct', 'struct', 'wsTree'],
      'Simulink.Parameter': ['Param', 'Simulink.Parameter', 'wsParameters'],
      'Simulink.Signal': ['Signal', 'Simulink.Signal', 'wsSignal'],
      'Simulink.Bus': ['Bus', 'Simulink.Bus', 'wsBus'],
      'Simulink.NumericType': ['NumericType', 'Simulink.NumericType', 'wsNumeric'],
      'Simulink.AliasType': ['AliasType', 'Simulink.AliasType', 'wsAlias'],
      'Simulink.ValueType': ['ValueType', 'Simulink.ValueType', 'wsValue'],
      string: ['str', 'string', 'wsString'],
    };
    expect(Object.keys(tiles).sort()).toEqual([...CREATED].sort());
    expect(['MatlabVariable', 'MatlabStruct', ...MAT_CREATABLE_CLASSES]).toEqual(OFFERED);
    for (const target of ['r2023b/none', 'r2023b/param', 'r2027a/mixed', 'r2027a/bus2']) {
      const { session, root, add, save } = opened(read(`targets/${target}.mat`));
      expect(root.getAllowedTypes(), target).toEqual(OFFERED);
      // A class with a template its node offers no editor of is not created, and says why.
      for (const cls of NOT_CREATED) {
        expect(add(cls), `${target} ${cls}`).toBeNull();
        expect(session.addEntryRefusal(), `${target} ${cls}`).toMatch(/its node shows nothing yet of the Table and Breakpoints its object holds/);
      }
      for (const cls of CREATED) {
        const node = add(cls);
        expect([node.name, node.className, node.icon, node.status, node.parent], `${target} ${cls}`).toEqual([...tiles[cls], 'New', root]);
      }
      // All of them in one save, each read back as it was shown.
      const again = opened(save());
      for (const cls of CREATED) {
        expect(shown(again.by(tiles[cls][0])), `${target} ${cls}`).toEqual(shown(root.children.find((c: any) => c.name === tiles[cls][0])));
      }
    }
  });

  it('only a plain variable or a struct where the subsystem is of a blob version no edit was measured on', () => {
    // The file with its subsystem's blob made version 5.0, its package cell one entry a class row.
    const bytes = read('targets/r2023b/param.mat');
    const own = subsystemOf(bytes)!;
    const sub = own.records;
    sub.blob.major = 5;
    const flags = sub.aliases!.flags.slice();
    flags[8] = 13;
    sub.packages = { ...sub.aliases!, flags, entries: sub.aliases!.entries.map(() => 0) };
    const stream = zlibSync(writeSubsystem(sub), { level: 6 });
    const at = records(bytes).findIndex((r) => r.subsystem);
    const recs = records(bytes);
    const head = bytes.subarray(0, bytes.length - recs.slice(at).reduce((n, r) => n + r.raw.length, 0));
    const tag = new Uint8Array(8);
    new DataView(tag.buffer).setUint32(0, 15, true);
    new DataView(tag.buffer).setUint32(4, stream.length, true);
    const v5 = new Uint8Array([...head, ...tag, ...stream]);
    expect(subsystemOf(v5)!.records.blob.major).toBe(5);
    const { root, add, save } = opened(v5);
    expect(root.getAllowedTypes()).toEqual(['MatlabVariable', 'MatlabStruct']);
    expect([add('Simulink.Parameter'), add('string')]).toEqual([null, null]);
    expect(add('MatlabStruct').className).toBe('struct');
    expect(records(save()).length).toBe(recs.length + 1);
  });
});

describe('the new variables and Bus elements MATLAB judged, made through the session', () => {
  // A new Bus given elements here is merged empty and its elements then added: not the records of
  // the merge of a Bus with them (above), and so not compared with them.
  const elementsOfNew = (c: Case) => c.ops.some((o) => o.op === 'new' && o.elements.length > 0);

  it('are every case', () => {
    expect(CASES).toHaveLength(86);
    expect(CASES.filter(elementsOfNew)).toHaveLength(18);
    for (const c of CASES) expect(c.verdicts, c.name).toEqual({ R2023b: 'PASS', R2024b: 'PASS', R2027a: 'PASS' });
  });

  for (const c of CASES) {
    // A LookupTable or a Breakpoint is created by the merge (mcosTemplateGoldens), and by no session.
    const refused = c.ops.some((o) => o.op === 'new' && NOT_CREATED.includes(o.tpl));
    it(`${c.into}/${c.name}: ${c.matlab}`, () => {
      const target = read(`targets/${c.into}/${c.target}.mat`);
      if (refused) {
        const { session, add } = opened(target);
        const op = c.ops.find((o) => o.op === 'new') as { var: string; tpl: string };
        expect([add(op.tpl, op.var), session.addEntryRefusal()]).toEqual([null, expect.stringMatching(/^Cannot add a Simulink\.(LookupTable|Breakpoint) to "f\.mat"/)]);
        return;
      }
      const o = replayed(c);
      const saved = o.save();
      // The target's records are the saved file's first ones, byte for byte, as they were.
      const kept = records(target).filter((r) => !r.subsystem);
      expect(records(saved).slice(0, kept.length).every((r, i) => same(r.raw, kept[i].raw)), c.name).toBe(true);
      if (!elementsOfNew(c)) {
        expect(recordsDiffer(saved, read(`merged/${c.into}/${c.name}.mat`)), c.name).toBeNull();
        return;
      }
      // Written as its records, and nothing of the target's subsystem renumbered (of a file with
      // none, of the empty one the first new object was merged into).
      const written = subsystemOf(saved)!;
      const original = subsystemOf(target)?.records ?? createTemplateSubsystem('Simulink.Bus');
      expect(verifySubsystem(written.element, written.records, original), c.name).toEqual({ ok: true });
      const again = opened(saved);
      for (const op of c.ops) {
        expect(shown(again.by(op.var)), c.name + ' ' + op.var).toEqual(shown(o.by(op.var)));
      }
      const bus = again.by((c.ops.find((x) => x.op === 'new') as { var: string }).var);
      expect(bus.children.map((e: any) => e.name), c.name).toEqual((c.ops.find((x) => x.op === 'new') as { elements: string[] }).elements);
    });
  }
});

/** The values a sweep types into `key` of `node`, each an edit of some value MATLAB takes. */
function candidates(node: any, key: string): string[] {
  const prop = propsOf(node).find((p: any) => p.key === key);
  const info = prop ? node.getPropInfo(prop) : null;
  const options = info && info.editor === 'select' ? info.options ?? prop.options : null;
  if (Array.isArray(options) && options.length > 0) {
    return options.map(String);
  }
  if (node.className === 'string') {
    return ['"zz edited"', '"7"', "'zz'"];
  }
  switch (key) {
    case 'Name':
      return ['renamed', 'a'];
    case 'Value':
      return ['7', '[1 2; 3 4]', 'true', "'abc'", '1+2i', '[]', '-3'];
    case 'Min':
      return ['-1', '[]', '5'];
    case 'Max':
      return ['9', '[]', '200'];
    case 'Description':
    case 'Unit':
      return ['zz edited', '', 'Grüße 温度'];
    case 'DataType':
      return ['double', 'int8', 'fixdt(1,16,4)', 'boolean', 'single'];
    case 'BaseType':
      return ['int16', 'single'];
    case 'dimensions':
      return ['[2 3]', '4', '-1'];
    case 'initialValue':
      return ['0.5', 'zz', ' 1'];
    case 'sampleTime':
      return ['0.1', '[0.2 0.1]', '-1'];
    case 'headerFile':
      return ['zz.h', ' a.h'];
    case 'alignment':
      return ['8', '16', '3'];
    default:
      return ['7', "'zz'"];
  }
}

describe('every row a new object offers an editor of takes an edit, saved and read back as shown', () => {
  for (const target of ['r2023b/none', 'r2027a/param']) {
    for (const cls of MAT_CREATABLE_CLASSES) {
      it(`${target}: ${cls}${cls === 'Simulink.Bus' ? ', with two elements added' : ''}`, () => {
        const fresh = () => {
          const o = opened(read(`targets/${target}.mat`));
          const node = o.add(cls, 'nv');
          if (cls === 'Simulink.Bus') {
            o.addElement(node);
            o.addElement(node);
          }
          return { ...o, node };
        };
        const probe = fresh();
        // The object's row and each under it, by its path of child indices.
        const rows: number[][] = [[]];
        const walk = (n: any, path: number[]) => n.children.forEach((c: any, i: number) => (rows.push([...path, i]), walk(c, [...path, i])));
        walk(probe.node, []);
        const at = (node: any, path: number[]) => path.reduce((n, i) => n.children[i], node);
        let offered = 0;
        for (const path of rows) {
          const seen = at(probe.node, path);
          for (const prop of propsOf(seen)) {
            const key = prop.key;
            if ((key === 'Name' && path.length === 0) || sourceEditRefusal(seen, key) !== null || !seen.getPropInfo(prop).editable) {
              continue;
            }
            offered++;
            let taken = 0;
            for (const value of candidates(seen, key)) {
              if (value === seen.getPropInfo(prop).displayValue) {
                continue;
              }
              const { node, by, edit, save } = fresh();
              const answer: any = edit(at(node, path), key, value);
              const what = `${target} ${seen.matlabPath} ${key} = ${value}`;
              if (answer !== true) {
                // Refused by its value (a name another element holds, say): nothing changed.
                expect(answer, what).toMatchObject({ error: true });
                expect(shown(node), what).toEqual(shown(probe.node));
                continue;
              }
              // The variable now `nv`: the object, or the one an edit put in its place (a string's
              // Value typed as another value: MatNode._retype).
              expect(shown(opened(save()).by('nv')), what).toEqual(shown(by('nv')));
              taken++;
            }
            expect(taken, `${target} ${seen.matlabPath} ${key}`).toBeGreaterThan(0);
          }
        }
        expect(offered).toBeGreaterThan(0);
      });
    }
  }
});

describe("the Property Inspector of a MAT-file's object", () => {
  // The rows a save writes no edit of, in "Other", read-only, and the state that opens each row
  // offered that takes no edit as the object stands.
  const OPENS: Record<string, [string, string]> = {
    identifier: ['storageClass', 'ExportedGlobal'],
    alignment: ['storageClass', 'ExportedGlobal'],
    signedness: ['dataTypeMode', 'Fixed-point: slope and bias scaling'],
    wordLength: ['dataTypeMode', 'Fixed-point: slope and bias scaling'],
    fractionLength: ['dataTypeMode', 'Fixed-point: binary point scaling'],
    slope: ['dataTypeMode', 'Fixed-point: slope and bias scaling'],
    bias: ['dataTypeMode', 'Fixed-point: slope and bias scaling'],
  };
  const sheet = (n: any) => n.toPIObject().propertySheet;
  const groupRows = (n: any, other: boolean) =>
    sheet(n).groups.filter((g: any) => (g.name === 'OtherGroup') === other).flatMap((g: any) => g.items.map((i: any) => sheet(n).properties.find((p: any) => p.name === i.name)));

  for (const cls of MAT_CREATABLE_CLASSES.filter((c) => c !== 'string')) {
    it(`${cls}: offers every row in its groups an edit, in some state, and shows the others read-only in "Other"`, () => {
      const o = opened(read('targets/r2027a/mixed.mat'));
      const made = o.add(cls, 'nv');
      const nodes = cls === 'Simulink.Bus' ? [made, o.addElement(made)] : [made];
      for (const node of nodes) {
        for (const row of groupRows(node, false)) {
          if (row.editable || row.name === 'Kind' || row.name === 'Class') continue;
          const opens = OPENS[row.name];
          expect(opens, `${node.className} ${row.name}`).toBeDefined();
          const again = opened(read('targets/r2027a/mixed.mat'));
          const other = again.add(cls, 'nv');
          expect(again.edit(other, opens[0], opens[1]), `${cls} ${opens.join(' = ')}`).toBe(true);
          expect(groupRows(other, false).find((r: any) => r.name === row.name)?.editable, `${cls} ${row.name} after ${opens.join(' = ')}`).toBe(true);
        }
        const other = groupRows(node, true);
        expect(other.every((r: any) => !r.editable), node.className).toBe(true);
        // None of the saved keys a row shows already, which an edit leaves as they were until the save.
        expect(other.map((r: any) => r.name).filter((k: string) => /^Other\.(SignednessBool|FixedExponent|SlopeAdjustmentFactor|Elements_internal|be)(\.|$)/.test(k)), node.className).toEqual([]);
      }
    });
  }

  it("a Parameter's Dimensions and Complexity, which follow its Value, read-only in \"Other\" and still as they are", () => {
    const o = opened(read('targets/r2027a/mixed.mat'));
    const p = o.add('Simulink.Parameter', 'nv');
    expect(o.edit(p, 'Value', '[1 2 3]')).toBe(true);
    const shownAs = (key: string) => p.toPIObject().objects[0]['Other.' + key];
    expect([shownAs('dimensions'), shownAs('complexity')]).toEqual(['[1 3]', 'real']);
    expect(groupRows(p, false).map((r: any) => r.name)).not.toContain('dimensions');
  });

  it('a MATLAB value: every row as before, and no Description, which it has none of', () => {
    const o = opened(read('targets/r2027a/mixed.mat'));
    const x = o.by('x');
    expect(groupRows(x, false).map((r: any) => r.name)).toEqual(['Name', 'Value', 'DataType', 'Kind', 'Class']);
    expect(groupRows(x, true)).toEqual([]);
  });
});

describe('an add undone, redone and deleted', () => {
  const adds: [string, string][] = [
    ['r2023b/param', 'Simulink.Parameter'],
    ['r2023b/none', 'string'],
    ['r2027a/mixed', 'Simulink.Bus'],
    ['r2027a/none', 'Simulink.Signal'],
  ];

  it('undone, the file saves as it was; redone, as the add saved it', () => {
    for (const [target, cls] of adds) {
      const original = read(`targets/${target}.mat`);
      const { session, root, add, addElement, save } = opened(original);
      const node = add(cls, 'nv');
      if (cls === 'Simulink.Bus') {
        addElement(node);
      }
      const added = save();
      expect(same(added, original), target).toBe(false);
      if (cls === 'Simulink.Bus') {
        session.undo();
        expect(node.children, target).toHaveLength(0);
      }
      session.undo();
      expect([root.children.includes(node), same(save(), original)], target).toEqual([false, true]);
      session.redo();
      if (cls === 'Simulink.Bus') {
        session.redo();
      }
      expect([root.children.includes(node), same(save(), added)], target).toEqual([true, true]);
    }
  });

  it('a new variable deleted saves the file as it was; the delete undone, as the add saved it', () => {
    for (const [target, cls] of adds) {
      const original = read(`targets/${target}.mat`);
      const { session, add, remove, save } = opened(original);
      const node = add(cls, 'nv');
      const added = save();
      expect(remove(node), target).toBe(true);
      expect(same(save(), original), target).toBe(true);
      session.undo();
      expect(same(save(), added), target).toBe(true);
    }
  });

  it("a Bus's element rows: Add twice, delete one, each saved and read back; the delete undone", () => {
    for (const target of ['r2023b/none', 'r2027a/bus2']) {
      const { session, by, add, addElement, remove, save } = opened(read(`targets/${target}.mat`));
      for (const bus of [add('Simulink.Bus', 'bnew'), by('bb')].filter(Boolean)) {
        const before = bus.children.map((e: any) => e.name);
        expect([addElement(bus).name, addElement(bus).name], target).toEqual(before.includes('a') ? ['a1', 'a2'] : ['a', 'a1']);
        expect(opened(save()).by(bus.name).children.map((e: any) => e.name), target).toEqual(bus.children.map((e: any) => e.name));
        expect(remove(bus.children[0]), target).toBe(true);
        let again = opened(save()).by(bus.name);
        expect(shown(again), target).toEqual(shown(bus));
        session.undo();
        again = opened(save()).by(bus.name);
        expect([again.children.length, shown(again)], target).toEqual([before.length + 2, shown(bus)]);
      }
    }
  });

  it('a new variable beside edits of objects the file holds: all written in one save', () => {
    const { by, add, addElement, edit, save } = opened(read('targets/r2027a/mixed.mat'));
    const p = add('Simulink.Parameter', 'pnew');
    expect([edit(p, 'Value', '7'), edit(p, 'Description', 'new')]).toEqual([true, true]);
    expect([edit(by('p1'), 'Value', '-2'), edit(by('sig0'), 'Min', '-1')]).toEqual([true, true]);
    expect(addElement(by('b0')).name).toBe('a');
    const again = opened(save());
    for (const name of ['pnew', 'p1', 'sig0', 'b0']) {
      expect(shown(again.by(name)), name).toEqual(shown(by(name)));
    }
  });

  it('no MATLAB name is refused, adding nothing; a name the file holds and a default name are made unique', () => {
    const { root, add } = opened(read('targets/r2023b/param.mat'));
    const held = root.children[0].name;
    const count = root.children.length;
    expect([add('string', '1bad'), add('Simulink.Bus', 'a b')]).toEqual([null, null]);
    expect(root.children).toHaveLength(count);
    expect(add('Simulink.Parameter', held).name).toBe(held + '1');
    expect([add('string').name, add('string').name, add('Simulink.Parameter').name, add('Simulink.Parameter').name]).toEqual(['str', 'str1', 'Param', 'Param1']);
  });
});

describe('a new struct', () => {
  it('takes a field added and its value edited, saved and read back', () => {
    const { session, add, edit, save } = opened(read('targets/r2023b/param.mat'));
    const s = add('MatlabStruct');
    const field = session.addChildTo(s.id) as any;
    expect([s.name, s.displayValue, field.name]).toEqual(['Struct', '<1x1 struct>', 'field']);
    expect(edit(field, 'Value', '[1 2 3]')).toBe(true);
    expect(shown(opened(save()).by('Struct'))).toEqual(shown(s));
  });
});

describe('every class a gallery offers', () => {
  // What no edit sets: where an object stands (Kind, Class); what follows another property (a
  // Parameter's Dimensions and Complexity, of its Value; the stored-integer bounds, of the
  // DataType); a column its class has no property for, the Data Type column showing what it is (a
  // Bus's, a NumericType's, a string's); and a CoderInfo's custom attributes, which MATLAB sets only
  // under the custom storage class no editor offers.
  const CUSTOM = ['headerFile', 'definitionFile', 'owner', 'preserveDimensions', 'structName', 'getFunction', 'setFunction', 'dataScope'];
  const SET_BY_NONE: Record<string, string[]> = {
    'Simulink.Parameter': ['dimensions', 'complexity', 'storedIntMin', 'storedIntMax', ...CUSTOM],
    'Simulink.Signal': ['storedIntMin', 'storedIntMax', ...CUSTOM],
    'Simulink.Bus': ['DataType'],
    'Simulink.NumericType': ['DataType'],
    string: ['DataType'],
  };

  it('offers an editor of every property MATLAB sets, of the object and of each row under it', () => {
    for (const target of ['r2023b/none', 'r2027a/param']) {
      for (const cls of MAT_CREATABLE_CLASSES) {
        const o = opened(read(`targets/${target}.mat`));
        const node = o.add(cls, 'nv');
        // In the state MATLAB sets the rest in: a storage class other than Auto (an Identifier, an
        // Alignment), slope and bias scaling (a NumericType's every scaling property), a Bus element.
        if (cls === 'Simulink.Parameter' || cls === 'Simulink.Signal') {
          expect(o.edit(node, 'storageClass', 'ExportedGlobal'), cls).toBe(true);
        }
        if (cls === 'Simulink.NumericType') {
          expect(o.edit(node, 'dataTypeMode', 'Fixed-point: slope and bias scaling'), cls).toBe(true);
        }
        if (cls === 'Simulink.Bus') {
          o.addElement(node);
        }
        const unset: string[] = [];
        const walk = (n: any) => {
          for (const prop of propsOf(n)) {
            const exempt = ['Kind', 'Class', ...(n === node ? SET_BY_NONE[cls] ?? [] : [])];
            if (!exempt.includes(prop.key) && !n.getPropInfo(prop).editable) {
              unset.push(n.matlabPath + '.' + prop.key);
            }
          }
          n.children.forEach(walk);
        };
        walk(node);
        expect(unset, `${target} ${cls}`).toEqual([]);
        // And no row of a property its class does not have: a string's Description.
        if (cls === 'string') {
          expect(propsOf(node).map((p: any) => p.key), target).not.toContain('Description');
        }
      }
    }
  });

  it('an edit of a property shown only in its Property Inspector is undone, and redone, whole', () => {
    const { session, add, edit, save } = opened(read('targets/r2027a/param.mat'));
    const original = save();
    const nt = add('Simulink.NumericType', 'nt');
    const s = add('Simulink.Signal', 'sig');
    const added = save();
    const steps: [any, string, string][] = [
      [nt, 'dataTypeMode', 'Fixed-point: binary point scaling'],
      [nt, 'wordLength', '8'],
      [nt, 'dataTypeMode', 'Single'],
      [s, 'initialValue', '0.5'],
      [s, 'sampleTime', '[0.2 0.1]'],
      [s, 'storageClass', 'ExportedGlobal'],
      [s, 'identifier', 'sigId'],
    ];
    const saves: Uint8Array[] = [];
    for (const [n, k, v] of steps) {
      expect(edit(n, k, v), k).toBe(true);
      // The text it shows now, set again, is no edit, and no step to undo.
      expect(edit(n, k, n.getPropInfo(propsOf(n).find((p: any) => p.key === k)).displayValue), k).toBe(true);
      saves.push(save());
    }
    expect(shown(opened(saves[saves.length - 1]).by('nt'))).toEqual(shown(nt));
    expect(shown(opened(saves[saves.length - 1]).by('sig'))).toEqual(shown(s));
    // Each undone: the file each step before it saved, byte for byte, its WordLength 8 included.
    for (let i = steps.length - 1; i >= 0; i--) {
      session.undo();
      expect(same(save(), i === 0 ? added : saves[i - 1]), steps[i][1]).toBe(true);
    }
    for (let i = 0; i < steps.length; i++) {
      session.redo();
      expect(same(save(), saves[i]), steps[i][1]).toBe(true);
    }
    expect(same(original, added)).toBe(false);
  });
});

describe('an Add refused says why', () => {
  it('through the session, as a refused edit does, for a host to show', () => {
    const { session, add } = opened(read('targets/r2023b/param.mat'));
    const refused = (cls: string, name?: string) => (add(cls, name) === null ? session.addEntryRefusal() : 'added');
    // A name the file holds is given a counter, as a dictionary's Add gives one (newEntryName.test.ts).
    expect(refused('Simulink.Parameter', 'p0')).toBe('added');
    expect(session.addEntryRefusal()).toBeNull();
    expect(refused('Simulink.Parameter', 'a'.repeat(63))).toBe('added');
    expect(refused('Simulink.Parameter', 'a'.repeat(63))).toMatch(/^Cannot add a Simulink\.Parameter to "f\.mat": 'a{63}1' is not a name MATLAB can load \(Name exceeds maximum length of 63 characters\)\.$/);
    expect(refused('string', '1bad')).toMatch(/^Cannot add a string to "f\.mat": '1bad' is not a name MATLAB can load/);
    expect(refused('Simulink.ConfigSet')).toMatch(/^Cannot add a Simulink\.ConfigSet to "f\.mat": a MAT-file takes a new variable of a plain value, a struct, or one of Simulink\.Parameter/);
    expect(refused('Simulink.Parameter')).toBe('added');
    expect(session.addEntryRefusal()).toBeNull();
  });

  it('of an object, in a file whose objects no creation was measured on', () => {
    // As the blob version test builds one: the subsystem made version 5.0.
    const bytes = read('targets/r2023b/param.mat');
    const sub = subsystemOf(bytes)!.records;
    sub.blob.major = 5;
    const flags = sub.aliases!.flags.slice();
    flags[8] = 13;
    sub.packages = { ...sub.aliases!, flags, entries: sub.aliases!.entries.map(() => 0) };
    const stream = zlibSync(writeSubsystem(sub), { level: 6 });
    const recs = records(bytes);
    const at = recs.findIndex((r) => r.subsystem);
    const head = bytes.subarray(0, bytes.length - recs.slice(at).reduce((n, r) => n + r.raw.length, 0));
    const tag = new Uint8Array(8);
    new DataView(tag.buffer).setUint32(0, 15, true);
    new DataView(tag.buffer).setUint32(4, stream.length, true);
    const { session, add } = opened(new Uint8Array([...head, ...tag, ...stream]));
    expect(add('Simulink.Signal')).toBeNull();
    expect(session.addEntryRefusal()).toBe('Cannot add a Simulink.Signal to "f.mat": the file\'s objects are of a blob version no edit was measured on.');
  });
});

describe('a variable created and deleted before a save', () => {
  const subsystemCounts = (bytes: Uint8Array) => {
    const sub = subsystemOf(bytes)!.records;
    return [sub.blob.objects.length, sub.values.length, sub.blob.strings.length];
  };

  it('writes nothing of it, as MATLAB writes nothing of a variable it never saved', () => {
    const target = read('targets/r2027a/param.mat');
    // Created alone, for the bytes the others are held to.
    const alone = opened(target);
    alone.add('Simulink.Signal', 'sNew');
    const once = alone.save();
    // Created, deleted, created again under the same name.
    const again = opened(target);
    expect(again.remove(again.add('Simulink.Signal', 'sNew'))).toBe(true);
    again.add('Simulink.Signal', 'sNew');
    expect(same(again.save(), once)).toBe(true);
    // One created before it and deleted, the other kept: the file as though only it were made.
    const kept = opened(target);
    const first = kept.add('Simulink.Parameter', 'gone');
    const signal = kept.add('Simulink.Signal', 'sNew');
    expect(kept.edit(signal, 'Description', 'kept')).toBe(true);
    expect(kept.remove(first)).toBe(true);
    const keptAlone = opened(target);
    expect(keptAlone.edit(keptAlone.add('Simulink.Signal', 'sNew'), 'Description', 'kept')).toBe(true);
    expect(same(kept.save(), keptAlone.save())).toBe(true);
    expect(subsystemCounts(kept.save())).toEqual(subsystemCounts(keptAlone.save()));
    // Its delete undone: both written again, as made.
    kept.session.undo();
    const both = opened(target);
    both.add('Simulink.Parameter', 'gone');
    expect(both.edit(both.add('Simulink.Signal', 'sNew'), 'Description', 'kept')).toBe(true);
    expect(same(kept.save(), both.save())).toBe(true);
  });

  it('a new Bus, its elements and a string kept beside it deleted: written as made', () => {
    const target = read('targets/r2023b/none.mat');
    const made = opened(target);
    const gone = made.add('Simulink.Bus', 'gone');
    made.addElement(gone);
    const bus = made.add('Simulink.Bus', 'bus');
    made.addElement(bus);
    expect(made.edit(bus.children[0], 'Name', 'x')).toBe(true);
    const s = made.add('string', 's');
    expect(made.edit(s, 'Value', '"text"')).toBe(true);
    expect(made.remove(gone)).toBe(true);
    const saved = made.save();
    const again = opened(saved);
    expect([shown(again.by('bus')), shown(again.by('s'))]).toEqual([shown(bus), shown(s)]);
    const only = opened(target);
    const b2 = only.add('Simulink.Bus', 'bus');
    only.addElement(b2);
    expect(only.edit(b2.children[0], 'Name', 'x')).toBe(true);
    expect(only.edit(only.add('string', 's'), 'Value', '"text"')).toBe(true);
    expect(same(saved, only.save())).toBe(true);
  });
});

describe('the self-check of a save that creates a variable', () => {
  it('refuses a new variable naming an object the file held, not its own', () => {
    const o = opened(read('targets/r2027a/param.mat'));
    const held = o.root.children.find((c: any) => c.className === 'Simulink.Parameter');
    const made = o.add('Simulink.Parameter', 'nv');
    const own = o.root._createdElement.bind(o.root);
    // The element made for it, naming the held Parameter's object in place of its own.
    o.root._createdElement = (n: any) => {
      const element = own(n);
      if (n !== made) return element;
      const d = readDescriptor(element)!;
      return objectReferenceElement('nv', 'Simulink.Parameter', { ...d, ids: o.root.recordOf(held).variable.mcosHandle.ids });
    };
    expect(() => o.save()).toThrow(/^Cannot save "f\.mat": the file written for it did not read back as written: the file's objects do not read back as the records written \(created variable 1 names object \d+ as one of class row \d+, and it is of row \d+\)\. Nothing was written\.$/);
    o.root._createdElement = own;
    expect(() => o.save()).not.toThrow();
  });
});

describe('the rebuild of the creations after one is deleted', () => {
  it("maps every object row of a creation, those it holds too, to its row in the subsystem written", () => {
    // A ValueType holds a BusElement of its own, an object of its own row; a LookupTable is not offered.
    const o = opened(read('targets/r2027a/param.mat'));
    const gone = o.add('Simulink.Parameter', 'gone');
    const vt = o.add('Simulink.ValueType', 'vt');
    expect(o.remove(gone)).toBe(true);
    const root = o.root;
    const before = root._creation.records;
    const rows: number[] = root._creation.rows.get(vt);
    expect(rows.length).toBeGreaterThan(1);
    const live = root._liveCreation();
    const state = root._objectState(vt);
    // A state naming every row of the creation, as one with a nested object's would.
    const nested = { ...state, objects: new Map(rows.map((id: number, i: number) => [String(i), { ...state.objects.get(''), objectId: id }])) };
    const moved = live.remap(vt, nested);
    const className = (sub: any, id: number) => sub.blob.strings[sub.blob.classes[sub.blob.objects[id].classIndex].name];
    for (const [i, id] of rows.entries()) {
      const to = moved.objects.get(String(i)).objectId;
      expect(to, String(id)).not.toBe(id);
      expect(className(live.records, to), String(id)).toBe(className(before, id));
    }
    expect(moved.objectId).toBe(live.objects.get(vt).objectId);
  });
});

describe("a cell's elements removed and undone", () => {
  // Measured on main too: a 1x2 cell left one element, then undone, came back 2x1, and was saved so.
  for (const [file, name] of [
    ['../../parity/artifacts/mat/cases.mat', 'cellNest'],
    ['../../parity/artifacts/mat/cases.mat', 'cellFlat'],
    ['../mcos-rules/str.mat', 'c'],
    ['../mat-cellswap/exp_nested_array.mat', 'c'],
  ] as const) {
    it(`${name} of ${file.split('/').pop()}: its shape kept, undone one removal at a time, and saved so`, () => {
      const original = read(file);
      const { session, by, remove, save } = opened(original);
      const c = by(name);
      const before = shown(opened(original).by(name));
      const shapes: number[][] = [c._dims.slice()];
      // Every element but the last removed, then each removal undone.
      while (c.children.length > 1) {
        expect(remove(c.children[0])).toBe(true);
        shapes.push(c._dims.slice());
      }
      expect(c._dims).toEqual([1, 1]);
      for (let k = shapes.length - 2; k >= 0; k--) {
        session.undo();
        expect(c._dims, `undone to ${k}`).toEqual(shapes[k]);
      }
      const again = opened(save()).by(name);
      expect([again._dims, shown(again)]).toEqual([shapes[0], before]);
      // Redone, it is the cell of one element it was.
      session.redo();
      expect(c._dims).toEqual(shapes[1]);
    });
  }
});

describe("a struct's field added and undone", () => {
  // Measured on main too: the undo renamed every field by position, and the save wrote '1', '2'.
  for (const [file, name] of [
    ['../../parity/artifacts/mat/cases.mat', 'structScalar'],
    ['../mcos/complex_objects.mat', 's'],
  ] as const) {
    it(`${name}: its fields keep their names, undone and redone, and are saved so`, () => {
      const original = read(file);
      const { session, by, save } = opened(original);
      const s = by(name);
      const fields = s.children.map((c: any) => c.name);
      const before = shown(opened(original).by(name));
      const added = session.addChildTo(s.id) as any;
      expect(added).not.toBeNull();
      const withField = shown(opened(save()).by(name));
      session.undo();
      expect(s.children.map((c: any) => c.name)).toEqual(fields);
      // Saved as read, or written again as it was: its fields and every value of them.
      expect(shown(opened(save()).by(name))).toEqual(before);
      session.redo();
      expect(s.children.map((c: any) => c.name)).toEqual([...fields, added.name]);
      expect(shown(opened(save()).by(name))).toEqual(withField);
    });
  }
});
