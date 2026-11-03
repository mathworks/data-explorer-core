// Copyright 2026 The MathWorks, Inc.
// A `.slx` is saved as its package was read, every member's bytes, order, time stamp and
// compression as read, with its Model Workspace's member written anew where the workspace was
// edited: what its MAT-file's save writes, converted back into the part (R2019b on), or the
// MAT-file itself (before). Its first variable adds the part and the two parts that name it, as
// MATLAB's save does, and its last deleted takes them away. A model whose package cannot be put
// back together, or whose workspace is made anew from another source as it opens, takes no edit
// of its workspace, and says why. What MATLAB loads of each save is test/parity/matlab/
// probe_model_workspace_save.m's to say.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { parseSlx } from '../src/datamodel/parser/SlxParser.js';
import { zipMemberStamps } from '../src/datamodel/parser/Inflate.js';
import { decodeMatStream } from '../src/datamodel/parser/MatParser.js';
import ModelNode from '../src/datamodel/node/container/ModelNode.js';
import ModelWorkspaceNode from '../src/datamodel/node/container/ModelWorkspaceNode.js';

const TEST = fileURLToPath(new URL('.', import.meta.url));
const PART = 'simulink/modelWorkspace.mxarray';
const MAT_PART = 'simulink/modelworkspace.mat';
const bufferOf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const fileBytes = (rel: string) => new Uint8Array(readFileSync(join(TEST, rel)));
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

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

// A session holding the model at `rel`, as a host opens one.
function opened(rel: string) {
  const s = createSession();
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  const model: any = s.addModelSource(name, bufferOf(fileBytes(rel)));
  s.setActiveContext(model);
  const workspace = model.getSection('workspace') as ModelWorkspaceNode;
  const variable = (n: string): any => workspace.children.find((c) => c.name === n);
  const save = (): Uint8Array => (s.serializeSource(name) as { bytes: Uint8Array }).bytes;
  const edit = (node: any, key: string, value: string) => {
    s.setActive(model, node);
    return s.editProperty(node.id, key, value);
  };
  return { s, model, workspace, variable, save, edit, name };
}

// The variables of the workspace part of `slx`, by name, as the stream or the MAT-file holds them.
function workspaceOf(slx: Uint8Array): Record<string, any> {
  const parsed = parseSlx(bufferOf(slx), 'saved.slx');
  return Object.fromEntries(parsed.workspace.map((v) => [v.name, v]));
}

describe.each(slxCorpus())('%s, saved unedited', (rel) => {
  // Which models take no edit of their workspace, told apart from what the files hold: a package
  // made by hand that names none of its parts (no [Content_Types].xml), and a workspace made anew
  // from another source each time the model opens.
  const read = fileBytes(rel);
  const named = Object.prototype.hasOwnProperty.call(unzipSync(read), '[Content_Types].xml');
  const kept = parseSlx(bufferOf(read), rel).workspaceSource === 'Model File';

  it(named && kept ? 'takes an edit of its workspace' : 'takes no edit of its workspace, saying why', () => {
    const { model, workspace } = opened(rel);
    expect(model.readOnly).toBe(!(named && kept));
    expect(workspace._fileRefusal()).toEqual(named && kept ? null : expect.stringMatching(named ? /each time the model opens/ : /names its parts in/));
  });

  it(named ? 'holds every member as read: its bytes, its order, its time stamp and its compression' : 'is refused, a package that names none of its parts', () => {
    const { save, s, name } = opened(rel);
    if (!named) {
      expect(() => s.serializeSource(name)).toThrow(/holds no "\[Content_Types\]\.xml"/);
      return;
    }
    const written = save();
    const before = unzipSync(read);
    const after = unzipSync(written);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const name of Object.keys(before)) expect(same(after[name], before[name]), name).toBe(true);
    const stamp = (b: Uint8Array) => zipMemberStamps(b)!.map((m) => [m.name, m.dosTime, m.dosDate, m.method]);
    expect(stamp(written)).toEqual(stamp(read));
  });
});

