// Copyright 2026 The MathWorks, Inc.
//
// The edits a `.mat` takes are the edits its save writes (MatNode._editRefusal, the one rule
// BaseNode.sourceEditRefusal asks for every path an edit takes). Swept over every Level-5 fixture
// and MATLAB's verdict corpus, both ways:
//
//   - the gate is the writer: for every variable, an edit forced around the gate (its value, its
//     name) is refused by the save exactly where the gate refuses it;
//   - every cell the editor offers takes an edit, and the save of that edit is written and reads
//     back as the tree shows it; every child Add or Delete it offers saves too;
//   - every cell it does not offer for the save's sake has no editor anywhere a host looks (the
//     table row, the Property Inspector, the DTO, the getters), and its setter refuses it, as do
//     the session's editProperty and the structural gates, leaving the file unchanged.
//
// Then each refusal by itself, in its own words, and what a MAT-file's save adds to the session:
// readOnly, addEntry, the rename's duplicate message.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { checkMatFile, violationsAdded } from '../src/datamodel/parser/MatFileCheck.js';
import { sourceEditRefusal } from '../src/datamodel/node/BaseNode.js';
import { mcosPlaceOf } from '../src/datamodel/node/mcosPlace.js';
import { objectNodeAt } from '../src/datamodel/node/data/mcosObjectEdit.js';
import MatNode from '../src/datamodel/node/container/MatNode.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import { toDTO } from '../src/core/dto.js';
import { createSession } from '../src/index.js';
import { zlibSync } from 'fflate';
import { CLASS, cellVar, matFile, numericVar, structVar, u32le } from './tools/matBytes.js';

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));
const MAT_CHECK = join(TEST_ROOT, 'fixtures', 'mat-check');

function matFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (abs !== MAT_CHECK) {
        out.push(...matFilesUnder(abs));
      }
    } else if (entry.isFile() && entry.name.endsWith('.mat') && entry.name !== 'strings_v73.mat') {
      out.push(abs);
    }
  }
  return out.sort();
}

const FIXTURES = matFilesUnder(TEST_ROOT);
const shown = (abs: string) => abs.slice(TEST_ROOT.length);

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const fileBytes = (abs: string) => arrayBufferOf(new Uint8Array(readFileSync(abs)));
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);
const scalar = (name: string, value: number) => numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, 1], real: [value] });

/** A MatNode opened through the session, as a host opens one, and what a host does to it. */
function opened(bytes: ArrayBuffer, name = 'f.mat') {
  const session = createSession();
  const root: any = session.addMatSource(name, bytes);
  const by = (n: string) => root.children.find((c: any) => c.name === n);
  const edit = (node: any, prop: string, value: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, prop, value);
  };
  const save = (): Uint8Array => (session.serializeSource(name) as { bytes: Uint8Array }).bytes;
  return { session, root, by, edit, save };
}

/** Every node under `node`, depth first, with its path of child indices from the file. */
function nodesWithPaths(root: any): { node: any; path: number[] }[] {
  const out: { node: any; path: number[] }[] = [];
  const walk = (n: any, path: number[]) => {
    n.children.forEach((c: any, i: number) => {
      out.push({ node: c, path: [...path, i] });
      walk(c, [...path, i]);
    });
  };
  walk(root, []);
  return out;
}

const at = (root: any, path: number[]) => path.reduce((n, i) => n?.children[i], root);

/**
 * `nodes` thinned to what a sweep can afford: of the elements of one array, which are one class
 * and take one edit, the first two and the last; and of a tree still past 2,500 nodes (the shared
 * object graphs, of 30,000), an even stride through it.
 */
function sampled<T extends { node: any }>(nodes: T[]): T[] {
  const kept = nodes.filter(({ node }) => {
    const parent = node.parent;
    if (!parent || (parent._kind !== 'array' && parent._kind !== 'string')) {
      return true;
    }
    const i = parent.children.indexOf(node);
    return i < 2 || i === parent.children.length - 1;
  });
  if (kept.length <= 2500) {
    return kept;
  }
  const stride = Math.ceil(kept.length / 2500);
  return kept.filter((_, i) => i % stride === 0);
}

/**
 * What a variable shows, everywhere a value is: each node's label, value and class, by path. Two
 * things a save writes as they are and the tree shows otherwise until the file is read again are
 * left out of it. A complex part `+0i`: an element of a complex array added or set to a real
 * number shows as that number, and reads back as the same element with the imaginary part 0
 * MATLAB gives it (`x(3) = 0` of a complex `x` is `0+0i`). And a sparse array's row set to 0: it
 * keeps its row, so that the row still names it (MatlabVariableNode._syncElementFromChild), and a
 * zero is no non-zero once read again; the rows of a sparse array are said by their subscripts.
 */
function shownAs(node: any): string[] {
  const out: string[] = [];
  const walk = (n: any, path: string) => {
    out.push(`${path} ${n.displayName} = ${String(n.displayValue).replace(/(\d|Inf|NaN)\+0i/g, '$1')} (${n.className})`);
    n.children.forEach((c: any, i: number) => {
      if (n._sparse && /^(0|false|0\+0i)$/.test(c.displayValue)) {
        return;
      }
      walk(c, path + '/' + (n._sparse ? c.displayName : i));
    });
  };
  walk(node, '');
  return out;
}

