// Copyright 2026 The MathWorks, Inc.
//
// A shaped empty spelled as MATLAB makes it, and taken as typed text (the D12 ruling of the
// 2026-10-26 edit bash): `cell(1,0)`, `zeros(0,3)`, `zeros(1,0,'int8')`, `false(1,0)`,
// `char(zeros(1,0))`, `strings(0,3)`, at any rank. A cell's literal showed such a member as `[ ]`
// (a 0x0 double typed back) or as its summary, `<1x0 cell>`, which locked the cell and every cell
// holding it: deleting the last element of {1, {2, {3}}}'s inner cell left all three locked (F2 of
// the review of struct-parity). A whole value's own row keeps the 2026-10-15 ruling's `[ ]` and `''`
// for a numeric, logical or char empty, which take an edit already, and shows the spelling for a
// cell of an empty shape but 0x0 and an empty string array, which the ruling showed as a summary.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import MatlabValueParser, { emptyConstructor } from '../src/datamodel/parser/MatlabValueParser.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));

function opened(file: string, given?: Uint8Array) {
  const session = createSession();
  const bytes = given ?? new Uint8Array(readFileSync(file.startsWith('/') ? file : join(TEST_ROOT, '..', file)));
  const root: any = ingest(session, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { filename: file.split('/').pop()! });
  const at = (path: string) => root.flatten().find((n: any) => n.matlabPath === path && !n.isContainer);
  const edit = (path: string, text: string) => {
    const node = at(path);
    session.setActive(root, node);
    return session.editProperty(node.id, 'Value', text);
  };
  const save = (): Uint8Array => {
    const out: any = session.serializeSource(root.name);
    return out.bytes ?? new TextEncoder().encode(out.text);
  };
  return { session, root, at, edit, save, reopen: () => opened(file, save()) };
}

const A = 'test/parity/artifacts/';
const FORMATS = [A + 'mat/cases.mat', A + 'text/cases.sldd', A + 'binary/cases.sldd'];
const tag = (file: string) => file.split('/').slice(-2).join('/');

describe('the text of an empty', () => {
  it('is read as the value MATLAB makes of it, at any rank, its class where it says one', () => {
    expect(emptyConstructor('zeros(1,0)')).toEqual({ type: 'double', value: [], dims: [1, 0] });
    expect(emptyConstructor("zeros(0,0,'int8')")).toEqual({ type: 'double', value: [], dims: [0, 0], cls: 'int8' });
    expect(emptyConstructor('zeros(1, 0, 2)')).toEqual({ type: 'double', value: [], dims: [1, 0, 2] });
    expect(emptyConstructor('zeros(0)')).toEqual({ type: 'double', value: [], dims: [0, 0] });
    expect(emptyConstructor('cell(1,0)')).toEqual({ type: 'cell', value: [], dims: [1, 0] });
    expect(emptyConstructor('strings(0,3)')).toEqual({ type: 'string-array', value: [], dims: [0, 3] });
    expect(emptyConstructor('false(1,0)')).toEqual({ type: 'logical', value: [], dims: [1, 0] });
    expect(emptyConstructor('true(0,2)')).toEqual({ type: 'logical', value: [], dims: [0, 2] });
    expect(emptyConstructor('char(zeros(1,0))')).toEqual({ type: 'char', value: '', dims: [1, 0] });
  });

  it('is no other call: one that makes elements, a class zeros() does not take, a size that is no count', () => {
    for (const text of ['zeros(2,2)', 'cell(1)', "zeros(1,0,'logical')", "zeros(1,0,'char')", 'zeros(-1,0)', 'zeros(1.5,0)', 'zeros(n,0)', 'ones(1,0)', "false(1,0,'int8')", 'char(zeros(1,0,2,x))']) {
      expect(emptyConstructor(text), text).toBeNull();
    }
    // Typed into a cell, such a call is a bare word, refused saying which.
    expect(MatlabValueParser.parseTyped('{zeros(2,2)}')).toEqual({ why: expect.stringMatching(/^zeros\(\.\.\.\) is a name or a call/) });
  });
});

