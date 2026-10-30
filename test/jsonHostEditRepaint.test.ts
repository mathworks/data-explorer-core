// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/jsonHostEditRepaint.test.ts at c73da3c: its planner cases
// (jsonEntrySync, jsonEntryScan, as core copied them) — isEchoOfEdit, isPaintedEcho / hintFor,
// planOwnEdit, and "a change narrow enough to plan leaves the document parseable". What changed in
// setup: that last sweep plans against a core session's read of each fixture (createSession +
// ingest) where vscode's test used view's getModel. The file's other cases edit through entryOps'
// mutateEntry and repaint view's rows (narrow === wide, the index after a rename, the catalog
// carried, a refused Description), which need core step 6a C3 and view, and stay in vscode.
//
// THE HOST ONLY TRUSTS ITS OWN EDIT. The repaint token is spent only on a change event that reports
// exactly the range replacement that was submitted (planOwnEdit / isEchoOfEdit). And underneath it
// all: while the rows and the model have stayed in step with the text, the text still PARSES — a
// change narrow enough to plan is a change that left the document parseable.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { indexEntries } from '../src/edit/jsonEntryScan.js';
import { planEntrySync, isEchoOfEdit, isPaintedEcho, hintFor, planOwnEdit } from '../src/edit/jsonEntrySync.js';

type Any = any;

// vscode's test/<path> for each, byte for byte, at the same path in core.
const read = (rel: string) => readFileSync(`test/${rel}`, 'utf8');

// Three JSON dictionaries with different insides: plain values and MATLAB containers, real Simulink
// objects (Min/Max/Unit/DataType and nested rows), and architectural entries.
const FIXTURES: Array<{ label: string; text: string }> = [
  { label: 'numeric_json.sldd', text: read('fixtures/numeric_json.sldd') },
  { label: 'mcos/all.sldd', text: read('fixtures/mcos/all.sldd') },
  { label: 'arch.sldd', text: read('fixtures/arch.sldd') },
];

describe('isEchoOfEdit — spending the repaint token only on the edit that made it', () => {
  const submitted = { rangeOffset: 120, rangeLength: 45, text: '{ "name": "A" }' };

  it('accepts the one change that reports exactly what was submitted', () => {
    expect(isEchoOfEdit([{ ...submitted }], submitted)).toBe(true);
  });

  it('refuses a change at another offset, of another length, or with other text', () => {
    expect(isEchoOfEdit([{ ...submitted, rangeOffset: 121 }], submitted)).toBe(false);
    expect(isEchoOfEdit([{ ...submitted, rangeLength: 44 }], submitted)).toBe(false);
    expect(isEchoOfEdit([{ ...submitted, text: '{ "name": "B" }' }], submitted)).toBe(false);
  });

  it('refuses a batch, even one holding the submitted change', () => {
    expect(isEchoOfEdit([{ ...submitted }, { rangeOffset: 0, rangeLength: 0, text: 'x' }], submitted)).toBe(false);
    expect(isEchoOfEdit([{ rangeOffset: 0, rangeLength: 0, text: 'x' }, { ...submitted }], submitted)).toBe(false);
  });

  it('refuses an event that changed nothing', () => {
    expect(isEchoOfEdit([], submitted)).toBe(false);
  });
});

