// Copyright 2026 The MathWorks, Inc.
//
// A struct's field renamed in a MAT-file, as a dictionary's is (StructNode): at any depth, in every
// element of a struct array, refused in the dictionary's words for a name MATLAB cannot load or one
// another field of the struct has, undone and redone; and saved, the struct written fresh under its
// rows' names, an object in it as the element it was read as, and every other record of the file
// as it was. Where a field's name is not the struct's to write, nothing changed: a value still in its
// stream (a dictionary's, a model workspace's), a cell's or an array's elements, a struct array's
// elements, and a variable stored after the file's objects. MATLAB's judgment of the saved files is
// test/matFieldRenameGoldens.test.ts.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession, ingest } from '../src/index.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { elementNamed, encodeMatVariable } from '../src/datamodel/parser/MatWriter.js';
import { nodeAt } from './tools/matlabPath.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const TEST = fileURLToPath(new URL('.', import.meta.url));
const read = (rel: string): Uint8Array => new Uint8Array(readFileSync(TEST + rel));
const bufferOf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const flat = (n: any, acc: any[] = []): any[] => (acc.push(n), n.children.forEach((c: any) => flat(c, acc)), acc);

/** A file opened in a session as a host opens it: a .mat, or a text or binary dictionary. */
function opened(bytes: Uint8Array, file = 'f.mat') {
  const session = createSession();
  const root: any = file.endsWith('.mat') ? session.addMatSource(file, bufferOf(bytes)) : ingest(session, bufferOf(bytes), { filename: file });
  const at = (path: string): any => flat(root).find((n) => n !== root && n.matlabPath === path);
  const edit = (path: string, key: string, value: string) => {
    const node = at(path);
    expect(node, path).toBeDefined();
    session.setActive(root, node);
    return session.editProperty(node.id, key, value);
  };
  const rename = (path: string, name: string) => edit(path, 'Name', name);
  const save = (): Uint8Array => {
    const r = session.serializeSource(root.name) as { bytes?: Uint8Array; text?: string };
    return r.bytes ?? new TextEncoder().encode(r.text!);
  };
  const again = () => opened(save(), file);
  return { session, root, at, edit, rename, save, again };
}

/** A value as its rows show it: each row's name, and a leaf's text. */
const shown = (n: any): unknown => (n.children.length === 0 ? n.displayValue : n.children.map((c: any) => [c.name, shown(c)]));

const VENUES = [
  ['parity/artifacts/mat/cases.mat', 'cases.mat'],
  ['parity/artifacts/text/cases.sldd', 'cases.sldd'],
  ['parity/artifacts/binary/cases.sldd', 'cases.sldd'],
] as const;

