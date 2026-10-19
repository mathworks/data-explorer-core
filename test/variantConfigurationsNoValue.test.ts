// Copyright 2026 The MathWorks, Inc.
//
// A Simulink.VariantConfigurations has no Value, so the entry takes none and writes none (group H
// item B-19, under group E theme 2, follow MATLAB, measured first; the twin of C-168 and C-169,
// which found the same of Simulink.VariantBank and Simulink.VariantBankCoderInfo).
//
// Measured in R2027a (27.1.0.3409468) by parity/matlab/probe_variantconfigurations_value.m, which
// opens no file and wrote parity/matlab/variantconfigurations_value.truth.json. Both names an entry
// of this kind goes by, Simulink.VariantConfigurationData and Simulink.VariantConfigurations,
// construct a Simulink.VariantConfigurations. `isprop(…, 'Value')` is 0. Its metaclass lists ten
// properties, seven of them hidden, and none is a Value: they are the ten fields of the saveobj
// envelope this package writes for a new entry. Reading a Value fails with "Unrecognized method,
// property, or field 'Value' …", and setting one with "Unrecognized property 'Value' for class
// 'Simulink.VariantConfigurations'."
//
// The node had a Value anyway. It defaulted to '', `_serializedOverrides` returned it, and
// `setProperty('Value', …)` fell through to DataNode's generic tail, which took the text and
// marked the entry Modified. Both save paths then wrote it: beside the envelope in either format
// (`<P Name="Value" Class="char">x</P>`, `_properties: {Value: 'x'}`), and into an entry held as
// plain properties, which gained `Value: ''` on every save, an unedited one included. The Value
// cell already showed nothing and offered no editor, so the edit came through setProperty, a
// host's or another caller's. Now, as for the bank, a Value edit is refused in the bank's words
// and no save writes one. A Value key a file already carries (only ever this package's) is
// written back as read.
//
// Driven through the session API a host uses (`ingest`, `serializeSource`), the model the
// round-trip harness loads (`addEntry`, then the real writers and reader), and the node's own
// `setProperty`, `toRow`, `toPIObject` and save paths.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest, type SerializedSource } from '../src/index.js';
import VariantConfigurationDataNode from '../src/datamodel/node/data/VariantConfigurationDataNode.js';
import { SAVEOBJ_KEY, CUSTOM_SAVE_KEY } from '../src/datamodel/parser/XmlUtils.js';
import type DataNode from '../src/datamodel/node/DataNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';
import {
  loadModel,
  entryByName,
  serializeModel,
  reparseModel,
  type SlddFormat,
} from './parity/fidelity/roundTripHarness.js';

const CLASS = 'Simulink.VariantConfigurations';
const FORMATS: SlddFormat[] = ['binary', 'json'];
const FIXTURE = 'cases.sldd';
// The Design Data section's namespace in a text dictionary.
const NS_DESIGN = 'dacaf35e-55a5-454d-a7c1-93db038a210e';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));
type Measured = {
  typed: string;
  class: string;
  properties: string[];
  isprop_Value: boolean;
  meta: { names: string[]; hidden: boolean[] };
  get_Value: { identifier: string; message: string };
  set_Value: { identifier: string; message: string };
};
const TRUTH: { release: string; rows: Measured[] } = JSON.parse(
  readFileSync(at('./parity/matlab/variantconfigurations_value.truth.json'), 'utf8'),
);

// The bank's refusal (VariantBankNode), in this class's name.
function refusal(node: DataNode, text: string) {
  return {
    error: true,
    reason: `'${node.name}' is a ${CLASS}, which has no Value, so none can be set on it.`,
    invalidValue: text,
    validValue: node.displayValue,
  };
}
function expectRefused(node: DataNode, text: string) {
  const result = node.setProperty('Value', text);
  expect(result).not.toBe(true);
  expect(result).toEqual(refusal(node, text));
}

function piValue(node: DataNode) {
  const pi = node.toPIObject()!;
  const item = (pi.propertySheet.properties as any[]).find((p) => p.name === 'Value');
  return { shown: (pi.objects[0] as Record<string, unknown>).Value, editable: item.editable };
}

// The names of the `<P>` tags directly under the entry's `<Element Class="…">`: for a custom
// saver, the unnamed saveobj envelope and nothing else.
function objectPropNames(entryXml: string): string[] {
  const open = entryXml.indexOf(`<Element Class="${CLASS}">`);
  expect(open, `no ${CLASS} element`).toBeGreaterThan(-1);
  const names: string[] = [];
  let depth = 0;
  const tagRe = /<(\/?)([A-Za-z]+)([^>]*?)(\/?)>/g;
  tagRe.lastIndex = open + `<Element Class="${CLASS}">`.length;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(entryXml)) !== null) {
    const [, close, tag, attrs, selfClose] = m;
    if (close) {
      if (depth === 0) {
        break;
      }
      depth -= 1;
      continue;
    }
    if (tag === 'P' && depth === 0) {
      const nameAttr = /Name="([^"]*)"/.exec(attrs);
      names.push(nameAttr ? nameAttr[1] : '<unnamed>');
    }
    if (!selfClose) {
      depth += 1;
    }
  }
  return names;
}

