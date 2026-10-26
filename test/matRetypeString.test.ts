// Copyright 2026 The MathWorks, Inc.
//
// A MAT-file variable whose whole Value is typed over as a string becomes a string, as
// `x = "abc"` makes one in MATLAB, whatever `x` was.
//
// A MAT-file holds a string as an object of its subsystem, which only the creation of one
// writes (MatNode._createObject: MATLAB's own default string, merged in). The Add gallery's
// String tile made one, and an edit of its Value set its text; a plain variable's Value typed
// as a string was refused instead ("would be a string, which this package cannot write into a
// MAT-file"), so the only way to a string variable was to delete the variable and add another.
// Now the edit makes that swap itself (MatNode._retype): a string variable of the same name, in
// the same place, holding the text typed, in one undo step; and the save writes it where the
// variable it replaced was.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import { CLASS, MI, cellVar, charVar, matFile, numericVar } from './tools/matBytes.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const arrayBufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const fixture = (path: string): ArrayBuffer => arrayBufferOf(new Uint8Array(readFileSync(fileURLToPath(new URL(path, import.meta.url)))));
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
  const names = (): string[] => root.children.map((c: any) => c.name);
  return { session, root, by, edit, save, names };
}

/** What a reopened file shows of each variable: its name, class, size and text, in file order. */
function shown(bytes: Uint8Array): string[] {
  const { root } = opened(arrayBufferOf(bytes), 'reopened.mat');
  return root.children.map((c: any) => [c.name, c.className, JSON.stringify(c.dims), c.displayValue].join(' '));
}

/** A file with no objects at all, so no subsystem: the first string's creation makes one. */
const plainFile = () => matFile([scalar('x', 1), scalar('y', 2), scalar('z', 3)]);

describe('a MAT-file variable retyped as a string by its Value', () => {
  it('becomes a string variable of the same name, in the same place, in a file with no objects', () => {
    const { by, edit, save, names } = opened(plainFile());
    expect(edit(by('y'), 'Value', '"abc"')).toBe(true);
    expect(names()).toEqual(['x', 'y', 'z']);
    expect([by('y').className, by('y').displayValue]).toEqual(['string', '"abc"']);
    expect(shown(save())).toEqual(['x double [1,1] 1', 'y string [1,1] "abc"', 'z double [1,1] 3']);
  });

  it.each([
    ['a double row', numericVar({ name: 'v', cls: CLASS.DOUBLE, dimensions: [1, 3], real: [1, 2, 3] })],
    ['a char', charVar('v', 'hi', MI.UTF8)],
    ['a logical', numericVar({ name: 'v', cls: CLASS.UINT8, logical: true, dimensions: [1, 1], real: [1] })],
    ['an int32', numericVar({ name: 'v', cls: CLASS.INT32, dimensions: [1, 1], real: [7] })],
    ['a cell', cellVar('v', [scalar('', 1)])],
  ])('becomes a string from %s', (_what, variable) => {
    const { by, edit, save } = opened(matFile([scalar('a', 1), variable]));
    expect(edit(by('v'), 'Value', '"abc"')).toBe(true);
    expect(shown(save())).toEqual(['a double [1,1] 1', 'v string [1,1] "abc"']);
  });

  it.each([
    ['["a" "bc"]', 'y string [1,2] ["a" "bc"]'],
    ['["one"; "two"]', 'y string [2,1] ["one"; "two"]'],
    ['""', 'y string [1,1] ""'],
  ])('keeps the shape of %s, typed in', (typed, row) => {
    const { by, edit, save } = opened(plainFile());
    expect(edit(by('y'), 'Value', typed)).toBe(true);
    expect(shown(save())[1]).toBe(row);
  });

  it("becomes a string in a MATLAB-written file holding objects, which keep what they hold", () => {
    const bytes = fixture('./fixtures/mat-cellswap/pv_basic.mat');
    const before = shown(new Uint8Array(bytes));
    const { by, edit, save } = opened(bytes, 'pv_basic.mat');
    expect(edit(by('x'), 'Value', '"abc"')).toBe(true);
    expect(shown(save())).toEqual(before.map((row) => (row.startsWith('x ') ? 'x string [1,1] "abc"' : row)));
  });

  it('is put back by one undo, the save then writing the file as it was read, and made again by the redo', () => {
    const bytes = plainFile();
    const { session, by, edit, save } = opened(bytes);
    expect(edit(by('y'), 'Value', '"abc"')).toBe(true);
    session.undo();
    expect([by('y').className, by('y').displayValue]).toEqual(['double', '2']);
    expect(sameBytes(save(), new Uint8Array(bytes))).toBe(true);
    session.redo();
    expect(shown(save())[1]).toBe('y string [1,1] "abc"');
  });

  it('takes a later edit of its text as the string it is', () => {
    const { by, edit, save } = opened(plainFile());
    expect(edit(by('y'), 'Value', '"abc"')).toBe(true);
    expect(edit(by('y'), 'Value', '"xyz"')).toBe(true);
    expect(shown(save())[1]).toBe('y string [1,1] "xyz"');
  });

  it('becomes a string from a variable the Add made, which the file held no record of', () => {
    const { session, root, by, edit, save } = opened(plainFile());
    session.setActive(root, null);
    const added: any = session.addEntry('', 'MatlabVariable');
    expect(edit(by(added.name), 'Value', '"abc"')).toBe(true);
    expect(shown(save())).toEqual(['x double [1,1] 1', 'y double [1,1] 2', 'z double [1,1] 3', `${added.name} string [1,1] "abc"`]);
  });

  it('writes only the string made last, where one made before was undone', () => {
    const { session, by, edit, save } = opened(plainFile());
    expect(edit(by('y'), 'Value', '"abc"')).toBe(true);
    session.undo();
    expect(edit(by('y'), 'Value', '"def"')).toBe(true);
    expect(shown(save())).toEqual(['x double [1,1] 1', 'y string [1,1] "def"', 'z double [1,1] 3']);
  });
});

