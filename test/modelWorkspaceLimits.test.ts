// Copyright 2026 The MathWorks, Inc.
// What a model workspace keeps of what a MAT-file holds (ModelWorkspaceNode, measured on R2027a by
// test/parity/matlab/probe_workspace_limits.m), each refused as the edit is offered, saying why,
// where a MAT-file takes it:
//   - no bus, alias type or enumeration definition is created or pasted: Simulink uses none from a
//     model workspace;
//   - a Signal keeps the storage class Auto alone, and a Parameter takes no custom storage class:
//     MATLAB sets each back as it opens the model;
//   - a model argument's variable is not renamed, deleted or typed over with a value of a kind an
//     argument cannot hold: MATLAB drops the argument as it opens the model;
//   - a variable a block of the model uses by name is not renamed or deleted.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

const TEST = fileURLToPath(new URL('.', import.meta.url));
const bufferOf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const fileBuffer = (rel: string) => bufferOf(new Uint8Array(readFileSync(join(TEST, rel))));

function opened(rel: string) {
  const s = createSession();
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  const model: any = name.endsWith('.mat') ? s.addMatSource(name, fileBuffer(rel)) : s.addModelSource(name, fileBuffer(rel));
  s.setActiveContext(model);
  const container: any = name.endsWith('.mat') ? model : model.getSection('workspace');
  const at = (path: string): any => {
    let node: any = container;
    for (const step of path.split('.')) node = node.children.find((c: any) => c.name === step);
    return node;
  };
  const edit = (node: any, key: string, value: string) => {
    s.setActive(model, node);
    return s.editProperty(node.id, key, value);
  };
  const editorOf = (node: any, key: string) => {
    const props = [...node.getProperties(), ...(node.getPILayout() ?? []).flatMap((g: any) => g.items)];
    return node.getPropInfo(props.find((p: any) => p.key === key));
  };
  return { s, model, container, at, edit, editorOf, name };
}

describe('no bus, alias type or enumeration definition is made in a model workspace', () => {
  it('Add refuses each, saying why, and offers none, where a MAT-file makes one', () => {
    const ws = opened('parity/artifacts/slx/cases.slx');
    const mat = opened('parity/artifacts/mat/cases.mat');
    for (const cls of ['Simulink.Bus', 'Simulink.AliasType']) {
      expect(ws.s.addEntry('workspace', cls)).toBeNull();
      expect(ws.s.addEntryRefusal(ws.container.id, cls)).toMatch(
        new RegExp(cls.replace('.', '\\.') + ' is not used by Simulink from a model workspace: define it in the base workspace or a data dictionary'),
      );
      expect(ws.container.getAllowedTypes()).not.toContain(cls);
      expect(mat.container.getAllowedTypes()).toContain(cls);
    }
    expect(ws.container.getAllowedTypes()).toEqual(expect.arrayContaining(['Simulink.Parameter', 'Simulink.Signal', 'Simulink.NumericType', 'Simulink.ValueType']));
  });

  it("a Bus copied out of the MAT-file is not pasted into the model's workspace", () => {
    const mat = opened('parity/artifacts/mat/cases.mat');
    const payload = mat.at('aBus').serialize();
    const ws = opened('parity/artifacts/slx/cases.slx');
    const fresh = { ...payload, name: 'aBus2' };
    expect(ws.s.pasteRefusal(ws.container.id, fresh)).toMatch(/Simulink\.Bus is not used by Simulink from a model workspace/);
    expect(mat.s.pasteRefusal(mat.name, fresh)).toBeNull();
  });
});

