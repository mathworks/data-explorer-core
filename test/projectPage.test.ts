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
    membersEnumerated: true,
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
    { id: 'design', category: 'Classification', name: 'Design', readOnly: true, declaredFiles: [] },
    { id: 'test', category: 'Classification', name: 'Test', readOnly: true, declaredFiles: [] },
    { id: 'unused', category: 'Classification', name: 'Unused', readOnly: true, declaredFiles: [] },
    { id: 'mine', category: 'Classification', name: 'ForUser', readOnly: false, declaredFiles: [] },
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
      // Nothing declared this id — it exists only because a member carries it — so
      // there is no catalog entry it could have been declared on.
      declaredFiles: [],
    });
  });

  it('counts a member once per label, not once per category it appears in', () => {
    const page = buildProjectPage(
      parsed({
        labels: [
          { id: 'design', category: 'Classification', name: 'Design', readOnly: true, declaredFiles: [] },
          { id: 'rev', category: 'Review', name: 'Reviewed', readOnly: false, declaredFiles: [] },
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

  it('leaves declaredFiles empty for every label out of an XML store', () => {
    // An XML store assigns labels the other way round, per member file, so a catalog
    // entry there has no file list of its own and `count` is the whole story. A page
    // that found paths here would be showing something no store recorded.
    const page = buildProjectPage(
      parsed({
        labels: catalog,
        files: [{ path: 'a.m', isFolder: false, labels: ['design'] }],
      }),
    );
    expect(page.categories.flatMap((c) => c.labels).map((l) => l.declaredFiles)).toEqual([
      [],
      [],
      [],
      [],
    ]);
  });

  it('still reports 0 members for an XML store that could not be walked', () => {
    // The one case the nullability must NOT swallow: a damaged store enumerated
    // nothing, which is a true 0, as against a format that enumerates nothing. The
    // parser says so by keeping `membersEnumerated` true even in `emptyResult`, and a
    // host already shows that 0 — so this is behaviour to preserve, not to unify.
    const page = buildProjectPage(parsed({ format: '', files: [] }));
    expect(page.memberCount).toBe(0);
    expect(page.labelledCount).toBe(0);
  });
});

describe('buildProjectPage — a format that records no member list', () => {
  // A `matlab.toml` project. MATLAB's rule for it is "every file under the project root
  // is a member", which is a statement about the filesystem and not a list in the
  // document, and the maintainer's decision is to declare only what the file declares —
  // no folder walk to synthesize one. So the page's job here is to show NO count, and
  // every assertion below is really the same assertion: a zero would be a false claim
  // about a project that may well hold hundreds of files.

  /** Labels as the TOML format carries them: each declaring its own files. */
  const declared = [
    {
      id: 'Status/Draft',
      category: 'Status',
      name: 'Draft',
      readOnly: false,
      declaredFiles: ['models/*.slx', 'src/a.m'],
    },
    {
      id: 'Status/Reviewed',
      category: 'Status',
      name: 'Reviewed',
      readOnly: false,
      declaredFiles: [],
    },
    {
      id: 'Status/Archived',
      category: 'Status',
      name: 'Archived',
      readOnly: false,
      declaredFiles: ['old/'],
    },
  ];

  /** A parse from a format that enumerates no members: no files, by the format. */
  const unenumerated = (over: Partial<ParsedProject> = {}) =>
    parsed({ format: 'toml', membersEnumerated: false, files: [], ...over });

  it('reports no member count and no coverage instead of zeros', () => {
    // `null` is what makes a renderer branch: the webview's `esc()` takes
    // `string | number`, so a `null` arriving there fails to compile at the call site.
    // A 0 — or a -1 sentinel — would have type-checked and printed a lie.
    const page = buildProjectPage(unenumerated({ labels: declared }));
    expect(page.memberCount).toBeNull();
    expect(page.labelledCount).toBeNull();
  });

  it('reports every label usage as unknown rather than as unused', () => {
    // A defined-but-unused label legitimately counts 0 in an XML store, so 0 here would
    // be indistinguishable from that — and it would contradict the chip beside it, which
    // is about to list the three paths the label was declared against.
    const page = buildProjectPage(unenumerated({ labels: declared }));
    const labels = page.categories.flatMap((c) => c.labels);
    expect(labels).toHaveLength(3);
    expect(labels.every((l) => l.count === null)).toBe(true);
  });

  it('carries the files each label was declared against through verbatim', () => {
    // These paths are what the page shows IN PLACE OF the coverage fraction, so they
    // must arrive exactly as the document wrote them — a glob is a glob, a trailing
    // slash means a folder, and nothing here is entitled to resolve either.
    const page = buildProjectPage(unenumerated({ labels: declared }));
    const byName = new Map(page.categories[0].labels.map((l) => [l.name, l.declaredFiles]));
    expect(byName.get('Draft')).toEqual(['models/*.slx', 'src/a.m']);
    expect(byName.get('Archived')).toEqual(['old/']);
    // Declaring nothing is a real state of a hand-edited file, and the label still
    // belongs on the page: the project defined it.
    expect(byName.get('Reviewed')).toEqual([]);
  });

  it('orders the labels by name alone when there is no usage to order by', () => {
    // "Used first" has no meaning without counts, and `count ?? 0` would make the sort
    // a no-op that leaves catalog order — so the fallback is explicit. Catalog order
    // here is Draft, Reviewed, Archived and declared-file order would be Draft,
    // Archived, Reviewed; neither is what alphabetical gives.
    const page = buildProjectPage(unenumerated({ labels: declared }));
    expect(page.categories[0].labels.map((l) => l.name)).toEqual([
      'Archived',
      'Draft',
      'Reviewed',
    ]);
  });

  it('treats every label in this format as one the project declared', () => {
    // Not this file's doing — the format records no ownership, so the reader marks them
    // all writable — but the page is where that shows, as the absence of the built-in
    // styling a read-only Classification label gets.
    const page = buildProjectPage(unenumerated({ labels: declared }));
    expect(page.categories[0].labels.every((l) => l.custom)).toBe(true);
  });

  it('leaves the rest of the page exactly as any other format builds it', () => {
    // Only the three count fields are conditional. A reader of this change should not
    // have to wonder whether the hooks or the path folders went missing with them.
    const page = buildProjectPage(
      unenumerated({
        pathFolders: ['', 'utils'],
        entryPoints: [ep({ name: 'build', file: 'build.m', kind: 'StartUp', visible: false })],
      }),
    );
    expect(page.formatLabel).toBe('matlab.toml');
    expect(page.pathFolders).toEqual(['', 'utils']);
    expect(page.startup).toEqual([{ name: 'build', file: 'build.m' }]);
    expect(page.categories).toEqual([]);
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

  it('shows a reference by its path, and by name alone when there is none', () => {
    // The path is what a host resolves to open the referenced project. A reference
    // the store gave no path for leaves only its UUID, and linking THAT would offer
    // to open a path that cannot exist — so it is empty, which is how the page knows
    // not to make it a link.
    const page = buildProjectPage(
      parsed({
        references: [
          { id: 'uuid-1', name: 'Lib.prj', path: '../Lib/Lib.prj' },
          { id: 'uuid-2', name: null, path: null },
        ],
      }),
    );
    expect(page.references).toEqual([
      { name: 'Lib.prj', path: '../Lib/Lib.prj' },
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
