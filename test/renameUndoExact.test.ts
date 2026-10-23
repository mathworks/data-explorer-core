// Copyright 2026 The MathWorks, Inc.
//
// A rename undone puts the name back as it was, whatever the name, and redone makes it again.
//
// A file another tool wrote can hold a name no rename takes (validateMatlabName): one past 63
// characters, a keyword, one that starts with an underscore. The session undid a rename by renaming
// the node back through its setter, which refused such a name; the undo then moved the stack and
// announced the edit all the same, the node keeping the name it was given, and a redo renamed
// nothing. The undo and the redo of a rename now put the name back as the rename made it
// (DataNode._nameRestorer), in a MAT-file and in a dictionary alike.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { CLASS, matFile, numericVar, structVar } from './tools/matBytes.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const LONG = 'a'.repeat(64);
const scalar = (name: string, value: number) => numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, 1], real: [value] });
const flat = (n: any, acc: any[] = []): any[] => (acc.push(n), n.children.forEach((c: any) => flat(c, acc)), acc);
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

/** A source opened in a session, as a host opens one, and what a host does to it. */
function opened(open: (session: ReturnType<typeof createSession>) => any) {
  const session = createSession();
  const root: any = open(session);
  const at = (path: string): any => flat(root).find((n) => n !== root && n.matlabPath === path);
  const edits: any[] = [];
  session.bus.subscribe('node/edited', (p: any) => edits.push(p));
  const rename = (node: any, name: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, 'Name', name);
  };
  const save = (): Uint8Array => (session.serializeSource(root.name) as { bytes: Uint8Array }).bytes;
  return { session, root, at, edits, rename, save };
}

const mat = (bytes: ArrayBuffer) => opened((session) => session.addMatSource('f.mat', bytes));
const shortened = (name: string) => (name.length > 8 ? name.slice(0, 8) + '…' : name);

describe('a rename undone and redone in a MAT-file', () => {
  for (const name of ['_x', LONG, 'end']) {
    it(`puts back the variable name ${shortened(name)}, which no rename takes, and makes the rename again`, () => {
      const bytes = matFile([scalar(name, 1), scalar('y', 2)]);
      const o = mat(bytes);
      const node = o.root.children[0];
      expect(node.name).toBe(name);
      expect(o.rename(node, 'z')).toBe(true);
      o.edits.length = 0;
      o.session.undo();
      expect([node.name, o.edits.map((e) => e.kind)]).toEqual([name, ['rename']]);
      // Undone, the file saves as it was read.
      expect(sameBytes(o.save(), new Uint8Array(bytes))).toBe(true);
      o.session.redo();
      expect(node.name).toBe('z');
      o.session.undo();
      expect(node.name).toBe(name);
      // A rename into such a name is refused as before: the restore is the undo's alone.
      expect(o.rename(o.root.children[1], name)).toMatchObject({ error: true });
    });
  }

  for (const name of ['_f', 'end']) {
    it(`puts back the struct field name ${name}, which no rename takes, and makes the rename again`, () => {
      const o = mat(matFile([structVar('s', ['a', name], [{ a: scalar('', 1), [name]: scalar('', 2) }])]));
      const field = o.at('s.' + name);
      expect(o.rename(field, 'z')).toBe(true);
      o.session.undo();
      expect([field.name, o.at('s.' + name)]).toEqual([name, field]);
      o.session.redo();
      expect([field.name, o.at('s.z')]).toEqual(['z', field]);
    });
  }
});

describe('a rename undone and redone in a text dictionary', () => {
  it('puts back an entry name no rename takes, and makes the rename again', () => {
    const json = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/numeric_json.sldd', import.meta.url)), 'utf8'));
    json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries[0].name = '_Array';
    const o = opened((session) => session.addDataSource('d.sldd', json));
    const node = flat(o.root).find((n) => n.isEntry && n.name === '_Array');
    expect(o.rename(node, 'Renamed')).toBe(true);
    o.session.undo();
    expect(node.name).toBe('_Array');
    o.session.redo();
    expect(node.name).toBe('Renamed');
  });
});
