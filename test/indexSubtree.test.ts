// Copyright 2026 The MathWorks, Inc.
//
// indexSubtree / unindexSubtree — the whole-subtree half of the direct-edit bookkeeping
// mutateSubtree covers for an edit INSIDE a subtree (see mutateSubtree.test.ts).
//
// The host these exist for owns its own undo stack: it attaches a pasted entry with
// section.parseEntry and detaches a deleted one with section.removeChild, then repaints
// just those rows. Both leave the session's node index describing a tree that no longer
// exists unless it is told — an added entry is unfindable, and a removed one is worse
// than unfindable, because findNodeById keeps handing it out and the next edit routed at
// that row mutates an orphan.
//
// The ORDERING is what most of these cases pin: an id is a PATH, so the ids of a subtree
// have to be read while it is still attached. That is why unindexSubtree takes the detach
// rather than trusting the caller to run it afterwards.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function loadFixture(name: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

function session() {
  const s = createSession();
  const src = s.addDataSource('numeric_json.sldd', loadFixture('numeric_json.sldd')) as any;
  return { s, src };
}

const entryNamed = (src: any, name: string) =>
  (src.flatten() as any[]).find((n) => n.isEntry && n.name === name);
// An entry that HAS children, so attaching/detaching it moves more than one id.
const parentEntry = (src: any) => (src.flatten() as any[]).find((n) => n.isEntry && n.children.length > 0);

describe('indexSubtree', () => {
  it('makes an entry attached in place findable, with its descendants', () => {
    // The paste shape: the host builds the node with section.parseEntry (which attaches
    // it) and then asks the session to index what it just added.
    const { s, src } = session();
    const model = parentEntry(src);
    const section = model.parent;
    const raw = { ...(model.serialize() as Record<string, unknown>), name: 'Pasted' };

    const added = section.parseEntry(raw);
    expect(s.findNodeById(added.id)).toBeNull();

    s.indexSubtree(added);

    expect(s.findNodeById(added.id)).toBe(added);
    expect(added.children.length).toBeGreaterThan(0);
    for (const child of added.children as any[]) {
      expect(s.findNodeById(child.id)).toBe(child);
    }
  });

  it('leaves the rest of the document indexed exactly as it was', () => {
    const { s, src } = session();
    const other = entryNamed(src, 'Array');
    const otherId = other.id;
    const section = other.parent;

    s.indexSubtree(section.parseEntry({ ...(other.serialize() as Record<string, unknown>), name: 'Pasted' }));

    expect(s.findNodeById(otherId)).toBe(other);
  });
});

describe('unindexSubtree', () => {
  it('stops handing out a detached entry and its descendants', () => {
    const { s, src } = session();
    const entry = parentEntry(src);
    const section = entry.parent;
    const entryId = entry.id;
    const childIds = (entry.children as any[]).map((c) => c.id);
    expect(s.findNodeById(entryId)).toBe(entry);

    s.unindexSubtree(entry, () => section.removeChild(entry));

    // The ordering case: the ids deleted are the ones the subtree answered to while it
    // was still attached. An implementation that read them after the detach would delete
    // shorter, parentless ids and leave every one of these resolving to an orphan.
    expect(s.findNodeById(entryId)).toBeNull();
    for (const id of childIds) {
      expect(s.findNodeById(id)).toBeNull();
    }
    expect(section.children).not.toContain(entry);
  });

  it('leaves the siblings of a detached entry findable', () => {
    const { s, src } = session();
    const entry = entryNamed(src, 'Array');
    const sibling = entryNamed(src, 'Array1');
    const siblingId = sibling.id;
    const section = entry.parent;

    s.unindexSubtree(entry, () => section.removeChild(entry));

    expect(s.findNodeById(siblingId)).toBe(sibling);
  });

  it('releases a selection pointing inside the detached subtree', () => {
    const { s, src } = session();
    const entry = parentEntry(src);
    const section = entry.parent;
    s.setActiveEntry(entry.children[0]);

    s.unindexSubtree(entry, () => section.removeChild(entry));

    expect(s.getEntryNodes()).toEqual([]);
  });

  it('deletes the ids even when the detach throws', () => {
    // Same rule as mutateSubtree's finally: a detach that failed part-way leaves the tree
    // in whatever state it reached, and the index has to describe that, not the intent.
    const { s, src } = session();
    const entry = entryNamed(src, 'Array');
    const entryId = entry.id;
    const section = entry.parent;

    expect(() =>
      s.unindexSubtree(entry, () => {
        section.removeChild(entry);
        throw new Error('half-way');
      }),
    ).toThrow('half-way');

    expect(s.findNodeById(entryId)).toBeNull();
  });

  it('takes no detach when the caller has none: the ids simply leave the index', () => {
    const { s, src } = session();
    const entry = entryNamed(src, 'Array');
    const entryId = entry.id;

    s.unindexSubtree(entry);

    expect(s.findNodeById(entryId)).toBeNull();
  });
});

describe('index/unindexSubtree — the undo round trip', () => {
  it('re-attaching a detached entry makes it findable at the same id again', () => {
    // Delete then undo, which is what the pair is for: the entry leaves the index, and a
    // node rebuilt from the same record at the same place answers to the same id.
    const { s, src } = session();
    const entry = parentEntry(src);
    const section = entry.parent;
    const entryId = entry.id;
    const index = section.children.indexOf(entry);
    const record = entry.serialize() as Record<string, unknown>;

    s.unindexSubtree(entry, () => section.removeChild(entry));
    expect(s.findNodeById(entryId)).toBeNull();

    const restored = section.parseEntry(record);
    section.removeChild(restored);
    section.addChild(restored, index);
    s.indexSubtree(restored);

    expect(restored.id).toBe(entryId);
    expect(s.findNodeById(entryId)).toBe(restored);
    expect(section.children.indexOf(restored)).toBe(index);
  });
});
