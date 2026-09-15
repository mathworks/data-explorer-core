// Copyright 2026 The MathWorks, Inc.
//
// The index is cached on the source node, so every mutation that could change what it
// holds has to drop it. Invalidate-on-write, rebuild-on-read: dropping is one assignment
// and rebuilding is one shallow walk, whereas maintaining the set incrementally would mean
// every add, remove, rename and undo path getting it right forever.
//
// TWO hooks, and the interesting one is the second. _markSourceDirty already walks to the
// root on every mutation, so it covers a rename. But SectionNode.execAddEntry and
// execRemoveEntry return undo/redo closures that call addChild/removeChild DIRECTLY without
// marking dirty — so hooking only _markSourceDirty would leave undo-of-an-add serving a
// link to an entry that no longer exists. That is the last test here, and it is the reason
// addChild/removeChild carry their own hook.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import type { INode } from '../src/core/NodeInterfaces.js';
import AliasTypeNode from '../src/datamodel/node/data/AliasTypeNode.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const loadJson = (name: string) => JSON.parse(readFileSync(fixture(name), 'utf8')) as Record<string, unknown>;

// Task 7's fixture. `Kp` is a Simulink.Parameter typed `adtUint8`; `adtUint8` is a
// Simulink.AliasType; `Gain` is a Simulink.Parameter typed `double`.
const DICT = 'typeLink.sldd';

function open() {
  const s = createSession();
  const src = s.addDataSource('d.sldd', loadJson(DICT));
  return { s, src: src as unknown as { children: any[]; _typeLinkIndex?: ReadonlySet<string> | null } };
}
// EXACT-match, and do not simplify to `[0]`: `findNodes`' `name` criterion is a
// case-insensitive SUBSTRING test in document order (src/core/findQuery.ts), so `'Fix'`
// yields `ntFix16` and `'ElemOnly'` yields the bus element `elemOnlyType`. The names this
// file happens to use do not collide, but the next one added easily could.
const entryNamed = (s: ReturnType<typeof createSession>, name: string): INode => {
  const node = s.findNodes({ sourceId: 'd.sldd', name }).find((n) => n.name === name && n.isEntry === true);
  if (!node) {
    throw new Error(`the fixture holds no entry named ${name}`);
  }
  return node;
};
const dataTypeOf = (s: ReturnType<typeof createSession>, name: string): unknown => entryNamed(s, name).toRow()!.DataType;

describe('the cached index is dropped by every mutation that could change it', () => {
  it('is populated by the first row build', () => {
    const { s, src } = open();
    expect(src._typeLinkIndex == null).toBe(true);
    dataTypeOf(s, 'Kp');
    expect(src._typeLinkIndex).toBeTruthy();
  });

  it('a rename of the type entry moves the link with it', () => {
    const { s, src } = open();
    expect(dataTypeOf(s, 'Kp')).toEqual({ text: 'adtUint8', linkTarget: 'adtUint8@d.sldd' });
    // The REAL rename path, not `node.name = …` plus a hand-poked _markSourceDirty:
    // setProperty('Name', …) is what an edit calls, and it reaches _markSourceDirty
    // through _markModified. Asserting the invalidation off the path a user actually
    // takes is the whole point — a hand-poked one would only prove the hook fires when
    // called directly.
    expect(entryNamed(s, 'adtUint8').setProperty!('Name', 'adtRenamed')).toBe(true);
    expect(src._typeLinkIndex == null).toBe(true);
    // Kp still SAYS adtUint8, and nothing defines that name any more, so the cell goes
    // back to plain text. A dead link would be worse than no link.
    expect(dataTypeOf(s, 'Kp')).toBe('adtUint8');
  });

  it('adding a type entry makes a previously plain cell link', () => {
    const { s, src } = open();
    expect(dataTypeOf(s, 'Gain')).toBe('double');
    const section = src.children[0];
    section.addChild(AliasTypeNode.createDefault('double', section));
    expect(src._typeLinkIndex == null).toBe(true);
    expect(dataTypeOf(s, 'Gain')).toEqual({ text: 'double', linkTarget: 'double@d.sldd' });
  });

  it('removing the type entry takes the link away', () => {
    const { s, src } = open();
    expect(dataTypeOf(s, 'Kp')).toEqual({ text: 'adtUint8', linkTarget: 'adtUint8@d.sldd' });
    const alias = entryNamed(s, 'adtUint8');
    alias.parent!.removeChild(alias);
    expect(src._typeLinkIndex == null).toBe(true);
    expect(dataTypeOf(s, 'Kp')).toBe('adtUint8');
  });

  it('an UNDO that calls addChild directly still drops the index', () => {
    // This is why addChild/removeChild carry the hook: SectionNode.execAddEntry's undo
    // closure calls removeChild and its redo closure calls addChild, neither of them
    // routed through _markSourceDirty. Simulated here at the same level the closures work
    // at, so the test does not depend on which entry op is being undone.
    const { s, src } = open();
    const section = src.children[0];
    const added = AliasTypeNode.createDefault('double', section);
    section.addChild(added);
    dataTypeOf(s, 'Gain'); // repopulate the cache
    expect(src._typeLinkIndex).toBeTruthy();
    section.removeChild(added); // the undo closure's call, unmarked
    expect(src._typeLinkIndex == null).toBe(true);
    expect(dataTypeOf(s, 'Gain')).toBe('double');
  });

  it('a detached subtree with no source root invalidates nothing and does not throw', () => {
    // The same silence _markSourceDirty keeps about a root that is not a source.
    const section = { children: [] } as unknown as { children: unknown[] };
    const node = AliasTypeNode.createDefault('loose', null);
    expect(() => node._invalidateTypeLinkIndex()).not.toThrow();
    expect(section.children).toEqual([]);
  });
});
