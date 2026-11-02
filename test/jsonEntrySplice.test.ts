// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/entrySplice.test.ts at c73da3c: imports point at core's copy
// (src/edit/entrySplice.ts), and the fixture is core's test/fixtures/numeric_json.sldd, byte for byte
// vscode's test-integration/fixtures/workspace/data.sldd. Every assertion is vscode's. The last block,
// a JSON host's write of an edit held to core's save, is data-explorer-view's (see there).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  findEntrySpan,
  findEntryElementSpan,
  findEntriesArrayInsertion,
  detectIndent,
} from '../src/edit/entrySplice.js';
import {
  addChild,
  addChildToModel,
  applyTextPatch,
  deleteChild,
  findOwningEntry,
  removeChildFromModel,
  reserializeEntry,
} from '../src/edit/structuralEdit.js';
import { cellEdit, mutateEntry } from '../src/edit/entryOps.js';
import { entrySelectorOf } from '../src/datamodel/parser/entrySelector.js';
import { nodeAt, openEditBash, saved } from './tools/editBash.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fixturePath = fileURLToPath(new URL('./fixtures/numeric_json.sldd', import.meta.url));
const fixtureText = readFileSync(fixturePath, 'utf8');

describe('findEntrySpan', () => {
  it('finds a known entry and returns a tight object span', () => {
    const span = findEntrySpan(fixtureText, 'Array');
    expect(span).not.toBeNull();
    const slice = fixtureText.slice(span!.offset, span!.offset + span!.length);
    expect(slice.startsWith('{')).toBe(true);
    expect(slice.endsWith('}')).toBe(true);
    expect(slice).toContain('"name": "Array"');
    // Must not swallow the sibling "Array1" entry.
    expect(slice).not.toContain('"name": "Array1"');
  });

  it('returns null for a non-existent name', () => {
    expect(findEntrySpan(fixtureText, 'NoSuchEntry')).toBeNull();
  });
});

// All three finders share one tolerant walk down __MW_TEXT_PARTS__ → chunk0 →
// __MW_TEXT_content → entries, and they are handed the LIVE document text. The
// user can have that text open in a text view alongside the table, and VS Code
// reports every keystroke — so these helpers are routinely called on text that is
// mid-edit and not yet a well-formed .sldd. Each step must yield null (the
// callers turn that into "Could not locate…"), never throw: an exception here
// escapes as an unhandled rejection and the table stops responding to edits.
describe('parse walk on text that is not a well-formed .sldd', () => {
  it('returns null when the document root is not an object', () => {
    // A truncated or hand-replaced file can be a bare array or scalar.
    expect(findEntrySpan('[1, 2, 3]', 'X')).toBeNull();
    expect(findEntryElementSpan('"just a string"', 'X')).toBeNull();
    expect(findEntriesArrayInsertion('42')).toBeNull();
  });

  it('returns null for a property whose value has not been typed yet', () => {
    // `{ "__MW_TEXT_PARTS__" }` is what the text view holds the moment after the
    // key is typed and before the colon — jsonc-parser yields a property node
    // with a key and no value, which the walk must skip rather than deref.
    expect(findEntrySpan('{ "__MW_TEXT_PARTS__" }', 'X')).toBeNull();
    expect(findEntriesArrayInsertion('{ "__MW_TEXT_PARTS__" }')).toBeNull();
  });

  it('does not match an element whose "name" is not a string', () => {
    // A generated dictionary can carry a numeric name. Coercing it would let a
    // delete of the entry named "999" splice out an element the model never
    // pointed at, so a non-string name simply never matches.
    const text = wrap('[ { "name": 999 }, { "name": "real" } ]');
    expect(findEntrySpan(text, '999')).toBeNull();
    expect(findEntrySpan(text, 'real')).not.toBeNull();
  });
});

