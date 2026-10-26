// Copyright 2026 The MathWorks, Inc.
//
// A cell a file holds with a complex member whose imaginary part is 0, such as
// {complex(1,0), 5}. Its literal shows the member as `1+0i`, and a cell literal reads `1+0i`
// as the real double MATLAB makes of it (cellSignMember.test.ts): `{1+0i, 5}` is {1, 5} in
// MATLAB. So the literal is not the cell's value, and setting it back wrote the member as a
// real 1. Retyping only the 5, `{1+0i, 6}`, saved the member nobody changed as a double, in
// both formats. Before cell members followed MATLAB the member stayed complex.
//
// Under "do not rewrite data nobody changed" (D3) and theme 1, such a cell offers no editor
// for its literal, as one that shows an element as a summary offers none
// (MatlabVariableNode._literalRoundTrips), and refuses the literal set on it. Its elements are
// edited one at a time: the 5 set to 6 alone, and the member kept as read.
//
// test/fixtures/cell_zero_imaginary_binary.sldd and cell_zero_imaginary_text.sldd are
// MATLAB's (R2027a, make_cell_zero_imaginary.m). cell_zero_imaginary.truth.json is MATLAB's
// reading of them and of core's saves after the element edits below. To ask MATLAB again:
//
//   npm run build && node test/fixtures/make_cell_zero_imaginary_core.mjs /tmp/cell_zero_imaginary
//   mw -using Bmain matlab -nodesktop -batch "cd('<repo>/test/fixtures'); make_cell_zero_imaginary('/tmp/cell_zero_imaginary', 'read', '/tmp/cell_zero_imaginary')"
//
// (after copying the two fixtures into /tmp/cell_zero_imaginary).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import MatNode from '../src/datamodel/node/container/MatNode.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import '../src/datamodel/node/data/NodeClassMap.js';
import { CLASS, MI, cellVar, charVar, matFile, numericVar } from './tools/matBytes.js';
import { BINARY, TEXT, copyOf, pasteSaveReopen } from './tools/pasteVenues.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const entryOf = (root: any, name: string): any => root.getSection('design').children.find((e: any) => e.name === name);

const FORMATS = [
  { format: 'text', file: 'cell_zero_imaginary_text.sldd' },
  { format: 'binary', file: 'cell_zero_imaginary_binary.sldd' },
] as const;

const REASON = 'This cell holds a complex element whose imaginary part is 0, which its text sets as a real number. Edit the element instead.';
// As the session says it, of the row at `path` (editRefusalText).
const named = (path: string) => 'Cannot edit "' + path + '": ' + REASON;

/** Each cell MATLAB wrote with a zero imaginary part in it, as it shows, and the 5 retyped in its literal. */
const ZERO_CELLS = [
  { name: 'cZero', shown: '{1+0i, 5}', retyped: '{1+0i, 6}', member: ['double (complex)', '1+0i'] },
  // complex(2,-0): the imaginary part's -0 shows with a `+` (shownComplexText).
  { name: 'cZeroNeg', shown: '{2+0i, 5}', retyped: '{2+0i, 6}', member: ['double (complex)', '2+0i'] },
  // The complex member is in the nested cell.
  { name: 'cZeroNest', shown: '{{1+0i}, 5}', retyped: '{{1+0i}, 6}', member: ['cell', '{1+0i}'] },
] as const;

function open(file: string, name: string): { session: any; root: any; entry: any } {
  const session = createSession();
  const root = ingest(session, buffer(fixture(file)), { filename: file }) as any;
  const entry = entryOf(root, name);
  session.setActive(root, entry);
  return { session, root, entry };
}

function saveAndReopen(session: any, root: any, file: string): { saved: any; reopened: any } {
  const saved = session.serializeSource(root.name);
  const bytes = saved.kind === 'text' ? strToU8(saved.text) : saved.bytes;
  const reopened = ingest(createSession(), buffer(bytes), { filename: file }) as any;
  return { saved, reopened };
}

