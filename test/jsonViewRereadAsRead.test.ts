// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/jsonViewRereadAsRead.test.ts at c73da3c: its planner half,
// "the plans built from the document text say so" (jsonEntrySync, as core copied it). What changed
// in setup: the dictionary is read by a core session (createSession + ingest) where vscode's test
// used view's getModel. Its other two describes apply the ops (entryOps.applyEntryOps, insertOp,
// replaceOp: core step 6a C3) and stay in vscode until then.
//
// An entry the JSON view re-reads from the document's own text is read as the file's read reads it
// (mathworks/data-explorer-core#140, F1-22): core's `parseEntry(record, systemComposer, { asRead:
// true })` says the record is the file's own text, and the ops built from the document's text say
// so (`fromDocumentText`), and only they.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { planEntrySync, planKnownChange, planOwnEdit, type HostEdit, type KnownEdit } from '../src/edit/jsonEntrySync.js';
import { findEntrySpan } from '../src/edit/entrySplice.js';

type Any = any;

const FIXTURE = 'numeric_json.sldd';
const NAME = 'hugeExtent';
// A 1x1 struct whose field f is a cell declaring an extent of 1e400 rows, beside a plain field.
const VALUE =
  '{"_array_type": "Struct", "_dimensions": [1, 1], "_elements": [{"f": {"_array_type": "Cell", "_dimensions": [1e400, 0], "_elements": []}, "g": 1}], "_fields": ["f", "g"]}';

/** The fixture (vscode's test/fixtures/numeric_json.sldd, byte for byte) with the entry added as hand-typed text. */
function dictionaryText(): string {
  const json = JSON.parse(readFileSync(`test/fixtures/${FIXTURE}`, 'utf8'));
  const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  const metadata = { ...entries[0].metadata, uuid: '00000000-0000-4000-8000-00000000f122' };
  expect(Object.keys(metadata)).toEqual(['uuid', 'namespace', 'lastmod', 'modifiedby', 'isderived']);
  entries.push({ name: NAME, metadata, value: '@@VALUE@@' });
  return JSON.stringify(json, null, 2).replace('"@@VALUE@@"', VALUE);
}

/** The dictionary opened in a core session, and the element text of the entry. */
function open() {
  const text = dictionaryText();
  const model: Any = ingest(createSession(), new TextEncoder().encode(text).buffer as ArrayBuffer, { filename: FIXTURE });
  const entry = () => (model.children as Any[]).flatMap((s: Any) => s.children).find((e: Any) => e.name === NAME);
  const span = findEntrySpan(text, NAME);
  expect(span, 'the entry has a span in the text').not.toBeNull();
  const element = text.slice(span!.offset, span!.offset + span!.length);
  expect(element, 'the element text holds the hand-typed extent').toContain('1e400');
  return { model, text, entry, span: span!, element };
}

describe('the plans built from the document text say so', () => {
  it('planOwnEdit: the echo of the host’s own edit is the document’s text', () => {
    const d = open();
    const live = d.entry();
    const hint: HostEdit = {
      entryId: live.id,
      submitted: { rangeOffset: d.span.offset, rangeLength: d.span.length, text: d.element },
      epoch: 0,
    };
    const plan = planOwnEdit([hint.submitted], hint);
    expect(plan).not.toBeNull();
    expect(plan!.op).toMatchObject({ kind: 'replace', rowId: live.id, fromDocumentText: true });
  });

  it('planEntrySync and planKnownChange: an element read out of the document is its text', () => {
    const d = open();
    const at = d.text.indexOf('1e400');
    const edited = d.text.slice(0, at) + ' ' + d.text.slice(at);
    const scanned = planEntrySync(d.model, edited, { rangeOffset: at, text: ' ' });
    expect(scanned).not.toBeNull();
    expect(scanned!.entry).toBe(d.entry());
    expect(scanned!.fromDocumentText).toBe(true);

    const rewritten = d.element.replace('1e400', ' 1e400');
    const known: KnownEdit = {
      submitted: { rangeOffset: d.span.offset, rangeLength: d.span.length, text: rewritten },
      replaced: d.element,
    };
    // The undo of that edit: the bytes it wrote over come back over it.
    const undo = { rangeOffset: d.span.offset, rangeLength: rewritten.length, text: d.element };
    const recognised = planKnownChange(d.model, [undo], [known]);
    expect(recognised).not.toBeNull();
    expect(recognised!.fromDocumentText).toBe(true);
  });
});
