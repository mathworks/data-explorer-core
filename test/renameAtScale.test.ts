// Copyright 2026 The MathWorks, Inc.
//
// F1-23: renaming every entry of a large dictionary, one rename at a time. A corpus file of a
// real shape (a binary dictionary of 140,000 entries, all in Design Data) took more than 300 s
// to rename whole, and the profile named two costs, one per route a host renames through:
//
//   1. setProperty('Name') — what a host that edits nodes directly calls, inside mutateSubtree.
//      The duplicate-name check built the names of the whole shared namespace (Design and
//      Architectural Data) into an array and scanned it, on every rename: O(N) a rename, O(N^2)
//      for all of them. 97% of the time.
//   2. session.editProperty — the session-level form. It announced every edit as
//      'node/children-changed', which rebuilt the session's WHOLE node index (every node of every
//      open file), on every edit and on its undo and redo.
//
// Each case gives the work a deadline far beyond what it needs once it is fixed, and stops when it
// passes, so that what it reports before the fix is how far it got rather than a timeout.

import { describe, it, expect } from 'vitest';
import { createSession } from '../src/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DESIGN_NAMESPACE = 'dacaf35e-55a5-454d-a7c1-93db038a210e';

// A text dictionary of `count` scalar entries p0..p(count-1), all in Design Data, as a host hands
// a parsed .sldd to the session.
function bigDictionary(count: number): Record<string, unknown> {
  const entries: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      name: 'p' + i,
      metadata: { uuid: 'u' + i, namespace: DESIGN_NAMESPACE, lastmod: '20260506T140856.858540', modifiedby: '', isderived: '0' },
      value: i,
    });
  }
  return {
    __MW_TEXT_COREPROPERTIES__: { release: 'R2026b' },
    __MW_TEXT_PARTS__: { '__MW_TEXT_PART__/data/chunk0': { __MW_TEXT_content: { entries } } },
  };
}

// How many of `work`'s steps ran before `ms` milliseconds were up.
function stepsWithin(ms: number, steps: number, work: (i: number) => void): number {
  const deadline = performance.now() + ms;
  let i = 0;
  while (i < steps && performance.now() < deadline) {
    work(i);
    i++;
  }
  return i;
}

