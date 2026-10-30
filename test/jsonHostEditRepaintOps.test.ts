// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/jsonHostEditRepaint.test.ts at c73da3c (the cases C2
// deferred): a table cell edit repaints the entry it changed from the text it just wrote, swept
// over every cell the table can commit; the three mutation/re-parse disagreements, now refusals or
// carries; and mutateEntry's repair of the session's index. What changed in setup:
//   - each edit runs on a core session's read of the fixture (createSession + ingest) where vscode
//     used view's getModel and the global DataModel, and mutateEntry and applyEntryOps are given
//     that session (core takes it as their last argument);
//   - a row is core's (test/tools/entryRows.ts: the node's toRow(), and the entry's Last Modified
//     columns) where vscode built view's rows (buildEntryRows); the cells the sweep edits are read
//     off those rows exactly as vscode reads them off view's (dex-tree-table's editability rule,
//     transcribed there and here);
//   - the webview's half, splicing the paint over the run the table holds (spliceEntryRows), is
//     view's: what is asserted in its place is that the run the echo replaces is the one the paint
//     left (the painted rows hold the id the plan names).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyScEdits, catalogRenameOf, createSession, entrySelectorOf, scJsonRenameEdits } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { findEntrySpan, detectIndent } from '../src/edit/entrySplice.js';
import { reserializeEntry } from '../src/edit/structuralEdit.js';
import { mutateEntry, applyEntryOps } from '../src/edit/entryOps.js';
import { planOwnEdit } from '../src/edit/jsonEntrySync.js';
import { rowsOfEntry } from './tools/entryRows.js';

type Any = any;

const read = (rel: string) => readFileSync(`test/fixtures/${rel}`, 'utf8');

// vscode's three fixtures, which core holds byte for byte at these paths.
const FIXTURES: Array<{ label: string; text: string }> = [
  { label: 'numeric_json.sldd', text: read('numeric_json.sldd') },
  { label: 'mcos/all.sldd', text: read('mcos/all.sldd') },
  { label: 'arch.sldd', text: read('arch.sldd') },
];

/** A fresh core session's read of `text`, as getModel builds it. */
function getModel(label: string, text: string) {
  const session: Any = createSession();
  const model: Any = ingest(session, new TextEncoder().encode(text).buffer as ArrayBuffer, { filename: label.split('/').pop()! });
  return { session, model };
}

/** The top-level entry a node belongs to. */
function owningEntry(node: Any): Any {
  let n = node;
  while (n && !n.isEntry) n = n.parent;
  return n;
}

/** Whether `root` still reaches `node` through its children. */
function isUnder(node: Any, root: Any): boolean {
  if (root === node) return true;
  for (const child of (root?.children ?? []) as Any[]) {
    if (isUnder(node, child)) return true;
  }
  return false;
}

/** The entry a section+name pair names, in the model passed. */
function entryNamed(model: Any, sectionName: string, entryName: string): Any {
  const section = ((model?.children ?? []) as Any[]).find((s) => s.name === sectionName);
  return ((section?.children ?? []) as Any[]).find((e) => e.name === entryName) ?? null;
}

const isCellObject = (v: Any): boolean => !!v && typeof v === 'object' && !Array.isArray(v);
const cellText = (v: Any): string => (isCellObject(v) ? String(v.text ?? '') : v == null ? '' : String(v));

const COLUMNS = ['Name', 'Value', 'Description', 'DataType', 'Min', 'Max', 'Unit', 'Complexity', 'Dimensions', 'DimensionsMode', 'StorageClass', 'Alignment'];

/** The columns of one row the TABLE will open an editor on — dex-tree-table's rule, transcribed. */
function editableColumns(row: Any): string[] {
  const out: string[] = [];
  for (const col of COLUMNS) {
    const raw = row[col];
    if (col === 'Name') {
      if (isCellObject(raw) && raw.editable === true) out.push(col);
    } else if (col === 'Value') {
      if (isCellObject(raw) ? raw.editable === true : row._valueEditable === true) out.push(col);
    } else if (col === 'Description') {
      if (row._valueEditable !== false) out.push(col);
    } else if (isCellObject(raw) && raw.editable === true) out.push(col);
  }
  return out;
}

