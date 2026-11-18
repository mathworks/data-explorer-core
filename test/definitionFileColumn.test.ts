// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.Parameter's and a Simulink.Signal's Definition File, CoderInfo.CustomAttributes.
// DefinitionFile, is a table column, read-only like the Header File, as in MATLAB's own table: the
// definitionFile column, which a Simulink.VariantBankCoderInfo's DefinitionFile shows in too.
// Held to what MATLAB R2027a wrote and read back (fixtures/definition-file/make_definition_file.m
// and its made.json), in a text dictionary and a MAT-file: two objects under ExportToFile, which
// carries a Definition File, one under GetSet and one under Auto, which carry none, so their cell
// is blank. (A binary dictionary MATLAB wrote with one is data-explorer-view's.)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { buildPILayout, schemaColumns } from '../src/datamodel/node/schemaBridge.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const DIR = fileURLToPath(new URL('./fixtures/definition-file/r2027a/', import.meta.url));
const MADE: { values: { name: string; class: string; text: Venue; mat: Venue }[] } = JSON.parse(readFileSync(DIR + 'made.json', 'utf8'));
type Venue = { StorageClass: string; CustomStorageClass: string; attributes: Record<string, string> };
const VENUES = [
  ['text', 'definition_file_text.sldd'],
  ['mat', 'definition_file.mat'],
] as const;

function opened(file: string) {
  const session = createSession();
  const b = new Uint8Array(readFileSync(DIR + file));
  const root: Any = ingest(session, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, { filename: file });
  const node = (name: string): Any => (root.flatten() as Any[]).find((n) => n.name === name && !n.isContainer);
  return { session, root, node };
}

describe('the Definition File column', () => {
  it("is a Parameter's and a Signal's, read-only, beside the Header File", () => {
    for (const cls of ['Simulink.Parameter', 'Simulink.Signal']) {
      const col = schemaColumns(cls).find((c) => c.key === 'definitionFile');
      expect(col, cls).toBeDefined();
      expect([col!.column, col!.displayName, col!.editor], cls).toEqual(['definitionFile', 'Definition File', 'label']);
      // The Property Inspector's row of it stays where it was, in Custom Attributes.
      const group = buildPILayout(cls)!.find((g) => g.items.some((i) => i.key === 'definitionFile'));
      expect(group?.group, cls).toBe('Custom Attributes');
    }
  });

  for (const [venue, file] of VENUES) {
    describe(`in a ${venue === 'text' ? 'text dictionary' : 'MAT-file'}`, () => {
      it('shows the Definition File MATLAB reads back, and a blank cell under a storage class without one', () => {
        const { node } = opened(file);
        for (const made of MADE.values) {
          const n = node(made.name);
          expect(n?.className, made.name).toBe(made.class);
          const row = n.toRow();
          const { attributes } = made[venue];
          expect([row.definitionFile, row.headerFile], made.name).toEqual([attributes.DefinitionFile ?? '', attributes.HeaderFile ?? '']);
        }
        // The two the fixture holds one in, so the loop above is not all blanks.
        expect(MADE.values.filter((v) => v[venue].attributes.DefinitionFile).map((v) => v.name)).toEqual(['pExport', 'sExport']);
      });

      it('takes no edit, and marks nothing', () => {
        const { session, root, node } = opened(file);
        for (const name of ['pExport', 'sExport', 'pAuto']) {
          const n = node(name);
          session.setActive(root, n);
          expect(n.getPropInfo(schemaColumns(n.className).find((c) => c.key === 'definitionFile')!).editable, name).toBe(false);
          expect(session.editProperty(n.id, 'definitionFile', 'other.c'), name).not.toBe(true);
          expect(n.toRow().definitionFile, name).toBe(name === 'pAuto' ? '' : name === 'pExport' ? 'p_export.c' : 's_export.c');
        }
        expect(root.dirty).toBeFalsy();
      });
    });
  }
});