describe('an empty in a cell, in a MAT-file and in a text and a binary dictionary', () => {
  for (const file of FORMATS) {
    it(`${tag(file)}: deleting the last element of a cell leaves it cell(1,0), and every cell holding it takes an edit`, () => {
      const o = opened(file);
      expect(o.session.deleteNodeById(o.at('cellNest{2}{2}{1}').id)).toBe(true);
      for (const [path, shown] of [['cellNest', '{1, {2, cell(1,0)}}'], ['cellNest{2}', '{2, cell(1,0)}'], ['cellNest{2}{2}', 'cell(1,0)']]) {
        expect([o.at(path).displayValue, o.at(path).valueEditable], path).toEqual([shown, true]);
      }
      const back = o.reopen();
      expect([back.at('cellNest').displayValue, back.at('cellNest').valueEditable]).toEqual(['{1, {2, cell(1,0)}}', true]);
      // Its text typed back is no edit; changed, it is the value typed.
      expect(o.edit('cellNest', '{1, {2, cell(1,0)}}')).toBe(true);
      expect(o.edit('cellNest', '{1, {5, cell(1,0)}}')).toBe(true);
      expect(o.reopen().at('cellNest{2}{2}')._dims).toEqual([1, 0]);
      expect(o.reopen().at('cellNest').displayValue).toBe('{1, {5, cell(1,0)}}');
    });
  }

  for (const file of [A + 'mat/cases.mat', A + 'binary/cases.sldd']) {
    it(`${tag(file)}: typed as members, each is the empty MATLAB makes, of its class and size, read back so`, () => {
      const text = "{1, zeros(1,0), zeros(0,0,'int8'), zeros(0,3,'single'), false(1,0), char(zeros(1,0)), cell(1,0), strings(1,0), strings(0,0)}";
      const o = opened(file);
      expect(o.edit('cellFlat', text)).toBe(true);
      expect(o.at('cellFlat').displayValue).toBe(text);
      const back = o.reopen();
      expect(back.at('cellFlat').displayValue).toBe(text);
      expect(back.at('cellFlat').valueEditable).toBe(true);
      const members = [2, 3, 4, 5, 6, 7, 8, 9].map((k) => back.at('cellFlat{' + k + '}'));
      expect(members.map((m: any) => [m.className, m._dims])).toEqual([
        ['double', [1, 0]], ['int8', [0, 0]], ['single', [0, 3]], ['logical', [1, 0]], ['char', [1, 0]], ['cell', [1, 0]], ['string', [1, 0]], ['string', [0, 0]],
      ]);
    });
  }
});

describe('an empty typed as a whole value', () => {
  for (const file of [A + 'mat/cases.mat', A + 'binary/cases.sldd']) {
    it(`${tag(file)}: is the empty MATLAB makes, of its class and size; a cell and a string array shown so, the others as the browser shows them`, () => {
      const CASES: [string, string, number[], string][] = [
        ['zeros(1,0)', 'double', [1, 0], '[ ]'],
        ["zeros(0,3,'int8')", 'int8', [0, 3], '[ ]'],
        ['false(1,0)', 'logical', [1, 0], '<1x0 logical>'],
        ['char(zeros(1,0))', 'char', [1, 0], "''"],
        ['cell(0,2)', 'cell', [0, 2], 'cell(0,2)'],
        ['strings(0,3)', 'string', [0, 3], 'strings(0,3)'],
      ];
      for (const [typed, cls, dims, shown] of CASES) {
        const o = opened(file);
        expect(o.edit('scalarD', typed), typed).toBe(true);
        const back = o.reopen().at('scalarD');
        expect([back.className, back._dims, back.displayValue], typed).toEqual([cls, dims, shown]);
      }
    });
  }
});

describe('every cell of every fixture holding an empty', () => {
  it('spells it as MATLAB makes it, so that a cell holding no other value no text spells takes an edit', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(mat|sldd)$/.test(e.name)) files.push(p);
      }
    };
    walk(join(TEST_ROOT, 'fixtures'));
    walk(join(TEST_ROOT, 'parity'));
    let spelled = 0;
    const wrong: string[] = [];
    for (const file of files.sort()) {
      let root: any;
      try {
        root = opened(file).root;
      } catch {
        continue;
      }
      for (const cell of root.flatten().filter((n: any) => n._kind === 'cell' && !n.isContainer && n.children.length > 0)) {
        for (const member of cell.children) {
          const empty = member._emptySpelled?.();
          if (!empty) continue;
          spelled++;
          const token = cell._cellLiteralElement(member);
          if (token !== empty && !(token.startsWith('<') && member._isDecodedString?.())) wrong.push(file.slice(TEST_ROOT.length) + ' ' + member.matlabPath + ': ' + token + ', not ' + empty);
          const parsed = MatlabValueParser.parseTyped(empty);
          if (!parsed || 'why' in parsed) wrong.push(file.slice(TEST_ROOT.length) + ' ' + member.matlabPath + ': ' + empty + ' is not read');
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(spelled).toBeGreaterThanOrEqual(38);
  }, 120_000);
});
