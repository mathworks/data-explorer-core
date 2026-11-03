// Copyright 2026 The MathWorks, Inc.
// A `.slx`'s Model Workspace is a MAT-file's editor over its part (ModelWorkspaceNode): it shows
// what the section it replaces showed, value for value, under the same ids, and takes the edits a
// MAT-file takes, where the model keeps its workspace. Where the model makes its workspace anew
// from another source as it opens, it takes none, saying why. A workspace that is no MAT-file's
// (a `.mdl`'s, or one whose part does not convert) is the section it was, and takes no edit.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { parseSlx } from '../src/datamodel/parser/SlxParser.js';
import { parseMdl } from '../src/datamodel/parser/MdlParser.js';
import ModelNode from '../src/datamodel/node/container/ModelNode.js';
import ModelSectionNode from '../src/datamodel/node/container/ModelSectionNode.js';
import ModelWorkspaceNode from '../src/datamodel/node/container/ModelWorkspaceNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const TEST = fileURLToPath(new URL('.', import.meta.url));
const bufferOf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const fileBuffer = (rel: string) => bufferOf(new Uint8Array(readFileSync(join(TEST, rel))));

function slxCorpus(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== 'node_modules') walk(path);
      } else if (name.endsWith('.slx')) out.push(path.slice(TEST.length));
    }
  };
  walk(TEST);
  return out.sort();
}

// What a node shows, at every depth: its name, its value, its classes, and its children's, with
// nothing of what takes an edit (which is the venue's).
function shown(node: any): unknown {
  return {
    name: node.displayName,
    value: node.displayValue,
    className: node.className,
    dataType: node.dataType,
    children: (node.children ?? []).map(shown),
  };
}

describe.each(slxCorpus())('%s', (file) => {
  const parsed = () => parseSlx(fileBuffer(file), file);

  it('shows what the section of what was read shows, under the same ids, warning the same', () => {
    const fromParts = parsed();
    const model = ModelNode.fromParsed(fromParts, file);
    // The section, as a host's parse that holds no parts builds it.
    const read = parsed();
    const section = ModelNode.fromParsed({ ...read, zipEntries: null }, file);
    const workspace = model.getSection('workspace')!;
    const before = section.getSection('workspace')!;
    expect(workspace).toBeInstanceOf(ModelWorkspaceNode);
    expect(before).toBeInstanceOf(ModelSectionNode);
    expect(shown(workspace)).toEqual(shown(before));
    expect(workspace.flatten().map((n) => n.id)).toEqual(before.flatten().map((n) => n.id));
    expect(fromParts.warnings).toEqual(read.warnings);
  });
});

describe('where its variables come from decides whether it takes an edit', () => {
  const truth = JSON.parse(readFileSync(join(TEST, 'fixtures/workspace-facts/truth.json'), 'utf8')) as {
    models: { file: string; source: string }[];
  };
  for (const { file, source } of truth.models) {
    it(`${file}: ${source}`, () => {
      const model = ModelNode.fromParsed(parseSlx(fileBuffer('fixtures/workspace-facts/' + file), file), file);
      const workspace = model.getSection('workspace') as ModelWorkspaceNode;
      expect(workspace).toBeInstanceOf(ModelWorkspaceNode);
      if (source === 'Model File') {
        expect(workspace.readOnly).toBe(false);
        expect(workspace._fileRefusal()).toBeNull();
      } else {
        expect(workspace.readOnly).toBe(true);
        expect(workspace._fileRefusal()).toMatch(new RegExp('^Cannot edit "' + file.replace('.', '\\.') + '": its Model Workspace (is loaded from the MAT-file|is made by running) .*, so an edit of it here would not be kept\\.$'));
      }
    });
  }

  it('a MAT-file source names the MAT-file, which a host edits as one of its own', () => {
    const model = ModelNode.fromParsed(parseSlx(fileBuffer('fixtures/workspace-facts/wsf_matfile.slx'), 'wsf_matfile.slx'), 'wsf_matfile.slx');
    expect((model.getSection('workspace') as ModelWorkspaceNode)._fileRefusal()).toBe(
      'Cannot edit "wsf_matfile.slx": its Model Workspace is loaded from the MAT-file "wsf_init.mat" each time the model opens, so an edit of it here would not be kept.',
    );
  });

  it("the session refuses an Add into such a workspace, in the workspace's words", () => {
    const s = createSession();
    const model: any = s.addModelSource('wsf_mcode.slx', fileBuffer('fixtures/workspace-facts/wsf_mcode.slx'));
    s.setActiveContext(model);
    expect(s.addEntry('workspace', '', 'k2')).toBeNull();
    expect(s.addEntryRefusal()).toMatch(/its Model Workspace is made by running MATLAB code kept in the model each time the model opens/);
    expect(model.dirty).toBe(false);
  });
});