describe('an edit is written into the workspace part, and every other member is as read', () => {
  const layouts = [
    ['R2027a, a stream', 'parity/artifacts/slx_layouts/slxcases.slx', PART],
    ['R2021a, a stream', 'parity/artifacts/slx_layouts/slxcases_R2021a.slx', PART],
    ['R2018a, a MAT-file', 'parity/artifacts/slx_layouts/slxcases_R2018a.slx', MAT_PART],
  ] as const;

  for (const [label, rel, part] of layouts) {
    it(`${label}: a value typed in`, () => {
      const { variable, edit, save } = opened(rel);
      expect(edit(variable('tau'), 'Value', '0.5')).toBe(true);
      const written = save();
      expect(workspaceOf(written).tau.value).toBe(0.5);
      const before = unzipSync(fileBytes(rel));
      const after = unzipSync(written);
      expect(Object.keys(after)).toEqual(Object.keys(before));
      for (const name of Object.keys(before)) {
        expect(same(after[name], before[name]), name).toBe(name !== part);
      }
    });

    it(`${label}: a rename, an added variable and a deleted one, the variables in MATLAB's order`, () => {
      const { s, variable, edit, save, workspace } = opened(rel);
      expect(edit(variable('span'), 'Name', 'Zspan')).toBe(true);
      expect((s.addEntry('workspace', '', 'added') as any)?.name).toBe('added');
      expect(s.deleteNodeById(variable('flag').id)).toBe(true);
      const ws = workspaceOf(save());
      const names = workspace.children.map((c) => c.name);
      expect(Object.keys(ws).sort()).toEqual([...names].sort());
      expect(Object.keys(ws)).not.toContain('flag');
      if (part === PART) {
        // By their characters' codes, as MATLAB's save writes them: Zspan before the lowercase.
        expect(Object.keys(ws)).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
      }
    });
  }

  it("an object's property, into its cell of the subsystem", () => {
    const { variable, edit, save } = opened('fixtures/mcos/mcosfix.slx');
    const param = variable('Param');
    expect(edit(param, 'Description', 'edited here')).toBe(true);
    const again: any = new ModelNode('again.slx');
    void again;
    const reopened = ModelNode.fromParsed(parseSlx(bufferOf(save()), 'mcosfix.slx'), 'mcosfix.slx');
    expect((reopened.getSection('workspace')!.children.find((c) => c.name === 'Param') as any).Description).toBe('edited here');
  });

  it('an edit undone saves the part as it was read', () => {
    const rel = 'parity/artifacts/slx/cases.slx';
    const { s, variable, edit, save } = opened(rel);
    expect(edit(variable('scalarD'), 'Value', '42')).toBe(true);
    s.undo();
    expect(same(unzipSync(save())[PART], unzipSync(fileBytes(rel))[PART])).toBe(true);
  });

  it('saved twice, with an edit between: the second save holds both', () => {
    const { variable, edit, save } = opened('parity/artifacts/slx/cases.slx');
    expect(edit(variable('scalarD'), 'Value', '42')).toBe(true);
    save();
    expect(edit(variable('negD'), 'Value', '-7')).toBe(true);
    const ws = workspaceOf(save());
    expect([ws.scalarD.value, ws.negD.value]).toEqual([42, -7]);
  });
});

describe("the workspace's first variable and its last", () => {
  it.each([
    ['R2027a', 'parity/artifacts/slx_layouts/slxcfgref.slx', PART, 'mxarray'],
    ['R2021a', 'parity/artifacts/slx_layouts/slxcfgref_R2021a.slx', PART, 'mxarray'],
    ['R2018a', 'parity/artifacts/slx_layouts/slxcfgref_R2018a.slx', MAT_PART, 'mat'],
  ])('%s: the first adds the part, a Default of its extension and a modelWorkspace Relationship, each in its order', (_era, rel, part, extension) => {
    const before = unzipSync(fileBytes(rel));
    expect(before[part]).toBeUndefined();
    const { s, save } = opened(rel);
    expect((s.addEntry('workspace', '', 'k') as any)?.name).toBe('k');
    const after = unzipSync(save());
    expect(Object.keys(after).sort()).toEqual([...Object.keys(before), part].sort());
    expect(Object.keys(workspaceOf(save()))).toEqual(['k']);
    const types = text(after['[Content_Types].xml']);
    expect(types).toContain(
      `<Default ContentType="application/vnd.mathworks.matlab.${extension}+binary" Extension="${extension}"/>`,
    );
    const extensions = [...types.matchAll(/<Default\b[^>]*Extension="([^"]*)"/g)].map((m) => m[1]);
    expect(extensions).toEqual([...extensions].sort());
    const rels = text(after['_rels/.rels']);
    expect(rels).toContain(
      `<Relationship Id="modelWorkspace" Target="${part}" Type="http://schemas.mathworks.com/simulinkModel/2010/relationships/modelWorkspaceData"/>`,
    );
    const ids = [...rels.matchAll(/<Relationship\b[^>]*Id="([^"]*)"/g)].map((m) => m[1]);
    expect(ids).toEqual([...ids].sort());
    // Every line indented as the others are.
    expect(rels.split('\n').filter((l) => l.includes('<Relationship ')).every((l) => l.startsWith('  <'))).toBe(true);
    for (const name of Object.keys(before).filter((n) => n !== '[Content_Types].xml' && n !== '_rels/.rels')) {
      expect(same(after[name], before[name]), name).toBe(true);
    }
  });

  it('the last deleted takes all three away, and the package is as it was before the first', () => {
    const rel = 'parity/artifacts/slx_layouts/slxcfgref.slx';
    const original = unzipSync(fileBytes(rel));
    const { s, save, name } = opened(rel);
    s.addEntry('workspace', '', 'k');
    const once = save();
    const t = createSession();
    const model: any = t.addModelSource(name, bufferOf(once));
    t.setActiveContext(model);
    const k = model.getSection('workspace').children[0];
    expect(t.deleteNodeById(k.id)).toBe(true);
    const emptied = unzipSync((t.serializeSource(name) as { bytes: Uint8Array }).bytes);
    expect(Object.keys(emptied).sort()).toEqual(Object.keys(original).sort());
    for (const n of Object.keys(original)) expect(same(emptied[n], original[n]), n).toBe(true);
  });

  it('before R2019b the part is a MAT-file, as MATLAB writes one', () => {
    const rel = 'fixtures/workspace-facts/wsf_plainarg_R2018a.slx';
    const { s, variable, save } = opened(rel);
    for (const n of ['gain', 'k']) expect(s.deleteNodeById(variable(n).id)).toBe(true);
    const after = unzipSync(save());
    expect(after[MAT_PART]).toBeUndefined();
    expect(text(after['_rels/.rels'])).not.toContain('modelWorkspace');
    expect(text(after['[Content_Types].xml'])).not.toContain('Extension="mat"');
  });
});

