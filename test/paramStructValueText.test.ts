// Copyright 2026 The MathWorks, Inc.
//
// Text in a field of a Simulink.Parameter's struct Value, in a MAT-file and in both dictionary
// formats alike. MATLAB keeps `p.Value.a = 'abc'` a char there, of any shape, and a string a
// string, and refuses an empty value, a cell or a string array, "A valid structure must be
// numeric" (measured, R2027a and R2023b, at a field and a field of a nested struct). A MAT-file's
// save writes a char into the Parameter's Value; a string there is an object of the file, which
// it writes into no object's Value, so a MAT-file refuses it, saying so, where a dictionary,
// which holds it as text, takes it. P3 of the 2026-10-26 edit bash: a MAT-file refused a char
// too.
//
// Every edit taken here was made by MATLAB too, on the original, and the file core saved loaded
// equal (MAT-files in R2027a and R2023b, dictionaries in R2027a and the R2023b binary one), with a
// control caught.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { bufferOf, sameBytes } from './tools/matPaste.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (path: string) => new Uint8Array(readFileSync(new URL('./fixtures/' + path, import.meta.url)));
const FORMATS = ['r2027a/values.mat', 'r2023b/values.mat', 'r2027a/values_text.sldd', 'r2027a/values_binary.sldd', 'r2023b/values_binary.sldd'].map((f) => 'edit-bash/' + f);
const FIELDS = ['pStruct.Value.a', 'pStruct.Value.b', 'pStruct.Value.inner.x', 'pStruct.Value.inner.y'];
const STRUCT_RULE = 'A valid structure must be numeric';

/** A file opened through a session, as a host opens one, and what a host does to it. */
function opened(path: string, bytes: Uint8Array = fixture(path)) {
  const session = createSession();
  const filename = path.split('/').pop()!;
  const root: any = path.endsWith('.mat')
    ? session.addMatSource(filename, bufferOf(bytes))
    : ingest(session, filename.endsWith('_text.sldd') ? new TextDecoder().decode(bytes) : bytes, { filename });
  const at = (p: string): any => root.flatten().find((n: any) => n.matlabPath === p && !n.isContainer);
  const edit = (p: string, value: string) => {
    const node = at(p);
    session.setActive(root, node);
    return session.editProperty(node.id, 'Value', value, node.toRow().Value);
  };
  const save = (): Uint8Array => {
    const out: any = session.serializeSource(filename);
    return out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes;
  };
  const undo = () => {
    session.setActive(root, null);
    session.undo();
  };
  return { root, at, edit, save, undo, bytes };
}