/** The bytes of a save, read again, and the variable at `entry` there, as it shows. */
function readBack(bytes: Uint8Array, entry: number): string[] {
  const { root } = opened(arrayBufferOf(bytes), 'saved.mat');
  return shownAs(root.children[entry]);
}

/** The thrown error of `fn`, or null. */
function thrownBy(fn: () => unknown): Error | null {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  return null;
}

/**
 * An edit `node` takes for its property `key`, by what it is, and whether it took it: a Value's by
 * what the value is (valueEdit), a bound's a number on the side of the other bound that holds, and
 * a text's a word.
 */
function propertyEdit(edit: (prop: string, value: string) => unknown, node: any, key: string): string | null {
  if (key === 'Value') {
    return valueEdit(edit, node);
  }
  const bound = (b: unknown) => (typeof b === 'number' ? b : null);
  // A select (a Storage Class, a Complexity, a DimensionsMode): every option it offers but the one shown.
  const prop = node.getProperties().find((p: any) => p.key === key);
  const info = prop ? node.getPropInfo(prop) : null;
  const options: string[] | null = prop && prop.editor === 'select' ? (info.options ?? prop.options ?? null) : null;
  const candidates = options
    ? options.map(String).filter((o) => o !== info.displayValue)
    : key === 'alignment'
      ? ['8', '16']
    : key === 'dimensions'
      ? ['[2 3]', '4', '[1 2]']
    : key === 'Min'
      ? [String((bound(node.Max) ?? 1) - 1), '0', '-1']
      : key === 'Max'
        ? [String((bound(node.Min) ?? 0) + 1), '9', '1']
        : ['zz edited', 'zz'];
  for (const value of candidates) {
    if (edit(key, value) === true) {
      return value;
    }
  }
  return null;
}

/** An edit `node` takes for its Value, by what it is, and whether it took it. */
function valueEdit(edit: (prop: string, value: string) => unknown, node: any): string | null {
  const parent = node.parent;
  const inArray = parent && parent._kind === 'array';
  // A string's text, whole or an element: a string, or for an element a char too.
  const candidates =
    node.className === 'string' || parent?._kind === 'string'
      ? ['"zz edited"', "'zz'"]
      : inArray && parent._scalarType === 'logical'
      ? ['false', 'true']
      : inArray
        ? ['7', '8']
        : node.className === 'char'
          ? ["'zz'", '7']
          : node._kind === 'cell'
            ? ['{7, 8}', '7']
            : node.className === 'logical'
              ? ['false', 'true', '7']
              : ['7', '8', "'zz'", '[1 2 3]', '{7}', 'true'];
  for (const value of candidates) {
    if (value === node.displayValue) {
      continue;
    }
    if (edit('Value', value) === true) {
      return value;
    }
  }
  return null;
}

/**
 * Every top-level variable of `bytes`, each with an edit of its value and of its name forced
 * around the gate: the save refuses the first exactly where the gate refuses a value edit, and
 * the second exactly where it refuses a rename. Answers how many of each were written.
 *
 * Of an MCOS object's node (mcosPlaceOf), a value edit forced so is an edit of its properties
 * that changes none of them: the save writes the object's cells, of which none changed, and so
 * writes the file as it was, or refuses where the gate refuses what holds the object, the file
 * or its place in it. The gate's word on each property is test/mcosObjectEdit.test.ts's.
 */
function gateIsWriter(bytes: ArrayBuffer, file: string): { values: number; names: number } {
  let values = 0;
  let names = 0;
  const count = opened(bytes).root.children.length;
  for (let i = 0; i < count; i++) {
    for (const what of ['value', 'name'] as const) {
      const { root, save } = opened(bytes);
      const node = root.children[i];
      // A rename is asked of the record too, as the rename itself asks it (MatNode._renameRefusal).
      const refused = what === 'name' ? sourceEditRefusal(node, 'Name') ?? root._renameRefusal(node) : sourceEditRefusal(node, 'Value');
      const label = `${file}: ${node.name} (${what})`;
      if (what === 'name') {
        // A name no variable of the file holds, made around the session's rename.
        node.name = 'gateRenamed' + i;
        node._markModified('name');
      } else {
        node._markModified();
      }
      const thrown = thrownBy(save);
      if (what === 'value' && mcosPlaceOf(node)) {
        if (thrown) {
          expect([thrown instanceof MatWriteError, !!refused], label + ': ' + thrown.message).toEqual([true, true]);
        } else {
          expect(sameBytes(save(), new Uint8Array(bytes)), label + ': nothing changed, and nothing written').toBe(true);
          values++;
        }
      } else if (refused) {
        expect(thrown, label + ': the gate refuses it, ' + refused).toBeInstanceOf(MatWriteError);
      } else {
        expect(thrown?.message, label).toBeUndefined();
        expect(readBack(save(), i), label).toEqual(shownAs(node));
        what === 'name' ? names++ : values++;
      }
    }
  }
  return { values, names };
}

