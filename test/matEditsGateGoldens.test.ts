// Copyright 2026 The MathWorks, Inc.
//
// The live gates of MAT-file object edits, held byte for byte: test/fixtures/mat-edits-gate/cases.json.
// Each case's edits were made through the session, as a host makes them, on a file MATLAB saved
// (an object of each class R2027a, R2023b and R2024b wrote, objects merged from R2023b's templates,
// strings, struct fields beside objects, a CoderInfo in either layout), and saved; and MATLAB loaded
// the saved file equal to its own assignment of the same edits on a fresh load of the original, with
// no warning, each variable alone equal, and a MATLAB re-save of it equal: in R2027a, and for the
// cross-release cases in R2023b and R2024b as well (each case's `verdicts`). Here the same edits,
// made again, must save that file, byte for byte; and the edits the save refused are refused,
// where MATLAB's own assignment warns.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

const FIXTURES = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');

interface GateCase {
  name: string;
  original: string;
  edits: [string, string, string][];
  matlab: string[];
  sha256?: string;
  refused?: string;
  verdicts: Record<string, 'PASS' | 'REFUSED_MATLAB_ERRS_OR_WARNS'>;
}
const CASES: GateCase[] = JSON.parse(readFileSync(join(FIXTURES, 'mat-edits-gate', 'cases.json'), 'utf8')).cases;

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The answers of `c`'s edits, made through the session on its original, and the file saved, or null where one was refused. */
function replay(c: GateCase): { answers: unknown[]; saved: Uint8Array | null } {
  const b = readFileSync(join(FIXTURES, c.original));
  const session = createSession();
  const root: any = session.addMatSource(c.name + '.mat', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const all: any[] = [];
  const walk = (n: any) => {
    all.push(n);
    n.children.forEach(walk);
  };
  root.children.forEach(walk);
  // Every node found before any edit: a rename moves a path.
  const nodes = c.edits.map(([path]) => all.find((n) => n.matlabPath === path));
  const answers = c.edits.map(([path, key, text], i) => {
    expect(nodes[i], c.name + ': ' + path).toBeDefined();
    session.setActive(root, nodes[i]);
    return session.editProperty(nodes[i].id, key, text);
  });
  if (!answers.every((a) => a === true)) {
    return { answers, saved: null };
  }
  return { answers, saved: (session.serializeSource(c.name + '.mat') as { bytes: Uint8Array }).bytes };
}

describe('each edit MATLAB judged in the live gates saves the file MATLAB loaded, byte for byte', () => {
  it('covers every class and kind of edit, in each release', () => {
    const releases = new Set(CASES.flatMap((c) => Object.keys(c.verdicts)));
    expect([...releases].sort()).toEqual(['R2023b', 'R2024b', 'R2027a']);
    const written = CASES.filter((c) => c.sha256);
    expect(written.length).toBeGreaterThanOrEqual(230);
    expect(written.every((c) => Object.values(c.verdicts).every((v) => v === 'PASS'))).toBe(true);
    expect(CASES.filter((c) => c.refused).every((c) => Object.values(c.verdicts).every((v) => v === 'REFUSED_MATLAB_ERRS_OR_WARNS'))).toBe(true);
  });

  for (const c of CASES) {
    it(`${c.name}: ${c.matlab.join(' ')}`, () => {
      const { answers, saved } = replay(c);
      if (c.refused) {
        expect(answers.find((a) => a !== true)).toMatchObject({ error: true, reason: c.refused });
        return;
      }
      expect(answers).toEqual(c.edits.map(() => true));
      expect(sha(saved!)).toBe(c.sha256);
    });
  }
});
