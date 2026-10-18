// Copyright 2026 The MathWorks, Inc.
//
// A Simulink object whose text dictionary holds its properties beside its class, with no
// element, opens, is saved as it was read, and is shown read-only (SER-TE; the maintainer's
// group F ruling, 2026-10-18, option (a)).
//
// MATLAB writes an object's properties inside its one element:
//
//     {"_array_class": "Simulink.Parameter", "_elements": [{"_properties": {"Value": 0.001}}]}
//
// A text dictionary is JSON anyone, or any generator, can write, and three in the local
// corpus (complex/base, plant and shared.sldd, written by a test generator) hold them inline
// instead, with no `_elements` at all:
//
//     {"_array_class": "Simulink.Parameter", "_array_type": "object", "Value": 0.001, ...}
//
// A typed node reads its properties from the element only, so such an entry opens with each
// at its default (a Parameter's Value blank, its DataType auto), which (a) keeps. But its
// class's serializeValue rebuilt the element from `_elements[0]`, and threw a TypeError,
// "Cannot read properties of undefined (reading '0')": an untouched save of the whole file,
// a copy of the entry, and a save after a rename all failed, in a Parameter, a bus and an
// enumeration type alike. Now each is written as it was read, an edit that the replay would
// drop is refused, and so is its XML, which the binary dictionary a paste writes it into has
// no spelling for: it used to be an `<Element>` of the class holding no property at all.
//
// The dictionary is built here from sparse_text.sldd and an entry of the corpus's shape; the
// corpus files themselves are not committed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { MatBudgetError, MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { BINARY, copyOf, sparseFixture, thrownBy } from './tools/pasteVenues.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

// complex/base.sldd's SampleTime, as the generator wrote it.
const PARAMETER = {
  _array_class: 'Simulink.Parameter',
  _array_type: 'object',
  Value: 0.001,
  DataType: 'double',
  Min: '',
  Max: '',
  Unit: 's',
  Description: 'Base sample time',
};
// The same shape for the other classes whose serializeValue threw on it.
const BUS = { _array_class: 'Simulink.Bus', _array_type: 'object', DataScope: 'Auto', Description: 'A bus', HeaderFile: '' };
const CONNECTION_BUS = { _array_class: 'Simulink.ConnectionBus', _array_type: 'object', Description: 'A connection bus' };
const SERVICE_BUS = { _array_class: 'Simulink.ServiceBus', _array_type: 'object', Description: 'A service bus' };
const ENUM_TYPE = {
  _array_class: 'Simulink.data.dictionary.EnumTypeDefinition',
  _array_type: 'object',
  DefaultValue: 'On',
  Description: 'An enumeration',
};
// `_elements: null`, which a hand edit can leave, threw the same TypeError, on null.
const NULL_ELEMENTS = { ...PARAMETER, _elements: null };

const CASES: [name: string, value: Record<string, unknown>, node: string][] = [
  ['SampleTime', PARAMETER, 'ParameterNode'],
  ['InlineBus', BUS, 'BusNode'],
  ['InlineConnectionBus', CONNECTION_BUS, 'ConnectionBusNode'],
  ['InlineServiceBus', SERVICE_BUS, 'ServiceBusNode'],
  ['InlineEnum', ENUM_TYPE, 'EnumTypeNode'],
  ['NullElements', NULL_ELEMENTS, 'ParameterNode'],
];

// The corpus files' metadata is in the binary reader's keys (lastModifiedDate, lastModifiedBy),
// which any save of a text dictionary spells in MATLAB's (DataNode's textDictionaryMetadata).
// Here it is in MATLAB's, so that an untouched save is compared byte for byte with what was read.
const metadataOf = (k: number) => ({
  uuid: `000000${(0x12 + k).toString(16)}-0000-4000-8000-0000000000${(0x12 + k).toString(16)}`,
  namespace: 'dacaf35e-55a5-454d-a7c1-93db038a210e',
  lastmod: '20260603T000000.000000',
  modifiedby: 'testgen',
  isderived: '0',
});

