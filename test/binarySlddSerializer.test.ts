// Copyright 2026 The MathWorks, Inc.
//
// Data-model serializer tests for the binary (zip) .sldd format. Loads a fixture
// through the data model directly (parse binary parts -> addDataSource) and
// asserts the serializer output, with no presentation/host layer.
//
// The second half of the file is about everything in a package that is NOT an entry:
// the `<DataSource>` header attributes, the base-workspace flag, and the zip members
// the reader carried through untouched. None of those appear in the tree a user sees,
// which is exactly why a save that drops one is quiet — the dictionary reopens, every
// entry is present and correct, and the only evidence is a setting that has turned
// itself off, or a header carrying an attribute MATLAB never wrote. Two of those
// fields also have a NORMALIZING reader: `BinarySlddParser` spells a missing `Arch`
// as `''` and a missing `AccessBaseWorkspace` as `false`, so the writer's job is to
// say back what the reader read and nothing more. That agreement is only observable
// over a whole parse -> serialize -> parse trip, which is what the tests below drive,
// each over a real MATLAB-authored package with one field of its header rewritten to
// the shape being pinned.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import DataModel from '../src/core/DataModel.js';
import { parseBinarySldd } from '../src/datamodel/parser/BinarySlddParser.js';
import {
  buildDataChunkXml,
  serializeBinarySldd,
  serializeEntryToXml,
} from '../src/datamodel/parser/BinarySlddSerializer.js';
import SlddNode from '../src/datamodel/node/container/SlddNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const binPath = fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url));
const bytes = readFileSync(binPath);

function modelFrom(uri: string, ab: ArrayBuffer) {
  DataModel.removeDataSource(uri);
  const content = parseBinarySldd(ab);
  return DataModel.addDataSource(uri, content as Record<string, unknown>, { path: 'params.sldd' });
}