/** Each member's row as the table shows it. */
const rows = (entry: any): [string, string][] => entry.children.map((c: any) => [c.toRow().Class, String(c.displayValue)]);

/** The text dictionary's JSON value for an entry, from its text. */
const textValue = (text: string, name: string): any =>
  JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === name).value;

/** The binary dictionary's `<P Name="Value">` for an entry. */
function binaryValue(bytes: Uint8Array, name: string): string {
  const xml = strFromU8(unzipSync(bytes)['data/chunk0.xml']);
  const object = xml.split('<Object Class="DD.ENTRY">').find((o) => o.includes(`<P Name="Name" Class="char">${name}</P>`))!;
  return object.match(/<P Name="Value"[\s\S]*?<\/P>/)![0];
}

/** The first member as the file holds it: a text dictionary's JSON, or a binary one's first `<Element>` and what it holds. */
function firstMemberAsWritten(format: string, saved: { text?: string; bytes?: Uint8Array }, name: string): unknown {
  if (format === 'text') {
    return textValue(saved.text!, name)._elements[0];
  }
  const value = binaryValue(saved.bytes!, name);
  const lines = value.split('\n').slice(1, -1);
  // An element is one line, or a nested cell's lines up to its closing tag.
  const end = lines[0].includes('Class="cell"') ? lines.findIndex((l) => l.trim() === '</Element>') + 1 : 1;
  return lines.slice(0, end).join('\n');
}

const asMatlabWrote = (format: string, file: string, name: string): unknown =>
  firstMemberAsWritten(format, format === 'text' ? { text: strFromU8(fixture(file)) } : { bytes: fixture(file) }, name);

for (const { format, file } of FORMATS) {
  describe(`a cell holding a complex member whose imaginary part is 0, ${format} dictionary`, () => {
    it.each(ZERO_CELLS)('$name opens as MATLAB wrote it, the member complex', ({ name, shown, member }) => {
      const { entry } = open(file, name);
      expect(entry.displayValue).toBe(shown);
      expect(rows(entry)).toEqual([member, ['double', '5']]);
    });

    it.each(ZERO_CELLS)('$name offers no editor for its literal, which is not its value', ({ name }) => {
      const { entry } = open(file, name);
      expect(entry.valueEditable).toBe(false);
    });

    it.each(ZERO_CELLS)('$name with only the 5 retyped in its literal is refused, and the save keeps the member complex', ({ name, shown, retyped, member }) => {
      const { session, root, entry } = open(file, name);
      const result = session.editProperty(entry.id, 'Value', retyped);
      // What the save writes first: taken, the literal wrote the member as a real double.
      const { saved, reopened } = saveAndReopen(session, root, file);
      expect(rows(entryOf(reopened, name))).toEqual([member, ['double', '5']]);
      expect(firstMemberAsWritten(format, saved, name)).toEqual(asMatlabWrote(format, file, name));
      expect(result).toEqual({ error: true, reason: named(name), invalidValue: retyped, validValue: shown });
      expect(rows(entry)).toEqual([member, ['double', '5']]);
    });

    // Its own shown text too: the row offers no editor of it (DataNode._offerRefusal), and an edit
    // of a row that offers none is refused whatever its text, before anything changes.
    it.each(ZERO_CELLS)('$name with its committed literal unchanged is refused as any other text, and nothing changes', ({ name, shown, member }) => {
      const { session, entry } = open(file, name);
      expect(session.editProperty(entry.id, 'Value', shown)).toEqual({ error: true, reason: named(name), invalidValue: shown, validValue: shown });
      expect(rows(entry)).toEqual([member, ['double', '5']]);
      expect(session.canUndo()).toBe(false);
    });

    it.each(ZERO_CELLS)('$name takes the 5 set to 6 as an element, and the save keeps the member as MATLAB wrote it', ({ name, member }) => {
      const { session, root, entry } = open(file, name);
      const five = entry.children[1];
      session.setActive(root, five);
      expect(session.editProperty(five.id, 'Value', '6')).toBe(true);
      expect(rows(entry)).toEqual([member, ['double', '6']]);

      const { saved, reopened } = saveAndReopen(session, root, file);
      expect(rows(entryOf(reopened, name))).toEqual([member, ['double', '6']]);
      expect(firstMemberAsWritten(format, saved, name)).toEqual(asMatlabWrote(format, file, name));
    });

    it('the nested cell holding the member offers no editor for its literal either', () => {
      const { session, root, entry } = open(file, 'cZeroNest');
      const inner = entry.children[0];
      expect(inner.valueEditable).toBe(false);
      session.setActive(root, inner);
      expect(session.editProperty(inner.id, 'Value', '{1+0i, 7}')).toMatchObject({ error: true, reason: named('cZeroNest{1}') });
      expect(rows(inner)).toEqual([['double (complex)', '1+0i']]);
    });

    // The control: a member whose imaginary part is not 0 reads back from the literal as itself.
    it('a cell whose complex member has a non-zero imaginary part still takes its literal, and keeps the member complex', () => {
      const { session, root, entry } = open(file, 'cTwoI');
      expect(entry.displayValue).toBe('{1+2i, 5}');
      expect(entry.valueEditable).toBe(true);
      expect(session.editProperty(entry.id, 'Value', '{1+2i, 6}')).toBe(true);
      const { reopened } = saveAndReopen(session, root, file);
      expect(rows(entryOf(reopened, 'cTwoI'))).toEqual([['double (complex)', '1+2i'], ['double', '6']]);
    });
  });
}

