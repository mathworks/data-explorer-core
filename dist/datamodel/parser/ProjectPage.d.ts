import type { ParsedProject } from './ProjectParser.js';
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
 * Project a parsed project into its page.
 *
 * Pure and total: every field is derived from `parsed`, and a project that holds
 * nothing yields a page of empty sections rather than a missing one — the sections
 * are what tell a user "this project defines no shortcuts", which is a fact worth
 * showing and not the same as a page that failed to render.
 */
export declare function buildProjectPage(parsed: ParsedProject): ProjectPage;
//# sourceMappingURL=ProjectPage.d.ts.map