// Copyright 2026 The MathWorks, Inc.
//
// Add grows a cell as MATLAB's c{end+1} grows it, and a delete leaves what c(k) = [] leaves, in a
// MAT-file and in a text and a binary dictionary (measured, MATLAB R2027a): a column stays one
// while it holds more than one element; anything else grows and shrinks as a row. A 1x1 cell grew
// a column ({3} became {3; 0}, where MATLAB makes {3, 0}), and a cell emptied by deletes was 0x0,
// where MATLAB leaves 1x0. An undone Add puts back the size the cell had, an empty one's included.
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
  const undo = () => {
    session.setActive(root, null);
    session.undo();
  };
  return { session, root, at, save, undo, reopen: () => opened(file, save()) };
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

// The size MATLAB gives a vector of `dims` holding `count` elements after c{end+1} or c(k) = []:
// along its one dimension past 1, at any rank, while it holds more than one; else a row.
const matlabSize = (dims: number[], count: number) => {
  const axis = dims.reduce((a, b) => a * b, 1) === 0 ? -1 : dims.findIndex((d) => d !== 1);
  return count <= 1 || axis < 0 ? [1, count] : dims.map((_, i) => (i === axis ? count : 1));
};

const A = 'test/parity/artifacts/';
const FORMATS = [A + 'mat/cases.mat', A + 'text/cases.sldd', A + 'binary/cases.sldd'];

describe('Add on a cell, in a MAT-file and in a text and a binary dictionary', () => {
  for (const file of FORMATS) {
    const tag = file.split('/').slice(-2).join('/');

    it(`${tag}: grows a 1x1 cell as a row, {3} to {3, 0}, and is undone to 1x1`, () => {
      const o = opened(file);
      const read = o.save();
      expect(!!o.session.addChildTo(o.at('cellNest{2}{2}').id)).toBe(true);
      expect([o.at('cellNest{2}{2}')._dims, o.at('cellNest{2}{2}').displayValue]).toEqual([[1, 2], '{3, 0}']);
      expect(o.reopen().at('cellNest{2}{2}')._dims).toEqual([1, 2]);
      o.undo();
      expect([o.at('cellNest{2}{2}')._dims, o.at('cellNest{2}{2}').displayValue]).toEqual([[1, 1], '{3}']);
      if (file.endsWith('.mat')) expect(same(o.save(), read)).toBe(true);
    });

    it(`${tag}: grows an empty cell to 1x1, and is undone to the 0x0 it was`, () => {
      const o = opened(file);
      const read = o.save();
      expect(!!o.session.addChildTo(o.at('cellEmpty').id)).toBe(true);
      expect([o.at('cellEmpty')._dims, o.at('cellEmpty').displayValue]).toEqual([[1, 1], '{0}']);
      expect(o.reopen().at('cellEmpty')._dims).toEqual([1, 1]);
      o.undo();
      expect([o.at('cellEmpty')._dims, o.at('cellEmpty').displayValue]).toEqual([[0, 0], '{}']);
      if (file.endsWith('.mat')) expect(same(o.save(), read)).toBe(true);
    });

    it(`${tag}: deletes a 1x1 cell's element to 1x0, as c(1) = [] leaves it, and grows that to 1x1`, () => {
      const o = opened(file);
      const read = o.save();
      expect(o.session.deleteNodeById(o.at('cellNest{2}{2}{1}').id)).toBe(true);
      expect([o.at('cellNest{2}{2}')._dims, o.at('cellNest{2}').displayValue]).toEqual([[1, 0], '{2, cell(1,0)}']);
      const back = o.reopen();
      expect([back.at('cellNest{2}{2}')._dims, back.at('cellNest{2}').displayValue]).toEqual([[1, 0], '{2, cell(1,0)}']);
      expect(!!o.session.addChildTo(o.at('cellNest{2}{2}').id)).toBe(true);
      expect(o.at('cellNest{2}{2}')._dims).toEqual([1, 1]);
      o.undo();
      o.undo();
      expect(o.at('cellNest{2}{2}')._dims).toEqual([1, 1]);
      if (file.endsWith('.mat')) expect(same(o.save(), read)).toBe(true);
    });
  }

  for (const release of ['r2027a', 'r2023b']) {
    it(`${release} cells.mat: keeps a column a column, and a column down to one element is 1x1, then 1x0`, () => {
      const o = opened(`test/fixtures/string-containers/${release}/cells.mat`);
      expect(o.at('cColumn')._dims).toEqual([2, 1]);
      expect(!!o.session.addChildTo(o.at('cColumn').id)).toBe(true);
      expect(o.reopen().at('cColumn')._dims).toEqual([3, 1]);
      o.undo();
      expect(o.session.deleteNodeById(o.at('cColumn{1}').id)).toBe(true);
      expect(o.reopen().at('cColumn')._dims).toEqual([1, 1]);
      expect(o.session.deleteNodeById(o.at('cColumn{1}').id)).toBe(true);
      expect(o.reopen().at('cColumn')._dims).toEqual([1, 0]);
    });
  }
});

describe('every cell of every fixture that takes an Add', () => {
  it('grows and shrinks as MATLAB sizes it, saved so, and its Add undone to the size it had', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(mat|sldd)$/.test(e.name)) files.push(p);
      }
    };
    walk(TEST_ROOT);
    let grown = 0;
    let shrunk = 0;
    const wrong: string[] = [];
    for (const file of files.sort()) {
      let o: ReturnType<typeof opened>;
      try {
        o = opened(file);
      } catch {
        continue;
      }
      const cells = o.root.flatten().filter((n: any) => n._kind === 'cell' && !n.isContainer && !o.session.addChildRefusal(n.id)).slice(0, 30);
      for (const path of cells.map((n: any) => n.matlabPath)) {
        const short = file.slice(TEST_ROOT.length) + ' ' + path;
        const dims = [...o.at(path)._dims];
        const count = o.at(path).children.length;
        const want = matlabSize(dims, count + 1);
        if (!o.session.addChildTo(o.at(path).id)) {
          wrong.push(short + ': Add refused though offered');
          continue;
        }
        grown++;
        if (JSON.stringify(o.at(path)._dims) !== JSON.stringify(want)) wrong.push(short + ': grew to ' + JSON.stringify(o.at(path)._dims) + ', MATLAB ' + JSON.stringify(want));
        let back: any;
        try {
          back = o.reopen().at(path);
        } catch (e) {
          wrong.push(short + ': the save threw ' + (e as Error).message);
        }
        if (back && JSON.stringify(back._dims) !== JSON.stringify(want)) wrong.push(short + ': reads back as ' + JSON.stringify(back._dims));
        o.undo();
        if (JSON.stringify(o.at(path)._dims) !== JSON.stringify(dims)) wrong.push(short + ': undone to ' + JSON.stringify(o.at(path)._dims) + ', not ' + JSON.stringify(dims));
        const first = o.at(path).children[0];
        if (first && !o.session.deleteRefusal(first.id) && o.session.deleteNodeById(first.id)) {
          shrunk++;
          const left = matlabSize(dims, count - 1);
          if (JSON.stringify(o.at(path)._dims) !== JSON.stringify(left)) wrong.push(short + ': shrank to ' + JSON.stringify(o.at(path)._dims) + ', MATLAB ' + JSON.stringify(left));
          o.undo();
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(grown).toBeGreaterThanOrEqual(400);
    expect(shrunk).toBeGreaterThanOrEqual(340);
  }, 240_000);
});
