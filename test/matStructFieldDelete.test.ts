// Copyright 2026 The MathWorks, Inc.
//
// A field of a MAT-file's 1x1 struct deleted, at any depth, as MATLAB's rmfield deletes it and as a
// text or a binary dictionary deletes one. A MAT-file's struct is a MatlabVariableNode of kind
// 'scalar', which offered no delete of any field, and gave no reason. A struct array's field, and an
// element of one, stay refused, as the dictionaries refuse them, in their words. An undone delete,
// or an undone Add, saves the file as it was read: the delete marked the variable edited, so its
// undo saved it fresh, equal but not the same bytes.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));

function opened(file: string, given?: Uint8Array) {
  const session = createSession();
  const bytes = given ?? new Uint8Array(readFileSync(file.startsWith('/') ? file : join(TEST_ROOT, '..', file)));
  const root: any = ingest(session, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { filename: file.split('/').pop()! });
  const at = (path: string) => root.flatten().find((n: any) => n.matlabPath === path && !n.isContainer);
  const save = (): Uint8Array => {
    const out: any = session.serializeSource(root.name);
    return out.bytes ?? new TextEncoder().encode(out.text);
  };
  const undo = () => {
    session.setActive(root, null);
    session.undo();
  };
  const redo = () => {
    session.setActive(root, null);
    session.redo();
  };
  return { session, root, at, save, undo, redo, reopen: () => opened(file, save()) };
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

// A variable's rows, each its path and its text, under it and at it.
function rowsOf(root: any, path: string): string[] {
  const under = (p: string) => p === path || ['.', '{', '('].some((c) => p.startsWith(path + c));
  return root.flatten().filter((n: any) => !n.isContainer && under(n.matlabPath)).map((n: any) => n.matlabPath + ' = ' + n.displayValue);
}

describe('a field of a MAT-file 1x1 struct', () => {
  for (const release of ['r2027a', 'r2023b']) {
    for (const file of ['plain', 'objects', 'strings']) {
      const path = `test/fixtures/string-containers/${release}/${file}.mat`;
      for (const [field, holder] of [['st.a', 'st'], ['nest.c', 'nest'], ['nest.c{2}.g', 'nest.c{2}']]) {
        it(`${release} ${file}.mat: ${field} is deleted, saved as rmfield leaves ${holder}, and undone to the file as read`, () => {
          const o = opened(path);
          const read = o.save();
          const rowsBefore = rowsOf(o.root, holder);
          const others = o.root.children.filter((v: any) => v.name !== field.split(/[.{]/)[0]).map((v: any) => rowsOf(o.root, v.name));
          const node = o.at(field);
          expect(o.session.deleteRefusal(node.id)).toBeNull();
          expect(o.session.deleteNodeById(node.id)).toBe(true);
          const first = o.save();
          const back = o.reopen();
          const fieldRows = rowsBefore.filter((r) => r.startsWith(field + ' ') || ['.', '{', '('].some((c) => r.startsWith(field + c)));
          expect(rowsOf(back.root, holder)).toEqual(rowsBefore.filter((r) => !fieldRows.includes(r)));
          // Every other variable as it was.
          expect(back.root.children.filter((v: any) => v.name !== field.split(/[.{]/)[0]).map((v: any) => rowsOf(back.root, v.name))).toEqual(others);
          o.undo();
          expect(same(o.save(), read)).toBe(true);
          o.redo();
          expect(same(o.save(), first)).toBe(true);
        });
      }
    }
  }

  it('is deleted to a struct of no field, as rmfield of the last one leaves it', () => {
    const o = opened('test/parity/artifacts/mat/cases.mat');
    expect(o.session.deleteNodeById(o.at('structNest.a.b').id)).toBe(true);
    const back = o.reopen();
    expect(rowsOf(back.root, 'structNest')).toEqual(['structNest = <1x1 struct>', 'structNest.a = <1x1 struct>']);
    expect(back.at('structNest.a').children).toEqual([]);
  });

  it('holding a string or an object, is deleted, the struct written without it', () => {
    for (const [file, field, left] of [
      ['test/fixtures/string-containers/r2027a/strings.mat', 'st2.b', ['st2 = <1x1 struct>', 'st2.a = 1']],
      ['test/fixtures/mat-allowlist/al_nested.mat', 's.p', ['s = <1x1 struct>', 's.k = 1']],
    ] as const) {
      const o = opened(file);
      expect(o.session.deleteNodeById(o.at(field).id)).toBe(true);
      expect(rowsOf(o.reopen().root, field.split('.')[0])).toEqual(left);
    }
  });

  it('of a struct array, or an element of one, is refused as a dictionary refuses it, in its words', () => {
    for (const file of ['test/parity/artifacts/mat/cases.mat', 'test/parity/artifacts/text/cases.sldd', 'test/parity/artifacts/binary/cases.sldd']) {
      const o = opened(file);
      expect(o.session.deleteRefusal(o.at('struct1x3(2).a').id)).toBe(
        'Cannot delete "struct1x3(2).a": "struct1x3(2)" is an element of the struct array "struct1x3", whose elements all have the same fields. Nothing was deleted.',
      );
      expect(o.session.deleteRefusal(o.at('struct1x3(2)').id)).toBe(
        'Cannot delete "struct1x3(2)": "struct1x3" is a 1x3 struct array, whose elements are not deleted one at a time. Nothing was deleted.',
      );
      expect(o.session.addChildRefusal(o.at('struct1x3').id)).toBe(
        'Cannot add to "struct1x3": it is a 1x3 struct array, whose elements all have the same fields. Nothing was added.',
      );
      expect(o.session.deleteNodeById(o.at('struct1x3(2).a').id)).toBe(false);
    }
  });

  it('that the file could not write fresh is refused, saying why', () => {
    const o = opened('test/fixtures/display/nested_handles.mat');
    expect(o.session.deleteRefusal(o.at('s_fh.num').id)).toBe(
      'Cannot delete "s_fh.num": s_fh.named is a function handle, which this package cannot write into a MAT-file. Nothing was deleted.',
    );
  });
});

describe('every 1x1 struct field of every MAT fixture', () => {
  it('is deleted, saved and read back without it, and undone to the file as read; or refused, saying why', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.mat')) files.push(p);
      }
    };
    walk(join(TEST_ROOT, 'fixtures'));
    walk(join(TEST_ROOT, 'parity'));
    let deleted = 0;
    let refused = 0;
    const wrong: string[] = [];
    for (const file of files.sort()) {
      let o: ReturnType<typeof opened>;
      try {
        o = opened(file);
      } catch {
        continue;
      }
      const fields = o.root.flatten().filter((n: any) => n.parent && !n.parent.isContainer && n.parent.constructor.name === 'MatlabVariableNode' && n.parent._holdsFields());
      for (const path of fields.slice(0, 40).map((n: any) => n.matlabPath)) {
        const short = file.slice(TEST_ROOT.length) + ' ' + path;
        const node = o.at(path);
        if (!node) continue;
        const why = o.session.deleteRefusal(node.id);
        if (why) {
          refused++;
          if (!why.startsWith('Cannot delete "' + path + '": ')) wrong.push(short + ': ' + why);
          continue;
        }
        const read = o.save();
        const holder = node.parent.matlabPath;
        const names = node.parent.children.map((c: any) => c.name).filter((n: string) => n !== node.name);
        expect(o.session.deleteNodeById(node.id)).toBe(true);
        deleted++;
        let back: ReturnType<typeof opened>;
        try {
          back = o.reopen();
        } catch (e) {
          wrong.push(short + ': the save threw ' + (e as Error).message);
          o.undo();
          continue;
        }
        const now = back.at(holder);
        if (!now || now.children.map((c: any) => c.name).join(',') !== names.join(',')) wrong.push(short + ': reads back with ' + (now ? now.children.map((c: any) => c.name).join(',') : 'no ' + holder));
        o.undo();
        if (!same(o.save(), read)) wrong.push(short + ': its undo saves other bytes than the file read');
      }
    }
    expect(wrong).toEqual([]);
    expect(deleted).toBeGreaterThanOrEqual(300);
    expect(refused).toBeGreaterThanOrEqual(140);
  }, 240_000);
});

describe('an undone Add or delete of an element', () => {
  it('saves a MAT-file as it was read, where it saved the variable fresh', () => {
    const o = opened('test/parity/artifacts/mat/cases.mat');
    const read = o.save();
    for (const [op, path] of [['delete', 'cellFlat{2}'], ['add', 'cellFlat'], ['delete', 'rowVec(2)'], ['add', 'rowVec'], ['add', 'structScalar']] as const) {
      const node = o.at(path);
      expect(op === 'delete' ? o.session.deleteNodeById(node.id) : !!o.session.addChildTo(node.id)).toBe(true);
      expect(same(o.save(), read)).toBe(false);
      o.undo();
      expect(same(o.save(), read)).toBe(true);
    }
  });
});
