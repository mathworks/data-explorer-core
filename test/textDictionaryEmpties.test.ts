// Copyright 2026 The MathWorks, Inc.
//
// A MATLAB text dictionary holds no numeric, logical or char empty of another size than 0x0: MATLAB
// R2027a's own text format reads a 0x3 double, a 1x0 int8, a 1x0 logical and a 1x0 char back as a
// 0x0 one of its class (E4 of the 2026-10-26 edit bash), and core's save of each, typed into a
// value, a field, a cell's element or a Simulink.Parameter's Value, read back as a 0x0 double. So a
// text dictionary refuses one, whole or in a cell at any depth, in its format's words, and nothing
// changes (the D15 ruling, SectionNode._valueRefusal). A cell and a string array of an empty size
// it holds as they are, in MATLAB's own save and in core's (measured in MATLAB R2027a), and takes
// them; so it does the 0x0 empties. A MAT-file and a binary dictionary take every one, and save it
// as typed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DIR = fileURLToPath(new URL('./fixtures/edit-bash/r2027a/', import.meta.url));

function opened(file: string, bytes: Uint8Array = new Uint8Array(readFileSync(DIR + file))) {
  const session = createSession();
  const root: any = ingest(session, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { filename: file });
  const at = (path: string): any => root.flatten().find((n: any) => n.matlabPath === path && !n.isContainer);
  const edit = (path: string, text: string) => {
    const node = at(path);
    session.setActive(root, node);
    return session.editProperty(node.id, 'Value', text);
  };
  const save = (): Uint8Array => {
    const out: any = session.serializeSource(root.name);
    return out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes;
  };
  return { session, root, at, edit, save };
}

// [typed, its size, its class typed over a double]
const LOST: [string, string, string][] = [
  ['zeros(0,3)', '0x3', 'double'],
  ["zeros(1,0,'int8')", '1x0', 'int8'],
  ['false(1,0)', '1x0', 'logical'],
  ['char(zeros(1,0))', '1x0', 'char'],
];
const HELD: [string, string, string][] = [
  ['cell(1,0)', '1x0', 'cell'],
  ['cell(0,3)', '0x3', 'cell'],
  ['strings(0,3)', '0x3', 'string'],
  ['strings(1,0)', '1x0', 'string'],
];
// A value, a field, a cell's element, one three cells down.
const PLACES = ['dScalar', 'sLeaves.dScalar', 'cLeaves{1}', 'cNest{1}{2}{1}'];

