// Copyright 2026 The MathWorks, Inc.
//
// A struct field that an element does not hold is MATLAB's 0x0 double, shown as `[ ]` and
// written as `[]`, not a 0 (F1-12, struct half).
//
// A text dictionary is JSON anyone can edit, so a struct element can be `null`, or `{}` under a
// field the struct declares. MATLAB R2027a reads that field as `[]`, a 0x0 double: sMissing.a,
// sArrNull(2).a and sArrMissing(2).a all read `class=double size=[0 0]`, measured on these same
// three values (group F scoping, measure3.log). StructNode.fieldOf answered `undefined` for the
// field, which a field node reads as 0. So the field showed `0`, and every save that rebuilt the
// struct wrote `"a": 0`: after an edit of the field and its undo, and after an edit of ANOTHER
// element of the same array. A copy pasted into a binary dictionary wrote the field as 0.0.
//
// An untouched save still writes the element as it was read (`null`, `{}`), byte for byte, and
// so does a save after an edit of the field undone, which puts the value back as it was read
// (DataNode._editMarks).
//
// The object half is not changed: MATLAB reads a typed object's null element as an element
// holding no properties (pNull and pEmpty read alike, measure1.log), which is what an edit and
// its undo write. The last test pins that.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const read = (rel: string): Buffer => readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const CONTROL = read('./fixtures/rt_text.sldd').toString('utf8');
const BINARY_HOST = 'rt_bin.sldd';

// The values MATLAB was measured on: the three structs of f117b_text.sldd and the two
// Parameters of null_text.sldd, each as that file holds it.
const VALUES: Record<string, Record<string, unknown>> = {
  sMissing: { _array_type: 'Struct', _dimensions: [1, 1], _fields: ['a'], _elements: [{}], _mw_element_type: 'MATLABArray' },
  sArrNull: { _array_type: 'Struct', _dimensions: [1, 2], _elements: [{ a: 1 }, null], _mw_element_type: 'MATLABArray' },
  sArrMissing: { _array_type: 'Struct', _dimensions: [1, 2], _elements: [{ a: 1 }, {}], _mw_element_type: 'MATLABArray' },
  pNull: { _array_class: 'Simulink.Parameter', _dimensions: [1, 1], _elements: [null], _mw_element_type: 'MATLABArray' },
  pArrNull: { _array_class: 'Simulink.Parameter', _dimensions: [1, 2], _elements: [{ _properties: { Description: 'd' } }, null], _mw_element_type: 'MATLABArray' },
};

const entriesOf = (text: string): any[] => JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;

// The namespace of Design Data, which the measured files filed them under.
const DESIGN = 'dacaf35e-55a5-454d-a7c1-93db038a210e';

/**
 * rt_text.sldd with each of VALUES as one more entry, in Design Data, which a save writes ahead
 * of the file's own entry (in Other Data).
 */
function dictionary(): string {
  const json = JSON.parse(CONTROL);
  const content = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content;
  const [gadget] = content.entries;
  content.entries = Object.entries(VALUES).map(([name, value], i) => {
    const uuid = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    return { name, metadata: { ...gadget.metadata, uuid, namespace: DESIGN }, value };
  });
  content.entries.push(gadget);
  return JSON.stringify(json, null, '\t');
}

function open(source: string | Uint8Array, filename: string, session = createSession()): { session: any; root: any } {
  const input = typeof source === 'string' ? source : buffer(source);
  return { session, root: ingest(session, input, { filename }) };
}

function entryOf(root: any, name: string): any {
  const entry = root.getSection('design').children.find((e: any) => e.name === name);
  expect(entry, name).toBeDefined();
  return entry;
}

/** The node at `path` under the entry, each step a child's displayName. */
function at(root: any, name: string, ...path: string[]): any {
  let node = entryOf(root, name);
  for (const step of path) {
    node = node.children.find((c: any) => c.displayName === step);
    expect(node, [name, ...path].join('/')).toBeDefined();
  }
  return node;
}

/** Every row under an entry, by path, with the value it shows. */
function rowsOf(root: any, name: string): string[] {
  const out: string[] = [];
  const walk = (n: any, path: string): void => {
    out.push(path + ' = ' + String(n.displayValue));
    for (const c of n.children) {
      walk(c, path + '/' + c.displayName);
    }
  };
  walk(entryOf(root, name), name);
  return out;
}

/** What the session saves: the text, and each entry's value as that text holds it. */
function saved(session: any, root: any): { text: string; value: (name: string) => unknown } {
  const text = (session.serializeSource(root.name) as { text: string }).text;
  const entries = entriesOf(text);
  return { text, value: (name: string) => entries.find((e) => e.name === name).value };
}

/** Edit the node's Value through the session, as a host does. */
function edit(session: any, root: any, node: any, text: string): unknown {
  session.setActive(root, node);
  return session.editProperty(node.id, 'Value', text);
}