describe('a model that takes no edit of its workspace says why, and its save writes no change', () => {
  it('a workspace made anew from a MAT-file each time the model opens', () => {
    const rel = 'fixtures/workspace-facts/wsf_matfile.slx';
    const { s, model, save } = opened(rel);
    expect(model.readOnly).toBe(true);
    expect(s.addEntry('workspace', '', 'k')).toBeNull();
    const read = unzipSync(fileBytes(rel));
    const written = unzipSync(save());
    for (const n of Object.keys(read)) expect(same(written[n], read[n]), n).toBe(true);
  });

  it('a package opened from a parse handed over without the list of its parts', () => {
    const rel = 'parity/artifacts/slx/cases.slx';
    const parsed = parseSlx(bufferOf(fileBytes(rel)), 'cases.slx');
    // A parse that crossed a worker boundary: its parts are copied, the list kept beside them is not.
    const copied = { ...parsed, zipEntries: { ...parsed.zipEntries! } };
    const s = createSession();
    const model: any = s.addModelSourceParsed('cases.slx', copied);
    expect(model.readOnly).toBe(true);
    const node = model.getSection('workspace').children.find((c: any) => c.name === 'scalarD');
    s.setActive(model, node);
    expect((s.editProperty(node.id, 'Value', '7') as any).reason).toBe(
      'Cannot edit "cases.slx": it was opened without the list of its parts a save puts the package back together by.',
    );
    expect(() => s.serializeSource('cases.slx')).toThrow(/Cannot save "cases\.slx": it was opened without the list of its parts/);
  });

  it('a package with a part that could not be read', () => {
    const rel = 'parity/artifacts/slx/cases.slx';
    const parsed = parseSlx(bufferOf(fileBytes(rel)), 'cases.slx');
    delete parsed.zipEntries!['simulink/hdlParams.xml'];
    const model = ModelNode.fromParsed(parsed, 'cases.slx');
    const workspace = model.getSection('workspace') as ModelWorkspaceNode;
    expect(workspace._fileRefusal()).toBe('Cannot edit "cases.slx": its part "simulink/hdlParams.xml" could not be read, so a save would lose it.');
  });

  it('a .mdl, whose workspace is the section of what was read, answers no save', () => {
    const s = createSession();
    const b = fileBytes('fixtures/model_with_refs.mdl');
    const model: any = s.addModelSource('model_with_refs.mdl', bufferOf(b));
    expect(model.readOnly).toBe(true);
    expect(s.serializeSource('model_with_refs.mdl')).toBeNull();
  });
});

describe('a save it refuses throws, naming the model, and changes nothing', () => {
  it("a value the workspace's MAT-file save would not write", () => {
    const { s, variable, workspace, save } = opened('parity/artifacts/slx/cases.slx');
    // A value the MAT-file editor refuses to write fresh is refused as an edit too: its gate is the
    // save's. So the save of a workspace that took its edits writes.
    expect(workspace.readOnly).toBe(false);
    const node = variable('scalarD');
    s.setActive(s.getDataSource('cases.slx') as any, node);
    expect(s.editProperty(node.id, 'Value', '1')).toBe(true);
    const written = save();
    const decoded = decodeMatStream(unzipSync(written)[PART], { whole: true });
    expect(decoded.ok).toBe(true);
  });
});
