// Copyright 2026 The MathWorks, Inc.
//
// Every cell of every fixture that takes an edit of its whole text, a MAT-file's and a text and a
// binary dictionary's, at any depth: its text typed back is no edit, and typed back respelled
// (`{ ` for `{`) is the value it was, saved and read back member for member, each of its class.
//
// A member of a numeric class other than double was shown as the number alone (int8(3) as 3), so
// the cell's text typed back changed made it a double, in every format. It is spelled with its
// class now, `{1, 'two', int8(3)}`, `uint16([1 2])`, `single(2.5)`, `int16([3+4i 5-6i])`, which
// the text parser reads back as that class (MatlabValueParser.classCall); a member whose class no
// text spells exactly (a single -0 shows 0) leaves its cell no editor of its text
// (MatlabVariableNode._classSpelled, _classUnspelled).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p));
    else if (/\.(mat|sldd)$/.test(e.name)) out.push(p);
  }
  return out.sort();
}

function opened(bytes: Uint8Array, name: string) {
  const session = createSession();
  const root: any = ingest(session, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { filename: name });
  const save = (): Uint8Array => {
    const out: any = session.serializeSource(root.name);
    return out.bytes ?? new TextEncoder().encode(out.text);
  };
  const edit = (path: string, value: string) => {
    const node = root.flatten().find((n: any) => n.matlabPath === path);
    session.setActive(root, node);
    return session.editProperty(node.id, 'Value', value);
  };
  return { session, root, save, edit };
}

/** A fixture, by its path from the repo's root, opened. */
const openedFixture = (file: string) => opened(new Uint8Array(readFileSync(join(TEST_ROOT, '..', file))), file.split('/').pop()!);

/** A MAT-file's variables, or a dictionary's entries of every section. */
const entriesOf = (root: any): any[] => (root.constructor.name === 'MatNode' ? root.children : root.children.flatMap((s: any) => s.children));

/** The rows at and under `path`: each one's path, class and text. */
function rowsUnder(root: any, path: string): string[] {
  const under = (p: string) => p === path || ['{', '.', '('].some((c) => p.startsWith(path + c));
  return root.flatten().filter((n: any) => under(n.matlabPath)).map((n: any) => [n.matlabPath, n.className, n.displayValue].join(' '));
}

describe('a cell that takes an edit of its text, that text typed back', () => {
  it('is no edit, and respelled is the cell it was, each member of its class', { timeout: 300_000 }, () => {
    const wrong: string[] = [];
    let cells = 0;
    let typed = 0;
    const files = new Set<string>();
    for (const file of filesUnder(TEST_ROOT)) {
      const bytes = new Uint8Array(readFileSync(file));
      const name = file.split('/').pop()!;
      let found: { path: string; text: string }[];
      try {
        const { root } = opened(bytes, name);
        if (typeof root?.flatten !== 'function') continue;
        found = root.flatten().filter((n: any) => n._kind === 'cell' && !n._isOpaque && n.valueEditable && n.matlabPath).map((n: any) => ({ path: n.matlabPath, text: n.displayValue }));
      } catch {
        continue;
      }
      for (const { path, text } of found) {
        cells++;
        files.add(file);
        const label = file.slice(TEST_ROOT.length) + ' ' + path;
        const once = opened(bytes, name);
        if (once.edit(path, text) !== true || once.root.dirty) wrong.push(label + ': typed back, an edit');
        const again = opened(bytes, name);
        const before = rowsUnder(again.root, path);
        const r: any = again.edit(path, '{ ' + text.slice(1));
        if (r !== true) {
          wrong.push(label + ': respelled, refused ' + JSON.stringify(r));
          continue;
        }
        typed++;
        const back = rowsUnder(opened(again.save(), name).root, path);
        if (JSON.stringify(back) !== JSON.stringify(before)) wrong.push(label + ': respelled, reopened ' + JSON.stringify(back) + ' where it was ' + JSON.stringify(before));
      }
    }
    expect(wrong).toEqual([]);
    // At least what was measured when this was written: 292 cells of 97 files.
    expect(cells).toBeGreaterThanOrEqual(292);
    expect(files.size).toBeGreaterThanOrEqual(97);
    expect(typed).toBe(cells);
  });
});

