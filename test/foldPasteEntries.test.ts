// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/foldPasteEntries.test.ts at c73da3c: its first describe, the
// fold through the real JSON paste (core's copy, src/edit/structuralEdit.ts pasteEntries), and the two
// shared refusals of the text half. Setup changed only: the model is a fresh core session over the text
// instead of view's getModel/invalidate, and a payload is the named entry's serialize() found among its
// nodes instead of through view's buildRows/findNode. Its other cases (the chaining ones, and the
// assertTypeAllowed refusals) are in test/dictionaryPasteRules.test.ts. The fixture is the same bytes:
// vscode's test/fixtures/params.sldd is core's test/folder-fixtures/params.sldd.
//
// A multi-entry paste into a JSON .sldd is ONE narrow write when it can be (structuralEdit.ts,
// foldPasteEntries / composeInsertions): N appends at one place fold into one insertion. The
// fold is checked rather than trusted, and the one invariant every answer must keep is that a
// patch it hands back, applied to the text before, IS the text after: the provider writes the
// patch and nothing else, so a patch that disagreed with `newText` would put an element in the
// file twice, or not at all.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { applyTextPatch, createEntry, pasteEntries, removeChildrenFromModel } from '../src/edit/structuralEdit.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const paramsText = readFileSync('test/folder-fixtures/params.sldd', 'utf8');
const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function openParams(_uri: string) {
  const model: any = ingest(createSession(), ab(new TextEncoder().encode(paramsText)), { filename: 'params.sldd' });
  const payloadOf = (name: string): Record<string, unknown> => {
    const row = (model.flatten() as any[]).find((n) => !n.isContainer && n.name === name);
    if (!row) throw new Error(`no entry row for "${name}"`);
    return row.serialize() as Record<string, unknown>;
  };
  const design = (model.children as any[]).find((s) => s.name === 'design');
  return { model, design, payloadOf };
}

describe('the folded patch is the edit', () => {
  for (const count of [1, 2, 3]) {
    it(`pasting ${count} entr${count === 1 ? 'y' : 'ies'}: the patch applied to the text before is the text after`, () => {
      const d = openParams(`test://fold-${count}.sldd`);
      const names = (d.design.children as any[]).slice(0, count).map((e) => e.name);
      const payloads = names.map(d.payloadOf);
      const before = d.design.children.length;
      const { newText, selectIds, patch } = pasteEntries(paramsText, d.design, payloads);
      expect(selectIds).toHaveLength(count);
      expect(patch, 'appends at one place fold into one insertion').toBeDefined();
      expect(patch!.length).toBe(0);
      expect(applyTextPatch(paramsText, patch!)).toBe(newText);
      // Every pasted entry is in the text, under the unique name the model gave it.
      const added = (d.design.children as any[]).slice(before).map((e) => e.name);
      expect(added).toHaveLength(count);
      for (const name of added) {
        expect(names).not.toContain(name);
        expect(patch!.text).toContain(`"${name}"`);
      }
      expect(() => JSON.parse(newText)).not.toThrow();
    });
  }
});

// The two cases of vscode's "the shared refusals, for sections shaped other than core’s" that are the
// text half's (createEntry, removeChildrenFromModel); its assertTypeAllowed cases are in
// test/dictionaryPasteRules.test.ts.
describe('the shared refusals, for sections shaped other than core’s', () => {
  it('a section that refuses to add a class says so, by display name or name', () => {
    const refusing = { addEntry: () => null, name: 'arch', displayName: '' };
    expect(() => createEntry(refusing, 'Simulink.Bus')).toThrow('Simulink.Bus cannot be added to arch.');
    expect(() => createEntry({ ...refusing, displayName: 'Architectural Data' }, 'Simulink.Bus')).toThrow(
      'Simulink.Bus cannot be added to Architectural Data.',
    );
  });

  it('a delete of no children is refused, not a no-op splice', () => {
    expect(() => removeChildrenFromModel([])).toThrow('Nothing to delete.');
  });
});
