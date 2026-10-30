// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/jsonViewRereadAsRead.test.ts at c73da3c (the cases C2
// deferred): a replace op from the document text re-reads the entry as the file's read does, and
// a record that is not the document text is still refused. What changed in setup: the dictionary is
// read by a core session (createSession + ingest) where vscode used view's getModel and the global
// DataModel, and entryOps' applyEntryOps is given that session.
//
// A text dictionary can hold a value no writer would take from anywhere else: dims holding the
// infinity that JSON.parse makes of a hand-typed 1e400. core's `parseEntry(record, systemComposer,
// { asRead: true })` says the record is the file's own text; the ops built from the document's text
// say so (`fromDocumentText`), and only they.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { applyEntryOps, insertOp, replaceOp, type EntryOp } from '../src/edit/entryOps.js';
import { findEntrySpan } from '../src/edit/entrySplice.js';

type Any = any;

const FIXTURE = 'numeric_json.sldd';
const NAME = 'hugeExtent';
const VALUE =
  '{"_array_type": "Struct", "_dimensions": [1, 1], "_elements": [{"f": {"_array_type": "Cell", "_dimensions": [1e400, 0], "_elements": []}, "g": 1}], "_fields": ["f", "g"]}';
const REFUSAL = `Cannot write "${NAME}": ${NAME}.f is a cell declaring dimensions [Infinity,0], a size that is not a count`;

/** The fixture with the entry added as hand-typed text, its metadata the fixture's own in full. */
function dictionaryText(): string {
  // vscode's test/fixtures/numeric_json.sldd, byte for byte.
  const json = JSON.parse(readFileSync('test/fixtures/numeric_json.sldd', 'utf8'));
  const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  const metadata = { ...entries[0].metadata, uuid: '00000000-0000-4000-8000-00000000f122' };
  expect(Object.keys(metadata)).toEqual(['uuid', 'namespace', 'lastmod', 'modifiedby', 'isderived']);
  entries.push({ name: NAME, metadata, value: '@@VALUE@@' });
  return JSON.stringify(json, null, 2).replace('"@@VALUE@@"', VALUE);
}

/** The dictionary opened as the JSON provider opens it, and the element text of the entry. */
function open() {
  const text = dictionaryText();
  const session = createSession();
  const model: Any = ingest(session, new TextEncoder().encode(text).buffer as ArrayBuffer, { filename: FIXTURE });
  const entry = () => (model.children as Any[]).flatMap((s: Any) => s.children).find((e: Any) => e.name === NAME);
  const span = findEntrySpan(text, NAME);
  expect(span, 'the entry has a span in the text').not.toBeNull();
  const element = text.slice(span!.offset, span!.offset + span!.length);
  expect(element, 'the element text holds the hand-typed extent').toContain('1e400');
  return { session, model, text, entry, span: span!, element };
}

/** What serialize() makes of an entry, or the refusal it throws. */
function copyOf(entry: Any): unknown {
  try {
    return entry.serialize();
  } catch (err: Any) {
    return { thrown: err?.name, reason: err?.reason, message: String(err?.message) };
  }
}

describe('applyEntryOps: a replace from the document text re-reads as the file read', () => {
  it('rebuilds the entry so its copy is the file read’s, and a later edit of it serializes', () => {
    const d = open();
    const asOpened = copyOf(d.entry());
    expect(asOpened).toMatchObject({ name: NAME });
    expect(JSON.stringify((asOpened as Any).value)).toContain('"_dimensions":[null,0]');

    const op: EntryOp = { kind: 'replace', rowId: d.entry().id, record: JSON.parse(d.element), fromDocumentText: true };
    const [applied] = applyEntryOps(d.model, [op], d.session);
    const fresh = (applied as Any).entry;
    expect(fresh).toBe(d.entry());
    expect(copyOf(fresh)).toEqual(asOpened);

    // A table edit after it: the field next to the extent.
    const g = (fresh.children as Any[]).find((c: Any) => c.name === 'g');
    expect(g?.setProperty('Value', '2')).toBe(true);
    const edited = copyOf(fresh) as Any;
    expect(edited.thrown).toBeUndefined();
    expect(JSON.stringify(edited.value)).toContain('"g":2');
  });
});

describe('control: a record that is not the document text is still refused', () => {
  it('a replace that does not say so (an undo or redo record) and an insert (a paste’s redo) refuse it', () => {
    const refused = { thrown: 'MatBudgetError', reason: 'not-a-count' };

    const replaced = open();
    const [r] = applyEntryOps(replaced.model, [{ kind: 'replace', rowId: replaced.entry().id, record: JSON.parse(replaced.element) }], replaced.session);
    const rCopy = copyOf((r as Any).entry) as Any;
    expect(rCopy).toMatchObject(refused);
    expect(rCopy.message).toContain(REFUSAL);

    const inserted = open();
    const live = inserted.entry();
    const section = live.parent;
    const record = JSON.parse(inserted.element);
    record.name = `${NAME}Pasted`;
    record.metadata = { ...record.metadata, uuid: '00000000-0000-4000-8000-00000000f123' };
    const [i] = applyEntryOps(inserted.model, [{ kind: 'insert', sectionName: section.name, index: -1, record }], inserted.session);
    const iCopy = copyOf((i as Any).entry) as Any;
    expect(iCopy).toMatchObject(refused);
    expect(iCopy.message).toContain(`Cannot write "${NAME}Pasted": ${NAME}Pasted.f is a cell`);
  });

  it('the ops an undo stack keeps for a live entry do not say so', () => {
    const d = open();
    const live = d.entry();
    expect(replaceOp(live, live.id)).not.toHaveProperty('fromDocumentText');
    expect(insertOp(live)).not.toHaveProperty('fromDocumentText');
  });
});