/** sparse_text.sldd with each case appended as an entry, in the file's own tab-indented layout. */
const DICTIONARY = (() => {
  const json = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/sparse/sparse_text.sldd', import.meta.url)), 'utf8'));
  const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  CASES.forEach(([name, value], k) => entries.push({ name, metadata: metadataOf(k), value }));
  return JSON.stringify(json, null, '\t');
})();

const open = (): { session: Any; root: Any } => {
  const session = createSession();
  return { session, root: ingest(session, DICTIONARY, { filename: 'inline.sldd' }) };
};
const entryOf = (root: Any, name: string): Any => root.getSection('design').children.find((e: Any) => e.name === name);
/** The value of the entry `name` in the text dictionary `text`. */
const savedValue = (text: string, name: string): unknown =>
  JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: Any) => e.name === name)?.value;

const editRefusal = (name: string) =>
  `'${name}' holds its properties in a form MATLAB does not write. This editor cannot show or change them, and a save keeps them as written.`;
const xmlRefusal = (name: string) =>
  `Cannot write "${name}": ${name} holds its properties in a form MATLAB does not write, which a binary dictionary has no spelling for. Nothing was written.`;

// The edits each case also refuses, beyond its Description.
const EDITS: Record<string, [prop: string, text: string][]> = {
  SampleTime: [
    ['Value', '5'],
    ['DataType', 'single'],
    ['Min', '0'],
    ['Max', '1'],
    ['StorageClass', 'ExportedGlobal'],
  ],
  InlineBus: [['DataScope', 'Exported']],
  InlineEnum: [['DefaultValue', 'Off']],
  NullElements: [['Value', '5']],
};

let seq = 0;
/** `value` pasted as the entry `name` into a fresh sparse_binary.sldd, as a host pastes a copy. */
function pastedIntoBinary(name: string, value: unknown): { session: Any; root: Any; entry: Any } {
  const session = createSession();
  const root: Any = ingest(session, sparseFixture(BINARY), { filename: BINARY });
  const entry = root
    .getSection('design')
    .parseEntry({ name, metadata: { uuid: `00000000-0000-4000-5e7e-${String(++seq).padStart(12, '0')}` }, value: JSON.parse(JSON.stringify(value)) });
  return { session, root, entry };
}

// Each property this node shows, other than its name, by the key getPropInfo answers for.
const shownKeys = (entry: Any): string[] => entry.getProperties().map((p: Any) => p.key).filter((k: string) => k !== 'Name');

describe('a text dictionary holding objects whose properties are beside their class, with no element', () => {
  it('opens each as its class, with each property at its default, as it opened before', () => {
    const { root } = open();
    for (const [name, value, node] of CASES) {
      const entry = entryOf(root, name);
      expect(entry.constructor.name, name).toBe(node);
      expect(entry.className, name).toBe(value._array_class);
      expect(entry.children.length, name).toBe(0);
    }
    const parameter = entryOf(root, 'SampleTime');
    expect([parameter.Value, parameter.DataType, parameter.Description]).toEqual([undefined, 'auto', '']);
  });

  it('is saved, untouched, as the bytes it was read from', () => {
    const { session, root } = open();
    const out = session.serializeSource(root.name)!;
    expect(out.kind).toBe('text');
    expect(out.text).toBe(DICTIONARY);
  });
});

