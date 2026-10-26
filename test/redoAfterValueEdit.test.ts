// Copyright 2026 The MathWorks, Inc.
//
// A redo after a value typed whole, in a MAT-file and in a text and a binary dictionary. The redo
// of the edit ran the setter again, which built the value's rows anew, so a later step's redo (a
// row deleted or added, an element edited) acted on a row no longer in the tree and was lost:
// c1 = {3}, typed {1, 2}, c1{1} deleted, undone twice and redone twice, was {1, 2}. The redo puts
// the value back as the edit left it, its very rows (DataModel.editProperty, redoRestore).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));

function opened(file: string, given?: Uint8Array) {
  const session = createSession();
  const bytes = given ?? new Uint8Array(readFileSync(join(TEST_ROOT, '..', file)));
  const root: any = ingest(session, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { filename: file.split('/').pop()! });
  const at = (path: string) => root.flatten().find((n: any) => n.matlabPath === path && !n.isContainer);
  const save = (): Uint8Array => {
    const out: any = session.serializeSource(root.name);
    return out.bytes ?? new TextEncoder().encode(out.text);
  };
  const step = ([op, path, text]: Step) => {
    const node = at(path);
    if (op === 'edit') {
      session.setActive(root, node);
      return session.editProperty(node.id, 'Value', text!);
    }
    return op === 'add' ? !!session.addChildTo(node.id) : session.deleteNodeById(node.id);
  };
  const undo = () => {
    session.setActive(root, null);
    session.undo();
  };
  const redo = () => {
    session.setActive(root, null);
    session.redo();
  };
  return { session, root, at, save, step, undo, redo, reopen: () => opened(file, save()) };
}

type Step = ['edit' | 'add' | 'delete', string, string?];

// Each: the value, the steps, and what they leave.
const CASES: [string, Step[], string][] = [
  ['cellFlat', [['edit', 'cellFlat', '{1, 2}'], ['delete', 'cellFlat{1}']], '{2}'],
  ['cellFlat', [['edit', 'cellFlat', '{1, 2}'], ['add', 'cellFlat'], ['edit', 'cellFlat{3}', '7']], '{1, 2, 7}'],
  ['cellFlat', [['edit', 'cellFlat', '{1, 2}'], ['edit', 'cellFlat{1}', '5'], ['delete', 'cellFlat{2}']], '{5}'],
  ['rowVec', [['edit', 'rowVec', '[1 2 3]'], ['delete', 'rowVec(1)'], ['edit', 'rowVec(1)', '9']], '[9 3]'],
  ['strArray', [['edit', 'strArray', '["p" "q"]'], ['delete', 'strArray(2)']], '"p"'],
  ['strArray', [['edit', 'strArray', '["p" "q"]'], ['add', 'strArray'], ['edit', 'strArray(3)', '"r"']], '["p" "q" "r"]'],
];

describe('every step redone after a value typed whole', () => {
  for (const file of ['test/parity/artifacts/mat/cases.mat', 'test/parity/artifacts/text/cases.sldd', 'test/parity/artifacts/binary/cases.sldd']) {
    for (const [path, steps, left] of CASES) {
      it(`${file.split('/').slice(-2).join('/')}: ${steps.map((s) => s.join(' ')).join(', ')} ends ${left}, undone and redone`, () => {
        const o = opened(file);
        for (const s of steps) expect(o.step(s), s.join(' ')).toBe(true);
        expect(o.at(path).displayValue).toBe(left);
        const done = o.save();
        steps.forEach(() => o.undo());
        steps.forEach(() => o.redo());
        expect(o.at(path).displayValue).toBe(left);
        expect(o.reopen().at(path).displayValue).toBe(left);
        // A MAT-file's save holds no stamp of when: the redone file is the one the steps saved.
        if (file.endsWith('.mat')) expect(Buffer.from(o.save()).equals(Buffer.from(done))).toBe(true);
      });
    }
  }
});

// G1 of the re-check: the redo of a value typed whole put back, by reference, the element list a
// later delete then spliced in place, and that delete's collapse to one element replaced. Undone and
// redone twice, [1 2] with its first element deleted was [] with a row of 2, and a MAT-file's save
// threw ("numeric value has 1 elements but declares [1,0]"); a dictionary saved [ ]. The node's own
// state is held by value now (DataNode._ownStateRestorer).
describe('a value typed whole, then an element deleted down to one, undone and redone twice', () => {
  const E = 'test/fixtures/edit-bash/';
  const CASES: [string, string, string, string][] = [
    ['dRow', '[1 2]', 'dRow(1)', '2'],
    ['dRow', '[1 2]', 'dRow(2)', '1'],
    ['lArray', '[true false]', 'lArray(1)', 'false'],
    ['sglRow', '[1 2]', 'sglRow(1)', '2'],
    ['strRow', '["x" "y"]', 'strRow(1)', '"y"'],
    ['pInt8.Value', '[4 5]', 'pInt8.Value(1)', '5'],
  ];
  for (const file of ['r2027a/values.mat', 'r2023b/values.mat', 'r2027a/values_text.sldd', 'r2027a/values_binary.sldd']) {
    for (const [path, typed, element, left] of CASES) {
      it(`${file}: ${path} := ${typed}, ${element} deleted, undone and redone twice, is ${left}, and saves`, () => {
        const o = opened(E + file);
        expect(o.step(['edit', path, typed])).toBe(true);
        expect(o.step(['delete', element])).toBe(true);
        const holder = path.endsWith('.Value') ? path.slice(0, -'.Value'.length) : path;
        const shown = () => o.at(path)?.displayValue ?? o.at(holder).toRow().Value?.text ?? o.at(holder).displayValue;
        expect(shown()).toBe(left);
        o.undo();
        o.undo();
        o.redo();
        o.redo();
        expect(shown()).toBe(left);
        expect(o.at(path)?.children?.length ?? 0).toBe(0);
        const back = o.reopen();
        expect(back.at(path)?.displayValue ?? back.at(holder).toRow().Value?.text ?? back.at(holder).displayValue).toBe(left);
      });
    }
  }
});

describe('an undo or a redo whose setter refuses what it sets again', () => {
  // Where the node holds no restorer of the value as it stood (a Parameter's Min), the undo and the
  // redo set it again through its setter; refused, they did nothing and said nothing.
  it('says why, thrown, and stays where it was, to be tried again', () => {
    const o = opened('test/parity/artifacts/text/cases.sldd');
    const p = o.at('aParam');
    o.session.setActive(o.root, p);
    expect(o.session.editProperty(p.id, 'Min', '-5')).toBe(true);
    const set = p.setProperty.bind(p);
    const refuse = (_key: string, text: string) => ({ error: true, reason: 'Cannot edit "aParam": it is held to refuse this.', invalidValue: text, validValue: '' });
    p.setProperty = refuse;
    o.session.setActive(o.root, null);
    expect(() => o.session.undo()).toThrow('Cannot undo the edit of Min of "aParam": it is held to refuse this.');
    expect([o.session.canUndo(), o.session.canRedo()]).toEqual([true, false]);
    p.setProperty = set;
    o.session.undo();
    expect([o.session.canUndo(), o.session.canRedo()]).toEqual([false, true]);
    p.setProperty = refuse;
    expect(() => o.session.redo()).toThrow('Cannot redo the edit of Min of "aParam": it is held to refuse this.');
    expect(o.session.canRedo()).toBe(true);
  });
});
