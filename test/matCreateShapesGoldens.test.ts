// Copyright 2026 The MathWorks, Inc.
//
// The creation gate of the file shapes that earlier codec bugs broke, held byte for byte:
// test/fixtures/mat-create-gate/shapes.json. Each target is a shape a new object needs something of
// that the other creation gates' targets never asked for:
//   - an enum-only file whose object table is empty (no null object 0, no null property list), and
//     one of a logical-based enumeration;
//   - -v6 files holding objects, made by R2024b and by R2027a;
//   - a file of a header and no record;
//   - a file with no null constructor-argument list (two ConfigSets and an object holder);
//   - an R2024b-made file of a Parameter, a Signal, a Bus of two elements and a string, its own
//     objects edited too.
// Into each, each class a host is offered was created alone, and a new Bus given two elements, the
// second edited, all through the session; and MATLAB loaded each saved file in R2027a, R2023b and
// R2024b (each case's `verdicts`) with no warning its original does not give, every new variable
// equal to MATLAB's own object of its class, every edited one to its original with the same
// assignments, every other one to its original, each one alone equal, a save of what it loaded
// reloading equal, and every object valid: none loaded as a deleted handle. Here the same steps
// must save that file again, byte for byte.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

const TEST = fileURLToPath(new URL('.', import.meta.url));

/** One step of a case, made through the session: a variable added (and its rows edited, its Bus elements added), or an edit of one the file holds. */
type Step =
  | { op: 'add'; class: string; name: string; edits?: [string, string][]; elements?: [string, string][][] }
  | { op: 'element'; of: string; edits: [string, string][] }
  | { op: 'removeElement'; of: string; index: number }
  | { op: 'edit'; of: string; edits: [string, string][] };

interface ShapeCase {
  name: string;
  target: string;
  steps: Step[];
  sha256: string;
  verdicts: Record<string, 'PASS'>;
}
const DOC = JSON.parse(readFileSync(TEST + 'fixtures/mat-create-gate/shapes.json', 'utf8')) as { cases: ShapeCase[] };

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The file `c.target`, `c`'s steps made on it through the session, saved. */
function replayed(c: ShapeCase): Uint8Array {
  const b = readFileSync(TEST + c.target);
  const session = createSession();
  const root: any = session.addMatSource('f.mat', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const by = (name: string): any => root.children.find((n: any) => n.name === name);
  const edit = (node: any, edits: [string, string][] = []) => {
    for (const [key, text] of edits) {
      session.setActive(root, node);
      expect(session.editProperty(node.id, key, text), `${c.name}: ${node.matlabPath} ${key} = ${text}`).toBe(true);
    }
  };
  const addElement = (bus: any): any => {
    session.setActive(root, bus);
    const row = session.addChildTo(bus.id);
    expect(row, `${c.name}: an element of ${bus.matlabPath}`).not.toBeNull();
    return row;
  };
  for (const step of c.steps) {
    switch (step.op) {
      case 'add': {
        session.setActiveContext(root);
        const node: any = session.addEntry('', step.class, step.name);
        expect(node, `${c.name}: ${step.class} ${step.name}`).not.toBeNull();
        edit(node, step.edits);
        for (const edits of step.elements ?? []) {
          edit(addElement(node), edits);
        }
        break;
      }
      case 'element':
        edit(addElement(by(step.of)), step.edits);
        break;
      case 'removeElement': {
        const row = by(step.of).children[step.index];
        session.setActive(root, row);
        expect(session.deleteNodeById(row.id), `${c.name}: ${row.matlabPath} removed`).toBe(true);
        break;
      }
      case 'edit':
        edit(by(step.of), step.edits);
        break;
    }
  }
  return (session.serializeSource('f.mat') as { bytes: Uint8Array }).bytes;
}

describe('each file of the shapes creation gate judged saves again, byte for byte', () => {
  it('covers every shape, each case passed in R2027a, R2023b and R2024b', () => {
    const shapes = new Set(DOC.cases.map((c) => c.name.split('__')[1]));
    expect([...shapes].sort()).toEqual(['configset', 'enum_only_r2024b', 'enum_onoff_r2024b', 'header_only', 'mixed_r2024b', 'v6_objects_r2024b', 'v6_objects_r2027a']);
    expect(DOC.cases.length).toBeGreaterThanOrEqual(50);
    for (const c of DOC.cases) {
      expect(c.verdicts, c.name).toEqual({ R2027a: 'PASS', R2023b: 'PASS', R2024b: 'PASS' });
    }
  });

  for (const c of DOC.cases) {
    it(c.name, () => {
      expect(sha(replayed(c))).toBe(c.sha256);
    });
  }
});
