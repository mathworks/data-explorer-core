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
  // The class comes from `objectClass`, which the parser has already normalized across
  // the five .slx layouts and the classic .mdl grammar — the node layer does not sniff
  // the raw `data` for it. See configSetIdentity in SlxParser and its tests.
  it('builds a ConfigSetNode or a ConfigSetRefNode from the parsed class', () => {
    const cfg = model({
      configSets: [
        { name: 'Active', active: true, data: {}, objectClass: 'Simulink.ConfigSet', sourceName: '' },
        {
          name: 'Ref',
          active: false,
          data: {},
          objectClass: 'Simulink.ConfigSetRef',
          sourceName: 'fromDict',
        },
      ],
    }).getSection('config');
    expect(cfg.children.map((c: any) => [c.name, c.constructor.name, c.className])).toEqual([
      ['Active', 'ConfigSetNode', 'Simulink.ConfigSet'],
      ['Ref', 'ConfigSetRefNode', 'Simulink.ConfigSetRef'],
    ]);
    // A reference's content IS what it points at, so the source has to reach the node.
    expect(cfg.children[1].SourceName).toBe('fromDict');
  });

  it('carries the SLX-only active state onto the shared node', () => {
    const cfg = model({
      configSets: [
        { name: 'Active', active: true, data: {}, objectClass: 'Simulink.ConfigSet', sourceName: '' },
        { name: 'Idle', active: false, data: {}, objectClass: 'Simulink.ConfigSet', sourceName: '' },
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
  // ONE block with two referencing parameters — which is what a real file holds. The
  // parser emits one usage per parameter and the node layer folds them back together;
  // two `<Block>` elements sharing a name would be a file Simulink cannot write, since
  // a name is unique within its system.
  const TWO_PARAMS =
    `<Block BlockType="Gain" Name="G1" SID="1"><P Name="Gain">Kp</P><P Name="SampleTime">Ts</P></Block>`;

  it('groups every usage of one block into a single entry', () => {
    // The parser emits one usage per referenced parameter; the table shows one
    // row per block, with its parameters collapsed into the Uses column.
    const blocks = blockModel(TWO_PARAMS).getSection('blocks');
    expect(blocks.children.length).toBe(1);
    const blk = blocks.children[0];
    expect(blk.name).toBe('G1');
    expect(blk.blockType).toBe('Gain');
    expect(blk.paramUsages).toEqual([
      { property: 'Gain', value: 'Kp' },
      { property: 'SampleTime', value: 'Ts' },
    ]);
  });

  it('shows the block type as the Value and its parameters as the Uses text', () => {
    const row = blockModel(TWO_PARAMS).getSection('blocks').children[0].toRow();
    expect(row.Value).toBe('Gain');
    expect(row.DataType).toBe('Gain=Kp, SampleTime=Ts');
    expect(row._valueEditable).toBe(false);
    expect(row.Name).toMatchObject({ label: 'G1', iconId: 'block', editable: false });
  });

  it('links the Uses cell to the first parameter in the linked dictionary', () => {
    const row = blockModel(TWO_PARAMS, 'params.sldd').getSection('blocks').children[0].toRow();
    expect(row.DataType).toEqual({ text: 'Gain=Kp, SampleTime=Ts', linkTarget: 'Kp@params.sldd' });
  });

  it('leaves the Uses cell as plain text when the model has no dictionary', () => {
    // With no parameter source there is nothing to open, so the cell must not
    // render as a link the user can click into nowhere.
    expect(blockModel(TWO_PARAMS).getSection('blocks').children[0].toRow().DataType).toBe('Gain=Kp, SampleTime=Ts');
  });

  it('carries the owning model as the graph target', () => {
    // The Usage graph resolves a block back to the model that declares it.
    expect(blockModel(TWO_PARAMS).getSection('blocks').children[0].toRow()._graphTarget).toBe('m.slx');
  });

  it('displayName returns the block name (used by the tree label)', () => {
    const blk = blockModel(TWO_PARAMS).getSection('blocks').children[0];
    expect(blk.displayName).toBe('G1');
  });

  it('is a non-editable entry offering Name and Block Path in the inspector', () => {
    const blk = blockModel(TWO_PARAMS).getSection('blocks').children[0];
    expect(blk.isEntry).toBe(true);
    expect(blk.nameEditable).toBe(false);
    expect(blk.valueEditable).toBe(false);
    // The path is the second property because the name alone does not say WHICH block
    // this is — a model may hold four called `Gain`. See blockIdentity.
    expect(blk.getProperties().map((p: any) => p.key)).toEqual(['Name', 'BlockPath']);
    expect(blk.getPILayout().map((g: any) => g.group)).toEqual(['General']);
  });
});

// The SID is the identity and the name is only a label — blockIdentity's two rules,
// measured on the file shapes that forced them. f14.slx (a shipped Simulink demo) is
// where both were found: it holds four blocks named `Gain`, and one Constant whose
// recorded name is a bare line break.
describe('ModelBlockNode — identity is the SID, the name is a label', () => {
  it('gives same-named blocks in different systems a row each', () => {
    // f14.slx's shape: `Gain` appears in several subsystems, each with its own gain.
    // Keyed by name, the four arrived as ONE row reading `Gain=Mq, Gain=Zw, ...` —
    // four blocks' parameters under one name, and three blocks the host could not
    // reach at all because they shared an id.
    const blocks = blockModel(
      `<Block BlockType="Gain" Name="Gain" SID="15"><P Name="Gain">Mq</P></Block>` +
        `<Block BlockType="Gain" Name="Gain" SID="24"><P Name="Gain">Zw</P></Block>`,
    ).getSection('blocks');
    expect(blocks.children.length).toBe(2);
    expect(blocks.children.map((c: any) => c.id)).toEqual(['m.slx/blocks/15', 'm.slx/blocks/24']);
    // Each keeps its own parameter, and both still read `Gain`.
    expect(blocks.children.map((c: any) => c.displayName)).toEqual(['Gain', 'Gain']);
    expect(blocks.children.map((c: any) => c.toRow().DataType)).toEqual(['Gain=Mq', 'Gain=Zw']);
    expect(blocks.children.map((c: any) => c.toRow()._blockKey)).toEqual(['15', '24']);
  });

  it('shows `<SID: 65>` for a block whose recorded name is blank', () => {
    // f14.slx records `Name="&#xA;"` on one Constant — a label the user cleared, which
    // normalizes to ''. The row still has to name something the user can act on, and
    // the SID is the one thing that file offers.
    const blk = blockModel(
      `<Block BlockType="Constant" Name="&#xA;" SID="65"><P Name="Value">Uo</P></Block>`,
    ).getSection('blocks').children[0];
    expect(blk.name).toBe('');
    expect(blk.displayName).toBe('<SID: 65>');
    expect(blk.toRow().Name.label).toBe('<SID: 65>');
    // And the id is the SID either way, so a blank name does not produce `.../blocks/`.
    expect(blk.id).toBe('m.slx/blocks/65');
  });

  it('falls back to the name when the file records no SID at all', () => {
    // A classic `.mdl` older than R2010b has no SIDs. The id is then the name, which is
    // the id such a file always had — and same-named blocks in it still merge, because
    // the file offers nothing to tell them apart.
    const blocks = blockModel(
      `<Block BlockType="Gain" Name="G1"><P Name="Gain">Kp</P></Block>` +
        `<Block BlockType="Gain" Name="G1"><P Name="Gain">Ki</P></Block>`,
    ).getSection('blocks');
    expect(blocks.children.length).toBe(1);
    expect(blocks.children[0].id).toBe('m.slx/blocks/G1');
    expect(blocks.children[0].toRow()._blockKey).toBe('G1');
    expect(blocks.children[0].displayName).toBe('G1');
  });

  it('reads as empty, not as `<SID: >`, when it has neither a name nor a SID', () => {
    // Nothing to show and nothing to key by. The label stays empty rather than
    // inventing a SID reference that points at no SID.
    const blk = blockModel(
      `<Block BlockType="Constant" Name="&#xA;"><P Name="Value">Uo</P></Block>`,
    ).getSection('blocks').children[0];
    expect(blk.displayName).toBe('');
    expect(blk.id).toBe('m.slx/blocks/');
  });
});

// The third rule: WHERE the block is. The SID makes each same-named block its own row,
// and this is what lets a person tell those rows apart — the identity is not something
// they can read, and four rows all saying `Gain` are four correct rows and one useless
// table.
describe('ModelBlockNode — the path says which block a row is', () => {
  // A subsystem holding a block, in the layout every release since R2020a writes: the
  // child system is its own part, linked by ref.
  const nestedModel = () =>
    ModelNode.fromParsed(
      parseSlx(
        (() => {
          const z = zipSync({
            'simulink/blockDiagram.json': strToU8(JSON.stringify({ BlockDiagram: { ModelUUID: 'u1' } })),
            'simulink/systems/system_root.xml': strToU8(
              `<?xml version="1.0"?><System>` +
                `<Block BlockType="Gain" Name="Gain" SID="15"><P Name="Gain">Mq</P></Block>` +
                `<Block BlockType="SubSystem" Name="Controller" SID="20"><System Ref="system_7"/></Block>` +
                `</System>`,
            ),
            'simulink/systems/system_7.xml': strToU8(
              `<?xml version="1.0"?><System>` +
                `<Block BlockType="Gain" Name="Gain" SID="24"><P Name="Gain">Zw</P></Block>` +
                `</System>`,
            ),
            'metadata/coreProperties.xml': strToU8(
              `<?xml version="1.0"?><coreProperties><version>R2026b</version></coreProperties>`,
            ),
          });
          return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer;
        })(),
        'm.slx',
      ),
      'm.slx',
    ) as any;

  it('gives each row the path its block sits at', () => {
    // Two rows both reading `Gain`, one in the root system and one in `Controller`. The
    // label is identical, the key is not, and the path is what says so on screen.
    const blocks = nestedModel().getSection('blocks').children;
    expect(blocks.map((c: any) => c.displayName)).toEqual(['Gain', 'Gain']);
    expect(blocks.map((c: any) => c.blockPath)).toEqual(['Gain', 'Controller/Gain']);
  });

  it('publishes the parent systems and the whole path as separate row fields', () => {
    // Two fields because they answer differently: a cell qualifying a name shows the
    // PARENT (`Gain (Controller)`), while the whole path is the address, and joining them
    // is an escaping rule (blockIdentity.joinBlockPath) no consumer should repeat.
    const rows = nestedModel().getSection('blocks').children.map((c: any) => c.toRow());
    expect(rows.map((r: any) => r._systemPath)).toEqual(['', 'Controller']);
    expect(rows.map((r: any) => r._blockPath)).toEqual(['Gain', 'Controller/Gain']);
  });

  it('answers the inspector with the path, through the prop a model reference already uses', () => {
    // PropBlockPath reads `node.blockPath`, which is the same question asked of a
    // different node — so the Property Inspector needed no new prop, and a block and a
    // model reference cannot disagree about what a block path is.
    const blk = nestedModel().getSection('blocks').children[1];
    expect(blk.toPIObject().objects[0].BlockPath).toBe('Controller/Gain');
  });

  it('is the label alone for a block in the root system', () => {
    const blk = blockModel(`<Block BlockType="Gain" Name="G" SID="1"><P Name="Gain">Kp</P></Block>`)
      .getSection('blocks').children[0];
    expect(blk.blockPath).toBe('G');
    expect(blk.toRow()._systemPath).toBe('');
  });

  it('uses the label, so a nameless block is placed by its SID stand-in', () => {
    // f14.slx's cleared-label Constant. Composed with the label rather than the raw name
    // so a path never ends in nothing — an empty last segment would read as the system
    // itself, not as a block in it.
    const blk = blockModel(`<Block BlockType="Constant" Name="&#xA;" SID="65"><P Name="Value">Uo</P></Block>`)
      .getSection('blocks').children[0];
    expect(blk.blockPath).toBe('<SID: 65>');
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
      configSets: [{ name: 'Active', active: true, data: {}, objectClass: 'Simulink.ConfigSet', sourceName: '' }],
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