describe('isPaintedEcho / hintFor — an echo is trusted only while its paint is still on screen', () => {
  const submitted = { rangeOffset: 120, rangeLength: 45, text: '{ "name": "A" }' };

  it('skips the echo of a painted write while no wide repaint has begun since', () => {
    expect(isPaintedEcho([{ ...submitted }], { submitted, epoch: 3 }, 3)).toBe(true);
  });

  it('refuses it once a wide repaint has begun, however exactly the bytes match', () => {
    expect(isPaintedEcho([{ ...submitted }], { submitted, epoch: 3 }, 4)).toBe(false);
  });

  it('still asks the bytes first: a change that is not the write is never skipped', () => {
    expect(isPaintedEcho([{ ...submitted, rangeOffset: 121 }], { submitted, epoch: 3 }, 3)).toBe(false);
    expect(isPaintedEcho([], { submitted, epoch: 3 }, 3)).toBe(false);
  });

  it('drops a cell edit’s hint the same way, and keeps it while its paint stands', () => {
    const hint = { entryId: 'doc/design/A', submitted, epoch: 3 };
    expect(hintFor(hint, 3)).toBe(hint);
    expect(hintFor(hint, 4)).toBeNull();
    expect(hintFor(null, 3)).toBeNull();
  });
});

describe('planOwnEdit — the entry the host wrote, read back out of what it wrote', () => {
  const entryText = '{\n  "name": "Gain_renamed",\n  "value": 42\n}';
  const submitted = { rangeOffset: 200, rangeLength: 38, text: entryText };
  const hint = { entryId: 'doc/design/Gain_renamed', submitted, epoch: 0 };

  it('replaces the entry the MODEL names, over the run the PAINT left under the same id', () => {
    const plan = planOwnEdit([{ ...submitted }], hint);
    expect(plan).not.toBeNull();
    expect(plan!.op).toEqual({
      kind: 'replace',
      rowId: 'doc/design/Gain_renamed',
      record: { name: 'Gain_renamed', value: 42 },
      fromDocumentText: true,
    });
    expect(plan!.entryRowId).toBe('doc/design/Gain_renamed');
  });

  it('refuses a change that is not the echo of the submitted edit', () => {
    expect(planOwnEdit([{ ...submitted, rangeOffset: 201 }], hint)).toBeNull();
    expect(planOwnEdit([], hint)).toBeNull();
    expect(planOwnEdit([{ ...submitted }, { rangeOffset: 0, rangeLength: 0, text: 'x' }], hint)).toBeNull();
  });

  it('refuses text that is not one JSON object, rather than half-applying it', () => {
    for (const text of ['{ "name": "A", ', '[1, 2]', '"just a string"', '42', 'null']) {
      expect(planOwnEdit([{ ...submitted, text }], { ...hint, submitted: { ...submitted, text } }), text).toBeNull();
    }
  });
});

for (const { label, text } of FIXTURES) {
  describe(`a change narrow enough to plan leaves the document parseable — ${label}`, () => {
    it('every planned change parses, and the malformed ones are refused', () => {
      const model: Any = ingest(createSession(), new TextEncoder().encode(text).buffer as ArrayBuffer, { filename: label.split('/').pop()! });
      const elements = indexEntries(text)!.elements;
      expect(elements.length).toBeGreaterThan(2);

      let planned = 0;
      let refused = 0;
      for (const el of elements) {
        const end = el.offset + el.length;
        const points = [el.offset, el.offset + 1, Math.floor((el.offset + end) / 2), end - 1, end];
        const probes: Array<{ length: number; insert: string }> = [
          { length: 0, insert: '"' },
          { length: 0, insert: '{' },
          { length: 0, insert: ',' },
          { length: 0, insert: '9' },
          { length: 1, insert: '' },
          { length: 1, insert: 'z' },
        ];
        for (const at of points) {
          for (const probe of probes) {
            const newText = text.slice(0, at) + probe.insert + text.slice(at + probe.length);
            const plan = planEntrySync(model, newText, { rangeOffset: at, text: probe.insert });
            if (!plan) {
              refused++;
              continue;
            }
            planned++;
            const what = probe.insert ? `inserting ${JSON.stringify(probe.insert)}` : 'deleting a character';
            expect(() => JSON.parse(newText), `${what} at ${at} in "${el.name}" was planned, so it must still parse`).not.toThrow();
          }
        }
      }
      expect(planned).toBeGreaterThan(0);
      expect(refused).toBeGreaterThan(0);
    });
  });
}
