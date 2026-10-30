// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/jsonSyncFuzz.test.ts at c73da3c (the cases C2 deferred): a
// planned keystroke, applied, repaints exactly what a re-parse would; and a re-read entry with no
// lastmod shows none. What changed in setup: the trees are core sessions' reads of the text
// (createSession + ingest) where vscode used view's getModel; entryOps' applyEntryOps is given that
// session; and the rows compared are core's (test/tools/entryRows.ts: each node's toRow(), and the
// entry's Last Modified columns) where vscode compared view's buildRows. The keystrokes, seeds and
// fixtures are vscode's.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { planEntrySync } from '../src/edit/jsonEntrySync.js';
import { findEntriesArrayStart } from '../src/edit/jsonEntryScan.js';
import { applyEntryOps } from '../src/edit/entryOps.js';
import { rowsOf } from './tools/entryRows.js';

type Any = any;

const read = (p: string) => readFileSync(`test/${p}`, 'utf8');

// vscode's fixtures, which core holds byte for byte at these paths.
const FIXTURES = [
  'parity/artifacts/text/params.sldd',
  'fixtures/arch.sldd',
  'fixtures/numeric_json.sldd',
  'fixtures/object_props_text.sldd',
  'fixtures/object_array_text.sldd',
];

function opened(source: string, filename: string) {
  const session = createSession();
  const root: Any = ingest(session, new TextEncoder().encode(source).buffer as ArrayBuffer, { filename });
  return { session, root };
}

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

describe('a planned keystroke repaints exactly what a re-parse would', () => {
  for (const fixture of FIXTURES) {
    const base = read(fixture);
    const name = fixture.split('/').pop()!;
    for (const seed of [1, 2, 3]) {
      it(`${fixture}, seed ${seed}: 150 keystrokes`, () => {
        const next = rng(seed);
        const from = findEntriesArrayStart(base);
        expect(from).toBeGreaterThan(0);
        let planned = 0;
        for (let n = 0; n < 150; n++) {
          const k = keystroke(next, base, from);
          const after = base.slice(0, k.offset) + k.text + base.slice(k.offset + k.length);
          const where = `keystroke ${n}: ${JSON.stringify(k)}`;

          const live = opened(base, name);
          const plan = planEntrySync(live.root, after, { rangeOffset: k.offset, text: k.text });
          if (!plan) continue;
          planned++;

          // A plan is never made for text the wide path cannot read.
          expect(() => JSON.parse(after), where).not.toThrow();

          applyEntryOps(live.root, [{ kind: 'replace', rowId: plan.entry.id, record: plan.record, fromDocumentText: true }], live.session);
          const narrow = rowsOf(live.root);
          const wide = rowsOf(opened(after, name).root);
          expect(narrow, where).toEqual(wide);
        }
        // (control) The keystrokes do reach the narrow path, so the equality above is about something.
        expect(planned).toBeGreaterThan(5);
      });
    }
  }
});

describe('a re-read entry with no lastmod shows none, as a re-parse of the same text does', () => {
  function deleteLastmodLine() {
    const base = read('parity/artifacts/text/params.sldd');
    const line = /\n\t*"lastmod": "[^"]*",/.exec(base);
    expect(line, 'the fixture holds a "lastmod" line').not.toBeNull();
    const after = base.slice(0, line!.index) + base.slice(line!.index + line![0].length);
    const live = opened(base, 'params.sldd');
    const plan = planEntrySync(live.root, after, { rangeOffset: line!.index, text: '' });
    expect(plan, 'the delete is planned narrow').not.toBeNull();
    expect((plan!.record as Any).metadata?.lastmod, 'the record it re-reads has no lastmod').toBeUndefined();
    const applied = applyEntryOps(live.root, [{ kind: 'replace', rowId: plan!.entry.id, record: plan!.record, fromDocumentText: true }], live.session) as Any[];
    expect(applied).toHaveLength(1);
    const rowId = applied[0].entry.id;
    const narrow = rowsOf(live.root).find((r: Any) => r.ID === rowId);
    const wide = rowsOf(opened(after, 'params.sldd').root).find((r: Any) => r.ID === rowId);
    expect(narrow, 'the narrow repaint has the entry’s row').toBeDefined();
    expect(wide, 'the re-parse has the entry’s row').toBeDefined();
    return { narrow, wide };
  }

  it('the narrow repaint shows no Last Modified either, not the time of the keystroke', () => {
    const { narrow, wide } = deleteLastmodLine();
    expect(narrow.lastModified).toBe('');
    expect(narrow.lastModifiedBy).toBe(wide.lastModifiedBy);
    expect(narrow).toEqual(wide);
  });
});
