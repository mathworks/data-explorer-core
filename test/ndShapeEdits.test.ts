// Copyright 2026 The MathWorks, Inc.
//
// Add and delete on an N-D array, cell or string array, as MATLAB's end+1 and x(k) = [] shape it
// (measured, R2027a): a vector of any rank (one dimension past 1: 1x1x3, 1x1x1x3) grows and
// shrinks along that dimension, to 1x1 at one element and 1x0 at none; anything else (1x2x2,
// 2x1x2) MATLAB grows by no element (MATLAB:indexed_matrix_cannot_be_resized), and of it leaves a
// row where one is deleted, which no row shows. An N-D string array's element is not deleted:
// MATLAB R2027a keeps its shape and R2023b leaves a row. The gates asked only the first two dimensions, so
// a 1x2x2 took an Add, saved as a 1x5, and a 1x1x3 grew to a 1x4. test/fixtures/nd-shapes holds
// MATLAB's own files of each (make_nd_shapes.m).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));

function opened(file: string, given?: Uint8Array) {
  const session = createSession();
  const bytes = given ?? new Uint8Array(readFileSync(join(TEST_ROOT, 'fixtures/nd-shapes', file)));
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

// The vectors of each file, by the format's own reading: a text dictionary holds an N-D cell as a
// MAT stream it shows and does not edit, and an N-D string array as no value (MATLAB writes null);
// R2027a's binary dictionary refuses an N-D string array.
const VECTORS: Record<string, string[]> = {
  'r2027a/nd.mat': ['c113', 'x113', 's113', 'x1113', 'st.c113', 'st.x113', 'cc{1}'],
  'r2023b/nd.mat': ['c113', 'x113', 's113', 'x1113', 'st.c113', 'st.x113', 'cc{1}'],
  'r2027a/nd_text.sldd': ['x113', 'x1113', 'st.x113'],
  'r2027a/nd_binary.sldd': ['c113', 'x113', 'x1113', 'st.c113', 'st.x113', 'cc{1}'],
  'r2023b/nd_binary.sldd': ['c113', 'x113', 'x1113', 'st.c113', 'st.x113', 'cc{1}'],
};
const NOT_VECTORS: Record<string, string[]> = {
  'r2027a/nd.mat': ['c122', 'c212', 'x122', 'x212', 's122'],
  'r2023b/nd.mat': ['c122', 'c212', 'x122', 'x212', 's122'],
  'r2027a/nd_text.sldd': ['x122', 'x212'],
  'r2027a/nd_binary.sldd': ['c122', 'c212', 'x122', 'x212'],
  'r2023b/nd_binary.sldd': ['c122', 'c212', 'x122', 'x212'],
};
// What MATLAB R2027a's end+1 and x(1) = [] make of each (test/fixtures/nd-shapes, measured).
const GROWN: Record<string, number[]> = { '1x1x3': [1, 1, 4], '1x1x1x3': [1, 1, 1, 4] };
const SHRUNK: Record<string, number[]> = { '1x1x3': [1, 1, 2], '1x1x1x3': [1, 1, 1, 2] };

describe('an N-D vector, in a MAT-file and in a text and a binary dictionary', () => {
  for (const [file, paths] of Object.entries(VECTORS)) {
    for (const path of paths) {
      it(`${file} ${path}: grows along its one dimension past 1 and shrinks along it, as MATLAB does`, () => {
        const o = opened(file);
        const dims = o.at(path)._dims.join('x');
        expect(o.session.addChildRefusal(o.at(path).id)).toBeNull();
        expect(!!o.session.addChildTo(o.at(path).id)).toBe(true);
        expect([o.at(path)._dims, o.reopen().at(path)._dims]).toEqual([GROWN[dims], GROWN[dims]]);
        o.undo();
        expect(o.at(path)._dims.join('x')).toBe(dims);
        if (o.at(path)._kind === 'string') {
          // MATLAB R2027a's s(k) = [] keeps a 1x1x3 string's shape, R2023b's leaves a row: refused.
          expect(o.session.deleteRefusal(o.at(path).children[0].id)).toBe(
            'Cannot delete "' + path + '(1)": "' + path + '" is a ' + dims + ' string array, of which MATLAB R2027a\'s s(k) = [] keeps the shape and R2023b\'s leaves a row. Nothing was deleted.',
          );
          return;
        }
        expect(o.session.deleteNodeById(o.at(path).children[0].id)).toBe(true);
        expect([o.at(path)._dims, o.reopen().at(path)._dims]).toEqual([SHRUNK[dims], SHRUNK[dims]]);
        // Down to one element, a 1x1; and a cell, emptied, a 1x0.
        expect(o.session.deleteNodeById(o.at(path).children[0].id)).toBe(true);
        expect(o.reopen().at(path)._dims).toEqual([1, 1]);
        if (o.at(path)._kind === 'cell') {
          expect(o.session.deleteNodeById(o.at(path).children[0].id)).toBe(true);
          expect(o.reopen().at(path)._dims).toEqual([1, 0]);
        }
      });
    }
  }
});

describe('an N-D array that is no vector', () => {
  for (const [file, paths] of Object.entries(NOT_VECTORS)) {
    for (const path of paths) {
      it(`${file} ${path}: takes no Add and no delete, as MATLAB grows it by none and leaves a row of it`, () => {
        const o = opened(file);
        const node = o.at(path);
        const shape = node._dims.join('x');
        expect(o.session.addChildRefusal(node.id)).toMatch(
          new RegExp('^Cannot add to "' + path + '": it is a ' + shape + ' \\w+ array, which MATLAB grows by no element at its end, being no vector'),
        );
        expect(o.session.addChildTo(node.id)).toBeNull();
        const first = node.children[0];
        expect(o.session.deleteRefusal(first.id)).toMatch(
          new RegExp('^Cannot delete "' + first.matlabPath.replace(/[{}()]/g, '\\$&') + '": "' + path + '" is a ' + shape + ' \\w+ array, which an element deleted would make a 1x3 row, as MATLAB\'s x\\(k\\) = \\[\\] does'),
        );
        expect(o.session.deleteNodeById(first.id)).toBe(false);
      });
    }
  }
});