// And back: a string variable whose Value is typed over as anything else becomes a plain variable
// holding it, as `s = 5` makes `s` a double in MATLAB. A save writes it fresh, where the string was.
describe('a MAT-file string variable retyped by its Value as another value', () => {
  const pvBasic = () => fixture('./fixtures/mat-cellswap/pv_basic.mat');

  it.each([
    ['5', 'str double [1,1] 5'],
    ['[1 2 3]', 'str double [1,3] [1 2 3]'],
    ["'abc'", "str char [1,3] 'abc'"],
    ['true', 'str logical [1,1] true'],
  ])('becomes a plain variable of %s, in the same place, the objects keeping what they hold', (typed, row) => {
    const bytes = pvBasic();
    const before = shown(new Uint8Array(bytes));
    const { by, edit, save } = opened(bytes, 'pv_basic.mat');
    expect(edit(by('str'), 'Value', typed)).toBe(true);
    expect(by('str').className).not.toBe('string');
    expect(shown(save())).toEqual(before.map((r) => (r.startsWith('str ') ? row : r)));
  });

  it("leaves every other string of a file of strings as it was", () => {
    const bytes = fixture('./fixtures/strings.mat');
    const before = shown(new Uint8Array(bytes));
    const { by, edit, save } = opened(bytes, 'strings.mat');
    expect(edit(by('sScalar'), 'Value', '5')).toBe(true);
    expect(shown(save())).toEqual(before.map((r) => (r.startsWith('sScalar ') ? 'sScalar double [1,1] 5' : r)));
  });

  it('becomes one from a string the Add made, in a file with no objects', () => {
    const { session, root, by, edit, save } = opened(plainFile());
    session.setActive(root, null);
    const added: any = session.addEntry('', 'string');
    expect(edit(by(added.name), 'Value', '5')).toBe(true);
    expect(shown(save())).toEqual(['x double [1,1] 1', 'y double [1,1] 2', 'z double [1,1] 3', `${added.name} double [1,1] 5`]);
  });

  it('goes back to a double after it became a string, in its place', () => {
    const { by, edit, save } = opened(plainFile());
    expect(edit(by('y'), 'Value', '"abc"')).toBe(true);
    expect(edit(by('y'), 'Value', '7')).toBe(true);
    expect(shown(save())).toEqual(['x double [1,1] 1', 'y double [1,1] 7', 'z double [1,1] 3']);
  });

  it('is put back by one undo, the save then writing the file as it was read', () => {
    const bytes = pvBasic();
    const { session, by, edit, save } = opened(bytes, 'pv_basic.mat');
    expect(edit(by('str'), 'Value', '5')).toBe(true);
    session.undo();
    expect([by('str').className, by('str').displayValue]).toEqual(['string', '"hello"']);
    expect(sameBytes(save(), new Uint8Array(bytes))).toBe(true);
  });

  it('becomes a cell holding a new string, where the value typed holds one (matCellStrings.test.ts)', () => {
    const bytes = pvBasic();
    const before = shown(new Uint8Array(bytes));
    const { by, edit, save } = opened(bytes, 'pv_basic.mat');
    expect(edit(by('str'), 'Value', '{1, "a"}')).toBe(true);
    expect(shown(save())).toEqual(before.map((r) => (r.startsWith('str ') ? 'str cell [1,2] {1, "a"}' : r)));
  });
});