describe('a field renamed in a MAT-file as in a dictionary, text or binary', () => {
  // The same values, MATLAB wrote into each; the dictionary renames a field of each (StructNode).
  const LONG = 'a'.repeat(64);
  for (const path of ['structScalar.a', 'structNest.a.b', 'struct1x3(2).a', 'struct2x3(2,1).a']) {
    it(`${path}: refused with the dictionary's words, and taken`, () => {
      const answers = VENUES.map(([rel, file]) => {
        const o = opened(read(rel), file);
        const node = o.at(path);
        const sibling = node.parent.children.find((c: any) => c !== node)?.name;
        const refused = ['', '1a', 'a b', LONG, 'end', ...(sibling ? [sibling] : [])].map((name) => [name, o.rename(path, name)]);
        const taken = o.rename(path, 'renamed');
        const root = path.split(/[.(]/)[0];
        return { editable: node.nameEditable, refused, taken, saved: shown(o.again().at(root)) };
      });
      expect(answers[0].editable).toBe(true);
      expect(answers[0].taken).toBe(true);
      expect(answers[0].refused.every(([, r]) => (r as any).error === true)).toBe(true);
      expect(answers[0].refused.map(([, r]) => (r as any).reason).slice(0, 5)).toEqual([
        'Name cannot be empty',
        'Invalid MATLAB name. Must start with a letter and contain only letters, digits, and underscores',
        'Invalid MATLAB name. Must start with a letter and contain only letters, digits, and underscores',
        'Name exceeds maximum length of 63 characters',
        "'end' is a reserved MATLAB keyword",
      ]);
      expect(answers[1]).toEqual(answers[0]);
      expect(answers[2]).toEqual(answers[0]);
    });
  }

  it("a name another field of the struct has, said of the struct, as a dictionary says it", () => {
    for (const [rel, file] of VENUES) {
      const o = opened(read(rel), file);
      expect(o.rename('structScalar.a', 'b'), rel).toMatchObject({ error: true, reason: "'b' already names another member of structScalar" });
      expect(o.rename('struct1x3(3).b', 'a'), rel).toMatchObject({ error: true, reason: "'a' already names another member of struct1x3(3)" });
    }
  });
});

describe('a struct array holds one list of fields', () => {
  for (const [variable, element] of [['struct1x3', 'struct1x3(2)'], ['struct2x3', 'struct2x3(2,1)'], ['structNd', 'structNd(2,2,1)']] as const) {
    it(`${variable}: a field renamed in ${element} is renamed in every element, undone and redone so, and saved so`, () => {
      const o = opened(read('parity/artifacts/mat/cases.mat'));
      const array = o.at(variable);
      const fields = array.children[0].children.map((c: any) => c.name);
      const named = (n: any) => n.children.map((e: any) => e.children.map((c: any) => c.name));
      const every = (list: string[]) => array.children.map(() => list);
      expect(o.rename(element + '.a', 'renamed')).toBe(true);
      const renamed = fields.map((f: string) => (f === 'a' ? 'renamed' : f));
      expect(named(array)).toEqual(every(renamed));
      expect(named(o.again().at(variable))).toEqual(every(renamed));
      // Its elements' names are their positions, as before.
      expect(array.children.map((e: any) => e.nameEditable)).toEqual(array.children.map(() => false));
      o.session.undo();
      expect(named(array)).toEqual(every(fields));
      expect(named(o.again().at(variable))).toEqual(every(fields));
      o.session.redo();
      expect(named(o.again().at(variable))).toEqual(every(renamed));
    });
  }
});

describe('undone and redone through the session, and saved each time as shown', () => {
  it('a field of a struct and of a nested one, renamed twice', () => {
    const o = opened(read('parity/artifacts/mat/cases.mat'));
    const before = shown(o.at('structNest'));
    expect(o.rename('structNest.a.b', 'c')).toBe(true);
    expect(o.rename('structNest.a', 'outer')).toBe(true);
    expect(shown(o.again().at('structNest'))).toEqual([['outer', [['c', '2']]]]);
    o.session.undo();
    expect(shown(o.again().at('structNest'))).toEqual([['a', [['c', '2']]]]);
    o.session.undo();
    expect(shown(o.at('structNest'))).toEqual(before);
    expect(shown(o.again().at('structNest'))).toEqual(before);
    o.session.redo();
    o.session.redo();
    expect(shown(o.again().at('structNest'))).toEqual([['outer', [['c', '2']]]]);
  });

  it('renamed, then its value edited, and the other way round', () => {
    const o = opened(read('parity/artifacts/mat/cases.mat'));
    expect(o.rename('structScalar.a', 'x')).toBe(true);
    // The value it was read as, under its new name.
    expect([o.at('structScalar.x')._varStale, o.at('structScalar.x')._var.name]).toEqual([false, 'x']);
    expect(o.edit('structScalar.x', 'Value', '5')).toBe(true);
    expect(o.edit('structScalar.b', 'Value', "'new'")).toBe(true);
    expect(o.rename('structScalar.b', 'y')).toBe(true);
    expect(shown(o.again().at('structScalar'))).toEqual([['x', '5'], ['y', "'new'"]]);
  });
});

/** The records of a MAT-file by name ('' for the subsystem), each its bytes. */
function recordsOf(bytes: Uint8Array): Map<string, Buffer> {
  const parsed = parseMat(bufferOf(bytes));
  return new Map(parsed.records.map((r) => [r.name ?? '?', Buffer.from(r.bytes)]));
}

/** That `saved` holds every record of `original` but those named in `written` as it was, the file's objects included. */
function expectKept(original: Uint8Array, saved: Uint8Array, written: string[]) {
  const was = recordsOf(original);
  const is = recordsOf(saved);
  expect([...is.keys()].sort()).toEqual([...was.keys()].sort());
  for (const [name, bytes] of was) {
    if (!written.includes(name)) {
      expect(Buffer.compare(is.get(name)!, bytes), name || 'the subsystem').toBe(0);
    }
  }
}

describe('a struct holding objects, or beside them', () => {
  it("an object's field renamed: the struct written fresh, each object as the element it was read as, the file's objects and every other variable as they were", () => {
    const original = read('fixtures/mcos/nested_objects.mat');
    const o = opened(original);
    const was = ['s.p', 's.sub.q', 'sa(1).p', 'sa(2).p'].map((p) => [o.at(p).className, shown(o.at(p))]);
    expect(o.rename('s.p', 'param')).toBe(true);
    expect(o.rename('s.sub.q', 'sig')).toBe(true);
    // In a struct array, in every element.
    expect(o.rename('sa(1).p', 'pp')).toBe(true);
    const saved = o.save();
    expectKept(original, saved, ['s', 'sa']);
    const again = opened(saved);
    expect(['s.param', 's.sub.sig', 'sa(1).pp', 'sa(2).pp'].map((p) => [again.at(p)?.className, shown(again.at(p))])).toEqual(was);
    expect(['s.p', 's.sub.q', 'sa(1).p'].map((p) => again.at(p))).toEqual([undefined, undefined, undefined]);
  });

  it('renamed, then its object edited; and edited, then renamed', () => {
    for (const renameFirst of [true, false]) {
      const original = read('fixtures/mat-cellswap/pv_nested.mat');
      const o = opened(original);
      if (renameFirst) {
        expect(o.rename('s.p', 'q')).toBe(true);
        expect(o.edit('s.q', 'Value', '7')).toBe(true);
      } else {
        expect(o.edit('s.p', 'Value', '7')).toBe(true);
        expect(o.rename('s.p', 'q')).toBe(true);
      }
      const again = opened(o.save());
      expect([again.at('s.q')?.className, again.at('s.q')?.getPropInfo(again.at('s.q').getProperties().find((p: any) => p.key === 'Value')).displayValue], String(renameFirst)).toEqual(['Simulink.Parameter', '7']);
    }
  });

  it("a plain struct beside the file's objects: they, and every other variable, are as they were", () => {
    const original = read('parity/artifacts/mat/cases.mat');
    const o = opened(original);
    expect(o.rename('structScalar.a', 'alpha')).toBe(true);
    expectKept(original, o.save(), ['structScalar']);
  });

  it("a field of an object's struct Value, which an edit of the object writes, as it did", () => {
    const o = opened(read('fixtures/mat-field-rename/targets/ps_struct_value.mat'));
    expect(o.rename('ps.Value.a', 'zz')).toBe(true);
    expect(shown(o.again().at('ps.Value'))).toEqual([['zz', '1'], ['b', '2']]);
  });
});

describe("where a field's name is not the struct's to write, nothing changed", () => {
  const names = (n: any) => n.children.map((c: any) => c.nameEditable);
  const none = (n: any) => n.children.map(() => false);

  // A text dictionary's struct held as a MAT stream of plain values renames its fields, as a MAT-file
  // does (test/textStreamContainers.test.ts), and so does a dictionary's struct in a MAT stream
  // holding objects, which a save writes anew around them (test/slddStreamObjects.test.ts).

  it("a model workspace's struct, which is its stream", async () => {
    const { loadFile } = await import('./parity/loadFile.js');
    const cfg = nodeAt((loadFile('../fixtures/mcos/nested_ws.slx') as any).getSection('workspace'), 'cfg');
    expect(cfg.children.length).toBeGreaterThan(0);
    expect(names(cfg)).toEqual(none(cfg));
    expect(cfg.children[0].setProperty('Name', 'renamed')).toMatchObject({ error: true });
  });

  it("a cell's elements, an array's, and a struct array's, which are their positions", () => {
    const o = opened(read('parity/artifacts/mat/cases.mat'));
    for (const v of o.root.children.filter((c: any) => c.children.length > 0 && (c._kind === 'cell' || c._kind === 'array' || (c._scalarType === 'struct' && !c._holdsFields())))) {
      expect(names(v), v.name).toEqual(none(v));
    }
    expect(o.rename('cellFlat{2}', 'x')).toMatchObject({ error: true });
  });

  it("a variable stored after the file's objects, which MATLAB does not read", () => {
    // Param.mat, and after its subsystem a struct.
    const late = elementNamed(encodeMatVariable({
      name: 'late',
      className: 'struct',
      dimensions: [1, 1],
      isComplex: false,
      isLogical: false,
      value: null,
      fields: { a: { name: 'a', className: 'double', dimensions: [1, 1], isComplex: false, isLogical: false, value: 1, fields: null } },
    }), 'late')!;
    const param = read('fixtures/mcos/Param.mat');
    const bytes = new Uint8Array(param.length + late.length);
    bytes.set(param);
    bytes.set(late, param.length);
    const o = opened(bytes);
    expect(o.at('late.a')?.nameEditable).toBe(false);
    expect(o.rename('late.a', 'b')).toMatchObject({
      error: true,
      reason: "Cannot edit \"late\": it is stored after the file's objects, where MATLAB does not read it, so it would not be read written there, and moved, it would change what MATLAB loads of the file.",
    });
  });
});

describe('every field rename a MAT-file of the test tree offers', () => {
  function mats(dir: string, acc: string[] = []): string[] {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) mats(p, acc);
      else if (f.endsWith('.mat')) acc.push(p);
    }
    return acc;
  }

  // Every field rename of the test tree, saved and read back: 1.2 s alone, up to 4.2 s in a full run.
  it('is saved, and read back under its new name: none is taken and then refused', { timeout: 30_000 }, () => {
    let offered = 0;
    const wrong: string[] = [];
    for (const file of mats(TEST)) {
      const bytes = new Uint8Array(readFileSync(file));
      let fields: string[];
      try {
        const root: any = createSession().addMatSource('f.mat', bufferOf(bytes));
        fields = root.children.flatMap((v: any) => flat(v).filter((n) => n !== v && n.nameEditable && !(n.parent?.className === 'Simulink.Bus')).map((n) => n.matlabPath));
      } catch {
        continue;
      }
      for (const path of fields.slice(0, 40)) {
        offered++;
        const o = opened(bytes);
        const siblings = o.at(path).parent.children.map((c: any) => c.name);
        let name = 'rn';
        for (let k = 1; siblings.includes(name); k++) name = 'rn' + k;
        const renamed = path.replace(/[^.]+$/, name);
        const taken = o.rename(path, name);
        if (taken !== true) {
          wrong.push(`${file} ${path}: refused, offered (${JSON.stringify(taken)})`);
          continue;
        }
        try {
          if (!o.again().at(renamed)) wrong.push(`${file} ${path}: not read back as ${renamed}`);
        } catch (e) {
          wrong.push(`${file} ${path}: taken, then refused by the save (${(e as Error).message})`);
        }
      }
    }
    expect(offered).toBeGreaterThan(300);
    expect(wrong).toEqual([]);
  });
});
