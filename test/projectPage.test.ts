// Copyright 2026 The MathWorks, Inc.
//
// The page is the whole reason a `.prj` opens at all: it is the one surface that
// shows what a project IS rather than which files it happens to contain (the
// Explorer already shows those, and MATLAB opens no document tab for a project).
//
// So the cases that matter here are the ones where the page would otherwise state
// something false about a real project: a shutdown sequence in the wrong order, a
// shortcut filed under a group that no longer exists, a label coverage figure that
// counts a file the catalog cannot name, an unrecognized entry-point kind vanishing
// from a gallery whose job is to list what the project put there.
import { describe, it, expect } from 'vitest';
import { buildProjectPage } from '../src/datamodel/parser/ProjectPage.js';
import type { ParsedProject } from '../src/datamodel/parser/ProjectParser.js';

/** An empty parse, for a test to fill in only the field it is about. */
function parsed(over: Partial<ParsedProject> = {}): ParsedProject {
  return {
    name: 'Proj',
    format: 'fixedPathV2',
    files: [],
    pathFolders: [],
    labels: [],
    references: [],
    entryPoints: [],
    entryPointGroups: [],
    workingFolders: [],
    warnings: [],
    ...over,
  };
}

const ep = (over: Partial<ParsedProject['entryPoints'][number]>) => ({
  id: 'id',
  name: 'name',
  file: 'file.m',
  kind: 'Basic',
  visible: true,
  groupId: '',
  ...over,
});

describe('buildProjectPage — the hooks', () => {
  it('splits the hooks out and keeps the order the parser put them in', () => {
    // The parser hands these over in RUN order (from the store's *Prev chain), and
    // nothing here may reorder them: MATLAB runs the files top-down, so a page that
    // sorted them by name would misreport the sequence a project shuts down in.
    const page = buildProjectPage(
      parsed({
        entryPoints: [
          ep({ id: 'u', name: 'up', file: 'a.m', kind: 'StartUp', visible: false }),
          ep({ id: 'd1', name: 'zzz-first', file: 'z.m', kind: 'Shutdown', visible: false }),
          ep({ id: 'd2', name: 'aaa-second', file: 'a2.m', kind: 'Shutdown', visible: false }),
          ep({ id: 's', name: 'shortcut', file: 's.m' }),
        ],
      }),
    );
    expect(page.startup).toEqual([{ name: 'up', file: 'a.m' }]);
    expect(page.shutdown).toEqual([
      { name: 'zzz-first', file: 'z.m' },
      { name: 'aaa-second', file: 'a2.m' },
    ]);
    expect(page.shortcuts.map((s) => s.name)).toEqual(['shortcut']);
  });

  it('leaves both hooks empty for a project that registers none', () => {
    const page = buildProjectPage(parsed());
    expect(page.startup).toEqual([]);
    expect(page.shutdown).toEqual([]);
  });
});

describe('buildProjectPage — the shortcuts gallery', () => {
  it('resolves a group id to its name and puts grouped shortcuts first', () => {
    const page = buildProjectPage(
      parsed({
        entryPointGroups: [{ id: 'g1', name: 'Utility' }],
        entryPoints: [
          ep({ id: 'a', name: 'loose', file: 'a.m' }),
          ep({ id: 'b', name: 'grouped', file: 'b.m', groupId: 'g1' }),
        ],
      }),
    );
    expect(page.shortcuts).toEqual([
      { name: 'grouped', file: 'b.m', group: 'Utility' },
      { name: 'loose', file: 'a.m', group: '' },
    ]);
  });

  it('treats a group id that names no group as ungrouped', () => {
    // A store can outlive the group it points at, and a gallery heading reading a
    // bare UUID is worse than no heading at all.
    const page = buildProjectPage(
      parsed({ entryPoints: [ep({ name: 'orphan', groupId: 'gone' })] }),
    );
    expect(page.shortcuts).toEqual([{ name: 'orphan', file: 'file.m', group: '' }]);
  });

  it('keeps a shortcut of a kind it does not recognize', () => {
    // Selected by excluding the two hook kinds, not by asking for 'Basic': a newer
    // release can add a kind, and an unknown one belongs in the gallery — at worst
    // grouped oddly — rather than absent from a page that exists to list these.
    const page = buildProjectPage(
      parsed({ entryPoints: [ep({ name: 'future', kind: 'SomethingNew' })] }),
    );
    expect(page.shortcuts.map((s) => s.name)).toEqual(['future']);
  });

  it('leaves a hidden entry out of the gallery', () => {
    // `visible` is MATLAB's own answer to whether this belongs in the gallery.
    const page = buildProjectPage(
      parsed({ entryPoints: [ep({ name: 'hidden', visible: false })] }),
    );
    expect(page.shortcuts).toEqual([]);
  });

  it('keeps a shortcut that targets a folder', () => {
    const page = buildProjectPage(parsed({ entryPoints: [ep({ name: 'utils', file: 'utilities' })] }));
    expect(page.shortcuts[0].file).toBe('utilities');
  });
});

