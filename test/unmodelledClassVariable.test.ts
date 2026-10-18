// Copyright 2026 The MathWorks, Inc.
//
// A MAT variable whose array-flags word is overwritten: its class byte names no class the
// reader models (255, 18), so MatParser reads it as class 'unknown' with no value, and its
// flags byte can still say complex. The node builders took that complex variable for a list of
// {re, im} pairs and read `.re` of null, and the throw refused the whole file: a model whose
// workspace part held one, and a .mat holding one, at any depth. #116 left the case open, since
// it is damage and not a cut.
//
// The maintainer's ruling of 2026-10-16 (group E, theme 1: warn and show what was read, never
// refuse the file and never crash) takes the item's recommendation: catch it per variable, so
// the rest of the file opens. The variable is shown as what was read of it, its name, class and
// size, not decoded: one row with no editor and no rows, as a binary dictionary already shows
// the same bytes (test/encodedValueDecode.test.ts). A model workspace does not warn (the C-232
// ruling); a .mat does, once.
//
// Each case damages MATLAB's own bytes or a synthesized variable's, in the test, so the
// damage is visible where it is used and the fixtures stay real files.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { parseMxArray } from '../src/datamodel/parser/MxArrayParser.js';
import type { ParseWarning } from '../src/datamodel/parser/ParseWarning.js';
import { createSession } from '../src/index.js';
import { CLASS, cellVar, matFile, mxArrayFile, numericVar, structVar } from './tools/matBytes.js';

const PART = 'simulink/modelWorkspace.mxarray';

/** A file under test/, as bytes. */
const testFile = (path: string): Uint8Array => new Uint8Array(readFileSync(fileURLToPath(new URL(`./${path}`, import.meta.url))));
const arrayBufferOf = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/**
 * The flags words written over a complex double's: class 255 with every flag set (the
 * scope's 0xFFFFFFFF), class 255 with only the complex flag, and class 18, one past the last
 * class MATLAB writes, complex. Each refused the file it was in.
 */
const WORDS: [number, string][] = [
  [0xffffffff, '0xFFFFFFFF'],
  [0x000008ff, '0x000008FF'],
  [0x00000812, '0x00000812'],
];

const withWord = (bytes: Uint8Array, at: number, word: number): Uint8Array => {
  const out = bytes.slice();
  new DataView(out.buffer).setUint32(at, word >>> 0, true);
  return out;
};

/** A row as a host is shown it: its name, value, class, whether it offers an editor, and its rows. */
const row = (n: any): unknown => [n.name, n.displayValue, n.className, n.valueEditable, n.children.map(row)];
const notDecoded = (name: string, shape: string, cls: string) => [name, `<${shape} ${cls}, not decoded>`, cls, false, []];

/**
 * The refusal a copy of such a variable meets: nothing holds its value, and the text of its
 * placeholder is another value (the maintainer's group F ruling of 2026-10-18, F1-10).
 */
const refusedCopy = (name: string, shape: string) =>
  `Cannot write "${name}": ${name} is a ${shape} unknown that was not decoded (its MAT array class is not one this reader models), `
  + 'so there is no value of it to write. Nothing was written.';

// ---- A model workspace -------------------------------------------------------------

/**
 * Where `name`'s array-flags word begins in a workspace part, found by parsing, as #116's
 * test finds its window: the first length at which the variable reads as complex is the one
 * that has just taken in the flags byte holding mxCOMPLEX, the word's second byte.
 */
function flagsWordOf(part: Uint8Array, name: string): number {
  for (let length = 0; length <= part.length; length++) {
    const variable = parseMxArray(part.slice(0, length).buffer).find((v) => v.name === name);
    if (variable && variable.isComplex) {
      return length - 2;
    }
  }
  throw new Error(`no complex variable ${name} in the part`);
}

function openedModel(name: string, entries: Record<string, Uint8Array>) {
  const model: any = createSession().addModelSource(name, arrayBufferOf(zipSync(entries)));
  const sections: [string, unknown[]][] = model.children.map((s: any) => [s.name, s.children.map(row)]);
  return { model, sections, warnings: (model.warnings ?? []) as ParseWarning[] };
}

