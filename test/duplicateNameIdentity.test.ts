// Copyright 2026 The MathWorks, Inc.
//
// Entry identity when two entries share a name.
//
// An entry name is unique only within a NAMESPACE, and one .sldd holds several:
// Design and Architectural Data share one, Configurations and Other Data each
// have their own. The uniqueness check a paste runs de-duplicates only within
// the target's namespace, so pasting Design's `Array` into Other Data keeps the
// name — the file legitimately ends up with two entries called `Array`.
//
// Every splice helper used to locate an entry by name alone, which resolved both
// of them to whichever came FIRST in the file. Deleting the second one therefore
// spliced out the first: the row the user deleted stayed and the row they never
// touched vanished. These tests pin the selector-based identity that fixes it
// (name first, metadata uuid only as a tiebreak) on BOTH .sldd formats, plus the
// name-only fallbacks that keep every unambiguous lookup behaving as it did.
//
// Ported from data-explorer-vscode test/duplicateNameIdentity.test.ts at c73da3c: imports point at
// core's copies (src/edit/entrySplice.ts, structuralEdit.ts, xmlStructuralEdit.ts) and core's barrel.
// - Each model is a fresh core session's read of the text, instead of view's getModel or the global
//   DataModel. A row found by its Name label (view's buildRows + findNode) is the entry of that name,
//   found in the tree.
// - deleteEntry and deleteEntryXml are handed the section header's row-id builder (view's
//   buildSectionRowId), which core's copies take from their caller.
// - The no-UUID case reads core's own test/fixtures/compressed.sldd, in place of vscode's file of that
//   name (other bytes). It too is written without UUIDs and holds `Kp`, which is all the case asserts,
//   and core keeps every binary fixture one MATLAB was asked about.
// The other fixtures are vscode's, byte for byte: its data.sldd is core's test/fixtures/numeric_json.sldd.
// Every assertion is vscode's.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import {
  createSession,
  parseBinarySlddParts,
  entrySelectorOf,
  toEntrySelector,
  findEntryObjectSpan,
} from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { findEntrySpan, findEntryElementSpan } from '../src/edit/entrySplice.js';
import { deleteEntry as coreDeleteEntry, deleteEntriesByName, pasteEntry } from '../src/edit/structuralEdit.js';
import { deleteEntryXml as coreDeleteEntryXml, pasteEntryXml, deleteEntriesByNameXml } from '../src/edit/xmlStructuralEdit.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// What the caller passes for a section header's row id: data-explorer-view's buildSectionRowId.
const sectionRowId = (name: string): string => `section:${name}`;
const deleteEntry = (text: string, entry: any) => coreDeleteEntry(text, entry, sectionRowId);
const deleteEntryXml = (text: string, entry: any) => coreDeleteEntryXml(text, entry, sectionRowId);

// ---------------------------------------------------------------- selectors ---

describe('entrySelectorOf', () => {
  it('carries the uuid when the entry declares one', () => {
    expect(entrySelectorOf({ name: 'A', metadata: { uuid: 'u-1' } })).toEqual({ name: 'A', uuid: 'u-1' });
  });

  // A hand-added entry (typed straight into the text view) has no metadata at
  // all. Its selector must degrade to a bare name rather than an undefined uuid
  // no element can match, or that entry would stop being findable entirely.
  it('degrades to a name-only selector when there is no usable uuid', () => {
    expect(entrySelectorOf({ name: 'A' })).toEqual({ name: 'A' });
    expect(entrySelectorOf({ name: 'A', metadata: null })).toEqual({ name: 'A' });
    expect(entrySelectorOf({ name: 'A', metadata: { uuid: '' } })).toEqual({ name: 'A' });
    expect(entrySelectorOf({ name: 'A', metadata: { uuid: 42 } })).toEqual({ name: 'A' });
  });

  it('tolerates a missing name and a missing entry', () => {
    expect(entrySelectorOf({})).toEqual({ name: '' });
    expect(entrySelectorOf(null)).toEqual({ name: '' });
    expect(entrySelectorOf(undefined)).toEqual({ name: '' });
  });
});

describe('toEntrySelector', () => {
  it('reads a bare string as "whichever entry answers to this name"', () => {
    expect(toEntrySelector('A')).toEqual({ name: 'A' });
    expect(toEntrySelector({ name: 'A', uuid: 'u-1' })).toEqual({ name: 'A', uuid: 'u-1' });
  });
});

// ------------------------------------------------------------- JSON .sldd ---

const jsonText = readFileSync(
  fileURLToPath(new URL('./fixtures/numeric_json.sldd', import.meta.url)),
  'utf8',
);

