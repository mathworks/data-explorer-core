// Copyright 2026 The MathWorks, Inc.
//
// Each element of a text dictionary's object array keeps its own keys: its `_id`, its
// `_object_class` and its `_custom_save`.
//
// MATLAB writes each element of an object array in a text dictionary as an object of its own,
// `{"_id": "4", "_properties": {…}}`, with `_object_class` beside them on an element of a class
// other than the array's, and with `_custom_save` in place of `_properties` on an element of a
// class that saves through saveobj. ObjectNode.parse handed each element node `{_properties}`
// alone, and ObjectNode.serializeValue wrote each element back from that, so all three were
// gone from the element on every save, an untouched one included: custom_object_text.sldd's
// widget.Parts lost its three `_id`s, a subclass element of a Simulink.Signal array lost its
// class, and an element whose whole state is its `_custom_save` was saved as
// `{"_properties":{}}`. The element is now handed to its node whole, its class on the node's
// wrapper, and written back from what the node writes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest, serializeEntryToXml } from '../src/index.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url))).toString('utf8');
const entriesOf = (json: any) => json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;

function open(text: string) {
  const session = createSession();
  const source: any = ingest(session, text, { filename: 'objects.sldd' });
  return {
    entry: (name: string): any => source.flatten().find((n: any) => n.name === name),
    saved: (name: string): any => entriesOf(JSON.parse((session.serializeSource(source.name) as { text: string }).text)).find((e: any) => e.name === name),
  };
}

/** `rt_text.sldd` with `values` added as entries of the other section. */
function textWith(values: Record<string, unknown>): string {
  const json = JSON.parse(read('./fixtures/rt_text.sldd'));
  const entries = entriesOf(json);
  Object.entries(values).forEach(([name, value], i) => {
    entries.push({ name, metadata: { ...entries[0].metadata, uuid: `d1b2c3d4-0000-4000-8000-00000000000${i}` }, value });
  });
  return JSON.stringify(json, null, '\t');
}

describe('custom_object_text.sldd\'s widget.Parts, a 1x3 WidgetPart array', () => {
  const original = read('./fixtures/custom_object_text.sldd');
  const partsOf = (value: any) => value._elements[0]._properties.Parts;
  const asRead = partsOf(entriesOf(JSON.parse(original)).find((e: any) => e.name === 'widget').value);

  it('is saved untouched as read, every element\'s `_id` with it', () => {
    const { saved } = open(original);
    expect(JSON.stringify(partsOf(saved('widget').value))).toBe(JSON.stringify(asRead));
    expect(asRead._elements.map((e: any) => e._id)).toEqual(['4', '5', '6']);
  });

  it('keeps every `_id` of the dictionary on an untouched save', () => {
    const session = createSession();
    const source: any = ingest(session, original, { filename: 'custom_object_text.sldd' });
    const text = (session.serializeSource(source.name) as { text: string }).text;
    expect([original.split('"_id"').length - 1, text.split('"_id"').length - 1]).toEqual([15, 15]);
  });

  it('keeps each element\'s `_id` when one element is edited, and the edit', () => {
    const { entry, saved } = open(original);
    const parts = entry('widget').children.find((c: any) => c.name === 'Parts');
    const label = parts.children[1].children.find((c: any) => c.name === 'Label');
    expect(label.setProperty('Value', "'edited'")).toBe(true);
    const written = partsOf(saved('widget').value);
    expect(written._elements.map((e: any) => e._id)).toEqual(['4', '5', '6']);
    expect(written._elements.map((e: any) => e._properties.Label)).toEqual(['part1', 'edited', 'part3']);
    expect(partsOf(entry('widget').serialize().value)._elements.map((e: any) => e._id)).toEqual(['4', '5', '6']);
  });
});

