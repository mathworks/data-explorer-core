// Copyright 2026 The MathWorks, Inc.
//
// The gate is the writer, for the objects a MAT-file holds (test/matEditGate.test.ts holds it for
// its variables). Over every Level-5 fixture that holds a Simulink.Parameter or a Simulink.Signal,
// at every place one stands (a variable, a struct field, a cell, an element of an object array, a
// handle two variables share), every typed node of an object (mcosPlace.mcosPlaceOf) and every row
// under it, every property of each, with no sampling of the objects:
//
//   - every property the gate takes (BaseNode.sourceEditRefusal null), edited through the session
//     with each representative value, is either taken, and then saved and read back as the session
//     showed it, the object and every other node of it; or refused by its value, in the gate's
//     words, and the file saved is the file. At least one value of each is taken;
//   - every property the gate refuses has no editor anywhere a host looks, and the session, the
//     node's setter and the structural gates refuse it, and the file saved is the file;
//   - every Add and every removal the gate offers under an object saves and reads back as shown.
//
// What the reader shows of an object that MATLAB derives as it loads it, and the save therefore
// does not write, is left out of the reading back: its Complexity (held as an index into the file's
// text, which a save does not rewrite) and the DataType of a Parameter that holds no DataType value
// (its class default, which MATLAB derives from the Value). MATLAB's own reading of both is the live
// gate's (test/parity/matlab/probe_mat_writeback.m, which compares every property).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { sourceEditRefusal } from '../src/datamodel/node/BaseNode.js';
import { mcosPlaceOf } from '../src/datamodel/node/mcosPlace.js';
import { toDTO } from '../src/core/dto.js';

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

const bufferOf = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);
const shown = (abs: string) => abs.slice(TEST_ROOT.length);

/** A MAT-file opened through the session, as a host opens one, and what a host does to it. */
function opened(bytes: Uint8Array, name = 'f.mat') {
  const session = createSession();
  const root: any = session.addMatSource(name, bufferOf(bytes));
  const edit = (node: any, prop: string, value: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, prop, value);
  };
  const save = (): Uint8Array => (session.serializeSource(name) as { bytes: Uint8Array }).bytes;
  return { session, root, edit, save };
}

/** Every node under `root`, depth first, with its path of child indices from the file. */
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
const isUnder = (node: any, path: number[], objectPath: number[]) => path.length >= objectPath.length && objectPath.every((i, k) => path[k] === i);

function thrownBy(fn: () => unknown): Error | null {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  return null;
}

/**
 * What the node of an object shows, everywhere a host looks: each property's text, and each row
 * under it, its label, value and class. A complex part `+0i` is left out, as matEditGate.test.ts
 * leaves it out: an element of a complex Value set to a real number shows as that number, and reads
 * back as the same element with the imaginary part 0. And what MATLAB derives as it loads the
 * object is left out (see the header): `derived` names those properties.
 */
function objectShown(node: any, derived: ReadonlySet<string>): string[] {
  const text = (s: unknown) => String(s).replace(/(\d|Inf|NaN)\+0i/g, '$1');
  const out = node
    .getProperties()
    .filter((p: any) => p.key !== 'Name' && !derived.has(p.key))
    .map((p: any) => `${p.key} = ${text(node.getPropInfo(p).displayValue)}`);
  const walk = (n: any, path: string) => {
    n.children.forEach((c: any, i: number) => {
      out.push(`${path}/${i} ${c.displayName} = ${text(c.displayValue)} (${c.className})`);
      walk(c, path + '/' + i);
    });
  };
  walk(node, '');
  return out;
}

/** The properties of the object at `node` the reading back leaves out (see the header). */
function derivedOf(root: any, node: any): Set<string> {
  const out = new Set(['complexity', 'Complexity']);
  const state = root._objectState(node);
  if (typeof state !== 'string' && state.held.className === 'Simulink.Parameter' && !state.held.stored.has('DataType')) {
    out.add('DataType');
  }
  return out;
}

