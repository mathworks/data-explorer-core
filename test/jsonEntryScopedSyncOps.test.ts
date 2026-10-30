// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/jsonEntryScopedSync.test.ts at c73da3c (the cases C2
// deferred): the narrow path applied, narrow === wide. What changed in setup:
//   - the model is a core session's read of the document text (createSession + ingest) where vscode
//     used view's registered SlddModel and the global DataModel; a wide repaint re-reads the text
//     into a fresh session and makes that the live one, as vscode's getModel re-registers the tree;
//   - every entryOps call is given that session (core's applyEntryOps takes it as its last argument);
//   - "narrow === wide" compares core's rows (test/tools/entryRows.ts: each node's toRow(), and the
//     entry's Last Modified columns) of the live model after the op against those of the re-read,
//     where vscode spliced view's rows. The Status ("Modified") marks are vscode's slddBaseline and
//     are not ported: they are no model fact.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { planEntrySync, planKnownChange, type KnownEdit, type RangeReplacement } from '../src/edit/jsonEntrySync.js';
import { applyEntryOps } from '../src/edit/entryOps.js';
import { findEntrySpan } from '../src/edit/entrySplice.js';
import { rowsOf, rowsOfEntry, recordsOf } from './tools/entryRows.js';

type Any = any;

const FIXTURE = 'numeric_json.sldd';
// vscode's test/fixtures/numeric_json.sldd, byte for byte.
const text = readFileSync('test/fixtures/numeric_json.sldd', 'utf8');

/** The offset of `needle`'s single occurrence in `source`, or a failure. */
function only(source: string, needle: string): number {
  const at = source.indexOf(needle);
  expect(at, `"${needle}" appears in the fixture`).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(needle, at + 1), `"${needle}" appears only once`).toBe(-1);
  return at;
}

// One open document, with the narrow path and the wide re-read side by side.
function open() {
  const doc = { text };
  let session: Any;
  let live: Any;
  // getModel(): parse the live text and make it the tree the document holds.
  const build = () => {
    session = createSession();
    live = ingest(session, new TextEncoder().encode(doc.text).buffer as ArrayBuffer, { filename: FIXTURE });
    return live;
  };
  build();

  // The wide repaint: re-read the whole text, rebuild every row.
  const widePaint = () => rowsOf(build());
  // What the table holds after the narrow path: the live model's rows.
  const narrowAll = () => rowsOf(live);

  /** Type into the text view, and apply the plan to the live model. Null for "repaint wide". */
  const type = (offset: number, length: number, replacement: string) => {
    doc.text = doc.text.slice(0, offset) + replacement + doc.text.slice(offset + length);
    const plan = planEntrySync(live, doc.text, { rangeOffset: offset, text: replacement });
    if (!plan) return null;
    const rowIdOnScreen = plan.entry.id as string;
    const applied = applyEntryOps(live, [{ kind: 'replace', rowId: plan.entry.id, record: plan.record }], session);
    expect(applied).toHaveLength(1);
    expect(applied[0].kind).toBe('replace');
    return { rowIdOnScreen, entry: (applied[0] as Any).entry };
  };

  /** A change the host RECOGNISES, planned from the change's own text, applied to the live model. */
  const known = (change: RangeReplacement, ring: readonly KnownEdit[]) => {
    doc.text = doc.text.slice(0, change.rangeOffset) + change.text + doc.text.slice(change.rangeOffset + change.rangeLength);
    const plan = planKnownChange(live, [change], ring);
    if (!plan) return null;
    const rowIdOnScreen = plan.entry.id as string;
    const applied = applyEntryOps(live, [{ kind: 'replace', rowId: plan.entry.id, record: plan.record }], session);
    expect(applied).toHaveLength(1);
    expect(applied[0].kind).toBe('replace');
    return { rowIdOnScreen, entry: (applied[0] as Any).entry };
  };

  /** What the host wrote over one entry, and what it wrote over; applied for real. */
  const hostWrote = (entryName: string, rewrite: (element: string) => string): KnownEdit => {
    const span = findEntrySpan(doc.text, entryName);
    expect(span, `${entryName} has a span in the text`).not.toBeNull();
    const replaced = doc.text.slice(span!.offset, span!.offset + span!.length);
    const written = rewrite(replaced);
    expect(written, 'the edit changed something').not.toBe(replaced);
    const op = type(span!.offset, span!.length, written);
    expect(op, `the ${entryName} edit applied`).not.toBeNull();
    return { submitted: { rangeOffset: span!.offset, rangeLength: span!.length, text: written }, replaced };
  };

  const entryNamed = (name: string) => (live.children as Any[]).flatMap((s: Any) => s.children).find((e: Any) => e.name === name);
  return { doc, widePaint, narrowAll, type, known, hostWrote, entryNamed, session: () => session, live: () => live };
}

