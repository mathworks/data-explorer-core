// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/jsonSyncFuzz.test.ts at c73da3c: the planner under random
// keystrokes (jsonEntrySync, jsonEntryScan, as core copied them). What changed in setup: the tree a
// keystroke is planned against is a core session's read of the text (createSession + ingest), where
// vscode's test used view's getModel; and what is asserted is the PLAN's half. The rest of vscode's
// assertions apply the plan (entryOps.applyEntryOps, core step 6a C3) and compare view's rows
// (narrow === wide, and the re-read entry's Last Modified), and stay in vscode until then. The one
// row fact kept here, that a re-parse of the text shows no Last Modified, is asserted of what the
// row is built from: the re-parsed entry's metadata.
//
// Each keystroke in the text view is handed to planEntrySync, which scans for the one element the
// change landed in, re-parses that element alone, and names the one entry it replaces. Its promise
// is "every doubt is a no": a plan is made only when the change is narrow beyond argument, so a plan
// must never be made for text the wide path cannot read at all. The edits are random — single
// insertions, deletions and replacements of structural characters and of ordinary text, anywhere in
// the entries of a real dictionary — from fixed seeds, so a failure names a reproducible keystroke.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { planEntrySync } from '../src/edit/jsonEntrySync.js';
import { findEntriesArrayStart } from '../src/edit/jsonEntryScan.js';

type Any = any;

// vscode's test/<path> for each, byte for byte, at the same path in core.
const read = (p: string) => readFileSync(`test/${p}`, 'utf8');

const parse = (source: string, filename: string): Any =>
  ingest(createSession(), new TextEncoder().encode(source).buffer as ArrayBuffer, { filename });

// A dictionary MATLAB wrote as text (40 entries of every kind), one with architectural data, one
// of numeric shapes, and two of objects that a fixture script wrote without lastmod or modifiedby.
const FIXTURES = [
  'parity/artifacts/text/params.sldd',
  'fixtures/arch.sldd',
  'fixtures/numeric_json.sldd',
  'fixtures/object_props_text.sldd',
  'fixtures/object_array_text.sldd',
];

// mulberry32: small, seedable, and the same sequence on every platform.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STRUCTURAL = ['"', '{', '}', '[', ']', ',', ':', '\\', '\\"', '},{', '"name"', '"x":1,'];
const ORDINARY = ['a', 'Z', '7', '.', '-', ' ', '\n', 'e5', 'true', 'null'];

interface Keystroke {
  offset: number;
  length: number;
  text: string;
}

function keystroke(next: () => number, text: string, from: number): Keystroke {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)];
  const offset = from + Math.floor(next() * (text.length - from));
  const kind = next();
  if (kind < 0.25) return { offset, length: 1 + Math.floor(next() * 3), text: '' };
  const insert = next() < 0.5 ? pick(STRUCTURAL) : pick(ORDINARY);
  return { offset, length: kind < 0.5 ? 1 : 0, text: insert };
}

describe('a planned keystroke is planned only for text a re-parse can read', () => {
  for (const fixture of FIXTURES) {
    const base = read(fixture);
    for (const seed of [1, 2, 3]) {
      it(`${fixture}, seed ${seed}: 150 keystrokes`, () => {
        const next = rng(seed);
        const from = findEntriesArrayStart(base);
        expect(from).toBeGreaterThan(0);
        // The keystrokes are planned against the tree read from the base text, which no plan
        // changes here (vscode's test applies each one and reads the tree again).
        const live = parse(base, fixture.split('/').pop()!);
        let planned = 0;
        for (let n = 0; n < 150; n++) {
          const k = keystroke(next, base, from);
          const after = base.slice(0, k.offset) + k.text + base.slice(k.offset + k.length);
          const where = `keystroke ${n}: ${JSON.stringify(k)}`;
          const plan = planEntrySync(live, after, { rangeOffset: k.offset, text: k.text });
          if (!plan) continue;
          planned++;
          // A plan is never made for text the wide path cannot read.
          expect(() => JSON.parse(after), where).not.toThrow();
        }
        // (control) The keystrokes do reach the narrow path, so the assertion above is about
        // something: many of them land inside a string or a number of one entry.
        expect(planned).toBeGreaterThan(5);
      });
    }
  }
});

describe('a re-read entry with no lastmod shows none, as a re-parse of the same text does', () => {
  it('(preconditions) the delete is planned narrow, and a re-parse shows no Last Modified', () => {
    const base = read('parity/artifacts/text/params.sldd');
    const line = /\n\t*"lastmod": "[^"]*",/.exec(base);
    expect(line, 'the fixture holds a "lastmod" line').not.toBeNull();
    const after = base.slice(0, line!.index) + base.slice(line!.index + line![0].length);
    const live = parse(base, 'params.sldd');
    const plan = planEntrySync(live, after, { rangeOffset: line!.index, text: '' });
    expect(plan, 'the delete is planned narrow').not.toBeNull();
    expect((plan!.record as Any).metadata?.lastmod, 'the record it re-reads has no lastmod').toBeUndefined();
    // The re-parse's row shows the entry's Last Modified from its metadata: none.
    const wide = (parse(after, 'params.sldd').flatten() as Any[]).find((e) => e.isEntry && e.name === plan!.entry.name);
    expect(wide, 'the re-parse has the entry').toBeDefined();
    expect(wide.metadata?.lastmod).toBeUndefined();
  });
});
