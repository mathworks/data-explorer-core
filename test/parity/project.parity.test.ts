// Copyright 2026 The MathWorks, Inc.
//
// The PROJECT DEFINITION-FILE parity suite: one small project, written by MATLAB
// into all four of its metadata layouts, asserted to read back as the same project.
//
// `matlab.project.convertDefinitionFiles(root, matlab.project.DefinitionFiles.<F>)`
// rewrites a project's metadata in place, and there are four shapes it can take:
//
//   SingleFile          one resources/project/Project.xml, the whole store nested
//                       inside it, rooted at <project MetadataType="monolithic">
//                       rather than at <Info>. Read since v1.33.0 — the customer
//                       report that got it read is what this corpus exists for.
//   FixedPathMultiFile  a sidecar XML per entity under hash-named directories,
//                       declared `fixedPathV2` by the manifest. Two docs per
//                       entity: a `…d.xml` definition and a `…p.xml` pointer.
//   MultiFile           the same idea, declared `distributed`, one doc per entity.
//   Toml                a matlab.toml at the project ROOT — and no resources/ and
//                       NO .prj marker at all. Read, by a reader of its own
//                       (parser/TomlProject.ts), because there is no store here to
//                       walk; a host is pointed at the matlab.toml itself, the
//                       marker it would otherwise open having been deleted with
//                       resources/.
//
// Everything here is written by test/parity/matlab/gen_project.m; nothing in this
// file launches MATLAB, and project_truth.json is the only source of expected
// values that did not come out of our own parse. Each <Format>/parityProject is a
// real project — small enough to commit, complete enough to open — and the
// generator feeds it one of everything the seven collection readers look for.
//
// Three kinds of assertion, and the difference matters:
//   - THE LAYOUT IS REAL: each fixture is asserted to carry the on-disk shape its
//     format writes. Without it the parity comparison could pass vacuously, since
//     a corpus regenerated under one format would compare a project to itself.
//   - AGAINST MATLAB: what MATLAB says this project holds, through the project API
//     (`proj.Files`, `proj.StartupFiles`, `proj.Categories`, …) recorded per
//     format from the CONVERTED project — so MATLAB itself is the one saying all
//     four shapes describe the same project.
//   - ACROSS LAYOUTS: the three XML parses are equal but for the format token, and
//     the TOML parse agrees with them field by field on everything the TOML format
//     records. This is the claim multi-layout support makes, and the one a
//     wrong-but-consistent reader cannot satisfy.
//
// WHY THIS CORPUS EXISTS AT ALL, given a 1,371-line projectParser.test.ts: every
// store in that suite is hand-typed from reading a real project, which is the one
// thing test/parity/matlab/README.md says never to do. Real bytes immediately
// disproved two expectations those hand-typed stores had agreed with:
//   - `ReadOnly` has a vocabulary per element — 'READ_ONLY'/'WRITABLE' on a label,
//     '1'/'0' on a category — so the old presence test read a user's own
//     `WRITABLE` label as one of MATLAB's, and the project page drew it as a
//     built-in. No fixture had ever contained the word WRITABLE.
//   - the first startup file is spelled two ways. A long-lived project writes
//     `Value="HEAD"`; a project that just added two startup files writes no
//     Extension on the first one at all, and only the second carries a link. The
//     chain walk started at HEAD, found no head, and fell back to document order
//     — which is reversed here against the order MATLAB reports running them.
// Both were parser defects, and both are pinned below against MATLAB's answers.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseProject } from '../../src/datamodel/parser/ProjectParser.js';
import type { ParsedProject } from '../../src/datamodel/parser/ProjectParser.js';
import { TOML_PROJECT_FILE } from '../../src/datamodel/fileKinds.js';

const DIR = fileURLToPath(new URL('./artifacts/project/', import.meta.url));

// ---------------------------------------------------------------------------
// what MATLAB said
// ---------------------------------------------------------------------------

/** One label ASSIGNMENT on one file. `data` is '' when the label carries none. */
interface LabelTruth {
  category: string;
  name: string;
  data: string;
}

interface FileTruth {
  /** project-root-relative, forward slashes */
  path: string;
  isFolder: boolean;
  labels: LabelTruth[];
}