describe('a model workspace variable whose flags word is overwritten is shown as not decoded, and the model opens', () => {
  // [file, variable, its size, what it is]
  const variables: [string, string, string, string][] = [
    ['fixtures/mcos/complex_ws.slx', 'z', '1x1', 'a complex scalar, 3+4i'],
    ['parity/artifacts/slx/cases.slx', 'cplxScalar', '1x1', 'a complex scalar'],
    ['parity/artifacts/slx/cases.slx', 'cplxVec', '1x2', 'a complex 1x2 row'],
    ['fixtures/sparse/sparse_ws.slx', 'dComplex', '3x4', 'a complex 3x4 matrix'],
  ];

  for (const [file, name, shape, what] of variables) {
    for (const [word, spelled] of WORDS) {
      it(`${file.slice(file.lastIndexOf('/') + 1)}: ${what} (${name}), its flags word set to ${spelled}`, () => {
        const entries = unzipSync(testFile(file));
        const part = entries[PART];
        const at = flagsWordOf(part, name);
        // The word is a complex double's, as MATLAB wrote it: class 6, mxCOMPLEX set.
        expect([part[at], part[at + 1] & 0x08]).toEqual([CLASS.DOUBLE, 0x08]);
        if (name === 'z') {
          expect(at).toBe(1144); // where the scope found it, by hand
        }

        const intact = openedModel(name, entries);
        // Before: the open threw "Cannot read properties of null (reading 're')".
        const damaged = openedModel(name, { ...entries, [PART]: withWord(part, at, word) });

        const workspace = (o: typeof intact) => o.sections.find(([s]) => s === 'workspace')![1] as unknown[];
        const index = workspace(intact).findIndex((r: any) => r[0] === name);
        expect(index).toBeGreaterThanOrEqual(0);
        // The variable is what was read of it: its name, the class its word now names (one the
        // reader does not model), and its size; no editor and no rows.
        expect(workspace(damaged)[index]).toEqual(notDecoded(name, shape, 'unknown'));
        // Every other workspace row, and every other section, is the intact file's.
        const without = (rows: unknown[]) => rows.filter((_, i) => i !== index);
        expect(without(workspace(damaged))).toEqual(without(workspace(intact)));
        expect(damaged.sections.filter(([s]) => s !== 'workspace')).toEqual(intact.sections.filter(([s]) => s !== 'workspace'));
        // A model workspace does not report a value it did not decode (the C-232 ruling).
        expect(damaged.warnings).toEqual(intact.warnings);
        expect(damaged.warnings).toEqual([]);

        const node = damaged.model.children.find((s: any) => s.name === 'workspace').children[index];
        expect(() => node.toRow()).not.toThrow();
        // Its copy is refused, naming it. It was the text of its placeholder.
        expect(() => node.serializeValue()).toThrow(refusedCopy(name, shape));
      });
    }
  }

  it('one inside a cell or a struct variable: that variable is not decoded, the ones beside it are as read, and nothing warns', () => {
    // A workspace is a struct whose fields are its variables.
    const one = (n: number) => numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [n] });
    const damagedZ = () => withWord(numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [3], imag: [4] }), 16, 0xffffffff);
    const ws = structVar('', ['ok', 'c', 's', 'tail'], [{
      ok: one(7),
      c: cellVar('', [damagedZ(), one(5)]),
      s: structVar('', ['a', 'b'], [{ a: damagedZ(), b: one(2) }]),
      tail: one(9),
    }]);
    const entries = unzipSync(testFile('parity/artifacts/slx/cases.slx'));
    expect(Object.keys(entries)).toContain(PART);
    // Before: the open threw "Cannot read properties of null (reading 're')".
    const { sections, warnings } = openedModel('cases.slx', { ...entries, [PART]: new Uint8Array(mxArrayFile(ws.subarray(8))) });
    expect(sections.find(([s]) => s === 'workspace')![1]).toEqual([
      ['ok', '7', 'double', true, []],
      notDecoded('c', '1x2', 'cell'),
      notDecoded('s', '1x1', 'struct'),
      ['tail', '9', 'double', true, []],
    ]);
    expect(warnings).toEqual([]);
  });
});

// ---- A .mat file ---------------------------------------------------------------------

/** A complex double, 3+4i, with its flags word (the 4 bytes after the matrix and flags tags) overwritten. */
function damagedComplex(name: string, word: number): Uint8Array {
  const z = numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, 1], real: [3], imag: [4] });
  expect([z[16], z[17]]).toEqual([CLASS.DOUBLE, 0x08]);
  return withWord(z, 16, word);
}

