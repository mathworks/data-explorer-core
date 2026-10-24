// Copyright 2026 The MathWorks, Inc.
//
// A paste into a MAT-file is ONE undo step of the file's stack, whatever it pasted: a host that
// mirrors core's stack counts one 'undo/changed' for it, of the file's srcId. Its undo takes every
// variable out, announcing each ('node/deleted'), and the file saves as it was read; its redo puts
// them back, announcing each ('node/added'), and the file saves as the paste saved it. Nothing of
// an object the paste made is left behind where a save writes objects from (MatNode._creation),
// by a paste refused or by a deep pasteRefusal, which makes the paste and takes it back.
import { describe, it, expect } from 'vitest';
import { MIXED, NONE, TEXT_CASES, copiesOf, fixture, reopened, rowsOf, sameBytes, target } from './tools/matPaste.js';

type Any = any;

const copied = (name: string): Any => copiesOf(TEXT_CASES).find((c) => c.entry.name === name)!.payload;
// Three kinds in one paste: a plain value, a Simulink object and a string.
const mixedPaste = () => [{ name: 'v', metadata: null, value: { _type: 'int16', _value: '[1, 2, 3]' } }, copied('aParam'), copied('strArray')];

const topics = (events: { topic: string }[]) => events.map((e) => e.topic);

describe('a paste of three kinds of entry', () => {
  for (const into of [MIXED, NONE]) {
    it(`${into}: one undo step, each variable announced, its undo and its redo`, () => {
      const t = target(fixture(into));
      const original = t.save();
      const res: Any = t.session.pasteEntries('t.mat', mixedPaste());
      expect(res.nodes.map((n: Any) => [n.name, n.className, n.status])).toEqual([
        ['v', 'int16', 'New'],
        ['aParam', 'Simulink.Parameter', 'New'],
        ['strArray', 'string', 'New'],
      ]);
      // ONE 'undo/changed', of the file, then each variable added.
      expect(t.events.filter((e) => e.topic === 'undo/changed').map((e) => e.payload)).toEqual([{ srcId: 't.mat' }]);
      expect(topics(t.events)).toEqual(['undo/changed', 'node/added', 'node/added', 'node/added']);
      expect(t.events.filter((e) => e.topic === 'node/added').map((e) => [e.payload.node, e.payload.sectionKey])).toEqual(res.nodes.map((n: Any) => [n, 't.mat']));
      const pasted = t.save();
      expect(sameBytes(pasted, original)).toBe(false);

      t.events.length = 0;
      t.session.undo();
      expect(topics(t.events)).toEqual(['node/deleted', 'node/deleted', 'node/deleted', 'undo/changed']);
      expect(t.events.filter((e) => e.topic === 'node/deleted').map((e) => e.payload.node)).toEqual(res.nodes);
      expect(res.nodes.map((n: Any) => n.parent)).toEqual([null, null, null]);
      for (const n of res.nodes) expect(t.session.findNodeById(n.id)).toBeNull();
      expect(sameBytes(t.save(), original)).toBe(true);
      expect([t.session.canUndo(), t.session.canRedo(), t.root._liveCreations()]).toEqual([false, true, []]);

      t.events.length = 0;
      t.session.redo();
      expect(topics(t.events)).toEqual(['node/added', 'node/added', 'node/added', 'undo/changed']);
      expect(res.nodes.map((n: Any) => n.parent)).toEqual([t.root, t.root, t.root]);
      for (const n of res.nodes) for (const m of n.flatten()) expect(t.session.findNodeById(m.id)).toBe(m);
      expect(sameBytes(t.save(), pasted)).toBe(true);

      // Undone and redone again, the same bytes each way; and what the save wrote reads back as made.
      t.session.undo();
      expect(sameBytes(t.save(), original)).toBe(true);
      t.session.redo();
      const again = t.save();
      expect(sameBytes(again, pasted)).toBe(true);
      const back = reopened(again);
      for (const n of res.nodes) expect(rowsOf(back.children.find((c: Any) => c.name === n.name))).toEqual(rowsOf(n));
    });
  }

  it('an undo releases a selection inside what it takes out, and moves none other', () => {
    const t = target(fixture(MIXED));
    const res: Any = t.session.pasteEntries('t.mat', mixedPaste());
    t.session.setActive(t.root, res.nodes[1]);
    t.session.undo();
    expect(t.session.getEntryNodes()).toEqual([]);
    t.session.redo();
    t.session.setActive(t.root, t.by('x'));
    t.session.undo();
    expect(t.session.getEntryNode()).toBe(t.by('x'));
  });

  it('a paste after an Add of an object, both undone and redone in turn, saves as made', () => {
    const t = target(fixture(NONE));
    const original = t.save();
    const added = t.session.addEntry('', 'Simulink.Signal', 'sg');
    expect(added).not.toBeNull();
    t.session.pasteEntries('t.mat', [copied('aParam'), copied('aBus')]);
    const both = t.save();
    t.session.undo();
    t.session.undo();
    expect(sameBytes(t.save(), original)).toBe(true);
    t.session.redo();
    t.session.redo();
    expect(sameBytes(t.save(), both)).toBe(true);
    const held = target(fixture(NONE)).root.children.map((c: Any) => c.name);
    expect(reopened(both).children.map((c: Any) => c.name)).toEqual([...held, 'sg', 'aParam', 'aBus']);
  });
});