/**
 * One label DEFINITION in the catalog, and who owns it.
 *
 * `readOnly` is not a property MATLAB exposes — `properties` on a
 * `matlab.project.LabelDefinition` is {Name, FilePatterns, CategoryName}. It is
 * MATLAB's REFUSAL to remove one of its own, so `removeError` carries the error
 * identifier that answered. Keeping the identifier is what makes a refusal for
 * some other reason visible here rather than silently read as ownership.
 */
interface LabelDefTruth {
  name: string;
  readOnly: boolean;
  removeError: string;
}

interface CategoryTruth {
  name: string;
  dataType: string;
  singleValued: boolean;
  labels: LabelDefTruth[];
  readOnly: boolean;
  removeError: string;
}

interface ReferenceTruth {
  path: string;
  storedLocation: string;
  type: string;
}

interface FormatTruth {
  name: string;
  /** MATLAB's own name for the layout: `proj.DefinitionFilesType`. */
  definitionFilesType: string;
  files: FileTruth[];
  pathFolders: string[];
  /** in RUN order, not sorted — that is the claim. */
  startupFiles: string[];
  shutdownFiles: string[];
  shortcuts: string[];
  references: ReferenceTruth[];
  simulinkCacheFolder: string;
  simulinkCodeGenFolder: string;
  projectStartupFolder: string;
  categories: CategoryTruth[];
  /** MATLAB's own `lastwarn` for the conversion — '' when it warned about nothing. */
  convertWarning: string;
  convertWarningId: string;
}

interface ProjectTruth {
  release: string;
  version: string;
  formats: Record<string, FormatTruth>;
}

const TRUTH_FILE = DIR + 'project_truth.json';
const HAVE_TRUTH = existsSync(TRUTH_FILE);
const TRUTH: ProjectTruth = HAVE_TRUTH
  ? JSON.parse(readFileSync(TRUTH_FILE, 'utf8'))
  : ({ formats: {} } as ProjectTruth);

// ---------------------------------------------------------------------------
// the layout matrix
// ---------------------------------------------------------------------------
//
// Written down rather than sniffed, and then asserted against the fixture. These
// are the same rows as the table in test/parity/matlab/README.md, and they are
// what makes this suite a statement about FORMATS rather than about four
// directories that happen to agree.

interface Layout {
  /** the `matlab.project.DefinitionFiles` member the generator passed. */
  format: string;
  /** what the store DECLARES as its `MetadataType`, and so our `format`. */
  metadataType: string;
  /** `*.xml` documents under resources/project/ — 0 when there is no store. */
  storeDocs: number;
  /** a `<name>.prj` marker beside the store. */
  marker: boolean;
  /** a `matlab.toml` at the project root. */
  toml: boolean;
}

const LAYOUTS: Layout[] = [
  { format: 'SingleFile', metadataType: 'monolithic', storeDocs: 1, marker: true, toml: false },
  {
    format: 'FixedPathMultiFile',
    metadataType: 'fixedPathV2',
    storeDocs: 66,
    marker: true,
    toml: false,
  },
  { format: 'MultiFile', metadataType: 'distributed', storeDocs: 30, marker: true, toml: false },
  { format: 'Toml', metadataType: '', storeDocs: 0, marker: false, toml: true },
];

/** The three a host can open. Toml has its own section. */
const XML_LAYOUTS = LAYOUTS.filter((l) => !l.toml);

const rootOf = (format: string): string => join(DIR, format, 'parityProject');

/**
 * The project store, read the way the host reads it: a `matlab.toml` at the project
 * root, plus every `*.xml` under `resources/project/`, keyed by POSIX relpath from
 * the project ROOT. Mirrors `readProjectStore` in the vscode extension
 * (src/host/projectStore.ts), which is the only caller that builds one of these
 * from a directory.
 *
 * The two never coexist — the conversion into Toml deletes `resources/` — so this
 * collects both and lets `parseProject` dispatch, which is exactly the position the
 * host is in when it is handed a project folder.
 */
function storeOf(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const toml = join(root, TOML_PROJECT_FILE);
  if (existsSync(toml)) {
    out[TOML_PROJECT_FILE] = readFileSync(toml, 'utf8');
  }
  const base = join(root, 'resources', 'project');
  if (!existsSync(base)) {
    return out;
  }
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else if (/\.xml$/i.test(name)) {
        out[relative(root, p).split('\\').join('/')] = readFileSync(p, 'utf8');
      }
    }
  };
  walk(base);
  return out;
}

