// Copyright 2026 The MathWorks, Inc.
//
// Over every struct field and cell element of every MAT-file the test tree holds, at any depth:
// one typed over as a string, or a string one typed over as a number, is taken exactly where a
// save writes it and a reopen reads back what the row then shows; undone, the save is the file as
// it was read. One not taken changes nothing, and says why. A row that offers no editor is not
// asked (MatNode._retype, matStringMember.test.ts).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { mcosPlaceOf } from '../src/datamodel/node/mcosPlace.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

function matsUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...matsUnder(p));
    else if (e.name.endsWith('.mat')) out.push(p);
  }
  return out.sort();
}

function opened(bytes: Uint8Array) {
  const session = createSession();
  const root: any = session.addMatSource('m.mat', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const at = (path: string) => root.flatten().find((n: any) => n.matlabPath === path);
  const save = (): Uint8Array => (session.serializeSource('m.mat') as { bytes: Uint8Array }).bytes;
  // What a save hands back, or the refusal it throws, as text: for a file no save writes.
  const saved = (): string => {
    try {
      return Array.from(save()).join(',');
    } catch (e) {
      return 'refused: ' + (e as Error).message;
    }
  };
  return { session, root, at, save, saved };
}

// A struct field or a cell element: a row of a cell, or of a struct that holds fields.
const isMember = (n: any, root: any) => n.parent && n.parent !== root && (n.parent._kind === 'cell' || n.parent._holdsFields?.());
// Of a value no object holds, nor is: what a retype swaps (MatNode._memberHolder).
const plainBelow = (n: any, root: any) => {
  for (let p = n.parent; p && p !== root; p = p.parent) {
    if (mcosPlaceOf(p)) return false;
  }
  return true;
};
// What a member is to the edit: a string, a plain value, or an object (or one held under an object).
const kindOf = (n: any, root: any): 'string' | 'plain' | 'object' => {
  if (n.className === 'string') return 'string';
  if (mcosPlaceOf(n) || !plainBelow(n, root) || !n._kind) return 'object';
  return 'plain';
};

describe('every struct field and cell element of every MAT-file fixture', () => {
  it('takes a string, or a number over a string, exactly where the save writes it and a reopen reads it', { timeout: 300_000 }, () => {
    const wrong: string[] = [];
    let retyped = 0;
    let unstrung = 0;
    let taken = 0;
    let refused = 0;
    let unoffered = 0;
    const unopened: string[] = [];
    let files = 0;
    for (const file of matsUnder(TEST_ROOT)) {
      const bytes = new Uint8Array(readFileSync(file));
      let members: { path: string; kind: 'string' | 'plain' | 'object'; offered: boolean }[];
      try {
        const { root } = opened(bytes);
        members = root.flatten().filter((n: any) => isMember(n, root)).map((n: any) => ({
          path: n.matlabPath,
          kind: kindOf(n, root),
          offered: !!n.valueEditable,
        }));
      } catch (e) {
        unopened.push(file.slice(TEST_ROOT.length) + ': ' + (e as Error).message);
        continue;
      }
      files++;
      // A row that offers no editor is not asked: a host types into none (an object's typed node,
      // a Bus say, whose Value the structural gates ask for its Elements, takes the text through
      // the session's API and the save refuses it, before this change as after; notes "## T").
      unoffered += members.filter((m) => !m.offered).length;
      for (const { path, kind } of members.filter((m) => m.offered)) {
        const typed = kind === 'string' ? '5' : '"abc"';
        const label = file.slice(TEST_ROOT.length) + ' ' + path + ' = ' + typed;
        const { session, root, at, save, saved: savedNow } = opened(bytes);
        const node = at(path);
        const before = savedNow();
        session.setActive(root, node);
        const r: any = session.editProperty(node.id, 'Value', typed);
        if (r !== true) {
          // Refused: said why, and nothing changed.
          refused++;
          if (!r?.reason || root.dirty || savedNow() !== before) wrong.push(label + ': refused, yet changed or said nothing: ' + JSON.stringify(r));
          continue;
        }
        taken++;
        const now = at(path);
        const shown = [now.className, now.displayValue];
        if (kind === 'plain') {
          retyped++;
          if (shown.join(' ') !== 'string "abc"') wrong.push(label + ': shows ' + shown.join(' '));
        } else if (kind === 'string') {
          unstrung++;
          if (shown.join(' ') !== 'double 5') wrong.push(label + ': shows ' + shown.join(' '));
        }
        let saved: Uint8Array;
        try {
          saved = save();
        } catch (e) {
          wrong.push(label + ': taken, and the save refused it: ' + (e as Error).message);
          continue;
        }
        const back = opened(saved).at(path);
        if (!back || back.className !== shown[0] || back.displayValue !== shown[1]) {
          wrong.push(label + ': reopened ' + (back ? back.className + ' ' + back.displayValue : 'without it') + ', showed ' + shown.join(' '));
        }
        session.undo();
        if (!sameBytes(save(), bytes)) wrong.push(label + ': undone, the save is not the file as read');
      }
    }
    expect(wrong).toEqual([]);
    // Every fixture opens but the one this package does not read at all, so a file it stops reading
    // is not passed over here unseen.
    expect(unopened).toEqual(['fixtures/strings_v73.mat: MAT-file version 7.3 (HDF5) is not supported']);
    // At least what was measured when this was written: 593 files opened; 557 rows offered an editor
    // and every one took the edit, 489 of them plain values made strings and 24 strings made numbers
    // (the rest objects' Values, set as they were); 322 rows offered none.
    expect(files).toBeGreaterThanOrEqual(593);
    expect(taken).toBeGreaterThanOrEqual(557);
    expect(retyped).toBeGreaterThanOrEqual(489);
    expect(unstrung).toBeGreaterThanOrEqual(24);
    expect(unoffered).toBeGreaterThanOrEqual(322);
    expect(refused).toBe(0);
  });
});
