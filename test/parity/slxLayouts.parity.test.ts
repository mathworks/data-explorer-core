// Copyright 2026 The MathWorks, Inc.
//
// The `.slx` LAYOUT parity suite: one block diagram, saved by MATLAB into five
// different part layouts, asserted to open to the SAME data model.
//
// A `.slx` is not one format. It is an OPC zip whose part set changed five times,
// and the JSON parts this parser was first written against arrived in R2026b — so
// every `.slx` written before that is XML, which is very nearly every `.slx` in
// existence. The layouts, oldest last:
//
//   slxcases.slx          current release: blockDiagram.json, configSetInfo.json,
//                         graphicalInterface.json, modelWorkspace.mxarray,
//                         systems/*.xml. The reference every other file is held to.
//   slxcases_R2025a.slx   graphicalInterface is JSON; block diagram and config set
//                         index are still XML. The R2024b-R2026a era.
//   slxcases_R2021a.slx   all three XML. The R2020a-R2024a era — five years, and so
//                         the file most likely to turn up in practice.
//   slxcases_R2018a.slx   blocks live INSIDE blockdiagram.xml (no systems/ parts)
//                         and the workspace is modelworkspace.mat, a plain
//                         MAT-file. The R2015a-R2019a era.
//   slxcases_R2013b.slx   no configSetInfo part and no graphicalInterface part at
//                         all: both are inline in the block diagram.
//
// plus two more models, each asking the same question of a different KIND of content
// rather than a different diagram:
//   slxws       a model workspace backed by an external `.mat`, in three layouts.
//   slxcfgref   a `Simulink.ConfigSetRef` — a REFERENCE to a configuration set kept in
//               a data dictionary — in all five. Its point is that the class is a JSON
//               field in one layout and an XML `ClassName=` attribute in four, and that
//               the property naming what it points at was renamed between R2018a
//               (`WSVarName`) and R2021a (`SourceName`). A reader that misses either
//               reports a plain set with no source, which is what this repo did.
//
// All of it is written by test/parity/matlab/gen_slx.m; nothing here launches
// MATLAB, and slx_truth.json is the only source of expected values that did not
// come out of our own parse.
//
// Three kinds of assertion, and the difference matters:
//   - THE LAYOUT IS REAL: each fixture is asserted to carry the parts its era wrote.
//     Without this the parity comparison could pass vacuously — a corpus
//     accidentally regenerated from one release would compare a file to itself.
//   - AGAINST MATLAB: what MATLAB says the diagram holds (slx_truth.json), through
//     the same expect.ts convention every other corpus is held to.
//   - ACROSS LAYOUTS: the legacy rows equal the current-release rows. This is the
//     claim legacy support makes, and it is the one a wrong-but-consistent reader
//     cannot satisfy, because the reference side is read by code that predates it.
//
// The divergences that are REAL and expected are asserted too, so they stay
// deliberate rather than becoming folklore:
//   - `ModelUUID` arrived in R2020a. Before it, the file has none, and reporting one
//     would mean inventing a value the file never claimed.
//   - data dictionaries arrived in R2014a, so R2013b drops the link on export —
//     MATLAB says so itself, and the generator recorded its warning verbatim.
//   - exporting RENAMES the block diagram after the target file, and R2013b writes
//     that name into a reference block path where later releases write `$bdroot`.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFile } from './loadFile.js';
import { expectedDisplay, literalMatches } from './matlab/expect.js';
import { asArray, asVarTruth } from './matlab/loadTruth.js';
import type { ModelTruth } from './matlab/loadTruth.js';
import { expectedUsages as usagesOf } from './paramPolicy.js';

const SLX_DIR = fileURLToPath(new URL('./artifacts/slx_layouts/', import.meta.url));

/** One `save_system(..., 'ExportToVersion', v)` as gen_slx.m recorded it. */
interface ExportTruth {
  version: string;
  file: string;
  /** MATLAB's own `lastwarn` for that export — '' when it warned about nothing. */
  lastWarning: string;
}

interface SlxTruth {
  slxcases: ModelTruth;
  exports: ExportTruth[];
  slxws: ModelTruth;
  wsExports: ExportTruth[];
  slxcfgref: ModelTruth;
  cfgExports: ExportTruth[];
  matlab: { version: string; release: string };
}