describe('a cell of members of other numeric classes', () => {
  const MEMBERS = "{1, int8(-3), uint16([1 2]), single(2.5), uint64(18446744073709551615), int32([1 2; 3 4]), single([1.5 NaN]), int16([3+4i 5-6i])}";
  const CELLS = 'test/fixtures/string-containers/r2027a/cells.mat';
  it.each([
    [CELLS],
    ['test/parity/artifacts/text/cases.sldd'],
    ['test/parity/artifacts/binary/cases.sldd'],
  ])('typed into %s, shows each with its class, and is written and read back so', (file) => {
    const { session, root, save } = openedFixture(file);
    const cell = entriesOf(root).find((e) => e.className === 'cell' && e.valueEditable);
    session.setActive(root, cell);
    expect(session.editProperty(cell.id, 'Value', MEMBERS)).toBe(true);
    expect([cell.displayValue, cell.valueEditable]).toEqual([MEMBERS, true]);
    const reread = entriesOf(opened(save(), file.split('/').pop()!).root).find((e: any) => e.name === cell.name);
    expect(reread.displayValue).toBe(MEMBERS);
    expect(reread.children.map((c: any) => c.className)).toEqual(['double', 'int8', 'uint16', 'single', 'uint64', 'int32', 'single', 'int16']);
  });

  it('converts a number typed into an integer class as MATLAB does', () => {
    const { session, root } = openedFixture(CELLS);
    const cell = root.children.find((e: any) => e.name === 'cInt');
    session.setActive(root, cell);
    expect(session.editProperty(cell.id, 'Value', '{int8(300), uint8(-5), int16(2.5), int16(-2.5)}')).toBe(true);
    expect(cell.displayValue).toBe('{int8(127), uint8(0), int16(3), int16(-3)}');
  });

  it('a member whose class no text spells exactly leaves its cell no editor of its text', () => {
    // A single -0 shows 0, which single(0) is not.
    const { session, root } = openedFixture(CELLS);
    const cell = root.children.find((e: any) => e.name === 'cInt');
    session.setActive(root, cell);
    expect(session.editProperty(cell.id, 'Value', '{single(-0), 1}')).toBe(true);
    expect([cell.displayValue, cell.valueEditable]).toEqual(['{0, 1}', false]);
  });
});

describe('a large cell read from a file', () => {
  // Whether a cell takes an edit of its text was judged with its strings' spelling asked again of each
  // element (MatlabVariableNode._literalRoundTrips): a file's cell of 10,000 numbers took 0.8 s to say
  // it takes no editor, and its row 0.5 s, at every projection of the table. Generous bounds, far
  // above what each takes now.
  it.each([
    ['10,000 numbers', Array.from({ length: 10000 }, (_, i) => i)],
    ['10,000 int8s', Array.from({ length: 10000 }, (_, i) => ({ _type: 'int8', _value: String(i % 100) }))],
    ['2,000 strings', Array.from({ length: 2000 }, (_, i) => ({ _array_type: 'String', _dimensions: [1, 1], _elements: ['s' + i] }))],
  ])('of %s says whether it takes an editor, and shows its row and grid, in reasonable time', (_what, elements) => {
    const source = openedFixture('test/fixtures/string-containers/r2027a/plain.mat');
    const made: any = (source.session as any).pasteEntries(source.root.name, [{ name: 'big', metadata: null, value: { _array_type: 'Cell', _dimensions: [1, elements.length], _elements: elements } }]);
    expect(made.error).toBeUndefined();
    const { root } = opened(source.save(), 'plain.mat');
    const big = root.children.find((c: any) => c.name === 'big');
    const t = performance.now();
    void big.valueEditable;
    big.toRow();
    big.displayElements();
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

// A member's spelling was kept by the text it shows, not by its value: single 0 and -0 both show 0,
// so after {single(0), 1} the member typed -0 still spelled `single(0)`, and the cell, offered as that
// text, made the -0 a 0 when the text was typed back changed (MatlabVariableNode._classSpelled).
describe("a member's spelling, after an edit of the member", () => {
  it('follows the value: a single typed -0 leaves its cell no editor of its text', () => {
    const { root, save, edit } = openedFixture('test/fixtures/string-containers/r2027a/cells.mat');
    const at = (p: string) => root.flatten().find((n: any) => n.matlabPath === p);
    const zero = (v: any) => Object.is(Array.isArray(v) ? v[0] : v, -0);
    expect(edit('cInt', '{single(0), 1}')).toBe(true);
    expect([at('cInt').displayValue, at('cInt').valueEditable]).toEqual(['{single(0), 1}', true]);
    expect(edit('cInt{1}', '-0')).toBe(true);
    expect(zero(at('cInt{1}')._var.value)).toBe(true);
    expect([at('cInt').displayValue, at('cInt').valueEditable]).toEqual(['{0, 1}', false]);
    // The -0 is what a save writes.
    expect(zero(opened(save(), 'cells.mat').root.flatten().find((n: any) => n.matlabPath === 'cInt{1}')._var.value)).toBe(true);
  });
});
