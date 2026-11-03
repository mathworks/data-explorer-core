// Copyright 2026 The MathWorks, Inc.
// A model's elements, configuration sets, references and external data are shown and not edited:
// an edit of a row in any of those sections is refused, with the reason, and leaves the model as it
// was read — not dirty, and no undo step. Until this, a model's sections answered no edit rule
// (BaseNode.sourceEditRefusal asks the first container above an entry, and a ModelSectionNode had
// none), so a config set's rename was taken, marked the model dirty and recorded an undo step,
// though no save writes it. The Model Workspace answers by its own rules, and is not tested here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

function modelSession(path: string) {
  const b = readFileSync(fileURLToPath(new URL(path, import.meta.url)));
  const s = createSession();
  const name = path.slice(path.lastIndexOf('/') + 1);
  const src = s.addModelSource(name, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) as any;
  return { s, src, name };
}

const CASES = './parity/artifacts/slx/cases.slx';
const LAYOUTS = './parity/artifacts/slx_layouts/slxcases.slx';
const CFGREF = './parity/artifacts/slx_layouts/slxcfgref.slx';
const sectionOf = (src: any, key: string) => src.children.find((c: any) => c.name === key);
const entryOf = (src: any, key: string, name: string) => sectionOf(src, key).children.find((c: any) => c.name === name);

// The model as read: clean, nothing to undo.
function expectUntouched(s: any, src: any): void {
  expect(src.dirty).toBe(false);
  expect(s.canUndo()).toBe(false);
}

describe("a model refuses every edit of a row outside its Model Workspace", () => {
  it("refuses a config set's rename and Description, saying why, and changes nothing", () => {
    const { s, src } = modelSession(LAYOUTS);
    const node = entryOf(src, 'config', 'Fast');
    s.setActive(src, node);
    const renamed = s.editProperty(node.id, 'Name', 'Faster') as any;
    expect(renamed).toMatchObject({ error: true });
    expect(renamed.reason).toBe(
      'Cannot rename "Fast": it is in the Configurations section of "slxcases.slx", which this editor shows but does not edit.',
    );
    expect(s.renameRefusal(node.id)).toMatch(/Configurations section of "slxcases\.slx"/);
    expect(s.editProperty(node.id, 'Description', 'quick')).toMatchObject({ error: true });
    expect(node.name).toBe('Fast');
    expect(node.Description).toBe('');
    expectUntouched(s, src);
  });

  it("refuses a config set reference's source", () => {
    const { s, src } = modelSession(CFGREF);
    const node = entryOf(src, 'config', 'RefFromDict');
    s.setActive(src, node);
    const before = node.SourceName;
    expect(s.editProperty(node.id, 'SourceName', 'Other')).not.toBe(true);
    expect(node.SourceName).toBe(before);
    expectUntouched(s, src);
  });

  it("refuses a host's own setter call, as the session's", () => {
    const { s, src } = modelSession(LAYOUTS);
    const node = entryOf(src, 'config', 'Fast');
    expect(node.setProperty('Name', 'Faster')).toMatchObject({ error: true });
    expect(node.name).toBe('Fast');
    expectUntouched(s, src);
  });

  it('offers no editor of a row outside the workspace', () => {
    const { src } = modelSession(LAYOUTS);
    for (const key of ['blocks', 'config', 'references', 'dataSources']) {
      for (const node of sectionOf(src, key).children) {
        expect(node.nameEditable, key + ' ' + node.name).toBe(false);
        expect(node.toRow().Name.editable, key + ' ' + node.name).toBe(false);
        expect(!!node.toRow()._valueEditable, key + ' ' + node.name).toBe(false);
      }
    }
  });

  it('refuses a rename of a block, a reference and an external data source', () => {
    const { s, src } = modelSession(LAYOUTS);
    for (const key of ['blocks', 'references', 'dataSources']) {
      const node = sectionOf(src, key).children[0];
      const before = node.name;
      s.setActive(src, node);
      expect(s.editProperty(node.id, 'Name', 'renamed'), key).not.toBe(true);
      expect(node.name, key).toBe(before);
    }
    expectUntouched(s, src);
  });

  it('names the section of every entry it does not delete', () => {
    const { s, src } = modelSession(LAYOUTS);
    for (const [key, label] of [
      ['blocks', 'Model Elements'],
      ['workspace', 'Model Workspace'],
      ['config', 'Configurations'],
      ['references', 'Model References'],
      ['dataSources', 'External Data'],
    ]) {
      const entry = sectionOf(src, key).children[0];
      expect(entry, key).toBeTruthy();
      expect(s.deleteNodeById(entry.id)).toBe(false);
      expect(s.deleteRefusal(entry.id)).toBe(
        `Cannot delete "${entry.name}": it is in the ${label} section of "slxcases.slx", which this editor shows but does not edit. Nothing was deleted.`,
      );
      expect(sectionOf(src, key).children).toContain(entry);
    }
    expectUntouched(s, src);
  });

  it('takes no paste into a model', () => {
    const { s, src, name } = modelSession(CASES);
    const ws = sectionOf(src, 'workspace');
    const before = ws.children.length;
    const payload = { name: 'pasted', metadata: null, value: 3 };
    expect(s.pasteRefusal(name, payload)).toBeTruthy();
    expect(s.pasteRefusal(ws.id, payload)).toBeTruthy();
    s.pasteEntries(ws.id, [payload]);
    expect(ws.children.length).toBe(before);
    expectUntouched(s, src);
  });
});
