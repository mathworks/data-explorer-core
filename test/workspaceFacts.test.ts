// Copyright 2026 The MathWorks, Inc.
// What a .slx records of its model workspace beside the variables, read as MATLAB reads it: where
// the variables come from (its data source) and which of them are the model's arguments, in every
// part layout; and the package's members as its directory records them, which a save puts the
// package back together by. The fixtures and what MATLAB R2027a reads of each are
// gen_workspace_facts.m's (test/fixtures/workspace-facts).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { argumentNames, parseSlx } from '../src/datamodel/parser/SlxParser.js';
import { parseMdl } from '../src/datamodel/parser/MdlParser.js';
import { unzipEntries } from '../src/datamodel/parser/Inflate.js';
import { packageStampsOf } from '../src/datamodel/parser/EntrySource.js';
import ModelNode from '../src/datamodel/node/container/ModelNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const DIR = new URL('./fixtures/workspace-facts/', import.meta.url);
const truth = JSON.parse(readFileSync(new URL('truth.json', DIR), 'utf8')) as {
  models: { file: string; source: string; arguments: string; variables: string[] | string }[];
};
const bytesOf = (file: string): ArrayBuffer => {
  const b = readFileSync(new URL(file, DIR));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe('the fixtures', () => {
  it('hold every data source, and arguments, in the four part layouts', () => {
    const sources = new Set(truth.models.map((m) => m.source));
    expect([...sources].sort()).toEqual(['MAT-File', 'MATLAB Code', 'MATLAB File', 'Model File']);
    expect(truth.models.filter((m) => m.source === 'Model File' && m.arguments !== '').map((m) => m.file)).toEqual(
      expect.arrayContaining(['wsf_plainarg.slx', 'wsf_plainarg_R2025a.slx', 'wsf_plainarg_R2021a.slx', 'wsf_plainarg_R2018a.slx']),
    );
  });
});

describe.each(truth.models.map((m) => [m.file, m] as const))('%s', (file, model) => {
  it("reads the workspace's data source and the model's arguments as MATLAB does", () => {
    const parsed = parseSlx(bytesOf(file), file);
    expect(parsed.workspaceSource).toBe(model.source);
    expect(parsed.modelArguments).toEqual(argumentNames(model.arguments));
    const node = ModelNode.fromParsed(parsed, file);
    expect(node.workspaceSource).toBe(model.source);
    expect(node.modelArguments).toEqual(argumentNames(model.arguments));
  });

  it('records every member of the package beside its parts, in its order, and reads them all', () => {
    const bytes = bytesOf(file);
    const parsed = parseSlx(bytes, file);
    const stamps = packageStampsOf(parsed.zipEntries);
    expect(stamps).toBeDefined();
    const names = stamps!.map((s) => s.name).filter((n) => !n.endsWith('/'));
    expect(names).toEqual(Object.keys(unzipEntries(new Uint8Array(bytes))));
    expect(names.every((n) => parsed.zipEntries![n] !== undefined)).toBe(true);
    expect(names.length).toBeGreaterThan(5);
  });
});

describe('a model argument list', () => {
  it('is MATLAB comma-separated text, read in its order with its names trimmed', () => {
    expect(argumentNames('k,gain')).toEqual(['k', 'gain']);
    expect(argumentNames(' k , gain ,')).toEqual(['k', 'gain']);
    expect(argumentNames('')).toEqual([]);
    expect(argumentNames(undefined)).toEqual([]);
  });
});

describe('a package with a member that does not read', () => {
  it('names it in its stamps, where its parts do not hold it, which is how a save knows', () => {
    const entries = unzipEntries(new Uint8Array(bytesOf('wsf_plainarg.slx')));
    const zipped = zipSync({ ...entries, 'simulink/extra.xml': [new Uint8Array(4000).fill(0x61), { level: 9 }] });
    // The extra member's directory says it inflates to fewer bytes than it does.
    const view = new DataView(zipped.buffer);
    const name = new TextEncoder().encode('simulink/extra.xml');
    for (let at = zipped.length - 22; at > 0; at--) {
      if (view.getUint32(at, true) === 0x02014b50 && name.every((b, i) => zipped[at + 46 + i] === b)) {
        view.setUint32(at + 24, 100, true);
      }
    }
    const parsed = parseSlx(zipped.buffer.slice(0) as ArrayBuffer, 'damaged.slx');
    expect(parsed.warnings.map((w) => w.part)).toContain('simulink/extra.xml');
    expect(packageStampsOf(parsed.zipEntries)!.map((s) => s.name)).toContain('simulink/extra.xml');
    expect(parsed.zipEntries!['simulink/extra.xml']).toBeUndefined();
  });
});

describe('a model that is no zip', () => {
  it('a classic .mdl has no package stamps, and keeps its own workspace', () => {
    const b = readFileSync(fileURLToPath(new URL('./fixtures/model_with_refs.mdl', import.meta.url)));
    const parsed = parseMdl(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'model_with_refs.mdl');
    expect(packageStampsOf(parsed.zipEntries)).toBeUndefined();
    expect(parsed.workspaceSource).toBe('Model File');
    expect(parsed.modelArguments).toEqual([]);
  });
});
