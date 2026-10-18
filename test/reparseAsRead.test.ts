// Copyright 2026 The MathWorks, Inc.
//
// A text dictionary's own entry, re-read from the dictionary's text (F1-22). A host that shows
// the dictionary as its JSON text (data-explorer-vscode's JSON view) re-reads an entry the user
// edits there as the file's read does: JSON.parse of the entry's element, then
// SectionNode.parseEntry. The file's read records what a text dictionary holds that no writer
// would take from anywhere else (MatWriter.heldByTextDictionary): dims holding an infinity,
// which is what JSON.parse makes of a hand-typed 1e400, and complex text with no MAT stream to
// be instead. A save writes those back as read. The re-read recorded nothing, so the same
// text that was accepted when the file was opened was refused once re-read: serialize() threw,
// and with it the host's copy, undo record and table edit of the entry.
//
// `parseEntry(record, systemComposer, { asRead: true })` says the record is the dictionary's
// own text, and the re-read records what the read records. A paste, a drop or an undo record
// does not say so, and is refused as before (dimsWriters.test.ts). Neither does a binary
// dictionary, whose read records nothing.
import { describe, it, expect } from 'vitest';
import { strFromU8, strToU8 } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { BINARY, TEXT, sparseFixture, thrownBy } from './tools/pasteVenues.js';

const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const entriesOf = (json: any) => json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
const NOT_A_COUNT = ', a size that is not a count, so what it would add beyond its data cannot be held to the 16 MiB one value may add. Nothing was written.';

// Each entry's value as typed into the file, and what serialize() refuses it with as a paste.
const OWN: { name: string; text: string; refused: [string, string] }[] = [
  {
    name: 'ownCell',
    text: '{"_array_type":"Cell","_dimensions":[0,1e400],"_elements":[],"_mw_element_type":"MATLABArray"}',
    refused: ['not-a-count', 'ownCell is a cell declaring dimensions [0,Infinity]' + NOT_A_COUNT],
  },
  {
    name: 'ownStruct',
    text: '{"_array_type":"Struct","_dimensions":[0,1e400],"_elements":[],"_fields":["f"]}',
    refused: ['not-a-count', 'ownStruct is a struct declaring dimensions [0,Infinity]' + NOT_A_COUNT],
  },
  {
    name: 'ownField',
    text: '{"_array_type":"Struct","_dimensions":[1,1],"_elements":[{"f":{"_array_type":"Cell","_dimensions":[1e400,0],"_elements":[]}}],"_fields":["f"]}',
    refused: ['not-a-count', 'ownField.f is a cell declaring dimensions [Infinity,0]' + NOT_A_COUNT],
  },
  {
    name: 'ownParam',
    text: '{"_array_class":"Simulink.Parameter","_dimensions":[1,1e400],"_elements":[{"_properties":{"Value":1}}]}',
    refused: ['not-a-count', 'ownParam is a Simulink.Parameter declaring dimensions [1,Infinity]' + NOT_A_COUNT],
  },
  {
    name: 'ownComplex',
    text: '{"_type":"cdata","_value":"","_dimensions":[0,2147483648]}',
    refused: ['past-int32', 'ownComplex is a 0x2147483648 double, an extent past 2147483647, the most a MAT stream\'s dimensions can say, and it has no other spelling here. Nothing was written.'],
  },
];

/** sparse_text.sldd with the OWN entries added, as text, and each one's element as that text holds it. */
function textDictionary(): { file: string; elementOf: (name: string) => string } {
  const json = JSON.parse(strFromU8(new Uint8Array(sparseFixture(TEXT))));
  const entries = entriesOf(json);
  const metadata = entries.find((e: any) => e.name === 'dRow').metadata;
  const element = new Map<string, string>();
  OWN.forEach(({ name, text }, i) => {
    const entry = { name, metadata: { ...metadata, uuid: `00000000-0000-4000-f122-${String(i + 1).padStart(12, '0')}` }, value: `@@${name}@@` };
    entries.push(entry);
    element.set(name, JSON.stringify(entry, null, '\t').replace(`"@@${name}@@"`, text));
  });
  const file = OWN.reduce((t, { name, text }) => t.replace(`"@@${name}@@"`, text), JSON.stringify(json, null, '\t'));
  return { file, elementOf: (name) => element.get(name)! };
}

function open(file: string | ArrayBuffer, filename: string) {
  const session = createSession();
  const root: any = ingest(session, typeof file === 'string' ? buffer(strToU8(file)) : file, { filename });
  return { session, root, design: root.getSection('design') };
}

