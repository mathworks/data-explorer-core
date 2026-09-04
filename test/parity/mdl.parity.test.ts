// Copyright 2026 The MathWorks, Inc.
//
// The `.mdl` parity suite: one block diagram, saved by MATLAB in four containers,
// asserted to open to the SAME data model.
//
//   mdlcases.mdl          modern .mdl — an OPC package written as TEXT
//   mdlcases_R2011b.mdl   classic .mdl — the pre-R2012 nested-brace format
//   mdlcases_R2017b.mdl   classic .mdl from the LAST release that wrote one
//   mdlcases.slx          the .slx twin, which is the reference
//
// plus a second, modern-only pair (`mdlmcos`) carrying a Simulink data object in the
// model workspace. All of it is written by test/parity/matlab/gen_mdl.m; nothing here
// launches MATLAB, and mdl_truth.json is the only source of expected values that did
// not come out of our own parse.
//
// Two kinds of assertion, and the difference matters:
//   - AGAINST MATLAB: what MATLAB says the diagram holds (mdl_truth.json), through
//     the same expect.ts convention the `.slx` corpus is held to.
//   - ACROSS FLAVOURS: the `.mdl` rows equal the `.slx` rows. This is the claim
//     `.mdl` support makes, and it is the one a wrong-but-consistent parse cannot
//     satisfy, because the `.slx` side is read by code that predates this feature.
//
// The divergences that are REAL and expected are asserted too, so that they stay
// deliberate rather than becoming folklore:
//   - a classic `.mdl` has no release string and no UUID, and dates its own way
//   - a classic `.mdl` is not an OPC package, so it exposes no parts
//   - R2011b cannot use a data dictionary and drops the link on export, which also
//     costs its block rows the link into the dictionary
//   - a reference is named with the parent model's own extension, so the SAME
//     reference is `mdl_child.mdl` from a `.mdl` and `mdl_child.slx` from a `.slx`
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadBytes, loadFile } from './loadFile.js';
import { expectedDisplay, literalMatches } from './matlab/expect.js';
import { asArray, asVarTruth } from './matlab/loadTruth.js';
import type { ModelTruth } from './matlab/loadTruth.js';
import { expectedUsages as usagesOf } from './paramPolicy.js';

const MDL_DIR = fileURLToPath(new URL('./artifacts/mdl/', import.meta.url));

// gen_mdl.m records the shared modelTruth shape plus its own `files` list, so this
// alias is the shared interface with `files` made mandatory.
type MdlModelTruth = ModelTruth & { files: { modern: string; classic: string[] } };

const TRUTH_FILE = MDL_DIR + 'mdl_truth.json';
const HAVE_TRUTH = existsSync(TRUTH_FILE);
const TRUTH: Record<string, MdlModelTruth> = HAVE_TRUTH ? JSON.parse(readFileSync(TRUTH_FILE, 'utf8')) : {};

/** `Name|Type|Prop=Value` for every parameter row MATLAB's own model implies. */
function expectedUsages(t: MdlModelTruth): string[] {
  return usagesOf(asArray(t.blocks));
}

// ---------------------------------------------------------------------------
// reading the data model
// ---------------------------------------------------------------------------

function load(file: string): any {
  return loadFile('./artifacts/mdl/' + file, file);
}

function rows(model: any, section: string): any[] {
  return model.getSection(section).children;
}

function byName(model: any, section: string): Map<string, any> {
  return new Map(rows(model, section).map((n: any) => [n.name, n]));
}

/** A model file name with its extension removed — `mdl_child.slx` -> `mdl_child`. */
function stem(name: string): string {
  return name.replace(/\.(slx|mdl)$/i, '');
}

/**
 * Everything about a loaded model that must NOT depend on which container it came
 * out of. Sorted, because part order differs by container: a `.slx` reads its
 * systems in zip-entry order (`system_7.xml` before `system_root.xml`) while a
 * `.mdl` reads them in diagram order. Order is not part of the claim; content is.
 *
 * Deliberately NOT in here: the linked dictionary and the reference extension, both
 * of which legitimately differ per flavour and get their own tests below.
 */