// What each struct shows: the absent field `[ ]`, a 0x0 double, beside a held one.
const SHOWN: Record<string, string[]> = {
  sMissing: ['sMissing = <1x1 struct>', 'sMissing/a = [ ]'],
  sArrNull: ['sArrNull = <1x2 struct>', 'sArrNull/sArrNull(1) = <1x1 struct>', 'sArrNull/sArrNull(1)/a = 1', 'sArrNull/sArrNull(2) = <1x1 struct>', 'sArrNull/sArrNull(2)/a = [ ]'],
  sArrMissing: ['sArrMissing = <1x2 struct>', 'sArrMissing/sArrMissing(1) = <1x1 struct>', 'sArrMissing/sArrMissing(1)/a = 1', 'sArrMissing/sArrMissing(2) = <1x1 struct>', 'sArrMissing/sArrMissing(2)/a = [ ]'],
};
// The absent field's node in each, by path.
const ABSENT: Array<[string, string[]]> = [['sMissing', ['a']], ['sArrNull', ['sArrNull(2)', 'a']], ['sArrMissing', ['sArrMissing(2)', 'a']]];

describe('a struct field an element does not hold', () => {
  it.each(Object.keys(SHOWN))('%s shows it as [ ], a 0x0 double, as MATLAB reads it', (name) => {
    const { root } = open(dictionary(), 'gadget.sldd');
    expect(rowsOf(root, name)).toEqual(SHOWN[name]);
    const [, path] = ABSENT.find(([n]) => n === name)!;
    const field = at(root, name, ...path);
    expect([field.className, field.dims]).toEqual(['double', [0, 0]]);
  });

  it('is saved untouched as it was read, null and {} alike', () => {
    const text = dictionary();
    const { session, root } = open(text, 'gadget.sldd');
    expect(saved(session, root).text).toBe(text);
  });

  it('is written as [] when an edit to another element rebuilds the struct, and reopens as [ ]', () => {
    const { session, root } = open(dictionary(), 'gadget.sldd');
    expect(edit(session, root, at(root, 'sArrMissing', 'sArrMissing(1)', 'a'), '9')).toBe(true);
    const out = saved(session, root);
    expect(out.value('sArrMissing')).toEqual({ _array_type: 'Struct', _dimensions: [1, 2], _elements: [{ a: 9 }, { a: [] }], _mw_element_type: 'MATLABArray' });
    const { root: reopened } = open(out.text, 'gadget.sldd');
    expect(rowsOf(reopened, 'sArrMissing')).toEqual(SHOWN.sArrMissing.map((r) => r.replace('(1)/a = 1', '(1)/a = 9')));
  });

  it.each(ABSENT)('%s: an edit of it and its undo write it as it was read, and the file reopens as [ ]', (name, path) => {
    const { session, root } = open(dictionary(), 'gadget.sldd');
    expect(edit(session, root, at(root, name, ...path), '5')).toBe(true);
    expect(rowsOf(root, name)[SHOWN[name].length - 1]).toMatch(/\/a = 5$/);
    session.undo();
    const out = saved(session, root);
    expect(out.value(name)).toEqual(VALUES[name]);
    expect(rowsOf(root, name)).toEqual(SHOWN[name]);
    const { root: reopened } = open(out.text, 'gadget.sldd');
    expect(rowsOf(reopened, name)).toEqual(SHOWN[name]);
  });

  it('is written as an empty double when a copy is pasted into a binary dictionary, and reopens as [ ]', () => {
    const { root: from } = open(dictionary(), 'gadget.sldd');
    const { session, root } = open(new Uint8Array(read(`./fixtures/${BINARY_HOST}`)), BINARY_HOST);
    const design = root.getSection('design');
    for (const name of Object.keys(SHOWN)) {
      // As the host pastes: the entry's record, deep-copied, built into the section.
      expect(design.parseEntry(JSON.parse(JSON.stringify(entryOf(from, name).serialize()))), name).toBeTruthy();
    }
    const bytes = session.serializeSource(root.name)!.bytes as Uint8Array;
    const xml = strFromU8(unzipSync(bytes)['data/chunk0.xml']);
    for (const name of Object.keys(SHOWN)) {
      const start = xml.indexOf(`<P Name="Name" Class="char">${name}</P>`);
      expect(start, name).toBeGreaterThan(-1);
      const value = xml.slice(start, xml.indexOf('</Object>', start));
      expect(value.match(/<P Name="a" [^>]*>/g), name).toEqual(
        name === 'sMissing' ? ['<P Name="a" Class="double" Dimension="0*0"/>'] : ['<P Name="a" Class="double">', '<P Name="a" Class="double" Dimension="0*0"/>'],
      );
    }
    const { root: reopened } = open(bytes, BINARY_HOST);
    for (const name of Object.keys(SHOWN)) {
      expect(rowsOf(reopened, name)).toEqual(SHOWN[name]);
    }
  });
});

// The object half, which this change leaves as it is: a typed object's null element, after an
// edit and its undo, is written as an element holding no properties, which MATLAB reads as it
// reads the null.
describe('a typed object\'s null element, after an edit and its undo', () => {
  it.each([['pNull', [] as string[], 0], ['pArrNull', ['pArrNull(2)'], 1]] as const)('%s is written as {"_properties":{}}', (name, path, slot) => {
    const { session, root } = open(dictionary(), 'gadget.sldd');
    const node = at(root, name, ...path);
    session.setActive(root, node);
    expect(session.editProperty(node.id, 'Description', 'x')).toBe(true);
    session.undo();
    const value = saved(session, root).value(name) as { _elements: unknown[] };
    expect(value._elements[slot]).toEqual({ _properties: {} });
  });
});