describe('the parts each layout keeps it in', () => {
  it('before R2019b, a whole MAT-file, edited as one', () => {
    for (const file of ['parity/artifacts/slx_layouts/slxcases_R2018a.slx', 'fixtures/workspace-facts/wsf_plainarg_R2018a.slx']) {
      const model = ModelNode.fromParsed(parseSlx(fileBuffer(file), file), file);
      const workspace = model.getSection('workspace') as ModelWorkspaceNode;
      expect(workspace, file).toBeInstanceOf(ModelWorkspaceNode);
      expect(workspace._part).toBe('simulink/modelworkspace.mat');
      expect(workspace._streamRead).toBeNull();
      expect(workspace.readOnly, file).toBe(false);
    }
  });

  it('from R2019b, the stream, converted', () => {
    const file = 'parity/artifacts/slx_layouts/slxcases_R2021a.slx';
    const workspace = ModelNode.fromParsed(parseSlx(fileBuffer(file), file), file).getSection('workspace') as ModelWorkspaceNode;
    expect(workspace._part).toBe('simulink/modelWorkspace.mxarray');
    expect(workspace._streamRead?.names).toEqual(workspace.children.map((c) => c.name));
  });

  it('none, for a model that keeps no variables: an empty workspace that takes one', () => {
    const file = 'parity/artifacts/slx_layouts/slxcfgref.slx';
    const s = createSession();
    const model: any = s.addModelSource('slxcfgref.slx', fileBuffer(file));
    const workspace = model.getSection('workspace') as ModelWorkspaceNode;
    expect([workspace._part, workspace.children.length, workspace.readOnly]).toEqual([null, 0, false]);
    s.setActiveContext(model);
    expect((s.addEntry('workspace', '', 'k') as any)?.name).toBe('k');
    expect(model.dirty).toBe(true);
    model.dirty = false;
    expect([model.dirty, workspace.dirty]).toEqual([false, false]);
  });
});

describe('a package MATLAB would not open as one takes no edit of its workspace', () => {
  it('model_with_refs.slx, made by hand, which names none of its parts', () => {
    const model = ModelNode.fromParsed(parseSlx(fileBuffer('fixtures/model_with_refs.slx'), 'model_with_refs.slx'), 'model_with_refs.slx');
    expect(model.readOnly).toBe(true);
    expect((model.getSection('workspace') as ModelWorkspaceNode)._fileRefusal()).toBe(
      'Cannot edit "model_with_refs.slx": it holds no "[Content_Types].xml", which a package names its parts in.',
    );
  });
});

describe('a workspace that is no MAT-file is the section it was, and takes no edit', () => {
  it("a classic .mdl's", () => {
    const model = ModelNode.fromParsed(parseMdl(fileBuffer('parity/artifacts/mdl/mdlcases_R2011b.mdl'), 'mdlcases_R2011b.mdl'), 'mdlcases_R2011b.mdl');
    const workspace = model.getSection('workspace')!;
    expect(workspace).toBeInstanceOf(ModelSectionNode);
    expect(workspace.children.length).toBeGreaterThan(0);
    expect(workspace.children.every((c) => !c.valueEditable && !c.nameEditable)).toBe(true);
  });

  it("a text package .mdl's, whose workspace is JSON", () => {
    const file = 'parity/artifacts/mdltext/mdltext.mdl';
    const model = ModelNode.fromParsed(parseMdl(fileBuffer(file), 'mdltext.mdl'), 'mdltext.mdl');
    const workspace = model.getSection('workspace')!;
    expect(workspace).toBeInstanceOf(ModelSectionNode);
    expect(workspace.children.every((c) => !c.valueEditable)).toBe(true);
  });

  it('a part that does not convert into a MAT-file exactly', () => {
    const file = 'parity/artifacts/slx/cases.slx';
    const parsed = parseSlx(fileBuffer(file), file);
    const part = parsed.zipEntries!['simulink/modelWorkspace.mxarray'].slice();
    part[2] = 0x4d; // not MATLAB's preamble
    parsed.zipEntries!['simulink/modelWorkspace.mxarray'] = part;
    const model = ModelNode.fromParsed(parsed, file);
    const workspace = model.getSection('workspace')!;
    expect(workspace).toBeInstanceOf(ModelSectionNode);
    expect(workspace.children.length).toBe(parsed.workspace.length);
    const s = createSession();
    s.addParsedSource('cases.slx', model as any);
    const node = workspace.children.find((c) => c.name === 'scalarD')!;
    s.setActive(model as any, node as any);
    expect((s.editProperty(node.id, 'Value', '7') as any).reason).toBe(
      'Cannot edit "scalarD": it is in the Model Workspace section of "parity/artifacts/slx/cases.slx", which this editor shows but does not edit.',
    );
  });
});
