// Copyright 2026 The MathWorks, Inc.
//
// The view model behind a project's main page.
//
// A `.prj` is not a table. MATLAB itself opens NO document tab for one — its
// Project panel *is* the file panel — and the folder tree a table would show is
// already in VS Code's Explorer, so repeating it costs a tab and says nothing new.
// What is NOT anywhere else is everything around the file list: which files run on
// open and close and IN WHICH ORDER, the shortcuts and their groups, which folders
// are on the MATLAB path, where the cache and generated code go, which labels this
// project defines and how much of it they cover. That is what a page shows.
//
// WHY THIS LIVES BESIDE THE PARSER. It is a projection of `ParsedProject` and needs
// its types; `datamodel/display/` is pinned by `moduleBoundaries.test.ts` to have
// ZERO outbound edges, so it cannot be there. It is also not presentation: the
// grouping, the run-order split, the label usage counts and the coverage figure are
// all facts about the store, derived once here so that every host computes them the
// same way and so they are testable without a webview.

import type { ParsedProject, ProjectEntryPoint } from './ProjectParser.js';
import type { ParseWarning } from './ParseWarning.js';

/** One file MATLAB runs for a hook. Position in the list IS the run order. */
export interface ProjectPageRun {
  name: string;
  /** Project-root-relative path. */
  file: string;
}

/** One entry in the Shortcuts gallery. */
export interface ProjectPageShortcut {
  name: string;
  /** Project-root-relative path. May name a FOLDER. */
  file: string;
  /** The group's display name, '' when ungrouped. */
  group: string;
}

/** One label, with how much of the project carries it. */
export interface ProjectPageLabel {
  id: string;
  name: string;
  /** Members carrying this label. 0 is meaningful — a defined but unused label. */
  count: number;
  /** Defined by this project rather than shipped by MATLAB. */
  custom: boolean;
}

export interface ProjectPageCategory {
  name: string;
  labels: ProjectPageLabel[];
}

/** A folder — or file — the project designates for a purpose. */
export interface ProjectPageLocation {
  /** The store's own key, e.g. 'SimulinkCacheFolder'. */
  key: string;
  /** English for `key`, falling back to `key` itself when unrecognized. */
  label: string;
  /** Project-root-relative path. */
  ref: string;
}

export interface ProjectPageReference {
  name: string;
  /** The reference id; a path when the store recorded one. */
  path: string;
}

export interface ProjectPage {
  name: string;
  /** The raw `MetadataType`, for a host that wants to report it exactly. */
  format: string;
  /** English for `format` — what a MATLAB user sees in Project Settings. */
  formatLabel: string;
  /** Every member, folders included: what the project "contains". */
  memberCount: number;
  /** Members carrying at least one label — the numerator of label coverage. */
  labelledCount: number;
  /** In run order. */
  startup: ProjectPageRun[];
  /** In run order. */
  shutdown: ProjectPageRun[];
  shortcuts: ProjectPageShortcut[];
  /** Project-root-relative; '' is the project root itself. */
  pathFolders: string[];
  locations: ProjectPageLocation[];
  categories: ProjectPageCategory[];
  references: ProjectPageReference[];
  warnings: ParseWarning[];
}

/**
 * English for a working-folder key.
 *
 * Deliberately not exhaustive, and the fallback is the raw key: a newer release can
 * designate a purpose this version has no word for, and showing `key` is honest
 * where dropping the row or printing 'Unknown' is not.
 */
const LOCATION_LABEL: Record<string, string> = {
  SimulinkCacheFolder: 'Simulation cache',
  SimulinkCodeGenFolder: 'Code generation',
  ProjectStartupFolder: 'Startup folder',
  DependencyCacheFile: 'Dependency cache',
};

/**
 * English for a `MetadataType`.
 *
 * These are the words MATLAB's own Project Settings uses, not the store's spelling:
 * `fixedPathV2` and `distributed` are two encodings of the same USER choice ("save
 * as multiple XML files"), and a page that printed the internal name would invite a
 * user to look for a setting that is not spelled that way anywhere in MATLAB.
 */
const FORMAT_LABEL: Record<string, string> = {
  fixedPathV2: 'multiple XML files',
  distributed: 'multiple XML files',
  monolithic: 'single XML file',
  toml: 'matlab.toml',
};

/** The entry-point kinds MATLAB runs, as opposed to the ones a user clicks. */
const STARTUP = 'StartUp';
const SHUTDOWN = 'Shutdown';

/**
 * Project a parsed project into its page.
 *
 * Pure and total: every field is derived from `parsed`, and a project that holds
 * nothing yields a page of empty sections rather than a missing one — the sections
 * are what tell a user "this project defines no shortcuts", which is a fact worth
 * showing and not the same as a page that failed to render.
 */
