// Copyright 2026 The MathWorks, Inc.
//
// What MATLAB read back of S2's merged saves of a binary dictionary (M9 of the 2026-10-13
// save-fidelity plan, the last of its MATLAB read-backs), held to what core writes now.
//
// matlab/m9_merged_saves.mjs makes the saves through core's API: in every compressed-binary .sldd
// under test/fixtures and test/parity/artifacts, and in a copy of each as an earlier core save
// left it (1x1 cells spelled `Dimension="1*1"`, so that the merge differs from writing the entry
// whole), one entry of each kind it holds is renamed, has its Description set, and where its class
// has one cheap to edit, a nested part edited (a bus element's Description, a struct field), each
// edit made as a host makes it (session.editProperty) and saved by session.serializeSource into
// its own file. matlab/probe_m9_merged_reopen.m had
// MATLAB R2027a open each save and a copy of its original, and wrote to
// matlab/m9_merged_saves.truth.json, for every save, whether every entry nobody edited reads as in
// the original (class, isequaln and wbcompare.m's fullsig), whether the edited entry reads as the
// original with the same edit made in MATLAB, and whether the save opens and reads with no error
// or warning.
//
// What MATLAB read: every save of a fixture MATLAB can open reads as its original does, the edited
// entry as MATLAB makes the same edit, every other entry as it was, and with no error or warning
// but those the original itself gives. Three fixtures core wrote by hand, MATLAB cannot open at all.
// And MATLAB's own rename does one thing core's does not: it writes the new name into the value's
// Name property too, where it has one (a Simulink.VariantBank, the fixtures' MyGadget).
//
// This test makes the same saves from the package's source and asks that each is still the save
// MATLAB was asked about (every part's SHA-256, the edited entry's LastMod masked): a change to
// what core writes for any of them fails here until MATLAB is asked again (re-run the two, as the
// probe's header says). A fixture the truth names that is not in the tree is skipped, and said to
// be; a binary fixture the truth does not name fails, since MATLAB was never asked about it.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest } from '../../src/index.js';
import { regenerateEntryXml } from '../../src/datamodel/parser/BinarySlddSerializer.js';
import { inLayout, layoutOf } from '../../src/datamodel/parser/ChunkLayout.js';
import { binaryFixtures, m9MergedSaves, setWriters, withOlderSaves } from './matlab/m9_merged_saves.mjs';
import '../../src/datamodel/node/data/NodeClassMap.js';

type Matlab = {
  asked?: boolean;
  opened?: boolean;
  warnings?: string[] | string;
  asExpected?: boolean;
  asOriginal?: boolean;
  edited?: { class: string; same: boolean; sameAsMatlabEdit: boolean; absentOld: boolean; bySignature: boolean; why: string; whyMatlab: string };
  unedited?: { checked: number; same: number; bySignature: number; differ: string[] | string };
  error?: string;
};
type Case = {
  fixture: string;
  variant: string;
  original: string;
  file: string;
  section: string;
  entry: string;
  kind: string;
  path: unknown;
  edit: string;
  prop: string;
  value: string;
  refused: string;
  save?: { chunk: string; parts: string };
  merged?: boolean;
  untouched?: number[];
  otherPartsKept?: boolean;
  matlab: Matlab;
};
type Original = { file: string; opened: boolean; warnings: string[] | string; entries: number; notSelfEqual: string[] | string };

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const TEST_DIR = at('..');
const TRUTH: { version: string; release: string; originals: Original[] | Original; cases: Case[] } = JSON.parse(
  readFileSync(at('./matlab/m9_merged_saves.truth.json'), 'utf8'),
);
const ORIGINALS = ([] as Original[]).concat(TRUTH.originals);
/** MATLAB writes a one-element array as the element, and an empty one as []: every list as a list. */
const list = <T>(x: T[] | T | undefined): T[] => (x === undefined ? [] : ([] as T[]).concat(x));
/** What a row asked MATLAB about, in the form both halves write it. */
const input = (c: Case) => ({
  fixture: c.fixture,
  variant: c.variant,
  original: c.original,
  file: c.file,
  section: c.section,
  entry: c.entry,
  kind: c.kind,
  edit: c.edit,
  prop: c.prop,
  value: c.value,
  path: c.path === '' || (Array.isArray(c.path) && c.path.length === 0) ? '' : c.path,
  refused: c.refused,
  save: c.save,
  merged: c.merged,
  untouched: c.untouched,
  otherPartsKept: c.otherPartsKept,
});
const FIXTURES = binaryFixtures(TEST_DIR);
const PRESENT = new Set(FIXTURES.map((f: { rel: string }) => f.rel));
const NAMED = [...new Set(TRUTH.cases.map((c) => c.fixture))];
const asked = TRUTH.cases.filter((c) => c.refused === '');

setWriters({ regenerateEntryXml, layoutOf, inLayout });
const MADE: Case[] = m9MergedSaves({ createSession, ingest }, withOlderSaves(FIXTURES)).cases;

