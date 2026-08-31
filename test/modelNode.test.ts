// Copyright 2026 The MathWorks, Inc.
// Unit tests for the .slx model tree: ModelNode (the file root), its five fixed
// ModelSectionNodes, and the leaf nodes only a model produces — ModelBlockNode,
// ModelReferenceNode and DataSourceNode. A model is read-only in this product, so
// the contract under test is presentation and structure: which sections exist,
// what each leaf shows in the table, where its links point, and what serialize()
// hands back for the save path.

import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import ModelNode from '../src/datamodel/node/container/ModelNode.js';
import type { ParsedSlx } from '../src/datamodel/node/container/ModelNode.js';
import { parseSlx } from '../src/datamodel/parser/SlxParser.js';
import type { MatVariable } from '../src/datamodel/node/data/MatlabVariableNode.js';

// A scalar double workspace variable, the simplest thing the workspace section
// can hold.
function wsVar(name: string, value: unknown): MatVariable {
  return {
    name,
    className: 'double',
    dimensions: [1, 1],
    isComplex: false,
    isLogical: false,
    value,
    fields: null,
  };
}

// A minimal ParsedSlx. Building it directly (rather than zipping a fixture) lets
// each test name exactly the one section it is about; parseSlx itself is covered
// by parser.test.ts and blockParamUsages.test.ts.
function parsedSlx(over: Partial<ParsedSlx> = {}): ParsedSlx {
  const workspace = [wsVar('Kp', 5)] as MatVariable[] & { _trailingElements: Uint8Array[] };
  workspace._trailingElements = [];
  return {
    name: 'm.slx',
    release: 'R2026b',
    creator: 'me',
    lastModified: '',
    uuid: 'u1',
    dataDictionary: null,
    modelReferences: [],
    externalDataSources: [],
    configSets: [],
    workspace,
    blockParamUsages: [],
    rawContents: null,
    zipEntries: null,
    ...over,
  };
}

const model = (over?: Partial<ParsedSlx>) => ModelNode.fromParsed(parsedSlx(over), 'm.slx') as any;

// An in-memory .slx holding just the block XML, for the block-usage path.
function slxWithBlocks(blocksXml: string, dataDictionary?: string): ArrayBuffer {
  const diagram: Record<string, unknown> = { ModelUUID: 'u1' };
  if (dataDictionary) {
    diagram.DataDictionary = dataDictionary;
  }
  const z = zipSync({
    'simulink/blockDiagram.json': strToU8(JSON.stringify({ BlockDiagram: diagram })),
    'simulink/systems/system_root.xml': strToU8(`<?xml version="1.0"?><System>${blocksXml}</System>`),
    'metadata/coreProperties.xml': strToU8(`<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`),
  });
  return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer;
}

const blockModel = (blocksXml: string, dd?: string) =>
  ModelNode.fromParsed(parseSlx(slxWithBlocks(blocksXml, dd), 'm.slx'), 'm.slx') as any;

describe('ModelNode — presentation', () => {
  it('shows the filename with the Simulink icon and is read-only', () => {
    const m = model();
    expect(m.displayName).toBe('m.slx');
    expect(m.icon).toBe('simulink');
    // A model is a viewer target in this product; edits go through the linked
    // dictionary, never the .slx itself.
    expect(m.readOnly).toBe(true);
  });

  it('surfaces the release the parser read from the archive metadata', () => {
    expect(model({ release: 'R2027a' }).Release).toBe('R2027a');
  });

  it('offers Name and Release, in a single General group', () => {
    const m = model();
    expect(m.getProperties().map((p: any) => p.key)).toEqual(['Name', 'Release']);
    expect(m.getPILayout()).toEqual([{ group: 'General', items: m.getProperties() }]);
  });

  it('counts entries across all sections, not children of the root', () => {
    // The root's own children are the five fixed sections; the count users see is
    // the number of things inside them.
    const m = model({
      modelReferences: [{ blockPath: 'a/b', modelName: 'plant' }],
      externalDataSources: ['signals.mat'],
    });
    expect(m.children.length).toBe(5);
    expect(m.NumberOfEntries).toBe(3); // Kp + plant.slx + signals.mat
  });
});