function shape(model: any): Record<string, string[]> {
  return {
    blocks: rows(model, 'blocks')
      .map((n: any) => n.displayName + ' :: ' + n.displayValue + ' :: ' + n.className)
      .sort(),
    workspace: rows(model, 'workspace')
      .map((n: any) => [n.displayName, n.dataType, n.className, n.displayValue].join(' :: '))
      .sort(),
    config: rows(model, 'config')
      .map((n: any) => n.displayName + ' :: ' + (n.active ? 'active' : 'inactive'))
      .sort(),
    references: rows(model, 'references')
      .map((n: any) => stem(n.displayName) + ' :: ' + n.blockPath)
      .sort(),
  };
}

/** Every flavour of one model: the `.slx` reference first, then the `.mdl` files. */
function flavoursOf(t: MdlModelTruth): { slx: string; mdls: string[] } {
  return { slx: t.name + '.slx', mdls: [t.files.modern, ...asArray(t.files.classic)] };
}

function have(files: string[]): boolean {
  return files.every((f) => existsSync(MDL_DIR + f));
}

// ---------------------------------------------------------------------------

for (const key of ['mdlcases', 'mdlmcos']) {
  const t = TRUTH[key];
  const files = t ? [flavoursOf(t).slx, ...flavoursOf(t).mdls] : [];

  describe('.mdl parity — ' + key, () => {
    if (!HAVE_TRUTH || !t || !have(files)) {
      it.skip('corpus not generated — run gen_mdl.m (see test/parity/matlab/README.md)', () => {});
      return;
    }

    const { slx, mdls } = flavoursOf(t);
    const reference = load(slx);
    const referenceShape = shape(reference);

    for (const file of mdls) {
      it(file + ' opens to the same rows as ' + slx, () => {
        expect(shape(load(file))).toEqual(referenceShape);
      });
    }

    for (const file of [slx, ...mdls]) {
      describe(file, () => {
        const model = load(file);
        // Only the two classic files are named `_R<release>`; the modern `.mdl` and
        // the `.slx` are not. This is how the suite knows which expectations to hold
        // a file to without asking the parser what it decided the file was.
        const classic = /_R\d{4}[ab]\.mdl$/.test(file);
        const dropsDictionary = /_R2011b\.mdl$/.test(file);

        it('is one source named after the file', () => {
          expect(model.name).toBe(file);
        });

        it('surfaces exactly the parameter references MATLAB’s model implies', () => {
          const actual = model.blockParamUsages
            .map((u: any) => [u.blockName, u.blockType, u.paramProperty + '=' + u.paramValue].join('|'))
            .sort();
          expect(actual).toEqual(expectedUsages(t));
        });

        it('lists every block that has at least one parameter reference', () => {
          const wanted = new Set(expectedUsages(t).map((u) => u.split('|')[0]));
          expect(rows(model, 'blocks').map((n: any) => n.name).sort()).toEqual([...wanted].sort());
        });

        it('holds the config sets MATLAB reports, with the same one active', () => {
          const wanted = asArray(t.configSets)
            .map((c) => c.name + ' :: ' + (c.active ? 'active' : 'inactive'))
            .sort();
          expect(shape(model).config).toEqual(wanted);
        });

        it('names the models MATLAB says are referenced', () => {
          const wanted = asArray(t.modelReferences).sort();
          expect(rows(model, 'references').map((n: any) => stem(n.name)).sort()).toEqual(wanted);
        });

        it('names a reference with the parent model’s own extension', () => {
          // The entry name doubles as the link target used to jump to that model, and
          // a legacy hierarchy is legacy throughout: a `.mdl` that referenced
          // `mdl_child.slx` would link to a file that does not exist.
          const want = file.endsWith('.mdl') ? '.mdl' : '.slx';
          for (const ref of rows(model, 'references')) {
            expect(ref.name.endsWith(want), ref.name + ' should end with ' + want).toBe(true);
          }
        });

        it('roots every reference block path at $bdroot', () => {
          // A `.slx` writes the literal `$bdroot`; a classic `.mdl` writes the model's
          // own name — which an ExportToVersion has RENAMED after the target file, so
          // the name recorded in the file is the only safe prefix to strip.
          for (const ref of rows(model, 'references')) {
            expect(ref.blockPath).toMatch(/^\$bdroot(\/|$)/);
          }
        });

        it('holds the workspace variables MATLAB reports', () => {
          expect(rows(model, 'workspace').map((n: any) => n.name).sort()).toEqual(
            Object.keys(t.workspace).sort(),
          );
        });

        for (const [name, v] of Object.entries(t.workspace)) {
          const vt = asVarTruth(name, v);
          const want = expectedDisplay(vt);
          it('workspace ' + name + (want === null ? ' has a cell (MATLAB gives no literal)' : ' displays as MATLAB does'), () => {
            const node = byName(model, 'workspace').get(name);
            expect(node, 'no workspace row named ' + name).toBeTruthy();
            if (want === null) {
              // A cell or an object: MATLAB's own mat2str refuses it, so there is no
              // one-line spelling to compare against. The value is still checked —
              // across flavours, by the shape comparison above.
              expect(typeof node.displayValue).toBe('string');
              expect((node.displayValue as string).length).toBeGreaterThan(0);
            } else {
              expect(
                literalMatches(node.displayValue, vt),
                name + ': MATLAB ' + JSON.stringify(want) + ', model ' + JSON.stringify(node.displayValue),
              ).toBe(true);
            }
          });

          it('workspace ' + name + ' reports the class MATLAB reports', () => {
            const node = byName(model, 'workspace').get(name);
            if (v.isobject) {
              expect(node.className).toBe(v.class);
            } else {
              expect(node.dataType).toBe(v.class);
            }
          });
        }

        it(
          dropsDictionary
            ? 'has no linked dictionary — R2011b cannot use one and drops the link on export'
            : 'links the dictionary MATLAB reports',
          () => {
            const wanted = dropsDictionary ? null : t.dataDictionary || null;
            expect(model.dataDictionary).toBe(wanted);
            expect(rows(model, 'dataSources').map((n: any) => n.name)).toEqual(wanted ? [wanted] : []);
          },
        );

        it('keeps the model workspace in the model itself', () => {
          // `Model File`, so nothing is expected in External Data beyond the
          // dictionary. A workspace backed by a `.mat` is the other case, and the
          // parser reads it from WSDataSource/WSSourceFileName in both flavours.
          expect(t.wsDataSource).toBe('Model File');
          const external = rows(model, 'dataSources').map((n: any) => n.name).filter((n: string) => n.endsWith('.mat'));
          expect(external).toEqual([]);
        });

        if (classic) {
          it('reports no release and no uuid, and dates the old way', () => {
            // A classic file records `Version 9.0`, a SIMULINK version, and nothing
            // maps that to a release; it has no UUID at all. Reporting either would
            // mean inventing a value the file never claimed.
            expect(model.release).toBe('');
            expect(model.uuid).toBe('');
            expect(model.lastModified).not.toBe('');
            // `Fri Sep 04 10:15:29 2026`, where a `.slx` gives ISO 8601. Both are
            // passed through as written.
            expect(model.lastModified).not.toMatch(/^\d{4}-\d{2}-\d{2}T/);
          });

          it('exposes no OPC parts — it is one flat text file, not an archive', () => {
            expect(model.rawContents).toBeNull();
            expect(model._zipEntries).toBeNull();
          });
        } else {
          it('reports the release and uuid MATLAB stamped', () => {
            expect(model.release).toBe('R' + t.release);
            expect(model.uuid).toMatch(/^[0-9a-f-]{36}$/);
            expect(model.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
          });

          it('exposes its OPC parts', () => {
            expect(Object.keys(model._zipEntries).length).toBeGreaterThan(0);
          });
        }
      });
    }

    it('the modern .mdl carries the very same OPC parts as the .slx', () => {
      // The framing claim, at the byte level. Only the two parts that record
      // per-SAVE state may differ: coreProperties stamps the save time, and
      // blockDiagram.json a fresh ModelUUID. Everything else — every system XML,
      // every config set, and the binary model workspace, which is base64'd in the
      // text package and stored in the zip — must be byte-identical, because it is
      // the same serializer writing the same parts into two containers.
      const PER_SAVE = new Set(['metadata/coreProperties.xml', 'simulink/blockDiagram.json']);
      const fromMdl: Record<string, Uint8Array> = load(t.files.modern)._zipEntries;
      const fromSlx: Record<string, Uint8Array> = reference._zipEntries;

      expect(Object.keys(fromMdl).sort()).toEqual(Object.keys(fromSlx).sort());
      const differing = Object.keys(fromSlx).filter(
        (k) => Buffer.compare(Buffer.from(fromMdl[k]), Buffer.from(fromSlx[k])) !== 0,
      );
      expect(differing.filter((k) => !PER_SAVE.has(k))).toEqual([]);
      // And the binary part specifically, since base64 is the one transform the
      // text container applies that the zip does not.
      const mxarray = 'simulink/modelWorkspace.mxarray';
      expect(Object.keys(fromSlx)).toContain(mxarray);
      expect(fromMdl[mxarray]).toEqual(fromSlx[mxarray]);
    });

    it('every flavour agrees on who saved it', () => {
      const creators = new Set([reference, ...mdls.map(load)].map((m: any) => m.creator));
      expect(creators.size).toBe(1);
      expect([...creators][0]).not.toBe('');
    });
  });
}

describe('.mdl parity — a MatData record holding the .slx’s own workspace shape', () => {
  const t = TRUTH.mdlcases;
  if (!HAVE_TRUTH || !t || !have([t.name + '.slx'])) {
    it.skip('corpus not generated — run gen_mdl.m', () => {});
  } else {
    it('reads the variables out of a struct-of-variables record too', () => {
      // The two containers disagree on the SHAPE inside the mxarray, not just on the
      // framing around it: a classic MatData record is a 1xN struct array of
      // Name/Value pairs, while the `.slx` part is one struct whose FIELDS are the
      // variables. The parser reads the first and falls back to the second, and this
      // is the fallback — a classic skeleton built around the `.slx`'s own part.
      //
      // The uuencoding here is this test's, not MATLAB's, so it pins the fallback and
      // the escape handling (the alphabet contains both `"` and `\`), NOT the
      // encoding itself. MATLAB's own encoder is pinned by the classic files above,
      // whose workspace rows must equal this same `.slx`'s.
      const reference = load(t.name + '.slx');
      const part: Uint8Array = reference._zipEntries['simulink/modelWorkspace.mxarray'];
      const encoded = uuencode(part).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const text =
        'Model {\n  Name                    "wsonly"\n  WSMdlFileData           "DataTag0"\n}\n' +
        'MatData {\n  NumRecords              1\n  DataRecord {\n' +
        '    Tag                     DataTag0\n    Data                    "' + encoded + '"\n  }\n}\n';

      const model = loadBytes(bytesOfText(text), 'wsonly.mdl');
      expect(shape(model).workspace).toEqual(shape(reference).workspace);
    });
  }
});

/** The inverse of the parser's uudecode: six bits per character, biased by 32. */
function uuencode(bytes: Uint8Array): string {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += String.fromCharCode(32 + ((acc >> bits) & 0x3f));
    }
  }
  if (bits > 0) { out += String.fromCharCode(32 + ((acc << (6 - bits)) & 0x3f)); }
  return out;
}

function bytesOfText(text: string): ArrayBuffer {
  const u8 = new TextEncoder().encode(text);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

describe('.mdl parity — dictionary links on block rows', () => {
  const t = TRUTH.mdlcases;
  const files = t ? [t.name + '.slx', t.files.modern, ...asArray(t.files.classic)] : [];
  if (!HAVE_TRUTH || !t || !have(files)) {
    it.skip('corpus not generated — run gen_mdl.m', () => {});
  } else {
    for (const file of files) {
      const linked = !/_R2011b\.mdl$/.test(file);
      it(
        file + (linked ? ' links a block parameter to the dictionary that defines it' : ' shows the same parameters with no dictionary to link to'),
        () => {
          // The one row-level consequence of R2011b dropping the dictionary: the
          // parameter text is identical, but there is nothing to jump to. Asserted so
          // the difference stays a documented consequence rather than a surprise.
          const row = load(file).getSection('blocks').children.find((n: any) => n.name === 'Const').toRow();
          if (linked) {
            expect(row.DataType).toEqual({ text: 'Value=Kp', linkTarget: 'Kp@' + t.dataDictionary });
          } else {
            expect(row.DataType).toBe('Value=Kp');
          }
        },
      );
    }
  }
});