const TRUTH_FILE = SLX_DIR + 'slx_truth.json';
const HAVE_TRUTH = existsSync(TRUTH_FILE);
const TRUTH: SlxTruth = HAVE_TRUTH
  ? JSON.parse(readFileSync(TRUTH_FILE, 'utf8'))
  : ({ exports: [], wsExports: [], cfgExports: [] } as unknown as SlxTruth);

// ---------------------------------------------------------------------------
// the layout matrix
// ---------------------------------------------------------------------------
//
// Written down rather than sniffed, and then asserted against the fixture. These
// are the same rows as the table in test/parity/matlab/README.md, and they are
// what makes this suite a statement about RELEASES rather than about five files
// that happen to agree.

type PartFlavour = 'json' | 'xml' | 'inline';
// `external` = backed by a `.mat` beside the model; `none` = the model workspace is
// EMPTY, so no release writes a part for it. Both name no part, and the difference
// between them is why they are not one token: one is a storage choice the parser has
// to read out of the block diagram, the other is nothing to read.
type WorkspacePart = 'mxarray' | 'mat' | 'external' | 'none';

interface Era {
  file: string;
  /** as `ExportToVersion` names it; null for the file the current release wrote. */
  version: string | null;
  blockDiagram: 'json' | 'xml';
  configSetInfo: PartFlavour;
  graphicalInterface: PartFlavour;
  workspace: WorkspacePart;
  /** each system in a `systems/*.xml` part of its own, rather than inline. */
  systemParts: boolean;
  /** the release stamps a ModelUUID (R2020a on). */
  uuid: boolean;
  /** the release can link a data dictionary (R2014a on). */
  dictionary: boolean;
  /** the release writes `$bdroot` into a reference block path, not the model name. */
  bdroot: boolean;
}

const CASES: Era[] = [
  { file: 'slxcases.slx', version: null,
    blockDiagram: 'json', configSetInfo: 'json', graphicalInterface: 'json',
    workspace: 'mxarray', systemParts: true, uuid: true, dictionary: true, bdroot: true },
  { file: 'slxcases_R2025a.slx', version: 'R2025a',
    blockDiagram: 'xml', configSetInfo: 'xml', graphicalInterface: 'json',
    workspace: 'mxarray', systemParts: true, uuid: true, dictionary: true, bdroot: true },
  { file: 'slxcases_R2021a.slx', version: 'R2021a',
    blockDiagram: 'xml', configSetInfo: 'xml', graphicalInterface: 'xml',
    workspace: 'mxarray', systemParts: true, uuid: true, dictionary: true, bdroot: true },
  { file: 'slxcases_R2018a.slx', version: 'R2018a',
    blockDiagram: 'xml', configSetInfo: 'xml', graphicalInterface: 'xml',
    workspace: 'mat', systemParts: false, uuid: false, dictionary: true, bdroot: true },
  { file: 'slxcases_R2013b.slx', version: 'R2013b',
    blockDiagram: 'xml', configSetInfo: 'inline', graphicalInterface: 'inline',
    workspace: 'mat', systemParts: false, uuid: false, dictionary: false, bdroot: false },
];

const WS_CASES: Era[] = [
  { file: 'slxws.slx', version: null,
    blockDiagram: 'json', configSetInfo: 'json', graphicalInterface: 'json',
    workspace: 'external', systemParts: true, uuid: true, dictionary: true, bdroot: true },
  { file: 'slxws_R2021a.slx', version: 'R2021a',
    blockDiagram: 'xml', configSetInfo: 'xml', graphicalInterface: 'xml',
    workspace: 'external', systemParts: true, uuid: true, dictionary: true, bdroot: true },
  { file: 'slxws_R2018a.slx', version: 'R2018a',
    blockDiagram: 'xml', configSetInfo: 'xml', graphicalInterface: 'xml',
    workspace: 'external', systemParts: false, uuid: false, dictionary: true, bdroot: true },
];