describe('a text dictionary', () => {
  for (const [typed, size, cls] of LOST) {
    it(`refuses ${typed}, whole or in a cell, wherever it is typed, and the file is as it was`, () => {
      const o = opened('values_text.sldd');
      const before = o.save();
      const what = 'a ' + size + ' ' + cls;
      for (const path of PLACES) {
        const entry = path.split(/[.{]/)[0];
        const reason = (verb: string) => `Cannot edit "${entry}": ${path} ${verb} ${what}, which a text dictionary holds only as a 0x0 one.`;
        expect(o.edit(path, typed), path).toMatchObject({ error: true, reason: reason('would be') });
        expect(o.at(path).setProperty('Value', typed), path).toMatchObject({ error: true, reason: reason('would be') });
        expect(o.edit(path, `{1, ${typed}}`), path).toMatchObject({ error: true, reason: reason('would hold') });
        expect(o.edit(path, `{1, {${typed}}}`), path).toMatchObject({ error: true, reason: reason('would hold') });
      }
      expect([o.root.dirty, o.session.canUndo()]).toEqual([false, false]);
      expect(Buffer.from(o.save()).equals(Buffer.from(before))).toBe(true);
    });
  }

  it('names its size with the article said of it: an 8x0 double, an 11x0 int8', () => {
    const o = opened('values_text.sldd');
    expect(o.edit('dScalar', 'zeros(8,0)')).toMatchObject({ error: true, reason: 'Cannot edit "dScalar": dScalar would be an 8x0 double, which a text dictionary holds only as a 0x0 one.' });
    expect(o.edit('dScalar', "zeros(11,0,'int8')")).toMatchObject({ error: true, reason: 'Cannot edit "dScalar": dScalar would be an 11x0 int8, which a text dictionary holds only as a 0x0 one.' });
  });

  it("refuses one as a Simulink.Parameter's Value, typed on its row or on its Value's", () => {
    const o = opened('values_text.sldd');
    expect(o.edit('pComplex', 'zeros(0,3)')).toMatchObject({ error: true, reason: 'Cannot edit "pComplex": pComplex.Value would be a 0x3 double, which a text dictionary holds only as a 0x0 one.' });
    expect(o.edit('pComplex', 'false(1,0)')).toMatchObject({ error: true, reason: 'Cannot edit "pComplex": pComplex.Value would be a 1x0 logical, which a text dictionary holds only as a 0x0 one.' });
    expect(o.edit('pComplex.Value', 'zeros(0,3)')).toMatchObject({ error: true, reason: 'Cannot edit "pComplex": pComplex.Value would be a 0x3 double, which a text dictionary holds only as a 0x0 one.' });
    // A cell, which MATLAB takes as no Parameter's Value, is refused in MATLAB's words.
    expect(o.edit('pComplex', 'cell(1,0)')).toMatchObject({ error: true, reason: expect.stringMatching(/^Cannot edit "pComplex": Invalid value specified for parameter\./) });
    expect([o.root.dirty, o.session.canUndo()]).toEqual([false, false]);
  });

  for (const [typed, size, cls] of HELD) {
    it(`takes ${typed}, whole and in a cell, and reads it back as typed`, () => {
      const o = opened('values_text.sldd');
      for (const path of PLACES) {
        expect(o.edit(path, typed), path).toBe(true);
      }
      expect(o.edit('cEmpty', `{1, ${typed}}`)).toBe(true);
      const back = opened('values_text.sldd', o.save());
      for (const path of [...PLACES, 'cEmpty{2}']) {
        expect([back.at(path).className, back.at(path)._dims.join('x')], path).toEqual([cls, size]);
      }
    });
  }

  it('takes the 0x0 empties it holds as themselves', () => {
    for (const typed of ['[]', '{}', "''", 'zeros(0,0)', 'cell(0,0)', 'strings(0,0)']) {
      const o = opened('values_text.sldd');
      for (const path of PLACES) {
        expect(o.edit(path, typed), path + ' = ' + typed).toBe(true);
      }
    }
  });
});

// MATLAB R2027a's own text dictionary, each value set by MATLAB, as an entry and in a cell, read
// back (parity/matlab/probe_text_dictionary_empties.m).
const TRUTH: { release: string; cases: { text: string; typedClass: string; typedSize: number[]; class: string; size: number[]; inCellClass: string; inCellSize: number[] }[] } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./parity/matlab/text_dictionary_empties.truth.json', import.meta.url)), 'utf8'),
);

describe("what MATLAB's own text dictionary holds of each empty", () => {
  it('is what a text dictionary takes: refused exactly where MATLAB reads it back as another', () => {
    expect(TRUTH.release).toBe('(R2027a)');
    expect(TRUTH.cases.length).toBe(14);
    const asTyped = TRUTH.cases.filter((c) => c.class === c.typedClass && c.size.join('x') === c.typedSize.join('x'));
    // In a cell as well as whole.
    for (const c of TRUTH.cases) {
      expect([c.inCellClass, c.inCellSize], c.text).toEqual([c.class, c.size]);
    }
    for (const c of TRUTH.cases) {
      const o = opened('values_text.sldd');
      // Typed over a cell, so that a numeric empty keeps the class typed.
      const r = o.edit('cEmpty', c.text);
      expect(r === true, c.text + ': MATLAB reads it back as ' + c.class + ' ' + c.size.join('x')).toBe(asTyped.includes(c));
      expect(o.edit('cLeaves{1}', '{1, ' + c.text + '}') === true, c.text + ' in a cell').toBe(asTyped.includes(c));
    }
    // The empties it reads back as others: every numeric, logical and char one but 0x0.
    expect(TRUTH.cases.filter((c) => !asTyped.includes(c)).map((c) => c.text)).toEqual(['zeros(0,3)', 'zeros(1,0)', "zeros(1,0,'int8')", "zeros(0,3,'single')", 'false(1,0)', 'char(zeros(1,0))']);
  });
});

describe('a MAT-file and a binary dictionary take each, and save it as typed', () => {
  for (const file of ['values.mat', 'values_binary.sldd']) {
    for (const [typed, size, cls] of [...LOST, ...HELD]) {
      it(`${file}: ${typed}`, () => {
        const o = opened(file);
        for (const path of PLACES) {
          expect(o.edit(path, typed), path).toBe(true);
        }
        const back = opened(file, o.save());
        for (const path of PLACES) {
          const node = back.at(path);
          expect([node.className, node._dims.join('x')], path).toEqual([cls, size]);
        }
      });
    }
  }
});
