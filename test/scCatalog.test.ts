// Copyright 2026 The MathWorks, Inc.
//
// THE SYSTEM COMPOSER CATALOG IS ONE RULE OVER TWO FILE FORMATS.
//
// An Architectural Data entry is an ordinary Simulink object on disk — a
// `Simulink.Bus` is a Bus whether System Composer models it as a data interface or
// as a struct type. What tells the two apart is a SEPARATE part of the dictionary,
// the System Composer interface dictionary, which lists each definition with its
// System Composer type. That part is stored two ways:
//
//   uncompressed-text `.sldd`  → a JSON object under
//                                `__MW_TEXT_PARTS__/…/interfaceDictionary`
//   compressed-binary `.sldd`  → an MF0 XML member at
//                                `simulink/systemcomposer/interfaceDictionary.xml`
//
// The catalog those two produce must be the SAME catalog: the same dictionary
// saved in either format is the same dictionary, so an entry's Kind cannot depend
// on which format it was read from. These tests pin that equality on a pair of
// fixtures that hold the same catalog in the two forms, and they pin the traps a
// name-keyed catalog invites — a bus element that happens to share a value type's
// name, and the built-in types the catalog also lists.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
// Through the barrel: it is what registers the node classes the entry parser
// resolves values with.
import {
  SlddNode,
  parseBinarySldd,
  parseBinarySlddParts,
  applyScEdits,
  catalogFromDefinitions,
  scRenameEdits,
  scanScJsonText,
  scanScXml,
  SC_PART_XML,
} from '../src/index.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const textAt = (name: string) => readFileSync(fixture(name), 'utf8');

function loadJsonSldd(name: string): SlddNode {
  const json = JSON.parse(readFileSync(fixture(name), 'utf8')) as Record<string, unknown>;
  return SlddNode.parse(json, name);
}