// A configuration set REFERENCE, in every layout. Its own family because it is a
// different kind of ENTRY in a section the other two already fill, and because the
// place it is recorded moves twice across these five files — docs/TODO.md item 15,
// measured by test/parity/matlab/probe_configsetref.m before any of it was written.
//
// The workspace is empty in all five, which is the point of the `none` flavour: this
// model exists to say something about the config section and nothing else.
const CFGREF_CASES: Era[] = [
  { file: 'slxcfgref.slx', version: null,
    blockDiagram: 'json', configSetInfo: 'json', graphicalInterface: 'json',
    workspace: 'none', systemParts: true, uuid: true, dictionary: true, bdroot: true },
  { file: 'slxcfgref_R2025a.slx', version: 'R2025a',
    blockDiagram: 'xml', configSetInfo: 'xml', graphicalInterface: 'json',
    workspace: 'none', systemParts: true, uuid: true, dictionary: true, bdroot: true },
  { file: 'slxcfgref_R2021a.slx', version: 'R2021a',
    blockDiagram: 'xml', configSetInfo: 'xml', graphicalInterface: 'xml',
    workspace: 'none', systemParts: true, uuid: true, dictionary: true, bdroot: true },
  { file: 'slxcfgref_R2018a.slx', version: 'R2018a',
    blockDiagram: 'xml', configSetInfo: 'xml', graphicalInterface: 'xml',
    workspace: 'none', systemParts: false, uuid: false, dictionary: true, bdroot: true },
  { file: 'slxcfgref_R2013b.slx', version: 'R2013b',
    blockDiagram: 'xml', configSetInfo: 'inline', graphicalInterface: 'inline',
    workspace: 'none', systemParts: false, uuid: false, dictionary: false, bdroot: false },
];

/** The part each flavour of a named part lives in. `inline` means: no part at all. */
const PART_OF: Record<string, Record<string, string | null>> = {
  blockDiagram: { json: 'simulink/blockDiagram.json', xml: 'simulink/blockdiagram.xml' },
  configSetInfo: { json: 'simulink/configSetInfo.json', xml: 'simulink/configSetInfo.xml', inline: null },
  graphicalInterface: {
    json: 'simulink/graphicalInterface.json',
    xml: 'simulink/graphicalInterface.xml',
    inline: null,
  },
  workspace: {
    mxarray: 'simulink/modelWorkspace.mxarray',
    mat: 'simulink/modelworkspace.mat',
    external: null,
    none: null,
  },
};

// ---------------------------------------------------------------------------
// reading the data model
// ---------------------------------------------------------------------------

function load(file: string): any {
  return loadFile('./artifacts/slx_layouts/' + file, file);
}

function rows(model: any, section: string): any[] {
  return model.getSection(section).children;
}

function byName(model: any, section: string): Map<string, any> {
  return new Map(rows(model, section).map((n: any) => [n.name, n]));
}

/** `slxcases_R2013b.slx` -> `slxcases_R2013b`. */
function stem(file: string): string {
  return file.replace(/\.slx$/i, '');
}

/**
 * A reference block path with the model's own name folded back to `$bdroot`.
 *
 * `ExportToVersion` renames the block diagram after the target file, and R2013b
 * writes that name into the path where every later release writes the literal
 * `$bdroot`. So the name recorded in the file is the only safe prefix to strip —
 * the same normalisation the classic `.mdl` suite needs, for the same reason.
 */
function atBdroot(file: string, path: string): string {
  const prefix = stem(file);
  return path === prefix ? '$bdroot' : path.replace(new RegExp('^' + prefix + '(?=/)'), '$bdroot');
}

/**
 * Everything about a loaded model that must NOT depend on which layout it came out
 * of. Sorted, because part order differs by layout: a current-release file reads its
 * systems in zip-entry order (`system_7.xml` before `system_root.xml`) while a
 * legacy file reads them in diagram order. Order is not part of the claim; content
 * is.
 *
 * Deliberately NOT in here: the linked dictionary and the model uuid, both of which
 * legitimately differ by release and get their own tests below.
 */
function shape(file: string, model: any): Record<string, string[]> {
  return {
    blocks: rows(model, 'blocks')
      .map((n: any) => n.displayName + ' :: ' + n.displayValue + ' :: ' + n.className)
      .sort(),
    workspace: rows(model, 'workspace')
      .map((n: any) => [n.displayName, n.dataType, n.className, n.displayValue].join(' :: '))
      .sort(),
    // The className is in here because an entry in this section may be a REFERENCE to
    // a config set rather than a set, and the across-layouts claim is worth nothing if
    // one layout can quietly downgrade one to the other. `SourceName` rides along for
    // the same reason: it is the whole content of a reference.
    config: rows(model, 'config')
      .map((n: any) => [n.displayName, n.active ? 'active' : 'inactive', n.className,
                        n.SourceName ?? ''].join(' :: '))
      .sort(),
    references: rows(model, 'references')
      .map((n: any) => n.displayName + ' :: ' + atBdroot(file, n.blockPath))
      .sort(),
  };
}