describe('the gate is the writer: an edit forced around it is refused by the save exactly where it is refused', () => {
  const totals = { values: 0, names: 0 };
  for (const file of FIXTURES) {
    it(shown(file), { timeout: 60_000 }, () => {
      const { values, names } = gateIsWriter(fileBytes(file), shown(file));
      totals.values += values;
      totals.names += names;
    });
  }

  it("MATLAB's verdict corpus (test/fixtures/mat-check), the files it loads and the ones it does not", { timeout: 60_000 }, () => {
    const verdicts: { file: string }[] = JSON.parse(readFileSync(join(MAT_CHECK, 'verdicts.json'), 'utf8'));
    let opened = 0;
    for (const { file } of verdicts) {
      let bytes: ArrayBuffer;
      try {
        bytes = fileBytes(join(MAT_CHECK, file));
        parseMat(bytes);
      } catch {
        continue;
      }
      gateIsWriter(bytes, file);
      opened++;
    }
    expect(opened).toBeGreaterThanOrEqual(60);
  });

  it('writes most variables of the fixtures, fresh and renamed: the gate refuses only what it must', () => {
    expect(totals.values).toBeGreaterThanOrEqual(150);
    expect(totals.names).toBeGreaterThanOrEqual(300);
  });
});

describe('every cell the editor offers takes an edit, and its save reads back as the tree shows it', () => {
  for (const file of FIXTURES) {
    it(shown(file), { timeout: 60_000 }, () => {
      const bytes = fileBytes(file);
      const { root: probe } = opened(bytes);
      let edits = 0;
      for (const { node: seen, path } of sampled(nodesWithPaths(probe))) {
        const offered = seen.getProperties().filter((p: any) => seen.getPropInfo(p).editable).map((p: any) => p.key);
        for (const key of offered) {
          const { root, edit, save } = opened(bytes);
          const node = at(root, path);
          const label = `${shown(file)}: ${node.matlabPath} ${key}`;
          let made: string | null;
          if (key === 'Name') {
            made = 'cellRenamed' + edits;
            expect(edit(node, 'Name', made), label).toBe(true);
          } else {
            made = propertyEdit((prop, value) => edit(node, prop, value), node, key);
            expect(made, label + ': no edit taken').not.toBeNull();
          }
          const saved = thrownBy(save);
          expect(saved?.message, label + ' = ' + made).toBeUndefined();
          expect(readBack(save(), path[0]), label + ' = ' + made).toEqual(shownAs(root.children[path[0]]));
          // An object's property, which no row shows, reads back as the editor shows it.
          if (mcosPlaceOf(node) && key !== 'Name') {
            const prop = node.getProperties().find((p: any) => p.key === key);
            expect(at(opened(arrayBufferOf(save()), 'saved.mat').root, path).getPropInfo(prop).displayValue, label).toBe(node.getPropInfo(prop).displayValue);
          }
          edits++;
        }
        for (const op of ['add', 'remove'] as const) {
          if (op === 'add' ? !seen.canAddChild() : !(seen.canRemoveChild?.() && seen.children.length > 0)) {
            continue;
          }
          const { session, root, save } = opened(bytes);
          const node = at(root, path);
          const label = `${shown(file)}: ${node.matlabPath} ${op}`;
          if (op === 'add') {
            expect(session.addChildTo(node.id), label).not.toBeNull();
          } else {
            const last = node.children[node.children.length - 1];
            session.setActive(root, last);
            expect(session.deleteNodeById(last.id), label).toBe(true);
          }
          expect(thrownBy(save)?.message, label).toBeUndefined();
          expect(readBack(save(), path[0]), label).toEqual(shownAs(root.children[path[0]]));
          edits++;
        }
      }
      // Every variable can be deleted, and the file saves without it.
      for (let i = 0; i < probe.children.length; i++) {
        const { session, root, save } = opened(bytes);
        const node = root.children[i];
        session.setActive(root, node);
        expect(session.deleteNodeById(node.id), node.name).toBe(true);
        expect(thrownBy(save)?.message, node.name).toBeUndefined();
      }
      if (probe.children.some((c: any) => !sourceEditRefusal(c, 'Value'))) {
        expect(edits).toBeGreaterThan(0);
      }
    });
  }
});