describe('JSON .sldd narrow text sync — narrow === wide', () => {
  it('repaints one entry for a value typed in the text view', () => {
    const d = open();
    d.widePaint();
    const at = only(d.doc.text, '"value": 1\n');
    const op = d.type(at + '"value": '.length, 1, '42');
    expect(op, 'a value typed inside one entry is one entry op').not.toBeNull();
    expect(op!.rowIdOnScreen).toBe(op!.entry.id);
    // The edited cell really changed.
    const row = rowsOfEntry(op!.entry).find((r: Any) => r.ID === op!.entry.id)!;
    expect(row.Value).toBe('42');
    const narrow = d.narrowAll();
    const records = recordsOf(d.live());
    // Compare LAST: widePaint re-parses and makes the re-read the live tree.
    expect(narrow).toEqual(d.widePaint());
    expect(records).toEqual(recordsOf(d.live()));
  });

  it('repaints one entry for a nested field typed in the text view', () => {
    const d = open();
    d.widePaint();
    const struct = only(d.doc.text, '"name": "NestedStruct"');
    const at = d.doc.text.indexOf('"field2": 4', struct);
    expect(at).toBeGreaterThan(struct);
    const op = d.type(at + '"field2": '.length, 1, '7');
    expect(op).not.toBeNull();
    expect(d.narrowAll()).toEqual(d.widePaint());
  });

  it('addresses the PRE-rename row id when a name is typed over', () => {
    const d = open();
    d.widePaint();
    const at = only(d.doc.text, '"name": "Number"');
    const op = d.type(at + '"name": "'.length, 'Number'.length, 'Numeral');
    expect(op, 'a rename resolves through the uuid the text still spells').not.toBeNull();
    // The rows on screen carry the OLD id; the rebuilt entry carries the new one.
    expect(op!.rowIdOnScreen).toContain('/Number');
    expect(op!.entry.id).toContain('/Numeral');
    const narrow = d.narrowAll();
    expect(narrow.some((r: Any) => r.ID === op!.rowIdOnScreen)).toBe(false);
    expect(narrow.some((r: Any) => r.ID === op!.entry.id)).toBe(true);
    // The ids the repaint paints must still resolve, or the NEXT edit on that row cannot find it.
    expect(d.session().findNodeById(op!.entry.id)).toBe(op!.entry);
    expect(d.session().findNodeById(op!.rowIdOnScreen)).toBeNull();
    expect(narrow).toEqual(d.widePaint());
  });

  it('repaints the same rows for a whole-element replace — a table cell edit', () => {
    const d = open();
    d.widePaint();
    const span = findEntrySpan(d.doc.text, 'PI')!;
    const element = d.doc.text.slice(span.offset, span.offset + span.length);
    const op = d.type(span.offset, span.length, element.replace('3.141592653589793', '3.14'));
    expect(op, 'replacing one element is one entry op').not.toBeNull();
    expect(rowsOfEntry(op!.entry).find((r: Any) => r.ID === op!.entry.id)!.Value).toBe('3.14');
    expect(d.narrowAll()).toEqual(d.widePaint());
  });

  it('leaves every other entry’s rows untouched', () => {
    const d = open();
    const before = d.widePaint();
    const at = only(d.doc.text, '"value": 1\n');
    const op = d.type(at + '"value": '.length, 1, '9')!;
    const narrow = d.narrowAll();
    const others = (rows: Any[]) => rows.filter((r) => !String(r.ID).startsWith(op.entry.id));
    expect(others(narrow)).toEqual(others(before));
    expect(narrow.length).toBe(before.length);
  });
});

