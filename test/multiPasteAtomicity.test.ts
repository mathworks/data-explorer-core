// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/multiPasteAtomicity.test.ts at c73da3c: its JSON half, through
// core's copy of the JSON paste (src/edit/structuralEdit.ts pasteEntries). Setup changed only: the model
// is a fresh core session over the text instead of view's getModel/invalidate, and a payload is the
// named entry's serialize() found among its nodes instead of through view's buildRows/findNode. Not
// ported: its binary half, which runs xmlStructuralEdit's pasteEntriesXml (still the host's). The
// fixture is the same bytes: vscode's test/fixtures/arch.sldd is core's.
//
// A rejected multi-select drop must leave NOTHING behind — not in the text, and
// not on the live model either.
//
// foldPasteEntries runs its allow-check over every payload BEFORE pasting any of
// them, and that ordering is the whole invariant. Each single paste does two
// things: it produces new text AND it adds the new node to the live `section`
// (that is how `_uniqueName` sees the growing namespace and gives a second Bus
// its own name). So checking lazily — rejecting item 2 only once item 1 has been
// pasted — throws with item 1 already grafted onto the in-memory model while the
// document text is discarded. The table repaints from that model, so the user is
// left looking at a phantom row (DataInterface1) that their .sldd never received
// and that vanishes on the next reload.
//
// The existing rejection tests only assert that the call throws, which a lazy
// check satisfies too. These assert the SECTION is untouched, which is what
// actually distinguishes the two orderings.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { pasteEntries } from '../src/edit/structuralEdit.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const archText = readFileSync('test/fixtures/arch.sldd', 'utf8');
const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

// A fresh core session over `text`, as view's getModel(uri, name, text) after invalidate(uri).
function getModel(_uri: string, filename: string, text: string): any {
  return ingest(createSession(), ab(new TextEncoder().encode(text)), { filename });
}

/** Payload of a named top-level entry (skipping section-header rows). */
function payloadOf(_uri: string, model: any, name: string): Record<string, unknown> {
  const row = (model.flatten() as any[]).find((n) => !n.isContainer && n.name === name);
  if (!row) throw new Error(`no entry row for "${name}"`);
  return row.serialize() as Record<string, unknown>;
}

describe('a rejected multi-paste leaves the live section untouched (JSON .sldd)', () => {
  it('does not graft the allowed payload on before rejecting the disallowed one', () => {
    const uri = 'test://atomic-json.sldd';
    const model = getModel(uri, 'arch.sldd', archText);
    const bus = payloadOf(uri, model, 'DataInterface');
    // A Simulink.ServiceBus has no home in Design — this is the payload that
    // makes the whole drop illegal.
    const svc = payloadOf(uri, model, 'ServiceInterface');
    const design = model.children.find((s: any) => s.name === 'design');
    const before = design.children.map((c: any) => c.name);

    expect(() => pasteEntries(archText, design, [bus, svc])).toThrow(/not allowed|ServiceBus/i);

    // The bus must NOT have been added. With a lazy check this is
    // ['DataInterface1'] — a row the table would paint and the file never got.
    expect(design.children.map((c: any) => c.name)).toEqual(before);
  });

  it('rejects on the FIRST payload just as completely, whatever the order', () => {
    // Order must not matter: a disallowed item first has to reject before the
    // allowed one behind it is pasted either.
    const uri = 'test://atomic-json-order.sldd';
    const model = getModel(uri, 'arch.sldd', archText);
    const bus = payloadOf(uri, model, 'DataInterface');
    const svc = payloadOf(uri, model, 'ServiceInterface');
    const design = model.children.find((s: any) => s.name === 'design');
    const before = design.children.map((c: any) => c.name);

    expect(() => pasteEntries(archText, design, [svc, bus])).toThrow(/not allowed|ServiceBus/i);
    expect(design.children.map((c: any) => c.name)).toEqual(before);
  });

  it('an all-allowed multi-paste still adds every entry (the check is not just a veto)', () => {
    // Guards the opposite mistake: an up-front check that rejected everything, or
    // a fold that stopped after the first item, would also pass the tests above.
    const uri = 'test://atomic-json-ok.sldd';
    const model = getModel(uri, 'arch.sldd', archText);
    const bus = payloadOf(uri, model, 'DataInterface');
    const nt = payloadOf(uri, model, 'NumericType');
    const design = model.children.find((s: any) => s.name === 'design');
    const before = design.children.length;

    const { selectIds } = pasteEntries(archText, design, [bus, nt]);
    expect(selectIds).toHaveLength(2);
    expect(design.children.length).toBe(before + 2);
  });
});