describe('every cell the save would refuse has no editor anywhere a host looks, and every path refuses its edit', () => {
  for (const file of FIXTURES) {
    it(shown(file), { timeout: 60_000 }, () => {
      const bytes = fileBytes(file);
      const original = new Uint8Array(bytes);
      const { session, root, edit, save } = opened(bytes);
      let refused = 0;
      for (const { node } of sampled(nodesWithPaths(root))) {
        const label = `${shown(file)}: ${node.matlabPath}`;
        const row = node.toRow();
        const dto = toDTO(node);
        // What a host reads is one answer, the getters' and getPropInfo's.
        expect(row.Name.editable, label).toBe(node.getPropInfo(node.getProperties().find((p: any) => p.key === 'Name')).editable);
        expect(row._valueEditable, label).toBe(node.getProperties().some((p: any) => p.key === 'Value') ? node.getPropInfo(node.getProperties().find((p: any) => p.key === 'Value')).editable : node.valueEditable);
        expect(row._descriptionEditable, label).toBe(node.descriptionEditable);
        dto.props.forEach((p: any, k: number) => expect(p.editable, label + ' ' + p.key).toBe(node.getPropInfo(node.getProperties()[k]).editable));
        // At or under an MCOS object's node a refusal is the property's: one property may take an
        // edit where the next does not, and each that does not has no editor and refuses its edit.
        if (objectNodeAt(node.owningEntry ?? node, node)) {
          for (const p of node.getProperties()) {
            const why = p.key === 'Name' ? null : sourceEditRefusal(node, p.key);
            if (why) {
              const typed = node.getPropInfo(p).displayValue === '7' ? '8' : '7';
              expect(node.getPropInfo(p).editable, label + ' ' + p.key).toBe(false);
              expect(edit(node, p.key, typed), label + ' ' + p.key).toMatchObject({ error: true });
              refused++;
            }
          }
        }
        const frozenValue = objectNodeAt(node.owningEntry ?? node, node) ? null : sourceEditRefusal(node, 'Value');
        const frozenName = sourceEditRefusal(node, 'Name');
        if (frozenName) {
          expect([node.nameEditable, row.Name.editable], label).toEqual([false, false]);
          const answer: any = edit(node, 'Name', 'refusedName');
          expect(answer, label).toMatchObject({ error: true, reason: frozenName });
          expect(node.setProperty('Name', 'refusedName'), label).toMatchObject({ error: true });
          refused++;
        }
        if (frozenValue) {
          for (const p of node.getProperties()) {
            if (p.key !== 'Name') {
              expect(node.getPropInfo(p).editable, label + ' ' + p.key).toBe(false);
            }
          }
          expect([node.valueEditable, row._valueEditable, node.descriptionEditable], label).toEqual([false, false, false]);
          expect([node.canAddChild(), node.canRemoveChild?.() ?? false], label).toEqual([false, false]);
          expect(session.addChildTo(node.id), label).toBeNull();
          for (const value of ['7', "'zz'", '{1}']) {
            if (value === node.displayValue) {
              continue;
            }
            expect(edit(node, 'Value', value), label + ' = ' + value).toMatchObject({ error: true });
            expect(node.setProperty('Value', value), label + ' = ' + value).toMatchObject({ error: true });
          }
          // An object beside plain values of a struct or a cell a save writes fresh is written as it
          // was read, and its own rows take no edit; its parent takes its delete, which is an edit
          // of the parent's.
          if (node.parent !== root && sourceEditRefusal(node.parent, 'Value')) {
            session.setActive(root, node);
            expect(session.deleteNodeById(node.id), label).toBe(false);
          }
          refused++;
        }
      }
      // Nothing it refused changed the file.
      expect(root.dirty).toBe(false);
      expect(sameBytes(save(), original)).toBe(true);
      if (refused === 0) {
        // Of a variable that has a Value: an object of a class with none (an AliasType) refuses one.
        expect(root.children.every((c: any) => !c.getProperties().some((p: any) => p.key === 'Value') || !sourceEditRefusal(c, 'Value'))).toBe(true);
      }
    });
  }
});

const CASES = join(TEST_ROOT, 'parity/artifacts/mat/cases.mat');
const fixture = (rel: string) => fileBytes(join(TEST_ROOT, rel));