// A .mat file's cell is the same node, and is built without its rows past the file's node
// ceiling (matNodeCeiling): asked then of its elements rebuilt alone (_withCeilingTwin).
describe('a .mat file cell holding a complex member whose imaginary part is 0, with and without the node ceiling', () => {
  const dbl = (real: number[], imag?: number[]): Uint8Array => numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, real.length], real, imag });
  const file = (): ArrayBuffer =>
    matFile([cellVar('c', [dbl([1], [0]), dbl([5])]), cellVar('cn', [cellVar('', [dbl([1], [0])]), dbl([5])]), cellVar('ci', [dbl([1], [2]), dbl([5])])]);

  for (const nodeCeiling of [0, Number.MAX_SAFE_INTEGER]) {
    it(`node ceiling ${nodeCeiling}`, () => {
      const root = (MatNode.fromParsed as any)(parseMat(file()), 'f.mat', { nodeCeiling });
      const variable = (name: string): any => root.children.find((v: any) => v.name === name);
      for (const [name, shown] of [['c', '{1+0i, 5}'], ['cn', '{{1+0i}, 5}']]) {
        const cell = variable(name);
        expect(cell.displayValue, name).toBe(shown);
        expect(cell.valueEditable, name).toBe(false);
        expect(cell.setProperty('Value', shown.replace('5', '6')), name).toMatchObject({ error: true, reason: REASON });
        expect(cell.displayValue, name).toBe(shown);
      }
      expect(variable('ci').displayValue).toBe('{1+2i, 5}');
      expect(variable('ci').valueEditable).toBe(true);
    });
  }

  // The imaginary part 0 whatever the real part and the class: complex(0, 0), with a -0 in
  // either part or both, complex(-1, 0), complex(Inf, 0), and single and int16 complex(1, 0). A
  // literal reads each such member as real, so the cell offers no editor and refuses its literal,
  // as it does for complex(1, 0). With its 5 set to 6 as an element, the cell copied into either
  // kind of dictionary and saved keeps the member as read, of its class and complex. A cell the
  // node ceiling built without its rows has no element to edit, so its copy is saved as read.
  const scalar = (cls: number, re: number, im: number): Uint8Array => numericVar({ name: '', cls, dimensions: [1, 1], real: [re], imag: [im] });
  const zero: [string, Uint8Array, string][] = [
    ['complex(0, 0)', scalar(CLASS.DOUBLE, 0, 0), 'double'],
    ['complex(-0, 0)', scalar(CLASS.DOUBLE, -0, 0), 'double'],
    ['complex(0, -0)', scalar(CLASS.DOUBLE, 0, -0), 'double'],
    ['complex(-0, -0)', scalar(CLASS.DOUBLE, -0, -0), 'double'],
    ['complex(-1, 0)', scalar(CLASS.DOUBLE, -1, 0), 'double'],
    ['complex(Inf, 0)', scalar(CLASS.DOUBLE, Infinity, 0), 'double'],
    ['single(complex(1, 0))', scalar(CLASS.SINGLE, 1, 0), 'single'],
    ['int16(complex(1, 0))', scalar(CLASS.INT16, 1, 0), 'int16'],
  ];
  const zeroFile = (): ArrayBuffer => matFile(zero.map(([, member], k) => cellVar(`z${k}`, [member, dbl([5])])));

  for (const nodeCeiling of [0, Number.MAX_SAFE_INTEGER]) {
    it(`node ceiling ${nodeCeiling}: a member whose imaginary part is 0, at any real part and of any class, offers no editor, and the save keeps it as read`, () => {
      const cut = nodeCeiling === 0;
      const root = (MatNode.fromParsed as any)(parseMat(zeroFile()), 'f.mat', { nodeCeiling });
      zero.forEach(([label, , cls], k) => {
        const cell = root.children.find((v: any) => v.name === `z${k}`);
        const shown = String(cell.displayValue);
        const member = /^\{(.+), 5\}$/.exec(shown)?.[1];
        // A member of a class other than double is spelled with it, `single(1+0i)` (MatlabVariableNode._classSpelled).
        expect(member, label).toMatch(cls === 'double' ? /\+0i$/ : /^\w+\(.*\+0i\)$/);
        // The member's own row shows its value alone.
        const own = cls === 'double' ? member : member!.replace(/^\w+\((.*)\)$/, '$1');
        expect(cell.valueEditable, label).toBe(false);
        expect(cell.setProperty('Value', `{${member}, 6}`), label).toMatchObject({ error: true, reason: REASON });
        expect(cell.displayValue, label).toBe(shown);
        const asRead = copyOf(cell) as any;

        expect(cell.children.length, label).toBe(cut ? 0 : 2);
        if (!cut) {
          expect(rows(cell), label).toEqual([[`${cls} (complex)`, own], ['double', '5']]);
          expect(cell.children[1].setProperty('Value', '6'), label).toBe(true);
          expect(rows(cell), label).toEqual([[`${cls} (complex)`, own], ['double', '6']]);
        }
        const copy = copyOf(cell) as any;
        expect(copy._elements[0], label).toEqual(asRead._elements[0]);
        for (const dictionary of [TEXT, BINARY]) {
          const { entry } = pasteSaveReopen(dictionary, copy);
          expect(rows(entry), `${label}, ${dictionary}`).toEqual([[`${cls} (complex)`, own], ['double', cut ? '5' : '6']]);
        }
      });
    });
  }

  // The controls: an imaginary part that is not 0, however small, is not 0. exp(1i*pi)'s is
  // 1.2246467991473532e-16, and 5e-324 is the least double above 0; NaN is not 0 either. Nor is
  // a negative one, with the real part 0 or not. The literal reads such a member back as itself,
  // so the cell keeps its editor, and the literal with only the 5 retyped keeps the member complex.
  const notZero: [number, number][] = [
    [1, 0.5], [Math.cos(Math.PI), Math.sin(Math.PI)], [1, 1e-16], [1, 5e-324], [1, NaN], [1, -2], [0, -2],
  ];
  const notZeroFile = (): ArrayBuffer => matFile(notZero.map(([re, im], k) => cellVar(`s${k}`, [dbl([re], [im]), dbl([5])])));

  for (const nodeCeiling of [0, Number.MAX_SAFE_INTEGER]) {
    it(`node ceiling ${nodeCeiling}: a member whose imaginary part is small but not 0 keeps the editor, and the literal keeps it complex`, () => {
      const root = (MatNode.fromParsed as any)(parseMat(notZeroFile()), 'f.mat', { nodeCeiling });
      notZero.forEach(([re, im], k) => {
        const label = `{complex(${re}, ${im}), 5}`;
        const cell = root.children.find((v: any) => v.name === `s${k}`);
        const shown = String(cell.displayValue);
        const member = /^\{(.+), 5\}$/.exec(shown)?.[1];
        expect(member, label).toMatch(/i$/);
        expect(cell.valueEditable, label).toBe(true);
        const retyped = `{${member}, 6}`;
        expect(cell.setProperty('Value', retyped), label).toBe(true);
        expect(cell.displayValue, label).toBe(retyped);
        expect(rows(cell), label).toEqual([['double (complex)', member], ['double', '6']]);
      });
    });
  }

  // The control: a char member whose text reads like a complex number with imaginary part 0 is
  // not a complex number. The literal reads it back as the char it is, so the cell keeps its
  // editor, and the literal with only the 5 retyped keeps the member a char.
  const charFile = (): ArrayBuffer => matFile([cellVar('k', [charVar('', '1+0i', MI.UTF8), dbl([5])])]);

  for (const nodeCeiling of [0, Number.MAX_SAFE_INTEGER]) {
    it(`node ceiling ${nodeCeiling}: a char member that reads like 1+0i keeps the editor, and the literal keeps it a char`, () => {
      const root = (MatNode.fromParsed as any)(parseMat(charFile()), 'f.mat', { nodeCeiling });
      const cell = root.children.find((v: any) => v.name === 'k');
      expect(cell.displayValue).toBe("{'1+0i', 5}");
      expect(cell.valueEditable).toBe(true);
      expect(cell.setProperty('Value', "{'1+0i', 6}")).toBe(true);
      expect(cell.displayValue).toBe("{'1+0i', 6}");
      expect(rows(cell)).toEqual([['char', "'1+0i'"], ['double', '6']]);
    });
  }
});

