// Copyright 2026 The MathWorks, Inc.
//
// Asking changes nothing. A table asks canAddChild and canRemoveChild of every row it draws, and a
// host asks the session's refusals before every gesture, so an answer that changes the value it is
// about changes what the next save writes, with nobody having edited it.
//
// The stream gates (MatlabVariableNode._streamChildRefusal) try an Add or a Remove on a copy of the
// text dictionary's MAT stream the row is in (_inStreamCopy). The copy was parsed from what the
// holder serializes, which for an untouched node is its `_rawInput` itself, and parseFlatArray adopts
// that array as its `_elements`: the trial Add and Remove landed on the live value. `{[1 2], true}`
// typed over values_text.sldd's cLeaves{9} (a complex `[1+2i 3-4i]`, held as a stream) was saved as
// `{[1 0], true}` by the JSON editor, which asks both before it writes the entry, and a Delete of
// `[1 2]`'s first element left `[]` where MATLAB leaves 2.
//
// Over every MAT-file and dictionary fixture: every query a host or a table asks, of every row, as
// read and after a value typed over each such stream (and its first member), leaves the save byte for
// byte and the rows as they were.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function filesUnder(dir: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p, re));
    else if (re.test(e.name)) out.push(p);
  }
  return out.sort();
}

function opened(bytes: Uint8Array, filename: string) {
  const session: Any = createSession();
  const root: Any = ingest(session, ab(bytes), { filename });
  const save = (): string => {
    const out: Any = session.serializeSource(root.name);
    return out.kind === 'text' ? out.text : Buffer.from(out.bytes).toString('base64');
  };
  const edit = (node: Any, key: string, text: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, key, text);
  };
  return { session, root, save, edit };
}

const pathOf = (n: Any): number[] => {
  const p: number[] = [];
  for (let x = n; x && x.parent; x = x.parent) p.unshift(x.parent.children.indexOf(x));
  return p;
};
const nodeAt = (root: Any, path: number[]): Any => path.reduce((n, i) => n?.children?.[i], root);
const shownAt = (root: Any, matlabPath: string): Any => (root.flatten() as Any[]).find((n) => n.matlabPath === matlabPath && !n.isContainer);
const subtree = (n: Any): Any[] => [n, ...(n.children ?? []).flatMap(subtree)];
// The rows as a table holds them: which there are, and how many children each has.
const rowsOf = (n: Any): string => subtree(n).map((x) => x.id + ':' + (x.children?.length ?? 0)).join('\n');

// What a table asks of each row as it draws it, in its order (view's rowStamp.capabilityFlags).
const tableAsks = (n: Any) => {
  n.parent?.canRemoveChild?.();
  n.canAddChild?.();
};

// Every query a host or a table asks, by name: of a row `n` of the file `o` opened.
type Ask = (o: ReturnType<typeof opened>, n: Any) => unknown;
const QUERIES: [string, Ask][] = [
  ['canAddChild', (_o, n) => n.canAddChild?.()],
  ['canRemoveChild', (_o, n) => n.canRemoveChild?.()],
  ['valueEditable', (_o, n) => n.valueEditable],
  ['nameEditable', (_o, n) => n.nameEditable],
  ['displayValue', (_o, n) => n.displayValue],
  ['addChildRefusal', (o, n) => o.session.addChildRefusal(n.id)],
  ['deleteRefusal', (o, n) => o.session.deleteRefusal(n.id)],
  ['renameRefusal', (o, n) => o.session.renameRefusal(n.id)],
  ['valueEditRefusal', (o, n) => o.session.valueEditRefusal(n.id)],
  ['isUnchangedEdit', (o, n) => o.session.isUnchangedEdit(n.id, 'Value', String(n.displayValue ?? ''))],
  ['addEntryRefusal', (o, n) => (n.isContainer ? o.session.addEntryRefusal(n.id) : null)],
  ['copyRefusal', (o, n) => (n.isEntry ? [o.session.copyRefusal(n.id, 'json'), o.session.copyRefusal(n.id, 'xml')] : null)],
  // Deep: the paste made and taken back, which no host sees (DataModel.pasteRefusal).
  ['pasteRefusal', (o, n) => (n.isEntry && o.root.sourceFormat === 'mat' ? o.session.pasteRefusal(o.root.name, n.serialize(), { deep: true }) : null)],
  ['canUndo/canRedo', (o) => [o.session.canUndo(), o.session.canRedo()]],
];

// Each query of every row under `top`, then the save and the rows: the names of those that changed
// either, as `<query>`.
function queriesThatChange(o: ReturnType<typeof opened>, top: Any): string[] {
  const changed: string[] = [];
  let saved = o.save();
  let rows = rowsOf(top);
  for (const [name, ask] of QUERIES) {
    for (const n of subtree(top)) {
      try {
        ask(o, n);
      } catch {
        // A query that throws is a finding of its own, not this test's: what it left is still checked.
      }
    }
    const nowSaved = o.save();
    const nowRows = rowsOf(top);
    if (nowSaved !== saved || nowRows !== rows) {
      changed.push(name);
      saved = nowSaved;
      rows = nowRows;
    }
  }
  return changed;
}