describe('F1-23: renaming entries of a 140,000-entry dictionary', () => {
  it('renames 20,000 entries through setProperty in well under 2 s (the namespace check is not a scan)', { timeout: 60_000 }, () => {
    const s = createSession();
    const src = s.addDataSource('big.sldd', bigDictionary(140_000)) as any;
    const design = src.getSection('design');
    expect(design.children.length).toBe(140_000);
    const entries = design.children.slice(0, 20_000);

    const done = stepsWithin(2_000, entries.length, (i) => {
      const result = entries[i].setProperty('Name', 'r' + i);
      if (result !== true) {
        throw new Error('rename ' + i + ' refused: ' + JSON.stringify(result));
      }
    });

    expect(done).toBe(20_000);
    expect(entries[19_999].name).toBe('r19999');
    // Still checked, at scale: a name another entry holds, renamed or never renamed, is refused.
    expect(design.children[30_000].setProperty('Name', 'r5')).toMatchObject({ error: true, reason: "'r5' already exists in Design or Architectural Data" });
    expect(design.children[30_000].setProperty('Name', 'p139999')).toMatchObject({ error: true });
    // And a name given up by a rename is free again.
    expect(design.children[30_000].setProperty('Name', 'p5')).toBe(true);
  });

  it('renames each of 2,000 entries just pasted in, in well under 2 s (an added entry does not make the next rename count again)', { timeout: 60_000 }, () => {
    const s = createSession();
    const src = s.addDataSource('big.sldd', bigDictionary(140_000)) as any;
    const design = src.getSection('design');

    const done = stepsWithin(2_000, 2_000, (i) => {
      const pasted = design.parseEntry({ name: 'n' + i, metadata: { uuid: 'un' + i }, value: i });
      const result = pasted.setProperty('Name', 'm' + i);
      if (result !== true) {
        throw new Error('rename ' + i + ' refused: ' + JSON.stringify(result));
      }
    });

    expect(done).toBe(2_000);
    expect(design.children.length).toBe(142_000);
    expect(design.children[141_999].name).toBe('m1999');
    expect(design.children[0].setProperty('Name', 'm1999')).toMatchObject({ error: true });
    expect(design.children[0].setProperty('Name', 'n1999')).toBe(true);
  });

  it('runs 500 session.editProperty renames in a 140,000-entry dictionary in well under 2 s, and every id resolves', { timeout: 60_000 }, () => {
    const s = createSession();
    const src = s.addDataSource('big.sldd', bigDictionary(140_000)) as any;
    const design = src.getSection('design');
    const entries = design.children.slice(0, 500);
    const oldIds = entries.map((e: any) => e.id);

    const done = stepsWithin(2_000, entries.length, (i) => {
      s.setActive(design, entries[i]);
      const result = s.editProperty(entries[i].id, 'Name', 'r' + i);
      if (result !== true) {
        throw new Error('rename ' + i + ' refused: ' + JSON.stringify(result));
      }
    });

    expect(done).toBe(500);
    for (let i = 0; i < 500; i++) {
      expect(s.findNodeById(entries[i].id)).toBe(entries[i]);
      expect(s.findNodeById(oldIds[i])).toBeNull();
    }
    // An entry nobody renamed still resolves.
    expect(s.findNodeById(design.children[139_999].id)).toBe(design.children[139_999]);

    // Undo and redo move the ids back and forth again.
    s.setActive(design, entries[499]);
    s.undo();
    expect(entries[499].name).toBe('p499');
    expect(s.findNodeById(oldIds[499])).toBe(entries[499]);
    expect(s.findNodeById(src.id + '/design/r499')).toBeNull();
    s.redo();
    expect(entries[499].name).toBe('r499');
    expect(s.findNodeById(src.id + '/design/r499')).toBe(entries[499]);
    expect(s.findNodeById(oldIds[499])).toBeNull();
  });

  it('an entry a host detached itself, still selected, is not indexed by an edit of it', () => {
    // Guard. A host that removes an entry directly (section.removeChild, with no unindexSubtree)
    // leaves the selection on a node no open file holds. An edit of it must not put that node, or
    // anything in it, where findNodeById hands nodes out.
    const s = createSession();
    const src = s.addDataSource('small.sldd', bigDictionary(3)) as any;
    const design = src.getSection('design');
    const entry = design.children[0];
    const oldId = entry.id;
    s.setActive(design, entry);
    design.removeChild(entry);

    expect(s.editProperty(entry.id, 'Name', 'gone')).toBe(true);

    expect(entry.name).toBe('gone');
    expect(s.findNodeById(entry.id)).toBeNull();
    expect(s.findNodeById(oldId)).toBeNull();
    expect(s.findNodeById(design.children[0].id)).toBe(design.children[0]);

    // The same for an entry whose whole section the host took out of the dictionary: the entry is
    // still an entry of its section, in a tree no open file is.
    const other = design.children[1];
    const otherId = other.id;
    s.setActive(design, other);
    src.removeChild(design);
    expect(s.editProperty(other.id, 'Name', 'away')).toBe(true);
    expect(other.name).toBe('away');
    expect(s.findNodeById(other.id)).toBeNull();
    expect(s.findNodeById(otherId)).toBeNull();
  });

  it('a struct field renamed through editProperty moves the ids of the same field on every other element of its array', () => {
    // Guard. A struct array shares one field list, so renaming the field under element 1 renames it
    // under element 2 as well (StructNode._renameField): the edit moves ids OUTSIDE the edited node's
    // own subtree, and the session has to follow all of them.
    const s = createSession();
    const json = bigDictionary(3) as any;
    json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.push({
      name: 'S',
      metadata: { uuid: 'uS', namespace: DESIGN_NAMESPACE, lastmod: '20260506T140856.858540', modifiedby: '', isderived: '0' },
      value: { _array_type: 'Struct', _dimensions: [1, 2], _fields: ['a', 'b'], _mw_element_type: 'MATLABArray', _elements: [{ a: 1, b: 2 }, { a: 3, b: 4 }] },
    });
    const src = s.addDataSource('small.sldd', json) as any;
    const design = src.getSection('design');
    const entry = design.children.find((e: any) => e.name === 'S');
    expect(entry.children.length).toBe(2);
    const [first, second] = entry.children;
    const field1 = first.children.find((f: any) => f.name === 'a');
    const field2 = second.children.find((f: any) => f.name === 'a');
    const oldId2 = field2.id;

    s.setActive(design, field1);
    expect(s.editProperty(field1.id, 'Name', 'c')).toBe(true);

    expect(field2.name).toBe('c');
    expect(s.findNodeById(field1.id)).toBe(field1);
    expect(s.findNodeById(field2.id)).toBe(field2);
    expect(s.findNodeById(oldId2)).toBeNull();

    s.undo();
    expect(field2.name).toBe('a');
    expect(s.findNodeById(oldId2)).toBe(field2);
    expect(s.findNodeById(field1.id)).toBe(field1);
  });
});