describe("MATLAB's read-back of S2's merged binary saves (M9)", () => {
  it("the truth is MATLAB R2027a's, and every save was read", () => {
    expect(TRUTH.release).toBe('2027a');
    expect(asked.length).toBeGreaterThan(200);
    expect(asked.filter((c) => c.matlab.asked === false || c.matlab.opened === undefined)).toEqual([]);
  });

  it('every binary fixture in the tree is one MATLAB was asked about', () => {
    expect([...PRESENT].filter((rel) => !NAMED.includes(rel))).toEqual([]);
  });

  for (const fixture of NAMED) {
    // Skipped, and so reported, where the fixture is not in the tree.
    it.skipIf(!existsSync(at('../' + fixture)))(`core still makes each save of ${fixture} that MATLAB was asked about`, () => {
      const made = MADE.filter((c) => c.fixture === fixture).map(input);
      expect(made).toEqual(TRUTH.cases.filter((c) => c.fixture === fixture).map(input));
    });
  }

  it('the one edit core refuses is not asked: a property at its default of an object in an encoded value', () => {
    expect(TRUTH.cases.filter((c) => c.refused !== '').map((c) => [c.fixture, c.entry, c.edit])).toEqual([
      ['fixtures/sparse/hexobj_binary.sldd', 'pTall', 'description'],
    ]);
  });

  it('MATLAB cannot open the three fixtures core wrote by hand (make-fixtures.mjs), so no save of theirs is held to them', () => {
    expect(ORIGINALS.filter((o) => !o.opened).map((o) => o.file)).toEqual(['orig_arch_binary.sldd', 'orig_compressed.sldd', 'orig_object_array_binary.sldd']);
    const unheld = asked.filter((c) => !ORIGINALS.find((o) => o.file === c.original)!.opened);
    expect(unheld.length).toBe(10);
    for (const c of unheld) {
      expect(c.matlab.error, c.file).toMatch(/^MATLAB cannot open the original: Failed to open file/);
    }
  });

  it('every other save reads in MATLAB as the original does: the edited entry as MATLAB edits it, every other entry as it was', () => {
    const held = asked.filter((c) => ORIGINALS.find((o) => o.file === c.original)!.opened);
    expect(held.length).toBe(asked.length - 10);
    const wrong = held
      .filter((c) => !(c.matlab.error === '' && c.matlab.asOriginal && c.matlab.edited!.same && c.matlab.edited!.absentOld && list(c.matlab.unedited!.differ).length === 0))
      .map((c) => `${c.file} ${c.entry} ${c.edit}: ${c.matlab.error || c.matlab.edited?.why || list(c.matlab.unedited?.differ).join('; ')}`);
    expect(wrong).toEqual([]);
    for (const c of held) {
      expect(c.matlab.unedited!.same, c.file).toBe(c.matlab.unedited!.checked);
    }
    // And the merge was at work in them: the edited entry's object is not what writing it whole gives.
    expect(held.filter((c) => c.merged).length).toBeGreaterThanOrEqual(40);
  });

  it('with no error or warning, where the original has none; where it has, with no more than it', () => {
    // params.sldd names a referenced dictionary, common.sldd, that is not in the tree; the classes
    // of two of object_props_binary.sldd's values are not either.
    expect(ORIGINALS.filter((o) => o.opened && list(o.warnings).length > 0).map((o) => [o.file, list(o.warnings).length])).toEqual([
      ['orig_object_props_binary.sldd', 2],
      ['orig_parity_binary_params.sldd', 2],
    ]);
    const warned = new Set(['orig_object_props_binary.sldd', 'orig_parity_binary_params.sldd']);
    for (const c of asked.filter((c) => ORIGINALS.find((o) => o.file === c.original)!.opened)) {
      expect([c.file, c.matlab.asExpected], c.file).toEqual([c.file, !warned.has(c.original)]);
    }
  });

  it("MATLAB's own rename also sets a Name property of the value, of a VariantBank and of MyGadget; core's leaves the value as it was", () => {
    // M9 holds a rename to the original's value under the old name, which every save reads as.
    // MATLAB's Entry.Name = … writes the new name into the value's own Name as well.
    const differ = asked.filter((c) => c.matlab.edited?.same !== undefined && !c.matlab.edited.sameAsMatlabEdit);
    expect(differ.map((c) => [c.file, c.entry, c.edit, c.kind])).toEqual([
      ['m9_classes_r2027a_binary_9.sldd', 'vbD', 'rename', 'Simulink.VariantBank'],
      ['m9_rt_bin_1.sldd', 'gadget', 'rename', 'MyGadget'],
      ['m9_rt_out_rt_bin_1.sldd', 'gadget', 'rename', 'MyGadget'],
      ['m9_variantbank_r2027a_binary_2.sldd', 'vbD', 'rename', 'Simulink.VariantBank'],
      ['m9_variantbank_r2027a_binary_older_1.sldd', 'vb1', 'rename', 'Simulink.VariantBank'],
    ]);
    for (const c of differ) {
      const [read, wanted] = c.matlab.edited!.whyMatlab.split(' | wanted ');
      expect([read.includes(`'${c.value}'`), wanted.includes(`'${c.value}'`)], c.file).toEqual([false, true]);
    }
  });

  it('an anonymous function handle is equal to no other, so the one entry holding one is held to its class and fullsig alone', () => {
    expect(ORIGINALS.filter((o) => list(o.notSelfEqual).length > 0).map((o) => [o.file, list(o.notSelfEqual)])).toEqual([
      ['orig_sparse_hexobj_binary.sldd', ['design|anonAlias']],
    ]);
  });
});
