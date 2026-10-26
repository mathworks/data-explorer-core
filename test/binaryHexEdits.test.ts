// Copyright 2026 The MathWorks, Inc.
//
// A binary dictionary's `Encoding="hex"` value of plain values and sparse arrays takes edits as the
// same value read as XML, or out of a MAT-file, does (MatlabVariableNode._rewritesEncoded): the rows
// of a sparse array, a struct's and a cell's members and fields. MATLAB writes an entry as hex where
// its value holds a sparse array anywhere, and every row under one was read-only, where a MAT-file's
// sparse array took an edit of each non-zero. Edited, the value is written anew: as its XML with each
// sparse array the hex element of its own stream, or whole as that stream; and undone, as the hex it
// was read as (_encodedReadAgain).
//
// Over every such value of every binary dictionary fixture, at every row under it: a value edit, an
// Add, a Remove and a field's rename, each where it is offered, taken, saved, read back as it shows,
// and undone to the bytes read. A hex value holding an object or a function handle is read-only as
// before (test/encodedValueWriteBack.test.ts, test/hexObjectFixtures.test.ts).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
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

function opened(bytes: Uint8Array, filename: string) {
  const session = createSession();
  const root: Any = ingest(session, ab(bytes), { filename });
  const save = (): Uint8Array => (session.serializeSource(root.name) as Any).bytes;
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
const subtree = (n: Any): Any[] => [n, ...(n.children ?? []).flatMap(subtree)];

/** The `<P Name="Value" ...>` element of the entry `name` in a binary dictionary's bytes. */
function valueTag(zip: Uint8Array, name: string): string {
  const xml = new TextDecoder().decode(unzipSync(zip)['data/chunk0.xml']);
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  const from = xml.indexOf('<P Name="Value"', at);
  return xml.slice(from, xml.indexOf('</Object>', from));
}

// Another value of the kind a row shows, typed as its text, and never a zero (a sparse array's row
// set to zero is no non-zero of it, and is not written: test/sparseNonzeros.test.ts); none for a
// logical sparse array's row, whose one non-zero value is the true it holds.
function another(row: Any): string | null {
  const shown = String(row.displayValue);
  if (row.parent?._sparse && row.parent._scalarType === 'logical') return null;
  if (shown === 'true' || shown === 'false') return shown === 'true' ? 'false' : 'true';
  if (/i$/.test(shown) && /\d/.test(shown)) return shown === '5-6i' ? '7-8i' : '5-6i';
  if (/^'.*'$/.test(shown)) return shown === "'z'" ? "'y'" : "'z'";
  return shown === '7' ? '8' : '7';
}

// Every hex value that takes edits, in every binary dictionary fixture.
const HOLDERS: { file: string; path: number[]; entry: string; label: string }[] = [];
for (const file of slddUnder('test')) {
  let root: Any;
  try {
    root = opened(new Uint8Array(readFileSync(file)), file.split('/').pop()!).root;
  } catch {
    continue;
  }
  if (root.sourceFormat !== 'xml') continue;
  for (const n of root.flatten() as Any[]) {
    if (n._encodedRead && n._rewritesEncoded?.()) {
      HOLDERS.push({ file, path: pathOf(n), entry: (n.owningEntry ?? n).name, label: file.split('/').pop() + ' ' + n.matlabPath });
    }
  }
}

describe("a binary dictionary's hex value of plain values", () => {
  it('is found in the fixtures', () => {
    // Measured when this was written: 49, over sparse_binary.sldd, hexobj_binary.sldd, the parity
    // fixtures' values_binary.sldd of both releases and others.
    expect(HOLDERS.length).toBeGreaterThanOrEqual(45);
  });

  it('takes every edit it offers under it, which a save writes, a reopen reads back, and an undo takes back to the hex read', () => {
    const wrong: string[] = [];
    const made = { value: 0, add: 0, remove: 0, rename: 0 };
    for (const { file, path, entry, label } of HOLDERS) {
      const bytes = new Uint8Array(readFileSync(file));
      const name = file.split('/').pop()!;
      const fresh = () => opened(bytes, name);
      const read = valueTag(bytes, entry);
      const rows = subtree(nodeAt(fresh().root, path));
      const asks: [keyof typeof made, Any, (o: ReturnType<typeof fresh>, n: Any) => unknown][] = [];
      for (const row of rows) {
        if (row.valueEditable && another(row) !== null) asks.push(['value', row, (o, n) => o.edit(n, 'Value', another(n)!)]);
        if (row.canAddChild()) asks.push(['add', row, (o, n) => (o.session.setActive(o.root, n), o.session.addChildTo(n.id) ? true : 'refused')]);
        if (row !== rows[0] && row.parent?.canRemoveChild?.(row)) asks.push(['remove', row, (o, n) => (o.session.setActive(o.root, n), o.session.deleteNodeById(n.id) || 'refused')]);
        if (row !== rows[0] && row.nameEditable) asks.push(['rename', row, (o, n) => o.edit(n, 'Name', 'zz' + n.name)]);
      }
      for (const [kind, row, make] of asks) {
        const o = fresh();
        const node = nodeAt(o.root, pathOf(row));
        const what = label + ' ' + kind + ' ' + node.matlabPath;
        const r = make(o, node);
        if (r !== true) {
          wrong.push(what + ': refused ' + JSON.stringify(r));
          continue;
        }
        made[kind]++;
        // Every row of the value as it shows, read again.
        const saved = o.save();
        const now = subtree(nodeAt(o.root, path)).map((n: Any) => n.matlabPath + '=' + n.displayValue);
        const again = subtree(nodeAt(opened(saved, name).root, path)).map((n: Any) => n.matlabPath + '=' + n.displayValue);
        if (JSON.stringify(now) !== JSON.stringify(again)) wrong.push(what + ': its rows read back otherwise: ' + JSON.stringify([now, again]).slice(0, 300));
        if (valueTag(saved, entry) === read) wrong.push(what + ': saved as the hex it was read as');
        o.session.setActive(o.root, null);
        o.session.undo();
        if (valueTag(o.save(), entry) !== read) wrong.push(what + ': undone, the value is not written as it was read');
      }
    }
    expect(wrong).toEqual([]);
    // Measured when this was written: 73 value edits, 9 Adds, 10 Removes and 4 renames.
    expect(made.value).toBeGreaterThanOrEqual(70);
    expect(made.add).toBeGreaterThanOrEqual(8);
    expect(made.remove).toBeGreaterThanOrEqual(9);
    expect(made.rename).toBeGreaterThanOrEqual(4);
  }, 300_000);

  // The parity fixtures' sparse arrays, as a MAT-file of the same values offers them.
  it('offers what a MAT-file offers of the parity fixtures sparse arrays, and a text dictionary', () => {
    const flags = (file: string) => {
      const root = opened(new Uint8Array(readFileSync(file)), file.split('/').pop()!).root;
      return (root.flatten() as Any[])
        .filter((n) => /^spMatrix/.test(n.matlabPath ?? '') && n.parent?._sparse)
        .map((n) => n.matlabPath + ' V' + +n.valueEditable);
    };
    const binary = flags('test/fixtures/edit-bash/r2027a/values_binary.sldd').sort();
    expect(binary).toEqual(['spMatrix(1,1) V1', 'spMatrix(2,2) V1', 'spMatrixInCell{1}(1,1) V1', 'spMatrixInCell{1}(2,2) V1', 'spMatrixInStruct.v(1,1) V1', 'spMatrixInStruct.v(2,2) V1']);
    for (const file of ['r2023b/values_binary.sldd', 'r2027a/values_text.sldd', 'r2027a/values.mat', 'r2023b/values.mat']) {
      expect(flags('test/fixtures/edit-bash/' + file).sort(), file).toEqual(binary);
    }
  });
});