function freshModel(uri: string) {
  return modelFrom(uri, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

/** The rebuilt `data/chunk0.xml` of a package this serializer just wrote. */
function chunkXmlOf(zipped: ArrayBuffer): string {
  return new TextDecoder().decode(unzipSync(new Uint8Array(zipped))['data/chunk0.xml']);
}

/**
 * The MATLAB-authored fixture with its `data/chunk0.xml` rewritten and everything
 * else — all six other members, byte for byte — left alone.
 *
 * Rewriting one field of MATLAB's own XML rather than hand-writing a package is
 * deliberate: the header fields under test are three attributes and one character in a
 * forty-entry document, and a package built from scratch would prove only that the
 * writer agrees with whatever this test made up.
 */
function repackaged(edit: (xml: string) => string): ArrayBuffer {
  const members = unzipSync(new Uint8Array(bytes));
  members['data/chunk0.xml'] = new TextEncoder().encode(edit(new TextDecoder().decode(members['data/chunk0.xml'])));
  const zipped = zipSync(members, { level: 6 });
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

describe('serializeBinarySldd', () => {
  it('round-trips: re-serialized zip re-parses to the same entry names', () => {
    const model = freshModel('mem://ser1');
    const out = serializeBinarySldd(model);
    const parts = unzipSync(new Uint8Array(out));
    expect(parts['data/chunk0.xml']).toBeDefined();
    const xml = new TextDecoder().decode(parts['data/chunk0.xml']);
    expect(xml).toContain('<Object Class="DD.ENTRY">');
    expect(xml).toContain('<Object Class="DD.Dictionary">');
    const names = model.children.flatMap((s: any) => s.children.map((e: any) => e.name));
    for (const n of names) expect(xml).toContain('>' + n + '</P>');
  });

  it('serializeEntryToXml emits the 6 metadata P-nodes and a Value P', () => {
    const model = freshModel('mem://ser2');
    const entry = model.children.flatMap((s: any) => s.children)[0];
    const frag = serializeEntryToXml(entry);
    expect(frag).toContain('<Object Class="DD.ENTRY">');
    expect(frag).toContain('<P Name="Name" Class="char">');
    expect(frag).toContain('<P Name="UUID" Class="char">');
    expect(frag).toContain('<P Name="Namespace" Class="char">');
    expect(frag).toContain('<P Name="LastMod" Class="char">');
    expect(frag).toContain('<P Name="LastModBy" Class="char">');
    expect(frag).toContain('<P Name="IsDerived" Class="char">');
    expect(frag).toContain('Name="Value"');
    expect(frag.trimEnd().endsWith('</Object>')).toBe(true);
  });

  it('preserves _rawLastMod (no date bump)', () => {
    const model = freshModel('mem://ser3');
    const entry = model.children.flatMap((s: any) => s.children)[0];
    const raw = entry.metadata._rawLastMod as string;
    expect(serializeEntryToXml(entry)).toContain('<P Name="LastMod" Class="char">' + raw + '</P>');
  });

  // A newly added entry has no `_rawLastMod` — addEntry stamps `lastmod` instead —
  // so the serializer has to read that key too. Reading only `_rawLastMod` fell back
  // to "now", which meant the Last Modified column showed one timestamp and the file
  // on disk got a different one on every save.
  it('writes a newly added entry own lastmod, not the save time', () => {
    const model = freshModel('mem://ser4');
    const entry = model.getSection('design')!.addEntry('Simulink.Parameter')!;
    expect(entry.metadata._rawLastMod).toBeUndefined();

    const pinned = '20200101T010203.000000';
    entry.metadata.lastmod = pinned;
    expect(serializeEntryToXml(entry as any)).toContain(
      '<P Name="LastMod" Class="char">' + pinned + '</P>',
    );
    // ...and it is the same value the UI displays, so the two cannot drift.
    expect(entry.lastModified).toBe('2020-01-01T01:02:03Z');
  });
});

describe('the package around the entries', () => {
  it('carries a dictionary whose base-workspace access is on back out as on', () => {
    // One character in the whole package — `<P Name="AccessBaseWorkspace">1` — and it
    // is the dictionary's "allow access to the base workspace" setting. Nothing in the
    // tree shows it, so a writer that always spelled it `0` would lose a user's setting
    // on the first save of a file they only opened to read: the dictionary reopens with
    // all forty entries intact and the setting silently off. The round trip goes back
    // through the reader because reader and writer flipping the same way is the one
    // failure a one-sided assertion would pass.
    const model = modelFrom('mem://abws-on', repackaged((xml) =>
      xml.replace('<P Name="AccessBaseWorkspace" Class="logical">0</P>', '<P Name="AccessBaseWorkspace" Class="logical">1</P>'),
    ));
    expect(model.allowAccessBWS, 'the flag must reach the model before the writer can be blamed').toBe(true);

    const written = serializeBinarySldd(model);
    expect(chunkXmlOf(written)).toContain('<P Name="AccessBaseWorkspace" Class="logical">1</P>');
    expect(modelFrom('mem://abws-reread', written).allowAccessBWS).toBe(true);

    // The control, so this is measuring the flag and not merely writing a 1: the
    // fixture as MATLAB wrote it has the setting off, and it stays off.
    const off = freshModel('mem://abws-off');
    expect(chunkXmlOf(serializeBinarySldd(off))).toContain('<P Name="AccessBaseWorkspace" Class="logical">0</P>');
    expect(modelFrom('mem://abws-off-reread', serializeBinarySldd(off)).allowAccessBWS).toBe(false);
  });

  it('copies the release the header declared, and says nothing about Arch when it declared none', () => {
    // `Arch` is optional in a `<DataSource>` header, which is why the reader spells a
    // missing one as `''` — and an empty string is not the same document as an absent
    // attribute. A writer that always emitted `Arch=""` would put an attribute in the
    // header of every dictionary that had none, on a file the user may have opened only
    // to look at. The distinctive FormatVersion and MinRelease here are what separate
    // "copied from the file" from "fell back to the built-in R2014a default", which the
    // fixture's own header cannot do — its values ARE the defaults.
    const model = modelFrom('mem://noarch', repackaged((xml) =>
      xml.replace(/<DataSource[^>]*>/, '<DataSource FormatVersion="4" MinRelease="R2026b">'),
    ));
    const xml = chunkXmlOf(serializeBinarySldd(model));
    expect(xml).toContain('<DataSource FormatVersion="4" MinRelease="R2026b">');
    expect(xml, 'an absent attribute must stay absent, not become an empty one').not.toContain('Arch=');

    // The control: the fixture does declare an Arch, and it survives verbatim.
    expect(chunkXmlOf(serializeBinarySldd(freshModel('mem://arch')))).toContain(
      '<DataSource FormatVersion="1" MinRelease="R2014a" Arch="maca64">',
    );
  });

  it('writes a dictionary tree that never came out of a package', () => {
    // `_zipMetadata` and `_dataSourceAttrs` are the two things a SlddNode learns ONLY
    // from the binary reader, and both are null until it does. So this is the writer
    // being total over the class it is typed against: a tree with no package provenance
    // has no members to carry through and no header to copy, and it still has to
    // produce a package that opens. Without the two fallbacks it does not fail
    // gracefully — `Object.entries(null)` throws and the save dies part-written.
    const node = new SlddNode('brand-new.sldd');
    expect(node._zipMetadata).toBe(null);
    expect(node._dataSourceAttrs).toBe(null);
    node.getSection('design')!.addEntry('Simulink.Parameter');

    const written = serializeBinarySldd(node);
    // Exactly the one member it has bytes for: nothing invented to fill the package out.
    expect(Object.keys(unzipSync(new Uint8Array(written)))).toEqual(['data/chunk0.xml']);
    const xml = chunkXmlOf(written);
    expect(xml).toContain('<DataSource FormatVersion="1" MinRelease="R2014a">');
    expect(xml, 'the default header declares no architecture').not.toContain('Arch=');
    expect(modelFrom('mem://fresh-reread', written).children.flatMap((s: any) => s.children).length).toBe(1);
  });

  it('writes an entry whose record carried no metadata rather than failing the whole save', () => {
    // `SectionNode.parseEntry` spells a record with no `metadata` key as null — that is
    // its own `|| null` — so a null-metadata entry is a state the model admits. What is
    // at stake is not that entry's six fields but the OTHER forty: `serializeEntryToXml`
    // reads `metadata.uuid` in the middle of a whole-document rebuild, so one such entry
    // used to take the entire save down with a TypeError. It is written with its fields
    // empty, and the document around it is written too.
    const model = freshModel('mem://nometa');
    const entry = model.getSection('design')!.parseEntry({ name: 'noMeta', value: 5 });
    expect(entry.metadata).toBe(null);

    const frag = serializeEntryToXml(entry as any);
    expect(frag).toContain('<P Name="Name" Class="char">noMeta</P>');
    expect(frag).toContain('<P Name="UUID" Class="char"></P>');
    expect(frag).toContain('<P Name="Namespace" Class="char"></P>');
    expect(frag).toContain('<P Name="LastModBy" Class="char"></P>');
    // Not `undefined`: IsDerived is what puts an entry in Design Data or in
    // Architectural Data, and the reader compares it to the literal '1'.
    expect(frag).toContain('<P Name="IsDerived" Class="char">0</P>');
    // With no timestamp of its own the entry gets the save's, in MATLAB's own spelling.
    expect(frag).toMatch(/<P Name="LastMod" Class="char">\d{8}T\d{6}\.\d{6}<\/P>/);
    expect(buildDataChunkXml(model)).toContain('<P Name="Name" Class="char">noMeta</P>');
  });
});
