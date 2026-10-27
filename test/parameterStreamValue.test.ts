// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.Parameter a dictionary holds inside a cell or a struct, which it saves as a MAT stream
// (test/fixtures/param-stream, made by MATLAB R2027a and R2023b), its Value typed as text, an empty
// text and other classes: as MATLAB's p.Value = v makes it, and shown, after the edit and opened
// again, as MATLAB loads the saved dictionary.
//
//   - '' and "" are the string "" (S15 of the 2026-10-26 edit bash). A binary dictionary's stream
//     refused both, "cObj{1}.Value would be a char that is not one row of text".
//   - Such an object holds no DataType, its class default 'auto', which MATLAB's load derives of the
//     Value: 'string' of text, 'int8' of an int8, 'boolean' of a logical, 'single' of a single
//     (measured, R2027a and R2023b). The row showed 'auto', after the edit and opened again.
//   - Its Complexity, which R2027a saves as an index into the file's text that no cell swap writes,
//     MATLAB loads as the Value's: [1+2i 3] typed showed 'complex' and, opened again, 'real'.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest } from '../src/index.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DIR = fileURLToPath(new URL('./fixtures/param-stream/', import.meta.url));
const FILES = ['param_stream_binary_r2027a.sldd', 'param_stream_binary_r2023b.sldd', 'param_stream_text_r2027a.sldd'];

function opened(name: string, bytes = new Uint8Array(readFileSync(DIR + name))): { name: string; session: any; root: any } {
  const session = createSession();
  return { name, session, root: ingest(session, bytes, { filename: name }) };
}

const nodeAt = (root: any, path: string): any => root.flatten().find((n: any) => !n.isContainer && n.matlabPath === path);

function shownCell(node: any, key: string): string {
  const cell = node?.toRow()?.[key];
  return cell && typeof cell === 'object' ? String(cell.text ?? cell.label ?? '') : String(cell ?? '');
}

function typeInto(o: { session: any; root: any }, path: string, text: string): unknown {
  const node = nodeAt(o.root, path);
  o.session.setActive(o.root, node);
  return o.session.editProperty(node.id, 'Value', text, shownCell(node, 'Value'));
}

function reopened(o: { name: string; session: any; root: any }) {
  const out = o.session.serializeSource(o.root.name);
  return opened(o.name, out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes);
}

// The columns MATLAB sets with a Parameter's Value.
const shape = (root: any, path: string) => Object.fromEntries(['DataType', 'dimensions', 'complexity'].map((k) => [k, shownCell(nodeAt(root, path), k)]));

describe.each(FILES)('a Parameter in a cell or a struct of %s', (name) => {
  for (const path of ['cObj{1}', 'sObj.p']) {
    it.each(["''", '""'])(`%s typed at ${path} is the string ""`, (text) => {
      const o = opened(name);
      expect(typeInto(o, path, text)).toBe(true);
      const made = { DataType: 'string', dimensions: '[1 1]', complexity: 'real' };
      expect(shape(o.root, path)).toEqual(made);
      const again = reopened(o);
      expect(shape(again.root, path)).toEqual(made);
      expect(shownCell(nodeAt(again.root, path), 'Value')).toBe(shownCell(nodeAt(o.root, path), 'Value'));
    });

    it.each([
      ["'abc'", 'string', '[1 1]', 'real'],
      ['int8([1 2])', 'int8', '[1 2]', 'real'],
      ['true', 'boolean', '[1 1]', 'real'],
      ['single(2.5)', 'single', '[1 1]', 'real'],
      ['[1+2i 3]', 'auto', '[1 2]', 'complex'],
      ['7', 'auto', '[1 1]', 'real'],
    ])(`%s typed at ${path} shows the DataType and Complexity MATLAB loads`, (text, DataType, dimensions, complexity) => {
      const o = opened(name);
      expect(typeInto(o, path, text)).toBe(true);
      expect(shape(o.root, path)).toEqual({ DataType, dimensions, complexity });
      expect(shape(reopened(o).root, path)).toEqual({ DataType, dimensions, complexity });
    });
  }

  it.each([
    ["'abc'", { DataType: 'string', dimensions: '[1 1]', complexity: 'real' }],
    ['5', { DataType: 'auto', dimensions: '[1 1]', complexity: 'real' }],
    ['[1 2; 3 4]', { DataType: 'auto', dimensions: '[2 2]', complexity: 'real' }],
    ['int8([1 2])', { DataType: 'int8', dimensions: '[1 2]', complexity: 'real' }],
    ['[]', { DataType: 'auto', dimensions: '[1 2]', complexity: 'complex' }],
  ])('%s typed over the complex one shows what MATLAB loads', (text, made) => {
    const o = opened(name);
    expect(shape(o.root, 'cObj{2}')).toEqual({ DataType: 'auto', dimensions: '[1 2]', complexity: 'complex' });
    expect(typeInto(o, 'cObj{2}', text)).toBe(true);
    expect(shape(o.root, 'cObj{2}')).toEqual(made);
    expect(shape(reopened(o).root, 'cObj{2}')).toEqual(made);
  });

  it("text and then a number follow MATLAB's setter one edit at a time", () => {
    const o = opened(name);
    expect(typeInto(o, 'cObj{1}', "'abc'")).toBe(true);
    const again = reopened(o);
    expect(shape(again.root, 'cObj{1}')).toMatchObject({ DataType: 'string' });
    expect(typeInto(again, 'cObj{1}', '5')).toBe(true);
    expect(shape(again.root, 'cObj{1}')).toEqual({ DataType: 'auto', dimensions: '[1 1]', complexity: 'real' });
    expect(shape(reopened(again).root, 'cObj{1}')).toEqual({ DataType: 'auto', dimensions: '[1 1]', complexity: 'real' });
  });
});