describe('what each kind of variable of a .mat takes', () => {
  const editRefused = (name: string, what: string) =>
    `Cannot edit "${name}": it is ${what}, which a MAT-file save writes only as it was read, or renamed, so its edit cannot be saved.`;

  it("an object's typed node: each property its save writes into the object's cell, its name, a delete, at any depth", () => {
    // ParamMat.mat's Simulink.Parameter holds a 2x3 matrix (a Value row, and a row per element) and
    // a Description; it is at its default for every other property but those MATLAB derives.
    const deep = opened(fixture('fixtures/mcos/ParamMat.mat')).root.children[0];
    expect(deep.flatten().length).toBe(8);
    // A property at its default takes an edit too: the save inserts its triple (McosPropertyRules).
    for (const node of deep.flatten()) {
      const offered = node.getProperties().filter((p: any) => node.getPropInfo(p).editable).map((p: any) => p.key);
      expect(offered, node.matlabPath).toEqual(node === deep ? ['Name', 'Value', 'DataType', 'Min', 'Max', 'Unit', 'Description', 'storageClass'] : ['Value']);
    }
    const { session, root, by, edit, save } = opened(fileBytes(CASES), 'cases.mat');
    const param = by('aParam');
    expect(param.constructor.name).toBe('ParameterNode');
    expect(param.getProperties().filter((p: any) => param.getPropInfo(p).editable).map((p: any) => p.key)).toEqual(['Name', 'Value', 'DataType', 'Min', 'Max', 'Unit', 'Description', 'storageClass']);
    // What it does not take, refused in the save's own words, by the session and by the node.
    for (const [prop, why] of [
      ['complexity', 'aParam.Complexity follows its Value, and is written only with it'],
      ['dimensions', 'aParam.Dimensions follows its Value, and is written only with it'],
      ['alignment', "aParam.CoderInfo.Alignment is set only under a StorageClass other than 'Auto', which MATLAB refuses it under"],
    ]) {
      const reason = 'Cannot edit "aParam": ' + why + '.';
      expect(edit(param, prop, 'int8'), prop).toEqual({ error: true, reason, invalidValue: 'int8', validValue: expect.any(String) });
      expect(param.setProperty(prop, 'int8'), prop).toMatchObject({ error: true, reason });
    }
    // A custom storage class, which the rules refuse by its value, and so the file offers no
    // choice of: refused as none of the choices it offers.
    expect(param.getPropInfo(param.getProperties().find((p: any) => p.key === 'storageClass')).options).not.toContain('Custom');
    expect(edit(param, 'storageClass', 'Custom')).toMatchObject({ error: true, reason: 'Invalid value for Storage Class' });
    expect([param.status, root.dirty]).toEqual(['', false]);
    // What it takes is written into the object's cells, and the variable's record is as it was. Its
    // Unit, which the file holds, takes an edit too, by a host that asks for one: the table offers
    // no editor for it (PropUnit is a label).
    expect([edit(param, 'Value', '3'), edit(param, 'Description', 'edited'), edit(param, 'Unit', 'km')]).toEqual([true, true, true]);
    expect(edit(param, 'Name', 'renamedParam')).toBe(true);
    const saved = opened(arrayBufferOf(save()));
    expect([saved.by('renamedParam').displayValue, saved.by('renamedParam').Description, saved.by('renamedParam').Unit]).toEqual(['3', 'edited', 'km']);
    expect(readBack(save(), root.children.indexOf(param))).toEqual(shownAs(param));
    session.setActive(root, param);
    expect(session.deleteNodeById(param.id)).toBe(true);
    expect(opened(arrayBufferOf(save())).by('renamedParam')).toBeUndefined();
  });

  it('a function handle, a value not decoded: renamed and deleted, their values not edited; a string, its text edited', () => {
    // A string's text is written into its payload, an object of the file's (matObjectEdit); a value
    // of another class typed over it is refused, as another variable.
    const strings = opened(fileBytes(CASES));
    const str = strings.by('strScalar');
    expect([str.nameEditable, str.valueEditable]).toEqual([true, true]);
    expect(strings.edit(str, 'Value', '5')).toMatchObject({ error: true, reason: expect.stringMatching(/strScalar is a string, which a save writes as the object it is, so it takes only a string/) });
    expect(strings.edit(str, 'Value', '"xyz"')).toBe(true);
    expect(readBack(strings.save(), strings.root.children.indexOf(str))).toEqual(shownAs(str));
    const z = numericVar({ name: 'z', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [3], imag: [4] });
    z[16] = 0xff;
    const cases: [ArrayBuffer, string, string][] = [
      [fixture('fixtures/display/dispcat_opaque.mat'), 'fh_sin', 'a function handle'],
      [matFile([scalar('a', 1), z]), 'z', 'a value that was not decoded'],
    ];
    for (const [bytes, name, what] of cases) {
      const { root, by, edit, save } = opened(bytes);
      const node = by(name);
      expect([node.nameEditable, node.valueEditable, node.toRow()._valueEditable], name).toEqual([true, false, false]);
      expect(edit(node, 'Value', '5'), name).toMatchObject({ error: true });
      expect(node.setProperty('Value', '5'), name).toMatchObject({ error: true });
      expect(sourceEditRefusal(node, 'Value'), name).toBe(editRefused(name, what));
      expect(root.dirty, name).toBe(false);
      expect(edit(node, 'Name', name + 'R'), name).toBe(true);
      const index = root.children.indexOf(node);
      expect(readBack(save(), index), name).toEqual(shownAs(node));
    }
  });

  it('a plain variable holding an object, at any depth: a plain field beside it, renamed and deleted', () => {
    const { root, by, edit, save } = opened(fixture('fixtures/mcos/complex_objects.mat'));
    const s = by('s');
    const z = s.children.find((c: any) => c.name === 'z');
    // The struct is written fresh, its objects as the elements they were read as.
    expect([z.valueEditable, s.canAddChild()]).toEqual([true, true]);
    expect(sourceEditRefusal(z, 'Value')).toBeNull();
    expect(edit(z, 'Value', '5')).toBe(true);
    expect(edit(s, 'Name', 'sR')).toBe(true);
    expect(readBack(save(), root.children.indexOf(s))).toEqual(shownAs(s));
  });

  it('a plain variable: every cell, and Add and Delete of its rows, as the table offers them', () => {
    const { by } = opened(fileBytes(CASES), 'cases.mat');
    expect([by('kp').nameEditable, by('kp').valueEditable]).toEqual([true, true]);
    expect(by('mat2x3').children.every((c: any) => c.valueEditable)).toBe(true);
    expect([by('cellFlat').canAddChild(), by('structScalar').canAddChild(), by('rowVec').canAddChild()]).toEqual([true, true, true]);
  });

  it('a struct array, and each element of one, takes no Add: a save writes a field into every element or none', () => {
    const { session, root, by, save } = opened(fileBytes(CASES), 'cases.mat');
    const array = by('struct1x3');
    const original = new Uint8Array(fileBytes(CASES));
    for (const node of [array, array.children[0]]) {
      expect(node.canAddChild(), node.matlabPath).toBe(false);
      expect(session.addChildTo(node.id), node.matlabPath).toBeNull();
      expect(sourceEditRefusal(node, 'Add')).toBe(
        'Cannot edit "struct1x3": struct1x3 is a 1x3 struct, whose fields a save writes into every element of it or none, and Add gives one struct a field of its own.',
      );
    }
    // Its elements' fields take their edits, as before.
    expect(array.children[0].children[0].valueEditable).toBe(true);
    expect([root.dirty, sameBytes(save(), original)]).toEqual([false, true]);
  });

  it("a value typed in that a save cannot write, a string, is refused before it is made", () => {
    const { root, by, edit, save } = opened(fileBytes(CASES), 'cases.mat');
    const original = new Uint8Array(fileBytes(CASES));
    for (const [node, typed, why] of [
      [by('kp'), '"abc"', 'Cannot edit "kp": kp would be a string, which this package cannot write into a MAT-file.'],
      [by('kp'), '["a" "b"]', 'Cannot edit "kp": kp would be a string, which this package cannot write into a MAT-file.'],
      [by('cellFlat').children[0], '{1, "a"}', 'Cannot edit "cellFlat": cellFlat{1} would hold a string, which this package cannot write into a MAT-file.'],
      [by('structScalar').children[0], '"x"', 'Cannot edit "structScalar": structScalar.a would be a string, which this package cannot write into a MAT-file.'],
    ] as [any, string, string][]) {
      const was = shownAs(node);
      expect(edit(node, 'Value', typed), typed).toEqual({ error: true, reason: why, invalidValue: typed, validValue: node.displayValue });
      expect(shownAs(node), typed).toEqual(was);
    }
    // Nothing was edited: the file is not dirty, and saves as itself.
    expect([root.dirty, by('kp').status, sameBytes(save(), original)]).toEqual([false, '', true]);
    // A char is a value a save writes.
    expect(edit(by('kp'), 'Value', "'abc'")).toBe(true);
    expect(readBack(save(), root.children.indexOf(by('kp')))).toEqual(shownAs(by('kp')));
  });

  it('a variable holding a container read short, at any depth: renamed and deleted, nothing in it edited', () => {
    // A save would write the elements the reader could not read as empty doubles, which the file
    // did not hold (MatFileWriter.shortIn).
    const short = cellVar('', [scalar('', 1)], [1, 3]);
    const { root, by, edit, save } = opened(matFile([cellVar('c', [scalar('', 1)], [1, 3]), structVar('s', ['a', 'b'], [{ a: short, b: scalar('', 2) }]), scalar('ok', 3)]));
    const why = {
      c: 'Cannot edit "c": c is a 1x3 cell holding 1 of the 3 elements it declares, and a save would write the ones it does not hold as empty.',
      s: 'Cannot edit "s": s.a is a 1x3 cell holding 1 of the 3 elements it declares, and a save would write the ones it does not hold as empty.',
    };
    expect(edit(by('c').children[0], 'Value', '5')).toMatchObject({ error: true, reason: why.c });
    expect(edit(by('s').children[1], 'Value', '5')).toMatchObject({ error: true, reason: why.s });
    expect([by('c').canAddChild(), by('s').canAddChild(), by('ok').valueEditable]).toEqual([false, false, true]);
    expect(root.dirty).toBe(false);
    expect(edit(by('c'), 'Name', 'c2')).toBe(true);
    expect(edit(by('ok'), 'Value', '4')).toBe(true);
    expect(parseMat(arrayBufferOf(save())).records.map((r) => r.name)).toEqual(['c2', 's', 'ok']);
  });

  it('a container the node ceiling built without its rows is judged by what it was read as', () => {
    // nested_handles.mat's c_fh is a cell of function handles. Built with no rows, it showed no
    // handle to refuse, and took an edit the save then refused.
    const bytes = fixture('fixtures/display/nested_handles.mat');
    const cut: any = MatNode.fromParsed(parseMat(bytes), 'f.mat', { nodeCeiling: 0 });
    const cFh = cut.children.find((c: any) => c.name === 'c_fh');
    expect([cFh._cutByCeiling > 0, cFh.children.length]).toEqual([true, 0]);
    expect(sourceEditRefusal(cFh, 'Value')).toBe('Cannot edit "c_fh": c_fh{1} is a function handle, which this package cannot write into a MAT-file.');
    expect(cFh.valueEditable).toBe(false);
  });
});

