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
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
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

  it('is refused, and changes nothing, where the value typed holds a string a plain variable cannot', () => {
    const bytes = pvBasic();
    const { root, by, edit, save } = opened(bytes, 'pv_basic.mat');
    expect(edit(by('str'), 'Value', '{1, "a"}')).toMatchObject({ error: true, reason: 'Cannot edit "str": str would hold a string, which this package cannot write into a MAT-file.' });
    expect([by('str').className, by('str').displayValue, root.dirty]).toEqual(['string', '"hello"', false]);
    expect(sameBytes(save(), new Uint8Array(bytes))).toBe(true);
  });
});

