// Copyright 2026 The MathWorks, Inc.
//
// A plain value beside an MCOS object in a struct or a cell of a MAT-file takes an edit: the struct
// or the cell is written fresh, and each object in it as the class-17 element it was read as, which
// names the same objects of the file's subsystem (MatlabVariableNode._objectMemberOf,
// MatWriter.withObjectMembers). An edit of the object's properties in the same save is written into
// the subsystem, as it is beside no edit. What is under an object and is none of its properties
// (an object array's own row) stays read-only, saying why; a string's text is its own object's edit.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { opaqueElementOf, parseMat } from '../src/datamodel/parser/MatParser.js';
import type { MatVariable } from '../src/datamodel/parser/MatParser.js';
import { subsystemElementOf } from '../src/datamodel/parser/MatFileWriter.js';
import { checkMatFile } from '../src/datamodel/parser/MatFileCheck.js';
import { mcosPlaceOf } from '../src/datamodel/node/mcosPlace.js';
import { sourceEditRefusal } from '../src/datamodel/node/BaseNode.js';

const FIXTURES = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');
const read = (rel: string) => new Uint8Array(readFileSync(join(FIXTURES, rel)));
const bufferOf = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

/** A MAT-file opened through the session, as a host opens one, and what a host does to it. */
function opened(bytes: Uint8Array) {
  const session = createSession();
  const root: any = session.addMatSource('f.mat', bufferOf(bytes));
  const all = (): any[] => {
    const out: any[] = [];
    const walk = (n: any) => {
      out.push(n);
      n.children.forEach(walk);
    };
    walk(root);
    return out;
  };
  const at = (path: string) => all().find((n) => n !== root && n.matlabPath === path);
  const edit = (path: string, prop: string, value: string) => {
    const node = at(path);
    session.setActive(root, node);
    return session.editProperty(node.id, prop, value);
  };
  const save = (): Uint8Array => (session.serializeSource('f.mat') as { bytes: Uint8Array }).bytes;
  return { session, root, all, at, edit, save };
}

/** Every MCOS object held in a struct field or a cell element of `bytes`, by MATLAB path: its element as read. */
function objectMembers(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (v: MatVariable | null, path: string, top: boolean) => {
    if (!v) {
      return;
    }
    if (v.isOpaque && !top) {
      out.set(path, (v._rawBytes ?? opaqueElementOf(v))!);
      return;
    }
    for (const [name, held] of Object.entries(v.fields ?? {})) {
      (Array.isArray(held) ? held : [held]).forEach((m, i) => walk(m, path + (Array.isArray(held) ? '(' + (i + 1) + ')' : '') + '.' + name, false));
    }
    if (v.className === 'cell' && Array.isArray(v.value)) {
      (v.value as (MatVariable | null)[]).forEach((m, i) => walk(m, path + '{' + (i + 1) + '}', false));
    }
  };
  for (const v of parseMat(bufferOf(bytes)).variables) {
    if (!v._anonymous) {
      walk(v, v.name, true);
    }
  }
  return out;
}

function subsystemOf(bytes: Uint8Array): Uint8Array {
  const parsed = parseMat(bufferOf(bytes));
  return subsystemElementOf(parsed.records.find((r) => r.offset === parsed.subsystemOffset)!)!;
}

/** What a host reads of every node under `path`, a variable or an object at any depth, as text. */
function shown(o: ReturnType<typeof opened>, path: string): string[] {
  return o
    .all()
    .filter((n) => n.matlabPath === path || n.matlabPath.startsWith(path + '.') || n.matlabPath.startsWith(path + '{') || n.matlabPath.startsWith(path + '('))
    .map((n) => n.matlabPath + ' <' + n.className + '> ' + n.displayValue + ' | ' + n.getProperties().map((p: any) => p.key + '=' + n.getPropInfo(p).displayValue).join(' '));
}

/** Every object member of `saved` is the element it was in `original`, byte for byte, and nothing the strict checker finds is new. */
function expectObjectsAsRead(original: Uint8Array, saved: Uint8Array): number {
  const was = objectMembers(original);
  const is = objectMembers(saved);
  expect([...is.keys()]).toEqual([...was.keys()]);
  for (const [path, element] of was) {
    expect(sameBytes(is.get(path)!, element), path).toBe(true);
  }
  expect(checkMatFile(saved).length).toBe(checkMatFile(original).length);
  return was.size;
}

