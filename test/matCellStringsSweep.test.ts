// Copyright 2026 The MathWorks, Inc.
//
// Over every MAT-file the test tree holds, every variable and every struct field and cell element
// whose row offers a Value editor, typed `{1, "a"}`: taken exactly where a save writes it and a
// reopen shows what the rows showed; undone, the file is saved as it was read. Refused only where
// what holds the value refuses a cell, a Simulink.Parameter, MATLAB's rule for its Value, and
// then nothing changes (MatNode._retype, _makeStringsIn; matCellStrings.test.ts).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import * as NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import '../src/datamodel/node/data/NodeClassMap.js';
import { copiesOf, fixture, sameBytes, target } from './tools/matPaste.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));
const PARAMETER_VALUE = /^Invalid value specified for parameter\. Value must be a numeric array/;

function matsUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...matsUnder(p));
    else if (e.name.endsWith('.mat')) out.push(p);
  }
  return out.sort();
}

function opened(bytes: Uint8Array) {
  const session = createSession();
  const root: any = session.addMatSource('m.mat', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const save = (): Uint8Array => (session.serializeSource('m.mat') as { bytes: Uint8Array }).bytes;
  const edit = (path: string, value: string) => {
    const node = root.flatten().find((n: any) => n.matlabPath === path);
    session.setActive(root, node);
    return session.editProperty(node.id, 'Value', value);
  };
  const undo = () => {
    session.setActive(root, root.children[0]);
    session.undo();
  };
  return { session, root, save, edit, undo };
}

/** The rows at and under `path`: each one's path, class and text. */
function rowsUnder(root: any, path: string): string[] {
  const under = (p: string) => p === path || ['{', '.', '('].some((c) => p.startsWith(path + c));
  return root.flatten().filter((n: any) => under(n.matlabPath)).map((n: any) => [n.matlabPath, n.className, n.displayValue].join(' '));
}

// A variable, or a struct field or a cell element of one.
const isPlace = (n: any, root: any) => n.parent === root || n.parent?._kind === 'cell' || n.parent?._holdsFields?.();

describe('every variable, struct field and cell element of every MAT-file fixture', () => {
  it('takes a cell holding a string exactly where the save writes it and a reopen reads it', { timeout: 300_000 }, () => {
    const wrong: string[] = [];
    const unopened: string[] = [];
    let files = 0;
    let taken = 0;
    let refused = 0;
    for (const file of matsUnder(TEST_ROOT)) {
      const bytes = new Uint8Array(readFileSync(file));
      let paths: string[];
      try {
        const { root } = opened(bytes);
        paths = root.flatten().filter((n: any) => n.valueEditable && isPlace(n, root)).map((n: any) => n.matlabPath);
      } catch (e) {
        unopened.push(file.slice(TEST_ROOT.length) + ': ' + (e as Error).message);
        continue;
      }
      files++;
      for (const path of paths) {
        const label = file.slice(TEST_ROOT.length) + ' ' + path;
        const { root, save, edit, undo } = opened(bytes);
        const r: any = edit(path, '{1, "a"}');
        if (r !== true) {
          refused++;
          if (!PARAMETER_VALUE.test(r?.reason ?? '') || root.dirty || !sameBytes(save(), bytes)) wrong.push(label + ': refused, ' + JSON.stringify(r));
          continue;
        }
        taken++;
        const shown = rowsUnder(root, path);
        let saved: Uint8Array;
        try {
          saved = save();
        } catch (e) {
          wrong.push(label + ': taken, and the save refused it: ' + (e as Error).message);
          continue;
        }
        const back = rowsUnder(opened(saved).root, path);
        if (JSON.stringify(back) !== JSON.stringify(shown)) wrong.push(label + ': shows ' + JSON.stringify(shown) + ', reopened ' + JSON.stringify(back));
        undo();
        if (!sameBytes(save(), bytes)) wrong.push(label + ': undone, the save is not the file as read');
      }
    }
    expect(wrong).toEqual([]);
    expect(unopened).toEqual(['fixtures/strings_v73.mat: MAT-file version 7.3 (HDF5) is not supported']);
    // At least what was measured when this was written: 595 files opened; 1422 places taken the
    // cell, 404 refused it, every one a Simulink.Parameter's Value.
    expect(files).toBeGreaterThanOrEqual(595);
    expect(taken).toBeGreaterThanOrEqual(1422);
    expect(refused).toBeGreaterThanOrEqual(404);
  });
});

// Every copy of every source fixture whose value holds a string in a cell or a struct (a text or a
// binary dictionary's, another MAT-file's), pasted into a MAT-file with no objects, one with
// objects and one holding strings: made, each string an object of the file (matPaste's stand-ins,
// MatNode._makeStrings); saved and reopened as the rows showed it; undone, the file as it was read.
describe('a struct or a cell holding a string, pasted into a MAT-file', () => {
  const DIRS = ['test/fixtures', 'test/fixtures/mcos', 'test/fixtures/sparse', 'test/fixtures/string-containers/r2027a', 'test/fixtures/string-containers/r2023b', 'test/parity/artifacts/text', 'test/parity/artifacts/binary', 'test/parity/artifacts/mat'];
  const SOURCES = DIRS.flatMap((d) => readdirSync(join(TEST_ROOT, '..', d)).filter((f) => /\.(sldd|mat)$/.test(f) && !/v73/.test(f)).map((f) => d + '/' + f));
  const INTO = ['test/fixtures/mcos-templates/targets/r2023b/none.mat', 'test/fixtures/mcos-templates/targets/r2027a/mixed.mat', 'test/fixtures/string-containers/r2027a/strings.mat'];
  const holdsString = (n: any, top = true): boolean =>
    (!top && n._scalarType === 'string') || ((n._kind === 'cell' || n._scalarType === 'struct' || n.constructor?.name === 'StructNode') && (n.children ?? []).some((c: any) => holdsString(c, false)));

  // The only reasons a paste of such a value is refused: an object in it as well, or a string no
  // text spells.
  const REFUSALS = [
    /^Cannot paste "[^"]*" into "t\.mat": \S+ is a string, which a paste makes anew of its text, and (it is a \d+x\d+(x\d+)* string array|it holds <missing>), which no text spells\. Nothing was pasted\.$/,
    /^Cannot paste "[^"]*" into "t\.mat": \S+ is a Simulink\.Parameter object, and a value pasted into a MAT-file holds no object but at its top: a paste writes no new object inside a struct or a cell\. Nothing was pasted\.$/,
  ];

  it('is made, saved and read back as it shows, and undone to the file as read', { timeout: 300_000 }, () => {
    const wrong: string[] = [];
    const unread: string[] = [];
    let pasted = 0;
    let refused = 0;
    for (const source of SOURCES) {
      let copies: ReturnType<typeof copiesOf>;
      try {
        copies = copiesOf(source);
      } catch (e) {
        unread.push(source + ': ' + (e as Error).message);
        continue;
      }
      for (const { entry, payload } of copies) {
        if (payload === null || !holdsString(NodeRegistry.parseValue(payload.value, 'x', null))) continue;
        for (const into of INTO) {
          const label = `${source} ${entry.name} into ${into}`;
          const bytes = fixture(into);
          const t = target(bytes);
          const made: any = t.session.pasteEntries('t.mat', [payload]);
          if (made.error) {
            refused++;
            if (!REFUSALS.some((r) => r.test(made.reason)) || !sameBytes(t.save(), bytes)) wrong.push(label + ': refused, ' + made.reason);
            continue;
          }
          pasted++;
          const name = made.nodes[0].name;
          const shown = rowsUnder(t.root, name);
          const back = rowsUnder(opened(t.save()).root, name);
          if (JSON.stringify(back) !== JSON.stringify(shown)) wrong.push(label + ': shows ' + JSON.stringify(shown) + ', reopened ' + JSON.stringify(back));
          t.session.undo();
          if (!sameBytes(t.save(), bytes)) wrong.push(label + ': undone, the save is not the file as read');
        }
      }
    }
    expect(wrong).toEqual([]);
    // Every source reads, so none is passed over unseen.
    expect(unread).toEqual([]);
    // At least what was measured when this was written: 129 pastes made; 54 refused, of a value
    // holding an object as well, or a string no text spells (<missing>, an empty or N-D array).
    expect(pasted).toBeGreaterThanOrEqual(129);
    expect(refused).toBeGreaterThanOrEqual(54);
  });
});

