// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/jsonEntryScopedSync.test.ts at c73da3c: the scanner and the
// planner (jsonEntryScan, jsonEntrySync, as core copied them). What changed in setup:
//   - the model a plan is made against is a core session's read of the document text as it stood
//     before the change (createSession + ingest), where vscode's test kept view's registered
//     SlddModel up to date by applying each plan (entryOps.applyEntryOps). Each plan is made against
//     the tree a re-parse of that text builds, which vscode's own narrow === wide assertions hold
//     the applied model to;
//   - so what is asserted is the PLAN: that one is made or refused, which live entry it names (the
//     row id on screen), and what record it re-reads. The narrow === wide row comparisons, the
//     Status ("Modified") marks and the index checks after the replace is applied need entryOps'
//     applyEntryOps (core step 6a C3) and view's rows, and stay in vscode until then.
//
// The entry-scoped repaint for a JSON .sldd: a change typed into the plain-text view repaints ONE
// entry's rows, instead of re-parsing the whole document and rebuilding every row on every
// keystroke. Three invariants: narrow === wide (vscode's suite); the scan agrees with the parser;
// and it refuses everything else, which the caller answers with the full repaint.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { findEntriesArrayStart, scanEntries, locateChangedEntry } from '../src/edit/jsonEntryScan.js';
import { planEntrySync, planKnownChange, type KnownEdit, type RangeReplacement } from '../src/edit/jsonEntrySync.js';
import { findEntrySpan } from '../src/edit/entrySplice.js';

type Any = any;

const FIXTURE = 'numeric_json.sldd';
// vscode's test/fixtures/numeric_json.sldd, byte for byte.
const text = readFileSync('test/fixtures/numeric_json.sldd', 'utf8');

/** A core session's read of `source`: the tree a re-parse of the document builds. */
function parse(source: string): Any {
  const session = createSession();
  const root: Any = ingest(session, new TextEncoder().encode(source).buffer as ArrayBuffer, { filename: FIXTURE });
  return root;
}

/** The offset of `needle`'s single occurrence in `source`, or a failure. */
function only(source: string, needle: string): number {
  const at = source.indexOf(needle);
  expect(at, `"${needle}" appears in the fixture`).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(needle, at + 1), `"${needle}" appears only once`).toBe(-1);
  return at;
}

// One open document. The change is stated the way VS Code states it — the offset of the replaced
// range in the text BEFORE the change, and the text that replaced it — because that is all the
// provider is given and all planEntrySync is allowed to use.
function open() {
  const doc = { text };
  // The tree the provider holds for the text as it stands (vscode: the model kept in step by the
  // applied plans, which its suite holds equal to this re-parse).
  const model = () => parse(doc.text);

  /**
   * Type into the text view: splice `replacement` over [offset, offset+length) and plan the change.
   * Returns the plan (the entry it names and its row id on screen, the record), or null for "repaint
   * wide".
   */
  const type = (offset: number, length: number, replacement: string) => {
    const live = model();
    doc.text = doc.text.slice(0, offset) + replacement + doc.text.slice(offset + length);
    const plan = planEntrySync(live, doc.text, { rangeOffset: offset, text: replacement });
    if (!plan) return null;
    return { rowIdOnScreen: plan.entry.id as string, entry: plan.entry, record: plan.record as Any, live };
  };

  /** A change the host RECOGNISES, planned from the change's own text against the edits remembered. */
  const known = (change: RangeReplacement, ring: readonly KnownEdit[]) => {
    const live = model();
    doc.text = doc.text.slice(0, change.rangeOffset) + change.text + doc.text.slice(change.rangeOffset + change.rangeLength);
    const plan = planKnownChange(live, [change], ring);
    if (!plan) return null;
    return { rowIdOnScreen: plan.entry.id as string, entry: plan.entry, record: plan.record as Any, live };
  };

  /** What the host wrote over one entry, and what it wrote over. Applies the edit to the text. */
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

  const entryNamed = (name: string) => (model().children as Any[]).flatMap((s: Any) => s.children).find((e: Any) => e.name === name);
  return { doc, model, type, known, hostWrote, entryNamed };
}

