// Copyright 2026 The MathWorks, Inc.
// Two entries with one name in one section share one node id (F1-50).
//
// A node id is its path (BaseNode.id), so two `K`s in Design Data are both
// `<src>/design/K`, and the session index can hold only one node per id: the last one
// indexed. Every id-addressed operation used to act on whichever `K` that happened to be,
// so deleting the row the user picked could delete the other one. Only a malformed file
// reaches this (MATLAB writes no such dictionary, and a rename here refuses to make one),
// and D13 keeps both entries as read. The ruling (2026-10-16, group E, option (a)) is to
// change no id and instead refuse every id-addressed operation while the id names more
// than one node, and to say so when the file opens.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

const SRC = 'dup.sldd';

function loadFixture(name: string): any {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8'));
}

function contentOf(doc: any): any {
  return doc.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content;
}

// numeric_json.sldd's own Design Data entries, cut down to the ones named, plus copies of
// some of them under the same name with another value. Built from a real file rather than
// by hand so that every entry is one the reader already reads.
function docWith(keep: string[], twins: { of: string; value: unknown }[]): any {
  const doc = loadFixture('numeric_json.sldd');
  const content = contentOf(doc);
  const byName = new Map<string, any>(content.entries.map((e: any) => [e.name, e]));
  const entries: any[] = keep.map((name) => byName.get(name));
  for (const twin of twins) {
    const copy = JSON.parse(JSON.stringify(byName.get(twin.of)));
    copy.value = twin.value;
    entries.push(copy);
  }
  content.entries = entries;
  return doc;
}

const STRUCT_A2 = {
  _array_type: 'Struct',
  _dimensions: [1, 1],
  _elements: [{ a: 2, b: 7 }],
  _fields: ['a', 'b'],
  _mw_element_type: 'MATLABArray',
};

// `Number` twice (1 and 2), `PI` once, `Struct` twice (a = 1 and a = 2).
function open(doc: any = docWith(['Number', 'PI', 'Struct'], [{ of: 'Number', value: 2 }, { of: 'Struct', value: STRUCT_A2 }])) {
  const s = createSession();
  const src = s.addDataSource(SRC, doc) as any;
  s.setActiveContext(src);
  const design = src.children.find((c: any) => c.name === 'design');
  const named = (name: string): any[] => design.children.filter((c: any) => c.name === name);
  return { s, src, design, named };
}

// What each entry's Value reads as, in tree order: the saved text, since what reaches the
// file is what a wrong-entry edit or delete would have damaged.
function savedValues(s: any, name: string): unknown[] {
  const out = s.serializeSource(SRC);
  const entries = contentOf(JSON.parse(out.text)).entries;
  return entries.filter((e: any) => e.name === name).map((e: any) => e.value);
}

const idOf = (name: string) => `${SRC}/design/${name}`;

describe('an id two entries share is refused by every id-addressed operation', () => {
  it('says so when the file opens: one duplicate-id warning per shared name, naming it', () => {
    const { src } = open();
    const warnings = (src.warnings ?? []).filter((w: any) => w.code === 'duplicate-id');
    expect(warnings.map((w: any) => w.part).sort()).toEqual(['Number', 'Struct']);
    const number = warnings.find((w: any) => w.part === 'Number');
    expect(number.message).toBe(
      "Two entries in Design Data are named 'Number'. Neither can be edited or deleted until the file gives one of them another name.",
    );
    // One warning for the shared entry, not another for each field inside it: `Struct/a`
    // is shared too, and for the same reason.
    expect(warnings.length).toBe(2);
  });

  it('counts three or more, and names the section they are in', () => {
    const { src } = open(docWith(['Number'], [{ of: 'Number', value: 2 }, { of: 'Number', value: 3 }]));
    const warnings = (src.warnings ?? []).filter((w: any) => w.code === 'duplicate-id');
    expect(warnings.length).toBe(1);
    expect(warnings[0].message).toBe(
      "3 entries in Design Data are named 'Number'. None of them can be edited or deleted until the file gives each its own name.",
    );
  });

  it('findNodeById answers null for the shared id', () => {
    const { s, named } = open();
    // Both are in the tree, and both are what the id names: the lookup cannot pick one.
    expect(named('Number').length).toBe(2);
    expect(s.findNodeById(idOf('Number'))).toBeNull();
  });

  it('deleteNodeById refuses, and deletes neither entry', () => {
    const { s, named } = open();
    expect(s.deleteNodeById(idOf('Number'))).toBe(false);
    expect(named('Number').length).toBe(2);
    expect(savedValues(s, 'Number')).toEqual([1, 2]);
    expect(s.canUndo()).toBe(false);
  });

  it('deleteNodesById refuses the whole batch when one id in it is shared', () => {
    const { s, named } = open();
    expect(s.deleteNodesById([idOf('PI'), idOf('Number')])).toBe(false);
    expect(named('PI').length).toBe(1);
    expect(named('Number').length).toBe(2);
    expect(s.canUndo()).toBe(false);
  });

  it('addChildTo refuses, and adds a field to neither struct', () => {
    const { s, named } = open();
    const before = named('Struct').map((n: any) => n.children.length);
    expect(s.addChildTo(idOf('Struct'))).toBeNull();
    expect(named('Struct').map((n: any) => n.children.length)).toEqual(before);
    expect(s.canUndo()).toBe(false);
  });

  it('editProperty refuses an edit addressed by the shared id, whichever twin is selected', () => {
    const { s, named } = open();
    for (const twin of named('Number')) {
      s.setActiveEntry(twin);
      expect(s.editProperty(idOf('Number'), 'Value', '5')).toBe(false);
    }
    expect(savedValues(s, 'Number')).toEqual([1, 2]);
    expect(s.canUndo()).toBe(false);
  });

  it('refuses a node INSIDE a shared entry too: `Struct/a` names a field of each', () => {
    const { s, named } = open();
    const fields = named('Struct').map((n: any) => n.children.find((c: any) => c.name === 'a'));
    expect(fields.every(Boolean)).toBe(true);
    expect(fields[0].id).toBe(fields[1].id);
    expect(s.findNodeById(`${idOf('Struct')}/a`)).toBeNull();
    expect(s.deleteNodeById(`${idOf('Struct')}/a`)).toBe(false);
    expect(named('Struct').map((n: any) => n.children.length)).toEqual([2, 2]);
  });
});

