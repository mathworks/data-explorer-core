// Copyright 2026 The MathWorks, Inc.
//
// An empty Value keeps the Complexity and Dimensions a Simulink.Parameter has, as MATLAB's setter
// keeps them, the edits before it included: v.Value = 3+4i; v.Value = [] leaves 'complex' and
// [1 1] over [1+2i 3-4i] (measured, R2027a and R2023b; Dimensions that are an empty's become the
// empty's size). MATLAB's load derives the Complexity of a Value that is not empty, and takes an empty
// one's from the file, so the save holds the one kept:
//
//   - a MAT-file writes it, where the file held another (3+4i and then [] in one session was saved
//     'real'; a file whose Value cell holds a complex value beside Complexity 'real', mat-cellswap's
//     mut_complex_value_only, given [] was saved 'real');
//   - a dictionary's MAT stream swaps its cell for it where it holds one (R2023b), and refuses the
//     empty Value where it holds it as an index into the file's text (R2027a), which no edit here
//     writes: it was saved, and loaded, 'real'.
//
// And a Min or a Max is held to the DataType MATLAB loads, one derived of a Value of another class
// than double beside a DataType saved as 'auto' (mut_class_logical: -10 under a logical Value is
// outside 'boolean's range, which MATLAB warns of on every load; it was taken).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest } from '../src/index.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

function opened(file: string, bytes = new Uint8Array(readFileSync(FIXTURES + file))): { file: string; session: any; root: any } {
  const session = createSession();
  return { file, session, root: ingest(session, bytes, { filename: file.split('/').pop()! }) };
}

const nodeAt = (root: any, path: string): any => root.flatten().find((n: any) => !n.isContainer && n.matlabPath === path);

function shownCell(node: any, key: string): string {
  const cell = node?.toRow()?.[key];
  return cell && typeof cell === 'object' ? String(cell.text ?? cell.label ?? '') : String(cell ?? '');
}

function typeInto(o: { session: any; root: any }, path: string, key: string, text: string): any {
  const node = nodeAt(o.root, path);
  o.session.setActive(o.root, node);
  return o.session.editProperty(node.id, key, text, shownCell(node, key));
}

function reopened(o: { file: string; session: any; root: any }) {
  const out = o.session.serializeSource(o.root.name);
  return opened(o.file, out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes);
}

const complexity = (o: { root: any }, path: string) => shownCell(nodeAt(o.root, path), 'complexity');

// [file, the Parameter, whether its file holds the Complexity in no cell an edit swaps]
const HOLDERS: [string, string, boolean][] = [
  ['edit-bash/r2027a/values.mat', 'pProps', false],
  ['edit-bash/r2023b/values.mat', 'sHoldsParam.p', false],
  ['edit-bash/r2027a/values.mat', 'cHoldsParam{1}', false],
  ['param-stream/param_stream_binary_r2023b.sldd', 'cObj{1}', false],
  ['param-stream/param_stream_text_r2027a.sldd', 'sObj.p', false],
  ['param-stream/param_stream_binary_r2027a.sldd', 'cObj{1}', true],
];

describe('an empty Value keeps the Complexity the Parameter has', () => {
  for (const [file, path, unwritten] of HOLDERS) {
    for (const between of [false, true]) {
      it(`${file} ${path}: 3+4i and then []${between ? ', saved between' : ''}`, () => {
        let o = opened(file);
        expect(typeInto(o, path, 'Value', '3+4i')).toBe(true);
        if (between) {
          o = reopened(o);
        }
        expect(complexity(o, path)).toBe('complex');
        const r = typeInto(o, path, 'Value', '[]');
        if (unwritten) {
          expect(r).toMatchObject({
            error: true,
            reason: `Cannot edit "${path.split(/[.{]/)[0]}": ${path}.Value would be empty, over which MATLAB keeps the Parameter's Complexity 'complex', and this file holds 'real' for it in a form this editor does not write, so it would load as that.`,
          });
          return;
        }
        expect(r).toBe(true);
        expect(complexity(o, path)).toBe('complex');
        expect(complexity(reopened(o), path)).toBe('complex');
      });
    }
  }

  // And its Dimensions: [1 1] after 3+4i over [1+2i 3-4i], written [1 2], the file's.
  it.each([
    ['edit-bash/r2027a/values.mat', 'pComplex'],
    ['edit-bash/r2023b/values.mat', 'pComplex'],
    ['param-stream/param_stream_binary_r2023b.sldd', 'cObj{2}'],
    ['param-stream/param_stream_text_r2027a.sldd', 'cObj{2}'],
  ])('%s %s: 3+4i and then [] keeps Dimensions [1 1]', (file, path) => {
    const o = opened(file);
    expect(typeInto(o, path, 'Value', '3+4i')).toBe(true);
    expect(typeInto(o, path, 'Value', '[]')).toBe(true);
    const shape = (x: { root: any }) => [shownCell(nodeAt(x.root, path), 'dimensions'), complexity(x, path)];
    expect(shape(o)).toEqual(['[1 1]', 'complex']);
    expect(shape(reopened(o))).toEqual(['[1 1]', 'complex']);
  });

  it('a Value the Parameter holds complex already takes [] in a stream that holds no Complexity cell', () => {
    const o = opened('param-stream/param_stream_binary_r2027a.sldd');
    expect(typeInto(o, 'cObj{2}', 'Value', '[]')).toBe(true);
    expect(complexity(reopened(o), 'cObj{2}')).toBe('complex');
  });

  it("a MAT-file whose Value cell holds a complex value beside Complexity 'real' writes the one MATLAB keeps", () => {
    const o = opened('mat-cellswap/mut_complex_value_only.mat');
    expect(complexity(o, 'p')).toBe('complex');
    expect(typeInto(o, 'p', 'Value', '[]')).toBe(true);
    expect(complexity(reopened(o), 'p')).toBe('complex');
  });
});

describe('a bound is held to the DataType MATLAB loads', () => {
  it.each([['Min', '-10'], ['Max', '5']])("%s %s under a logical Value beside a DataType saved as 'auto' is refused", (key, text) => {
    const o = opened('mat-cellswap/mut_class_logical.mat');
    expect(shownCell(nodeAt(o.root, 'p'), 'DataType')).toBe('boolean');
    expect(typeInto(o, 'p', key, text)).toMatchObject({
      error: true,
      reason: `Cannot edit "p": p.${key} (${text}) would be outside the range [0, 1] of its DataType 'boolean', which MATLAB loads with a warning on every load.`,
    });
  });

  it('a bound inside its range is taken', () => {
    const o = opened('mat-cellswap/mut_class_logical.mat');
    expect(typeInto(o, 'p', 'Min', '0')).toBe(true);
    expect(shownCell(nodeAt(reopened(o).root, 'p'), 'Min')).toBe('0');
  });
});