describe('ModelNode — sections', () => {
  it('always creates the five model sections, in display order', () => {
    expect(model().children.map((c: any) => [c.name, c.displayName])).toEqual([
      ['blocks', 'Model Elements'],
      ['workspace', 'Model Workspace'],
      ['config', 'Configurations'],
      ['references', 'Model References'],
      ['dataSources', 'External Data'],
    ]);
  });

  it('gives each section its own icon', () => {
    expect(model().children.map((c: any) => c.icon)).toEqual([
      'blocks',
      'databaseFolderWorkspace',
      'databaseFolderConfiguration',
      'modelReference',
      'link_database',
    ]);
  });

  it('getSection resolves a known key and returns null for anything else', () => {
    const m = model();
    expect(m.getSection('workspace')).toBe(m.children[1]);
    expect(m.getSection('nope')).toBeNull();
  });

  it('relabels the shared Value/DataType columns per section', () => {
    // Every section reuses the same row shape, so the section is what tells the
    // table whether "Value" means a block type, a variable value, or a path.
    const m = model();
    expect(m.tableColumnConfig).toEqual({
      columns: ['Name', 'Value', 'DataType', 'UsedBy'],
      labels: { DataType: 'Type', UsedBy: 'Usage' },
    });
    expect(m.getSection('blocks').tableColumnConfig).toEqual({
      columns: ['Name', 'Value', 'DataType'],
      labels: { Value: 'Block Type', DataType: 'Uses' },
    });
    expect(m.getSection('config').tableColumnConfig).toEqual({ columns: ['Name', 'Description'] });
    for (const key of ['workspace', 'references', 'dataSources']) {
      expect(m.getSection(key).tableColumnConfig, key).toEqual({
        columns: ['Name', 'Value', 'DataType', 'UsedBy'],
      });
    }
  });
});

describe('ModelNode — workspace section', () => {
  it('turns a plain workspace variable into a MatlabVariableNode', () => {
    const ws = model().getSection('workspace');
    expect(ws.children.map((c: any) => [c.name, c.constructor.name])).toEqual([['Kp', 'MatlabVariableNode']]);
    expect(ws.children[0].displayValue).toBe('5');
  });
});

describe('ModelNode — config section', () => {
  it('builds a ConfigSetNode or a ConfigSetRefNode from the parsed class', () => {
    const cfg = model({
      configSets: [
        { name: 'Active', active: true, data: {} },
        { name: 'Ref', active: false, data: { _object_class: 'Simulink.ConfigSetRef' } },
      ],
    }).getSection('config');
    expect(cfg.children.map((c: any) => [c.name, c.constructor.name, c.className])).toEqual([
      ['Active', 'ConfigSetNode', 'Simulink.ConfigSet'],
      ['Ref', 'ConfigSetRefNode', 'Simulink.ConfigSetRef'],
    ]);
  });

  it('carries the SLX-only active state onto the shared node', () => {
    const cfg = model({
      configSets: [
        { name: 'Active', active: true, data: {} },
        { name: 'Idle', active: false, data: {} },
      ],
    }).getSection('config');
    expect(cfg.children.map((c: any) => [c.active, c.icon])).toEqual([
      [true, 'check_settings'],
      [false, 'settings'],
    ]);
  });
});

describe('ModelReferenceNode', () => {
  it('appends .slx to a bare model name but leaves an explicit one alone', () => {
    const refs = model({
      modelReferences: [
        { blockPath: 'ctrl/plant', modelName: 'plant' },
        { blockPath: 'ctrl/inner', modelName: 'inner.slx' },
      ],
    }).getSection('references');
    expect(refs.children.map((c: any) => c.name)).toEqual(['plant.slx', 'inner.slx']);
  });

  it('shows the block path as a link to the referenced model', () => {
    // Clicking the Value cell should open the referenced .slx, not the block.
    const ref = model({ modelReferences: [{ blockPath: 'ctrl/plant', modelName: 'plant' }] }).getSection('references')
      .children[0];
    expect(ref.displayValue).toBe('ctrl/plant');
    expect(ref.toRow().Value).toEqual({ text: 'ctrl/plant', linkTarget: 'plant.slx' });
  });

  it('is a non-renamable entry with the model-reference icon', () => {
    const ref = model({ modelReferences: [{ blockPath: 'a/b', modelName: 'p' }] }).getSection('references').children[0];
    expect(ref.isEntry).toBe(true);
    expect(ref.icon).toBe('modelReference');
    expect(ref.nameEditable).toBe(false);
    expect(ref.valueEditable).toBe(false);
    expect(ref.className).toBe('Model Reference');
  });

  it('reports Not Loaded until the reference is resolved', () => {
    const ref = model({ modelReferences: [{ blockPath: 'a/b', modelName: 'p' }] }).getSection('references').children[0];
    expect(ref.getProperties().map((p: any) => p.key)).toEqual(['Name', 'BlockPath', 'Status']);
    expect(ref.resolved).toBe(false);
    const props = ref.toPIObject().objects[0];
    expect(props.Status).toBe('Not Loaded');
    expect(props.BlockPath).toBe('a/b');
  });
});

