// Copyright 2026 The MathWorks, Inc.
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
// Ported from data-explorer-vscode test/multiPasteAtomicity.test.ts at c73da3c: its binary half (the
// JSON half is core's test/multiPasteAtomicity.test.ts). Imports point at core's copy
// (src/edit/xmlStructuralEdit.ts) and core's barrel, and the dictionary is opened in a fresh core
// session instead of the global DataModel. The fixture, test/parity/artifacts/binary/params.sldd, is
// vscode's byte for byte. Every assertion is vscode's.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession, parseBinarySlddParts } from '../src/index.js';
import { pasteEntriesXml } from '../src/edit/xmlStructuralEdit.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('a rejected multi-paste leaves the live section untouched (binary .sldd)', () => {
  const binPath = fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url));
  const zip = unzipSync(new Uint8Array(readFileSync(binPath)));
  const baseXml = new TextDecoder().decode(zip['data/chunk0.xml']);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;

  it('rejects the whole drop without adding the allowed payload', () => {
    const uri = 'mem://atomic-xml';
    const model: any = createSession().addDataSource(uri, parseBinarySlddParts(baseXml, meta) as any, {
      path: 'params.sldd',
    });
    const section = model.children.find((s: any) => s.children.length > 0) ?? model.children[0];
    const good = section.children[0].serialize() as Record<string, unknown>;
    // params.sldd holds no section-illegal entry, so synthesize the payload the
    // allow-list rejects: the gate reads `value._array_class`, which is exactly
    // what a real serialized ServiceBus carries.
    const bad = {
      name: 'Illegal',
      value: { _array_class: 'Simulink.ServiceBus' },
    } as Record<string, unknown>;
    const before = section.children.map((c: any) => c.name);

    // Only meaningful if this section really does restrict its types — otherwise
    // the test would pass for the wrong reason.
    expect(section.allowsType('Simulink.ServiceBus')).toBe(false);
    expect(() => pasteEntriesXml(baseXml, section, [good, bad])).toThrow(
      /not allowed|ServiceBus/i,
    );
    expect(section.children.map((c: any) => c.name)).toEqual(before);
  });
});