/** The values a sweep types into `key` of `node`, each one an edit of some value MATLAB takes. */
function candidates(node: any, object: any, key: string): string[] {
  if (node !== object) {
    // A row of a Value: an element, a field, the Value's own row; its Data Type the class its
    // value is made.
    if (key === 'DataType' || key === 'dataType') {
      return ['int8', 'single', 'double', 'logical'];
    }
    if (key === 'Name') {
      return ['renamedField'];
    }
    if (node.parent?._kind === 'array' && node.parent?._scalarType === 'logical') {
      return [node.displayValue === 'true' ? 'false' : 'true'];
    }
    return node.children.length > 0 ? ['[4 5]', '9'] : ['7', '-1', '0.5'];
  }
  const bound = (b: unknown) => (typeof b === 'number' ? b : null);
  switch (key) {
    case 'Value':
      return ['7', '[1 2; 3 4]', 'true', "'abc'", '1+2i', '[]', '-3', '300'];
    case 'Min':
      return [String((bound(object.Max) ?? 1) - 1), '-1', '[]', '5'];
    case 'Max':
      return [String((bound(object.Min) ?? 0) + 1), '9', '[]', '200'];
    case 'Description':
    case 'Unit':
    case 'description':
    case 'unit':
      return ['zz edited', '', 'Grüße 温度 \u{1F600}'];
    case 'DataType':
    case 'dataType':
      return ['double', 'int8', 'fixdt(1,16,4)', 'boolean', 'single'];
    default:
      return ['7', "'zz'"];
  }
}

const FIXTURES = matFilesUnder(TEST_ROOT).filter((abs) => {
  try {
    const { root } = opened(new Uint8Array(readFileSync(abs)));
    return nodesWithPaths(root).some(({ node }) => mcosPlaceOf(node));
  } catch {
    return false;
  }
});