describe('DataSourceNode', () => {
  it('lists the linked dictionary first, then the declared external sources', () => {
    const ds = model({
      dataDictionary: 'params.sldd',
      externalDataSources: ['sub/dir/signals.mat', 'other.slx'],
    }).getSection('dataSources');
    expect(ds.children.map((c: any) => c.name)).toEqual(['params.sldd', 'signals.mat', 'other.slx']);
  });

  it('picks the icon and class from the file extension', () => {
    const ds = model({
      externalDataSources: ['a.sldd', 'b.slx', 'c.mat', 'd.txt'],
    }).getSection('dataSources');
    expect(ds.children.map((c: any) => [c.icon, c.className])).toEqual([
      ['simulinkDataDictionary_FT', 'Data Dictionary'],
      ['simulinkModel_FT', 'Simulink Model'],
      ['matlabWorkspaceFile', 'MAT File'],
      // An unrecognised extension falls back to the MAT-file presentation.
      ['matlabWorkspaceFile', 'MAT File'],
    ]);
  });

  it('shows the full path but links by filename', () => {
    // The name is what the host resolves against the workspace, so a nested
    // source must link by basename even though the cell shows its whole path.
    const ds = model({ externalDataSources: ['sub/dir/signals.mat'] }).getSection('dataSources').children[0];
    expect(ds.name).toBe('signals.mat');
    expect(ds.fullPath).toBe('sub/dir/signals.mat');
    expect(ds.toRow().Value).toEqual({ text: 'sub/dir/signals.mat', linkTarget: 'signals.mat' });
  });

  it('is a non-renamable entry reporting Not Loaded', () => {
    const ds = model({ externalDataSources: ['signals.mat'] }).getSection('dataSources').children[0];
    expect(ds.isEntry).toBe(true);
    expect(ds.nameEditable).toBe(false);
    expect(ds.valueEditable).toBe(false);
    expect(ds.getProperties().map((p: any) => p.key)).toEqual(['Name', 'Path', 'Status']);
    const props = ds.toPIObject().objects[0];
    expect(props.Path).toBe('signals.mat');
    expect(props.Status).toBe('Not Loaded');
  });
});

