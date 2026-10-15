// Copyright 2026 The MathWorks, Inc.
// A text dictionary spells a scalar object nested in another value as `{_id, _object_class,
// _properties}`, and one whose class saves through saveobj as `{_id, _object_class,
// _custom_save}` (objectClassCustomSave.test.ts). Inside an entry's own struct or cell, the
// object is a node of its own, an ObjectNode (NodeClassMap.parseValue), and the struct or cell
// writes it as XML by asking it to write itself, as a host writes an entry pasted into a binary
// dictionary. DataNode.serializeXml wrote an object only when its value was spelled
// `_array_class`. In this spelling it fell to the bare-tag fallback and wrote `<P/>` for a struct
// field, with no Name, and `<Element/>` for a cell element: the field's name, the object's class
// and all its properties gone. Reopened, the struct held a field named "undefined". The same
// object spelled `_array_class` is written as MATLAB writes an object at a struct field and in a
// cell (fixtures/cellarr_binary.sldd's sObjArr and cObj), and that is what each route is held to.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import '../src/datamodel/node/data/NodeClassMap.js';
import { createSession, ingest, serializeEntryToXml } from '../src/index.js';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
const CLASS = 'my.Cls';
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

// The routes on which the object is a node the entry's value writes by asking it to: a field of
// a struct (StructNode.serializeXml, scalar and array), an element of a cell
// (MatlabVariableNode's cell writer), and the entry's value itself (serializeEntryToXml).
const ROUTES: Record<string, (o: () => unknown) => unknown> = {
  entryStruct: (o) => ({ _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ f: o(), g: 1 }] }),
  entryStructArray: (o) => ({ _array_type: 'Struct', _dimensions: [1, 2], _elements: [{ f: o() }, { f: o() }] }),
  entryCell: (o) => ({ _array_type: 'Cell', _dimensions: [1, 2], _elements: [o(), 1] }),
  direct: (o) => o(),
};
const NAMES = Object.keys(ROUTES);

const textWith = (spelling: () => unknown): string => {
  const json = JSON.parse(read('./fixtures/rt_text.sldd').toString('utf8'));
  const entries = content(json).entries;
  Object.entries(ROUTES).forEach(([name, route], i) => {
    entries.push({ name, metadata: { ...entries[0].metadata, uuid: `d43e9523-8ba6-426a-b689-6e7d8593${1000 + i}` }, value: route(spelling) });
  });
  return JSON.stringify(json, null, '\t');
};
const entryOf = (text: string, name: string): any =>
  ingest(createSession(), text, { filename: 'gadget.sldd' })
    .flatten()
    .find((n: any) => n.name === name);
const xmlOf = (text: string, name: string): string => serializeEntryToXml(entryOf(text, name));
const count = (xml: string, needle: string): number => xml.split(needle).length - 1;

describe('a scalar object spelled with `_object_class` in an entry\'s own struct or cell, read from a text dictionary, written as XML', () => {
  const text = textWith(() => ({ _id: '2', _object_class: CLASS, _properties: { a: 1 } }));
  const twin = textWith(() => ({ _array_class: CLASS, _dimensions: [1, 1], _elements: [{ _properties: { a: 1 } }] }));

  it('writes its field name, its class and its properties, and no bare tag', () => {
    expect(
      NAMES.map((name) => {
        const xml = xmlOf(text, name);
        return [name, count(xml, `<Element Class="${CLASS}">`), count(xml, '<P Name="a" Class="double">1.0</P>'), /<P\/>|<Element\/>/.test(xml)];
      }),
    ).toEqual([
      ['entryStruct', 1, 1, false],
      ['entryStructArray', 2, 2, false],
      ['entryCell', 1, 1, false],
      ['direct', 1, 1, false],
    ]);
    expect(count(xmlOf(text, 'entryStruct'), '<P Name="f">')).toBe(1);
    expect(count(xmlOf(text, 'entryStructArray'), '<P Name="f">')).toBe(2);
    expect(count(xmlOf(text, 'direct'), '<P Name="Value">')).toBe(1);
  });

  it('writes it as its `_array_class` spelling writes it', () => {
    for (const name of NAMES) {
      expect([name, xmlOf(text, name)]).toEqual([name, xmlOf(twin, name)]);
    }
  });

  it('writes the saveobj envelope of one holding `_custom_save` once per object, as its `_array_class` spelling writes it', () => {
    const saver = textWith(() => ({ _id: '2', _object_class: CLASS, _custom_save: envelope }));
    const saverTwin = textWith(() => ({ _array_class: CLASS, _dimensions: [1, 1], _elements: [{ _custom_save: envelope, _id: '2' }] }));
    expect(NAMES.map((name) => [name, count(xmlOf(saver, name), ENVELOPE_TAG)])).toEqual([
      ['entryStruct', 1],
      ['entryStructArray', 2],
      ['entryCell', 1],
      ['direct', 1],
    ]);
    for (const name of NAMES) {
      expect([name, xmlOf(saver, name)]).toEqual([name, xmlOf(saverTwin, name)]);
    }
  });

  it('pasted into a binary dictionary and saved, reopens as the object it was, under its field name', () => {
    // As a host pastes: the entry's JSON (entry.serialize()), parsed into the binary
    // dictionary's section, the dictionary saved and opened again.
    const reopened = (from: string): Record<string, unknown> => {
      const session = createSession();
      const binary: any = ingest(session, relabelled, { filename: 'cases.sldd' });
      const design = binary.getSection('design');
      NAMES.forEach((name, i) => {
        const payload = JSON.parse(JSON.stringify(entryOf(from, name).serialize()));
        design.parseEntry({ ...payload, name: `${name}Pasted`, metadata: { ...design.children[0].metadata, uuid: `e43e9523-8ba6-426a-b689-6e7d8590${1000 + i}` } });
      });
      const saved = (session.serializeSource(binary.name) as { bytes: Uint8Array }).bytes;
      const back: any = ingest(createSession(), saved, { filename: 'cases.sldd' });
      return Object.fromEntries(
        NAMES.map((name) => [name, back.flatten().find((n: any) => n.name === `${name}Pasted`).serialize().value]),
      );
    };
    const values = reopened(text);
    expect(Object.keys((values.entryStruct as any)._elements[0])).toEqual(['f', 'g']);
    expect((values.entryStruct as any)._elements[0].f._array_class).toBe(CLASS);
    expect((values.entryCell as any)._elements[0]._array_class).toBe(CLASS);
    expect((values.direct as any)._array_class).toBe(CLASS);
    expect(values).toEqual(reopened(twin));
  });
});