describe('what the refusal leaves alone', () => {
  it('an entry whose name is its own is found, edited and deleted as before', () => {
    const { s, named } = open();
    const pi = named('PI')[0];
    expect(s.findNodeById(idOf('PI'))).toBe(pi);
    s.setActiveEntry(pi);
    expect(s.editProperty(idOf('PI'), 'Value', '3')).toBe(true);
    expect(savedValues(s, 'PI')).toEqual([3]);
    expect(s.deleteNodeById(idOf('PI'))).toBe(true);
    expect(named('PI').length).toBe(0);
  });

  it('a file with no shared name carries no warnings field at all, not an empty one', () => {
    const { src } = open(docWith(['Number', 'PI', 'Struct'], []));
    expect('warnings' in src).toBe(false);
  });

  it('renaming one twin (a host edit through mutateSubtree) makes both addressable again', () => {
    const { s, named } = open();
    const [first, second] = named('Number');
    s.mutateSubtree(first, () => first.setProperty('Name', 'Number2'));
    expect(s.findNodeById(idOf('Number2'))).toBe(first);
    // The twin left behind is the only `Number` now, and the index holds it, even though
    // the rename took the id it used to share out of the index.
    expect(s.findNodeById(idOf('Number'))).toBe(second);
    expect(s.deleteNodeById(idOf('Number'))).toBe(true);
    expect(savedValues(s, 'Number2')).toEqual([1]);
    expect(savedValues(s, 'Number')).toEqual([]);
  });
});

describe('twins below the entry level', () => {
  // btBus with its second element renamed onto the first: two elements named `plain`.
  function busTwins() {
    const doc = loadFixture('bus_types_text.sldd');
    const bus = contentOf(doc).entries.find((e: any) => e.name === 'btBus');
    const elements = bus.value._elements[0]._properties.Elements_internal._elements;
    elements[1]._properties.Name = 'plain';
    const s = createSession();
    const src = s.addDataSource('bus.sldd', doc) as any;
    s.setActiveContext(src);
    const node = src.children.find((c: any) => c.name === 'design').children.find((c: any) => c.name === 'btBus');
    return { s, src, node };
  }

  it('warns once for two elements of one bus that share a name, naming the bus', () => {
    const { src } = busTwins();
    const warnings = (src.warnings ?? []).filter((w: any) => w.code === 'duplicate-id');
    expect(warnings.length).toBe(1);
    expect(warnings[0].message).toBe(
      "Two items in btBus are named 'plain'. Neither can be edited or deleted until the file gives one of them another name.",
    );
  });

  it('refuses the shared element id, and still finds the bus and its other elements', () => {
    const { s, node } = busTwins();
    const plain = node.children.filter((c: any) => c.name === 'plain');
    expect(plain.length).toBe(2);
    expect(s.findNodeById(plain[0].id)).toBeNull();
    expect(s.deleteNodeById(plain[0].id)).toBe(false);
    expect(node.children.filter((c: any) => c.name === 'plain').length).toBe(2);
    expect(s.findNodeById(node.id)).toBe(node);
    const geared = node.children.find((c: any) => c.name === 'geared');
    expect(s.findNodeById(geared.id)).toBe(geared);
  });
});

describe('a host that removes one twin itself', () => {
  it('leaves the other findable under the id they shared (unindexSubtree)', () => {
    const { s, design, named } = open();
    const [first, second] = named('Number');
    s.unindexSubtree(first, () => design.removeChild(first));
    expect(named('Number')).toEqual([second]);
    expect(s.findNodeById(idOf('Number'))).toBe(second);
  });
});
