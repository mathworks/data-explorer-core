// Copyright 2026 The MathWorks, Inc.
//
// A bus element or an enumeral that is not an element opens the dictionary, with a warning
// (C-190, under the 2026-10-18 ruling on damaged input: warn and show what was read, never
// refuse the file).
//
// A text dictionary is JSON anyone can edit, so an element of a bus's Elements_internal, or of an
// enumeration's Enumerals, can be `null`, a number or a string. MATLAB never writes one. A `null`
// made the whole dictionary fail to open: the bus read `_properties` of it, and the enumeration
// read `Name` of it. A number or a string opened with nothing said: a bus dropped it, and an
// enumeration showed it as an enumeral named "".
//
// Now such an element gets no row, and the entry says so once. An untouched save writes the entry
// as it was read, the element included. An edit to the entry rebuilds it from its rows, so the
// element is gone from that save. A binary dictionary has no spelling for it, so the entry's XML
// is the XML of its rows.
//
// A bus that dropped a number or a string already showed the right rows, saved the right value
// after an edit and wrote the right XML. Those cases are kept here as controls: the change must
// not make such an element a row.
//
// One fixture holds all four kinds: arch.sldd's DataInterface (Simulink.Bus), PhysicalInterface
// (Simulink.ConnectionBus), ServiceInterface (Simulink.ServiceBus) and EnumType
// (Simulink.data.dictionary.EnumTypeDefinition). Everything goes through ingest and the session.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const PRISTINE = readFileSync(fileURLToPath(new URL('./fixtures/arch.sldd', import.meta.url)), 'utf8');
const SECTION = 'arch';

interface Kind {
  entry: string;
  /** The class, short, for the test's title. */
  short: string;
  className: string;
  /** The property holding the element list. */
  list: string;
  /** What the warning calls one element. */
  noun: string;
  /** An edit to the first element that is shown, through the session: property and value. */
  edit: [string, string];
}

const KINDS: Kind[] = [
  { entry: 'DataInterface', short: 'Bus', className: 'Simulink.Bus', list: 'Elements_internal', noun: 'bus element', edit: ['Description', 'edited'] },
  { entry: 'PhysicalInterface', short: 'ConnectionBus', className: 'Simulink.ConnectionBus', list: 'Elements_internal', noun: 'bus element', edit: ['Description', 'edited'] },
  // A function element has no Description; a rename is an edit too.
  { entry: 'ServiceInterface', short: 'ServiceBus', className: 'Simulink.ServiceBus', list: 'Elements_internal', noun: 'bus element', edit: ['Name', 'renamedFn'] },
  { entry: 'EnumType', short: 'EnumTypeDefinition', className: 'Simulink.data.dictionary.EnumTypeDefinition', list: 'Enumerals', noun: 'enumeral', edit: ['Description', 'edited'] },
];

// Not an element: what a hand edit can leave, and how the warning names it.
const NOT_ELEMENTS: Array<[string, unknown, string]> = [
  ['null', null, 'null'],
  ['a number', 5, '5'],
  ['a string', 'x', '"x"'],
];
const WHERE = ['first', 'middle', 'last'] as const;

const entriesOf = (json: any): any[] => json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
const listOf = (json: any, kind: Kind): any => entriesOf(json).find((e) => e.name === kind.entry).value._elements[0]._properties[kind.list];

/**
 * arch.sldd with `values` put into the kind's element list at `where`, and the list's
 * _dimensions grown to match, so the element is the file's only damage. The position each one
 * ends up at, 1-based, is returned with it.
 */
function damaged(kind: Kind, where: (typeof WHERE)[number], values: unknown[]): { text: string; positions: number[] } {
  const json = JSON.parse(PRISTINE);
  const list = listOf(json, kind);
  const elements: unknown[] = list._elements;
  const n = elements.length;
  const at = where === 'first' ? 0 : where === 'middle' ? 1 : n;
  elements.splice(at, 0, ...values);
  list._dimensions = list._dimensions.map((d: number) => (d === n ? elements.length : d));
  const positions = values.map((_, i) => at + i + 1);
  return { text: JSON.stringify(json, null, '\t'), positions };
}

function open(text: string): { session: any; root: any } {
  const session = createSession();
  return { session, root: ingest(session, text, { filename: 'arch.sldd' }) };
}

function entryOf(root: any, name: string): any {
  const entry = root.getSection(SECTION).children.find((e: any) => e.name === name);
  expect(entry, name).toBeDefined();
  return entry;
}

/** Every row of the dictionary, by path, with its class and the value it shows. */
function rowsOf(root: any): string[] {
  const out: string[] = [];
  const walk = (n: any, path: string): void => {
    out.push(`${path} <${String(n.className)}> = ${String(n.displayValue)}`);
    for (const c of n.children) {
      walk(c, path + '/' + c.displayName);
    }
  };
  for (const section of root.children) {
    walk(section, section.name);
  }
  return out;
}