// Every cell of every MAT fixture that holds a string, itself or in a cell it holds: spelled by its
// text, and so taking an edit of it, exactly where it holds no other object and each string's text
// spells it (MatlabVariableNode._spellsStrings, _spellsItself); that text typed back is no edit,
// and typed back respelled (`{ ` for `{`) is a retype that makes the same value, saved and read back
// as it showed, and undone to the file as read.
describe('a MAT-file cell holding strings, its text typed back', () => {
  const holdsString = (n: any): boolean => n.children.some((c: any) => (c._isOpaque && c._opaqueClassName === 'string') || (c._kind === 'cell' && holdsString(c)));
  // What locks such a cell, shown as `text`: another object it holds, or a summary of a string or of another value.
  const lockedBy = (spells: boolean, text: string): string => {
    if (!spells) return 'another object';
    return /<[^>]* string>/.test(text) ? 'a string no text spells' : 'a summary of another value';
  };

  it('is no edit, and respelled is the same value', { timeout: 300_000 }, () => {
    const wrong: string[] = [];
    const locked = new Map<string, number>();
    let editable = 0;
    for (const file of matsUnder(TEST_ROOT)) {
      const bytes = new Uint8Array(readFileSync(file));
      let cells: { path: string; text: string; offered: boolean; spells: boolean }[];
      try {
        const { root } = opened(bytes);
        cells = root.flatten().filter((n: any) => n._kind === 'cell' && !n._isOpaque && holdsString(n))
          .map((n: any) => ({ path: n.matlabPath, text: n.displayValue, offered: n.valueEditable, spells: n._spellsStrings() }));
      } catch {
        continue;
      }
      for (const { path, text, offered, spells } of cells) {
        const label = file.slice(TEST_ROOT.length) + ' ' + path;
        const summarized = /<[^>]*>/.test(text);
        if (!offered) {
          const why = lockedBy(spells, text);
          locked.set(why, (locked.get(why) ?? 0) + 1);
          if (!summarized) wrong.push(label + ': spelled ' + text + ', yet takes no edit of it');
          continue;
        }
        editable++;
        if (summarized) wrong.push(label + ': takes an edit of ' + text + ', a summary');
        const once = opened(bytes);
        const same: any = once.edit(path, text);
        if (same !== true || once.root.dirty || !sameBytes(once.save(), bytes)) wrong.push(label + ': typed back, ' + JSON.stringify(same));
        const again = opened(bytes);
        const before = rowsUnder(again.root, path);
        const r: any = again.edit(path, '{ ' + text.slice(1));
        if (r !== true) {
          wrong.push(label + ': respelled, refused ' + JSON.stringify(r));
          continue;
        }
        const back = rowsUnder(opened(again.save()).root, path);
        // Every member of its class: an int8 is spelled int8(3) (MatlabVariableNode._classSpelled).
        if (JSON.stringify(back) !== JSON.stringify(before)) {
          wrong.push(label + ': respelled, reopened ' + JSON.stringify(back) + ' where it was ' + JSON.stringify(before));
        }
        again.undo();
        if (!sameBytes(again.save(), bytes)) wrong.push(label + ': undone, the save is not the file as read');
      }
    }
    expect(wrong).toEqual([]);
    // At least what was measured when this was written: 29 cells taking an edit of their text; 12
    // not, 4 holding another object, 6 a string no text spells (<missing>, an empty or N-D array),
    // 2 a summary of another value (a struct).
    expect(editable).toBeGreaterThanOrEqual(29);
    expect(Object.fromEntries(locked)).toEqual({ 'another object': 4, 'a string no text spells': 6, 'a summary of another value': 2 });
  });
});
