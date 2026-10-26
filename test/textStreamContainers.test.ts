// Copyright 2026 The MathWorks, Inc.
//
// A cell or a struct a text dictionary holds whole as one MAT stream takes edits at its members, as
// the same value in a MAT-file or a binary dictionary does: the maintainer's C-012 ruling as revised
// on 2026-10-24 (a stream is edited where the writer writes the edited value as it reads back,
// MatFileWriter.streamWriteRefusal), held of a cell or a struct of plain values (numbers, logicals,
// chars, and cells and structs of them, at any depth: MatlabVariableNode._isPlainTree). MATLAB keeps
// every rank >= 3 cell and struct there as a stream (cases.sldd's cellNd and structNd, nd_text.sldd's
// C and s, nd_rich.sldd's mixed and strided ones), and every member of each was read-only, where a
// MAT-file and a binary dictionary took an edit of it.
//
// Over every such stream of every text dictionary fixture, at every row under it: a value edit, an
// Add, a Remove and a field's rename, each where it is offered, taken, saved, read back as it shows,
// and undone to the bytes the stream was read from. An edit that would make the stream hold what a
// stream there holds only to be shown (a string), or whose stream would not read back, is refused,
// naming the member and the stream, and changes nothing.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function slddUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...slddUnder(p));
    else if (e.name.endsWith('.sldd')) out.push(p);
  }
  return out.sort();
}

