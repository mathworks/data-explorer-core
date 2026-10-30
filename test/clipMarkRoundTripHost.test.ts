// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/clipMarkRoundTrip.test.ts at c73da3c: its entryOps half only.
// What vscode asserts there of entryOps' findEntryByName: the repaint reads each cut/copy mark's key
// back as the (section, name) a copy put on the clipboard (buildClipboardSnapshot: the entry's name
// and its own section), and findEntryByName must find exactly that entry. Asserted here for every
// entry of the same dictionaries, opened in a fresh core session. Not ported, as they are view's
// and vscode's own: the row stamp that dims exactly the copied entry's row (view's buildRows with
// a ClipMark), the clipboard snapshot (vscode's buildClipboardSnapshot), and the describe of view's
// clipMarkKey/splitClipMarkKey. The binary dictionaries are core's parity/artifacts/binary/params.sldd
// (vscode's, byte for byte) and core's own test/fixtures/arch_binary.sldd in place of vscode's
// (other bytes): the assertion holds of any dictionary, and core keeps no binary fixture MATLAB was
// not asked about (test/parity/m9MergedSaves.truth.test.ts).
//
// The cut/copy mark on a table's rows is one key spelled in two places: the row stamp that
// dims a row (rowStamp.ts, through clipMarkKey) and the repaint that runs when the clipboard
// changes, which reads each key back with splitClipMarkKey and findEntryByName to know which
// entries to repaint (both providers' clipboard listeners).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession, DATA_PART_XML, parseBinarySlddParts } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { findEntryByName } from '../src/edit/entryOps.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixture = (p: string) => fileURLToPath(new URL(`./${p}`, import.meta.url));
const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

// Every entry, as a copy of it (or of a row under it) puts it on the clipboard: its section's
// name and its own name, read back by findEntryByName.
function roundTrip(model: any): number {
  let checked = 0;
  for (const section of model.children as any[]) {
    for (const entry of section.children as any[]) {
      expect(findEntryByName(model, section.name, entry.name), `key for ${entry.id}`).toBe(entry);
      checked++;
    }
  }
  return checked;
}

describe('the clip-mark key reads back as the entry it marks', () => {
  for (const file of ['parity/artifacts/text/params.sldd', 'fixtures/arch.sldd']) {
    it(`every copyable row of ${file}`, () => {
      const model: any = ingest(createSession(), ab(new Uint8Array(readFileSync(fixture(file)))), { filename: 'x.sldd' });
      expect(roundTrip(model)).toBeGreaterThan(3);
    });
  }

  for (const file of ['parity/artifacts/binary/params.sldd', 'fixtures/arch_binary.sldd']) {
    it(`every copyable row of ${file}`, () => {
      const zip = unzipSync(new Uint8Array(readFileSync(fixture(file))));
      const xml = new TextDecoder().decode(zip[DATA_PART_XML]);
      const meta: Record<string, Uint8Array> = {};
      for (const [k, v] of Object.entries(zip)) if (k !== DATA_PART_XML) meta[k] = v;
      const session: any = createSession();
      const model = session.addDataSource(`binedit:test://clipmark/${file}`, parseBinarySlddParts(xml, meta), { path: 'x.sldd' });
      expect(roundTrip(model)).toBeGreaterThan(3);
    });
  }
});
