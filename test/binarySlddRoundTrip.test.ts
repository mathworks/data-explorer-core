// Copyright 2026 The MathWorks, Inc.
//
// Data-model round-trip for the binary (zip) .sldd format: parse the split
// parts, re-serialize through the data model, and assert byte/structure
// fidelity. The host-side splice test (single-entry XML splice via
// findEntryObjectSpan) lives with the extension's integration tests.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import DataModel from '../src/core/DataModel.js';
import '../src/datamodel/node/NodeClassMap.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import {
  serializeBinarySldd,
  buildDataChunkXml,
} from '../src/datamodel/parser/BinarySlddSerializer.js';

function loadZip(fixture: string) {
  const p = fileURLToPath(new URL('./parity/artifacts/binary/' + fixture, import.meta.url));
  const bytes = readFileSync(p);
  const zip = unzipSync(new Uint8Array(bytes));
  const xml = new TextDecoder().decode(zip['data/chunk0.xml']);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(zip)) if (k !== 'data/chunk0.xml') meta[k] = v;
  return { zip, xml, meta };
}

describe('binary sldd round-trip', () => {
  it('pass-through parts are byte-identical after re-serialize', () => {
    DataModel.removeDataSource('mem://rt1');
    const { zip, xml, meta } = loadZip('params.sldd');
    const model = DataModel.addDataSource('mem://rt1', parseBinarySlddParts(xml, meta), { path: 'params.sldd' });
    const out = serializeBinarySldd(model);
    const outZip = unzipSync(new Uint8Array(out));
    for (const name of Object.keys(meta)) {
      expect(Array.from(outZip[name] ?? [])).toEqual(Array.from(zip[name]));
    }
  });

  it('save gate: buildDataChunkXml output re-parses without throwing', () => {
    DataModel.removeDataSource('mem://rt2');
    const { xml, meta } = loadZip('params.sldd');
    const model = DataModel.addDataSource('mem://rt2', parseBinarySlddParts(xml, meta), { path: 'params.sldd' });
    const rebuilt = buildDataChunkXml(model);
    expect(() => parseBinarySlddParts(rebuilt, meta)).not.toThrow();
    const reparsed = parseBinarySlddParts(rebuilt, meta) as any;
    const origNames = model.children.flatMap((s: any) => s.children.map((e: any) => e.name)).sort();
    const rows = reparsed.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    const newNames = rows.map((e: any) => e.name).sort();
    expect(newNames).toEqual(origNames);
  });
});