describe('buildProjectPage — labels and coverage', () => {
  const catalog = [
    { id: 'design', category: 'Classification', name: 'Design', readOnly: true },
    { id: 'test', category: 'Classification', name: 'Test', readOnly: true },
    { id: 'unused', category: 'Classification', name: 'Unused', readOnly: true },
    { id: 'mine', category: 'Classification', name: 'ForUser', readOnly: false },
  ];

  it('counts members per label and reports coverage', () => {
    const page = buildProjectPage(
      parsed({
        labels: catalog,
        files: [
          { path: 'a.m', isFolder: false, labels: ['design'] },
          { path: 'b.m', isFolder: false, labels: ['design'] },
          { path: 'c.m', isFolder: false, labels: ['mine'] },
          { path: 'd.m', isFolder: false, labels: [] },
          { path: 'folder', isFolder: true, labels: [] },
        ],
      }),
    );
    // memberCount counts folders too: they are members of the project, and the
    // Explorer shows them as such.
    expect(page.memberCount).toBe(5);
    expect(page.labelledCount).toBe(3);
    const byName = new Map(page.categories[0].labels.map((l) => [l.name, l]));
    expect(byName.get('Design')?.count).toBe(2);
    expect(byName.get('Unused')?.count).toBe(0);
    expect(byName.get('ForUser')?.custom).toBe(true);
    expect(byName.get('Design')?.custom).toBe(false);
  });

  it('orders used labels before unused ones', () => {
    // The seven built-ins ship with every project and most stay at zero, so catalog
    // order buries the two or three that say something about THIS project.
    const page = buildProjectPage(
      parsed({
        labels: catalog,
        files: [
          { path: 'a.m', isFolder: false, labels: ['test'] },
          { path: 'b.m', isFolder: false, labels: ['test'] },
          { path: 'c.m', isFolder: false, labels: ['design'] },
        ],
      }),
    );
    expect(page.categories[0].labels.map((l) => l.name)).toEqual([
      'Test',
      'Design',
      'ForUser',
      'Unused',
    ]);
  });

  it('counts a label a member carries but the catalog does not define', () => {
    // The two can disagree — a store written by a release that knew the label, or
    // hand-edited. Dropping it would make the coverage figure disagree with the
    // chips beneath it, which is the one thing a page must not do.
    const page = buildProjectPage(
      parsed({
        labels: [catalog[0]],
        files: [
          { path: 'a.m', isFolder: false, labels: ['design'] },
          { path: 'b.m', isFolder: false, labels: ['ghost'] },
        ],
      }),
    );
    expect(page.labelledCount).toBe(2);
    const all = page.categories.flatMap((c) => c.labels);
    expect(all.find((l) => l.id === 'ghost')).toEqual({
      id: 'ghost',
      name: 'ghost',
      count: 1,
      custom: true,
    });
  });

  it('counts a member once per label, not once per category it appears in', () => {
    const page = buildProjectPage(
      parsed({
        labels: [
          { id: 'design', category: 'Classification', name: 'Design', readOnly: true },
          { id: 'rev', category: 'Review', name: 'Reviewed', readOnly: false },
        ],
        files: [{ path: 'a.m', isFolder: false, labels: ['design', 'rev'] }],
      }),
    );
    expect(page.labelledCount).toBe(1);
    expect(page.categories.map((c) => c.name)).toEqual(['Classification', 'Review']);
    expect(page.categories.every((c) => c.labels[0].count === 1)).toBe(true);
  });

  it('has no categories at all for a project that defines no labels', () => {
    expect(buildProjectPage(parsed()).categories).toEqual([]);
  });
});

describe('buildProjectPage — the remaining sections', () => {
  it('labels a known designated location and passes an unknown key through', () => {
    const page = buildProjectPage(
      parsed({
        workingFolders: [
          { key: 'SimulinkCacheFolder', ref: 'Cache' },
          { key: 'NewInSomeFutureRelease', ref: 'Elsewhere' },
        ],
      }),
    );
    expect(page.locations).toEqual([
      { key: 'SimulinkCacheFolder', label: 'Simulation cache', ref: 'Cache' },
      // Showing the raw key is honest; dropping the row or printing 'Unknown' is not.
      { key: 'NewInSomeFutureRelease', label: 'NewInSomeFutureRelease', ref: 'Elsewhere' },
    ]);
  });

  it("uses MATLAB's words for the metadata format, not the store's", () => {
    // `fixedPathV2` and `distributed` are two encodings of one USER choice. Printing
    // the internal name invites a user to look for a setting spelled that way.
    expect(buildProjectPage(parsed({ format: 'fixedPathV2' })).formatLabel).toBe('multiple XML files');
    expect(buildProjectPage(parsed({ format: 'distributed' })).formatLabel).toBe('multiple XML files');
    expect(buildProjectPage(parsed({ format: 'toml' })).formatLabel).toBe('matlab.toml');
    // An unrecognized one still says something rather than nothing.
    expect(buildProjectPage(parsed({ format: 'v99' })).formatLabel).toBe('v99');
  });

  it('keeps the project root among the path folders', () => {
    const page = buildProjectPage(parsed({ pathFolders: ['', 'utils'] }));
    expect(page.pathFolders).toEqual(['', 'utils']);
  });

  it('falls back to the reference id when the store recorded no path', () => {
    const page = buildProjectPage(
      parsed({
        references: [
          { id: 'uuid-1', name: 'Lib.prj' },
          { id: 'uuid-2', name: null },
        ],
      }),
    );
    expect(page.references).toEqual([
      { name: 'Lib.prj', path: 'uuid-1' },
      { name: 'uuid-2', path: '' },
    ]);
  });

  it('carries the parse warnings through to the page', () => {
    // The page is where a user finds out their project did not read whole; a warning
    // that stops at the parse boundary is a warning nobody sees.
    const warnings = [{ code: 'part-unreadable' as const, message: 'lost one', part: 'x.xml' }];
    expect(buildProjectPage(parsed({ warnings })).warnings).toEqual(warnings);
  });
});
