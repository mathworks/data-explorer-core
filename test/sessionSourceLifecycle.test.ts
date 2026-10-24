// Copyright 2026 The MathWorks, Inc.
//
// What a session does to a source's undo history and to the selection as the source comes and
// goes: added, re-registered under its srcId (a reload), removed, and all of them removed at once.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataModel, EventBus, createSession } from '../src/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const dictionary = (): Record<string, unknown> => JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/numeric_json.sldd', import.meta.url)), 'utf8'));

// The default session (DataModel) runs on the default bus, where the module's own UndoManager
// listens too: the two cleared their histories of a source each, and each said so, so a host heard
// every removal's undo/changed twice.
describe('the default session', () => {
  it('announces one undo/changed when a source is removed, and one when all are', () => {
    const seen: string[] = [];
    const sub = EventBus.subscribe('undo/changed', (p) => { seen.push(p.srcId); });
    try {
      DataModel.addDataSource('lifecycle-a.sldd', dictionary());
      DataModel.addDataSource('lifecycle-b.sldd', dictionary());
      DataModel.removeDataSource('lifecycle-a.sldd');
      expect(seen).toEqual(['lifecycle-a.sldd']);
      seen.length = 0;
      DataModel.removeAll();
      expect(seen).toEqual(['']);
    } finally {
      sub.remove();
      DataModel.removeAll();
    }
  });
});

// Re-registering a srcId (a reload: the file read again and added under the id it had) replaces
// its tree. The session dropped the old tree's ids, but kept its undo history, every step of which
// mutates the old tree's nodes, and kept a selection into it: getActiveSlddNode walked up to the
// replaced root, so an edit or an undo was routed at a document no longer open.
describe('a source re-registered under its srcId', () => {
  function reloaded() {
    const session = createSession();
    const first: any = session.addDataSource('r.sldd', dictionary());
    const other: any = session.addDataSource('other.sldd', dictionary());
    const entry = (root: any, name: string) => root.flatten().find((n: any) => n.isEntry && n.name === name);
    return { session, first, other, entry };
  }

  it('starts with no undo history, and an undo then changes neither tree', () => {
    const { session, first, entry } = reloaded();
    const number = entry(first, 'Number');
    session.setActive(first, number);
    expect(session.editProperty(number.id, 'Value', '42')).toBe(true);
    expect(session.canUndo()).toBe(true);
    const events: string[] = [];
    for (const topic of ['undo/changed', 'active/changed', 'datamodel/source-added'] as const) {
      session.bus.subscribe(topic, () => { events.push(topic); });
    }
    const second: any = session.addDataSource('r.sldd', dictionary());
    // Its history gone, and the selection that was in the tree it replaced released, before the
    // source is announced: a subscriber asks what is selected, and what can be undone.
    expect(events).toEqual(['active/changed', 'undo/changed', 'datamodel/source-added']);
    expect([session.getContextNode(), session.getEntryNodes()]).toEqual([null, []]);
    session.setActiveContext(second);
    expect(session.canUndo()).toBe(false);
    session.undo();
    expect([number.displayValue, entry(second, 'Number').displayValue]).toEqual(['42', entry(createSession().addDataSource('x.sldd', dictionary()), 'Number').displayValue]);
  });

  it('keeps a selection and a history in another source, and takes edits and their undo', () => {
    const { session, first, other, entry } = reloaded();
    const there = entry(other, 'Number');
    session.setActive(other, there);
    expect(session.editProperty(there.id, 'Value', '7')).toBe(true);
    session.setPreviewNode(entry(first, 'PI'));
    const second: any = session.addDataSource('r.sldd', dictionary());
    expect([session.getContextNode(), session.getEntryNode(), session.getPreviewNode()]).toEqual([other, there, null]);
    expect(session.canUndo()).toBe(true);
    const here = entry(second, 'Number');
    session.setActive(second, here);
    expect(session.editProperty(here.id, 'Value', '5')).toBe(true);
    session.undo();
    expect(here.displayValue).toBe(entry(createSession().addDataSource('x.sldd', dictionary()), 'Number').displayValue);
  });

  it('re-registered as the same tree keeps its history and selection', () => {
    const { session, first, entry } = reloaded();
    const number = entry(first, 'Number');
    session.setActive(first, number);
    expect(session.editProperty(number.id, 'Value', '42')).toBe(true);
    expect(session.addParsedSource('r.sldd', first)).toBe(first);
    expect([session.getContextNode(), session.getEntryNode(), session.canUndo()]).toEqual([first, number, true]);
  });
});

// A subscriber to datamodel/cleared asks what is selected, as one to datamodel/source-removed does:
// removeAll announced the clear first and released the selection after, so it was answered with
// nodes of the trees just removed.
describe('every source removed at once', () => {
  it('has let go of the selection and the preview when the clear is announced', () => {
    const session = createSession();
    const root: any = session.addDataSource('c.sldd', dictionary());
    const entry = root.flatten().find((n: any) => n.isEntry);
    session.setActive(root, entry);
    session.setPreviewNode(entry);
    const asked: unknown[] = [];
    session.bus.subscribe('datamodel/cleared', () => {
      asked.push(session.getContextNode(), session.getEntryNodes(), session.getPreviewNode(), session.getActiveSlddNode());
    });
    session.removeAll();
    expect(asked).toEqual([null, [], null, null]);
  });
});
