// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/addEntryUndo.test.ts at c73da3c: the global DataModel and
// view's getModel / invalidate are a fresh core session per case, the JSON dictionary registered in
// it under the case's uri as view's registry registers it; view's readSlddParts is core's
// parseBinarySlddParts, which it wraps; opsOfPastedEntries and applyEntryOps are given the session.
// Fixtures: the parity params pair, core's own, byte for byte.
//
// One add, one undo step — including inside a pinned run.
//
// THE DECISION THIS PINS. The gallery's pin lets a user click several tiles without the
// popover closing, and a run of N adds is N undo steps, not one: a JSON `.sldd` cannot group
// without deferring the writes, a compressed one could but would then differ from it, and five
// clicks are five acts anyway.
//
// So what has to hold — and what this file checks — is that those steps are INDEPENDENT and
// compose back to where the run started: each one's bytes are still where its patch said they
// were when it is undone, and each one's model op takes back its own entry and no other.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { createSession, parseBinarySlddParts } from '../src/index.js';
import { addNewEntry, sectionByName } from '../src/edit/structuralEdit.js';
import { addNewEntryXml } from '../src/edit/xmlStructuralEdit.js';
import { opsOfPastedEntries, patchOfPairs, applyEntryOps } from '../src/edit/entryOps.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const parity = (name: string) => `test/parity/artifacts/${name}`;
const paramsText = readFileSync(parity('text/params.sldd'), 'utf8');

const names = (model: any, section: string): string[] =>
  (sectionByName(model, section).children as any[]).map((e) => e.name);

// A JSON dictionary's tree, registered in `session` under `uri` (view's getModel).
const jsonModel = (session: any, uri: string, text: string): any => session.addDataSource(uri, JSON.parse(text), { path: 'params.sldd' });

const RUN = 3;

describe('a pinned run of adds is one undo step per add', () => {
  it('writes three independent byte patches that undo back to the original text', () => {
    const session: any = createSession();
    const model = jsonModel(session, 'test://undo-json.sldd', paramsText);
    const design = sectionByName(model, 'design');

    // The run, each add against the text the last one produced — which is what three messages
    // arriving in a row actually do.
    let working = paramsText;
    const steps: { offset: number; inserted: string; pairs: any[] }[] = [];
    for (let i = 0; i < RUN; i++) {
      const addedFrom = (design.children as any[]).length;
      const result = addNewEntry(working, design, 'Simulink.Parameter');
      const added = opsOfPastedEntries(design, addedFrom, session);
      // One entry created, so one op pair: this is the "one step" claim at the model level.
      expect(added.pairs.length).toBe(1);
      const patch = patchOfPairs(added.pairs);
      expect(patch.redo.length).toBe(1);
      expect(patch.undo.length).toBe(1);
      steps.push({ offset: result.patch!.offset, inserted: result.patch!.text, pairs: added.pairs });
      working = result.newText;
    }
    expect((design.children as any[]).length).toBe(names(model, 'design').length);

    // Undo, newest first. Each step's bytes have to still be exactly where its own patch put
    // them — if add 3 had disturbed add 2's region, this is where it shows.
    for (const step of [...steps].reverse()) {
      expect(working.slice(step.offset, step.offset + step.inserted.length)).toBe(step.inserted);
      working = working.slice(0, step.offset) + working.slice(step.offset + step.inserted.length);
    }
    expect(working).toBe(paramsText);
  });

  it('takes back one entry per step in the model, newest first', () => {
    const session: any = createSession();
    const model = jsonModel(session, 'test://undo-model.sldd', paramsText);
    const design = sectionByName(model, 'design');
    const before = names(model, 'design');

    const undos: any[][] = [];
    const created: string[] = [];
    let working = paramsText;
    for (let i = 0; i < RUN; i++) {
      const addedFrom = (design.children as any[]).length;
      working = addNewEntry(working, design, 'Simulink.Signal').newText;
      const added = opsOfPastedEntries(design, addedFrom, session);
      created.push((design.children as any[])[addedFrom].name);
      undos.push(patchOfPairs(added.pairs).undo);
    }
    expect(names(model, 'design')).toEqual([...before, ...created]);

    // Each undo list in turn, newest first — the order the provider replays them in.
    for (let i = RUN - 1; i >= 0; i--) {
      applyEntryOps(model, undos[i], session);
      expect(names(model, 'design')).toEqual([...before, ...created.slice(0, i)]);
    }
    expect(names(model, 'design')).toEqual(before);
  });

  it('gives the binary format the same number of steps, each reversing its own chunk', () => {
    // The compressed path stores (before, after) chunk pairs rather than byte patches, so the
    // property to check is that the chain is well formed: one step per add, each step's after
    // holding exactly one more entry, and walking the befores back reaching the original.
    const session: any = createSession();
    const srcId = 'undo-bin';
    const zip = unzipSync(new Uint8Array(readFileSync(parity('binary/params.sldd'))));
    const meta: Record<string, Uint8Array> = {};
    for (const [member, data] of Object.entries(zip)) if (member !== 'data/chunk0.xml') meta[member] = data;
    const original = new TextDecoder().decode(zip['data/chunk0.xml']);
    session.removeDataSource(srcId);
    const model = session.addDataSource(srcId, parseBinarySlddParts(original, meta), { path: 'params.sldd' }) as any;
    try {
      const design = sectionByName(model, 'design');
      const before = names(model, 'design');

      const chunks: { before: string; after: string }[] = [];
      let working = original;
      for (let i = 0; i < RUN; i++) {
        const addedFrom = (design.children as any[]).length;
        const { newText } = addNewEntryXml(working, design, 'Simulink.Parameter');
        const added = opsOfPastedEntries(design, addedFrom, session);
        expect(added.pairs.length).toBe(1);
        chunks.push({ before: working, after: newText });
        working = newText;
      }
      expect(chunks.length).toBe(RUN);

      // Each after reparses to one more entry than its before — the step owns exactly one add.
      for (let i = 0; i < RUN; i++) {
        const reread = (xml: string) => {
          session.removeDataSource(srcId);
          return names(session.addDataSource(srcId, parseBinarySlddParts(xml, meta), { path: 'params.sldd' }) as any, 'design');
        };
        expect(reread(chunks[i].after).length).toBe(reread(chunks[i].before).length + 1);
      }
      // And undoing every step lands on the chunk the run started from, byte for byte.
      expect(chunks[0].before).toBe(original);
      session.removeDataSource(srcId);
      const restored = session.addDataSource(srcId, parseBinarySlddParts(chunks[0].before, meta), {
        path: 'params.sldd',
      }) as any;
      expect(names(restored, 'design')).toEqual(before);
    } finally {
      session.removeDataSource(srcId);
    }
  });
});