// The `<Object Class="DD.ENTRY">` holding `name`, out of a binary dictionary's chunk.
function entryXmlOf(bytes: Uint8Array, name: string): string {
  const xml = strFromU8(unzipSync(bytes)['data/chunk0.xml']);
  const named = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(named, `no entry ${name} in the chunk`).toBeGreaterThan(-1);
  const start = xml.lastIndexOf('<Object Class="DD.ENTRY">', named);
  return xml.slice(start, xml.indexOf('</Object>', named) + '</Object>'.length);
}

// The `value._elements[0]` of the text entry named `name`.
function textElementOf(bytes: Uint8Array, name: string): Record<string, any> {
  const entries = JSON.parse(strFromU8(bytes)).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries as any[];
  const entry = entries.find((e) => e.name === name);
  expect(entry, `no entry ${name}`).toBeDefined();
  return entry.value._elements[0];
}

// What a save wrote beside the envelope, in the format's own spelling.
function writtenBeside(bytes: Uint8Array, format: SlddFormat, name: string) {
  if (format === 'binary') {
    const xml = entryXmlOf(bytes, name);
    // Inside the object's element: the entry's own `<P Name="Value">` holds the element.
    const element = xml.slice(xml.indexOf(`<Element Class="${CLASS}">`), xml.lastIndexOf('</Element>'));
    return { props: objectPropNames(xml), valueTag: element.includes('<P Name="Value"') };
  }
  const elem = textElementOf(bytes, name);
  return { props: Object.keys(elem), valueTag: elem._properties !== undefined && 'Value' in elem._properties };
}
const ENVELOPE_ONLY = (format: SlddFormat) => ({ props: format === 'binary' ? ['<unnamed>'] : [CUSTOM_SAVE_KEY], valueTag: false });

// A dictionary holding a new entry `vNew`, saved and opened again, in `format`.
function savedNew(format: SlddFormat, uri: string) {
  const model = loadModel(format, FIXTURE, uri);
  const added: any = model.addEntry(CLASS, 'vNew', 'design');
  expect(added).toBeTruthy();
  expect(added.className).toBe(CLASS);
  return serializeModel(model, format);
}

// `bytes` with a Value 'b1' beside vNew's envelope, in the place and spelling this package's old
// writer put one. Added to the bytes, so the reader is what puts it in the node's bag.
function withValue(bytes: Uint8Array, format: SlddFormat): Uint8Array {
  if (format === 'json') {
    const json = JSON.parse(strFromU8(bytes));
    const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries as any[];
    const elem = entries.find((e) => e.name === 'vNew').value._elements[0];
    expect(Object.keys(elem)).toEqual([CUSTOM_SAVE_KEY]);
    elem._properties = { Value: 'b1' };
    return strToU8(JSON.stringify(json, null, '\t'));
  }
  const parts = unzipSync(bytes);
  const xml = strFromU8(parts['data/chunk0.xml']);
  const entryXml = entryXmlOf(bytes, 'vNew');
  const envelopeEnd = '</P>\n                    </Element>\n                </P>';
  const end = entryXml.lastIndexOf(envelopeEnd);
  expect(end, 'the end of vNew\'s envelope').toBeGreaterThan(-1);
  const edited = entryXml.slice(0, end + envelopeEnd.length) + '\n                <P Name="Value" Class="char">b1</P>' + entryXml.slice(end + envelopeEnd.length);
  parts['data/chunk0.xml'] = strToU8(xml.replace(entryXml, edited));
  return zipSync(parts);
}

