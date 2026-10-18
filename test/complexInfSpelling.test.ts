// Copyright 2026 The MathWorks, Inc.
//
// A complex value with an infinite part, read out of MAT bytes, shows that part as `Inf`:
// the one word MATLAB writes and displays for it, and the word the same value shows as in
// a binary dictionary (MATLAB's own `<P IsComplex="1">` text) and wherever else this
// package spells a complex number (XmlUtils.formatComplexNum). The MAT reader's speller,
// SparseData.complexElement, wrote each part with String(), so a text dictionary's MAT
// stream and a plain .mat variable showed JavaScript's `Infinity` instead: complex.sldd's
// pNonFinite was `[Infinity-Infinityi NaN+1i 1NaNi -Infinity+2i]` beside complex_binary.sldd's
// `[Inf-Infi NaN+1i 1NaNi -Inf+2i]`, and a cell `{complex(1,Inf)}` showed `{1+Infinityi}`,
// which MATLAB refuses ("Unrecognized function or variable 'Infinityi'"; R2027a, group F
// scoping). Text spelled `Infinity` still reads back (complexInputForms.test.ts), so a value
// typed or saved in the old spelling keeps its meaning.
//
// Graded on MATLAB's files: complex.sldd and complex_binary.sldd (make_complex_fixtures.m),
// and test/fixtures/complex_inf/, whose generator writes the same four values into a .mat, a
// text dictionary and a binary one (R2027a; MATLAB reads each back as the value it wrote,
// complex_inf.truth.json's readBack). The binary dictionary is the twin each other venue is
// held to, through `ingest`, the entry point a host calls.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseComplexNum } from '../src/datamodel/parser/XmlUtils.js';
import { loadFile } from './parity/loadFile.js';
import { nodeAt } from './tools/matlabPath.js';

/** Every display a node and its descendants show, by path, with the element rows. */
function shownTree(node: any, path = ''): [string, string][] {
  return [[path, String(node.displayValue)], ...node.children.flatMap((c: any) => shownTree(c, path + '/' + c.name))];
}

/** Every complex element's text under a node: each leaf whose display is one element. */
function elementTexts(node: any): string[] {
  if (node.children.length) return node.children.flatMap(elementTexts);
  return parseComplexNum(String(node.displayValue)) ? [String(node.displayValue)] : [];
}

const truth = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/complex_inf/complex_inf.truth.json', import.meta.url)), 'utf8'));

// What each value is, by name, as the generator built it (make_complex_inf_fixtures.m's
// values()): the display this package gives it, each part as formatComplexNum spells it
// (a sparse value summarizes itself, so null), and each element's row, with its parts.
type Leaf = [shows: string, re: number, im: number];
const VALUES: [name: string, shows: string | null, leaves: Leaf[]][] = [
  ['zInf', '1+Infi', [['1+Infi', 1, Infinity]]],
  [
    'zInfRow',
    '[Inf-Infi NaN+1i 1NaNi -Inf+2i]',
    [['Inf-Infi', Infinity, -Infinity], ['NaN+1i', NaN, 1], ['1NaNi', 1, NaN], ['-Inf+2i', -Infinity, 2]],
  ],
  ['zInfCell', '{1+Infi}', [['1+Infi', 1, Infinity]]],
  ['zInfSparse', null, [['-Inf+2i', -Infinity, 2], ['1+Infi', 1, Infinity]]],
];

const at = (file: string, section: boolean) => (): any => {
  const root = loadFile('../fixtures/complex_inf/' + file);
  return section ? root.getSection('design') : root;
};
const TWIN = at('complex_inf_binary.sldd', true);

// The twin's one value MATLAB does not read back as written: it stores complex(1, NaN) as
// `1.0NaNi`, and takes `1.0NaNi -Inf+2.0i` for two real elements, as with complex_binary.sldd's
// pNonFinite (complexMcosFixtures.test.ts, MATLAB_READS_BACK). This package reads the text as
// the value MATLAB wrote, so the twin still shows that value.
const BINARY_READS_BACK: Record<string, string> = { zInfRow: '[Inf-1i*Inf NaN+1i 1 NaN]' };

// Where each value is read out of MAT bytes. A binary dictionary holds a full complex value
// as MATLAB's text, which is the twin, and a sparse one as a MAT stream, which is not.
const VENUES = [
  { truth: 'mat', label: 'a plain .mat variable', variables: at('complex_inf.mat', false), names: VALUES.map(([n]) => n), twin: true },
  { truth: 'text', label: "a text dictionary's MAT stream", variables: at('complex_inf_text.sldd', true), names: VALUES.map(([n]) => n), twin: true },
  { truth: 'binary', label: "a binary dictionary's sparse MAT stream", variables: TWIN, names: ['zInfSparse'], twin: false },
];

describe('a complex value with an infinite part, read out of MAT bytes, shows the part as Inf', () => {
  it("complex.sldd's pNonFinite (text) shows what complex_binary.sldd's shows, row for row", () => {
    const text = nodeAt(loadFile('../fixtures/mcos/complex.sldd').getSection('design'), 'pNonFinite');
    const binary = nodeAt(loadFile('../fixtures/mcos/complex_binary.sldd').getSection('design'), 'pNonFinite');
    expect(text.displayValue).toBe('[Inf-Infi NaN+1i 1NaNi -Inf+2i]');
    expect(shownTree(text)).toEqual(shownTree(binary));
  });

  for (const venue of VENUES) {
    for (const [name, shows, leaves] of VALUES.filter(([n]) => venue.names.includes(n))) {
      it(`${venue.label}: ${name} = ${truth.values[name].mat2str ?? '{' + truth.values[name].elementMat2str + '}'}`, () => {
        // MATLAB's own record: the file reads back as the value it was given, and so does the
        // twin, except where MATLAB misreads its own binary text (see BINARY_READS_BACK).
        expect(truth.readBack[venue.truth][name], `${name}: MATLAB reads it back`).toBe(true);
        if (name in BINARY_READS_BACK) {
          expect(truth.readBackMat2str.binary[name], `${name}: what MATLAB reads back out of the twin`).toBe(BINARY_READS_BACK[name]);
        } else {
          expect(truth.readBack.binary[name], `${name}: MATLAB reads the twin back`).toBe(true);
        }

        const node = nodeAt(venue.variables(), name);
        if (shows !== null) expect(node.displayValue).toBe(shows);
        expect(elementTexts(node)).toEqual(leaves.map(([t]) => t));
        expect(shownTree(node).filter(([, d]) => d.includes('Infinity')), 'shown as Infinity').toEqual([]);
        if (venue.twin) expect(shownTree(node)).toEqual(shownTree(nodeAt(TWIN(), name)));
        // And each element's text reads back, in this package, as the value MATLAB wrote.
        const read = elementTexts(node).map((t) => parseComplexNum(t)!);
        expect(read.map(({ re, im }) => [Number(re), Number(im)])).toEqual(leaves.map(([, re, im]) => [re, im]));
      });
    }
  }
});
