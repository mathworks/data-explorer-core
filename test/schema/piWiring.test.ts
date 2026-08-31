// Copyright 2026 The MathWorks, Inc.
//
// Parameter/Signal property-inspector wiring: createDefault seeds the hydrated
// schema groups (General / Value Properties / Code Generation / Custom
// Attributes), and toPIObject projects the same Code Generation values from a
// real fixture regardless of source format. Pure data model — the fixtures load
// straight through DataModel, with no presentation/host layer.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ParameterNode from '../../src/datamodel/node/data/ParameterNode.js';
import SignalNode from '../../src/datamodel/node/data/SignalNode.js';
import DataModel from '../../src/core/DataModel.js';
import { parseBinarySldd } from '../../src/datamodel/parser/BinarySlddParser.js';
import '../../src/datamodel/node/NodeClassMap.js';

describe('Parameter/Signal PI includes hydrated schema groups', () => {
  it('ParameterNode PI opens with the common General group, then Value Properties/Code Generation/Custom Attributes', () => {
    const node = ParameterNode.createDefault('p', null);
    const pi = node.toPIObject()!;
    const groupNames = (pi.propertySheet.groups as any[]).map((g) => g.displayName);
    expect(groupNames).toEqual(['General', 'Value Properties', 'Code Generation', 'Custom Attributes']);
    const general = (pi.propertySheet.groups as any[]).find((g) => g.displayName === 'General');
    expect(general.items.map((i: any) => i.name)).toEqual(['Name', 'Value', 'DataType', 'Kind', 'Class']);
  });

  it('ParameterNode PI shows the seeded Code Generation defaults (createDefault has StorageClass Auto)', () => {
    const node = ParameterNode.createDefault('p', null);
    const pi = node.toPIObject()!;
    const obj = (pi.objects as any[])[0];
    expect(obj.storageClass).toBe('Auto');
    expect(obj.alignment).toBe('-1');
    expect(obj.complexity).toBe('real');
  });

  it('SignalNode PI also gains the schema groups', () => {
    const node = SignalNode.createDefault('s', null);
    const pi = node.toPIObject()!;
    const groupNames = (pi.propertySheet.groups as any[]).map((g) => g.displayName);
    expect(groupNames).toContain('Code Generation');
    const obj = (pi.objects as any[])[0];
    expect(obj.storageClass).toBe('Auto');
  });

  it('schema PI props are read-only', () => {
    const node = ParameterNode.createDefault('p', null);
    const pi = node.toPIObject()!;
    const storage = (pi.propertySheet.properties as any[]).find((p) => p.name === 'storageClass');
    expect(storage.editable).toBe(false);
  });
});

const ART = (variant: string, name: string) =>
  fileURLToPath(new URL(`../parity/artifacts/${variant}/${name}`, import.meta.url));

function loadGravity(variant: string): any {
  const uri = `piwire://${variant}/params.sldd`;
  const raw = readFileSync(ART(variant, 'params.sldd'));
  const isZip = raw[0] === 0x50 && raw[1] === 0x4b;
  DataModel.removeDataSource(uri);
  const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const content = isZip
    ? (parseBinarySldd(ab as ArrayBuffer) as Record<string, unknown>)
    : JSON.parse(raw.toString('utf8'));
  const node = DataModel.addDataSource(uri, content, { path: 'params.sldd' });
  for (const s of node.children ?? []) for (const e of s.children ?? []) if (e.name === 'gravity') return e;
  throw new Error('gravity entry not found in ' + variant);
}

function piValues(node: any): Record<string, string> {
  const obj = node.toPIObject().objects[0];
  return obj;
}

describe('PI hydration parity: JSON vs binary gravity Parameter', () => {
  it('both forms project the same Code Generation values', () => {
    const t = piValues(loadGravity('text'));
    const b = piValues(loadGravity('binary'));
    expect(t.storageClass).toBe('Auto');
    expect(b.storageClass).toBe('Auto');
    expect(t.storageClass).toBe(b.storageClass);
    expect(t.alignment).toBe('-1');
    expect(b.alignment).toBe('-1');
    expect(t.alignment).toBe(b.alignment);
  });

  it('projecting the PI does not mutate serial (display-only)', () => {
    const node = loadGravity('binary');
    const before = JSON.stringify(node.serial);
    node.toPIObject();
    node.toPIObject();
    expect(JSON.stringify(node.serial)).toBe(before);
  });
});
