// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/chunkEntries.test.ts at c73da3c: the two cases that hold the
// scan to the RECORD entryOps makes of an entry (entryRecord), which core's own test/chunkEntries.test.ts
// holds to the entry's serialize() instead, since core had no entryOps until now. Its first case (the
// scan reads cleanly, one span per entry) is core's already, over the same dictionaries, and is not
// repeated. Each dictionary opens in a fresh core session (createSession + addDataSource, from core's
// parseBinarySlddParts, which view's readSlddParts is), not vscode's global DataModel.
//
// The dictionaries are every binary (zip) one under core's test/, as core's own test finds them, in
// place of vscode's list of its tracked ones. Nine of vscode's twenty are in core byte for byte
// (parity/artifacts/binary/params.sldd, object_props_binary, nested_objects, chain_top (in
// folder-fixtures), rt_bin, sldd-stream-objects/stream_objects_binary, variantbank_r2027a_binary,
// vscode's workspace/binary.sldd as core's compressed.sldd, sparse/sparse_binary); the other eleven
// are not copied, as core keeps no binary fixture MATLAB was not asked about
// (test/parity/m9MergedSaves.truth.test.ts). Every assertion is vscode's.
//
// The binary save gate sees a chunk through this scan and nothing else, so the entries it names
// must be the ones the host's model holds, by the same keys: the key the gate gives the bytes
// (chunkEntryKey), the key it gives the model's nodes (entryKey of name and metadata.uuid) and the
// key an edit records for the entries it changes (entryKey of this host's entry record,
// BinarySlddEditorProvider.keysOfEdit) are one key, or the gate refuses a good save as "no edit
// changed it". And its spans must be the ones core's findEntryObjectSpan finds, since the provider
// cuts undo fragments with either, depending on how many ops want one (cutFragments).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { DATA_PART_XML, chunkEntryKey, createSession, entryKey, findEntryObjectSpan, parseBinarySlddParts, scanChunkEntries } from '../src/index.js';
import { entryRecord } from '../src/edit/entryOps.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEST = fileURLToPath(new URL('./', import.meta.url));

// Every binary (zip) dictionary under test/, found by its bytes, as core's chunkEntries test finds them.
function binaryDictionaries(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.sldd')) {
        const head = readFileSync(p).subarray(0, 2);
        if (head[0] === 0x50 && head[1] === 0x4b) out.push(relative(join(TEST, '..'), p).split(sep).join('/'));
      }
    }
  };
  for (const root of ['fixtures', 'folder-fixtures', join('parity', 'artifacts')]) walk(join(TEST, root));
  return out.sort();
}
const BINARY_FIXTURES = binaryDictionaries();

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

function loadChunk(file: string): { xml: string; meta: Record<string, Uint8Array> } {
  const zip = unzipSync(new Uint8Array(readFileSync(repo(file))));
  const xml = new TextDecoder().decode(zip[DATA_PART_XML]);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== DATA_PART_XML) meta[k] = v;
  return { xml, meta };
}

// The model the provider registers for a chunk (registerModel: readSlddParts, then addDataSource),
// in a session of its own.
function readModel(srcId: string, xml: string, meta: Record<string, Uint8Array>): any[] {
  const model: any = createSession().addDataSource(srcId, parseBinarySlddParts(xml, meta, []), { path: 'fixture.sldd' });
  return (model.children as any[]).flatMap((section: any) => section.children as any[]);
}

// What BinarySlddEditorProvider's keysOfEdit records for an entry an op carries the record of
// (its recordName and recordUuid, which are private to that vscode-coupled module).
function recordKey(record: any): string {
  const uuid = record.metadata?.uuid;
  return entryKey(String(record.name ?? ''), typeof uuid === 'string' && uuid ? uuid : undefined);
}

const sorted = (keys: string[]) => [...keys].sort();

describe('scanChunkEntries on every tracked binary dictionary, through the record an edit makes', () => {
  it('finds the dictionaries', () => {
    expect(BINARY_FIXTURES.length).toBeGreaterThan(9);
  });

  for (const file of BINARY_FIXTURES) {
    it(`${file}: the bytes' keys are the model's keys and the keys an edit records`, () => {
      const { xml, meta } = loadChunk(file);
      const nodes = readModel('chunkEntries-keys:' + file, xml, meta);
      const bytes = scanChunkEntries(xml).entries.map(chunkEntryKey);
      const model = nodes.map((n) => entryKey(n.name, typeof n.metadata?.uuid === 'string' ? n.metadata.uuid : null));
      const records = nodes.map((n) => recordKey(entryRecord(n)));
      expect(sorted(model)).toEqual(sorted(bytes));
      expect(sorted(records)).toEqual(sorted(bytes));
    });

    it(`${file}: each span is the one core's findEntryObjectSpan finds for the entry`, () => {
      // The provider's two ways of cutting an undo fragment (cutFragments): core's lookup for a
      // few ops, this scan for more. Same entry, same bytes, whichever way it is cut.
      const { xml, meta } = loadChunk(file);
      const nodes = readModel('chunkEntries-spans:' + file, xml, meta);
      const scanned = new Map(scanChunkEntries(xml).entries.map((e) => [chunkEntryKey(e), e]));
      for (const node of nodes) {
        const record = entryRecord(node) as any;
        const uuid = record.metadata?.uuid;
        const span = findEntryObjectSpan(xml, { name: String(record.name ?? ''), uuid: uuid || undefined });
        const e = scanned.get(recordKey(record))!;
        expect(span, `core finds "${node.name}"`).not.toBeNull();
        expect(xml.slice(span!.offset, span!.offset + span!.length)).toBe(xml.slice(e.start, e.end));
      }
    });
  }
});
