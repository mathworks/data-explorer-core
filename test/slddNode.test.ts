// Copyright 2026 The MathWorks, Inc.
//
// THE DICTIONARY ROOT: WHAT IT SAYS ABOUT THE FILE, AND WHAT IT DOES WITH A PART THAT
// ARRIVED SHORT.
//
// `SlddNode` is the root row of an open `.sldd` and the whole reader for the textual
// flavour of one, so it answers two quite different kinds of question and both are
// user-visible.
//
// The first is what the root row and the property inspector say about the file itself:
// its name (with the asterisk that is the only sign an edit has not been saved), its
// icon, and the FileFormat row that tells a user which of the two `.sldd` flavours they
// have open — because that decides what a save will write. All three read off the same
// recorded fact, `sourceFormat`, which is set from the presence of a `__rawXml` part
// rather than guessed from the filename, since both flavours use the same extension.
//
// The second is what happens when a piece of the file is missing. A dictionary is a bag
// of parts, and MATLAB — or a partial write, or a host that rebuilt one — can hand over
// a content part with no entry list, an entry with no metadata, or a System Composer
// catalog whose records are half there. Every one of those has a defined answer that is
// NOT "throw": the parse walks the entry list with a plain `forEach`, so anything that
// throws inside it costs the whole dictionary rather than the one piece that was short.
// What each of those answers is, is the second half of this file.
//
// The catalog case is the one with teeth. The catalog is what tells a StructType from a
// DataInterface — both are a `Simulink.Bus` on disk — so a record that is present but
// unusable does not produce a visible error, it produces a WRONG Kind that looks exactly
// like a right one. That degradation is pinned here deliberately, so that a change to
// how partial records are handled shows up as a failing test naming the entry it
// mislabels rather than as a quietly reclassified dictionary.
//
// Related: parseWarnings.test.ts owns the diagnostics a short dictionary raises
// (`source-empty`, `part-unreadable`); scCatalog.test.ts owns the equality of the two
// formats' catalogs; slddContent.test.ts owns the content unwrap. This file is about the
// answers the root itself gives.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import SlddNode from '../src/datamodel/node/container/SlddNode.js';
import type SectionNode from '../src/datamodel/node/container/SectionNode.js';
import { parseBinarySldd } from '../src/datamodel/parser/BinarySlddParser.js';
import { serializeBinarySldd } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { DATA_PART_KEY, TEXT_CONTENT, TEXT_PARTS } from '../src/datamodel/parser/SlddParts.js';
import { SC_PART } from '../src/datamodel/parser/ScCatalog.js';
import type { ParseWarning } from '../src/datamodel/parser/ParseWarning.js';
// Registers the node classes the entry parser resolves values with; without it every
// entry would fall through to the generic object node and no Kind would be right.
import '../src/datamodel/node/NodeClassMap.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const jsonFixture = (name: string) => JSON.parse(readFileSync(fixture(name), 'utf8')) as Record<string, unknown>;

function binaryFixtureJson(name: string): Record<string, unknown> {
  const u8 = new Uint8Array(readFileSync(fixture(name)));
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
  return parseBinarySldd(buf) as unknown as Record<string, unknown>;
}

// A dictionary bag holding exactly the content part, so the reader has something to read
// and nothing else to lean on.
function dictionaryWith(content: Record<string, unknown>): Record<string, unknown> {
  return { [TEXT_PARTS]: { [DATA_PART_KEY]: { [TEXT_CONTENT]: content } } };
}

const doubleEntry = (name: string, metadata?: Record<string, unknown>) => ({
  name,
  value: { _type: 'double', _value: '1' },
  ...(metadata ? { metadata } : {}),
});

const entryNames = (node: SlddNode) =>
  node.children.flatMap((s) => s.children.map((e) => e.name)).sort();

function kindsOf(node: SlddNode): Record<string, string> {
  const out: Record<string, string> = {};
  node.children.forEach((section) => {
    section.children.forEach((entry) => {
      out[entry.name] = (entry as unknown as { kind: string }).kind;
    });
  });
  return out;
}