type Read = { name: string; class: string; size: number[]; members: string[] };
type Truth = { release: string; files: { file: string; entries: Read[] }[] };
const truth = (): Truth => JSON.parse(strFromU8(fixture('cell_zero_imaginary.truth.json'))) as Truth;

describe("MATLAB's reading of its dictionaries and of core's saves (cell_zero_imaginary.truth.json)", () => {
  const read = (file: string): Record<string, string[]> =>
    Object.fromEntries(truth().files.find((f) => f.file === file)!.entries.map((e) => [e.name, e.members]));

  it('reads its own dictionaries as written: each member complex, the -0 kept', () => {
    expect(truth().release).toBe('2027a');
    for (const { file } of FORMATS) {
      expect(read(file), file).toEqual({
        cZero: ['double complex 1 +0i', 'double real 5'],
        cZeroNeg: ['double complex 2 -0i', 'double real 5'],
        cZeroNest: ['{double complex 1 +0i}', 'double real 5'],
        cTwoI: ['double complex 1 +2i', 'double real 5'],
      });
    }
  });

  it("reads core's saves after the element edits with each member still complex", () => {
    for (const format of ['binary', 'text']) {
      const file = `cell_zero_imaginary_core_${format}.sldd`;
      expect(read(file), file).toEqual({
        cZero: ['double complex 1 +0i', 'double real 6'],
        cZeroNeg: ['double complex 2 -0i', 'double real 6'],
        cZeroNest: ['{double complex 1 +0i}', 'double real 6'],
        cTwoI: ['double complex 1 +2i', 'double real 6'],
      });
    }
  });
});