interface Pair {
  nodeId: string;
  columnId: string;
  value: string;
  entryRow: boolean;
}

const FREE_TEXT: Record<string, (current: string) => string> = {
  Name: (cur) => `${cur}_renamed`,
  Value: () => '42',
  Description: () => 'edited by the equivalence sweep',
  DataType: () => 'single',
  Min: () => '-7',
  Max: () => '77',
  Unit: () => 'm/s',
  Dimensions: () => '[1 2]',
};

/** Every (row, column, value) the table could commit against this fixture. */
function pairsOf(label: string, text: string): Pair[] {
  const { model } = getModel(label, text);
  const pairs: Pair[] = [];
  for (const section of (model.children ?? []) as Any[]) {
    for (const entry of (section.children ?? []) as Any[]) {
      for (const row of rowsOfEntry(entry)) {
        const entryRow = row.ID === entry.id;
        for (const columnId of editableColumns(row)) {
          const raw = row[columnId];
          const current = columnId === 'Name' ? String(raw.label ?? '') : cellText(raw);
          const options: string[] | undefined = isCellObject(raw) ? raw.options : undefined;
          if (options?.length) {
            pairs.push({ nodeId: row.ID, columnId, entryRow, value: options.find((o) => o !== current) ?? options[0] });
            continue;
          }
          const free = FREE_TEXT[columnId];
          expect(free, `the sweep knows what to type into "${columnId}" (row ${row.ID})`).toBeTruthy();
          pairs.push({ nodeId: row.ID, columnId, entryRow, value: free(current) });
        }
      }
    }
  }
  return pairs;
}

interface Edited {
  rows: Any[];
  painted: Any[];
  before: Any[];
  newText: string;
  rowIdOnScreen: string;
  entryId: string;
  entryName: string;
  sectionName: string;
}

/**
 * The whole host-side edit: mutate the node in the model already built, splice the entry's
 * reserialized text, and repaint that entry by reading it back out of the bytes just written
 * (planOwnEdit + applyEntryOps). Null when setProperty refuses the value.
 */
function editInPlace(label: string, text: string, pair: Pair): Edited | null {
  const { session, model } = getModel(label, text);
  const node = session.findNodeById(pair.nodeId);
  expect(node, `the fixture still holds "${pair.nodeId}"`).not.toBeNull();
  const entry = owningEntry(node);
  const sectionName = entry.parent?.name ?? '';
  const selector = entrySelectorOf(entry);
  const rowIdOnScreen: string = entry.id;
  const before = rowsOfEntry(entry);
  const catalogRename = catalogRenameOf(pair.columnId, pair.value, node, entry);

  const result = mutateEntry(entry, () => node.setProperty(pair.columnId, pair.value), session);
  if (result && typeof result === 'object' && (result as Any).error) {
    // A refused edit has to leave the model as the text still reads it.
    expect(rowsOfEntry(entry), `refused ${pair.columnId} on "${pair.nodeId}"`).toEqual(before);
    return null;
  }

  // The session's index says exactly what the tree says.
  const stillThere = isUnder(node, entry);
  expect(session.findNodeById(node.id) ?? null, `"${node.id}" is ${stillThere ? 'indexed' : 'gone'} after ${pair.columnId}`).toBe(stillThere ? node : null);

  // What the table shows the instant the model changes: the entry as the mutation left it.
  const painted = rowsOfEntry(entry);

  const span = findEntrySpan(text, selector);
  expect(span, `the text still spells "${selector.name}"`).not.toBeNull();
  const entryText = reserializeEntry(entry, detectIndent(text));
  const newText = applyScEdits(text, [
    { start: span!.offset, end: span!.offset + span!.length, text: entryText },
    ...(catalogRename ? scJsonRenameEdits(text, catalogRename.oldName, catalogRename.newName) : []),
  ]);

  const submitted = { rangeOffset: span!.offset, rangeLength: span!.length, text: entryText };
  const plan = planOwnEdit([{ ...submitted }], { entryId: entry.id, submitted, epoch: 0 });
  expect(plan, `the host recognises its own edit (${pair.columnId} on "${pair.nodeId}")`).not.toBeNull();
  // The run the echo replaces is the one the paint left.
  expect(painted.some((r: Any) => r.ID === plan!.entryRowId), `the echo lands on the run the paint left (${pair.columnId} on "${pair.nodeId}")`).toBe(true);
  const applied = applyEntryOps(model, [plan!.op], session);
  expect(applied[0].kind).toBe('replace');
  const fresh = (applied[0] as Any).entry;
  return { rows: rowsOfEntry(fresh), painted, before, newText, rowIdOnScreen, entryId: fresh.id as string, entryName: fresh.name as string, sectionName };
}

