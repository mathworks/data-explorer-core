// Copyright 2026 The MathWorks, Inc.
//
// The edges of the session's usage scan (collectUsages) and link lookup (resolveLink) that the
// main suites (usedByColumn, resolveLink) do not reach:
//
//   * one name, two definitions in one dictionary: a Design Data entry and its Architectural Data
//     counterpart, which share Design's namespace. A block that names it uses both, and the batch
//     (session.rowsOf) says so exactly as the per-row path (node.toRow) does, for each of them;
//   * a host-supplied model that sees a dictionary, whose usage list holds entries that are not
//     usages (no string value, no block name) beside one that is: the one is credited, the rest are
//     passed over, and nothing throws;
//   * a target naming an entry and no source, which resolves into no open source, however many
//     are open and whatever they hold;
//   * a target naming a block key a model does not have: `not-found`, the name as the target said
//     it, rather than a node.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { NS_DESIGN } from '../src/datamodel/SectionConstants.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

function artifact(rel: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./parity/artifacts/${rel}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// An in-memory `.slx` holding only what a link needs, as usedByColumn.test.ts builds one.
function slxModel(dictionary: string, blocksXml: string): ArrayBuffer {
  const parts: Record<string, Uint8Array> = {
    'simulink/blockDiagram.json': strToU8(JSON.stringify({ BlockDiagram: { ModelUUID: 'u1', DataDictionary: dictionary } })),
    'simulink/systems/system_root.xml': strToU8(`<?xml version="1.0" encoding="utf-8"?><System>${blocksXml}</System>`),
    'metadata/coreProperties.xml': strToU8(`<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`),
  };
  const zipped = zipSync(parts);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

const block = (name: string, type: string, prop: string, value: string) =>
  `<Block BlockType="${type}" Name="${name}" SID="${name}"><P Name="${prop}">${value}</P></Block>`;

// params.sldd (which holds `gravity` in Design Data) with a second `gravity` in Architectural
// Data: the same namespace, the derived flag set.
function paramsWithArchGravity(): any {
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(artifact('text/params.sldd'))));
  const entries = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
  expect(entries.some((e: any) => e.name === 'gravity' && e.metadata.isderived === '0')).toBe(true);
  entries.push({
    name: 'gravity',
    metadata: { uuid: '00000000-0000-4000-8000-00000000a7c1', namespace: NS_DESIGN, lastmod: '20260101T000000.000000', modifiedby: 'u', isderived: '1' },
    value: 9.8,
  });
  return json;
}

const linksOf = (cell: any): string[] => (cell ? cell.links.map((l: any) => `${l.text} -> ${l.linkTarget}`) : []);

describe('one name, two definitions in one dictionary', () => {
  function session() {
    const s = createSession();
    ingest(s, slxModel('mdlparams.sldd', block('G1', 'Gain', 'Gain', 'gravity*2')), { filename: 'm.slx' });
    const dict: any = s.addDataSource('mdlparams.sldd', paramsWithArchGravity());
    const design = dict.getSection('design').children.find((e: any) => e.name === 'gravity');
    const arch = dict.getSection('arch').children.find((e: any) => e.name === 'gravity');
    return { s, dict, design, arch };
  }

  it('are read as two entries, one in each section', () => {
    const { design, arch } = session();
    expect(design).toBeTruthy();
    expect(arch).toBeTruthy();
    expect(design.id).not.toBe(arch.id);
  });

  it('are both used by the block that names them, row by row and in one batch alike', () => {
    const { s, dict, design, arch } = session();
    for (const def of [design, arch]) {
      expect(linksOf(def.toRow().UsedBy)).toEqual(['G1 -> G1@m.slx']);
      expect(s.findUsages(def.id).map((u: any) => u.paramValue)).toEqual(['gravity*2']);
    }
    // The batch asks collectUsages of both at once, under one name: each is credited, once.
    const rows = s.rowsOf(dict);
    const perRow = (dict.flatten() as any[]).map((n) => n.toRow()).filter((r) => r !== null);
    expect(rows).toEqual(perRow);
    expect(rows.filter((r: any) => r.ID === design.id || r.ID === arch.id).map((r: any) => linksOf(r.UsedBy))).toEqual([
      ['G1 -> G1@m.slx'],
      ['G1 -> G1@m.slx'],
    ]);
  });
});

describe('a host-supplied model whose usage list holds what is no usage', () => {
  it('credits the usage it holds, and passes over the rest without a throw', () => {
    const s = createSession();
    const dict: any = ingest(s, artifact('text/params.sldd'), { filename: 'mdlparams.sldd' });
    // A tree this package did not build (addParsedSource), which declares the dictionary as a
    // data source and so sees `gravity`, and whose usage list a host filled with what it had.
    const sources: any = { name: 'dataSources', parent: null, children: [{ name: 'mdlparams.sldd', children: [] }] };
    const model: any = {
      name: 'host.slx',
      isContainer: true,
      parent: null,
      children: [] as any[],
      blockParamUsages: [
        null,
        { blockName: 'NoValue' },
        { blockName: 'NumericValue', paramValue: 42 },
        { paramValue: 'gravity' },
        { blockName: 'G', blockType: 'Gain', paramProperty: 'Gain', paramValue: 'gravity + 1', sid: '7', systemPath: '' },
      ],
      get id() {
        return this.name;
      },
      flatten() {
        return this.children;
      },
      getSection(key: string) {
        return key === 'dataSources' ? sources : null;
      },
    };
    s.addParsedSource('host.slx', model);
    const gravity = dict.getSection('design').children.find((e: any) => e.name === 'gravity');
    let usages: any[] = [];
    expect(() => {
      usages = s.findUsages(gravity.id);
    }).not.toThrow();
    expect(usages.map((u) => [u.modelSrcId, u.blockType, u.paramProperty, u.paramValue])).toEqual([['host.slx', 'Gain', 'Gain', 'gravity + 1']]);
    expect(s.rowsOf(dict.getSection('design')).find((r: any) => r.ID === gravity.id)!.UsedBy).toEqual(gravity.toRow().UsedBy);
  });
});

describe('resolveLink of a target that names no source, or a block a model does not have', () => {
  it('resolves a name with no source after its `@` into no open source', () => {
    const s = createSession();
    ingest(s, artifact('text/params.sldd'), { filename: 'mdlparams.sldd' });
    expect(s.resolveLink('gravity@mdlparams.sldd')).toMatchObject({ status: 'resolved', sourceId: 'mdlparams.sldd' });
    expect(s.resolveLink('gravity@')).toEqual({ status: 'source-not-open', sourceId: '', name: 'gravity' });
  });

  it('says a block key a model does not hold is not found, naming it as the target did', () => {
    const s = createSession();
    ingest(s, slxModel('mdlparams.sldd', block('G1', 'Gain', 'Gain', 'gravity')), { filename: 'm.slx' });
    const g1 = s.findNodeById('m.slx/blocks/G1') as any;
    expect(g1).not.toBeNull();
    expect(s.resolveLink('G1@m.slx')).toMatchObject({ status: 'resolved', node: g1 });
    expect(s.resolveLink('G2@m.slx')).toEqual({ status: 'not-found', sourceId: 'm.slx', name: 'G2' });
  });
});