/** The entry's value as the session saves it. */
function savedValue(session: any, root: any, name: string): any {
  const text = (session.serializeSource(root.name) as { text: string }).text;
  return entriesOf(JSON.parse(text)).find((e) => e.name === name).value;
}

/** The kind's edit, to the first element shown, as a host makes it. */
function editFirstElement(session: any, root: any, kind: Kind): void {
  const element = entryOf(root, kind.entry).children[0];
  session.setActive(root, element);
  expect(session.editProperty(element.id, kind.edit[0], kind.edit[1])).toBe(true);
}

const CASES = KINDS.flatMap((kind) =>
  NOT_ELEMENTS.flatMap(([label, value, spelled]) =>
    WHERE.map((where) => [`${kind.short} ${kind.entry}, ${label} ${where}`, { kind, value, spelled, where }] as const),
  ),
);

describe('a bus element or an enumeral that is not an element', () => {
  it('control: the file as MATLAB wrote it opens with no warning', () => {
    const { root } = open(PRISTINE);
    expect(root.warnings ?? []).toEqual([]);
    for (const kind of KINDS) {
      expect(entryOf(root, kind.entry).className).toBe(kind.className);
    }
  });

  it.each(CASES)('%s: the file opens, and every row is the row of the file without it', (_title, { kind, value, where }) => {
    const { text } = damaged(kind, where, [value]);
    const { root } = open(text);
    expect(rowsOf(root)).toEqual(rowsOf(open(PRISTINE).root));
    const shown = entryOf(root, kind.entry).children.map((c: any) => c.name);
    const read = listOf(JSON.parse(PRISTINE), kind)._elements.map((e: any) => e._properties?.Name ?? e.Name);
    expect(shown).toEqual(read);
  });

  it.each(CASES)('%s: one warning, against the entry, says what was not shown and where', (_title, { kind, value, spelled, where }) => {
    const { text, positions } = damaged(kind, where, [value]);
    const { root } = open(text);
    expect((root.warnings ?? []).map((w: any) => [w.code, w.part])).toEqual([['part-unreadable', kind.entry]]);
    const { message } = root.warnings[0];
    expect(message).toContain(`"${kind.entry}"`);
    expect(message).toContain(`1 ${kind.noun} `);
    expect(message).toContain(`${spelled} at position ${positions[0]}`);
    expect(message).toContain('not shown');
    expect(message).toContain('an edit');
  });

  it.each(CASES)('%s: an untouched save writes the file as it was read', (_title, { kind, value, where }) => {
    const { text } = damaged(kind, where, [value]);
    const { session, root } = open(text);
    expect((session.serializeSource(root.name) as { text: string }).text).toBe(text);
  });

  it.each(CASES)('%s: an edit to the entry saves its rows, without the element', (_title, { kind, value, where }) => {
    const { text } = damaged(kind, where, [value]);
    const { session, root } = open(text);
    editFirstElement(session, root, kind);
    const saved = savedValue(session, root, kind.entry);
    const elements = saved._elements[0]._properties[kind.list]._elements;
    expect(elements.every((e: unknown) => e !== null && typeof e === 'object' && !Array.isArray(e))).toBe(true);
    expect(elements).toHaveLength(listOf(JSON.parse(PRISTINE), kind)._elements.length);
    // The same edit to the file without the element saves the same value.
    const control = open(PRISTINE);
    editFirstElement(control.session, control.root, kind);
    expect(saved).toEqual(savedValue(control.session, control.root, kind.entry));
  });

  it.each(CASES)('%s: the entry writes as XML, the XML of the file without it', (_title, { kind, value, where }) => {
    const { text } = damaged(kind, where, [value]);
    const xml = serializeEntryToXml(entryOf(open(text).root, kind.entry));
    expect(xml).toBe(serializeEntryToXml(entryOf(open(PRISTINE).root, kind.entry)));
  });

  it.each(KINDS)('$short $entry: two of them are one warning, which counts both', (kind) => {
    const { text } = damaged(kind, 'middle', [null, 5]);
    const { session, root } = open(text);
    expect(rowsOf(root)).toEqual(rowsOf(open(PRISTINE).root));
    expect((root.warnings ?? []).map((w: any) => [w.code, w.part])).toEqual([['part-unreadable', kind.entry]]);
    const { message } = root.warnings[0];
    expect(message).toContain(`2 ${kind.noun}s `);
    expect(message).toContain('null at position 2');
    expect(message).toContain('5 at position 3');
    expect((session.serializeSource(root.name) as { text: string }).text).toBe(text);
  });

  it.each(KINDS)('$short $entry: the save after an edit opens with no warning', (kind) => {
    const { text } = damaged(kind, 'middle', [null]);
    const { session, root } = open(text);
    editFirstElement(session, root, kind);
    const again = open((session.serializeSource(root.name) as { text: string }).text);
    expect(again.root.warnings ?? []).toEqual([]);
  });
});