// Wrap an entries-array body in the nested .sldd structure the splice helpers
// walk (__MW_TEXT_PARTS__ → chunk0 → __MW_TEXT_content → entries).
function wrap(entriesBody: string): string {
  return [
    '{',
    '  "__MW_TEXT_PARTS__": {',
    '    "__MW_TEXT_PART__/data/chunk0": {',
    '      "__MW_TEXT_content": {',
    `        "entries": ${entriesBody}`,
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\n');
}

// Parse to the entry names present, to assert the array stays valid after edits.
function entryNames(text: string): string[] {
  const root = JSON.parse(text);
  const entries =
    root.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  return entries.map((e: { name: string }) => e.name);
}

describe('findEntryElementSpan', () => {
  it('returns null when the entries array is missing', () => {
    expect(findEntryElementSpan('{ "entries": "not the right shape" }', 'X')).toBeNull();
  });

  it('returns null for a name not present in the array', () => {
    const text = wrap('[ { "name": "A" }, { "name": "B" } ]');
    expect(findEntryElementSpan(text, 'Z')).toBeNull();
  });

  it('removing the only element leaves an empty (but valid) array', () => {
    const text = wrap('[ { "name": "solo" } ]');
    const span = findEntryElementSpan(text, 'solo')!;
    expect(span).not.toBeNull();
    const after = text.slice(0, span.offset) + text.slice(span.offset + span.length);
    expect(entryNames(after)).toEqual([]);
  });

  it('removing a middle element also removes the joining comma, keeping valid JSON', () => {
    const text = wrap('[ { "name": "A" }, { "name": "B" }, { "name": "C" } ]');
    const span = findEntryElementSpan(text, 'B')!;
    const after = text.slice(0, span.offset) + text.slice(span.offset + span.length);
    expect(entryNames(after)).toEqual(['A', 'C']);
  });

  it('removing the last element removes the PRECEDING comma, keeping valid JSON', () => {
    const text = wrap('[ { "name": "A" }, { "name": "B" } ]');
    const span = findEntryElementSpan(text, 'B')!;
    const after = text.slice(0, span.offset) + text.slice(span.offset + span.length);
    expect(entryNames(after)).toEqual(['A']);
  });

  it('removing the first of many removes the FOLLOWING comma, keeping valid JSON', () => {
    const text = wrap('[ { "name": "A" }, { "name": "B" } ]');
    const span = findEntryElementSpan(text, 'A')!;
    const after = text.slice(0, span.offset) + text.slice(span.offset + span.length);
    expect(entryNames(after)).toEqual(['B']);
  });

  it('locates a real entry in the multiline fixture and its removal stays valid', () => {
    const span = findEntryElementSpan(fixtureText, 'Array')!;
    expect(span).not.toBeNull();
    const after = fixtureText.slice(0, span.offset) + fixtureText.slice(span.offset + span.length);
    expect(entryNames(after)).not.toContain('Array');
    expect(entryNames(after)).toContain('Array1');
  });
});

describe('findEntriesArrayInsertion', () => {
  it('returns null when the entries array is missing', () => {
    expect(findEntriesArrayInsertion('{ "nope": 1 }')).toBeNull();
  });

  it('for a populated array, inserts after the last element and needs a leading comma', () => {
    const text = wrap('[\n          { "name": "A" }\n        ]');
    const ins = findEntriesArrayInsertion(text)!;
    expect(ins.needsLeadingComma).toBe(true);
    // The reported offset sits at the end of the last element's `}`.
    expect(text[ins.offset - 1]).toBe('}');
    // Splicing a comma-joined element in keeps the JSON valid.
    const added = text.slice(0, ins.offset) + ',\n' + ins.elementIndent + '{ "name": "B" }' + text.slice(ins.offset);
    expect(entryNames(added)).toEqual(['A', 'B']);
  });

  it('derives the element indent from the last element\'s line', () => {
    const text = wrap('[\n          { "name": "A" }\n        ]');
    const ins = findEntriesArrayInsertion(text)!;
    expect(ins.elementIndent).toBe('          '); // 10 spaces, matching the fixture depth
  });

  it('for an empty array, inserts just inside `[` with no leading comma', () => {
    const text = wrap('[]');
    const ins = findEntriesArrayInsertion(text)!;
    expect(ins.needsLeadingComma).toBe(false);
    const added = text.slice(0, ins.offset) + '\n' + ins.elementIndent + '{ "name": "first" }\n' + text.slice(ins.offset);
    expect(entryNames(added)).toEqual(['first']);
  });

  it('appending to the real fixture keeps the array valid and preserves existing entries', () => {
    const ins = findEntriesArrayInsertion(fixtureText)!;
    const before = entryNames(fixtureText);
    const added =
      fixtureText.slice(0, ins.offset) +
      ',\n' + ins.elementIndent + '{ "name": "Appended", "metadata": {}, "value": 1 }' +
      fixtureText.slice(ins.offset);
    expect(entryNames(added)).toEqual([...before, 'Appended']);
  });
});

describe('detectIndent', () => {
  it('returns two spaces for the 2-space-indented fixture', () => {
    expect(detectIndent(fixtureText)).toBe('  ');
  });

  it('returns a tab for a tab-indented JSON string', () => {
    const tabbed = '{\n\t"a": 1,\n\t"b": 2\n}';
    expect(detectIndent(tabbed)).toBe('\t');
  });

  it('falls back to two spaces for single-line JSON with no indent', () => {
    expect(detectIndent('{"a":1}')).toBe('  ');
  });
});

// ------------------------------------------------- a JSON host's write of an edit ---
//
// Ported from data-explorer-view test/editors/dictionaryEditorSaves.test.ts at ce62a24 ("JSON .sldd:
// the saved TextDocument is the text core writes"), which drove view's JSON engine; this drives the
// core calls that engine makes, in its order. A JSON host does not save through serializeSource: it
// writes the edited entry's text into the document itself, reserializeEntry's text over the span
// findEntrySpan finds for the entry's selector as read BEFORE the edit (a rename changes it), and an
// Add or a Delete inside an entry through addChild / deleteChild, which splice the same way. So the
// text it writes is held here to serializeSource's text after the same model edit, on a read of its
// own, but for each entry's lastmod (the clock of the edit), for edits at every depth of the
// edit-bash R2027a text dictionary: a field, an element of a struct array, a cell inside cells, a
// member of a Parameter's struct Value, a Bus element; values, a property, renames, an Add and a
// Delete. The two numbers past 2^63 are there for the writer: a double JSON.stringify spells as an
// integer literal is a dictionary MATLAB cannot open, so the two writers have to spell them alike.

/** An edit at the node whose matlabPath is `path`: `key` is the column a value/prop edit names. */
interface Edit {
  path: string;
  op: 'value' | 'prop' | 'name' | 'add' | 'delete';
  key?: string;
  text?: string;
}

const EDITS: Edit[] = [
  { path: 'dRow(1)', op: 'value', key: 'Value', text: '7' },
  { path: 'strRow(1)', op: 'value', key: 'Value', text: '"abc"' },
  { path: 'sLeaves.dScalar', op: 'value', key: 'Value', text: '[1;2;3]' },
  { path: 'sArr(1).a', op: 'value', key: 'Value', text: '+5' },
  { path: 'cLeaves{1}', op: 'value', key: 'Value', text: '[1 2 3]' },
  { path: 'sNest.c{2}.s.f', op: 'value', key: 'Value', text: '0' },
  { path: 'cNest{1}{2}{1}', op: 'value', key: 'Value', text: '[1 2; 3 4]' },
  { path: 'pStruct.Value.a', op: 'value', key: 'Value', text: '-3.25' },
  { path: 'pStruct.Value.inner.x', op: 'value', key: 'Value', text: '.5' },
  { path: 'pStructArr.Value(1).a', op: 'value', key: 'Value', text: '-0' },
  { path: 'pInt8.Value(1)', op: 'value', key: 'Value', text: 'NaN' },
  { path: 'sHoldsParam.p', op: 'prop', key: 'Min', text: '0' },
  { path: 'bus.e1', op: 'prop', key: 'complexity', text: 'complex' },
  { path: 'sNest.c{2}.s', op: 'name', text: 'zz_new' },
  { path: 'pStruct.Value.inner.x', op: 'name', text: 'zz_new' },
  { path: 'sLeaves.dRow', op: 'add' },
  { path: 'saCell(2).c{1}', op: 'add' },
  { path: 'pStruct.Value.inner.y', op: 'add' },
  { path: 'cNest{1}{2}{1}', op: 'delete' },
  { path: 'pStruct.Value.b(1)', op: 'delete' },
  { path: 'sArr(2).b', op: 'value', key: 'Value', text: '18446744073709551615' },
  { path: 'cNest{1}{2}{2}', op: 'value', key: 'Value', text: '-9223372036854775808' },
  { path: 'cLeaves{9}', op: 'value', key: 'Value', text: '{[1 2], true}' },
];

const EDIT_BASH_TEXT = readFileSync(fileURLToPath(new URL('./fixtures/edit-bash/r2027a/values_text.sldd', import.meta.url)), 'utf8');
const columnOf = (edit: Edit): string => (edit.op === 'name' ? 'Name' : (edit.key ?? 'Value'));
const labelOf = (e: Edit) => `${e.op} ${e.path}${e.key && e.op === 'prop' ? '.' + e.key : ''}${e.text !== undefined ? ' = ' + e.text : ''}`;
// When an entry was last modified is the edit's clock, not the edit.
const withoutClock = (text: string) => text.replace(/("lastmod": ?")[^"]*"/g, '$1<T>"');

/** The edit-bash text dictionary, read, and its node at `edit.path` with the entry that owns it. */
function openAt(edit: Edit): { o: ReturnType<typeof openEditBash>; node: any; entry: any } {
  const o = openEditBash('json');
  const node = nodeAt(o, edit.path);
  if (!node) throw new Error(`no node at ${edit.path}`);
  return { o, node, entry: findOwningEntry(node) };
}

/** The document text a JSON host writes for `edit`. */
function hostWrite(edit: Edit): string {
  const text = EDIT_BASH_TEXT;
  const { o, node, entry } = openAt(edit);
  if (edit.op === 'add' || edit.op === 'delete') {
    const transform = edit.op === 'add' ? addChild : deleteChild;
    return mutateEntry(entry, () => transform(text, node), o.session).newText;
  }
  const selector = entrySelectorOf(entry);
  const { result, unchanged } = cellEdit(entry, node, columnOf(edit), edit.text ?? '', o.session);
  if (result !== true || unchanged) throw new Error(`the edit was not made (${JSON.stringify(result)})`);
  const span = findEntrySpan(text, selector);
  if (!span) throw new Error(`no span for ${entry.name}`);
  return applyTextPatch(text, { offset: span.offset, length: span.length, text: reserializeEntry(entry, detectIndent(text)) });
}

/** serializeSource's text after the same model edit, on a read of its own. */
function coreSave(edit: Edit): string {
  const { o, node, entry } = openAt(edit);
  if (edit.op === 'add') o.session.mutateSubtree(entry, () => addChildToModel(node));
  else if (edit.op === 'delete') o.session.mutateSubtree(entry, () => removeChildFromModel(node));
  else {
    const result = o.session.mutateSubtree(entry, () => node.setProperty(columnOf(edit), edit.text ?? ''));
    if (result !== true) throw new Error(`core refused ${edit.path}: ${JSON.stringify(result)}`);
  }
  return new TextDecoder().decode(saved(o));
}

describe("a JSON host's entry splice is core's save", () => {
  it(`writes the text serializeSource writes, but for lastmod, for ${EDITS.length} edits at every depth of values_text.sldd`, () => {
    const wrong: string[] = [];
    for (const [i, edit] of EDITS.entries()) {
      let written: string;
      try {
        written = hostWrite(edit);
      } catch (err) {
        wrong.push(`${labelOf(edit)}: the host's write threw (${(err as Error).message})`);
        continue;
      }
      if (withoutClock(written) === withoutClock(EDIT_BASH_TEXT)) wrong.push(`${labelOf(edit)}: the host's write changed nothing`);
      if (withoutClock(written) !== withoutClock(coreSave(edit))) wrong.push(`${labelOf(edit)}: the host's write is not core's save`);
      // The comparison can fail: core's save of another value is another text.
      if (i === 0) {
        expect(withoutClock(written), 'a save of 8 is told from a write of 7').not.toBe(withoutClock(coreSave({ ...edit, text: '8' })));
      }
    }
    expect(wrong).toEqual([]);
  });
});