describe('JSON .sldd narrow text sync — undo and redo of the host’s own edit', () => {
  const undoOf = (known: KnownEdit): RangeReplacement => ({
    rangeOffset: known.submitted.rangeOffset,
    rangeLength: known.submitted.text.length,
    text: known.replaced,
  });

  it('plans an undo from the bytes it wrote over — narrow === wide', () => {
    const d = open();
    d.widePaint();
    const written = d.hostWrote('PI', (el) => el.replace('3.141592653589793', '3.14'));
    const op = d.known(undoOf(written), [written]);
    expect(op, 'an undo of a remembered edit is one entry op').not.toBeNull();
    // Back to the value the file opened with.
    expect(rowsOfEntry(op!.entry).find((r: Any) => r.ID === op!.entry.id)!.Value).toBe('3.141592653589793');
    expect(d.narrowAll()).toEqual(d.widePaint());
  });

  it('plans a redo — the same edit, forwards', () => {
    const d = open();
    d.widePaint();
    const written = d.hostWrote('PI', (el) => el.replace('3.141592653589793', '3.14'));
    expect(d.known(undoOf(written), [written])).not.toBeNull();
    d.widePaint();
    const op = d.known(written.submitted, [written]);
    expect(op, 'a redo of a remembered edit is one entry op').not.toBeNull();
    expect(rowsOfEntry(op!.entry).find((r: Any) => r.ID === op!.entry.id)!.Value).toBe('3.14');
    expect(d.narrowAll()).toEqual(d.widePaint());
  });

  it('resolves an undone rename through the uuid, not the name', () => {
    const d = open();
    d.widePaint();
    const written = d.hostWrote('Number', (el) => el.replace('"name": "Number"', '"name": "Numeral"'));
    d.widePaint();
    const op = d.known(undoOf(written), [written]);
    expect(op, 'the entry still answers to the uuid the undone text spells').not.toBeNull();
    expect(op!.rowIdOnScreen, 'the rows on screen carry the renamed id').toContain('/Numeral');
    expect(op!.entry.id, 'and the rebuilt entry carries the name that came back').toContain('/Number');
    expect(d.narrowAll()).toEqual(d.widePaint());
  });

  it('recognises an older edit in the ring — two edits, undone in reverse', () => {
    const d = open();
    const first = d.hostWrote('Number', (el) => el.replace('"value": 1', '"value": 11'));
    const second = d.hostWrote('PI', (el) => el.replace('3.141592653589793', '3.14'));
    const ring = [first, second];
    expect(d.known(undoOf(second), ring), 'the newest edit comes back first').not.toBeNull();
    d.widePaint();
    const op = d.known(undoOf(first), ring);
    expect(op, 'and then the one before it').not.toBeNull();
    expect(rowsOfEntry(op!.entry).find((r: Any) => r.ID === op!.entry.id)!.Value).toBe('1');
    expect(d.narrowAll()).toEqual(d.widePaint());
  });
});

describe('JSON .sldd narrow text sync — an entry with no uuid', () => {
  const rewriteElement = (d: ReturnType<typeof open>, name: string, element: string) => {
    const span = findEntrySpan(d.doc.text, name);
    expect(span, `${name} has a span in the text`).not.toBeNull();
    d.doc.text = d.doc.text.slice(0, span!.offset) + element + d.doc.text.slice(span!.offset + span!.length);
  };

  it('resolves an entry that declares no metadata at all by its name', () => {
    const d = open();
    rewriteElement(d, 'Number', '{"name": "Number", "value": 1}');
    d.widePaint();
    expect(d.entryNamed('Number').metadata, 'the tree holds it with no metadata').toBeFalsy();
    const at = only(d.doc.text, '{"name": "Number", "value": 1}');
    const op = d.type(at + '{"name": "Number", "value": '.length, 1, '11');
    expect(op, 'the name is the fallback when the text spells no uuid').not.toBeNull();
    expect(rowsOfEntry(op!.entry).find((r: Any) => r.ID === op!.entry.id)!.Value).toBe('11');
    expect(d.narrowAll()).toEqual(d.widePaint());
  });
});