// ---------------------------------------------------------------------------------------
// The scanner: two facts about the text, and nothing else.
// ---------------------------------------------------------------------------------------
describe('jsonEntryScan — finding one entry without parsing', () => {
  const arrayStart = findEntriesArrayStart(text);

  it('anchors on the entries array through the part path', () => {
    expect(arrayStart).toBeGreaterThan(0);
    expect(text[arrayStart]).toBe('[');
    expect(arrayStart).toBe(only(text, '"entries": ['.slice(0, -1)) + '"entries": '.length);
  });

  it('refuses text that does not spell the path', () => {
    expect(findEntriesArrayStart('{}')).toBe(-1);
    expect(findEntriesArrayStart('{"__MW_TEXT_PARTS__": "__MW_TEXT_PART__/data/chunk0"}')).toBe(-1);
    expect(
      findEntriesArrayStart('{"__MW_TEXT_PARTS__": {"__MW_TEXT_PART__/data/chunk0": {"__MW_TEXT_content": {"entries": {}}}}}'),
    ).toBe(-1);
  });

  it('finds the same span as the parse tree, for every entry in the fixture', () => {
    const names = [...text.matchAll(/^ {12}"name": "([^"]+)"/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(15);
    for (const name of names) {
      const span = findEntrySpan(text, name)!;
      expect(span, `parse tree finds "${name}"`).not.toBeNull();
      const scan = scanEntries(text, arrayStart, { start: span.offset + 1, end: span.offset + 1 });
      expect(scan, `the scan walks the array for "${name}"`).not.toBeNull();
      expect(scan!.hit, `the scan lands in "${name}"`).not.toBeNull();
      expect({ offset: scan!.hit!.offset, length: scan!.hit!.length }).toEqual(span);
      expect(scan!.count).toBe(names.length);
    }
  });

  it('counts the elements a value’s braces and brackets sit inside', () => {
    expect(text).toContain('[1]\\n[2]');
    const scan = scanEntries(text, arrayStart, { start: 0, end: 0 })!;
    expect(scan.hit).toBeNull();
    expect(scan.count).toBe([...text.matchAll(/^ {12}"name": "/gm)].length);

    const tricky =
      '{"__MW_TEXT_PARTS__":{"__MW_TEXT_PART__/data/chunk0":{"__MW_TEXT_content":{"entries":[' +
      '{"name":"A","value":"} ] not structure"},' +
      '{"name":"B","value":"a quote \\" then }"},' +
      '{"name":"C","value":"[[["},' +
      '{"name":"D","value":"ends with \\\\"}' +
      ']}}}}';
    expect(JSON.parse(tricky), 'the tricky document is valid JSON').toBeTruthy();
    const start = findEntriesArrayStart(tricky);
    expect(start).toBeGreaterThan(0);
    expect(scanEntries(tricky, start, { start: 0, end: 0 })!.count).toBe(4);
  });

  it('refuses a change that only touches an element’s edge', () => {
    const first = findEntrySpan(text, 'Array')!;
    const edge = first.offset + first.length;
    expect(scanEntries(text, arrayStart, { start: edge, end: edge })!.hit).toBeNull();
    expect(scanEntries(text, arrayStart, { start: first.offset, end: first.offset })!.hit).toBeNull();
    expect(scanEntries(text, arrayStart, { start: first.offset, end: edge })!.hit).toEqual({
      offset: first.offset,
      length: first.length,
      index: 0,
      name: 'Array',
    });
  });

  it('refuses text it cannot walk to the end of the array', () => {
    const truncated = text.slice(0, text.length / 2);
    expect(locateChangedEntry(truncated, { start: 400, end: 400 })).toBeNull();
    const broken = text.replace('"name": "Number"', '"name": "Number');
    expect(locateChangedEntry(broken, { start: 400, end: 400 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// The sync: one text change, one entry op. (The repaint it makes, narrow === wide, is vscode's.)
// ---------------------------------------------------------------------------------------
describe('JSON .sldd narrow text sync — the plan', () => {
  it('plans one entry for a value typed in the text view', () => {
    const d = open();
    const at = only(d.doc.text, '"value": 1\n');
    const op = d.type(at + '"value": '.length, 1, '42');
    expect(op, 'a value typed inside one entry is one entry op').not.toBeNull();
    expect(op!.rowIdOnScreen).toBe(op!.entry.id);
    expect(op!.record.value).toBe(42);
  });

  it('plans one entry for a nested field typed in the text view', () => {
    const d = open();
    const struct = only(d.doc.text, '"name": "NestedStruct"');
    const at = d.doc.text.indexOf('"field2": 4', struct);
    expect(at).toBeGreaterThan(struct);
    const op = d.type(at + '"field2": '.length, 1, '7');
    expect(op).not.toBeNull();
    expect(op!.entry.name).toBe('NestedStruct');
  });

  it('addresses the PRE-rename row id when a name is typed over', () => {
    const d = open();
    const at = only(d.doc.text, '"name": "Number"');
    const op = d.type(at + '"name": "'.length, 'Number'.length, 'Numeral');
    expect(op, 'a rename resolves through the uuid the text still spells').not.toBeNull();
    // The rows on screen carry the OLD id; the record the entry is rebuilt from, the new name.
    expect(op!.rowIdOnScreen).toContain('/Number');
    expect(op!.record.name).toBe('Numeral');
  });

  it('plans the same entry for a whole-element replace — a table cell edit', () => {
    const d = open();
    const span = findEntrySpan(d.doc.text, 'PI')!;
    const element = d.doc.text.slice(span.offset, span.offset + span.length);
    const op = d.type(span.offset, span.length, element.replace('3.141592653589793', '3.14'));
    expect(op, 'replacing one element is one entry op').not.toBeNull();
    expect(op!.entry.name).toBe('PI');
    expect(op!.record.value).toBe(3.14);
  });

  it('names the one entry the change is in, of the tree it was given', () => {
    const d = open();
    const at = only(d.doc.text, '"value": 1\n');
    const op = d.type(at + '"value": '.length, 1, '9')!;
    const entries = (op.live.children as Any[]).flatMap((s: Any) => s.children);
    expect(entries.filter((e: Any) => e === op.entry)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------
// An undo or a redo of an edit the host itself wrote.
// ---------------------------------------------------------------------------------------
describe('JSON .sldd narrow text sync — undo and redo of the host’s own edit', () => {
  const undoOf = (known: KnownEdit): RangeReplacement => ({
    rangeOffset: known.submitted.rangeOffset,
    rangeLength: known.submitted.text.length,
    text: known.replaced,
  });

  it('plans an undo from the bytes it wrote over', () => {
    const d = open();
    const written = d.hostWrote('PI', (el) => el.replace('3.141592653589793', '3.14'));
    const op = d.known(undoOf(written), [written]);
    expect(op, 'an undo of a remembered edit is one entry op').not.toBeNull();
    // Back to the value the file opened with.
    expect(op!.record.value).toBe(3.141592653589793);
  });

  it('plans a redo — the same edit, forwards', () => {
    const d = open();
    const written = d.hostWrote('PI', (el) => el.replace('3.141592653589793', '3.14'));
    expect(d.known(undoOf(written), [written])).not.toBeNull();
    const op = d.known(written.submitted, [written]);
    expect(op, 'a redo of a remembered edit is one entry op').not.toBeNull();
    expect(op!.record.value).toBe(3.14);
  });

  it('resolves an undone rename through the uuid, not the name', () => {
    const d = open();
    const written = d.hostWrote('Number', (el) => el.replace('"name": "Number"', '"name": "Numeral"'));
    const op = d.known(undoOf(written), [written]);
    expect(op, 'the entry still answers to the uuid the undone text spells').not.toBeNull();
    expect(op!.rowIdOnScreen, 'the rows on screen carry the renamed id').toContain('/Numeral');
    expect(op!.record.name, 'and the entry is rebuilt with the name that came back').toBe('Number');
  });

  it('recognises an older edit in the ring — two edits, undone in reverse', () => {
    const d = open();
    const first = d.hostWrote('Number', (el) => el.replace('"value": 1', '"value": 11'));
    const second = d.hostWrote('PI', (el) => el.replace('3.141592653589793', '3.14'));
    const ring = [first, second];
    expect(d.known(undoOf(second), ring), 'the newest edit comes back first').not.toBeNull();
    const op = d.known(undoOf(first), ring);
    expect(op, 'and then the one before it').not.toBeNull();
    expect(op!.record.value).toBe(1);
  });

  it('refuses a change at an offset the remembered edit does not name', () => {
    const d = open();
    const written = d.hostWrote('PI', (el) => el.replace('3.141592653589793', '3.14'));
    const shifted = { ...undoOf(written), rangeOffset: written.submitted.rangeOffset + 1 };
    expect(d.known(shifted, [written])).toBeNull();
  });

  it('refuses a change that is neither direction of a remembered edit', () => {
    const d = open();
    const written = d.hostWrote('PI', (el) => el.replace('3.141592653589793', '3.14'));
    const typed: RangeReplacement = {
      rangeOffset: written.submitted.rangeOffset,
      rangeLength: written.submitted.text.length,
      text: written.submitted.text.replace('3.14', '2.72'),
    };
    expect(d.known(typed, [written])).toBeNull();
    expect(d.known(undoOf(written), []), 'and nothing is recognised against an empty ring').toBeNull();
  });

  it('refuses a batch, whose offsets are stated against the text before it', () => {
    const d = open();
    const written = d.hostWrote('PI', (el) => el.replace('3.141592653589793', '3.14'));
    const undo = undoOf(written);
    expect(planKnownChange(d.model(), [undo, undo], [written])).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// An entry the file spells without a uuid.
// ---------------------------------------------------------------------------------------
describe('JSON .sldd narrow text sync — an entry with no uuid', () => {
  const rewriteElement = (d: ReturnType<typeof open>, name: string, element: string) => {
    const span = findEntrySpan(d.doc.text, name);
    expect(span, `${name} has a span in the text`).not.toBeNull();
    d.doc.text = d.doc.text.slice(0, span!.offset) + element + d.doc.text.slice(span!.offset + span!.length);
  };

  it('resolves an entry that declares no metadata at all by its name', () => {
    const d = open();
    rewriteElement(d, 'Number', '{"name": "Number", "value": 1}');
    expect(d.entryNamed('Number').metadata, 'the tree holds it with no metadata').toBeFalsy();
    const at = only(d.doc.text, '{"name": "Number", "value": 1}');
    const op = d.type(at + '{"name": "Number", "value": '.length, 1, '11');
    expect(op, 'the name is the fallback when the text spells no uuid').not.toBeNull();
    expect(op!.record.value).toBe(11);
  });

  it('refuses an entry with no uuid whose name a second entry also answers to', () => {
    const d = open();
    const namespace = /"namespace": "([^"]+)"/.exec(text)![1];
    rewriteElement(d, 'PI', `{"name": "Number", "metadata": {"namespace": "${namespace}", "isderived": "1"}, "value": 2.72}`);
    const twins = (d.model().children as Any[]).flatMap((s: Any) => s.children).filter((e: Any) => e.name === 'Number');
    expect(twins, 'the tree really holds two entries answering to "Number"').toHaveLength(2);
    expect(new Set(twins.map((e: Any) => e.parent.name)).size, 'in two different sections').toBe(2);
    const at = only(d.doc.text, '"isderived": "1"}, "value": 2.72');
    expect(
      d.type(at + '"isderived": "1"}, "value": '.length, '2.72'.length, '3.14'),
      'an ambiguous name is no answer: the fast path is refused',
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// Everything the narrow path refuses.
// ---------------------------------------------------------------------------------------
describe('JSON .sldd narrow text sync — what it refuses', () => {
  it('refuses a change outside every entry', () => {
    const d = open();
    const at = only(d.doc.text, '"release": "R2026b"');
    expect(d.type(at + '"release": "'.length, 'R2026b'.length, 'R2027a')).toBeNull();
  });

  it('refuses a structural change to the entries array', () => {
    const d = open();
    const span = findEntrySpan(d.doc.text, 'Number')!;
    const next = findEntrySpan(d.doc.text, 'PI')!;
    expect(d.type(span.offset, next.offset - span.offset, '')).toBeNull();
  });

  it('refuses an element count that no longer matches the model', () => {
    const span = findEntrySpan(text, 'Number')!;
    const next = findEntrySpan(text, 'PI')!;
    const shorter = text.slice(0, span.offset) + text.slice(next.offset);
    const model = parse(shorter);
    const at = only(text, '"value": 3.141592653589793');
    expect(planEntrySync(model, text, { rangeOffset: at + '"value": '.length, text: '3.14' })).toBeNull();
  });

  it('refuses a change that would move the entry to another section', () => {
    const d = open();
    const number = only(d.doc.text, '"name": "Number"');
    const at = d.doc.text.indexOf('"isderived": "0"', number);
    expect(at).toBeGreaterThan(number);
    expect(d.type(at + '"isderived": "'.length, 1, '1')).toBeNull();
  });

  it('refuses a half-typed element', () => {
    const d = open();
    const at = only(d.doc.text, '"value": 1\n');
    const number = only(d.doc.text, '"name": "Number"');
    const closing = d.doc.text.indexOf('},', number);
    expect(closing).toBeGreaterThan(number);
    expect(d.type(closing + 1, 1, '')).toBeNull();
    expect(at).toBeGreaterThan(0);
  });

  it('refuses metadata whose isderived has stopped being a string', () => {
    const d = open();
    const number = only(d.doc.text, '"name": "Number"');
    const at = d.doc.text.indexOf('"isderived": "0"', number);
    expect(at).toBeGreaterThan(number);
    expect(
      d.type(at + '"isderived": '.length, '"0"'.length, '0'),
      'a metadata value that is not a string counts as absent, and absent is not "0"',
    ).toBeNull();
  });

  it('refuses an element whose name has been emptied', () => {
    const d = open();
    const at = only(d.doc.text, '"name": "Number"');
    expect(d.type(at + '"name": "'.length, 'Number'.length, ''), 'an empty name is refused, not accepted as the entry’s new one').toBeNull();
  });

  it('refuses an element that no longer declares a name', () => {
    const d = open();
    const line = '            "name": "PI",\n';
    const at = only(d.doc.text, line);
    expect(d.type(at, line.length, ''), 'a record that names no entry is refused, whatever its uuid resolves to').toBeNull();
  });

  it('refuses an entry it cannot tell apart from another', () => {
    const d = open();
    const number = only(d.doc.text, '"name": "Number"');
    const uuidAt = d.doc.text.indexOf('"uuid": "', number) + '"uuid": "'.length;
    const uuid = d.doc.text.slice(uuidAt, d.doc.text.indexOf('"', uuidAt));
    const pi = only(d.doc.text, '"name": "PI"');
    const piUuidAt = d.doc.text.indexOf('"uuid": "', pi) + '"uuid": "'.length;
    // Give PI the same uuid as Number, so the model holds both, then edit PI.
    d.doc.text = d.doc.text.slice(0, piUuidAt) + uuid + d.doc.text.slice(piUuidAt + uuid.length);
    const at = only(d.doc.text, '"value": 3.141592653589793');
    expect(d.type(at + '"value": '.length, '3.141592653589793'.length, '3.14')).toBeNull();
  });
});
