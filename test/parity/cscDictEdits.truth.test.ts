// Copyright 2026 The MathWorks, Inc.
//
// What MATLAB read back of core's saves of a CoderInfo edit of a dictionary object with a custom
// storage class, held to what core writes now.
//
// matlab/csc_dict_edits.mjs makes the saves through core's API: pExport, a Simulink.Parameter
// under ExportToFile, its StorageClass set to Auto, ExportedGlobal, ImportedExtern or
// SimulinkGlobal, or its Alignment to 8, one edit per file. A dictionary takes them and writes the
// property alone, leaving the CustomStorageClass and the CustomAttributes as the file held them,
// where MATLAB's own StorageClass edit sets the CustomStorageClass to Default (a MAT-file refuses
// every edit of such a CoderInfo: test/matCustomStorageClass.test.ts). matlab/
// probe_csc_dict_edits.m had MATLAB R2027a make each edit itself on the original's object and read
// each save, and wrote matlab/csc_dict_edits.truth.json.
//
// What MATLAB read: every save reads as MATLAB's own edit makes the object (isequal), in a text
// dictionary and in a binary one, with no warning: MATLAB reads the CustomStorageClass the file
// keeps as Default once the StorageClass is a built-in one, and keeps the attributes object.
//
// This test makes the text dictionary's saves again from the package's source and asks that each
// is still the save MATLAB was asked about (its SHA-256, the entries' lastmod masked): a change to
// what core writes fails here until MATLAB is asked again (re-run the two, as the probe's header
// says). The binary rows were made from data-explorer-view's MATLAB-written
// test-integration/fixtures/cscattributes/csc_attributes_binary.sldd, not in this tree (every
// binary fixture here is held to M9: m9MergedSaves.truth.test.ts), so they are MATLAB's answer
// alone, kept beside the text ones.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest } from '../../src/index.js';
import { cscDictEdits, EDITS } from './matlab/csc_dict_edits.mjs';
import '../../src/datamodel/node/data/NodeClassMap.js';

type Read = { error?: string; StorageClass: string; CustomStorageClass: string; Alignment: number; attributesClass: string; warning: string; printed: string };
type Case = {
  format: 'text' | 'binary';
  original: string;
  originalSha256: string;
  id: string;
  key: string;
  value: string;
  file: string | null;
  sha256: string | null;
  // A refusal's words, or none: MATLAB's jsonencode writes the null csc_dict_edits.mjs gives as [].
  refused: string | [] | null;
  matlab?: Read;
  saved?: Read;
  sameAsMatlab?: boolean;
};

const TRUTH: { version: string; cases: Case[] } = JSON.parse(readFileSync(fileURLToPath(new URL('./matlab/csc_dict_edits.truth.json', import.meta.url)), 'utf8'));
const TEXT = new Uint8Array(readFileSync(fileURLToPath(new URL('../fixtures/definition-file/r2027a/definition_file_text.sldd', import.meta.url))));

describe("a dictionary's edit of a CoderInfo with a custom storage class, as MATLAB reads it back", () => {
  it('asked MATLAB of every edit, in a text and a binary dictionary', () => {
    for (const format of ['text', 'binary']) {
      expect(TRUTH.cases.filter((c) => c.format === format).map((c) => [c.key, c.value]), format).toEqual(EDITS);
    }
  });

  it("reads each save as MATLAB's own edit makes the object, with no warning", () => {
    for (const c of TRUTH.cases) {
      const label = `${c.format} ${c.id}`;
      expect(c.refused ?? [], label).toEqual([]);
      expect(c.sameAsMatlab, label).toBe(true);
      for (const read of [c.matlab!, c.saved!]) {
        expect(read.error, label).toBeUndefined();
        expect([read.warning, read.printed], label).toEqual(['', '']);
      }
      // MATLAB's StorageClass edit leaves no custom storage class; an Alignment edit keeps it.
      expect(c.saved!.CustomStorageClass, label).toBe(c.key === 'storageClass' ? 'Default' : 'ExportToFile');
    }
  });

  it("still makes the text dictionary's saves MATLAB was asked about", () => {
    const asked = TRUTH.cases.filter((c) => c.format === 'text');
    // The fixture in the tree is the original MATLAB was asked about.
    expect(asked.map((c) => c.originalSha256)).toEqual(asked.map(() => createHash('sha256').update(TEXT).digest('hex')));
    const now = cscDictEdits({ createSession, ingest }, TEXT, asked[0].original);
    expect(now.map((r) => [r.id, r.sha256])).toEqual(asked.map((c) => [c.id, c.sha256]));
  });
});