const ok = () => numericVar({ name: 'ok', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [7] });
const tail = () => numericVar({ name: 'tail', cls: CLASS.DOUBLE, dimensions: [1, 2], real: [1, 2] });

/** The warning MatParser already gives for a value of a class it does not model. */
const notModelled = (part: string) => ({
  code: 'part-unreadable',
  message: `"${part}" is of a MAT array class this reader does not model, so its value was not read.`,
  part,
});

const openedMat = (name: string, variables: Uint8Array[]): any => createSession().addMatSource(name, matFile(variables));

describe('a .mat variable whose flags word is overwritten is shown as not decoded, and the file opens and says why once', () => {
  for (const [word, spelled] of WORDS) {
    it(`a complex scalar's flags word set to ${spelled}`, () => {
      // Before: addMatSource threw "Cannot read properties of null (reading 're')".
      const mat = openedMat('t.mat', [ok(), damagedComplex('z', word), tail()]);
      const control = openedMat('control.mat', [ok(), tail()]);
      const rows = mat.children.map(row);
      expect(rows[1]).toEqual(notDecoded('z', '1x1', 'unknown'));
      expect([rows[0], rows[2]]).toEqual(control.children.map(row));
      // The reader's own warning names it, and the one it gives is the only one.
      expect(mat.warnings).toEqual([notModelled('z')]);
      for (const n of mat.children) {
        expect(() => n.toRow()).not.toThrow();
      }
      // The copy of each variable beside it is as it was; its own is refused, naming it. It was
      // the text of its placeholder.
      for (const n of [mat.children[0], mat.children[2]]) {
        expect(() => JSON.stringify(n.serializeValue())).not.toThrow();
      }
      expect(() => mat.children[1].serializeValue()).toThrow(refusedCopy('z', '1x1'));
    });
  }

  it('one inside a 1x2 cell or a struct field: that variable is not decoded, and the warning that names the element is the only one', () => {
    const five = numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [5] });
    const c = cellVar('c', [damagedComplex('', 0xffffffff), five]);
    const s = structVar('s', ['a', 'b'], [{ a: damagedComplex('', 0xffffffff), b: five }]);
    // Before: addMatSource threw "Cannot read properties of null (reading 're')".
    const mat = openedMat('nested.mat', [ok(), c, s, tail()]);
    expect(mat.children.map(row)).toEqual([
      ['ok', '7', 'double', true, []],
      notDecoded('c', '1x2', 'cell'),
      notDecoded('s', '1x1', 'struct'),
      ['tail', '[1 2]', 'double', true, [['1', '1', 'double', true, []], ['2', '2', 'double', true, []]]],
    ]);
    expect(mat.warnings).toEqual([notModelled('c{1}'), notModelled('s.a')]);
  });

  it('a host\'s parse that names no loss for it: the variable is not decoded, and the file says why', () => {
    // A host may parse the file itself and hand the result over (addMatSourceParsed); one from
    // a reader that did not report the class has no warning for this variable, so the node
    // layer gives the one that says what happened to it. The warning it does have, for `zz`
    // (a double that holds no data), names another variable, whose name only begins with z.
    const zz = numericVar({ name: 'zz', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [], omitData: true });
    const parsed = parseMat(matFile([ok(), damagedComplex('z', 0xffffffff), zz, tail()]));
    const zzHoldsNoData = {
      code: 'part-unreadable',
      message: '"zz" declares 1 element(s) and holds no data, so its value was not read.',
      part: 'zz',
    };
    expect(parsed.warnings).toEqual([notModelled('z'), zzHoldsNoData]);
    // Before: addMatSourceParsed threw "Cannot read properties of null (reading 're')".
    const mat: any = createSession().addMatSourceParsed('host.mat', { ...parsed, warnings: [zzHoldsNoData] });
    expect(mat.children.map(row).slice(1, 3)).toEqual([notDecoded('z', '1x1', 'unknown'), notDecoded('zz', '1x1', 'double')]);
    expect(mat.warnings).toEqual([
      zzHoldsNoData,
      {
        code: 'part-unreadable',
        message: '"z" could not be read (Cannot read properties of null (reading \'re\')), so it is shown as not decoded.',
        part: 'z',
      },
    ]);
  });
});