// A retype the variable put in place refuses, or one whose setter throws, leaves the file as it was:
// the variable it replaced back in its place, the file not dirty, and no object made for it among
// the file's creations (MatNode._retype). Left there, a refused string's creation was one more the
// save took for deleted, rebuilding the file's creations without it at every save while another was
// live; and a throw left the string in the variable's place, with no undo step to take it out. No
// text the string's setter is handed refuses today, so its refusal is stubbed, after the setter ran,
// as is the throw.
describe('a MAT-file variable retype the variable put in place refuses', () => {
  const pvBasic = () => fixture('./fixtures/mat-cellswap/pv_basic.mat');
  const REFUSAL = { error: true, reason: 'Cannot edit "v": refused for the test.', invalidValue: '"abc"', validValue: '2' };
  /** What the file's creations hold now (MatNode._creation): its records and session, and each node created. */
  const creations = (root: any) => (root._creation ? { ...root._creation, created: [...root._creation.created.keys()], rows: [...root._creation.rows.keys()] } : undefined);
  const expectCreations = (root: any, held: any) => {
    const now = creations(root);
    expect(now === undefined, 'no creation').toBe(held === undefined);
    if (now && held) {
      expect(now.records).toBe(held.records);
      expect(now.session).toBe(held.session);
      expect([now.created.length, now.rows.length]).toEqual([held.created.length, held.rows.length]);
      expect(now.created.every((n: any, i: number) => n === held.created[i])).toBe(true);
    }
  };

  it.each([
    ['a file with no objects', () => plainFile(), 'y', false],
    ['a MATLAB-written file holding objects', pvBasic, 'x', false],
    ['a file with a string created already', () => plainFile(), 'y', true],
  ])('leaves %s as it was, and takes the retype made next', (_what, bytesOf, name, addFirst) => {
    const bytes = bytesOf();
    const { session, root, by, edit, save } = opened(bytes);
    if (addFirst) {
      session.setActive(root, null);
      expect(session.addEntry('', 'string', 'kept')).not.toBeNull();
    }
    const before = save();
    const held = creations(root);
    const was = by(name);
    // Refused once its every gate has judged the text, as a refusal of the setter's own would be.
    const real = MatlabVariableNode.prototype._setProperty;
    const spy = vi.spyOn(MatlabVariableNode.prototype, '_setProperty').mockImplementationOnce(function (this: MatlabVariableNode, key: string, text: string) {
      real.call(this, key, text);
      return REFUSAL;
    });
    try {
      expect(edit(was, 'Value', '"abc"')).toEqual(REFUSAL);
    } finally {
      spy.mockRestore();
    }
    expect([by(name), was.parent, root.dirty]).toEqual([was, root, addFirst]);
    expectCreations(root, held);
    expect(sameBytes(save(), before)).toBe(true);
    if (!addFirst) {
      expect(sameBytes(save(), new Uint8Array(bytes))).toBe(true);
    }
    expect(edit(by(name), 'Value', '"abc"')).toBe(true);
    expect(edit(by(name), 'Value', '"xyz"')).toBe(true);
    expect(shown(save()).find((r) => r.startsWith(name + ' '))).toBe(name + ' string [1,1] "xyz"');
  });

  it('leaves the file as it was when the setter throws, and records no step', () => {
    const bytes = plainFile();
    const { session, root, by, edit, save } = opened(bytes);
    const was = by('y');
    const spy = vi.spyOn(MatlabVariableNode.prototype, '_setProperty').mockImplementationOnce(() => {
      throw new Error('thrown for the test');
    });
    try {
      expect(() => edit(was, 'Value', '"abc"')).toThrow('thrown for the test');
    } finally {
      spy.mockRestore();
    }
    expect([by('y'), was.parent, root.dirty, root._creation, session.canUndo()]).toEqual([was, root, false, undefined, false]);
    expect(sameBytes(save(), new Uint8Array(bytes))).toBe(true);
    expect(edit(by('y'), 'Value', '"abc"')).toBe(true);
    expect(shown(save())[1]).toBe('y string [1,1] "abc"');
  });
});