describe('nothing of an object is left behind by a paste not made', () => {
  for (const into of [MIXED, NONE]) {
    it(`${into}: a refused paste and a deep pasteRefusal leave _creation as it was`, () => {
      const t = target(fixture(into));
      const original = t.save();
      const state = () => {
        const c = t.root._creation;
        return c ? { records: c.records, session: c.session, created: c.created.size, rows: c.rows.size } : undefined;
      };
      const before = state();
      expect(t.session.pasteRefusal('t.mat', copied('aParam'), { deep: true })).toBeNull();
      expect(t.session.pasteRefusal('t.mat', copied('aBus'), { deep: true })).toBeNull();
      expect(t.session.pasteRefusal('t.mat', copied('strArray'), { deep: true })).toBeNull();
      expect(state()).toEqual(before);
      const refused: Any = t.session.pasteEntries('t.mat', [copied('aParam'), copied('strScalar'), { name: 'fh', metadata: null, value: { _type: 'function_handle', _value: 'sin' } }]);
      expect(refused.error).toBe(true);
      expect(state()).toEqual(before);
      expect([t.root._twins, t.root._objectNodesById, t.root.dirty, t.session.canUndo(), t.events]).toEqual([undefined, undefined, false, false, []]);
      expect(sameBytes(t.save(), original)).toBe(true);

      // And a paste made after them is the paste a file fresh from disk makes.
      const fresh = target(fixture(into));
      t.session.pasteEntries('t.mat', [copied('aParam'), copied('aBus')]);
      fresh.session.pasteEntries('t.mat', [copied('aParam'), copied('aBus')]);
      expect(sameBytes(t.save(), fresh.save())).toBe(true);
    });
  }

  it('a deep pasteRefusal publishes nothing, records nothing, and leaves the file clean', () => {
    const t = target(fixture(MIXED));
    for (const payload of mixedPaste()) {
      expect(t.session.pasteRefusal('t.mat', payload, { deep: true })).toBeNull();
    }
    expect([t.events, t.root.dirty, t.session.canUndo(), t.root.children.length]).toEqual([[], false, false, 5]);
    expect(t.root.addEntryRefusal()).toBeNull();
  });

  it("the last Add's refusal is still the last Add's after a paste", () => {
    const t = target(fixture(MIXED));
    expect(t.session.addEntry('', 'Simulink.LookupTable')).toBeNull();
    const refusal = t.session.addEntryRefusal();
    expect(refusal).toMatch(/^Cannot add a Simulink\.LookupTable/);
    t.session.pasteEntries('t.mat', [copied('aParam')]);
    t.session.pasteRefusal('t.mat', copied('aSignal'), { deep: true });
    expect(t.session.addEntryRefusal()).toBe(refusal);
  });
});
