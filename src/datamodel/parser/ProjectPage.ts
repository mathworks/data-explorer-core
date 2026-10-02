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
  /**
   * Members carrying this label. 0 is meaningful — a defined but unused label.
   *
   * `null` when the format records no member list (see `ProjectPage.memberCount`, which
   * carries the full reasoning). There are no member assignments to count, so the only
   * honest answer is "unknown", and 0 would claim the opposite of what `declaredFiles`
   * is about to show on the very same chip — a label declared against three paths, drawn
   * as used by nothing. Do not default it.
   */
  count: number | null;
  /** Defined by this project rather than shipped by MATLAB. */
  custom: boolean;
  /**
   * The files or patterns this label was declared AGAINST, as written.
   *
   * Carried straight through from `ProjectLabel.declaredFiles`, so `[]` on every XML
   * layout — those stores assign labels the other way round, per member file, and
   * `count` is the whole story there. For a `matlab.toml` project it is the only thing a
   * page can say about a label's reach, which is why it stands IN PLACE OF the count
   * rather than beside it.
   */
  declaredFiles: string[];
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
  /**
   * Where the referenced project lives, relative to this project's root — so
   * typically `../OtherProject/other.prj`. '' when the store recorded no path, which
   * is a reference a host cannot open and should not offer a link for.
   */
  path: string;
}

export interface ProjectPage {
  name: string;
  /** The raw `MetadataType`, for a host that wants to report it exactly. */
  format: string;
  /** English for `format` — what a MATLAB user sees in Project Settings. */
  formatLabel: string;
  /**
   * Every member, folders included: what the project "contains". `null` when the FORMAT
   * records no member list — `ParsedProject.membersEnumerated` false, which today means
   * a `matlab.toml` project.
   *
   * `null` rather than 0, and this is the entire reason the field is nullable: 0 is a
   * sentence, "this project contains nothing", and for a format whose members are "every
   * file under the project root" that sentence is false about a project holding hundreds
   * of them. The maintainer's decision is to declare only what the file declares — no
   * folder walk to synthesize a membership the document does not have — so the page shows
   * no count at all. A maintainer tidying the nullability away by defaulting to 0 would
   * be re-introducing precisely the false claim this exists to remove.
   *
   * `null` also costs nothing to honour downstream: the consuming webview's `esc()` takes
   * `string | number`, so a `null` reaching it is a compile error AT THE CALL SITE, which
   * forces a renderer to branch rather than print 'null'. A sentinel like -1 would have
   * type-checked and shipped.
   *
   * A damaged XML store still reports 0 here, which is correct — it enumerated nothing,
   * as against a format that enumerates nothing. See `membersEnumerated`.
   */
  memberCount: number | null;
  /**
   * Members carrying at least one label — the numerator of label coverage. `null` under
   * the same condition as `memberCount`, and for the same reason: with no denominator
   * there is no fraction to show, and "0 of 0 labelled" says something false about a
   * project whose labels name files nothing enumerated. What those labels WERE declared
   * against is on `ProjectPageLabel.declaredFiles`, which is what a page shows instead.
   */
  labelledCount: number | null;
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
    // `null`, not the length of an empty list: a format that records no member list has
    // no number to report here, and reporting one derived from `files: []` would state
    // something about the project that the document never said. See the two fields.
    memberCount: parsed.membersEnumerated ? parsed.files.length : null,
    labelledCount: parsed.membersEnumerated
      ? parsed.files.filter((f) => f.labels.length > 0).length
      : null,
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
    // The id is deliberately NOT the fallback target: it is a UUID, and a page that
    // linked it would offer to open a path that cannot exist. A reference the store
    // gave no path for is shown by name alone.
    references: parsed.references.map((r) => ({ name: r.name ?? r.id, path: r.path ?? '' })),
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
 *
 * Which is also why there are no counts AT ALL when the format records no member list:
 * the assignments the counts are made of are the thing that format does not have, so
 * every `count` here is `null` and the ordering falls back to the name. The catalog
 * itself survives — a `matlab.toml` declares its labels plainly, with the files each was
 * declared against — so the page still lists them, just without a number none of them
 * has. See `ProjectPage.memberCount` for why that is not 0.
 */
function categoriesOf(parsed: ParsedProject): ProjectPageCategory[] {
  const enumerated = parsed.membersEnumerated;
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
      count: enumerated ? counts.get(l.id) ?? 0 : null,
      custom: !l.readOnly,
      declaredFiles: l.declaredFiles,
    });
  }
  // The synthetic pass: ids the members carry that the catalog does not define. Guarded
  // on `enumerated` rather than left to come out empty on its own — `counts` is built
  // from `parsed.files`, which is empty for an unenumerated format, so the loop would
  // not run anyway, and a reader should not have to derive that to know this pass has
  // nothing to reconcile when there are no assignments to reconcile it against.
  if (enumerated) {
    for (const [id, count] of counts) {
      if (!defined.has(id)) {
        // No `declaredFiles`: this id exists only because a member carries it, so there
        // is no catalog entry it could have been declared on.
        push('', { id, name: id, count, custom: true, declaredFiles: [] });
      }
    }
  }

  // Used labels first, then by name: the seven built-ins ship with every project
  // and most stay at zero, so catalog order buries the two or three that say
  // something about THIS project under five that say nothing about any.
  //
  // Name alone when the counts are `null`, which they are all together or not at all
  // since they come from the one `enumerated`: an unknown usage is not a zero usage, so
  // there is nothing to put first, and `count ?? 0` here would quietly order every label
  // as if it were known to be unused. The `null` test is also what proves to the type
  // checker that the subtraction only ever sees numbers.
  for (const labels of byCategory.values()) {
    labels.sort((a, b) =>
      a.count === null || b.count === null
        ? a.name.localeCompare(b.name)
        : b.count - a.count || a.name.localeCompare(b.name),
    );
  }
  return [...byCategory.entries()].map(([name, labels]) => ({ name, labels }));
}