describe('the gate is the writer, for every object of every fixture', () => {
  const totals = { taken: 0, refusedByValue: 0, refused: 0, structural: 0, objects: 0 };
  // The Adds and removals of an element of a Simulink.Parameter's array Value, by file and Value.
  const valueRows: { add: string[]; remove: string[] } = { add: [], remove: [] };

  for (const file of FIXTURES) {
    it(shown(file), { timeout: 120_000 }, () => {
      const original = new Uint8Array(readFileSync(file));
      const probe = opened(original);
      const all = nodesWithPaths(probe.root);
      // The refusals are asked of one session: nothing they refuse changes it.
      const refusing = opened(original);
      const objects = all.filter(({ node }) => mcosPlaceOf(node));
      totals.objects += objects.length;
      for (const { node: objectSeen, path: objectPath } of objects) {
        // The object, and every row under it but the elements of an array past its first two and
        // its last, which are one class and take one edit; and of the 30,000 rows of the shared
        // object graphs (dag12.mat), an even stride through them past the first 200.
        const under = all.filter(({ node, path }) => {
          if (!isUnder(node, path, objectPath)) {
            return false;
          }
          const parent = node.parent;
          if (node === objectSeen || !parent || parent._kind !== 'array') {
            return true;
          }
          const i = parent.children.indexOf(node);
          return i < 2 || i === parent.children.length - 1;
        });
        const stride = Math.max(1, Math.ceil((under.length - 200) / 300));
        const rows = under.filter((_, i) => i < 200 || i % stride === 0);
        for (const { node: seen, path } of rows) {
          for (const prop of seen.getProperties()) {
            const key = prop.key;
            // The object's own name is where it stands, and an entry's rename is matEditGate's.
            if (key === 'Name' && seen === objectSeen) {
              continue;
            }
            const label = `${shown(file)}: ${seen.matlabPath} ${key}`;
            if (sourceEditRefusal(seen, key) === null && seen.className === 'struct' && seen !== objectSeen && key === 'Value') {
              // A struct row of a Value takes a row added or removed (below) and an edit of each of
              // its fields, which the gate asks as one of its Value; a value typed over it whole is
              // refused by the value, every one, and the table offers no editor for it.
              const { root, edit, save } = opened(original);
              const node = at(root, path);
              expect(node.getPropInfo(prop).editable, label).toBe(false);
              for (const value of candidates(seen, objectSeen, key)) {
                expect(edit(node, key, value), label + ' = ' + value).toMatchObject({
                  error: true,
                  reason: expect.stringContaining(node.matlabPath + ' is a struct, which takes an edit of each of its fields, and not a value typed over it whole'),
                });
              }
              expect(sameBytes(save(), original), label + ': the file as it was').toBe(true);
              totals.refusedByValue++;
            } else if (sourceEditRefusal(seen, key) === null) {
              let taken = 0;
              for (const value of candidates(seen, objectSeen, key)) {
                if (value === seen.getPropInfo(prop).displayValue) {
                  continue;
                }
                const { root, edit, save } = opened(original);
                const node = at(root, path);
                const object = at(root, objectPath);
                const answer: any = edit(node, key, value);
                const what = label + ' = ' + JSON.stringify(value);
                if (answer !== true) {
                  // Refused by its value: in the gate's words, and nothing changed.
                  expect(answer, what).toMatchObject({ error: true, reason: expect.stringMatching(/^Cannot edit "/) });
                  expect(sameBytes(save(), original), what + ': the file as it was').toBe(true);
                  totals.refusedByValue++;
                  continue;
                }
                const thrown = thrownBy(save);
                expect(thrown?.message, what).toBeUndefined();
                const again = opened(save(), 'saved.mat');
                const derived = derivedOf(root, object);
                expect(objectShown(at(again.root, objectPath), derived), what).toEqual(objectShown(object, derived));
                // Every other node of the same object, as it shows it.
                const group = root._twinGroupOf(object);
                for (const twin of group?.members ?? []) {
                  const twinPath = nodesWithPaths(root).find(({ node: n }) => n === twin.node)?.path;
                  if (twinPath && twin.node !== object) {
                    expect(objectShown(twin.node, derived), what + ': ' + twin.node.matlabPath).toEqual(objectShown(object, derived));
                    expect(objectShown(at(again.root, twinPath), derived), what + ': ' + twin.node.matlabPath + ' read back').toEqual(objectShown(object, derived));
                  }
                }
                taken++;
                totals.taken++;
              }
              expect(taken, label + ': the gate takes it, and no value of it was taken').toBeGreaterThan(0);
            } else {
              // Refused whatever its value: no editor anywhere, every path refuses it, and the
              // file is the file.
              const { session, root, edit } = refusing;
              const node = at(root, path);
              const row = node.toRow();
              const dto = toDTO(node);
              expect(node.getPropInfo(prop).editable, label).toBe(false);
              const k = node.getProperties().findIndex((p: any) => p.key === key);
              expect(dto.props[k]?.editable ?? false, label).toBe(false);
              if (key === 'Value') {
                expect([node.valueEditable, row._valueEditable], label).toEqual([false, false]);
              }
              if (key === 'Description' || key === 'description') {
                expect([node.descriptionEditable, row._descriptionEditable], label).toEqual([false, false]);
              }
              const typed = node.getPropInfo(prop).displayValue === '7' ? '8' : '7';
              expect(edit(node, key, typed), label).toMatchObject({ error: true });
              expect(node.setProperty(key, typed), label).toMatchObject({ error: true });
              if (key === 'Value' && node.children.length > 0) {
                expect([node.canAddChild(), session.addChildTo(node.id)], label).toEqual([false, null]);
              }
              expect(root.dirty, label).toBe(false);
              totals.refused++;
            }
          }
          // An Add or a removal under the object, where the gate offers it.
          for (const op of ['add', 'remove'] as const) {
            if (seen === objectSeen || (op === 'add' ? !seen.canAddChild() : !(seen.canRemoveChild?.() && seen.children.length > 0))) {
              continue;
            }
            const { session, root, save } = opened(original);
            const node = at(root, path);
            const object = at(root, objectPath);
            const label = `${shown(file)}: ${node.matlabPath} ${op}`;
            if (op === 'add') {
              expect(session.addChildTo(node.id), label).not.toBeNull();
            } else {
              const last = node.children[node.children.length - 1];
              session.setActive(root, last);
              expect(session.deleteNodeById(last.id), label).toBe(true);
            }
            expect(thrownBy(save)?.message, label).toBeUndefined();
            const derived = derivedOf(root, object);
            expect(objectShown(at(opened(save(), 'saved.mat').root, objectPath), derived), label).toEqual(objectShown(object, derived));
            totals.structural++;
            if ((object as any)._valueNode === node && (node as any)._kind === 'array') {
              valueRows[op].push(shown(file) + ': ' + node.matlabPath);
            }
          }
        }
      }
      expect(refusing.root.dirty).toBe(false);
      expect(sameBytes(refusing.save(), original), 'every refusal left the file as it was').toBe(true);
    });
  }

  it('reaches every kind of edit: values taken and refused by value, properties refused, Adds and removals', () => {
    // 338 objects, 2951 edits taken, 39 refused by their value, 11373 properties refused, 84 Adds
    // and removals, when written.
    expect(totals.objects).toBeGreaterThanOrEqual(300);
    expect(totals.taken).toBeGreaterThanOrEqual(2500);
    expect(totals.refusedByValue).toBeGreaterThanOrEqual(30);
    expect(totals.refused).toBeGreaterThanOrEqual(10000);
    expect(totals.structural).toBeGreaterThanOrEqual(70);
    // Among them, an element added to and one removed from a Parameter's array Value, each saved
    // and read back as shown, in more than one file.
    for (const op of ['add', 'remove'] as const) {
      expect(valueRows[op].length, op).toBeGreaterThanOrEqual(5);
      expect(new Set(valueRows[op].map((v) => v.split(':')[0])).size, op).toBeGreaterThanOrEqual(2);
    }
    expect(valueRows.add).toContain('fixtures/mat-allowlist/al_shape.mat: spI.Value');
    expect(valueRows.remove).toContain('fixtures/mat-allowlist/al_shape.mat: spI.Value');
  });
});