function jsonModel(uri: string, text: string): any {
  void uri;
  const bytes = new TextEncoder().encode(text);
  return ingest(createSession(), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { filename: 'data.sldd' });
}
function sectionOf(model: any, name: string) {
  return model.children.find((s: any) => s.name === name);
}
function namesIn(model: any, section: string): string[] {
  return sectionOf(model, section).children.map((c: any) => c.name);
}

// The exact state the bug needs: `Array` in Design (the fixture's own entry) and
// a second `Array` in Other Data, produced by the real paste path — which keeps
// the name because the two sections are in different namespaces.
function jsonWithDuplicate(uri: string): { text: string; designEntry: any; otherEntry: any } {
  const model = jsonModel(uri, jsonText);
  const src = (model.flatten() as any[]).find((n) => n.isEntry && n.name === 'Array');
  const { newText } = pasteEntry(jsonText, sectionOf(model, 'other'), src.serialize() as Record<string, unknown>);
  const reparsed = jsonModel(uri, newText);
  const designEntry = sectionOf(reparsed, 'design').children.find((c: any) => c.name === 'Array');
  const otherEntry = sectionOf(reparsed, 'other').children.find((c: any) => c.name === 'Array');
  return { text: newText, designEntry, otherEntry };
}

describe('JSON .sldd — two entries named the same in different namespaces', () => {
  it('the paste really does produce a same-named pair with distinct uuids', () => {
    const { designEntry, otherEntry } = jsonWithDuplicate('test://dup-json-setup.sldd');
    expect(designEntry.name).toBe('Array');
    expect(otherEntry.name).toBe('Array'); // NOT uniquified — a different namespace
    expect(otherEntry.metadata.uuid).not.toBe(designEntry.metadata.uuid);
  });

  // REGRESSION (the reported data loss). Deleting the Other Data copy used to
  // splice out the Design entry, because the name resolved to the first element.
  it('REGRESSION: deleting the second copy removes THAT copy and spares the first', () => {
    const uri = 'test://dup-json-del-second.sldd';
    const { text, otherEntry } = jsonWithDuplicate(uri);
    const { newText } = deleteEntry(text, otherEntry);
    const after = jsonModel(uri, newText);
    expect(namesIn(after, 'other')).not.toContain('Array');
    expect(namesIn(after, 'design')).toContain('Array'); // the untouched row survives
    expect(namesIn(after, 'design')).toContain('Array1'); // and so do its siblings
  });

  it('deleting the FIRST copy still removes that one', () => {
    const uri = 'test://dup-json-del-first.sldd';
    const { text, designEntry } = jsonWithDuplicate(uri);
    const { newText } = deleteEntry(text, designEntry);
    const after = jsonModel(uri, newText);
    expect(namesIn(after, 'design')).not.toContain('Array');
    expect(namesIn(after, 'other')).toContain('Array');
  });

  // REGRESSION: the cross-document move path. It deletes from the SOURCE document
  // by target, and the clipboard/drag payload it holds carries the uuid — so a
  // move of the Other Data copy must not take the Design entry with it.
  it('REGRESSION: a move-source delete by selector hits only the selected copy', () => {
    const uri = 'test://dup-json-move.sldd';
    const { text, otherEntry } = jsonWithDuplicate(uri);
    const newText = deleteEntriesByName(text, [entrySelectorOf(otherEntry.serialize())]);
    const after = jsonModel(uri, newText);
    expect(namesIn(after, 'other')).not.toContain('Array');
    expect(namesIn(after, 'design')).toContain('Array');
  });

  it('a bare name still resolves to the first match, as every caller without a uuid expects', () => {
    const { text, designEntry } = jsonWithDuplicate('test://dup-json-bare.sldd');
    const byName = findEntrySpan(text, 'Array');
    const bySelector = findEntrySpan(text, entrySelectorOf(designEntry.serialize()));
    expect(byName).toEqual(bySelector);
  });

  it('a uuid no candidate matches falls back to the first match rather than nothing', () => {
    // The uuid is a disambiguator, not the key: a stale payload (an entry
    // re-saved with a new uuid since the copy) must still find its name, or the
    // paste's source-delete would silently leave the original behind.
    const { text } = jsonWithDuplicate('test://dup-json-stale.sldd');
    const stale = findEntryElementSpan(text, { name: 'Array', uuid: 'no-such-uuid' });
    expect(stale).toEqual(findEntryElementSpan(text, 'Array'));
  });

  it('an entry with no metadata is still findable by its selector', () => {
    // Hand-added in the text view: no metadata block at all, so the selector is
    // name-only and must behave exactly like passing the name.
    const text = jsonText.replace(
      /\{\s*"name": "Array",\s*"metadata": \{[^}]*\},/,
      '{\n            "name": "Handmade",',
    );
    expect(text).toContain('"name": "Handmade"');
    expect(findEntrySpan(text, entrySelectorOf({ name: 'Handmade' }))).not.toBeNull();
  });
});