/** The rows of the entry `name`: each one's path, class and text. */
const rowsOf = (root: any, name: string): string[] =>
  root.flatten().filter((n: any) => n.matlabPath === name || /^[.({]/.test(n.matlabPath.slice(name.length)) && n.matlabPath.startsWith(name))
    .map((n: any) => [n.matlabPath, n.className, JSON.stringify(n.toRow().Value)].join(' '));

describe("a char typed into a field of a Simulink.Parameter's struct Value", () => {
  for (const file of FORMATS) {
    it(`${file}: taken at every field, saved, reopened as shown; undone, the value as read`, () => {
      for (const path of FIELDS) {
        for (const text of ["'abc'", "'a'", "['ab';'cd']", "'日本'"]) {
          const label = file + ' ' + path + ' = ' + text;
          const o = opened(file);
          const before = rowsOf(o.root, 'pStruct');
          expect(o.edit(path, text), label).toBe(true);
          expect(o.at(path).className, path).toBe('char');
          const shown = rowsOf(o.root, 'pStruct');
          expect(rowsOf(opened(file, o.save()).root, 'pStruct'), label).toEqual(shown);
          o.undo();
          expect(rowsOf(o.root, 'pStruct'), label + ', undone').toEqual(before);
          if (file.endsWith('.mat')) {
            expect(sameBytes(o.save(), o.bytes), label + ', undone').toBe(true);
          }
        }
      }
    });
  }

  it('is refused where MATLAB refuses it, in its words, in every format, and nothing changes', () => {
    for (const file of FORMATS) {
      for (const text of ["''", '[]', '{1}', '{}', '["a" "b"]']) {
        const o = opened(file);
        const before = rowsOf(o.root, 'pStruct');
        const r: any = o.edit('pStruct.Value.a', text);
        expect(r?.reason, file + ' ' + text).toBe('Cannot edit "pStruct.Value.a": ' + STRUCT_RULE + '.');
        expect(rowsOf(o.root, 'pStruct'), file + ' ' + text).toEqual(before);
      }
    }
  });

  it("is refused in a struct array's element of another class, as MATLAB refuses it, in every format", () => {
    for (const file of FORMATS) {
      const r: any = opened(file).edit('pStructArr.Value(1).a', "'abc'");
      expect(r?.reason, file).toBe('Cannot edit "pStructArr.Value(1).a": A valid array of structures must be numeric and homogeneous in terms of data type and dimensions.');
    }
  });
});

describe("a string typed into a field of a Simulink.Parameter's struct Value", () => {
  it('is taken by a dictionary, which holds it as text', () => {
    for (const file of FORMATS.filter((f) => f.endsWith('.sldd'))) {
      const o = opened(file);
      expect(o.edit('pStruct.Value.a', '"abc"'), file).toBe(true);
      expect(rowsOf(opened(file, o.save()).root, 'pStruct'), file).toEqual(rowsOf(o.root, 'pStruct'));
    }
  });

  it('is refused by a MAT-file, which would hold it as an object of the file, saying what to type instead', () => {
    for (const file of FORMATS.filter((f) => f.endsWith('.mat'))) {
      for (const path of FIELDS) {
        const o = opened(file);
        const r: any = o.edit(path, '"abc"');
        expect(r?.reason, file + ' ' + path).toBe(
          'Cannot edit "pStruct": ' + path + " would be a string, which a MAT-file holds as an object of the file, and this package writes no object into a Simulink.Parameter's Value: type the text in single quotes to make it a char.",
        );
        expect(sameBytes(o.save(), o.bytes), file + ' ' + path).toBe(true);
      }
    }
  });
});

describe("a MAT-file Simulink.Parameter whose struct Value MATLAB wrote holding text", () => {
  for (const release of ['r2027a', 'r2023b']) {
    const file = `mat-param-struct-text/${release}/param_text.mat`;
    it(`${release}: a char among its fields, at any depth and of two rows, takes the edits of every field`, () => {
      const edits: [string, string][] = [
        ['pChar.Value.b', '[3 4]'], ['pChar.Value.a', "'xyz'"], ['pChar.Value.a', '7'],
        ['pNested.Value.inner.y', '9'], ['pNested.Value.inner.x', "'r'"], ['pNested.Value.k', "'k'"],
        ['pTwoRow.Value.m', '6'], ['pTwoRow.Value.t', "'one'"],
      ];
      for (const [path, text] of edits) {
        const o = opened(file);
        const entry = path.split('.')[0];
        expect(o.at(path).toRow()._valueEditable, path).toBe(true);
        expect(o.edit(path, text), path + ' = ' + text).toBe(true);
        expect(rowsOf(opened(file, o.save()).root, entry), path + ' = ' + text).toEqual(rowsOf(o.root, entry));
        o.undo();
        expect(sameBytes(o.save(), o.bytes), path + ' = ' + text + ', undone').toBe(true);
      }
    });

    it(`${release}: a two-row char shows as itself`, () => {
      expect(rowsOf(opened(file).root, 'pTwoRow')).toContain("pTwoRow.Value.t char \"['ab'; 'cd']\"");
    });

    it(`${release}: a string among its fields, an object of the file, refuses an edit of every field, saying so`, () => {
      const o = opened(file);
      expect(o.at('pString.Value.a').className).toBe('string');
      const r: any = o.edit('pString.Value.b', '[3 4]');
      expect(r?.reason).toBe('Cannot edit "pString": pString.Value holds an object of the file (pString.Value.a), which a save does not write anew there, so it takes no edit.');
      expect(sameBytes(o.save(), o.bytes)).toBe(true);
    });
  }
});

describe("a char typed into a field of a Simulink.Parameter's struct Value inside a binary dictionary's MAT stream", () => {
  it('is taken, saved and reopened as shown', () => {
    const file = 'sldd-stream-objects/stream_objects_binary.sldd';
    for (const text of ["'x'", "'日本'"]) {
      const o = opened(file);
      expect(o.edit('pStruct.p.Value.a', text), text).toBe(true);
      expect(rowsOf(opened(file, o.save()).root, 'pStruct'), text).toEqual(rowsOf(o.root, 'pStruct'));
    }
  });
});