export function buildProjectPage(parsed: ParsedProject): ProjectPage {
  const runsOf = (kind: string): ProjectPageRun[] =>
    parsed.entryPoints
      .filter((e) => e.kind === kind)
      // `parsed.entryPoints` is already in run order and `filter` preserves it, so
      // there is deliberately no sort here — see ParsedProject.entryPoints.
      .map((e) => ({ name: e.name, file: e.file }));

  const groupNames = new Map(parsed.entryPointGroups.map((g) => [g.id, g.name]));

  return {
    name: parsed.name,
    format: parsed.format,
    formatLabel: FORMAT_LABEL[parsed.format] ?? parsed.format,
    memberCount: parsed.files.length,
    labelledCount: parsed.files.filter((f) => f.labels.length > 0).length,
    startup: runsOf(STARTUP),
    shutdown: runsOf(SHUTDOWN),
    shortcuts: shortcutsOf(parsed.entryPoints, groupNames),
    pathFolders: parsed.pathFolders,
    locations: parsed.workingFolders.map((w) => ({
      key: w.key,
      label: LOCATION_LABEL[w.key] ?? w.key,
      ref: w.ref,
    })),
    categories: categoriesOf(parsed),
    references: parsed.references.map((r) => ({ name: r.name ?? r.id, path: r.name ? r.id : '' })),
    warnings: parsed.warnings,
  };
}

/**
 * The Shortcuts gallery: every entry point that is not a hook.
 *
 * Selected by EXCLUDING the two run kinds rather than by asking for 'Basic'. A
 * newer release can add a shortcut kind, and an unknown kind is far better shown in
 * the gallery — where it is at worst grouped oddly — than silently absent from a
 * page whose whole job is to list what this project put there.
 */
function shortcutsOf(
  entryPoints: ProjectEntryPoint[],
  groupNames: Map<string, string>,
): ProjectPageShortcut[] {
  const out: ProjectPageShortcut[] = [];
  for (const e of entryPoints) {
    if (e.kind === STARTUP || e.kind === SHUTDOWN) {
      continue;
    }
    // `visible` is MATLAB's own answer to "does this belong in the gallery", so a
    // hidden entry of any other kind stays out of it.
    if (!e.visible) {
      continue;
    }
    out.push({
      name: e.name,
      file: e.file,
      // A groupId naming no group falls back to ungrouped rather than to the raw
      // UUID: a store can outlive the group it points at, and a gallery heading
      // reading `a0ea675a-85ba-…` is worse than no heading.
      group: groupNames.get(e.groupId) ?? '',
    });
  }
  // Grouped shortcuts first, so a host rendering group headings emits each heading
  // once. Order WITHIN a group, and among the ungrouped, stays the store's.
  return [...out.filter((s) => s.group), ...out.filter((s) => !s.group)];
}

/**
 * The label catalog with usage counts, grouped by category.
 *
 * Counted from the members' own assignments rather than from the catalog, because
 * the two can disagree: a file may carry a label id the catalog does not define
 * (written by a release that knew it, or by a hand-edited store). Such an id is
 * counted under a category named for it, so the coverage figure stays consistent
 * with `labelledCount` instead of quietly excluding files it includes.
 */
function categoriesOf(parsed: ParsedProject): ProjectPageCategory[] {
  const counts = new Map<string, number>();
  for (const file of parsed.files) {
    // Per file, not per assignment: `parsed.files` already de-duplicates a file's
    // labels, so each hit here is one member carrying one label.
    for (const id of file.labels) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  const byCategory = new Map<string, ProjectPageLabel[]>();
  const push = (category: string, label: ProjectPageLabel): void => {
    const list = byCategory.get(category);
    if (list) {
      list.push(label);
    } else {
      byCategory.set(category, [label]);
    }
  };

  const defined = new Set<string>();
  for (const l of parsed.labels) {
    defined.add(l.id);
    push(l.category, {
      id: l.id,
      name: l.name,
      count: counts.get(l.id) ?? 0,
      custom: !l.readOnly,
    });
  }
  for (const [id, count] of counts) {
    if (!defined.has(id)) {
      push('', { id, name: id, count, custom: true });
    }
  }

  // Used labels first, then by name: the seven built-ins ship with every project
  // and most stay at zero, so catalog order buries the two or three that say
  // something about THIS project under five that say nothing about any.
  for (const labels of byCategory.values()) {
    labels.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  return [...byCategory.entries()].map(([name, labels]) => ({ name, labels }));
}