// ----------------------------------------------------------- binary .sldd ---

const binBytes = readFileSync(
  fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url)),
);

function loadBinary(uri: string, xmlOverride?: string): { model: any; xml: string } {
  const zip = unzipSync(new Uint8Array(binBytes));
  const xml = xmlOverride ?? new TextDecoder().decode(zip['data/chunk0.xml']);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;
  const model: any = createSession().addDataSource(uri, parseBinarySlddParts(xml, meta) as any, { path: 'params.sldd' });
  return { model, xml };
}

// The XML twin of jsonWithDuplicate: `scalarD` in Design plus a pasted `scalarD`
// in Other Data. A plain numeric variable, so no section type restriction applies.
function binaryWithDuplicate(uri: string): { xml: string; designEntry: any; otherEntry: any } {
  const { model, xml } = loadBinary(uri);
  const src = sectionOf(model, 'design').children.find((e: any) => e.name === 'scalarD');
  const { newText } = pasteEntryXml(xml, sectionOf(model, 'other'), src.serialize() as Record<string, unknown>);
  const { model: reparsed } = loadBinary(uri, newText);
  return {
    xml: newText,
    designEntry: sectionOf(reparsed, 'design').children.find((e: any) => e.name === 'scalarD'),
    otherEntry: sectionOf(reparsed, 'other').children.find((e: any) => e.name === 'scalarD'),
  };
}

describe('binary .sldd — two entries named the same in different namespaces', () => {
  it('the paste produces a same-named pair with distinct UUID P-nodes', () => {
    const { designEntry, otherEntry } = binaryWithDuplicate('test://dup-xml-setup.sldd');
    expect(otherEntry.name).toBe('scalarD');
    expect(otherEntry.metadata.uuid).not.toBe(designEntry.metadata.uuid);
  });

  // REGRESSION. The XML scan returned the FIRST fragment whose Name P-node
  // matched, so deleting the Other Data copy destroyed the Design entry — the
  // same data loss as on the JSON side, in the other file format.
  it('REGRESSION: deleting the second copy removes THAT copy and spares the first', () => {
    const uri = 'test://dup-xml-del-second.sldd';
    const { xml, otherEntry } = binaryWithDuplicate(uri);
    const { newText } = deleteEntryXml(xml, otherEntry);
    const { model: after } = loadBinary(uri, newText);
    expect(namesIn(after, 'other')).not.toContain('scalarD');
    expect(namesIn(after, 'design')).toContain('scalarD');
    expect(namesIn(after, 'design')).toContain('rowVec'); // siblings intact
  });

  it('REGRESSION: a move-source delete by selector hits only the selected copy', () => {
    const uri = 'test://dup-xml-move.sldd';
    const { xml, otherEntry } = binaryWithDuplicate(uri);
    const newText = deleteEntriesByNameXml(xml, [entrySelectorOf(otherEntry.serialize())]);
    const { model: after } = loadBinary(uri, newText);
    expect(namesIn(after, 'other')).not.toContain('scalarD');
    expect(namesIn(after, 'design')).toContain('scalarD');
  });

  it('a bare name, and a uuid nothing matches, both resolve to the first match', () => {
    const { xml, designEntry } = binaryWithDuplicate('test://dup-xml-bare.sldd');
    const byName = findEntryObjectSpan(xml, 'scalarD');
    expect(byName).toEqual(findEntryObjectSpan(xml, entrySelectorOf(designEntry.serialize())));
    expect(byName).toEqual(findEntryObjectSpan(xml, { name: 'scalarD', uuid: 'no-such-uuid' }));
  });

  it('an entry fragment with no UUID P-node is still findable', () => {
    // compressed.sldd is written without UUIDs at all — a real writer shape, and
    // the reason the uuid can only ever be a tiebreak.
    const p = fileURLToPath(new URL('./fixtures/compressed.sldd', import.meta.url));
    const xml = new TextDecoder().decode(unzipSync(new Uint8Array(readFileSync(p)))['data/chunk0.xml']);
    expect(xml).not.toContain('Name="UUID"');
    expect(findEntryObjectSpan(xml, { name: 'Kp', uuid: 'irrelevant' })).not.toBeNull();
  });
});