// A name the fixture does NOT contain, so every assertion on `parsed.name` is
// about what the store says and not about what was passed in. The host passes the
// `.prj` basename; the store's own Name wins when it has one.
const FALLBACK_NAME = 'not-the-project-name';

const parse = (format: string): ParsedProject =>
  parseProject(storeOf(rootOf(format)), FALLBACK_NAME);

/** `Category/Name` per label id, through the catalog the same parse returned. */
function assignedLabels(parsed: ParsedProject, path: string): string[] {
  const catalog = new Map(parsed.labels.map((l) => [l.id, l]));
  const file = parsed.files.find((f) => f.path === path);
  return (file?.labels ?? [])
    .map((id) => {
      const l = catalog.get(id);
      return l ? `${l.category}/${l.name}` : `<unresolved:${id}>`;
    })
    .sort();
}

const truthLabels = (t: FileTruth): string[] =>
  t.labels.map((l) => `${l.category}/${l.name}`).sort();

const filesOfKind = (parsed: ParsedProject, kind: string): string[] =>
  parsed.entryPoints.filter((e) => e.kind === kind).map((e) => e.file);

const HAVE_CORPUS = existsSync(DIR) && LAYOUTS.every((l) => existsSync(rootOf(l.format)));

describe('project definition-file parity', () => {
  if (!HAVE_TRUTH || !HAVE_CORPUS) {
    it.skip('corpus not generated — run gen_project.m (see test/parity/matlab/README.md)', () => {});
    return;
  }

  // ---- the layout is real --------------------------------------------------

  for (const layout of LAYOUTS) {
    it(`${layout.format} is on disk in the shape that format writes`, () => {
      const root = rootOf(layout.format);
      const store = storeOf(root);
      // The XML half of what the host collected, which is what `storeDocs` counts: a
      // `matlab.toml` is in the same map and is not a store document.
      expect(Object.keys(store).filter((k) => k.endsWith('.xml')).length).toBe(layout.storeDocs);
      expect(TOML_PROJECT_FILE in store).toBe(layout.toml);

      const entries = readdirSync(root);
      expect(entries.some((n) => n.endsWith('.prj'))).toBe(layout.marker);
      expect(entries.includes(TOML_PROJECT_FILE)).toBe(layout.toml);
      expect(existsSync(join(root, 'resources', 'project'))).toBe(layout.storeDocs > 0);
    });
  }

  it('SingleFile is ONE document, and it is the whole store', () => {
    const store = storeOf(rootOf('SingleFile'));
    expect(Object.keys(store)).toEqual(['resources/project/Project.xml']);
    // Rooted at <project>, not at <Info> — the trap the customer report turned on.
    // A reader indexing only `<Info>` roots finds nothing here and reports an empty
    // project, which is exactly what v1.33.0 fixed.
    const doc = store['resources/project/Project.xml'];
    expect(doc).toMatch(/<project\s+MetadataType="monolithic"/);
    expect(doc).toContain('<Files Location="Root">');
  });

  for (const layout of XML_LAYOUTS.filter((l) => l.metadataType !== 'monolithic')) {
    it(`${layout.format} declares ${layout.metadataType} in a manifest beside its sidecars`, () => {
      const store = storeOf(rootOf(layout.format));
      const manifest = store['resources/project/Project.xml'];
      expect(manifest).toMatch(
        new RegExp(`<Info\\s+MetadataType="${layout.metadataType}"\\s*/>`),
      );
      // A manifest and sidecars, which is what makes this a different layout and
      // not the monolithic document under another name.
      expect(Object.keys(store).length).toBeGreaterThan(1);
    });
  }

  // ---- against MATLAB ------------------------------------------------------

  for (const layout of XML_LAYOUTS) {
    const t = TRUTH.formats[layout.format];

    describe(`${layout.format} against MATLAB`, () => {
      const parsed = parse(layout.format);

      it('reads without warnings, and names itself from the store', () => {
        expect(parsed.warnings).toEqual([]);
        expect(parsed.name).toBe(t.name);
        expect(parsed.name).not.toBe(FALLBACK_NAME);
      });

      it(`reports the layout MATLAB calls ${layout.format}`, () => {
        expect(t.definitionFilesType).toBe(layout.format);
        expect(parsed.format).toBe(layout.metadataType);
      });

      it('holds the members MATLAB lists, folders marked as folders', () => {
        expect(parsed.files.map((f) => ({ path: f.path, isFolder: f.isFolder }))).toEqual(
          t.files.map((f) => ({ path: f.path, isFolder: f.isFolder })),
        );
      });

      it('assigns each member the labels MATLAB assigned it', () => {
        for (const file of t.files) {
          expect(assignedLabels(parsed, file.path), file.path).toEqual(truthLabels(file));
        }
        // The one assignment that is not a built-in: a user's own label, carrying
        // data. We model the ASSIGNMENT and not the data — `ProjectFile.labels` is
        // a list of ids — so MATLAB's 'by parity' has nowhere to land here. Stated
        // rather than asserted away: the project page shows which labels a file
        // carries, not what each one says.
        const helper = t.files.find((f) => f.path === 'utils/helper.m');
        expect(helper?.labels.find((l) => l.name === 'Checked')?.data).toBe('by parity');
      });

      it('defines the label catalog MATLAB defines, with the same owner per label', () => {
        const expected = t.categories.flatMap((c) =>
          c.labels.map((l) => ({ category: c.name, name: l.name, readOnly: l.readOnly })),
        );
        const actual = parsed.labels.map((l) => ({
          category: l.category,
          name: l.name,
          readOnly: l.readOnly,
        }));
        const key = (l: { category: string; name: string }): string => `${l.category}/${l.name}`;
        expect([...actual].sort((a, b) => key(a).localeCompare(key(b)))).toEqual(
          [...expected].sort((a, b) => key(a).localeCompare(key(b))),
        );
      });

      it("the ownership expectation is MATLAB's refusal, not a reading of an attribute", () => {
        // What makes the previous test authoritative. Every read-only label is one
        // MATLAB refused to remove, by the identifier that means ownership; every
        // writable one it removed without complaint. A future release refusing for
        // a different reason fails HERE, where the record is, instead of quietly
        // becoming the expectation.
        for (const c of t.categories) {
          for (const l of c.labels) {
            expect(l.removeError, `${c.name}/${l.name}`).toBe(
              l.readOnly ? 'MATLAB:project:management:CanNotModifyReadOnlyLabel' : '',
            );
          }
        }
        const builtIn = t.categories.find((c) => c.name === 'Classification');
        expect(builtIn?.labels.every((l) => l.readOnly)).toBe(true);
        expect(builtIn?.removeError).toBe(
          'MATLAB:project:management:CanNotModifyReadOnlyCategory',
        );
        const mine = t.categories.find((c) => c.name === 'Review');
        expect(mine?.labels.map((l) => l.readOnly)).toEqual([false]);
      });

      it('puts the project path folders MATLAB has on the path', () => {
        expect(parsed.pathFolders).toEqual(t.pathFolders);
      });

      it('puts the startup and shutdown files in the order MATLAB runs them', () => {
        expect(filesOfKind(parsed, 'StartUp')).toEqual(t.startupFiles);
        expect(filesOfKind(parsed, 'Shutdown')).toEqual(t.shutdownFiles);
        // Two startup files on purpose: with one, any order is the right order.
        expect(t.startupFiles.length).toBe(2);
        // Hooks are hidden and shortcuts are shown — MATLAB's Shortcuts gallery
        // holds the latter only, and `visible` is how the store says which.
        for (const e of parsed.entryPoints) {
          expect(e.visible, e.name).toBe(e.kind === 'Basic');
        }
      });

      it('holds the shortcut MATLAB holds', () => {
        expect(filesOfKind(parsed, 'Basic').sort()).toEqual([...t.shortcuts].sort());
      });

      it('resolves the referenced project', () => {
        expect(parsed.references.map((r) => r.path)).toEqual(t.references.map((r) => r.path));
        // The name is DERIVED — the store element carries `Ref="../parityLib"` and
        // `Type="Relative"` and no name at all, so the basename is the only name
        // there is. Not a MATLAB field, which is why this is asserted against the
        // path and not against the truth record.
        expect(parsed.references.map((r) => r.name)).toEqual(['parityLib']);
        expect(t.references.map((r) => r.type)).toEqual(['Relative']);
      });

      it('designates the working folders MATLAB designates', () => {
        const wf = new Map(parsed.workingFolders.map((w) => [w.key, w.ref]));
        expect(wf.get('SimulinkCacheFolder')).toBe(t.simulinkCacheFolder);
        expect(wf.get('SimulinkCodeGenFolder')).toBe(t.simulinkCodeGenFolder);
        expect(wf.get('ProjectStartupFolder')).toBe(t.projectStartupFolder);
      });
    });
  }

  // ---- across layouts ------------------------------------------------------

  it('converted losslessly, which is what licenses the comparison below', () => {
    // MATLAB's own `lastwarn` for each conversion. The three XML formats warn
    // about nothing; the Toml one does, and is compared separately for that
    // reason.
    for (const layout of XML_LAYOUTS) {
      expect(TRUTH.formats[layout.format].convertWarningId, layout.format).toBe('');
    }
  });

  for (const layout of XML_LAYOUTS.filter((l) => l.format !== 'SingleFile')) {
    it(`${layout.format} reads as the same project as SingleFile`, () => {
      // Everything, not a field list: the whole parse but for the one field that
      // is SUPPOSED to differ. Conversion preserves the entities' UUIDs, so even
      // the ids compare — and a reader that invented an id per layout, or dropped
      // a collection in one of them, cannot pass this.
      const reference = { ...parse('SingleFile'), format: '' };
      const other = { ...parse(layout.format), format: '' };
      expect(other).toEqual(reference);
    });
  }

  // ---- Toml: the one format that is not a store at all ---------------------

  describe('Toml', () => {
    const root = rootOf('Toml');
    const t = TRUTH.formats.Toml;
    const parsed = parse('Toml');

    it('has no .prj and no store: one matlab.toml at the root is the definition', () => {
      // The answer to "where did the .prj go": the conversion deletes it along
      // with resources/. So a host cannot be pointed at a marker here, and the
      // file it opens is the definition itself — which is also why nothing in
      // this layout reaches the store walk `parseProject` otherwise is.
      expect(readdirSync(root).some((n) => n.endsWith('.prj'))).toBe(false);
      expect(existsSync(join(root, 'resources'))).toBe(false);
      expect(existsSync(join(root, TOML_PROJECT_FILE))).toBe(true);
      expect(readFileSync(join(root, TOML_PROJECT_FILE), 'utf8')).toContain(
        'name = "parityProject"',
      );
    });

    it('reads whole, and reports the format as this package names it', () => {
      expect(parsed.warnings).toEqual([]);
      expect(parsed.name).toBe(t.name);
      expect(parsed.name).not.toBe(FALLBACK_NAME);
      // The one `format` value that is NOT a declared `MetadataType`: there is no
      // store here to declare one, so it is this package's own name for the format.
      expect(t.definitionFilesType).toBe('Toml');
      expect(parsed.format).toBe('toml');
    });

    it('enumerates NO members, where every XML layout does', () => {
      // `files: []` means something different here than it does anywhere else in
      // this suite, and `membersEnumerated` is the field that says which. MATLAB's
      // rule for this format is that the files in the project root ARE the members
      // — about the filesystem, not about the document — so a member list is a
      // sentence this reader is not entitled to say. MATLAB itself reports nine
      // members for the converted project; the document names none of them.
      expect(parsed.membersEnumerated).toBe(false);
      expect(parsed.files).toEqual([]);
      expect(t.files.length).toBe(9);

      const xml = parse('SingleFile');
      expect(xml.membersEnumerated).toBe(true);
      expect(xml.files.length).toBe(TRUTH.formats.SingleFile.files.length);
    });

    it('holds what MATLAB says the converted project holds, less its member list', () => {
      expect(parsed.pathFolders).toEqual(t.pathFolders);
      expect(filesOfKind(parsed, 'StartUp')).toEqual(t.startupFiles);
      expect(filesOfKind(parsed, 'Shutdown')).toEqual(t.shutdownFiles);
      expect(filesOfKind(parsed, 'Basic')).toEqual(t.shortcuts);
      expect(parsed.references.map((r) => r.path)).toEqual(t.references.map((r) => r.path));
      const wf = new Map(parsed.workingFolders.map((w) => [w.key, w.ref]));
      expect(wf.get('ProjectStartupFolder')).toBe(t.projectStartupFolder);
      expect(wf.get('SimulinkCacheFolder')).toBe(t.simulinkCacheFolder);
      expect(wf.get('SimulinkCodeGenFolder')).toBe(t.simulinkCodeGenFolder);
    });

    it('defines the one label category that survived, with the file it declares', () => {
      // The inverted assignment, and the only place those paths can live: an XML
      // store records labels per MEMBER file, and this format has no member list,
      // so the label carries the files instead. `readOnly: false` on it is not a
      // reading of an attribute — the format records no ownership, which is why
      // MATLAB's own conversion dropped the read-only category entirely.
      expect(parsed.labels).toEqual([
        {
          id: 'Review/Checked',
          category: 'Review',
          name: 'Checked',
          readOnly: false,
          declaredFiles: ['utils/helper.m'],
        },
      ]);
      // The same relationship the XML layout records the other way round, which is
      // what makes the `declaredFiles` list a reading of this project rather than
      // of this document.
      expect(assignedLabels(parse('SingleFile'), 'utils/helper.m')).toContain('Review/Checked');
    });

    it('reads as the same project as the XML layouts, on everything the format records', () => {
      // Not `toEqual` on the whole parse, as the three XML layouts are compared to
      // each other, and the exclusions are the point:
      //   - the IDS. Conversion preserves MATLAB's UUIDs between XML layouts, so
      //     those compare; this format records no UUID anywhere, so every id here
      //     is synthetic (`StartUp:startup_one.m`, `Review/Checked`, the
      //     dependency's own key) and a comparison on one would be a comparison of
      //     two unrelated naming schemes.
      //   - `files`, `membersEnumerated` and the label CATALOG, which the format
      //     does not record — measured above, and in the lossiness test below.
      // Everything else must agree, entry-point ORDER included: run order is a
      // linked list in a store and an array here, and the two must come out the
      // same sequence.
      const shape = (p: ParsedProject): unknown => ({
        name: p.name,
        pathFolders: p.pathFolders,
        entryPoints: p.entryPoints.map((e) => ({
          name: e.name,
          file: e.file,
          kind: e.kind,
          visible: e.visible,
          groupId: e.groupId,
        })),
        entryPointGroups: p.entryPointGroups,
        workingFolders: p.workingFolders,
        references: p.references.map((r) => ({ name: r.name, path: r.path })),
      });
      for (const layout of XML_LAYOUTS) {
        expect(shape(parsed), layout.format).toEqual(shape(parse(layout.format)));
      }
      // And the shortcut's NAME agrees for a reason worth stating: the XML store
      // carries a `Name` attribute MATLAB fills with the file's stem, and this
      // format has only the key — so the two agree because MATLAB writes the key as
      // that same stem, not because either side derived the other.
      expect(parsed.entryPoints.filter((e) => e.kind === 'Basic').map((e) => e.name)).toEqual([
        'main',
      ]);
    });

    it('is LOSSY, and MATLAB says so in its own words', () => {
      expect(t.convertWarningId).toBe('MATLAB:Project:Issues:LabelDataLoss');
      expect(t.convertWarning).toContain('Unable to preserve label data');

      // What that cost, as MATLAB reports the converted project. Recorded so the
      // loss stays a measured property of the format rather than folklore:
      //   - the whole built-in Classification category is gone, and with it every
      //     Design assignment the three XML formats keep;
      const categories = t.categories.map((c) => c.name);
      expect(categories).toEqual(['Review']);
      const design = t.files.flatMap((f) => f.labels.filter((l) => l.name === 'Design'));
      expect(design).toEqual([]);
      //   - the custom category survives but its dataType does not, so the label
      //     keeps its name and loses the 'by parity' data it carried;
      expect(t.categories[0].dataType).toBe('none');
      expect(TRUTH.formats.SingleFile.categories.find((c) => c.name === 'Review')?.dataType).toBe(
        'char',
      );
      const checked = t.files
        .flatMap((f) => f.labels)
        .filter((l) => l.name === 'Checked')
        .map((l) => l.data);
      expect(checked).toEqual(['']);
      //   - and the two working folders become ordinary members, because the file
      //     has a place to record a path and none to record what it is for.
      const members = t.files.map((f) => f.path);
      expect(members).toContain('cache');
      expect(members).toContain('codegen');
      expect(TRUTH.formats.SingleFile.files.map((f) => f.path)).not.toContain('cache');
      // The one thing that does survive intact, and the reason the run-order claim
      // above is about the project and not about XML: MATLAB still reports the same
      // two startup files in the same order.
      expect(t.startupFiles).toEqual(TRUTH.formats.SingleFile.startupFiles);
    });
  });
});