describe('a plain field beside an object in a struct, edited', () => {
  it('is written, the struct fresh and its object as the element it was read as; the subsystem as it was', () => {
    const original = read('mat-cellswap/pv_nested.mat');
    const o = opened(original);
    const before = shown(opened(original), 's');
    expect(sourceEditRefusal(o.at('s.k'), 'Value')).toBeNull();
    expect(o.at('s.k').valueEditable).toBe(true);
    expect(o.edit('s.k', 'Value', '7')).toBe(true);
    const saved = o.save();
    expect(expectObjectsAsRead(original, saved)).toBe(2);
    expect(sameBytes(subsystemOf(saved), subsystemOf(original))).toBe(true);
    const after = shown(opened(saved), 's');
    expect(after).toEqual(before.map((line) => (line.startsWith('s.k ') ? line.replace(/^s\.k <double> 1 \| (.*)Value=1/, 's.k <double> 7 | $1Value=7') : line)));
    expect(opened(saved).at('s.k').displayValue).toBe('7');
  });

  it("and an edit of the object's property in the same save: both written, the property into the subsystem", () => {
    const original = read('mat-cellswap/pv_nested.mat');
    const o = opened(original);
    expect([o.edit('s.k', 'Value', '7'), o.edit('s.p', 'Value', '8')]).toEqual([true, true]);
    const saved = o.save();
    expectObjectsAsRead(original, saved);
    expect(sameBytes(subsystemOf(saved), subsystemOf(original))).toBe(false);
    const again = opened(saved);
    expect([again.at('s.k').displayValue, again.at('s.p').displayValue]).toEqual(['7', '8']);
  });

  it('a field added to a struct of objects of every kind: each, at any depth, the element it was read as', () => {
    const original = read('mcos/nested_objects.mat');
    const o = opened(original);
    const before = shown(opened(original), 's');
    o.session.setActive(o.root, o.at('s'));
    expect(o.session.addChildTo(o.at('s').id)).not.toBeNull();
    const saved = o.save();
    // A Parameter, a nested struct's Parameter, three strings, a Bus, a ValueType, an AliasType,
    // a Signal, an object array: and the rest of the file's.
    expect(expectObjectsAsRead(original, saved)).toBeGreaterThan(10);
    const after = shown(opened(saved), 's');
    expect(after.filter((line) => !/^s\.field/.test(line) && !/^s </.test(line))).toEqual(before.filter((line) => !/^s </.test(line)));
  });
});

describe('a plain element beside an object in a cell, edited', () => {
  it("is written, each object at any depth its element as read: a Parameter, a string, a cell's Parameter", () => {
    const original = read('mcos/nested_objects.mat');
    const o = opened(original);
    const before = shown(opened(original), 'c');
    expect(o.edit('c{3}', 'Value', '43')).toBe(true);
    const saved = o.save();
    expectObjectsAsRead(original, saved);
    expect(sameBytes(subsystemOf(saved), subsystemOf(original))).toBe(true);
    expect(shown(opened(saved), 'c')).toEqual(before.map((line) => line.replace(/\b42\b/g, '43')));
  });

  it('beside an object array and string arrays', () => {
    const original = read('mcos/nested_objects.mat');
    const o = opened(original);
    expect(o.edit('cArr{4}', 'Value', '4')).toBe(true);
    const saved = o.save();
    expectObjectsAsRead(original, saved);
    const again = opened(saved);
    expect(['cArr{1}', 'cArr{2}', 'cArr{3}', 'cArr{4}'].map((p) => again.at(p).displayValue)).toEqual(['["a" "b" "c"]', '<1x2 Simulink.Parameter>', 'strings(0,0)', '4']);
    expect([again.at('cArr{2}(1)').displayValue, again.at('cArr{2}(2)').displayValue]).toEqual(['1', '2']);
  });

  it("text over a char element beside a Parameter, and the Parameter's own edit", () => {
    const original = read('mat-cellswap/pv_nested.mat');
    const o = opened(original);
    expect([o.edit('c{2}', 'Value', "'y'"), o.edit('c{1}', 'Value', '9')]).toEqual([true, true]);
    const saved = o.save();
    expectObjectsAsRead(original, saved);
    const again = opened(saved);
    expect([again.at('c{1}').displayValue, again.at('c{2}').displayValue]).toEqual(['9', "'y'"]);
  });
});

describe("what is under an object and none of its properties: read-only, saying why", () => {
  it("an object array's own row; a string's element, whose text it takes", () => {
    const o = opened(read('mcos/nested_objects.mat'));
    expect(sourceEditRefusal(o.at('s.objArr'), 'Description')).toBe(
      "Cannot edit \"s\": s.objArr is an object of the file, which a save writes as it was read: only the properties of an object it takes are written into the file's objects.",
    );
    // A string is an object of the file whose text a save writes into its payload (matObjectEdit).
    expect(sourceEditRefusal(o.at('s.strs(1,1)'), 'Value')).toBeNull();
    expect(o.at('s.objArr').getPropInfo(o.at('s.objArr').getProperties().find((p: any) => p.key === 'Description')).editable).toBe(false);
    expect(o.root.dirty).toBe(false);
  });

  it('a plain field beside an object whose handle the reader did not read', () => {
    const o = opened(read('mat-cellswap/pv_nested.mat'));
    const variable = mcosPlaceOf(o.at('s.p'))!.variable;
    variable.mcosHandle = null;
    expect(o.edit('s.k', 'Value', '7')).toMatchObject({
      error: true,
      reason: 'Cannot edit "s": s.p holds an object whose handle this package could not read, so a save could not write it as it is.',
    });
    expect(o.root.dirty).toBe(false);
  });

  it('a top-level object is as it was: no plain value of it to edit', () => {
    const o = opened(read('mat-cellswap/pv_nested.mat'));
    expect(o.edit('arr', 'Value', '7')).toMatchObject({ error: true });
  });
});