describe('what the dictionary root says about the file it came from', () => {
  it('marks its name with an asterisk as soon as an entry has been edited', () => {
    // The asterisk is the only thing in the tree that says an edit is unsaved, and it is
    // put there by the mutation walking up to the source root — not by the host, which
    // would have to remember to. An edit deep in an entry has to reach it.
    const node = SlddNode.parse(jsonFixture('arch.sldd'), 'arch.sldd');
    expect(node.displayName).toBe('arch.sldd');

    const entry = (node.getSection('arch') as SectionNode).children.find((c) => c.name === 'NumericType')!;
    expect((entry as unknown as { setProperty(k: string, v: string): boolean })
      .setProperty('Description', 'edited')).toBe(true);
    expect(node.displayName).toBe('arch.sldd *');
  });

  it('shows a compressed-binary dictionary as a package and a textual one as text', () => {
    // Both flavours are `.sldd`, so this cannot come from the name. It decides the icon a
    // user picks the file out by and the FileFormat row they read to know what a save
    // will write — a textual dictionary reported as compressed-binary is a promise to
    // write a zip over a JSON file.
    const binary = SlddNode.parse(binaryFixtureJson('arch_binary.sldd'), 'arch_binary.sldd');
    expect([binary.sourceFormat, binary.icon, binary.FileFormat])
      .toEqual(['xml', 'simulink_server', 'compressed-binary']);

    const text = SlddNode.parse(jsonFixture('arch.sldd'), 'arch.sldd');
    expect([text.sourceFormat, text.icon, text.FileFormat])
      .toEqual(['json', 'simulink_database', 'uncompressed-text']);
  });

  it('still reads as a package when only the chunk XML came with it, and still saves one', () => {
    // The zip members this reader does not understand are carried through untouched so a
    // save does not drop them, and the DataSource attributes are copied so the written
    // package claims the release the original did. A dictionary that arrived with the
    // chunk and nothing else has neither — it must still be a compressed-binary
    // dictionary, and saving it must still produce a package that opens, on the
    // serializer's stated defaults rather than on `undefined` leaking into the XML.
    const node = SlddNode.parse(
      { ...dictionaryWith({ entries: [doubleEntry('Kp')] }), __rawXml: '<DataSource/>' },
      'thin.sldd',
    );
    expect([node.sourceFormat, node.icon, node.FileFormat])
      .toEqual(['xml', 'simulink_server', 'compressed-binary']);
    // Recorded as "nothing carried" rather than left undefined, which is what the
    // serializer's fallbacks are written against.
    expect(node._zipMetadata).toBeNull();
    expect(node._dataSourceAttrs).toBeNull();

    const reopened = SlddNode.parse(
      parseBinarySldd(serializeBinarySldd(node)) as unknown as Record<string, unknown>,
      'thin.sldd',
    );
    expect(entryNames(reopened)).toEqual(['Kp']);
    expect(reopened.FileFormat).toBe('compressed-binary');
  });
});

describe('a content part that arrived without the pieces around its entries', () => {
  it('opens a dictionary whose content part lists no entries as an empty one, and says nothing', () => {
    // MATLAB writes a content part with an empty entry list for a dictionary a user has
    // created and not filled in; a partial write can leave the key off altogether. Both
    // are complete-enough files read correctly, so they open as the four empty sections
    // and raise nothing — `source-empty` is for a dictionary with no content part at all,
    // and spending it here would put a warning banner in front of every new dictionary.
    for (const content of [{}, { entries: [] }]) {
      const warnings: ParseWarning[] = [];
      const node = SlddNode.parse(dictionaryWith(content), 'fresh.sldd', warnings);
      expect(node.NumberOfEntries).toBe(0);
      expect(node.children.map((c) => c.name)).toEqual(['design', 'arch', 'config', 'other']);
      expect(warnings).toEqual([]);
    }
  });

  it('reads a content part with no reference list as a dictionary that references nothing', () => {
    // `dictionaryReferences` is written straight back out on save, so an absent list has
    // to become an empty one here: `undefined` would be written into the file's
    // "Dictionary References" and a dictionary that referenced nothing would come back
    // claiming it could not be read.
    const node = SlddNode.parse(dictionaryWith({ entries: [doubleEntry('Kp')] }), 'plain.sldd');
    expect(node.dictionaryReferences).toEqual([]);
    expect(node.allowAccessBWS).toBe(false);

    const saved = node.serializeJson();
    const content = (saved[TEXT_PARTS] as Record<string, Record<string, Record<string, unknown>>>)
      [DATA_PART_KEY][TEXT_CONTENT];
    expect(content['Dictionary References']).toEqual([]);
    expect(content.AllowAccessBWS).toBe(false);
  });

  it('files an entry that carries no metadata under Design Data', () => {
    // The section an entry belongs in is read out of its metadata, and an entry with none
    // still has to land somewhere a user can see it. Design Data is the answer because it
    // is where an ordinary workspace variable lives — dropping the entry, or putting it in
    // Other Data, would hide or misfile a definition the file does hold.
    const node = SlddNode.parse(
      dictionaryWith({ entries: [doubleEntry('Kp'), doubleEntry('Ki', { namespace: '', isderived: '0' })] }),
      'plain.sldd',
    );
    expect((node.getSection('design') as SectionNode).children.map((c) => c.name)).toEqual(['Kp', 'Ki']);
    expect(node.NumberOfEntries).toBe(2);
  });
});