describe('what a file, or where a variable stands in it, refuses of every edit', () => {
  it('a variable stored after the subsystem: neither renamed nor edited, and deleted', () => {
    const late = arrayBufferOf(new Uint8Array([...new Uint8Array(fixture('fixtures/mcos/Param.mat')), ...scalar('late', 4)]));
    const { session, root, by, edit, save } = opened(late);
    const node = by('late');
    const why =
      'Cannot edit "late": it is stored after the file\'s objects, where MATLAB does not read it, so it would not be read written there, '
      + 'and moved, it would change what MATLAB loads of the file.';
    expect([node.nameEditable, node.valueEditable, node.toRow().Name.editable]).toEqual([false, false, false]);
    expect(edit(node, 'Name', 'late2')).toMatchObject({ error: true, reason: why });
    expect(edit(node, 'Value', '5')).toMatchObject({ error: true, reason: why });
    expect(node.setProperty('Name', 'late2')).toMatchObject({ error: true, reason: why });
    // And by the rename's own refusal of a name the node does not take (nameEditable), for a setter
    // that does not ask the source first: as the source says it, not as a name the entry cannot carry.
    const asked = node._refuseEncodedEdit;
    node._refuseEncodedEdit = () => null;
    expect(node.setProperty('Name', 'late2')).toMatchObject({ error: true, reason: why });
    node._refuseEncodedEdit = asked;
    expect(root.dirty).toBe(false);
    // The variable before the subsystem is as any other.
    expect(by('Param').nameEditable).toBe(true);
    session.setActive(root, node);
    expect(session.deleteNodeById(node.id)).toBe(true);
    expect(parseMat(arrayBufferOf(save())).records.map((r) => r.name)).toEqual(['Param', '']);
  });

  it('two variables of one name: neither value edited until one is renamed away', () => {
    const { root, edit, save } = opened(matFile([scalar('a', 1), scalar('a', 2), scalar('b', 3)]));
    const [first, second] = root.children;
    const why = 'Cannot edit "a": the file holds another variable named "a", and MATLAB loads only one of them.';
    // The session takes no edit of either, by an id two nodes answer to (DataModel.idIsShared);
    // the nodes' own setters are asked here.
    for (const node of [first, second]) {
      expect([node.valueEditable, sourceEditRefusal(node, 'Value')]).toEqual([false, why]);
      expect(edit(node, 'Value', '5')).toBe(false);
      expect(node.setProperty('Value', '5')).toMatchObject({ error: true, reason: why });
    }
    expect(second.setProperty('Name', 'a2')).toBe(true);
    expect([first.valueEditable, second.valueEditable]).toEqual([true, true]);
    expect(edit(first, 'Value', '5')).toBe(true);
    expect(parseMat(arrayBufferOf(save())).variables.map((v) => [v.name, v.value])).toEqual([['a', 5], ['a2', 2], ['b', 3]]);
  });

  it('what the gate found is forgotten for the variable an edit changed, and the names are counted as they move', () => {
    const { session, root, by, edit } = opened(matFile([scalar('a', 1), scalar('a', 2), scalar('b', 3), cellVar('c', [scalar('', 4)])]));
    const verdictKept = (n: any) => root._valueVerdicts.has(n);
    const [a1, a2, b, c] = root.children;
    root.children.forEach((n: any) => n.valueEditable);
    expect(root.children.map(verdictKept)).toEqual([true, true, true, true]);
    // An edit under `c` forgets what was found of `c`, and of nothing else.
    expect(edit(c.children[0], 'Value', '5')).toBe(true);
    expect(root.children.map(verdictKept)).toEqual([true, true, true, false]);
    // A name moved by a rename, its undo and its redo, an addition and a delete, and their undo:
    // what the gate says of the two `a`s, and what the file is said to hold, follow each.
    const holds = (...names: string[]) => names.map((n) => root._namespaceHolds(n));
    expect([a1.valueEditable, a2.valueEditable]).toEqual([false, false]);
    expect(a2.setProperty('Name', 'z')).toBe(true);
    expect([a1.valueEditable, a2.valueEditable, holds('a', 'z')]).toEqual([true, true, [1, 1]]);
    expect(edit(b, 'Name', 'y')).toBe(true);
    expect(holds('b', 'y')).toEqual([0, 1]);
    session.undo();
    expect(holds('b', 'y')).toEqual([1, 0]);
    session.redo();
    expect(holds('b', 'y')).toEqual([0, 1]);
    expect(root.execAddEntry(undefined, 'a')).toBeNull();
    const added = root.execAddEntry(undefined, 'n');
    expect([holds('n'), root.execAddEntry(undefined, 'n')]).toEqual([[1], null]);
    expect(root.execRemoveEntry(by('n'))).not.toBeNull();
    expect(holds('n')).toEqual([0]);
    added.redo();
    expect(holds('n')).toEqual([1]);
    added.undo();
    expect(holds('n')).toEqual([0]);
    // A variable whose slot changes hands (BaseNode._replaceWith) has the names counted again.
    expect(a1._replaceWith(MatlabVariableNode.createDefault('q', root))).toBe(true);
    expect(holds('a', 'q', 'z')).toEqual([0, 1, 1]);
  });

  it('a name the file holds as a record the reader dropped is taken: no rename or addition into it', () => {
    // A record that is not a matrix (an miINT32 at the top level) is dropped by the reader, and
    // kept by every save as its bytes; its name is still the file's.
    const { root, edit } = opened(matFile([scalar('a', 1), scalar('b', 2)]));
    expect(root._namespaceHolds('a')).toBe(1);
    expect(edit(root.children[1], 'Name', 'a')).toEqual({ error: true, reason: "'a' already exists in f.mat", invalidValue: 'a', validValue: 'b' });
  });

  it('a record the reader dropped with no name read out of it holds none: an addition and a rename into any name are taken', () => {
    // A compressed record whose payload is no zlib stream: the reader drops it, and no name is
    // read out of it. MATLAB fails the whole load on it (`compressed-wrapper`), so no name an
    // addition or a rename takes is one MATLAB loads beside it, and the save breaks only that.
    const broken = new Uint8Array([...u32le(15), ...u32le(8), 1, 2, 3, 4, 5, 6, 7, 8]);
    const input = matFile([scalar('a', 1), broken]);
    const before = checkMatFile(new Uint8Array(input));
    expect(before.map((v) => v.code)).toEqual(['compressed-wrapper']);
    const { root, edit, save } = opened(input);
    expect([root.records[1].status, root.records[1].name, root.readOnly]).toEqual(['dropped', null, false]);
    expect(root.execAddEntry(undefined, 'x')).not.toBeNull();
    expect(edit(root.children[0], 'Name', 'y')).toBe(true);
    const saved = save();
    expect(parseMat(arrayBufferOf(saved)).variables.map((v) => v.name)).toEqual(['y', 'x']);
    expect(violationsAdded(before, checkMatFile(saved), new Map([['y', 'a']]))).toEqual([]);
  });

  it('a variable whose record holds bytes past its element: no rename, refused as it is made; its value is written fresh', () => {
    // A compressed record whose stream inflates to the element and 8 bytes more: the reader reads
    // the element, and a save has no element of the record's own to put a new name in.
    const stream = zlibSync(new Uint8Array([...scalar('a', 1), ...new Uint8Array(8)]));
    const record = new Uint8Array([...u32le(15), ...u32le(stream.length), ...stream]);
    const { root, by, edit, save } = opened(matFile([record, scalar('b', 2)]));
    const node = by('a');
    expect([root.framed, node.nameEditable]).toEqual([true, true]);
    const why = `Cannot edit "a": the record it was read from, at byte 128, is not a whole element whose name can be replaced, so it cannot be renamed.`;
    expect(edit(node, 'Name', 'a2')).toEqual({ error: true, reason: why, invalidValue: 'a2', validValue: 'a' });
    expect([node.name, root.dirty]).toEqual(['a', false]);
    expect(edit(node, 'Value', '5')).toBe(true);
    expect(parseMat(arrayBufferOf(save())).variables.map((v) => [v.name, v.value])).toEqual([['a', 5], ['b', 2]]);
  });

  it('a file no save of which can be written is read-only, and takes no edit, addition or delete', () => {
    const z = new Uint8Array(8);
    const files: [string, () => any, RegExp][] = [
      ['unframed', () => opened(matFile([scalar('a', 1), scalar('b', 2)], { trailing: z })), /^Cannot edit "f\.mat": this package could not frame 8 byte\(s\) of it/],
      ['an unnamed record that is not the subsystem', () => opened(matFile([scalar('a', 1), scalar('', 2), scalar('b', 3)])), /^Cannot edit "f\.mat": the record at byte \d+ holds a value with no name/],
      [
        "a host's parse that carries no records",
        () => {
          const session = createSession();
          const { header, variables } = parseMat(fileBytes(CASES));
          const root: any = session.addMatSourceParsed('f.mat', { header, variables });
          return {
            session,
            root,
            edit: (node: any, prop: string, value: string) => {
              session.setActive(root, node);
              return session.editProperty(node.id, prop, value);
            },
          };
        },
        /^Cannot edit "f\.mat": it was opened without the records a save writes back/,
      ],
    ];
    for (const [what, open, why] of files) {
      const { session, root, edit } = open();
      expect(root.readOnly, what).toBe(true);
      const node = root.children[0];
      expect([node.nameEditable, node.valueEditable], what).toEqual([false, false]);
      expect(edit(node, 'Value', '5').reason, what).toMatch(why);
      expect(edit(node, 'Name', 'renamed').reason, what).toMatch(why);
      session.setActive(root, node);
      expect(session.deleteNodeById(node.id), what).toBe(false);
      expect(session.addEntry('', 'MatlabVariable'), what).toBeNull();
      expect([root.getAllowedTypes(), session.addEntry('', 'Simulink.Parameter'), session.addEntry('', 'string')], what).toEqual([[], null, null]);
      expect([root.children[0], root.dirty], what).toEqual([node, false]);
    }
  });

  it('a file whose bytes the host has since handed away becomes read-only', () => {
    const input = fileBytes(CASES);
    const { root, by } = opened(input, 'cases.mat');
    expect([root.readOnly, by('kp').valueEditable]).toEqual([false, true]);
    structuredClone(input, { transfer: [input] });
    expect([root.readOnly, by('kp').valueEditable, by('kp').nameEditable]).toEqual([true, false, false]);
  });
});