// A Simulink.Signal array holding a subclass element and a Simulink.Signal, as a corpus
// dictionary MATLAB wrote holds one in a custom alias type: the first element is marked
// `_object_class`, and each element has its `_id`.
describe('a Simulink.Signal array with a subclass element', () => {
  const SIGNAL = { DataType: 'auto', Description: 'sig', Dimensions: -1 };
  const array = {
    _array_class: 'Simulink.Signal',
    _dimensions: [1, 2],
    _elements: [
      { _id: '6', _object_class: 'MySubclasses.MySlSignal', _properties: { ...SIGNAL, myDescription: 'sub' } },
      { _id: '10', _properties: SIGNAL },
    ],
  };
  const alias = {
    _array_class: 'MySubclasses.MyAliasType',
    _dimensions: [1, 1],
    _elements: [{ _id: '1', _properties: { BaseType: 'double', UserMLArray2: array } }],
    _mw_element_type: 'MATLABArray',
  };

  it('is saved untouched as read, each element\'s `_id` and the subclass element\'s `_object_class` with it', () => {
    const { saved } = open(textWith({ alias }));
    expect(JSON.stringify(saved('alias').value)).toBe(JSON.stringify(alias));
  });

  it('copies each element on its own as an object of its class, which it names once', () => {
    const { entry } = open(textWith({ alias }));
    const [sub, plain] = entry('alias').children.find((c: any) => c.name === 'UserMLArray2').children;
    expect(sub.serialize()).toEqual({ ...alias, _array_class: 'MySubclasses.MySlSignal', _dimensions: [1, 1], _array_type: 'MATLABArray', _elements: [{ _id: '6', _properties: array._elements[0]._properties }] });
    expect(plain.serialize()._elements).toEqual([{ _id: '10', _properties: SIGNAL }]);
  });

  it('keeps them after an edit to the plain element', () => {
    const { entry, saved } = open(textWith({ alias }));
    const plain = entry('alias').children.find((c: any) => c.name === 'UserMLArray2').children[1];
    expect(plain.setProperty('Description', 'edited')).toBe(true);
    const written = saved('alias').value._elements[0]._properties.UserMLArray2;
    expect(written._elements.map((e: any) => [e._id, e._object_class])).toEqual([['6', 'MySubclasses.MySlSignal'], ['10', undefined]]);
    expect(written._elements[1]._properties.Description).toBe('edited');
  });
});

// A text dictionary is JSON anyone can edit, and an element can be something other than an
// object. It holds no properties, and is saved as one holding none, as it always was.
describe('an object array with an element that is not an object', () => {
  it('saves that element as one holding no properties, and the others as read', () => {
    const things = { _array_class: 'My.Thing', _dimensions: [1, 2], _elements: [5, { _id: '2', _properties: { A: 1 } }] };
    const { saved } = open(textWith({ things }));
    expect(saved('things').value._elements).toEqual([{ _properties: {} }, { _id: '2', _properties: { A: 1 } }]);
  });
});

// An object array of a class that saves through saveobj and has no typed node: each element's
// whole state is its `_custom_save`, and it has no `_properties`.
describe('an object array of a class that saves through saveobj', () => {
  const envelope = (n: number) => ({ _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ Bank: 'b' + n, Count: n }], _fields: ['Bank', 'Count'] });
  const savers = {
    _array_class: 'my.SaveobjCls',
    _dimensions: [1, 2],
    _elements: [{ _custom_save: envelope(1), _id: '2' }, { _custom_save: envelope(2), _id: '3' }],
  };
  const widget = {
    _array_class: 'Widget',
    _dimensions: [1, 1],
    _elements: [{ _id: '1', _properties: { Savers: savers, x: 1 } }],
    _mw_element_type: 'MATLABArray',
  };

  it('is saved untouched as read, and copied so', () => {
    const { entry, saved } = open(textWith({ widget }));
    expect(JSON.stringify(saved('widget').value)).toBe(JSON.stringify(widget));
    expect(JSON.stringify(entry('widget').serialize().value)).toBe(JSON.stringify(widget));
  });

  it('writes each element\'s envelope into the XML', () => {
    const { entry } = open(textWith({ widget }));
    const xml = serializeEntryToXml(entry('widget'));
    expect(xml.split('<Element Class="my.SaveobjCls">').length - 1).toBe(2);
    expect(xml.split('<P Source="saveobj" PropertyType="any" Class="struct">').length - 1).toBe(2);
    expect(xml).toContain('<P Name="Bank" Class="char">b1</P>');
    expect(xml).toContain('<P Name="Bank" Class="char">b2</P>');
  });
});