/** `record` re-read into `design` in the place of the entry of its name, as a host's replace does it. */
function replaced(root: any, design: any, record: Record<string, unknown>, options?: { asRead?: boolean }): any {
  const live = design.children.find((e: any) => e.name === record.name);
  const index = design.children.indexOf(live);
  const fresh = design.parseEntry(record, root.systemComposer ?? null, options);
  design.removeChild(fresh);
  design.removeChild(live);
  design.addChild(fresh, index);
  return fresh;
}

const copyOf = (entry: any) => {
  const [thrown] = thrownBy(() => entry.serialize());
  return thrown ? [thrown.name, (thrown as any).reason, thrown.message] : entry.serialize().value;
};
const savedOwn = (session: any, root: any) => {
  const [thrown] = thrownBy(() => session.serializeSource(root.name));
  if (thrown) return [thrown.name, thrown.message];
  return entriesOf(JSON.parse(session.serializeSource(root.name)!.text!))
    .filter((e: any) => /^own/.test(e.name))
    .map((e: any) => [e.name, e.value]);
};

describe('a text dictionary\'s own entry re-read from its text, as a host showing that text re-reads it', () => {
  it('with { asRead: true }: its copy and the save are what they are when it is read from the file, as read and renamed', () => {
    const { file, elementOf } = textDictionary();
    const read = open(file, TEXT);
    const asOpened = OWN.map(({ name }) => copyOf(read.design.children.find((e: any) => e.name === name)));
    // The file read accepts every one of them, which is what the re-read is held to: written
    // back as read, the infinity as null (what JSON.stringify makes of it).
    expect(asOpened.map((v) => (Array.isArray(v) && v[0] === 'MatBudgetError' ? v : null))).toEqual(OWN.map(() => null));
    const savedAsOpened = savedOwn(read.session, read.root);

    const reread = open(file, TEXT);
    const fresh = OWN.map(({ name }) => replaced(reread.root, reread.design, JSON.parse(elementOf(name)), { asRead: true }));
    expect(fresh.map(copyOf)).toEqual(asOpened);
    expect(savedOwn(reread.session, reread.root)).toEqual(savedAsOpened);

    // Renamed afterwards, as a table edit of it renames it: still the file's own.
    fresh.forEach((entry) => expect(entry.setProperty('Name', entry.name + 'R')).toBe(true));
    expect(fresh.map(copyOf)).toEqual(asOpened);
    expect(savedOwn(reread.session, reread.root)).toEqual((savedAsOpened as [string, unknown][]).map(([name, value]) => [name + 'R', value]));
  });

  it('without it, as a paste, a drop or an undo record is re-read, it is refused as before; so with { asRead: false }', () => {
    const { file, elementOf } = textDictionary();
    const refused = OWN.map(({ refused: [reason, said], name }) => ['MatBudgetError', reason, `Cannot write "${name}": ${said}`]);
    for (const options of [undefined, {}, { asRead: false }]) {
      const pasted = open(file, TEXT);
      const fresh = OWN.map(({ name }) => replaced(pasted.root, pasted.design, JSON.parse(elementOf(name)), options));
      expect(fresh.map(copyOf), JSON.stringify(options)).toEqual(refused);
      expect(savedOwn(pasted.session, pasted.root)[0], JSON.stringify(options)).toBe('MatBudgetError');
    }
  });

  it('in a binary dictionary it records nothing: the save is refused as a paste\'s is, and the same record re-read into a text dictionary is not its own', () => {
    const { elementOf } = textDictionary();
    const records = OWN.map(({ name }) => JSON.parse(elementOf(name)));
    const binary = open(sparseFixture(BINARY), BINARY);
    records.forEach((record) => binary.design.parseEntry(record, binary.root.systemComposer ?? null, { asRead: true }));
    const [thrown] = thrownBy(() => binary.session.serializeSource(binary.root.name));
    expect([thrown?.name, (thrown as any)?.reason, thrown?.message]).toEqual(['MatBudgetError', OWN[0].refused[0], `Cannot write "ownCell": ${OWN[0].refused[1]}`]);
    // The record is by object, so a binary venue that recorded it would pass the same objects,
    // handed on uncloned to a text dictionary's paste, for that dictionary's own.
    const text = open(textDictionary().file, TEXT);
    const pasted = records.map((record) => replaced(text.root, text.design, record));
    expect(pasted.map(copyOf)).toEqual(OWN.map(({ refused: [reason, said], name }) => ['MatBudgetError', reason, `Cannot write "${name}": ${said}`]));
  });
});
