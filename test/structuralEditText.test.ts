// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/structuralEdit.test.ts at c73da3c: its text-half cases, held to
// core's copy of structuralEdit's text half (src/edit/structuralEdit.ts). Setup changed only: a model is
// a fresh core session over the text (createSession + ingest) instead of view's getModel/invalidate, a
// row is found among the session's nodes by name instead of through view's buildRows/findNode, and
// entryOps.mutateEntry is the session's mutateSubtree (which it calls). The fixture is the same bytes:
// vscode's test-integration/fixtures/workspace/data.sldd is core's test/fixtures/numeric_json.sldd.
//
// Not ported here: the paste-rule cases (pasteEntry's refusals, the classless gate, cloneForPaste,
// refuseDisallowedPaste), which test/dictionaryPasteRules.test.ts holds; and "a dictionary transfer
// target" (sectionTarget), which stays with the host.
//
// Pure-transform coverage for structural edits (delete / add-child / paste),
// mirroring editWriteback.test.ts: drive the real modules (SlddModel, node
// mutation, entrySplice) against the real fixture, asserting valid JSON,
// semantic round-trip, and — critically — that untouched sibling entries stay
// byte-identical.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { findEntrySpan } from '../src/edit/entrySplice.js';
import { addChild, deleteChild, deleteChildren, deleteEntry, pasteEntry } from '../src/edit/structuralEdit.js';