for (const { label, text } of FIXTURES) {
  describe(`a cell edit repaints the entry it wrote, from what it wrote — ${label}`, () => {
    const pairs = pairsOf(label, text);

    it('has enough editable cells to make the sweep meaningful', () => {
      expect(pairs.length).toBeGreaterThan(20);
      expect(pairs.some((p) => p.entryRow)).toBe(true);
      expect(pairs.some((p) => !p.entryRow)).toBe(true);
    });

    it('paints the rows a re-parse of the spliced text would paint', () => {
      let compared = 0;
      for (const pair of pairs) {
        const done = editInPlace(label, text, pair);
        if (!done) continue;
        const where = `${pair.columnId} := ${JSON.stringify(pair.value)} on "${pair.nodeId}"`;
        const reparsed = getModel(label, done.newText).model;
        const entry = entryNamed(reparsed, done.sectionName, done.entryName);
        expect(entry, `"${done.entryName}" survives the splice (${where})`).toBeTruthy();
        expect(entry.id, `the two paths agree on the entry's id (${where})`).toBe(done.entryId);
        expect(rowsOfEntry(entry), where).toEqual(done.rows);
        compared++;
      }
      expect(compared, 'edits that round-tripped identically').toBeGreaterThan(pairs.length / 4);
    });

    it('paints from the model what the text goes on to confirm', () => {
      let compared = 0;
      let showedTheEdit = 0;
      for (const pair of pairs) {
        const done = editInPlace(label, text, pair);
        if (!done) continue;
        expect(done.painted, `${pair.columnId} := ${JSON.stringify(pair.value)} on "${pair.nodeId}"`).toEqual(done.rows);
        compared++;
        if (JSON.stringify(done.painted) !== JSON.stringify(done.before)) showedTheEdit++;
      }
      expect(compared, 'edits compared').toBeGreaterThan(pairs.length / 4);
      expect(showedTheEdit, 'of which the eager paint visibly carried the edit').toBeGreaterThan(compared / 2);
    });

    it('leaves a renamed entry answering to an id the rows on screen do not carry', () => {
      const renames = pairs.filter((p) => p.columnId === 'Name' && p.entryRow);
      expect(renames.length).toBeGreaterThan(0);
      let renamed = 0;
      for (const { nodeId, value } of renames) {
        const { session } = getModel(label, text);
        const entry = session.findNodeById(nodeId);
        const before: string = entry.id;
        const result = mutateEntry(entry, () => entry.setProperty('Name', value), session);
        if (result && typeof result === 'object' && (result as Any).error) continue;
        renamed++;
        expect(entry.id, 'the model now spells the entry with its new name').not.toBe(before);
        expect(session.findNodeById(entry.id), 'and the index answers to the new id').toBe(entry);
        expect(session.findNodeById(before), 'while the old id is gone').toBeFalsy();
      }
      expect(renamed).toBeGreaterThan(0);
    });
  });
}

describe('renaming a row the format has no name for — an edit the model now refuses', () => {
  const text = read('mcos/all.sldd');

  it('is refused, so nothing is shown that the next read would take away', () => {
    const { session, model } = getModel('mcos/all.sldd', text);
    const row = session.findNodeById(`${model.name}/design/ParamMat/Value`);
    expect(row, 'the fixture still holds a matrix-valued parameter').toBeTruthy();
    const entry = owningEntry(row);
    const rowsBefore = rowsOfEntry(entry);
    const result = mutateEntry(entry, () => row.setProperty('Name', 'Value_renamed'), session) as Any;
    expect(result?.error, 'the model refuses the rename').toBe(true);
    expect(typeof result?.reason, 'and says why, for the dialog the provider shows').toBe('string');
    expect(rowsOfEntry(entry)).toEqual(rowsBefore);
    expect(JSON.stringify(entry.serialize())).not.toContain('Value_renamed');
  });
});