function loadBinarySldd(name: string): SlddNode {
  const u8 = new Uint8Array(readFileSync(fixture(name)));
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
  return SlddNode.parse(parseBinarySldd(buf), name);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const entryNamed = (sldd: SlddNode, name: string): any =>
  (sldd.children as any[]).flatMap((s) => s.children as any[]).find((e) => e.name === name);

function kindsOf(sldd: SlddNode): Record<string, string> {
  const out: Record<string, string> = {};
  sldd.children.forEach((section) => {
    section.children.forEach((entry) => {
      out[entry.name] = (entry as unknown as { kind: string }).kind;
    });
  });
  return out;
}

describe('System Composer catalog, read from either format', () => {
  it('classifies a compressed-binary dictionary from its zipped XML catalog', () => {
    const sldd = loadBinarySldd('arch_binary.sldd');

    // Without the catalog every one of these is its raw Simulink class: two Buses
    // that both read 'Data Interface', and a NumericType that reads 'Numeric Type'
    // by luck rather than by the catalog saying so.
    expect(kindsOf(sldd)).toMatchObject({
      StructType: 'Struct Type',
      DataInterface: 'Data Interface',
      ValueType: 'Value Type',
      NumericType: 'Numeric Type',
    });
  });

  it('reads the same catalog out of the JSON and the binary form of one dictionary', () => {
    const json = loadJsonSldd('arch_binary_as_text.sldd');
    const binary = loadBinarySldd('arch_binary.sldd');

    expect(binary.systemComposer).toEqual(json.systemComposer);
    expect(kindsOf(binary)).toEqual(kindsOf(json));
  });

  it('reads the same catalog out of the JSON TEXT as out of the parsed JSON', () => {
    // Two readers over one syntax, because the host holds the dictionary as TEXT (it
    // edits a document, not a file) and core holds it as a parsed object. They must
    // not disagree about what the catalog says.
    const text = textAt('arch.sldd');
    const fromText = catalogFromDefinitions(scanScJsonText(text));

    expect(fromText).toEqual(loadJsonSldd('arch.sldd').systemComposer);
    // All eight classifications, so the type map is exercised rather than sampled.
    expect(Object.keys(fromText.interfaces).sort())
      .toEqual(['DataInterface', 'PhysicalInterface', 'ServiceInterface', 'ValueType', 'ValueType1']);
    expect(Object.keys(fromText.modeledDataTypes).sort())
      .toEqual(['AliasType', 'EnumType', 'NumericType', 'StructType']);
  });

  it('reads the catalog out of the JSON text however the writer laid it out', () => {
    // MATLAB writes a `.sldd` tab-indented; a host that has re-saved one may not. The
    // catalog is in the text, not in its whitespace.
    const parsed = JSON.parse(textAt('arch.sldd')) as unknown;
    const expected = catalogFromDefinitions(scanScJsonText(textAt('arch.sldd')));

    expect(catalogFromDefinitions(scanScJsonText(JSON.stringify(parsed)))).toEqual(expected);
    expect(catalogFromDefinitions(scanScJsonText(JSON.stringify(parsed, null, '\t')))).toEqual(expected);
    expect(catalogFromDefinitions(scanScJsonText(JSON.stringify(parsed, null, 4)))).toEqual(expected);
  });

  it('finds no definitions in a dictionary that has no interface dictionary', () => {
    // Which is nearly every `.sldd`: the part is absent, and that is the limit of the
    // file rather than a failure to read it.
    expect(scanScJsonText(textAt('numeric_json.sldd'))).toEqual([]);
  });

  it('does not take a bus element or a built-in type for a catalog definition', () => {
    const sldd = loadBinarySldd('arch_binary.sldd');
    const catalog = sldd.systemComposer!;

    // `DataInterface` holds one element NAMED after the value type it uses, which is
    // how System Composer writes a bus of value types — and it is not a definition
    // of anything. Only the two definitions carry the name.
    expect(Object.keys(catalog.interfaces).sort()).toEqual(['DataInterface', 'ValueType']);
    // The catalog also lists MATLAB's built-in types (double, int16, …). They are
    // not dictionary entries, so they are not classifications of anything.
    expect(Object.keys(catalog.modeledDataTypes).sort()).toEqual(['NumericType', 'StructType']);
  });
});

// Renaming a catalogued entry without carrying the rename into the catalog breaks the
// file in both directions at once: the entry is now unclassified (a `Simulink.Bus`
// struct type re-reads as a plain data interface, and a value type as a plain
// `Simulink.ValueType`), and the catalog is left defining an interface no entry backs.
// Both are file-level damage, and neither is visible until the file is read again.
describe('carrying a rename into the catalog', () => {
  // The entry's own name in a compressed-binary chunk, anchored on the UUID that
  // follows it so the identically-spelled bus element inside another entry is left
  // alone. The real thing is the host's entry splice; this is the same rename.
  const renameChunkEntry = (chunkXml: string, oldName: string, newName: string): string =>
    chunkXml.replace(
      new RegExp(`(<P Name="Name" Class="char">)${oldName}(</P>\\s*<P Name="UUID")`),
      `$1${newName}$2`,
    );

  function binaryParts(name: string): { chunkXml: string; zipMeta: Record<string, Uint8Array> } {
    const u8 = new Uint8Array(readFileSync(fixture(name)));
    const files = unzipSync(u8);
    const zipMeta: Record<string, Uint8Array> = {};
    Object.entries(files).forEach(([member, data]) => {
      if (member !== 'data/chunk0.xml') {
        zipMeta[member] = data;
      }
    });
    return { chunkXml: new TextDecoder().decode(files['data/chunk0.xml']), zipMeta };
  }

  it('moves both copies of a value type name in the XML form, and nothing else', () => {
    const { zipMeta } = binaryParts('arch_binary.sldd');
    const xml = new TextDecoder().decode(zipMeta[SC_PART_XML]);

    const edits = scRenameEdits(scanScXml(xml), 'ValueType', 'Speed');
    const patched = applyScEdits(xml, edits);

    // Two sites: the definition, and the value-type descriptor nested in it that
    // MATLAB keeps equal to it.
    expect(edits).toHaveLength(2);
    expect(patched.match(/<p_Name>Speed<\/p_Name>/g)).toHaveLength(2);
    // The third occurrence is a bus element in ANOTHER interface, named after the type
    // it references. An element's name in someone else's interface is not this
    // definition's name, and a global replace would have taken it too.
    expect(patched.match(/<p_Name>ValueType<\/p_Name>/g)).toHaveLength(1);
  });

  it('keeps a renamed entry classified, in a compressed-binary dictionary', () => {
    const { chunkXml, zipMeta } = binaryParts('arch_binary.sldd');
    const xml = new TextDecoder().decode(zipMeta[SC_PART_XML]);

    zipMeta[SC_PART_XML] = new TextEncoder().encode(
      applyScEdits(xml, scRenameEdits(scanScXml(xml), 'ValueType', 'Speed')),
    );
    const sldd = SlddNode.parse(
      parseBinarySlddParts(renameChunkEntry(chunkXml, 'ValueType', 'Speed'), zipMeta),
      'arch_binary.sldd',
    );

    expect(kindsOf(sldd)).toEqual({
      StructType: 'Struct Type',
      DataInterface: 'Data Interface',
      Speed: 'Value Type',
      NumericType: 'Numeric Type',
    });
  });

  it('keeps a renamed entry classified, in an uncompressed-text dictionary', () => {
    const text = textAt('arch_binary_as_text.sldd');

    const edits = scRenameEdits(scanScJsonText(text), 'ValueType', 'Speed');
    const patched = applyScEdits(text, edits).replace('"name": "ValueType"', '"name": "Speed"');
    const sldd = SlddNode.parse(JSON.parse(patched) as Record<string, unknown>, 'arch.sldd');

    expect(edits).toHaveLength(2);
    expect(kindsOf(sldd)).toEqual({
      StructType: 'Struct Type',
      DataInterface: 'Data Interface',
      Speed: 'Value Type',
      NumericType: 'Numeric Type',
    });
  });

  it('renames a modeled data type the same way it renames an interface', () => {
    // A struct type is the case this bug was found on: a `Simulink.Bus` that the
    // catalog models as a struct type, which re-reads as a data interface — a
    // different thing entirely — the moment the catalog stops naming it.
    const text = textAt('arch_binary_as_text.sldd');
    const patched = applyScEdits(text, scRenameEdits(scanScJsonText(text), 'StructType', 'Wheel'))
      .replace('"name": "StructType"', '"name": "Wheel"');

    const sldd = SlddNode.parse(JSON.parse(patched) as Record<string, unknown>, 'arch.sldd');
    expect(kindsOf(sldd).Wheel).toBe('Struct Type');
  });

  it('leaves a name no definition carries alone', () => {
    // The overwhelming majority of renames: an ordinary Design Data entry, or an
    // element inside an entry. Nothing to carry, so no edits — and in particular not
    // an edit to the bus element that happens to share a value type's name.
    const text = textAt('arch_binary_as_text.sldd');
    const xml = new TextDecoder().decode(binaryParts('arch_binary.sldd').zipMeta[SC_PART_XML]);

    expect(scRenameEdits(scanScJsonText(text), 'Element', 'Elem')).toEqual([]);
    expect(scRenameEdits(scanScXml(xml), 'Element', 'Elem')).toEqual([]);
    expect(scRenameEdits(scanScXml(xml), 'double', 'float')).toEqual([]);
  });

  it('agrees between the two formats about what a rename changes', () => {
    // The invariant BETWEEN the paths, which is the one that keeps them honest: the
    // same dictionary, renamed the same way in either storage form, must come back
    // classifying its entries identically.
    const text = textAt('arch_binary_as_text.sldd');
    const { chunkXml, zipMeta } = binaryParts('arch_binary.sldd');
    const xml = new TextDecoder().decode(zipMeta[SC_PART_XML]);

    const jsonSldd = SlddNode.parse(
      JSON.parse(
        applyScEdits(text, scRenameEdits(scanScJsonText(text), 'DataInterface', 'Bus1'))
          .replace('"name": "DataInterface"', '"name": "Bus1"'),
      ) as Record<string, unknown>,
      'arch.sldd',
    );
    zipMeta[SC_PART_XML] = new TextEncoder().encode(
      applyScEdits(xml, scRenameEdits(scanScXml(xml), 'DataInterface', 'Bus1')),
    );
    const binarySldd = SlddNode.parse(
      parseBinarySlddParts(renameChunkEntry(chunkXml, 'DataInterface', 'Bus1'), zipMeta),
      'arch_binary.sldd',
    );

    expect(binarySldd.systemComposer).toEqual(jsonSldd.systemComposer);
    expect(kindsOf(binarySldd)).toEqual(kindsOf(jsonSldd));
    expect(kindsOf(binarySldd).Bus1).toBe('Data Interface');
  });
});

// The catalog is a name-keyed structure elsewhere in the file, so renaming an entry in
// the MODEL leaves it behind exactly as renaming it in the FILE does. The two are
// separate obligations: the host carries the rename into the part's bytes (above), and
// the tree the host is holding has to follow too — every narrow repaint rebuilds an
// entry through `parseEntry(record, catalog)`, so a catalog still keyed by the old name
// re-derives a Kind the file no longer agrees with. This is the same rule
// `_renameField` already applies to a struct's field list, one level up.
describe('the in-memory catalog follows a rename', () => {
  const STRUCT_TYPE = 'systemcomposer.property.StructDataType';
  const NUMERIC_TYPE = 'systemcomposer.property.NumericType';
  const VALUE_TYPE_IFACE = 'systemcomposer.architecture.model.interface.ValueTypeInterface';
  const COMPOSITE_DATA = 'systemcomposer.architecture.model.interface.CompositeDataInterface';

  // What the host's narrow repaint does with the renamed entry: serialize it and build
  // it back through the catalog, which is where a stale key shows up as a wrong Kind.
  const kindAfterRebuild = (sldd: SlddNode, entry: any): string => {
    const rebuilt = entry.parent.parseEntry(entry.serialize(), sldd.systemComposer);
    entry.parent.removeChild(rebuilt);
    return rebuilt.kind;
  };

  it('re-keys a modeled data type, so the entry stays a struct type', () => {
    const sldd = loadBinarySldd('arch_binary.sldd');
    const entry = entryNamed(sldd, 'StructType');

    expect(entry.setProperty('Name', 'Wheel')).toBe(true);

    expect(sldd.systemComposer!.modeledDataTypes).toEqual({
      Wheel: STRUCT_TYPE,
      NumericType: NUMERIC_TYPE,
    });
    expect(kindAfterRebuild(sldd, entry)).toBe('Struct Type');
  });

  it('re-keys an interface, so the entry stays a value type', () => {
    const sldd = loadBinarySldd('arch_binary.sldd');
    const entry = entryNamed(sldd, 'ValueType');

    expect(entry.setProperty('Name', 'Speed')).toBe(true);

    expect(sldd.systemComposer!.interfaces).toEqual({
      Speed: VALUE_TYPE_IFACE,
      DataInterface: COMPOSITE_DATA,
    });
    expect(kindAfterRebuild(sldd, entry)).toBe('Value Type');
  });

  it('does not follow a rename of a nested element that shares a catalog name', () => {
    // `DataInterface` holds a bus element named after the value type it references. It
    // is not a definition, and the catalog must not move under it — the entry that
    // really is called `ValueType` would lose its classification.
    const sldd = loadBinarySldd('arch_binary.sldd');
    const element = entryNamed(sldd, 'DataInterface').children.find((c: any) => c.name === 'ValueType');

    expect(element.setProperty('Name', 'Speed')).toBe(true);

    expect(sldd.systemComposer!.interfaces).toEqual({
      ValueType: VALUE_TYPE_IFACE,
      DataInterface: COMPOSITE_DATA,
    });
    expect(kindsOf(sldd).ValueType).toBe('Value Type');
  });

  it('renames an entry in a dictionary that has no catalog at all', () => {
    // Nearly every `.sldd`. There is nothing to follow, and nothing to invent either.
    const sldd = loadBinarySldd('compressed.sldd');
    const entry = entryNamed(sldd, 'Kp');

    expect(entry.setProperty('Name', 'Ki')).toBe(true);
    expect(sldd.systemComposer).toBeNull();
  });
});