describe(`${CLASS} has no Value`, () => {
  it('MATLAB R2027a: neither name builds an object with a Value, and its properties are the envelope\'s fields', () => {
    expect(TRUTH.release).toBe('2027a');
    expect(TRUTH.rows.map((r) => r.typed)).toEqual(['Simulink.VariantConfigurationData', CLASS]);
    const env = (VariantConfigurationDataNode.createDefault('n', null) as any).serial._properties[SAVEOBJ_KEY];
    for (const row of TRUTH.rows) {
      expect(row.class, row.typed).toBe(CLASS);
      expect(row.isprop_Value, row.typed).toBe(false);
      expect(row.meta.names, row.typed).not.toContain('Value');
      expect(row.properties, row.typed).not.toContain('Value');
      expect(row.set_Value.message, row.typed).toBe(`Unrecognized property 'Value' for class '${CLASS}'.`);
      // What the node writes for a new entry is what MATLAB's class holds: the same ten names.
      expect([...env._fields].sort(), row.typed).toEqual([...row.meta.names].sort());
    }
  });

  it('a new entry (createDefault) shows none, refuses one and saves none', () => {
    const node = VariantConfigurationDataNode.createDefault('n', null);
    expect(node.displayValue).toBe('');
    expect(node.valueEditable).toBe(false);
    expect(node.toRow()!._valueEditable).toBe(false);
    expect(piValue(node)).toEqual({ shown: '', editable: false });
    expectRefused(node, 'x');
    // The quoted form a cell would be seeded with, and the empty text it shows.
    expectRefused(node, "'x'");
    expectRefused(node, '');
    expect(node.status).not.toBe('Modified');
    expect(node._serializedOverrides()).toEqual({});
    expect(node._getSerializedProperties()).not.toHaveProperty('Value');
    expect(Object.keys((node.serializeValue() as any)._elements[0])).toEqual([CUSTOM_SAVE_KEY]);
    expect(node.serializeXml('P', { Name: 'Value' }, 0)).not.toContain('<P Name="Value" Class="char"');
  });

  for (const format of FORMATS) {
    describe(`a new entry in a ${format} dictionary`, () => {
      it('refuses a Value edit, and the save writes the envelope alone', () => {
        const uri = `mem://b19-new-${format}`;
        const model = loadModel(format, FIXTURE, uri);
        const added: any = model.addEntry(CLASS, 'vNew', 'design');
        // Saved before the answer is asserted, so that what the file would have held is what
        // fails first: `<P Name="Value" Class="char">x</P>`, or `_properties: {Value: 'x'}`.
        const result = added.setProperty('Value', 'x');
        const bytes = serializeModel(model, format);
        expect(writtenBeside(bytes, format, 'vNew')).toEqual(ENVELOPE_ONLY(format));
        expect(result).toEqual(refusal(added, 'x'));
        expect(added.status).not.toBe('Modified');

        // Opened again, it carries no Value, and still takes none.
        const back = entryByName(reparseModel(bytes, format, FIXTURE, uri), uri, 'vNew');
        expect(back.className).toBe(CLASS);
        expect(back.serial._properties).not.toHaveProperty('Value');
        expectRefused(back, 'x');
      });

      it('keeps a Value the file already carries, as read, and takes no edit of it', () => {
        const uri = `mem://b19-carried-${format}`;
        const input = withValue(savedNew(format, uri), format);
        const model = reparseModel(input, format, FIXTURE, uri);
        const node = entryByName(model, uri, 'vNew');
        expect(node.serial._properties.Value).toBe('b1');
        expectRefused(node, 'changed');
        expectRefused(node, '');
        expect(node.status).not.toBe('Modified');

        // A rename rewrites the entry from the node, so the save reaches the writer (a binary
        // entry nobody edited is written as the bytes it was read from).
        expect(node.setProperty('Name', 'vRenamed')).toBe(true);
        const out = serializeModel(model, format);
        expect(writtenBeside(out, format, 'vRenamed').valueTag).toBe(true);
        const back = entryByName(reparseModel(out, format, FIXTURE, uri), uri, 'vRenamed');
        expect(back.serial._properties.Value).toBe('b1');
      });
    });
  }

  // An entry held as plain properties, with no saveobj envelope: the one shape in which an EMPTY
  // Value reached the file, because `_mergeProps` drops one only under an envelope.
  describe('an entry held as plain properties', () => {
    const PLAIN = { PreferredConfiguration: '' };
    const VALUE = { _array_class: CLASS, _dimensions: [1, 1], _elements: [{ _id: '1', _properties: PLAIN }], _mw_element_type: 'MATLABArray' };
    const textDictionary = () => {
      const json = JSON.parse(readFileSync(at('./fixtures/rt_text.sldd'), 'utf8'));
      const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
      entries.push({
        name: 'vPlain',
        metadata: { ...entries[0].metadata, namespace: NS_DESIGN, uuid: 'b19b19b1-0000-4000-8000-000000000001' },
        value: JSON.parse(JSON.stringify(VALUE)),
      });
      return JSON.stringify(json, null, '\t');
    };

    it('an unedited save, and one after a rename, write no Value on either save path', () => {
      const session = createSession();
      const source: any = ingest(session, textDictionary(), { filename: 'plain.sldd' });
      const node = source.flatten().find((n: any) => n.name === 'vPlain') as DataNode;
      expect(node.className).toBe(CLASS);
      expect((node as any).serial._properties).toEqual(PLAIN);

      const text = () => (session.serializeSource(source.name) as SerializedSource & { text: string }).text;
      const entries = () => JSON.parse(text()).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries as any[];
      // The entry as it was read, key for key and in the file's order.
      expect(JSON.stringify(entries().find((e) => e.name === 'vPlain').value)).toBe(JSON.stringify(VALUE));
      expect(node._getSerializedProperties()).toEqual(PLAIN);
      expectRefused(node, 'x');

      expect(node.setProperty('Name', 'vPlain2')).toBe(true);
      expect(textElementOf(strToU8(text()), 'vPlain2')._properties).toEqual(PLAIN);
    });
  });
});