describe('renaming an architectural entry — the rename carries the catalog with it', () => {
  const text = read('arch.sldd');
  const rowOf = (entry: Any) => rowsOfEntry(entry)[0];
  const kindOf = (row: Any) => `${row.Kind} / ${row.Name.iconId}`;

  it('keeps a struct type a struct type, in the file and on screen', () => {
    const { session, model } = getModel('arch.sldd', text);
    const entry = entryNamed(model, 'arch', 'StructType');
    expect(kindOf(rowOf(entry))).toBe('Struct Type / typeStruct');
    const selector = entrySelectorOf(entry);
    const carry = catalogRenameOf('Name', 'StructType_renamed', entry, entry);
    expect(carry, 'the catalog lists this entry, so the rename has something to carry').toEqual({ oldName: 'StructType', newName: 'StructType_renamed' });
    expect(mutateEntry(entry, () => entry.setProperty('Name', 'StructType_renamed'), session)).toBe(true);
    expect(kindOf(rowOf(entry)), 'the mutated node keeps its classification').toBe('Struct Type / typeStruct');

    const span = findEntrySpan(text, selector)!;
    const scEdits = scJsonRenameEdits(text, carry!.oldName, carry!.newName);
    expect(scEdits, 'the catalog names it in one place in this dictionary').toHaveLength(1);
    const newText = applyScEdits(text, [{ start: span.offset, end: span.offset + span.length, text: reserializeEntry(entry, detectIndent(text)) }, ...scEdits]);
    const reread = entryNamed(getModel('arch.sldd', newText).model, 'arch', 'StructType_renamed');
    expect(kindOf(rowOf(reread)), 'a re-read finds the same kind').toBe('Struct Type / typeStruct');
  });
});

describe('a Description the format cannot hold — an edit the model now refuses', () => {
  const { label, text } = FIXTURES[0];

  it('is refused, on the format that used to lose it silently', () => {
    const { session, model } = getModel(label, text);
    const entry = entryNamed(model, 'design', 'Number');
    expect(entry, 'the fixture still holds a plain numeric variable').toBeTruthy();
    const rowsBefore = rowsOfEntry(entry);
    const result = mutateEntry(entry, () => entry.setProperty('Description', 'why this exists'), session) as Any;
    expect(result?.error, 'the model refuses what it cannot write').toBe(true);
    expect(rowsOfEntry(entry), 'and the rows are untouched').toEqual(rowsBefore);
    expect(JSON.stringify(entry.serialize())).not.toContain('why this exists');
  });
});

describe('mutateEntry — the repair the re-parse used to do for free', () => {
  const { label, text } = FIXTURES[0];

  it('a rename mutated WITHOUT it leaves the session pointing at the old id', () => {
    const { session, model } = getModel(label, text);
    const entry = (model.children as Any[]).flatMap((s: Any) => s.children)[0];
    const before: string = entry.id;
    expect(entry.setProperty('Name', `${String(entry.name)}_renamed`)).toBe(true);
    expect(entry.id).not.toBe(before);
    expect(session.findNodeById(entry.id)).toBeFalsy();
    expect(session.findNodeById(before), 'and the id it does hold names a name nothing has').toBe(entry);
  });

  it('returns what the mutation returned, so a refusal reaches the caller', () => {
    const { session, model } = getModel(label, text);
    const entries = (model.children as Any[]).flatMap((s: Any) => s.children);
    const result = mutateEntry(entries[0], () => entries[0].setProperty('Name', entries[1].name), session);
    expect(result && typeof result === 'object' && (result as Any).error).toBe(true);
    expect(session.findNodeById(entries[0].id)).toBe(entries[0]);
  });
});