describe('ModelBlockNode', () => {
  const GAIN_TWICE =
    `<Block BlockType="Gain" Name="G1"><P Name="Gain">Kp</P></Block>` +
    `<Block BlockType="Gain" Name="G1"><P Name="Gain">Ki</P></Block>`;

  it('groups every usage of one block into a single entry', () => {
    // The parser emits one usage per referenced parameter; the table shows one
    // row per block, with its parameters collapsed into the Uses column.
    const blocks = blockModel(GAIN_TWICE).getSection('blocks');
    expect(blocks.children.length).toBe(1);
    const blk = blocks.children[0];
    expect(blk.name).toBe('G1');
    expect(blk.blockType).toBe('Gain');
    expect(blk.paramUsages).toEqual([
      { property: 'Gain', value: 'Kp' },
      { property: 'Gain', value: 'Ki' },
    ]);
  });

  it('shows the block type as the Value and its parameters as the Uses text', () => {
    const row = blockModel(GAIN_TWICE).getSection('blocks').children[0].toRow();
    expect(row.Value).toBe('Gain');
    expect(row.DataType).toBe('Gain=Kp, Gain=Ki');
    expect(row._valueEditable).toBe(false);
    expect(row.Name).toMatchObject({ label: 'G1', iconId: 'block', editable: false });
  });

  it('links the Uses cell to the first parameter in the linked dictionary', () => {
    const row = blockModel(GAIN_TWICE, 'params.sldd').getSection('blocks').children[0].toRow();
    expect(row.DataType).toEqual({ text: 'Gain=Kp, Gain=Ki', linkTarget: 'Kp@params.sldd' });
  });

  it('leaves the Uses cell as plain text when the model has no dictionary', () => {
    // With no parameter source there is nothing to open, so the cell must not
    // render as a link the user can click into nowhere.
    expect(blockModel(GAIN_TWICE).getSection('blocks').children[0].toRow().DataType).toBe('Gain=Kp, Gain=Ki');
  });

  it('carries the owning model as the graph target', () => {
    // The Usage graph resolves a block back to the model that declares it.
    expect(blockModel(GAIN_TWICE).getSection('blocks').children[0].toRow()._graphTarget).toBe('m.slx');
  });

  it('displayName returns the block name (used by the tree label)', () => {
    const blk = blockModel(GAIN_TWICE).getSection('blocks').children[0];
    expect(blk.displayName).toBe('G1');
  });

  it('is a non-editable entry offering only Name in the inspector', () => {
    const blk = blockModel(GAIN_TWICE).getSection('blocks').children[0];
    expect(blk.isEntry).toBe(true);
    expect(blk.nameEditable).toBe(false);
    expect(blk.valueEditable).toBe(false);
    expect(blk.getProperties().map((p: any) => p.key)).toEqual(['Name']);
    expect(blk.getPILayout().map((g: any) => g.group)).toEqual(['General']);
  });
});

describe('ModelNode.serialize', () => {
  it('summarises the model when the archive was not retained', () => {
    // The parsed-only path (no zip entries) cannot rewrite the file, so
    // serialize is a human-readable summary rather than a save payload.
    const m = model({
      dataDictionary: 'params.sldd',
      modelReferences: [{ blockPath: 'a/b', modelName: 'plant' }],
      externalDataSources: ['signals.mat'],
      configSets: [{ name: 'Active', active: true, data: {} }],
      rawContents: { 'simulink/blockDiagram.json': '{}' },
    });
    expect(m.serialize()).toEqual({
      model: 'm.slx',
      release: 'R2026b',
      uuid: 'u1',
      dataDictionary: 'params.sldd',
      modelReferences: ['plant.slx'],
      externalDataSources: ['params.sldd', 'signals.mat'],
      configSets: ['Active'],
      workspace: '... (1 entries)',
      archiveFiles: ['simulink/blockDiagram.json'],
    });
  });

  it('reports no dictionary and no archive files when there are none', () => {
    expect(model().serialize()).toMatchObject({ dataDictionary: '(none)', archiveFiles: [] });
  });

  it('returns the archive entries when the model was loaded from bytes', () => {
    const zipEntries = { 'simulink/blockDiagram.json': new Uint8Array([1, 2]) };
    const out = model({ zipEntries }).serialize() as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['simulink/blockDiagram.json']);
    // A copy, so a caller mutating the save payload cannot corrupt the loaded model.
    expect(out).not.toBe(zipEntries);
  });

  it('folds an edited workspace variable back into the parsed variable list', () => {
    // The .mxarray is re-serialized from `_workspaceVars` on save, so an edit made
    // on the node has to be copied back or it is silently dropped.
    const parsed = parsedSlx({ zipEntries: { 'simulink/modelWorkspace.mxarray': new Uint8Array([1]) } });
    const m = ModelNode.fromParsed(parsed, 'm.slx') as any;
    m.getSection('workspace').children[0].setProperty('Value', '7');

    m.serialize();
    expect(parsed.workspace[0]).toMatchObject({ name: 'Kp', value: 7, _modified: true });
  });

  it('leaves untouched workspace variables alone', () => {
    const parsed = parsedSlx({ zipEntries: { 'simulink/modelWorkspace.mxarray': new Uint8Array([1]) } });
    (ModelNode.fromParsed(parsed, 'm.slx') as any).serialize();
    expect(parsed.workspace[0].value).toBe(5);
    expect(parsed.workspace[0]._modified).toBeUndefined();
  });
});
