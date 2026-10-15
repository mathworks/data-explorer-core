// Copyright 2026 The MathWorks, Inc.
// A text dictionary spells a scalar object nested in another value — an object's property, a
// Parameter's Value, a cell's element there — as `{_id, _object_class, _properties}`, and one
// whose class saves through saveobj as `{_id, _object_class, _custom_save}`: the envelope beside
// the bag, not in it (XmlUtils' CUSTOM_SAVE_KEY). Written as XML, as a host writes an entry
// pasted into a binary dictionary, the writer wraps that spelling as the one element of a 1x1
// `_array_class` bag (DataNode.serializePropertyXml, and _serializeCellElementXml for a cell's
// element), and the wrapped element carried `_properties` alone. The envelope was dropped
// there, so _objectXml saw an element with no properties and wrote it self-closed as
// `<Element Class="…"/>`: the object's whole saved state gone. The same object spelled with
// `_array_class` writes MATLAB's saveobj <P> on every route (objectNode.test.ts, "of a class
// that serializes through saveobj and has no typed node, read from a text dictionary").

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import '../src/datamodel/node/data/NodeClassMap.js';
import { createSession, ingest, serializeEntryToXml } from '../src/index.js';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
const CLASS = 'my.SaveobjCls';
const ENVELOPE_TAG = '<P Source="saveobj" PropertyType="any" Class="struct">';
const content = (json: any) => json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content;

// parity/artifacts/binary/cases.sldd's aVariant, relabelled to a class with no typed node: its
// saveobj envelope as the binary reader holds it.
const files = unzipSync(new Uint8Array(read('./parity/artifacts/binary/cases.sldd')));
const chunk = strFromU8(files['data/chunk0.xml']).replace('<Element Class="Simulink.VariantVariable">', `<Element Class="${CLASS}">`);
const relabelled = zipSync({ ...files, 'data/chunk0.xml': strToU8(chunk) });
const binaryEntry: any = ingest(createSession(), relabelled, { filename: 'cases.sldd' })
  .flatten()
  .find((n: any) => n.name === 'aVariant');
const envelope = binaryEntry.serial._rawVal._elements[0]._properties._saveobj;

const widget = (props: Record<string, unknown>) => ({
  _array_class: 'Widget',
  _array_type: 'MATLABArray',
  _dimensions: [1, 1],
  _mw_element_type: 'MATLABArray',
  _elements: [{ _properties: props }],
});
const parameter = (value: unknown) => ({
  _array_class: 'Simulink.Parameter',
  _dimensions: [1, 1],
  _elements: [{ _properties: { Value: value } }],
  _mw_element_type: 'MATLABArray',
});
const cellOf = (o: unknown) => ({ _array_type: 'Cell', _dimensions: [1, 2], _elements: [o, 1] });

// The routes whose writer is one of the two wrapping arms: a property (serializePropertyXml) and
// a cell's element inside a property (_serializeCellElementXml).
const ROUTES: Record<string, (o: unknown) => unknown> = {
  inObject: (o) => widget({ P: o, x: 1 }),
  inParameter: (o) => parameter(o),
  inObjectCell: (o) => widget({ C: cellOf(o), x: 1 }),
  inParameterCell: (o) => parameter(cellOf(o)),
};

const textWith = (spelling: () => unknown): string => {
  const json = JSON.parse(read('./fixtures/rt_text.sldd').toString('utf8'));
  const entries = content(json).entries;
  Object.entries(ROUTES).forEach(([name, route], i) => {
    entries.push({ name, metadata: { ...entries[0].metadata, uuid: `c43e9523-8ba6-426a-b689-6e7d8593${1000 + i}` }, value: route(spelling()) });
  });
  return JSON.stringify(json, null, '\t');
};
const xmlOf = (text: string, name: string): string =>
  serializeEntryToXml(
    ingest(createSession(), text, { filename: 'gadget.sldd' })
      .flatten()
      .find((n: any) => n.name === name) as any,
  );

describe('a scalar nested object spelled with `_object_class`, read from a text dictionary, written as XML', () => {
  it('writes the saveobj envelope of one holding `_custom_save` once, as its `_array_class` spelling writes it', () => {
    const text = textWith(() => ({ _id: '2', _object_class: CLASS, _custom_save: envelope }));
    const twin = textWith(() => ({ _array_class: CLASS, _dimensions: [1, 1], _elements: [{ _custom_save: envelope, _id: '2' }] }));
    const names = Object.keys(ROUTES);
    expect(names.map((name) => [name, xmlOf(text, name).split(ENVELOPE_TAG).length - 1])).toEqual(names.map((name) => [name, 1]));
    for (const name of names) {
      expect([name, xmlOf(text, name)]).toEqual([name, xmlOf(twin, name)]);
    }
  });

  it('writes one holding no `_custom_save` as its `_array_class` spelling writes it, with no envelope', () => {
    const text = textWith(() => ({ _id: '2', _object_class: CLASS, _properties: { a: 1 } }));
    const twin = textWith(() => ({ _array_class: CLASS, _dimensions: [1, 1], _elements: [{ _properties: { a: 1 } }] }));
    const names = Object.keys(ROUTES);
    expect(names.map((name) => [name, xmlOf(text, name).includes('Source="saveobj"'), xmlOf(text, name).includes(`Class="${CLASS}"`)])).toEqual(
      names.map((name) => [name, false, true]),
    );
    for (const name of names) {
      expect([name, xmlOf(text, name)]).toEqual([name, xmlOf(twin, name)]);
    }
  });
});
