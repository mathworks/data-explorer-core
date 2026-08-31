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

  it('resolves a file label id to the catalog display name', () => {
    // A .prj stores per-file labels as ids; showing the raw GUID in the Labels
    // column would be meaningless to the user.
    const parsed = makeParsed();
    parsed.labels = [{ category: 'Classification', name: 'Reviewed', id: 'lbl-1' }];
    parsed.files = [{ path: 'a.m', isFolder: false, labels: ['lbl-1', 'lbl-unknown'] }];
    const item = ProjectNode.fromParsed(parsed, 'p.prj').getSection('files')!.children[0];
    // An id with no catalog entry falls through unresolved rather than vanishing.
    expect((item as any).labels).toEqual(['Reviewed', 'lbl-unknown']);
    expect((item.toRow() as any).Labels).toBe('Reviewed, lbl-unknown');
  });

  it('names each entry by its basename, keeping the full path as the location', () => {
    const parsed = makeParsed();
    parsed.files = [{ path: 'a/b/c.m', isFolder: false, labels: [] }];
    parsed.pathFolders = ['utils/helpers/'];
    const node = ProjectNode.fromParsed(parsed, 'p.prj');
    const file = node.getSection('files')!.children[0];
    expect([file.name, (file as any).location]).toEqual(['c.m', 'a/b/c.m']);
    // A trailing separator must not yield an empty name.
    const folder = node.getSection('path')!.children[0];
    expect([folder.name, (folder as any).location]).toEqual(['helpers', 'utils/helpers/']);
  });

  it('falls back to the reference id when it has no name', () => {
    const parsed = makeParsed();
    parsed.references = [{ id: 'ref-uuid-2' }];
    expect(ProjectNode.fromParsed(parsed, 'p.prj').getSection('references')!.children[0].name).toBe('ref-uuid-2');
  });
});

describe('ProjectNode — presentation', () => {
  const node = () => ProjectNode.fromParsed(makeParsed(), 'MyProj.prj');

  it('is a read-only root with the project icon', () => {
    // A .prj is a viewer target: the extension never writes one back.
    const n = node();
    expect(n.displayName).toBe('MyProj.prj');
    expect(n.icon).toBe('simulink_project');
    expect(n.readOnly).toBe(true);
  });

  it('offers only Name, in a single General group', () => {
    const n = node();
    expect(n.getProperties().map((p) => p.key)).toEqual(['Name']);
    expect(n.getPILayout()).toEqual([{ group: 'General', items: n.getProperties() }]);
  });

  it('uses the same four columns on the root and every section', () => {
    const n = node();
    const expected = { columns: ['Name', 'Type', 'Location', 'Labels'] };
    expect(n.tableColumnConfig).toEqual(expected);
    for (const key of ['files', 'path', 'labels', 'references']) {
      expect(n.getSection(key)!.tableColumnConfig, key).toEqual(expected);
    }
  });

  it('labels and ices each section', () => {
    expect(node().children.map((c) => [c.name, c.displayName, c.icon])).toEqual([
      ['files', 'Project Files', 'databaseFolder'],
      ['path', 'Project Path', 'link_database'],
      ['labels', 'Labels', 'databaseFolder'],
      ['references', 'References', 'modelReference'],
    ]);
  });

  it('returns null for an unknown section key', () => {
    expect(node().getSection('nope')).toBeNull();
  });
});

describe('ProjectItemNode', () => {
  const items = (parsed: ParsedProject) => {
    const n = ProjectNode.fromParsed(parsed, 'p.prj');
    return ['files', 'path', 'labels', 'references'].flatMap((k) => n.getSection(k)!.children);
  };

  it('picks the icon from the item type, and from the extension for a file', () => {
    const parsed = makeParsed();
    parsed.files = [
      { path: 'dir', isFolder: true, labels: [] },
      { path: 'm.slx', isFolder: false, labels: [] },
      { path: 'old.mdl', isFolder: false, labels: [] },
      { path: 'p.sldd', isFolder: false, labels: [] },
      { path: 'd.mat', isFolder: false, labels: [] },
      { path: 'script.m', isFolder: false, labels: [] },
      // Extension matching must be case-insensitive: Windows projects mix case.
      { path: 'M.SLX', isFolder: false, labels: [] },
    ];
    parsed.pathFolders = ['utils'];
    parsed.labels = [{ category: 'C', name: 'L' }];
    parsed.references = [{ id: 'r', name: 'R' }];
    expect(items(parsed).map((c) => c.icon)).toEqual([
      'databaseFolder',
      'simulinkModel_FT',
      'simulinkModel_FT',
      'simulinkDataDictionary_FT',
      'matlabWorkspaceFile',
      // An unrecognised extension gets the generic entry icon.
      'wsDefault',
      'simulinkModel_FT',
      'link_database',
      'wsDefault',
      'modelReference',
    ]);
  });

  it('reports the item type as its class and the location as its value', () => {
    const parsed = makeParsed();
    parsed.files = [{ path: 'models/c.slx', isFolder: false, labels: [] }];
    const item = ProjectNode.fromParsed(parsed, 'p.prj').getSection('files')!.children[0];
    expect(item.className).toBe('File');
    expect(item.displayName).toBe('c.slx');
    expect(item.displayValue).toBe('models/c.slx');
  });

  it('is a non-editable entry, since a project is never written back', () => {
    const item = ProjectNode.fromParsed(makeParsed(), 'p.prj').getSection('files')!.children[0];
    expect(item.isEntry).toBe(true);
    expect(item.nameEditable).toBe(false);
    expect(item.valueEditable).toBe(false);
  });

  it('shows Name, Type, Location and Labels in one General group', () => {
    const item = ProjectNode.fromParsed(makeParsed(), 'p.prj').getSection('files')!.children[0];
    expect(item.getProperties().map((p) => p.key)).toEqual(['Name', 'Type', 'Location', 'Labels']);
    expect(item.getPILayout()).toEqual([{ group: 'General', items: item.getProperties() }]);
    expect(item.toPIObject()!.objects[0]).toMatchObject({ Type: 'Folder', Location: 'models', Labels: '' });
  });
});
