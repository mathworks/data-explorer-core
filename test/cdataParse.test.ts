// Copyright 2026 The MathWorks, Inc.
//
// A text .sldd `cdata` payload is a uuencoded MAT-file ELEMENT, not "the complex
// encoding". It used to be hand-read as a 2-D complex double at fixed byte
// offsets (rows at 40, cols at 44, a real block then an imaginary block), so
// every other thing MATLAB puts there — a cell, an N-D double, a struct array —
// came back as garbage complex numbers. It now goes through MatParser, which
// already reads all of it.
//
// The fixture is the committed MATLAB-authored corpus rather than a fixture
// generated for this test: `artifacts/text/cases.sldd` is what real MATLAB wrote,
// and it is the only file in the repo that carries a `cdata` of each interesting
// class. Its five cdata entries are cellNd, cplxScalar, cplxVec, nd2x3x2 and
// structNd; expectations come from `artifacts/truth.json`, i.e. from MATLAB.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { loadFile, findEntry } from './parity/loadFile.js';
import { loadModel, serializeModel } from './parity/fidelity/roundTripHarness.js';

const TRUTH = JSON.parse(
  readFileSync(fileURLToPath(new URL('./parity/artifacts/truth.json', import.meta.url)), 'utf8'),
) as { vars: Record<string, any> };

// Every entry MATLAB stored as `_type: 'cdata'` in the uncompressed-text
// dictionary, read straight off the file so a corpus regeneration that adds one
// cannot silently escape this suite.
const TEXT_PATH = fileURLToPath(new URL('./parity/artifacts/text/cases.sldd', import.meta.url));

function cdataEntryNames(): string[] {
  const json = JSON.parse(readFileSync(TEXT_PATH, 'utf8'));
  const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  return entries
    .filter((e: any) => e?.value && e.value._type === 'cdata')
    .map((e: any) => e.name as string);
}

const CDATA_NAMES = cdataEntryNames();

const textRoot = loadFile('./artifacts/text/cases.sldd', 'cases.sldd');
const matRoot = loadFile('./artifacts/mat/cases.mat', 'cases.mat');

function textEntry(name: string): any {
  return findEntry(textRoot, name);
}

/** MATLAB's own subscript -> value pairs for an entry, from truth.json. */
function truthPairs(name: string): Record<string, string> {
  const t = TRUTH.vars[name];
  const out: Record<string, string> = {};
  t.linearSubs.forEach((sub: string, i: number) => {
    out[sub] = t.linearValues[i];
  });
  return out;
}

/** `displayName -> displayValue` over a node's element children. */
function elementPairs(node: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of node.children) {
    out[c.displayName] = String(c.displayValue);
  }
  return out;
}

/** The whole subtree as `displayName = displayValue` lines, for cross-format diffs. */
function outline(node: any, depth = 0): string[] {
  const lines = ['  '.repeat(depth) + node.displayName + ' = ' + String(node.displayValue)];
  for (const c of node.children) {
    lines.push(...outline(c, depth + 1));
  }
  return lines;
}

describe('text .sldd cdata', () => {
  it('finds the five entries MATLAB stored as cdata', () => {
    expect(CDATA_NAMES).toEqual(['cellNd', 'cplxScalar', 'cplxVec', 'nd2x3x2', 'structNd']);
  });

  it('reads a complex scalar', () => {
    expect(textEntry('cplxScalar').displayValue).toBe(TRUTH.vars.cplxScalar.mat2str);
  });

  it('reads a complex row vector in MATLAB order', () => {
    expect(textEntry('cplxVec').displayValue).toBe(TRUTH.vars.cplxVec.mat2str);
    expect(textEntry('cplxVec').children.map((c: any) => String(c.displayValue))).toEqual([
      '1+2i',
      '3-4i',
    ]);
  });

  // The discriminators. A rank-3 real double, a rank-3 cell and a rank-3 struct
  // array all live in a cdata, and the old fixed-offset reader turned each of
  // them into six garbage complex numbers.
  it('reads a rank-3 real double, with MATLAB subscripts and values', () => {
    const n = textEntry('nd2x3x2');
    expect(n.children.length).toBe(TRUTH.vars.nd2x3x2.numel);
    expect(elementPairs(n)).toEqual(truthPairs('nd2x3x2'));
  });

  it('reads a rank-3 cell, all twelve slots', () => {
    // This compared the twelve values as an unordered SET while the cell labels
    // were still wrong (defect 14: the element list arrives column-major and
    // displayName read it row-major). That is fixed, so assert the pairing —
    // a set comparison would pass on any permutation, which is exactly the bug
    // it was sidestepping.
    const n = textEntry('cellNd');
    expect(n.children.length).toBe(TRUTH.vars.cellNd.numel);
    expect(elementPairs(n)).toEqual(truthPairs('cellNd'));
  });

  it('reads a rank-3 struct array, with MATLAB subscripts and per-element fields', () => {
    const n = textEntry('structNd');
    expect(n.children.length).toBe(TRUTH.vars.structNd.numel);
    const pairs: Record<string, string> = {};
    for (const el of n.children) {
      const a = el.children.find((c: any) => c.name === 'a');
      pairs[el.displayName] = String(a.displayValue);
    }
    expect(pairs).toEqual(truthPairs('structNd'));
  });
});

// The acceptance criterion: the same catalog, written by the same MATLAB to a
// .mat, must read back the same. Display SHAPE of an N-D container is still
// wrong in both (defect 7, Phase 7) — this asserts the two formats agree, which
// stays true when that is fixed on both at once.
describe('text .sldd cdata agrees with the same value in a .mat', () => {
  for (const name of CDATA_NAMES) {
    it(`${name} reads identically from both formats`, () => {
      expect(outline(textEntry(name)).join('\n')).toBe(outline(findEntry(matRoot, name)).join('\n'));
    });
  }
});

// Write-back is the risk the routing change introduces: `parseMatVariable`'s
// factories set _matVar/_rawBytes but not `_rawInput`, and an untouched node
// round-trips only by replaying `_rawInput` verbatim. Without it, opening a
// dictionary and saving it re-renders every cdata entry — a file we merely looked
// at comes back changed.
describe('text .sldd cdata round-trip', () => {
  const original = JSON.parse(readFileSync(TEXT_PATH, 'utf8'));
  const model = loadModel('json', 'cases.sldd', 'test://cdata-rt.sldd');
  const outBytes = serializeModel(model, 'json');
  const outText = Buffer.from(outBytes).toString('utf8');
  const written = JSON.parse(outText);

  function entries(json: any): any[] {
    return json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  }

  it('re-serializes every untouched cdata entry unchanged', () => {
    const before = entries(original);
    const after = entries(written);
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      if (!before[i]?.value || before[i].value._type !== 'cdata') {
        continue;
      }
      expect(after[i].value, before[i].name).toEqual(before[i].value);
      // Byte-for-byte on the payload itself, not just deep-equal on the wrapper.
      expect(after[i].value._value, before[i].name).toBe(before[i].value._value);
    }
  });

  it('leaves each cdata payload verbatim in the written bytes', () => {
    const before = entries(original);
    for (const e of before) {
      if (!e?.value || e.value._type !== 'cdata') {
        continue;
      }
      expect(outText.includes(JSON.stringify(e.value._value)), e.name).toBe(true);
    }
  });
});