const VALUES = 'test/fixtures/edit-bash/r2027a/values_text.sldd';
const cLeaves9 = () => {
  const o = opened(new Uint8Array(readFileSync(VALUES)), 'values_text.sldd');
  expect(o.edit(shownAt(o.root, 'cLeaves{9}'), 'Value', '{[1 2], true}')).toBe(true);
  return o;
};

describe('a query changes nothing', () => {
  it("a cell typed over a stream, cLeaves{9} = {[1 2], true}: what a table asks of its rows leaves the save as typed", () => {
    const o = cLeaves9();
    const typed = o.save();
    expect(shownAt(o.root, 'cLeaves{9}{1}').displayValue).toBe('[1 2]');
    let entry = shownAt(o.root, 'cLeaves{9}');
    while (!entry.isEntry) entry = entry.parent;
    for (const n of subtree(entry)) tableAsks(n);
    expect(o.save()).toBe(typed);
    expect(shownAt(o.root, 'cLeaves{9}{1}').displayValue).toBe('[1 2]');
    // And the file the save writes reads back as typed.
    const back = opened(new TextEncoder().encode(o.save()), 'values_text.sldd');
    expect(shownAt(back.root, 'cLeaves{9}').displayValue).toBe('{[1 2], true}');
    expect(shownAt(back.root, 'cLeaves{9}{1}').displayValue).toBe('[1 2]');
  });

  it('a Delete of its first element leaves 2, as MATLAB does, and an Add one element more', () => {
    const del = cLeaves9();
    const arr = shownAt(del.root, 'cLeaves{9}{1}');
    del.session.setActive(del.root, arr);
    expect(del.session.deleteNodeById(arr.children[0].id)).toBe(true);
    expect(shownAt(del.root, 'cLeaves{9}{1}').displayValue).toBe('2');
    const back = opened(new TextEncoder().encode(del.save()), 'values_text.sldd');
    expect(shownAt(back.root, 'cLeaves{9}{1}').displayValue).toBe('2');

    const add = cLeaves9();
    const grown = shownAt(add.root, 'cLeaves{9}{1}');
    add.session.setActive(add.root, grown);
    expect(add.session.addChildTo(grown.id)).toBeTruthy();
    expect(shownAt(add.root, 'cLeaves{9}{1}').displayValue).toBe('[1 2 0]');
  });

  it('no query of any row of any fixture, as read, changes what its save writes', () => {
    let files = 0;
    let rows = 0;
    const wrong: string[] = [];
    for (const file of filesUnder('test', /\.(mat|sldd)$/)) {
      let o: ReturnType<typeof opened>;
      try {
        o = opened(new Uint8Array(readFileSync(file)), file.split('/').pop()!);
        o.save();
      } catch {
        continue; // a fixture of a file core refuses to open or to write: nothing to ask
      }
      files++;
      rows += o.root.flatten().length;
      for (const q of queriesThatChange(o, o.root)) wrong.push(relative('test', file) + ': ' + q);
    }
    // Measured when this was written: 720 files, 112,702 rows.
    expect(files).toBeGreaterThanOrEqual(700);
    expect(rows).toBeGreaterThanOrEqual(100_000);
    expect(wrong).toEqual([]);
  }, 300_000);

  it("no query of any row changes what the save writes after a value is typed over a text dictionary's stream, or over its first member", () => {
    // Values that leave parsed arrays, cells and nests of them under the stream.
    const TEXTS = ['{[1 2], true}', '{[1 2 3]}', '{[1 2; 3 4], {5, [6 7]}}', '[1 2 3]', '[1+2i 3]', '{1, 2}'];
    let states = 0;
    const wrong: string[] = [];
    for (const file of filesUnder('test', /\.sldd$/)) {
      const bytes = new Uint8Array(readFileSync(file));
      const name = file.split('/').pop()!;
      let first: ReturnType<typeof opened>;
      try {
        first = opened(bytes, name);
      } catch {
        continue;
      }
      if (first.root.sourceFormat !== 'json') continue;
      const at: number[][] = [];
      const holders = new Set<Any>();
      for (const n of first.root.flatten() as Any[]) {
        const holder = n._openStream?.();
        if (!holder || holders.has(holder)) continue;
        holders.add(holder);
        at.push(pathOf(holder));
        if (holder.children?.[0]) at.push(pathOf(holder.children[0]));
      }
      for (const path of at) {
        for (const text of TEXTS) {
          const o = opened(bytes, name);
          const node = nodeAt(o.root, path);
          const label = relative('test', file) + ' ' + node.matlabPath + ' = ' + text;
          if (o.edit(node, 'Value', text) !== true) continue;
          states++;
          let entry = node;
          while (!entry.isEntry && entry.parent) entry = entry.parent;
          for (const q of queriesThatChange(o, entry)) wrong.push(label + ': ' + q);
        }
      }
    }
    // Measured when this was written: 338 edits taken.
    expect(states).toBeGreaterThanOrEqual(300);
    expect(wrong).toEqual([]);
  }, 120_000);
});