describe('the session, on a .mat', () => {
  it('a file a save can write is not read-only', () => {
    for (const file of FIXTURES) {
      expect(opened(fileBytes(file)).root.readOnly, shown(file)).toBe(false);
    }
  });

  it('addEntry adds the double 0, named var, before the subsystem, and its undo and redo are saved', () => {
    const { session, root, save } = opened(fileBytes(CASES), 'cases.mat');
    session.setActiveContext(root);
    const added: any = session.addEntry('', 'MatlabVariable');
    expect([added.name, added.displayValue, added.className, added.parent]).toEqual(['var', '0', 'double', root]);
    expect(session.getEntryNode()).toBe(added);
    const again: any = session.addEntry('', 'MatlabVariable');
    expect(again.name).toBe('var1');
    let parsed = parseMat(arrayBufferOf(save()));
    expect(parsed.records.slice(-3).map((r) => r.name)).toEqual(['var', 'var1', '']);
    expect(parsed.variables.find((v) => v.name === 'var')).toMatchObject({ className: 'double', dimensions: [1, 1], value: 0 });
    session.undo();
    session.undo();
    expect(root.children.includes(added)).toBe(false);
    expect(parseMat(arrayBufferOf(save())).records.map((r) => r.name)).not.toContain('var');
    session.redo();
    parsed = parseMat(arrayBufferOf(save()));
    expect(parsed.records.slice(-2).map((r) => r.name)).toEqual(['var', '']);
    // An entry named by the caller, and what a save could not write.
    expect(session.addEntry('', 'MatlabVariable', 'myVar').name).toBe('myVar');
    expect(session.addEntry('', 'MatlabVariable', 'kp')).toBeNull();
    expect(session.addEntry('', 'MatlabVariable', '1bad')).toBeNull();
    expect(session.addEntry('', 'Simulink.ConfigSet')).toBeNull();
    expect(parseMat(arrayBufferOf(save())).records.slice(-3).map((r) => r.name)).toEqual(['var', 'myVar', '']);
  });

  it("a rename into a name the file holds names the file; a dictionary's keeps its wording", () => {
    const { by, edit } = opened(fileBytes(CASES), 'cases.mat');
    expect(edit(by('kp'), 'Name', 'scalarD')).toEqual({ error: true, reason: "'scalarD' already exists in cases.mat", invalidValue: 'scalarD', validValue: 'kp' });
    // A host's srcId that is a path names the file by its basename.
    const session = createSession();
    const root: any = session.addMatSource('/some/where/cases.mat', fileBytes(CASES));
    expect(root.children.find((c: any) => c.name === 'kp').setProperty('Name', 'scalarD').reason).toBe("'scalarD' already exists in cases.mat");
  });
});
