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
import { unzipSync, zipSync } from 'fflate';
import type { ParseWarning } from '../src/datamodel/parser/ParseWarning.js';
import { XmlTagScanner } from '../src/datamodel/parser/ScCatalog.js';
// Through the barrel: it is what registers the node classes the entry parser
// resolves values with.
import {
  SlddNode,
  parseBinarySldd,
  parseBinarySlddParts,
  applyScEdits,
  catalogFromDefinitions,
  classificationOf,
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

  it('says nothing when the binary catalog member holds no definitions, and agrees with the text form', () => {
    // The member MATLAB writes into a dictionary System Composer has merely TOUCHED: a
    // model, a type catalog of nothing but built-in value types, and an interface catalog
    // holding only its storage context. Measured on a real customer `.sldd` — and it used
    // to put a "could not be read" banner over a file with nothing wrong with it.
    //
    // The kinds below are the point. `Simulink.Bus` is the only class the catalog
    // disambiguates, and 'Data Interface' is what MATLAB R2027a itself answers for BOTH
    // buses once this part is gone, so the fallback is agreement rather than degradation.
    const emptyScXml = '<?xml version="1.0"?>\n'
      + '<MF0 packageUris="http://schema.mathworks.com/mf0/systemcomposer_property/2.13">\n'
      + '  <systemcomposer.property.TypeCatalog type="systemcomposer.property.TypeCatalog" uuid="u-tc">\n'
      + '    <p_BuiltInValueTypes type="systemcomposer.property.ValueTypeDescriptor" uuid="u-d">\n'
      + '      <p_Name>double</p_Name>\n'
      + '    </p_BuiltInValueTypes>\n'
      + '  </systemcomposer.property.TypeCatalog>\n'
      + '  <systemcomposer.architecture.model.SystemComposerModel type="systemcomposer.architecture.model.SystemComposerModel" uuid="u-m">\n'
      + '    <p_Name>arch</p_Name>\n'
      + '    <p_PortInterfaceCatalog type="systemcomposer.architecture.model.interface.InterfaceCatalog" uuid="u-ic">\n'
      + '      <p_StorageContext>DICTIONARY</p_StorageContext>\n'
      + '    </p_PortInterfaceCatalog>\n'
      + '  </systemcomposer.architecture.model.SystemComposerModel>\n'
      + '</MF0>\n';
    expect(scanScXml(emptyScXml)).toEqual([]);

    const original = new Uint8Array(readFileSync(fixture('arch_binary.sldd')));
    const members = unzipSync(original);
    members[SC_PART_XML] = new TextEncoder().encode(emptyScXml);
    const rebuilt = zipSync(members);
    const buf = rebuilt.buffer.slice(
      rebuilt.byteOffset,
      rebuilt.byteOffset + rebuilt.byteLength,
    ) as ArrayBuffer;

    const warnings: ParseWarning[] = [];
    const sldd = SlddNode.parse(parseBinarySldd(buf), 'arch_binary.sldd', warnings);
    expect(warnings).toEqual([]);
    expect(sldd.systemComposer).toBeNull();
    expect(kindsOf(sldd)).toMatchObject({
      StructType: 'Data Interface',
      DataInterface: 'Data Interface',
      ValueType: 'Value Type',
      NumericType: 'Numeric Type',
    });
  });

  it('is as silent about a missing catalog in one format as in the other', () => {
    // The one-rule-two-paths pin, and the reason this reader raises nothing at all now:
    // the text path used to stay quiet where the binary path warned, so the SAME
    // dictionary said two different things depending on how it had been saved.
    const textWarnings: ParseWarning[] = [];
    const json = JSON.parse(textAt('arch_binary_as_text.sldd')) as Record<string, unknown>;
    const parts = json.__MW_TEXT_PARTS__ as Record<string, unknown>;
    parts['__MW_TEXT_PART__/simulink/systemcomposer/interfaceDictionary'] = { nothing: 'readable' };
    const fromText = SlddNode.parse(json, 'arch_binary_as_text.sldd', textWarnings);

    const binWarnings: ParseWarning[] = [];
    const members = unzipSync(new Uint8Array(readFileSync(fixture('arch_binary.sldd'))));
    delete members[SC_PART_XML];
    const rebuilt = zipSync(members);
    const buf = rebuilt.buffer.slice(
      rebuilt.byteOffset,
      rebuilt.byteOffset + rebuilt.byteLength,
    ) as ArrayBuffer;
    const fromBinary = SlddNode.parse(parseBinarySldd(buf), 'arch_binary.sldd', binWarnings);

    expect(textWarnings).toEqual([]);
    expect(binWarnings).toEqual(textWarnings);
    expect(fromText.systemComposer).toBeNull();
    expect(fromBinary.systemComposer).toBeNull();
    expect(kindsOf(fromBinary)).toEqual(kindsOf(fromText));
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

// The catalog is keyed by a name the USER chose, and a plain `{}` answers a lookup of
// every name `Object.prototype` carries. `toString`, `constructor`, `valueOf`,
// `hasOwnProperty`… are all valid MATLAB identifiers, so a struct type can be called one
// — and `catalog.interfaces[name] || catalog.modeledDataTypes[name]` then read the
// inherited FUNCTION off the interface bag, never consulted the modeled one, and the
// struct type came back a plain Data Interface with a data-interface icon. An interface of
// the same name was unaffected (its own key shadows the inherited one), which is why it
// went unnoticed: only the SECOND bag is reached through a miss on the first.
describe('a definition named after an Object.prototype member', () => {
  const INHERITED = ['toString', 'constructor', 'valueOf', 'hasOwnProperty', 'isPrototypeOf'];
  const STRUCT = 'systemcomposer.property.StructDataType';
  const IFACE = 'systemcomposer.architecture.model.interface.CompositeDataInterface';

  // The definition `from` renamed in BOTH the entry and the catalog, so the file is one
  // MATLAB could have written: the rename the host carries, applied before the read.
  function binaryRenamed(from: string, name: string): SlddNode {
    const files = unzipSync(new Uint8Array(readFileSync(fixture('arch_binary.sldd'))));
    const zipMeta: Record<string, Uint8Array> = {};
    Object.entries(files).forEach(([member, data]) => {
      if (member !== 'data/chunk0.xml') {
        zipMeta[member] = data;
      }
    });
    const xml = new TextDecoder().decode(zipMeta[SC_PART_XML]);
    zipMeta[SC_PART_XML] = new TextEncoder().encode(
      applyScEdits(xml, scRenameEdits(scanScXml(xml), from, name)),
    );
    const chunk = new TextDecoder().decode(files['data/chunk0.xml']).replace(
      new RegExp(`(<P Name="Name" Class="char">)${from}(</P>\\s*<P Name="UUID")`),
      `$1${name}$2`,
    );
    return SlddNode.parse(parseBinarySlddParts(chunk, zipMeta), 'arch_binary.sldd');
  }

  function textRenamed(from: string, name: string): SlddNode {
    const text = textAt('arch_binary_as_text.sldd');
    const patched = applyScEdits(text, scRenameEdits(scanScJsonText(text), from, name))
      .replace(`"name": "${from}"`, `"name": "${name}"`);
    return SlddNode.parse(JSON.parse(patched) as Record<string, unknown>, 'arch.sldd');
  }

  it.each(INHERITED)('reads a struct type called %s as a struct type, in either format', (name) => {
    for (const sldd of [binaryRenamed('StructType', name), textRenamed('StructType', name)]) {
      const entry = entryNamed(sldd, name);
      expect(entry.kind).toBe('Struct Type');
      expect(entry.classification).toBe('StructType');
      expect(entry.isStructType).toBe(true);
    }
  });

  it('keeps a struct type a struct type when the user renames it to one', () => {
    // The UI path: `toString` passes `validateMatlabName`, the catalog re-keys, and the
    // narrow repaint rebuilds the entry through the catalog.
    const sldd = loadBinarySldd('arch_binary.sldd');
    const entry = entryNamed(sldd, 'StructType');
    expect(entry.setProperty('Name', 'toString')).toBe(true);

    const rebuilt = entry.parent.parseEntry(entry.serialize(), sldd.systemComposer);
    entry.parent.removeChild(rebuilt);
    expect(rebuilt.kind).toBe('Struct Type');
  });

  it('classifies by own keys alone, whoever built the catalog', () => {
    // A host may build the (public) catalog shape itself, or clone the one it holds —
    // either way it gets an object WITH a prototype back.
    const catalog = catalogFromDefinitions(
      INHERITED.map((name) => ({ name, type: STRUCT, container: 'modeledDataTypes' as const, nameSites: [] })),
    );
    for (const copy of [catalog, structuredClone(catalog), JSON.parse(JSON.stringify(catalog))]) {
      INHERITED.forEach((name) => expect(classificationOf(copy, name)).toBe('StructType'));
    }
    // Built by hand, out of plain object literals: no reader and no clone involved.
    expect(classificationOf({ interfaces: {}, modeledDataTypes: { toString: STRUCT } }, 'toString'))
      .toBe('StructType');
    const handBuilt = {
      interfaces: {} as Record<string, string>,
      modeledDataTypes: Object.fromEntries(INHERITED.map((name) => [name, STRUCT])),
    };
    INHERITED.forEach((name) => expect(classificationOf(handBuilt, name)).toBe('StructType'));
    // And a name the catalog does not list is unclassified, inherited or not.
    expect(classificationOf({ interfaces: {}, modeledDataTypes: {} }, 'toString')).toBeNull();
    // A type the vocabulary does not have is nothing, even one spelled like a member.
    expect(classificationOf(
      catalogFromDefinitions([{ name: 'X', type: 'constructor', container: 'interfaces', nameSites: [] }]),
      'X',
    )).toBeNull();
  });

  it('records a name the reader does not validate, rather than handing it to a setter', () => {
    // MATLAB cannot write `__proto__` (an identifier starts with a letter) but the
    // readers take names raw, and on a plain `{}` this assignment was silently dropped.
    const catalog = catalogFromDefinitions([
      { name: '__proto__', type: IFACE, container: 'interfaces', nameSites: [] },
    ]);
    expect(Object.keys(catalog.interfaces)).toEqual(['__proto__']);
    expect(classificationOf(catalog, '__proto__')).toBe('DataInterface');
  });

  // The text reader builds its two bags itself, in `SlddNode._parseSystemComposer`, not
  // through `catalogFromDefinitions`. Every other inherited name is an own key once it is
  // written, so the own-key lookup reads it right off a plain `{}` too, and the cases above
  // pass either way. `__proto__` is the one name a plain `{}` still loses, because writing
  // it calls the prototype setter, which drops a string. MATLAB cannot write that name (see
  // above), but the text reader takes names raw, as the binary one does.
  it.each([
    ['struct type', 'StructType', 'modeledDataTypes', 'StructType'],
    ['data interface', 'DataInterface', 'interfaces', 'DataInterface'],
  ] as const)('records a %s named __proto__ in a text dictionary as the binary reader does', (_, from, bag, cls) => {
    const text = textRenamed(from, '__proto__');
    expect(Object.keys(text.systemComposer![bag])).toContain('__proto__');
    expect(entryNamed(text, '__proto__').classification).toBe(cls);
    expect(text.systemComposer).toEqual(binaryRenamed(from, '__proto__').systemComposer);
  });

  it('cannot reach Object.prototype through a container outside the union', () => {
    // `catalogFromDefinitions` is public, and a JS caller is not held to the type.
    try {
      catalogFromDefinitions([
        { name: 'scCatalogPolluted', type: 'yes', container: '__proto__' as never, nameSites: [] },
      ]);
      expect(({} as Record<string, unknown>).scCatalogPolluted).toBeUndefined();
    } finally {
      delete (Object.prototype as Record<string, unknown>).scCatalogPolluted;
    }
  });
});

describe('the XML catalog scan, on bytes that are not a well-formed catalog', () => {
  // The regex `XmlTagScanner` replaced, kept here as the specification it is held to.
  // It is quadratic on a backtracking engine (CodeQL js/polynomial-redos), which is why
  // it is not the implementation; every input below is small enough for it to finish.
  const TAG_RE = /<(\/?)([A-Za-z_][\w.-]*)((?:[^>"]|"[^"]*")*?)(\/?)>/g;
  type Row = [number, number, boolean, string, string, boolean];
  const viaRegex = (s: string): Row[] => {
    const out: Row[] = [];
    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(s))) {
      out.push([m.index, m.index + m[0].length, !!m[1], m[2], m[3], !!m[4]]);
    }
    return out;
  };
  const viaScanner = (s: string): Row[] => {
    const out: Row[] = [];
    const tags = new XmlTagScanner(s);
    let t: ReturnType<XmlTagScanner['next']>;
    while ((t = tags.next())) {
      out.push([t.index, t.end, t.closing, t.name, t.attrs, t.selfClosing]);
    }
    return out;
  };

  it('returns the tags the regex returned, on the real catalog', () => {
    const xml = new TextDecoder().decode(
      unzipSync(new Uint8Array(readFileSync(fixture('arch_binary.sldd'))))[SC_PART_XML],
    );
    expect(viaScanner(xml)).toEqual(viaRegex(xml));
  });

  // Random strings over the characters the regex gives meaning to, seeded so a failure
  // reproduces. 18,848 of the 20,000 are distinct, 9,573 distinct ones hold an attribute
  // walk that fails, and 3,657 a tag after one: the path the scanner answers from memory
  // rather than by walking. The seed steps by xorshift32, as xmlEntrySplice.test.ts's does,
  // because a draw is `% n` and reads the low bits. The LCG this had,
  // `(seed * 1103515245 + 12345) & 0x7fffffff`, multiplied in doubles, whose 53 bits drop
  // the low ones of a product of up to 62: it made 1,039 distinct strings of the 20,000.
  it('returns the tags the regex returned, on random input', () => {
    let seed = 1;
    const rand = (n: number): number => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) % n;
    };
    const pieces = ['<A', '>', '"', '/', ' ', '-', '.', '<A b="', '">', '</A>', '<B/>', 'x', '<', ':', '!'];
    for (let k = 0; k < 20000; k++) {
      let s = '';
      for (let i = 1 + rand(30); i > 0; i--) {
        s += pieces[rand(pieces.length)];
      }
      expect(viaScanner(s), JSON.stringify(s)).toEqual(viaRegex(s));
    }
  });

  // The two shapes CodeQL reports, then two retry-at-every-`<` shapes: with no `>` at all,
  // and with every `>` behind an odd number of quotes. On the regex the first four took
  // 11.4 s, 48.3 s, 22.9 s and 6.8 s at 100,000, 100,000, 100,000 and 30,000 repetitions,
  // growing as the square; they deflate about 1000:1, so a dictionary of a few KB carried
  // them. The last is linear on the regex and is here for the scanner: a quote search that
  // is not remembered between tags runs to the one quote at the end from every tag.
  //
  // The scanner's slowest of the five is the last, 83 ms here over two full runs, so the
  // bound is 2 s: five times CI's time, at 3.3 times this machine's (fe238c7).
  it('stays linear on the inputs that made the regex quadratic', () => {
    for (const s of [
      '<A' + '-'.repeat(1_000_000),
      '<A"' + '"<A"'.repeat(250_000),
      '<A'.repeat(500_000),
      '<A">"'.repeat(200_000),
      '<a></a>'.repeat(200_000) + '"',
    ]) {
      const t0 = performance.now();
      expect(scanScXml(s)).toEqual([]);
      expect(performance.now() - t0).toBeLessThan(2000);
    }
  });

  // One stray quote in a long part made the regex's attribute walk run to the end of the
  // input, and past ~8.39M steps V8 throws: the whole dictionary failed to open.
  it('reads past a stray quote ahead of a long attribute value instead of throwing', () => {
    const xml =
      '<p_Interfaces "><p_Name>x</p_Name></p_Interfaces>' +
      `<a b="${'x'.repeat(9_000_000)}"/>` +
      '<p_Interfaces type="T"><p_Name>Bus1</p_Name></p_Interfaces>';
    expect(scanScXml(xml).map((d) => [d.name, d.type])).toEqual([['Bus1', 'T']]);
  });
});