describe('a System Composer catalog whose records arrived incomplete', () => {
  // The catalog part of the real architectural fixture, with broken records spliced in
  // beside the good ones. Each break is a shape MF0 JSON can legitimately produce — a
  // null reference where a record was expected, a record with no name, a record with no
  // type — and each is a separate chance for the walk to throw and take the dictionary
  // with it.
  type Rec = Record<string, unknown>;
  const catalogPartOf = (json: Record<string, unknown>) =>
    ((json[TEXT_PARTS] as Record<string, Rec>)[`__MW_TEXT_PART__/${SC_PART}`])[TEXT_CONTENT] as Rec;

  function archWithCatalog(edit: (records: Rec[]) => void): { node: SlddNode; warnings: ParseWarning[] } {
    const json = jsonFixture('arch.sldd');
    const records = catalogPartOf(json).entries as Rec[];
    edit(records);
    const warnings: ParseWarning[] = [];
    return { node: SlddNode.parse(json, 'arch.sldd', warnings), warnings };
  }

  const interfacesOf = (records: Rec[]) =>
    ((records.find((r) => (r.content as Rec)?.p_PortInterfaceCatalog)!.content as Rec)
      .p_PortInterfaceCatalog as Rec).content as Rec;
  const modeledOf = (records: Rec[]) =>
    (records.find((r) => (r.content as Rec)?.p_ModeledDataTypes)!.content as Rec);

  const PRISTINE_KINDS = kindsOf(SlddNode.parse(jsonFixture('arch.sldd'), 'arch.sldd'));

  it('classifies every well-formed record even with broken ones sitting beside them', () => {
    // The consequence that matters: one unusable record must cost that record, not the
    // dictionary. Every Kind in the file is compared against the same file read clean.
    const { node, warnings } = archWithCatalog((records) => {
      // A record whose content is a null reference rather than an object — the shape MF0
      // JSON writes for an empty one, and the fixture is full of them one level down.
      records.push({ type: 'systemcomposer.property.TypeCatalog', content: null });
      // An interface and a modeled type whose own records are null.
      (interfacesOf(records).p_Interfaces as Rec[]).push({ content: null, type: 'x' });
      (modeledOf(records).p_ModeledDataTypes as Rec[]).push({ content: null, type: 'y' });
    });

    expect(kindsOf(node)).toEqual(PRISTINE_KINDS);
    // The part was present and readable, so nothing is reported about it.
    expect(warnings).toEqual([]);
  });

  it('skips a definition whose record does not name it, rather than cataloguing an empty name', () => {
    // The catalog is keyed by NAME — it is the only link between the part and an entry —
    // so a record with no name classifies nothing. Storing it under '' would be worse
    // than skipping it: the next nameless record would overwrite the first, and an entry
    // whose own name somehow read as empty would pick up the type of whichever record
    // happened to land there.
    const { node } = archWithCatalog((records) => {
      (interfacesOf(records).p_Interfaces as Rec[]).push({
        content: { p_Name: '' },
        type: 'systemcomposer.architecture.model.interface.CompositeDataInterface',
      });
      (modeledOf(records).p_ModeledDataTypes as Rec[]).push({
        content: {},
        type: 'systemcomposer.property.StructDataType',
      });
    });

    expect(Object.keys(node.systemComposer!.interfaces)).not.toContain('');
    expect(Object.keys(node.systemComposer!.modeledDataTypes)).not.toContain('');
    expect(kindsOf(node)).toEqual(PRISTINE_KINDS);
  });

  it("degrades a definition whose record lost its type to the entry's raw Simulink class", () => {
    // The nastiest partial in the reader, pinned rather than fixed. `StructType` is a
    // `Simulink.Bus` and reads as a struct type ONLY because the catalog says
    // StructDataType; with the type gone it reads as a Data Interface — the same thing
    // the Bus beside it reads, which is a wrong answer that looks exactly like a right
    // one. It is recorded as the empty string, not dropped, so the catalog still shows
    // the file listed the definition.
    const { node, warnings } = archWithCatalog((records) => {
      const modeled = modeledOf(records).p_ModeledDataTypes as Rec[];
      delete modeled.find((d) => (d.content as Rec)?.p_Name === 'StructType')!.type;
      const ifaces = interfacesOf(records).p_Interfaces as Rec[];
      delete ifaces.find((d) => (d.content as Rec)?.p_Name === 'DataInterface')!.type;
    });

    expect(node.systemComposer!.modeledDataTypes.StructType).toBe('');
    expect(node.systemComposer!.interfaces.DataInterface).toBe('');
    expect(kindsOf(node)).toMatchObject({
      StructType: 'Data Interface',
      DataInterface: 'Data Interface',
      // Everything the catalog still classifies is unaffected.
      ValueType: 'Value Type',
      EnumType: 'Enumerated Type',
      AliasType: 'Alias Type',
    });
    expect(warnings).toEqual([]);
  });
});
