// Copyright 2026 The MathWorks, Inc.
//
// A MAT-file's string array takes an element added ("", as MATLAB's s(end+1) = "" adds one) and an
// element deleted (s(k) = []), as a text and a binary dictionary's do. A MAT-file's string is an
// object of its subsystem (MatlabVariableNode._mcosString), which offered neither, and gave no
// reason; its text took edits, whole or an element at a time. An element added or removed is an
// edit of that text, which a save writes into the string's payload (matObjectEdit). One string,
// a matrix and an empty array are refused, in every format, saying why.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));

function opened(file: string, given?: Uint8Array) {
  const session = createSession();
  const bytes = given ?? new Uint8Array(readFileSync(file.startsWith('/') ? file : join(TEST_ROOT, '..', file)));
  const root: any = ingest(session, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { filename: file.split('/').pop()! });
  const at = (path: string) => root.flatten().find((n: any) => n.matlabPath === path && !n.isContainer);
  const save = (): Uint8Array => {
    const out: any = session.serializeSource(root.name);
    return out.bytes ?? new TextEncoder().encode(out.text);
  };
  const edit = (path: string, text: string) => {
    const node = at(path);
    session.setActive(root, node);
    return session.editProperty(node.id, 'Value', text);
  };
  const undo = () => {
    session.setActive(root, null);
    session.undo();
  };
  const redo = () => {
    session.setActive(root, null);
    session.redo();
  };
  return { session, root, at, save, edit, undo, redo, reopen: () => opened(file, save()) };
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

// A string's texts and size, as a reader holds them.
const held = (n: any) => ({ texts: n._kind === 'string' ? [...n._elements] : [n._scalarValue], dims: [...n.dims] });

describe('a MAT-file string array', () => {
  for (const [file, path] of [
    ['test/parity/artifacts/mat/cases.mat', 'strArray'],
    ['test/fixtures/string-containers/r2027a/strings.mat', 'ce2{3}'],
    ['test/fixtures/string-containers/r2023b/strings.mat', 'ce2{3}'],
  ] as const) {
    it(`${file.split('/').slice(-2).join('/')} ${path}: takes "" added, saved as s(end+1) = "", and its text then`, () => {
      const o = opened(file);
      const read = o.save();
      const before = held(o.at(path));
      expect(o.session.addChildRefusal(o.at(path).id)).toBeNull();
      const child: any = o.session.addChildTo(o.at(path).id);
      expect(child.matlabPath).toBe(path + '(' + (before.texts.length + 1) + ')');
      const first = o.save();
      expect(held(o.reopen().at(path))).toEqual({ texts: [...before.texts, ''], dims: [1, before.texts.length + 1] });
      expect(o.edit(child.matlabPath, '"new"')).toBe(true);
      expect(held(o.reopen().at(path)).texts).toEqual([...before.texts, 'new']);
      o.undo();
      expect(same(o.save(), first)).toBe(true);
      o.undo();
      expect(same(o.save(), read)).toBe(true);
      o.redo();
      expect(same(o.save(), first)).toBe(true);
    });

    it(`${file.split('/').slice(-2).join('/')} ${path}: gives up each element, saved as s(k) = [], and one left is one string`, () => {
      const before = held(opened(file).at(path));
      for (let k = 1; k <= before.texts.length; k++) {
        const o = opened(file);
        const read = o.save();
        const element = o.at(path + '(' + k + ')');
        expect(o.session.deleteRefusal(element.id)).toBeNull();
        expect(o.session.deleteNodeById(element.id)).toBe(true);
        const left = before.texts.filter((_, i) => i !== k - 1);
        expect(held(o.reopen().at(path))).toEqual({ texts: left, dims: [1, left.length] });
        // One left is one string, with no element row (`"x"`), as MATLAB's 1x1 string.
        expect(o.reopen().at(path).children.length).toBe(left.length === 1 ? 0 : left.length);
        o.undo();
        expect(same(o.save(), read)).toBe(true);
      }
    });
  }

  it('gives a <missing> element up and takes it back on undo as <missing>, not ""', () => {
    // F1 of the review: the undo put back "" (`typeof restored === 'string' ? restored : ''`), and
    // a later edit saved ["" "z"] where MATLAB holds [<missing> "z"].
    for (const [del, kept] of [['sMissing(1)', 'sMissing(2)'], ['sMissing(2)', 'sMissing(1)']]) {
      const o = opened('test/fixtures/strings.mat');
      const before = held(o.at('sMissing')).texts;
      expect(before).toEqual([null, 'x']);
      expect(o.session.deleteNodeById(o.at(del).id)).toBe(true);
      o.undo();
      expect(held(o.at('sMissing')).texts).toEqual(before);
      expect(o.edit(kept, kept === 'sMissing(2)' ? '"z"' : '"z"')).toBe(true);
      const want = kept === 'sMissing(2)' ? [null, 'z'] : ['z', 'x'];
      expect(held(o.reopen().at('sMissing')).texts).toEqual(want);
    }
  });

  it('made by an edit takes an element added and deleted', () => {
    const o = opened('test/parity/artifacts/mat/cases.mat');
    expect(o.edit('scalarD', '["p" "q"]')).toBe(true);
    expect(!!o.session.addChildTo(o.at('scalarD').id)).toBe(true);
    expect(o.session.deleteNodeById(o.at('scalarD(1)').id)).toBe(true);
    expect(held(o.reopen().at('scalarD'))).toEqual({ texts: ['q', ''], dims: [1, 2] });
    const c = opened('test/fixtures/string-containers/r2027a/plain.mat');
    expect(c.edit('ce', '{1, ["a" "b"]}')).toBe(true);
    expect(!!c.session.addChildTo(c.at('ce{2}').id)).toBe(true);
    expect(c.reopen().at('ce').displayValue).toBe('{1, ["a" "b" ""]}');
  });

  it('is refused an Add where it is one string, a matrix or empty, saying why', () => {
    const o = opened('test/parity/artifacts/mat/cases.mat');
    expect(o.session.addChildRefusal(o.at('strScalar').id)).toBe(
      'Cannot add to "strScalar": it is one string, not a string array: type the whole value over it instead. Nothing was added.',
    );
    expect(o.session.addChildRefusal(o.at('strMat').id)).toBe(
      'Cannot add to "strMat": it is a 2x3 string array, which MATLAB grows by no element at its end, being no vector: type the whole value over it instead. Nothing was added.',
    );
    const c = opened('test/fixtures/string-containers/r2027a/cells.mat');
    expect(c.session.addChildRefusal(c.at('cEmpty{1}').id)).toBe(
      'Cannot add to "cEmpty{1}": it is an empty 0x3 string array, which an element added would make one string, with no element rows: type the whole value over it instead. Nothing was added.',
    );
    expect(c.session.addChildTo(c.at('cEmpty{1}').id)).toBeNull();
  });
});

describe('a string array, in a MAT-file and in a text and a binary dictionary', () => {
  it('shows and saves the same after the same Add and delete', () => {
    const shown: string[] = [];
    for (const file of ['test/parity/artifacts/mat/cases.mat', 'test/parity/artifacts/text/cases.sldd', 'test/parity/artifacts/binary/cases.sldd']) {
      const o = opened(file);
      expect(!!o.session.addChildTo(o.at('strArray').id)).toBe(true);
      expect(o.session.deleteNodeById(o.at('strArray(1)').id)).toBe(true);
      shown.push(o.at('strArray').displayValue + ' / ' + o.reopen().at('strArray').displayValue);
    }
    expect(shown).toEqual(Array(3).fill('["bb" "ccc" ""] / ["bb" "ccc" ""]'));
  });
});

describe('every string vector of every MAT fixture', () => {
  it('takes "" added and its first element deleted, each read back so and undone to the file as read', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.mat')) files.push(p);
      }
    };
    walk(TEST_ROOT);
    let added = 0;
    const wrong: string[] = [];
    for (const file of files.sort()) {
      let o: ReturnType<typeof opened>;
      try {
        o = opened(file);
      } catch {
        continue;
      }
      const vectors = o.root.flatten().filter((n: any) => n._mcosString && n._kind === 'string' && n.children.length > 0 && !o.session.addChildRefusal(n.id));
      for (const path of vectors.map((n: any) => n.matlabPath)) {
        const short = file.slice(TEST_ROOT.length) + ' ' + path;
        const read = o.save();
        const before = held(o.at(path));
        // Along its one dimension past 1, at any rank (test/ndShapeEdits.test.ts).
        const axis = before.dims.findIndex((d: number) => d !== 1);
        const grown = before.dims.map((d: number, i: number) => (i === axis ? before.texts.length + 1 : 1));
        if (!o.session.addChildTo(o.at(path).id)) {
          wrong.push(short + ': Add refused though offered');
          continue;
        }
        added++;
        const back = held(o.reopen().at(path));
        if (JSON.stringify(back) !== JSON.stringify({ texts: [...before.texts, ''], dims: grown })) wrong.push(short + ': reads back as ' + JSON.stringify(back));
        o.undo();
        if (!same(o.save(), read)) wrong.push(short + ': the undone Add saves other bytes');
        // An N-D string array's element is not deleted, MATLAB's releases leaving two shapes of it
        // (test/ndShapeEdits.test.ts).
        if (before.dims.length > 2 && /R2023b's leaves a row/.test(o.session.deleteRefusal(o.at(path + '(1)').id) ?? '')) {
          continue;
        }
        if (!o.session.deleteNodeById(o.at(path + '(1)').id)) {
          wrong.push(short + ': delete refused');
          continue;
        }
        const left = held(o.reopen().at(path)).texts;
        if (JSON.stringify(left) !== JSON.stringify(before.texts.slice(1))) wrong.push(short + ': deleted reads back as ' + JSON.stringify(left));
        o.undo();
        if (!same(o.save(), read)) wrong.push(short + ': the undone delete saves other bytes');
      }
    }
    expect(wrong).toEqual([]);
    expect(added).toBeGreaterThanOrEqual(30);
  }, 240_000);
});