describe("a Signal keeps the storage class Auto alone, and a Parameter takes no custom one", () => {
  it("a Signal's storage class offers no editor, and an edit of it is refused, saying why", () => {
    const ws = opened('fixtures/mcos/mcosfix.slx');
    const sig = ws.at('Sig');
    expect(ws.editorOf(sig, 'storageClass').editable).toBe(false);
    expect((ws.edit(sig, 'storageClass', 'ExportedGlobal') as any).reason).toBe(
      'Cannot edit "Sig": a Signal in a model workspace keeps the storage class Auto alone, which MATLAB sets it to as it opens the model.',
    );
    expect(sig.toRow().storageClass).toBe('Auto');
    // Where a MAT-file takes it.
    const mat = opened('fixtures/mcos/Sig.mat');
    expect(mat.edit(mat.at('Sig'), 'storageClass', 'ExportedGlobal')).toBe(true);
  });

  it("a Parameter's storage class offers every class but Custom, as a MAT-file's does, and takes ExportedGlobal", () => {
    // cfg.k: a Parameter nested in a struct, whose coder settings MATLAB keeps (HasCoderInfo).
    const ws = opened('fixtures/mcos/nested_ws.slx');
    const k = ws.at('cfg.k');
    const editor = ws.editorOf(k, 'storageClass');
    expect(editor.editable).toBe(true);
    expect(editor.options).toContain('ExportedGlobal');
    expect(editor.options).not.toContain('Custom');
    // Refused as a MAT-file's editor refuses it.
    expect((ws.edit(k, 'storageClass', 'Custom') as any).reason).toBe('Cannot edit "cfg.k": Invalid value for Storage Class.');
    expect(ws.edit(k, 'storageClass', 'ExportedGlobal')).toBe(true);
  });

  it('a Signal copied out of a dictionary with the storage class ExportedGlobal is not pasted', () => {
    const s = createSession();
    const dict: any = s.addDataSource('classes_r2027a_text.sldd', JSON.parse(readFileSync(join(TEST, 'fixtures/classes_r2027a_text.sldd'), 'utf8')));
    const signal = dict.getSection('design').children.find((c: any) => c.name === 'sAl16');
    const ws = opened('parity/artifacts/slx/cases.slx');
    const refusal = ws.s.pasteRefusal(ws.container.id, signal.serialize(), { deep: true });
    expect(refusal).toMatch(/sAl16/);
    expect(refusal).toMatch(/StorageClass|storage class/);
  });
});

describe("a model argument's variable", () => {
  const rel = 'fixtures/workspace-facts/wsf_plainarg.slx';

  it('is not renamed or deleted, saying why', () => {
    const { s, at, edit } = opened(rel);
    const why = /it is an argument of the model, which MATLAB drops, with a warning, as it opens a model whose workspace holds no variable of its name/;
    expect((edit(at('k'), 'Name', 'k2') as any).reason).toMatch(why);
    expect(s.deleteNodeById(at('gain').id)).toBe(false);
    expect(s.deleteRefusal(at('gain').id)).toMatch(why);
    expect(at('k').nameEditable).toBe(false);
  });

  it('takes a number, and refuses a value of a kind an argument cannot hold', () => {
    const { at, edit } = opened(rel);
    expect(edit(at('k'), 'Value', '7')).toBe(true);
    expect(edit(at('k'), 'Value', 'int16(3)')).toBe(true);
    for (const typed of ["'text'", '"text"', '{1}']) {
      const r = edit(at('k'), 'Value', typed) as any;
      expect(r, typed).toMatchObject({ error: true });
      expect(r.reason, typed).toMatch(/"k" is an argument of the model, which holds a number, a fi, an enumeration value, a scalar struct or a Simulink\.Parameter/);
    }
    expect(at('k').displayValue).toBe('3');
  });

  it('of a variable that is no argument, takes the same edits', () => {
    const { s, at, edit } = opened('parity/artifacts/slx_layouts/slxcases.slx');
    expect(edit(at('label'), 'Value', '"text"')).toBe(true);
    expect(edit(at('label'), 'Name', 'label2')).toBe(true);
    expect(s.deleteNodeById(at('label2').id)).toBe(true);
  });
});

describe('a variable a block of the model uses by name', () => {
  const rel = 'parity/artifacts/slx_layouts/slxcases.slx';

  it('is not renamed or deleted, naming the block', () => {
    const { s, at, edit } = opened(rel);
    expect((edit(at('span'), 'Name', 'span2') as any).reason).toBe(
      'Cannot rename "span": the model\'s block "Two Lines" uses it by name, and would find no variable of that name once it is renamed here.',
    );
    expect(s.deleteRefusal(at('tau').id)).toMatch(/the model's block "TF" uses it by name, and would find no variable of that name once it is deleted here/);
    expect(s.deleteNodeById(at('tau').id)).toBe(false);
    expect(at('span').nameEditable).toBe(false);
  });

  it('takes an edit of its value', () => {
    const { at, edit } = opened(rel);
    expect(edit(at('tau'), 'Value', '0.75')).toBe(true);
  });
});
