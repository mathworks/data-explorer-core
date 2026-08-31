// Copyright 2026 The MathWorks, Inc.
//
// ProjectNode data model: building the four-section tree from a ParsedProject
// and the per-item row projection (toRow). The presentation-layer buildRows
// assertions (section headers, tree validity, entry coloring) live with the
// extension's integration tests.
import { describe, it, expect } from 'vitest';
import ProjectNode from '../src/datamodel/node/container/ProjectNode.js';
import type { ParsedProject } from '../src/datamodel/parser/ProjectParser.js';

function makeParsed(): ParsedProject {
  return {
    name: 'MyProj',
    files: [
      { path: 'models', isFolder: true, labels: [] },
      { path: 'models/controller.slx', isFolder: false, labels: ['Design'] },
    ],
    pathFolders: ['utils'],
    labels: [
      { category: 'Classification', name: 'Design' },
      { category: 'Classification', name: 'Test' },
    ],
    references: [{ id: 'ref-uuid-1', name: 'SharedLib' }],
  };
}

describe('ProjectNode.fromParsed', () => {
  it('builds a named node with the four expected sections', () => {
    const node = ProjectNode.fromParsed(makeParsed(), 'MyProj.prj');
    expect(node.name).toBe('MyProj.prj');
    expect(node.getSection('files')).not.toBeNull();
    expect(node.getSection('path')).not.toBeNull();
    expect(node.getSection('labels')).not.toBeNull();
    expect(node.getSection('references')).not.toBeNull();
  });

  it('populates the files section and maps Name/Type/Location/Labels columns', () => {
    const node = ProjectNode.fromParsed(makeParsed(), 'MyProj.prj');
    const files = node.getSection('files')!;
    expect(files.children.length).toBe(2);

    const slx = files.children.find((c) => c.name === 'controller.slx')!;
    expect(slx).toBeDefined();
    const row: any = slx.toRow();
    expect(row.Name.label).toBe('controller.slx');
    expect(row.Name.iconId).toBe('simulinkModel_FT');
    expect(row.Type).toBe('File');
    expect(row.Location).toBe('models/controller.slx');
    expect(row.Labels).toBe('Design');
  });

  it('populates path, labels, and references sections', () => {
    const node = ProjectNode.fromParsed(makeParsed(), 'MyProj.prj');
    expect(node.getSection('path')!.children.length).toBe(1);
    expect(node.getSection('labels')!.children.length).toBe(2);
    const ref = node.getSection('references')!.children[0];
    expect(ref.name).toBe('SharedLib');
    expect((ref as any).location).toBe('ref-uuid-1');
    expect(node.NumberOfEntries).toBe(6);
  });
});