describe.each(CASES)('the entry %s, holding its properties beside its class', (name, value) => {
  it('is copied as it was read', () => {
    const { root } = open();
    expect(entryOf(root, name).serialize().value).toEqual(value);
    expect(copyOf(entryOf(root, name))).toEqual(JSON.parse(JSON.stringify(value)));
  });

  it('is renamed, and saved under its new name with its value as it was read', () => {
    const { session, root } = open();
    expect(entryOf(root, name).setProperty('Name', name + 'R')).toBe(true);
    const out = session.serializeSource(root.name)!;
    expect(savedValue(out.text, name)).toBeUndefined();
    expect(savedValue(out.text, name + 'R')).toEqual(value);
    expect(entryOf(root, name + 'R').serialize().value).toEqual(value);
  });

  it('refuses an edit to any property but its name, which the save would drop, and the save is unchanged', () => {
    const { session, root } = open();
    const entry = entryOf(root, name);
    const edits: [prop: string, text: string][] = [
      ['Description', 'x'],
      ...(EDITS[name] ?? []),
    ];
    for (const [prop, text] of edits) {
      expect(entry.setProperty(prop, text), prop).toMatchObject({ error: true, reason: editRefusal(name), invalidValue: text });
    }
    expect(session.serializeSource(root.name)!.text).toBe(DICTIONARY);
  });

  it('offers an editor for its name alone, and takes no child', () => {
    const { root } = open();
    const entry = entryOf(root, name);
    expect(entry.getPropInfo(entry.getProperties().find((p: Any) => p.key === 'Name')).editable).toBe(true);
    for (const key of shownKeys(entry)) {
      expect(entry.getPropInfo(entry.getProperties().find((p: Any) => p.key === key)).editable, key).toBe(false);
    }
    expect([entry.valueEditable, entry.descriptionEditable, entry.toRow()._descriptionEditable]).toEqual([false, false, false]);
    expect(entry.canAddChild()).toBe(false);
    expect(entry.canRemoveChild?.() ?? false).toBe(false);
    expect(entry.execAddChild?.() ?? null).toBeNull();
    expect(entry.children.length).toBe(0);
  });

  it('is refused as XML, naming the entry, and so are its paste into a binary dictionary and the save of that', () => {
    const { root } = open();
    const [direct] = thrownBy(() => serializeEntryToXml(entryOf(root, name)));
    expect(direct).toBeInstanceOf(MatWriteError);
    expect(direct).not.toBeInstanceOf(MatBudgetError);
    expect(direct!.message).toBe(xmlRefusal(name));
    // Pasted into a binary dictionary as a copy carries it (the value as read), and saved there.
    const { session, root: binary, entry } = pastedIntoBinary(name, value);
    const [xml] = thrownBy(() => serializeEntryToXml(entry));
    expect(xml).toBeInstanceOf(MatWriteError);
    expect(xml!.message).toBe(xmlRefusal(name));
    const [saved] = thrownBy(() => session.serializeSource(binary.name));
    expect(saved).toBeInstanceOf(MatWriteError);
    expect(saved!.message).toBe(xmlRefusal(name));
  });
});

// Two classes whose text save did not throw on this shape, and is left as it was; their XML, an
// `<Element>` of the class with no property, is refused by the same writer.
describe.each([
  ['InlineSignal', { _array_class: 'Simulink.Signal', _array_type: 'object', DataType: 'single', Description: 'd' }, 'SignalNode'],
  ['InlineWidget', { _array_class: 'Widget', _array_type: 'object', DataType: 'single', Description: 'd' }, 'ObjectNode'],
] as [string, Record<string, unknown>, string][])('the entry %s, pasted into a binary dictionary', (name, value, node) => {
  it('is refused as XML, naming the entry, and so is the save', () => {
    const { session, root, entry } = pastedIntoBinary(name, value);
    expect(entry.constructor.name).toBe(node);
    const [xml] = thrownBy(() => serializeEntryToXml(entry));
    expect(xml).toBeInstanceOf(MatWriteError);
    expect(xml!.message).toBe(xmlRefusal(name));
    const [saved] = thrownBy(() => session.serializeSource(root.name));
    expect(saved).toBeInstanceOf(MatWriteError);
    expect(saved!.message).toBe(xmlRefusal(name));
  });
});

describe('an object whose properties are in its element, in the same dictionary', () => {
  it('is still edited, saved and written as XML as before', () => {
    const { session, root } = open();
    const parameter = entryOf(root, 'pDense');
    expect(parameter.constructor.name).toBe('ParameterNode');
    expect([parameter.valueEditable, parameter.descriptionEditable]).toEqual([true, true]);
    expect(parameter.setProperty('Description', 'edited')).toBe(true);
    expect(parameter.setProperty('Value', '7')).toBe(true);
    const saved = savedValue(session.serializeSource(root.name)!.text, 'pDense') as Any;
    expect(saved._elements[0]._properties).toMatchObject({ Description: 'edited', Value: 7 });
    const xml = serializeEntryToXml(parameter);
    expect(xml).toContain('<Element Class="Simulink.Parameter">');
    expect(xml).toContain('<P Name="Description" Class="char">edited</P>');
  });
});
