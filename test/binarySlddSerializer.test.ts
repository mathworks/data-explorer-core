// Copyright 2026 The MathWorks, Inc.
//
// Data-model serializer tests for the binary (zip) .sldd format. Loads a fixture
// through the data model directly (parse binary parts -> addDataSource) and
// asserts the serializer output, with no presentation/host layer.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import DataModel from '../src/core/DataModel.js';
import { parseBinarySldd } from '../src/datamodel/parser/BinarySlddParser.js';
import {
  serializeBinarySldd,
  serializeEntryToXml,
} from '../src/datamodel/parser/BinarySlddSerializer.js';
import '../src/datamodel/node/NodeClassMap.js';

const binPath = fileURLToPath(new URL('./parity/artifacts/binary/params.sldd', import.meta.url));
const bytes = readFileSync(binPath);

function freshModel(uri: string) {
  DataModel.removeDataSource(uri);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const content = parseBinarySldd(ab as ArrayBuffer);
  return DataModel.addDataSource(uri, content as Record<string, unknown>, { path: 'params.sldd' });
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
