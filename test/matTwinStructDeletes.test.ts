// Copyright 2026 The MathWorks, Inc.
//
// Fields deleted one after another from the struct Value of a Simulink.Parameter a MAT-file holds
// several times (p1, p2 and s.p one handle: test/fixtures/mat-twins, make_twins.m). Each twin's
// rows show each delete, as the save writes it. The second delete showed in the twin it was made
// in only (F5 of the review of struct-parity): the first delete's copy into the others
// (mcosObjectEdit.copyObjectProperty) adopted the value as written, which shared the lists the
// struct's node edits in place, so after the second the twins read alike and nothing was copied.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const FILE = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/mat-twins/twins.mat');

function opened(bytes = new Uint8Array(readFileSync(FILE))) {
  const session = createSession();
  const root: any = session.addMatSource('twins.mat', bytes.slice().buffer);
  const at = (path: string) => root.flatten().find((n: any) => n.matlabPath === path);
  const save = (): Uint8Array => (session.serializeSource('twins.mat') as { bytes: Uint8Array }).bytes;
  const undo = () => {
    session.setActive(root, null);
    session.undo();
  };
  return { session, root, at, save, undo };
}

// The fields a twin's Value rows show.
const fields = (o: ReturnType<typeof opened>, twin: string) => o.at(twin + '.Value').children.map((c: any) => c.name);

describe('fields deleted one after another from a Parameter a MAT-file holds three times', () => {
  for (const twin of ['p1', 'p2', 's.p']) {
    it(`${twin}.Value.b, then ${twin}.Value.c: every twin shows each, and the save writes it`, () => {
      const o = opened();
      const read = o.save();
      expect(o.session.deleteNodeById(o.at(twin + '.Value.b').id)).toBe(true);
      for (const t of ['p1', 'p2', 's.p']) expect(fields(o, t), t).toEqual(['a', 'c']);
      expect(o.session.deleteNodeById(o.at(twin + '.Value.c').id)).toBe(true);
      for (const t of ['p1', 'p2', 's.p']) expect(fields(o, t), t).toEqual(['a']);
      const back = opened(o.save());
      for (const t of ['p1', 'p2', 's.p']) expect(fields(back, t), t + ' read back').toEqual(['a']);
      o.undo();
      o.undo();
      for (const t of ['p1', 'p2', 's.p']) expect(fields(o, t), t + ' undone').toEqual(['a', 'b', 'c']);
      expect(Buffer.from(o.save()).equals(Buffer.from(read))).toBe(true);
    });
  }

  it('through another of them, once one is edited, is refused, saying through which the object is edited', () => {
    const o = opened();
    expect(o.session.deleteNodeById(o.at('p1.Value.b').id)).toBe(true);
    expect(o.session.deleteRefusal(o.at('p2.Value.c').id)).toBe(
      'Cannot delete "p2.Value.c": p2 is one object with p1 (one handle), and p1 holds an edit of it: the object is edited through p1, and p2 shows each edit. Nothing was deleted.',
    );
    expect(o.session.deleteNodeById(o.at('p2.Value.c').id)).toBe(false);
  });
});
