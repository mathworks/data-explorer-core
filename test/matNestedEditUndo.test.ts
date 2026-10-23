// Copyright 2026 The MathWorks, Inc.
//
// An edit under a MAT-file variable, undone, saves the file as it was read, byte for byte.
//
// A save writes a variable no edit reached as the record it was read from, and one an edit reached
// fresh (MatFileWriter.editOf): told apart by what the edit marked on the variable (_valueEdited),
// which an undo did not put back. A struct field renamed and undone, or a field's or a cell element's
// value edited and undone, left the variable marked, and the save wrote it fresh: a value equal to
// the one read, in other bytes than the file's. An undo that puts the value back exactly as it was
// (a node's restorer) now puts back what the edit marked too (DataNode._editMarks), as the undo of an
// edit of a variable's own Value always did, its marks being its own. A text dictionary's entry so
// undone is written as it was read too, its last-modified stamp apart, which an undo leaves as every
// edit does: it was written from its nodes, in another spelling of the same value.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest } from '../src/index.js';
import { CLASS, cellVar, matFile, numericVar, structVar } from './tools/matBytes.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const scalar = (name: string, value: number) => numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, 1], real: [value] });
const flat = (n: any, acc: any[] = []): any[] => (acc.push(n), n.children.forEach((c: any) => flat(c, acc)), acc);
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

// A struct, a struct in a struct, a 1x2 struct array, a cell, and a double beside them.
const FILE = () =>
  matFile([
    structVar('s', ['a', 'b'], [{ a: scalar('', 1), b: scalar('', 2) }]),
    structVar('n', ['a'], [{ a: structVar('', ['b'], [{ b: scalar('', 3) }]) }]),
    structVar('sa', ['a'], [{ a: scalar('', 4) }, { a: scalar('', 5) }], [1, 2]),
    cellVar('c', [scalar('', 6), scalar('', 7)]),
    scalar('y', 8),
  ]);

function opened(bytes: ArrayBuffer) {
  const session = createSession();
  const root: any = session.addMatSource('f.mat', bytes);
  const at = (path: string): any => flat(root).find((n) => n !== root && n.matlabPath === path);
  const edit = (path: string, key: string, value: string) => {
    const node = at(path);
    expect(node, path).toBeDefined();
    session.setActive(root, node);
    return session.editProperty(node.id, key, value);
  };
  const save = (): Uint8Array => (session.serializeSource('f.mat') as { bytes: Uint8Array }).bytes;
  return { session, root, at, edit, save };
}

/** What a reopened file shows: each node's path and, for a leaf, its text. */
const shown = (bytes: Uint8Array): string[] => {
  const { root } = opened(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return flat(root).filter((n) => n !== root).map((n) => n.matlabPath + (n.children.length === 0 ? ' ' + n.displayValue : ''));
};

const EDITS: [string, [string, string, string][]][] = [
  ['a struct field renamed', [['s.b', 'Name', 'z']]],
  ['a field of a struct in a struct renamed', [['n.a.b', 'Name', 'z']]],
  ["a field of a struct array's element renamed, in every element", [['sa(2).a', 'Name', 'z']]],
  ["a struct field's value edited", [['s.a', 'Value', '10']]],
  ["a field's value of a struct in a struct edited", [['n.a.b', 'Value', '[1 2 3]']]],
  ['a cell element edited', [['c{2}', 'Value', "'text'"]]],
  ['a field renamed and its value edited', [['s.b', 'Name', 'z'], ['s.z', 'Value', '11']]],
];

describe('an edit under a MAT-file variable, undone', () => {
  for (const [what, steps] of EDITS) {
    it(`${what}: saves the file as read, and redone, the edit again`, () => {
      const bytes = FILE();
      const o = opened(bytes);
      for (const [path, key, value] of steps) {
        expect(o.edit(path, key, value), path + ' ' + key).toBe(true);
      }
      const edited = o.save();
      expect(sameBytes(edited, new Uint8Array(bytes))).toBe(false);
      for (let i = 0; i < steps.length; i++) {
        o.session.undo();
      }
      expect(sameBytes(o.save(), new Uint8Array(bytes))).toBe(true);
      for (let i = 0; i < steps.length; i++) {
        o.session.redo();
      }
      expect(shown(o.save())).toEqual(shown(edited));
    });
  }

  it('saves the other variables as read beside one edited after the undo', () => {
    const bytes = FILE();
    const o = opened(bytes);
    expect(o.edit('s.b', 'Name', 'z')).toBe(true);
    o.session.undo();
    expect(o.edit('y', 'Value', '9')).toBe(true);
    const reference = opened(bytes);
    expect(reference.edit('y', 'Value', '9')).toBe(true);
    expect(sameBytes(o.save(), reference.save())).toBe(true);
  });
});

describe('an edit under a text dictionary entry, undone', () => {
  // Every entry's last-modified stamp, which an undo leaves as the edit set it, masked.
  const unstamped = (text: string) => text.replace(/"lastmod": "[^"]*"/g, '"lastmod": ""');
  for (const [path, key, value] of [
    ['structScalar.a', 'Name', 'zz'],
    ['structNest.a.b', 'Name', 'zz'],
    ['structScalar.a', 'Value', '42'],
    ['structNest.a.b', 'Value', '[1 2 3]'],
  ] as const) {
    it(`${path} ${key}: saves the entry as it was read`, () => {
      const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('./parity/artifacts/text/cases.sldd', import.meta.url))));
      const session = createSession();
      const root: any = ingest(session, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { filename: 'cases.sldd' });
      const save = () => (session.serializeSource(root.name) as { text: string }).text;
      const unedited = save();
      const node = flat(root).find((n) => n !== root && n.matlabPath === path);
      session.setActive(root, node);
      expect(session.editProperty(node.id, key, value)).toBe(true);
      expect(unstamped(save())).not.toBe(unstamped(unedited));
      session.undo();
      expect(unstamped(save())).toBe(unstamped(unedited));
    });
  }
});
