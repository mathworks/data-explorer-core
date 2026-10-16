// Copyright 2026 The MathWorks, Inc.
//
// Editable Code Generation properties (Storage Class + Alignment) — the model +
// write-back path. Exercises trySetSchemaProperty routing and a real-fixture
// round-trip for BOTH .sldd formats (JSON text and binary/XML), proving the
// nested CoderInfo write-back persists and re-parses. Pure data model: the
// fixtures are loaded straight through DataModel, no presentation/host layer.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ParameterNode from '../src/datamodel/node/data/ParameterNode.js';
import DataModel from '../src/core/DataModel.js';
import { parseBinarySldd } from '../src/datamodel/parser/BinarySlddParser.js';
import { resolveSourcePath } from '../src/datamodel/schema/index.js';
import '../src/datamodel/node/data/NodeClassMap.js';

describe('trySetSchemaProperty routing via node.setProperty', () => {
  it('sets storageClass to a valid enum value', () => {
    const node = ParameterNode.createDefault('p', null);
    expect(node.setProperty('storageClass', 'ExportedGlobal')).toBe(true);
    expect(resolveSourcePath(node.serial._properties, 'CoderInfo.StorageClass')).toBe('ExportedGlobal');
  });

  it('rejects an out-of-enum storageClass with no mutation', () => {
    const node = ParameterNode.createDefault('p', null);
    const before = JSON.stringify(node.serial._properties);
    const r = node.setProperty('storageClass', 'Bogus');
    expect(r).not.toBe(true);
    expect((r as any).error).toBe(true);
    expect(JSON.stringify(node.serial._properties)).toBe(before);
  });

  it("does not write alignment under StorageClass 'Auto' (MATLAB refuses it there)", () => {
    // A new Parameter's StorageClass is 'Auto', where MATLAB refuses any Alignment
    // but -1 ("Cannot set Alignment when StorageClass is 'Auto'."), so the write
    // never reaches CoderInfo.Alignment. The edit itself, under another storage
    // class, is test/alignmentEdit.test.ts.
    const node = ParameterNode.createDefault('p', null);
    node.setProperty('alignment', '8');
    expect(resolveSourcePath(node.serial._properties, 'CoderInfo.Alignment')).not.toBe(8);
  });

  it('falls through to node logic for a non-schema property (Description)', () => {
    const node = ParameterNode.createDefault('p', null);
    expect(node.setProperty('Description', 'hello')).toBe(true);
    expect(node.Description).toBe('hello');
  });
});

const ART = (variant: string, name: string) =>
  fileURLToPath(new URL(`./parity/artifacts/${variant}/${name}`, import.meta.url));

function loadGravity(variant: string): { node: any; model: any } {
  const uri = `cgedit://${variant}/params.sldd`;
  const raw = readFileSync(ART(variant, 'params.sldd'));
  const isZip = raw[0] === 0x50 && raw[1] === 0x4b;
  DataModel.removeDataSource(uri);
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const content = isZip
    ? (parseBinarySldd(ab as ArrayBuffer) as Record<string, unknown>)
    : JSON.parse(raw.toString('utf8'));
  const model = DataModel.addDataSource(uri, content, { path: 'params.sldd' });
  for (const s of model.children ?? []) for (const e of s.children ?? []) if (e.name === 'gravity') return { node: e, model };
  throw new Error('gravity not found in ' + variant);
}

describe('Code Gen edit round-trip: text (JSON) gravity Parameter', () => {
  it('storageClass edit reserializes to JSON and re-parses with the new value', () => {
    const { node } = loadGravity('text');
    expect(node.setProperty('storageClass', 'ExportedGlobal')).toBe(true);
    // Reserialize the entry (what the host splices back) and re-read.
    const serialized: any = node.serialize();
    const reparsed = ParameterNode.parse(serialized.value, 'gravity', null);
    expect(resolveSourcePath(reparsed.serial._properties, 'CoderInfo.StorageClass')).toBe('ExportedGlobal');
  });

  it('marks the entry Modified after a schema edit', () => {
    const { node } = loadGravity('text');
    node.setProperty('storageClass', 'Custom');
    expect(node.status).toBe('Modified');
  });
});

describe('Code Gen edit round-trip: binary (XML) gravity Parameter', () => {
  it('storageClass edit survives an XML reserialize + reparse', () => {
    const { node } = loadGravity('binary');
    expect(node.setProperty('storageClass', 'Custom')).toBe(true);
    // serializeValue rebuilds the MATLABArray-wrapped _properties in place.
    expect(resolveSourcePath(node.serial._properties, 'CoderInfo.StorageClass')).toBe('Custom');
  });

  it("leaves the int32 Alignment leaf untouched under StorageClass 'Auto'", () => {
    const { node } = loadGravity('binary');
    const align = node.serial._properties.CoderInfo._elements[0]._properties.Alignment;
    const before = JSON.stringify(align);
    node.setProperty('alignment', '32');
    // gravity's StorageClass is 'Auto', where MATLAB refuses the edit, so the
    // typed-scalar leaf is unchanged.
    expect(JSON.stringify(node.serial._properties.CoderInfo._elements[0]._properties.Alignment)).toBe(before);
  });
});