// What the caller passes deleteEntry for a section header's row id: data-explorer-view's
// buildSectionRowId, as vscode's structuralEdit used it (core knows no row ids).
const sectionRowId = (name: string): string => `section:${name}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const fixtureText = readFileSync('test/fixtures/numeric_json.sldd', 'utf8');
const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

// A fresh session over `text`, as view's getModel(uri, 'data.sldd', text) after invalidate(uri).
function opened(text: string, filename = 'data.sldd'): { session: Any; root: Any } {
  const session: Any = createSession();
  const root: Any = ingest(session, ab(new TextEncoder().encode(text)), { filename });
  return { session, root };
}
const freshModel = (text = fixtureText): Any => opened(text).root;
// The rows a table draws (view's buildRows, section headers aside), in document order.
const rowsOf = (model: Any): Any[] => (model.flatten() as Any[]).filter((n) => !n.isContainer);
// The first row of that name: what buildRows(model).find(r => r.Name.label === name) then findNode gives.
const rowNamed = (model: Any, name: string): Any => rowsOf(model).find((n) => n.name === name);

function rowNames(text: string): string[] {
  return rowsOf(freshModel(text)).map((n) => n.name);
}

function isValidJson(text: string): boolean {
  try { JSON.parse(text); return true; } catch { return false; }
}

// Byte-identity of a sibling entry's span across the edit.
function siblingByteIdentical(oldText: string, newText: string, name: string): boolean {
  const a = findEntrySpan(oldText, name);
  const b = findEntrySpan(newText, name);
  if (!a || !b) return false;
  return oldText.slice(a.offset, a.offset + a.length) === newText.slice(b.offset, b.offset + b.length);
}

describe('deleteEntry', () => {
  it('removes a top-level entry, keeps valid JSON, siblings byte-identical', () => {
    const model = freshModel();
    const entry = rowNamed(model, 'Number');

    const { newText, selectId } = deleteEntry(fixtureText, entry, sectionRowId);
    expect(isValidJson(newText)).toBe(true);
    expect(findEntrySpan(newText, 'Number')).toBeNull();
    // A different entry is unchanged byte-for-byte.
    expect(siblingByteIdentical(fixtureText, newText, 'PI')).toBe(true);
    // Reselects a neighbor (some other entry), not the deleted one.
    expect(selectId).not.toContain('Number');
  });
});

// The fixture's "Struct" entry is a StructNode with 2 children, canAddChild()
// and canRemoveChild() both true — used to exercise nested-child edits.
function structEntry() {
  return rowNamed(freshModel(), 'Struct');
}

describe('deleteChild', () => {
  it('removes a nested child but keeps the owning entry present', () => {
    const parent = structEntry();
    expect(parent.children.length).toBeGreaterThan(0);
    const child = parent.children[0];

    const { newText, selectId } = deleteChild(fixtureText, child);
    expect(isValidJson(newText)).toBe(true);
    // Owning entry still present; the deleted field's row id is not reselected.
    expect(findEntrySpan(newText, 'Struct')).not.toBeNull();
    expect(selectId).not.toBe(child.id);
    // Sibling entry untouched.
    expect(siblingByteIdentical(fixtureText, newText, 'PI')).toBe(true);
  });

  it('throws for a child whose parent forbids removal', () => {
    const parent = structEntry();
    const child = parent.children[0];
    // Force canRemoveChild false to hit the guard.
    parent.canRemoveChild = () => false;
    expect(() => deleteChild(fixtureText, child)).toThrow();
  });
});

describe('addChild', () => {
  it('adds a child to a struct entry and keeps valid JSON', () => {
    const node = structEntry();
    expect(node.canAddChild()).toBe(true);
    const before = node.children.length;

    const { newText, selectId } = addChild(fixtureText, node);
    expect(isValidJson(newText)).toBe(true);
    expect(node.children.length).toBe(before + 1);
    expect(selectId).toBeTruthy();
    expect(siblingByteIdentical(fixtureText, newText, 'PI')).toBe(true);
  });

  it('throws for a node that cannot have children', () => {
    const scalar = rowNamed(freshModel(), 'Number');
    expect(() => addChild(fixtureText, scalar)).toThrow();
  });
});

describe('pasteEntry', () => {
  it('pastes a uniquely-named copy as a new top-level entry', () => {
    const model = freshModel();
    const src = rowNamed(model, 'Number');
    const payload = src.serialize() as Record<string, unknown>;
    const section = src.parent;

    const { newText, selectId } = pasteEntry(fixtureText, section, payload);
    expect(isValidJson(newText)).toBe(true);
    // Original still present; a uniquely-named copy now exists.
    const names = rowNames(newText);
    expect(names).toContain('Number');
    expect(names).toContain('Number1');
    expect(selectId).toContain('Number1');
    // Untouched sibling stays byte-identical.
    expect(siblingByteIdentical(fixtureText, newText, 'PI')).toBe(true);
  });

  it('cross-section paste rewrites the namespace so the entry lands in the target section', () => {
    const model = freshModel();
    const src = rowNamed(model, 'Number');
    const payload = src.serialize() as Record<string, unknown>;
    // Target "Other Data" (present on every SlddNode even when empty) — a section
    // in a DIFFERENT namespace from Design, which is what the rebind has to rewrite.
    // Not Configurations: it holds config objects only, so a variable no longer
    // reaches the rebind there at all (see the allow-list describes below).
    const other = model.children.find((s: Any) => s.name === 'other');
    expect(other).toBeTruthy();

    // The namespace is derived from the target section, not passed in.
    const { newText } = pasteEntry(fixtureText, other, payload);
    expect(isValidJson(newText)).toBe(true);
    // After reparse the pasted entry is a child of other, not design.
    const reparsed = freshModel(newText);
    const otherEntries = reparsed.children.find((s: Any) => s.name === 'other').children.map((c: Any) => c.name);
    expect(otherEntries).toContain('Number');
  });

  it('rebinds the section even when the payload declares no metadata at all', () => {
    // `metadata` is null for an entry whose source .sldd never declared one (a row
    // hand-added in the text view round-trips as `"metadata": null`). Skipping the
    // namespace rebind for those left the pasted entry with no namespace, so
    // getSectionKey fell through to its 'design' default: pasting into another
    // section put the entry in Design Data instead, as if the paste had gone to the
    // wrong section entirely.
    const model = freshModel();
    const other = model.children.find((s: Any) => s.name === 'other');
    expect(other).toBeTruthy();

    const { newText } = pasteEntry(fixtureText, other, { name: 'Hand', value: 5 });
    expect(isValidJson(newText)).toBe(true);

    const reparsed = freshModel(newText);
    const sectionOf = (name: string) =>
      reparsed.children.find((s: Any) => s.children.some((c: Any) => c.name === name))?.name;
    expect(sectionOf('Hand')).toBe('other');
  });

  it('gives the pasted copy a fresh unique uuid, not the source uuid', () => {
    const model = freshModel();
    const src = rowNamed(model, 'Number');
    const payload = src.serialize() as Record<string, unknown>;
    const sourceUuid = (payload.metadata as Any).uuid as string;
    const section = src.parent;

    const { newText } = pasteEntry(fixtureText, section, payload);
    const reparsed = freshModel(newText);
    const copy = rowsOf(reparsed).find((n: Any) => n && n.name === 'Number1');
    expect(copy).toBeTruthy();
    const copyUuid = (copy.metadata as Any).uuid as string;

    // A new uuid was generated — it must differ from the source's.
    expect(copyUuid).not.toBe(sourceUuid);
    // ...and follow the current uuid pattern (8-4-4-4-12 lowercase hex).
    expect(copyUuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // The source entry keeps its own uuid.
    expect(payload.metadata).toBeTruthy();
  });

  it('delete + undo restores the original uuid (parse never regenerates it)', () => {
    // Undo is native text-level undo: it restores the pre-delete bytes verbatim,
    // and reparsing reads the uuid straight from the text. This guards that
    // invariant — deleting an entry and restoring the original text must yield
    // the original uuid, and parsing the same text is stable w.r.t. uuid.
    const model = freshModel();
    const src = rowNamed(model, 'Number');
    const originalUuid = (src.serialize() as Any).metadata.uuid as string;

    const entry = rowNamed(model, 'Number');
    const { newText } = deleteEntry(fixtureText, entry, sectionRowId);
    // The entry is gone from the deleted text...
    expect(rowNames(newText)).not.toContain('Number');

    // ...and "undo" (restoring the original bytes) brings back the original uuid.
    const restored = freshModel(fixtureText);
    const back = rowsOf(restored).find((n: Any) => n && n.name === 'Number');
    expect((back.serialize() as Any).metadata.uuid).toBe(originalUuid);
  });

  it('pastes into a dictionary whose entries array is EMPTY', () => {
    // The first paste into an empty array must NOT be prefixed with a comma —
    // `[,{...}]` is not JSON. Reachable two ways the user hits routinely: a
    // freshly created dictionary, and one whose every entry was just deleted or
    // moved out. Getting it wrong corrupts the file on the very first paste.
    const root = JSON.parse(fixtureText);
    root.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries = [];
    const emptyText = JSON.stringify(root, null, 2);

    const empty = freshModel(emptyText);
    expect(empty.children.every((s: Any) => s.children.length === 0)).toBe(true);

    const donor = freshModel();
    const src = donor.children.flatMap((s: Any) => s.children).find((e: Any) => e.name === 'Number');
    const { newText } = pasteEntry(emptyText, empty.getSection('design'), src.serialize());
    expect(isValidJson(newText)).toBe(true);
    expect(rowNames(newText)).toEqual(['Number']);
  });
});

// Every structural edit resolves its target by NAME in the live document text,
// while the model it was handed came from an EARLIER read of that text. The two
// can disagree: the user (or another extension) can edit the .sldd in the text
// view, or on disk, between the table's last repaint and the click. The span
// finders then return null, and these guards are what turn that into a readable
// error message instead of a corrupt splice at offset 0 or a silent no-op.
//
// Each test asserts the MESSAGE too, because the message is the whole user-facing
// product of the guard — SlddTextEditorProvider surfaces it verbatim as
// "Failed to apply edit: <message>" in the table.
describe('structural edits against text the model no longer matches', () => {
  // The fixture with every mention of "Number" renamed — exactly what a rename in
  // the text view produces while the table still holds the old model.
  const renamed = (from: string, to: string) => fixtureText.replace(new RegExp(`"${from}"`, 'g'), `"${to}"`);

  it('deleteEntry names the entry it could not find', () => {
    const entry = rowNamed(freshModel(), 'Number');
    expect(() => deleteEntry(renamed('Number', 'NumberRenamed'), entry, sectionRowId)).toThrow(
      'Could not locate entry "Number" to delete.',
    );
  });

  it('addChild names the entry whose text it could not find', () => {
    // The owning entry is reserialized and spliced over its span, so a missing
    // span here would otherwise overwrite the wrong bytes.
    const node = structEntry();
    expect(() => addChild(fixtureText.replace('"name": "Struct"', '"name": "Renamed"'), node)).toThrow(
      'Could not locate entry "Struct" text.',
    );
  });

  it('deleteChild names the entry whose text it could not find', () => {
    const parent = structEntry();
    expect(() =>
      deleteChild(fixtureText.replace('"name": "Struct"', '"name": "Renamed"'), parent.children[0]),
    ).toThrow('Could not locate entry "Struct" text.');
  });

  it('pasteEntry reports a missing entries array rather than inserting at offset 0', () => {
    // A hand-edited or partially-written .sldd can be valid JSON yet not have the
    // entries array at the expected path. Inserting anyway would write the entry
    // into the middle of an unrelated object.
    const src = rowNamed(freshModel(), 'Number');
    const noEntries = fixtureText.replace('"entries"', '"entriesX"');
    expect(isValidJson(noEntries)).toBe(true); // still parses — only the path is wrong
    expect(() => pasteEntry(noEntries, src.parent, src.serialize() as Record<string, unknown>)).toThrow(
      'Could not locate the entries array.',
    );
  });
});

// C-180. A paste copies an mpt object MATLAB already wrote, so core admits an mpt.Parameter
// or mpt.Signal into Design Data, while creating one from scratch stays refused. The source is
// params.sldd's MATLAB-written gravity and sig1, re-classed in the text, so the payload is what
// a copy of a real mpt entry carries. (Its refusal in Architectural Data is a paste rule:
// test/dictionaryPasteRules.test.ts.)
describe('pasteEntry admits an mpt entry into Design Data only', () => {
  // vscode's test-integration/fixtures/workspace/params.sldd, byte for byte.
  const paramsText = readFileSync('test/parity/artifacts/text/params.sldd', 'utf8');
  /** `text` with entry `name`'s first `_array_class` changed from `from` to `to`. */
  function reclass(text: string, name: string, from: string, to: string): string {
    const at = text.indexOf(`"name": "${name}"`);
    const cls = text.indexOf(`"_array_class": "${from}"`, at);
    if (at < 0 || cls < at) throw new Error(`params.sldd spells no ${from} for ${name}`);
    return text.slice(0, cls) + `"_array_class": "${to}"` + text.slice(cls + `"_array_class": "${from}"`.length);
  }
  const mptText = reclass(
    reclass(paramsText, 'gravity', 'Simulink.Parameter', 'mpt.Parameter'),
    'sig1',
    'Simulink.Signal',
    'mpt.Signal',
  );
  const load = (text = mptText) => opened(text, 'params.sldd').root;
  const entryOf = (model: Any, name: string) =>
    (model.children as Any[]).flatMap((s: Any) => s.children as Any[]).find((e: Any) => e.name === name);
  const namesOf = (text: string) => rowsOf(load(text)).map((n) => n.name);

  for (const [name, cls] of [['gravity', 'mpt.Parameter'], ['sig1', 'mpt.Signal']] as const) {
    it(`pastes a copy of an ${cls} into Design Data, and the copy keeps its class`, () => {
      const model = load();
      const payload = entryOf(model, name).serialize() as Record<string, Any>;
      expect(payload.value._array_class).toBe(cls);

      const { newText } = pasteEntry(mptText, model.getSection('design'), payload);
      expect(isValidJson(newText)).toBe(true);
      expect(newText.split(`"_array_class": "${cls}"`).length - 1, 'the copy writes the class').toBe(2);

      // Reopened, the one new entry is in Design Data, with the class it was copied with.
      const before = new Set(namesOf(mptText));
      const added = namesOf(newText).filter((n) => !before.has(n));
      expect(added).toHaveLength(1);
      const copy = entryOf(load(newText), added[0]);
      expect(copy.className).toBe(cls);
      expect(copy.parent.name).toBe('design');
      expect(siblingByteIdentical(mptText, newText, name)).toBe(true);
    });
  }
});

// The paste gates. Both are reachable from an ordinary drag or Cmd+V — the
// webview's dropDecision predicts them so the cursor already says no-drop, but
// the host must enforce them anyway: a keyboard paste never consults the
// predictor, and drop feedback alone is advisory.
describe('deleteChild / addChild on a node that does not support it', () => {
  it('refuses to add a child to a scalar with an actionable message', () => {
    const scalar = rowNamed(freshModel(), 'Number');
    expect(() => addChild(fixtureText, scalar)).toThrow('This item cannot have children added.');
  });

  it('refuses to delete a top-level entry through the nested-child path', () => {
    // deleteChild's caller picks the path from node.isEntry; an entry routed here
    // has a SECTION as its parent, which has no canRemoveChild.
    const entry = rowNamed(freshModel(), 'Number');
    expect(() => deleteChild(fixtureText, entry)).toThrow('This item cannot be deleted.');
  });
});

// deleteEntry picks the row to select after the deletion: the previous sibling,
// else the next, else the section header. The last arm only happens when the
// deleted entry was the section's ONLY entry — the table would otherwise be told
// to select a row that no longer exists, leaving the Property Inspector showing
// the entry the user just deleted.
describe('deleteEntry reselection', () => {
  it('falls back to the section header when the section had a single entry', () => {
    const model = freshModel();
    // arch is empty in this fixture; paste one entry in so it holds exactly one.
    const src = rowNamed(model, 'Number');
    const arch = model.children.find((s: Any) => s.name === 'arch');
    const { newText } = pasteEntry(fixtureText, arch, src.serialize() as Record<string, unknown>);

    const reparsed = freshModel(newText);
    const solo = reparsed.children.find((s: Any) => s.name === 'arch').children[0];
    expect(solo).toBeTruthy();
    expect(deleteEntry(newText, solo, sectionRowId).selectId).toBe('section:arch');
    // Core's own: the header's row id is the caller's spelling, whatever it is.
    expect(deleteEntry(newText, solo, (name) => `header/${name}`).selectId).toBe('header/arch');
  });
});

// Any entry by name, off a model the caller already has. Straight down the tree rather
// than through buildRows + findNode: two entries of ONE model is what the same-entry
// guard needs to be tested against, and structEntry builds a fresh model per call.
function entryNamed(model: Any, name: string) {
  return model.children.flatMap((s: Any) => s.children).find((e: Any) => e.name === name);
}

describe('deleteChildren', () => {
  it('removes every named child and splices the owning entry ONCE', () => {
    // Two deleteChild calls would each look for the entry's span, and the second would
    // look in text the first had already rewritten — so the span it found would be the
    // wrong length and its write would land over the entry's neighbour.
    const { session, root } = opened(fixtureText);
    const entry = entryNamed(root, 'Struct');
    const [a, b] = entry.children;
    expect(b, 'the fixture’s Struct has two fields').toBeTruthy();

    // entryOps.mutateEntry(entry, fn) is the session's mutateSubtree(entry, fn).
    const result = session.mutateSubtree(entry, () => deleteChildren(fixtureText, [a, b]));

    // The text is valid JSON and the entry holds neither field — the check a double
    // splice fails. Read back through a reparse rather than as a substring, because this
    // fixture's fields are named "a" and "b": every entry in the document contains those
    // letters, so `not.toContain` could not tell a survivor from an unrelated byte.
    expect(isValidJson(result.newText)).toBe(true);
    const reparsed = freshModel(result.newText);
    const struct = reparsed.children
      .flatMap((s: Any) => s.children)
      .find((e: Any) => e.name === 'Struct');
    expect(struct.children.map((c: Any) => c.name)).toEqual([]);
    // The neighbouring entry is byte-identical — that is where a second splice's stale
    // span would have written.
    expect(siblingByteIdentical(fixtureText, result.newText, 'PI')).toBe(true);
    expect(entry.children).toHaveLength(0);
  });

  it('selects a surviving sibling, not a row it just deleted', () => {
    // reselectAfterRemoval answers per removal, so the LAST answer can name a node that
    // an earlier removal already took away. The selection has to survive the gesture.
    // NestedStruct, not Struct: it has three fields, so two removals still leave one — the
    // only shape in which the survivor arm runs at all.
    const { session, root } = opened(fixtureText);
    const entry = entryNamed(root, 'NestedStruct');
    const doomed = entry.children.slice(0, 2);
    const surviving = entry.children.slice(2).map((c: Any) => c.id);

    const result = session.mutateSubtree(entry, () => deleteChildren(fixtureText, doomed));

    if (surviving.length) expect(surviving).toContain(result.selectId);
    else expect(result.selectId).toBe(entry.id);
  });

  it('refuses children of two different entries', () => {
    // One splice can only rewrite one entry. A caller that mixed entries would silently
    // lose the other's removals from the text while keeping them in the model.
    const model = freshModel();
    const a = entryNamed(model, 'Struct').children[0];
    const b = entryNamed(model, 'NestedStruct').children[0];
    expect(() => deleteChildren(fixtureText, [a, b])).toThrow(
      'These items are not all in the same entry.',
    );
  });

  it('refuses a child that cannot be deleted', () => {
    // Same guard deleteChild has (removeChildFromModel), stated as one predicate so the
    // group check and the single check cannot come to disagree.
    const entry = entryNamed(freshModel(), 'Number');
    expect(() => deleteChildren(fixtureText, [entry])).toThrow('This item cannot be deleted.');
  });

  it('leaves the model untouched when only ONE of the group is refused', () => {
    // Every check runs over the whole group before anything is removed. Validating as it
    // went would remove the first field and then throw, and the live model would keep
    // that removal until the next re-parse — a table showing a delete the file never got.
    const entry = entryNamed(freshModel(), 'Struct');
    const before = entry.children.map((c: Any) => c.name);
    expect(before.length).toBeGreaterThan(1);
    // The entry itself is not a removable child, so the group is refused — after the
    // first element has already been accepted.
    expect(() => deleteChildren(fixtureText, [entry.children[0], entry])).toThrow(
      'This item cannot be deleted.',
    );
    expect(entry.children.map((c: Any) => c.name)).toEqual(before);
  });
});