function have(files: string[]): boolean {
  return files.every((f) => existsSync(SLX_DIR + f));
}

/** MATLAB's own `lastwarn` from the export that wrote `file`, or ''. */
function exportWarning(file: string): string {
  const all = [
    ...asArray(TRUTH.exports), ...asArray(TRUTH.wsExports), ...asArray(TRUTH.cfgExports),
  ];
  return all.find((e) => e.file === file)?.lastWarning ?? '';
}

// ---------------------------------------------------------------------------

for (const [key, eras] of [
  ['slxcases', CASES], ['slxws', WS_CASES], ['slxcfgref', CFGREF_CASES],
] as [string, Era[]][]) {
  const t: ModelTruth | undefined = (TRUTH as unknown as Record<string, ModelTruth>)[key];
  const files = eras.map((e) => e.file);

  describe('.slx layout parity — ' + key, () => {
    if (!HAVE_TRUTH || !t || !have(files)) {
      it.skip('corpus not generated — run gen_slx.m (see test/parity/matlab/README.md)', () => {});
      return;
    }

    const [current, ...legacy] = eras;
    const reference = load(current.file);
    const referenceShape = shape(current.file, reference);

    // ---- the layout is real ------------------------------------------------
    for (const era of eras) {
      it(era.file + ' carries the parts ' + (era.version ?? 'the current release') + ' wrote', () => {
        const parts: Record<string, Uint8Array> = load(era.file)._zipEntries;
        expect(parts, 'a .slx is an OPC zip and must expose its parts').toBeTruthy();

        for (const [name, flavour] of Object.entries({
          blockDiagram: era.blockDiagram,
          configSetInfo: era.configSetInfo,
          graphicalInterface: era.graphicalInterface,
          workspace: era.workspace,
        })) {
          // Every OTHER flavour of the same part must be absent, so a fixture cannot
          // quietly satisfy two rows of the matrix at once. `inline` and `external`
          // name no part, so those eras assert every flavour absent.
          for (const [other, path] of Object.entries(PART_OF[name])) {
            if (path === null) { continue; }
            expect(
              Object.prototype.hasOwnProperty.call(parts, path),
              era.file + ': ' + path + ' should be ' + (other === flavour ? 'present' : 'absent'),
            ).toBe(other === flavour);
          }
        }

        const systems = Object.keys(parts).filter(
          (k) => k.startsWith('simulink/systems/') && k.endsWith('.xml'),
        );
        expect(systems.length > 0, era.file + ': systems/*.xml parts').toBe(era.systemParts);
      });
    }

    it('the block diagram part changes CASE at the JSON flip, not just extension', () => {
      // `blockdiagram.xml` has a lowercase `d` and `blockDiagram.json` a capital `D`.
      // Both are real part names, so a case-insensitive lookup would be a bug rather
      // than a shortcut — this pins that the corpus actually contains both spellings.
      const names = new Set<string>();
      for (const era of eras) {
        for (const k of Object.keys(load(era.file)._zipEntries)) {
          if (/^simulink\/blockdiagram\.(xml|json)$/i.test(k)) { names.add(k); }
        }
      }
      expect([...names].sort()).toEqual(['simulink/blockDiagram.json', 'simulink/blockdiagram.xml']);
    });

    // ---- across layouts ----------------------------------------------------
    for (const era of legacy) {
      it(era.file + ' opens to the same rows as ' + current.file, () => {
        expect(shape(era.file, load(era.file))).toEqual(referenceShape);
      });
    }

    it('every layout agrees on who saved it', () => {
      const creators = new Set(eras.map((e) => load(e.file).creator));
      expect(creators.size).toBe(1);
      expect([...creators][0]).not.toBe('');
    });

    // ---- against MATLAB, per file -----------------------------------------
    for (const era of eras) {
      describe(era.file, () => {
        const model = load(era.file);

        it('is one source named after the file', () => {
          expect(model.name).toBe(era.file);
        });

        it('reports the release that wrote it', () => {
          expect(model.release).toBe(era.version ?? 'R' + TRUTH.matlab.release);
          expect(model.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        });

        it(
          era.uuid
            ? 'reports the uuid MATLAB stamped'
            : 'reports no uuid — ModelUUID arrived in R2020a and this file has none',
          () => {
            // Nothing here invents a uuid for a file that never claimed one. The
            // alternative — hashing the bytes, say — would produce a value that looks
            // like MATLAB's and is not, which is worse than an empty column.
            if (era.uuid) {
              expect(model.uuid).toMatch(/^[0-9a-f-]{36}$/);
            } else {
              expect(model.uuid).toBe('');
            }
          },
        );

        it('surfaces exactly the parameter references MATLAB’s model implies', () => {
          const actual = model.blockParamUsages
            .map((u: any) => [u.blockName, u.blockType, u.paramProperty + '=' + u.paramValue].join('|'))
            .sort();
          expect(actual).toEqual(usagesOf(asArray(t.blocks)));
        });

        it('lists every block that has at least one parameter reference', () => {
          const wanted = new Set(usagesOf(asArray(t.blocks)).map((u) => u.split('|')[0]));
          expect(rows(model, 'blocks').map((n: any) => n.name).sort()).toEqual([...wanted].sort());
        });

        const nested = asArray(t.blocks).find((b) => b.type === 'SubSystem');
        if (nested) {
          it('reaches a block inside a subsystem', () => {
            // Named separately from the row-list assertion above because it is the one
            // thing the pre-R2020a layout can silently lose, and losing it looks like a
            // smaller model rather than an error: a subsystem's blocks live in a
            // `<System>` nested INSIDE the SubSystem block, where R2020a and later give
            // each system a part of its own. Held to the name, so it cannot be satisfied
            // by some other block turning up in its place.
            expect(rows(model, 'blocks').map((n: any) => n.name)).toContain('InnerGain');
          });
        }

        it('holds the config sets MATLAB reports, with the same one active', () => {
          // R2014b and earlier keep these INLINE in the block diagram, and which one is
          // active is recoverable there rather than guessed: an
          // `<Object PropName="ActiveConfigurationSet" ObjectID="N">` points at one.
          const wanted = asArray(t.configSets)
            .map((c) => [c.name, c.active ? 'active' : 'inactive', c.class,
                         c.sourceName ?? ''].join(' :: '))
            .sort();
          expect(shape(era.file, model).config).toEqual(wanted);
        });

        it('names the models MATLAB says are referenced', () => {
          expect(rows(model, 'references').map((n: any) => n.name.replace(/\.slx$/, '')).sort()).toEqual(
            asArray(t.modelReferences).sort(),
          );
        });

        it(
          era.bdroot
            ? 'roots every reference block path at $bdroot'
            : 'roots every reference block path at the model’s own name — R2013b writes no $bdroot',
          () => {
            for (const ref of rows(model, 'references')) {
              if (era.bdroot) {
                expect(ref.blockPath).toMatch(/^\$bdroot(\/|$)/);
              } else {
                expect(ref.blockPath.startsWith(stem(era.file)), ref.blockPath).toBe(true);
              }
            }
          },
        );

        it(
          era.dictionary
            ? 'links the dictionary MATLAB reports'
            : 'has no linked dictionary — R2013b predates them and MATLAB dropped the link',
          () => {
            const wanted = era.dictionary ? t.dataDictionary || null : null;
            expect(model.dataDictionary).toBe(wanted);
            const dicts = rows(model, 'dataSources')
              .filter((n: any) => n.name.endsWith('.sldd'))
              .map((n: any) => n.name);
            expect(dicts).toEqual(wanted ? [wanted] : []);
            if (!era.dictionary && t.dataDictionary) {
              // The expectation in MATLAB's own words: it warned, on this very export,
              // that the target release cannot use a data dictionary.
              expect(exportWarning(era.file).toLowerCase()).toContain('data dictionar');
            }
          },
        );

        if (era.workspace === 'external') {
          it('keeps no workspace of its own — the variables live in the .mat it points at', () => {
            expect(t.wsDataSource).toBe('MAT-File');
            expect(rows(model, 'workspace')).toEqual([]);
            const mats = rows(model, 'dataSources')
              .filter((n: any) => n.name.endsWith('.mat'))
              .map((n: any) => n.name);
            expect(mats).toEqual(['slxws_data.mat']);
          });
        } else {
          it('keeps the model workspace in the model itself', () => {
            expect(t.wsDataSource).toBe('Model File');
            const mats = rows(model, 'dataSources').filter((n: any) => n.name.endsWith('.mat'));
            expect(mats).toEqual([]);
          });

          it('holds the workspace variables MATLAB reports', () => {
            expect(rows(model, 'workspace').map((n: any) => n.name).sort()).toEqual(
              Object.keys(t.workspace).sort(),
            );
          });

          for (const [name, v] of Object.entries(t.workspace)) {
            const vt = asVarTruth(name, v);
            const want = expectedDisplay(vt);
            it(
              'workspace ' + name +
                (want === null ? ' has a cell (MATLAB gives no literal)' : ' displays as MATLAB does'),
              () => {
                const node = byName(model, 'workspace').get(name);
                expect(node, 'no workspace row named ' + name).toBeTruthy();
                if (want === null) {
                  // A cell or an object: MATLAB's own mat2str refuses it, so there is no
                  // one-line spelling to compare against. The value is still checked —
                  // across layouts, by the shape comparison above.
                  expect(typeof node.displayValue).toBe('string');
                  expect((node.displayValue as string).length).toBeGreaterThan(0);
                } else {
                  expect(
                    literalMatches(node.displayValue, vt),
                    name + ': MATLAB ' + JSON.stringify(want) + ', model ' + JSON.stringify(node.displayValue),
                  ).toBe(true);
                }
              },
            );

            it('workspace ' + name + ' reports the class MATLAB reports', () => {
              const node = byName(model, 'workspace').get(name);
              if (v.isobject) {
                expect(node.className).toBe(v.class);
              } else {
                expect(node.dataType).toBe(v.class);
              }
            });
          }
        }
      });
    }
  });
}

// ---------------------------------------------------------------------------

describe('.slx layout parity — the workspace MATLAB reports for slxws is in the .mat', () => {
  const t = TRUTH.slxws;
  const MAT = 'slxws_data.mat';
  if (!HAVE_TRUTH || !t || !have([MAT])) {
    it.skip('corpus not generated — run gen_slx.m', () => {});
  } else {
    // The loop the model rows cannot close on their own. `get_param(mdl,
    // 'ModelWorkspace').whos` reports Kwp and Kwi for every one of the three layouts,
    // and the model's own workspace section is empty in all three — because the
    // variables are in the file the model POINTS at. So the parity claim for a
    // MAT-backed workspace is only honoured if that file reads back to what MATLAB
    // reported, and this is where that is checked.
    const mat = loadFile('./artifacts/slx_layouts/' + MAT, MAT);
    const byVar = new Map<string, any>((mat.children ?? []).map((c: any) => [c.name, c]));

    it('holds exactly the variables MATLAB reported for the model workspace', () => {
      expect([...byVar.keys()].sort()).toEqual(Object.keys(t.workspace).sort());
    });

    for (const [name, v] of Object.entries(t.workspace)) {
      const vt = asVarTruth(name, v);
      it(name + ' displays as MATLAB does', () => {
        const node = byVar.get(name);
        expect(node, 'no variable named ' + name).toBeTruthy();
        expect(
          literalMatches(node.displayValue, vt),
          name + ': MATLAB ' + JSON.stringify(expectedDisplay(vt)) + ', model ' + JSON.stringify(node.displayValue),
        ).toBe(true);
        expect(node.dataType).toBe(v.class);
      });
    }
  }
});

describe('.slx layout parity — what the exports themselves recorded', () => {
  if (!HAVE_TRUTH) {
    it.skip('corpus not generated — run gen_slx.m', () => {});
  } else {
    it('covers every layout era the matrix names', () => {
      // The corpus and the matrix are two statements of the same thing, so they are
      // checked against each other. An era added to one and not the other is a gap
      // this suite would otherwise report as a pass.
      expect(asArray(TRUTH.exports).map((e) => e.file).sort()).toEqual(
        CASES.filter((e) => e.version).map((e) => e.file).sort(),
      );
      expect(asArray(TRUTH.wsExports).map((e) => e.file).sort()).toEqual(
        WS_CASES.filter((e) => e.version).map((e) => e.file).sort(),
      );
    });

    it('warned about exactly one thing, and it is the dictionary R2013b cannot have', () => {
      // Every other export was silent. If a future MATLAB starts warning about
      // something else, this is where it surfaces instead of being lost — a warning
      // is MATLAB telling us a fixture no longer means what the suite thinks.
      const warned = [...asArray(TRUTH.exports), ...asArray(TRUTH.wsExports)].filter(
        (e) => e.lastWarning !== '',
      );
      expect(warned.map((e) => e.file)).toEqual(['slxcases_R2013b.slx']);
      expect(warned[0].lastWarning.toLowerCase()).toContain('data dictionar');
    });
  }
});