function opened(bytes: Uint8Array, filename = 'd.sldd') {
  const session = createSession();
  const root: Any = ingest(session, ab(bytes), { filename });
  const save = (): Uint8Array => {
    const out: Any = session.serializeSource(root.name);
    return out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes;
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

// Another value of the kind a row shows, typed as its text.
function another(row: Any): string {
  const shown = String(row.displayValue);
  if (shown === 'true' || shown === 'false') return shown === 'true' ? 'false' : 'true';
  if (/i$/.test(shown) && /\d/.test(shown)) return shown === '5-6i' ? '7-8i' : '5-6i';
  if (/^'.*'$/.test(shown)) return shown === "'z'" ? "'y'" : "'z'";
  return shown === '7' ? '8' : '7';
}

// Every stream holding a cell or a struct, in every text dictionary fixture.
const HOLDERS: { file: string; path: number[]; label: string }[] = [];
for (const file of slddUnder('test')) {
  let root: Any;
  try {
    root = opened(new Uint8Array(readFileSync(file)), file.split('/').pop()).root;
  } catch {
    continue;
  }
  if (root.sourceFormat !== 'json') continue;
  for (const n of root.flatten() as Any[]) {
    if (n._readFromStream && (n._kind === 'cell' || n._scalarType === 'struct')) {
      HOLDERS.push({ file, path: pathOf(n), label: file.split('/').pop() + ' ' + n.matlabPath });
    }
  }
}

describe("a cell or a struct held whole as a text dictionary's MAT stream", () => {
  it('is found in the fixtures, and each of plain values takes edits', () => {
    // Measured when this was written: 10, every one of plain values.
    expect(HOLDERS.length).toBeGreaterThanOrEqual(10);
    for (const { file, path, label } of HOLDERS) {
      const holder = nodeAt(opened(new Uint8Array(readFileSync(file)), file.split('/').pop()).root, path);
      expect([holder._streamLocked(), holder._streamHolder()], label).toEqual([false, null]);
    }
  });

  it('takes every edit it offers at a member, which a save writes, a reopen reads back, and an undo takes back to the bytes read', () => {
    const wrong: string[] = [];
    const made = { value: 0, add: 0, remove: 0, rename: 0 };
    for (const { file, path, label } of HOLDERS) {
      const bytes = new Uint8Array(readFileSync(file));
      const fresh = () => opened(bytes, file.split('/').pop());
      const rows = subtree(nodeAt(fresh().root, path)).slice(1);
      const read = JSON.stringify(nodeAt(fresh().root, path).serializeValue());
      // One edit of each kind a row offers, each on a fresh file: [kind, row, make it].
      const asks: [keyof typeof made, Any, (o: ReturnType<typeof fresh>, n: Any) => unknown][] = [];
      for (const row of rows) {
        if (row.valueEditable) asks.push(['value', row, (o, n) => o.edit(n, 'Value', another(n))]);
        if (row.canAddChild()) asks.push(['add', row, (o, n) => (o.session.setActive(o.root, n), o.session.addChildTo(n.id) ? true : 'refused')]);
        if (row.parent?.canRemoveChild?.(row)) asks.push(['remove', row, (o, n) => (o.session.setActive(o.root, n), o.session.deleteNodeById(n.id) || 'refused')]);
        if (row.nameEditable) asks.push(['rename', row, (o, n) => o.edit(n, 'Name', 'zz' + n.name)]);
      }
      for (const [kind, row, make] of asks) {
        const o = fresh();
        const at = pathOf(row);
        const node = nodeAt(o.root, at);
        const container = kind === 'add' || kind === 'remove' ? (kind === 'add' ? node : node.parent) : node;
        const what = label + ' ' + kind + ' ' + node.matlabPath;
        const r = make(o, node);
        if (r !== true) {
          wrong.push(what + ': refused ' + JSON.stringify(r));
          continue;
        }
        made[kind]++;
        // What the table shows of it, and of the stream, after the edit; and once saved and read again.
        const shownPath = kind === 'rename' ? node.matlabPath : container.matlabPath;
        const shown = kind === 'rename' ? node.displayValue : container.displayValue;
        const holderShown = nodeAt(o.root, path).displayValue;
        const back = opened(o.save(), file.split('/').pop()).root;
        const backHolder = nodeAt(back, path);
        if (shownAt(back, shownPath)?.displayValue !== shown || backHolder?.displayValue !== holderShown) {
          wrong.push(what + ': shows ' + JSON.stringify([shown, holderShown]) + ', reopened ' + JSON.stringify([shownAt(back, shownPath)?.displayValue, backHolder?.displayValue]));
        }
        // Every row of the stream as it shows, read again.
        const now = subtree(nodeAt(o.root, path)).map((n: Any) => n.matlabPath + '=' + n.displayValue);
        const again = subtree(backHolder).map((n: Any) => n.matlabPath + '=' + n.displayValue);
        if (JSON.stringify(now) !== JSON.stringify(again)) wrong.push(what + ': its rows read back otherwise');
        if (backHolder?._streamLocked?.()) wrong.push(what + ': reopened, the stream is locked');
        o.session.setActive(o.root, null);
        o.session.undo();
        if (JSON.stringify(nodeAt(o.root, path).serializeValue()) !== read) wrong.push(what + ': undone, the stream is not as it was read');
      }
    }
    expect(wrong).toEqual([]);
    // Measured when this was written: 116 value edits, 11 Adds, 21 Removes and 65 renames.
    expect(made.value).toBeGreaterThanOrEqual(110);
    expect(made.add).toBeGreaterThanOrEqual(10);
    expect(made.remove).toBeGreaterThanOrEqual(20);
    expect(made.rename).toBeGreaterThanOrEqual(60);
  }, 300_000);

  it('renames a field of a struct array in every element, as a MAT-file and a binary dictionary do', () => {
    const o = opened(new Uint8Array(readFileSync('test/parity/artifacts/text/cases.sldd')), 'cases.sldd');
    const nd = shownAt(o.root, 'structNd');
    expect(o.edit(nd.children[3].children[0], 'Name', 'b')).toBe(true);
    const back = shownAt(opened(o.save(), 'cases.sldd').root, 'structNd');
    expect([...new Set(back.children.map((e: Any) => e.children.map((f: Any) => f.name).join(',')))]).toEqual(['b']);
    expect(back.children.map((e: Any) => e.children[0].displayValue)).toEqual(nd.children.map((e: Any) => e.children[0].displayValue));
  });

  it('refuses a member typed as a string, at any depth, naming it and the stream, and changes nothing', () => {
    const o = opened(new Uint8Array(readFileSync('test/fixtures/nd_rich.sldd')), 'nd_rich.sldd');
    const before = o.save();
    for (const [path, holder] of [['ndCellMixed{1,1,1}', 'ndCellMixed'], ['ndCellMixed{2,1,2}{2}', 'ndCellMixed'], ['ndCellMixed{1,2,2}.f', 'ndCellMixed'], ['ndStructMulti(2,1,1).bb', 'ndStructMulti']]) {
      for (const text of ['"str"', '["a" "b"]', '{1, "s"}']) {
        expect(o.edit(shownAt(o.root, path), 'Value', text), path + ' = ' + text).toMatchObject({
          error: true,
          reason: `Cannot edit "${holder}": ${path} is held in the MAT stream of ${holder}, and the one this edit makes would not be written as typed: it would hold a string, which a MAT stream there holds only to be shown.`,
        });
      }
    }
    expect(o.root.dirty).toBe(false);
    expect(new TextDecoder().decode(o.save())).toBe(new TextDecoder().decode(before));
  });

  it('refuses an edit, an Add and a Remove at a member whose stream would not be written, and changes nothing', () => {
    // No plain value makes a stream the writer refuses, so its refusal is stood in for: every value's
    // size refused as no size (MatlabVariableNode._refuseNoSize), which the rule asks first.
    const own = MatlabVariableNode.prototype._refuseNoSize;
    const bytes = new Uint8Array(readFileSync('test/fixtures/nd_rich.sldd'));
    const offered = shownAt(opened(bytes, 'nd_rich.sldd').root, 'ndCellMixed{1,1,2}');
    expect([offered.valueEditable, offered.canAddChild(), offered.canRemoveChild()]).toEqual([true, true, true]);
    // Each gate holds its answer for the rows it was asked of, so these are asked first with the writer refusing.
    const o = opened(bytes, 'nd_rich.sldd');
    const row = shownAt(o.root, 'ndCellMixed{1,1,2}');
    expect(row.valueEditable).toBe(true);
    const before = JSON.stringify(shownAt(o.root, 'ndCellMixed').serializeValue());
    MatlabVariableNode.prototype._refuseNoSize = function () {
      throw new MatWriteError('Cannot write "' + this.name + '": its size is no size. Nothing was written.');
    };
    try {
      const why = 'ndCellMixed{1,1,2} is held in the MAT stream of ndCellMixed, and the one ';
      expect(o.edit(row, 'Value', '[4 5]')).toMatchObject({ error: true, reason: 'Cannot edit "ndCellMixed": ' + why + 'this edit makes would not be written as typed: its size is no size.' });
      expect(o.edit(row.children[0], 'Value', '9')).toMatchObject({ error: true, reason: 'Cannot edit "ndCellMixed": ' + why + 'this edit makes would not be written as typed: its size is no size.' });
      expect(row._streamChildRefusal('add')).toBe('Cannot add an element to "ndCellMixed": ' + why + 'an Add leaves would not be written as it shows: its size is no size.');
      expect([row.canAddChild(), row.canRemoveChild()]).toEqual([false, false]);
      o.session.setActive(o.root, row);
      expect(o.session.addChildTo(row.id)).toBeNull();
      expect(o.session.deleteNodeById(row.children[0].id)).toBe(false);
    } finally {
      MatlabVariableNode.prototype._refuseNoSize = own;
    }
    expect([JSON.stringify(shownAt(o.root, 'ndCellMixed').serializeValue()), o.root.dirty]).toEqual([before, false]);
  });

  // The same values in the three formats (test/parity/artifacts): which members take a value edit and
  // a rename, and which an Add or a Remove.
  it('offers what a MAT-file and a binary dictionary offer of cases.sldd cellNd and structNd', () => {
    const flags = (file: string) => {
      const root = opened(new Uint8Array(readFileSync(file)), file.split('/').pop()).root;
      return (root.flatten() as Any[])
        .filter((n) => /^(cellNd|structNd)[({]/.test(n.matlabPath ?? ''))
        .map((n) => n.matlabPath + ' V' + +n.valueEditable + 'N' + +n.nameEditable + 'A' + +n.canAddChild() + 'R' + +!!n.parent?.canRemoveChild?.(n));
    };
    const text = flags('test/parity/artifacts/text/cases.sldd');
    expect(text.length).toBe(36);
    expect(text).toEqual(flags('test/parity/artifacts/binary/cases.sldd'));
    expect(text).toEqual(flags('test/parity/artifacts/mat/cases.mat'));
  });
});
