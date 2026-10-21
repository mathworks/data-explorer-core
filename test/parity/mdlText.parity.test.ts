// Copyright 2026 The MathWorks, Inc.
//
// The text package `.mdl` parity suite: the `.mdl` R2027a writes from build 27.1.0.3409468
// on, `# Simulink Text Package` with `__MWSL_PART_BEGIN__` delimiters, held to the `.slx`
// MATLAB writes from the same model.
//
//   mdltext.mdl / .slx        blocks naming workspace variables, a nested and a masked
//                             subsystem, a model reference, a linked dictionary, two
//                             config sets (the second active), and a Model File workspace
//                             of double, matrix, struct, cell, char, int16, logical and a
//                             Simulink.Parameter
//   mdltext_empty.mdl / .slx  a workspace holding nothing
//   mdltext_mat.mdl / .slx    a workspace kept in a MAT-file
//
// All of it is written by test/parity/matlab/gen_mdl_text.m, which also records what
// MATLAB reports about the model opened from EACH file, and refuses to write a pair MATLAB
// reads two ways; mdltext_truth.json is that record. Nothing here launches MATLAB.
//
// Before this reader existed, every one of these `.mdl` files opened as a wholly empty
// model with no warning: the framing was not recognised, the grammar reader found the
// legacy `Model { Version 27.1 }` stub, and that was the model.
//
// Three kinds of assertion:
//   - THE PARTS: the `.mdl` holds the `.slx`'s parts, byte for byte, but for the OPC
//     bookkeeping it does not write, the release part it writes instead, the per-save
//     blockDiagram.json, and the workspace, which is JSON here and an mxarray there.
//   - ACROSS FLAVOURS: everything the parser reports, and every row and property-sheet
//     value of every node under the model, is the `.slx`'s.
//   - AGAINST MATLAB: the blocks, parameter usages, masks, config sets, references,
//     dictionary, workspace source and every workspace value, from mdltext_truth.json.
//
// The divergences that are real are asserted as such:
//   - the text package records no creator and no date (MATLAB reopens it with an empty
//     Creator, so its `.slx` twin has none either) and its UUID is a per-save stamp
//   - a reference is named with the parent model's own extension
//   - a struct's field names are renamable in the `.mdl`'s tree and not in the `.slx`'s,
//     because a JSON struct is the text dictionary's node and an mxarray struct the MAT
//     file's. The model is read-only either way; it is a property of the node, not of
//     what was read.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bytesOf, loadFile } from './loadFile.js';
import { parseModel } from '../../src/datamodel/parser/ModelParser.js';
import type { ParsedSlx } from '../../src/datamodel/parser/SlxParser.js';
import { expectedDisplay, literalMatches, normalizeMat2str } from './matlab/expect.js';
import { asArray, asVarTruth } from './matlab/loadTruth.js';
import type { MdlVarTruth, ModelTruth } from './matlab/loadTruth.js';
import { expectedUsages, maskParamReferencesData } from './paramPolicy.js';

const DIR = fileURLToPath(new URL('./artifacts/mdltext/', import.meta.url));
const TRUTH_FILE = DIR + 'mdltext_truth.json';

// gen_mdl_text.m records the shared modelTruth shape and a few fields more.
interface TextVarTruth extends MdlVarTruth {
  fields?: Record<string, string>;
  elements?: string | string[];
  value?: string;
  description?: string;
}
interface MaskTruth {
  name: string;
  names: string | string[];
  values: string | string[];
  types: string | string[];
}
type TextModelTruth = Omit<ModelTruth, 'workspace'> & {
  wsFileName: string;
  creator: string;
  masks: MaskTruth | MaskTruth[];
  workspace: Record<string, TextVarTruth>;
  files: { mdl: string; slx: string };
};

const TRUTH: Record<string, TextModelTruth> = existsSync(TRUTH_FILE) ? JSON.parse(readFileSync(TRUTH_FILE, 'utf8')) : {};

function load(file: string): any {
  return loadFile('./artifacts/mdltext/' + file, file);
}

function parse(file: string): ParsedSlx {
  return parseModel(bytesOf('./artifacts/mdltext/' + file), file);
}

function rows(model: any, section: string): any[] {
  return model.getSection(section).children;
}

/** The parts the zip carries for OPC's sake, which the text package does not write. */
function opcBookkeeping(part: string): boolean {
  return part === '[Content_Types].xml' || part.startsWith('metadata/') || /(^|\/)_rels\//.test(part);
}

/**
 * Every node under the model, depth-first, as what a host is shown of it: its row and its
 * property sheet's values. The file's own name, which every id and link is built from, is
 * replaced by a placeholder, and a struct field's renamability is left out (see the head).
 * The references section's rows are left out too: they are named after the parent's
 * extension, which is asserted on its own.
 */
function tree(model: any, file: string): string[] {
  const out: string[] = [];
  const own = new RegExp(file.replace(/[.]/g, '[.]'), 'g');
  const visit = (node: any, depth: number): void => {
    const row = node.toRow() ?? {};
    if (row.Name && typeof row.Name === 'object') delete row.Name.editable;
    const pi = node.toPIObject()?.objects ?? null;
    const line = [
      node.displayName,
      node.dataType,
      node.className,
      node.displayValue,
      node.blockPath ?? '',
      JSON.stringify(row),
      JSON.stringify(pi),
    ];
    out.push('  '.repeat(depth) + line.join(' :: ').replace(own, '<model>'));
    if (node.name === 'references' && depth === 0) return;
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  for (const section of model.children) visit(section, 0);
  return out;
}

const KEYS = ['mdltext', 'mdltext_empty', 'mdltext_mat'];

for (const key of KEYS) {
  const t = TRUTH[key];

  describe('text package .mdl parity — ' + key, () => {
    if (!t || !existsSync(DIR + t.files.mdl) || !existsSync(DIR + t.files.slx)) {
      it.skip('corpus not generated — run gen_mdl_text.m (see test/parity/matlab/README.md)', () => {});
      return;
    }
    const { mdl, slx } = t.files;

    it('is the Simulink text package framing', () => {
      // Pinned so that a regenerated corpus written in another framing cannot pass this
      // suite by being read the old way.
      const head = readFileSync(DIR + mdl, 'latin1').slice(0, 200);
      expect(head.startsWith('# Simulink Text Package\n')).toBe(true);
      expect(head).toContain('__MWSL_PACKAGE_BEGIN__');
    });

    describe('the parts', () => {
      const fromMdl = parse(mdl).zipEntries!;
      const fromSlx = parse(slx).zipEntries!;

      it('are the .slx parts, less its OPC bookkeeping, plus the release part', () => {
        const expected = Object.keys(fromSlx).filter((p) => !opcBookkeeping(p)).concat('slcoreProperties.json');
        expect(Object.keys(fromMdl).sort()).toEqual(expected.sort());
      });

      it('hold the .slx bytes, but for the per-save diagram part and the JSON workspace', () => {
        // The framing claim at the byte level: every system XML, every config set, the
        // graphical interface, all decoded byte-exact out of the text stream.
        const DIFFER = new Set(['simulink/blockDiagram.json', 'simulink/modelWorkspace.mxarray']);
        const shared = Object.keys(fromMdl).filter((p) => p in fromSlx && !DIFFER.has(p));
        expect(shared.length).toBeGreaterThan(4);
        for (const p of shared) {
          expect(Buffer.compare(Buffer.from(fromMdl[p]), Buffer.from(fromSlx[p])), p).toBe(0);
        }
      });

      it(Object.keys(t.workspace).length > 0 ? 'keep the workspace as JSON text' : 'keep no workspace part', () => {
        const part = fromMdl['simulink/modelWorkspace.mxarray'];
        if (Object.keys(t.workspace).length === 0) {
          // An empty workspace, or one kept in a MAT-file, writes no part in either file.
          expect(part).toBeUndefined();
          expect(fromSlx['simulink/modelWorkspace.mxarray']).toBeUndefined();
          return;
        }
        expect(new TextDecoder().decode(part).trimStart().startsWith('{')).toBe(true);
        expect(fromSlx['simulink/modelWorkspace.mxarray'][0]).toBe(0x00);
      });
    });

    describe('across flavours', () => {
      it('the parser reports what it reports of the .slx', () => {
        const a = parse(mdl);
        const b = parse(slx);
        // Per-save, or not in the text package at all: compared below, on their own.
        const comparable = (p: ParsedSlx) => ({
          ...p,
          name: undefined,
          uuid: undefined,
          lastModified: undefined,
          rawContents: undefined,
          zipEntries: undefined,
          workspace: p.workspace.map((v) => v.name),
        });
        expect(comparable(a)).toEqual(comparable(b));
        expect(a.warnings).toEqual([]);
        expect(a.uuid).toMatch(/^[0-9a-f-]{36}$/);
        expect(b.uuid).toMatch(/^[0-9a-f-]{36}$/);
      });

      it('records no creator and no date, where the .slx records only the date', () => {
        const a = parse(mdl);
        const b = parse(slx);
        expect(a.creator).toBe('');
        expect(a.lastModified).toBe('');
        expect(b.creator).toBe(t.creator);
        expect(b.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });

      it('opens to the same tree, row for row and property for property', () => {
        const fromMdl = tree(load(mdl), mdl);
        expect(fromMdl.length).toBeGreaterThan(5);
        expect(fromMdl).toEqual(tree(load(slx), slx));
      });

      it('names a reference with the parent model’s own extension', () => {
        const names = (file: string) => rows(load(file), 'references').map((n: any) => n.name);
        expect(names(mdl)).toEqual(asArray(t.modelReferences).map((m) => m + '.mdl'));
        expect(names(slx)).toEqual(asArray(t.modelReferences).map((m) => m + '.slx'));
      });

      const structs = Object.keys(t.workspace).filter((n) => t.workspace[n].class === 'struct');
      if (structs.length > 0) {
        it('offers a struct’s field names for renaming in the .mdl’s tree only', () => {
          // The one property of a row that is the node's and not the file's: a JSON struct is
          // the text dictionary's struct node, which renames a field, and an mxarray struct the
          // MAT file's, which does not. Asserted so that the difference stays a known one.
          const editable = (file: string) =>
            structs.flatMap((s) => rows(load(file), 'workspace').find((n: any) => n.name === s).children)
              .map((f: any) => f.toRow().Name.editable);
          expect(editable(mdl).every((e: boolean) => e === true)).toBe(true);
          expect(editable(slx).every((e: boolean) => e === false)).toBe(true);
        });
      }
    });

    describe('against MATLAB', () => {
      const model = load(mdl);
      const parsed = parse(mdl);

      it('reports the release MATLAB saved it in', () => {
        expect(parsed.release).toBe('R' + t.release);
      });

      it('surfaces exactly the parameter references MATLAB’s model implies', () => {
        const fromMasks: string[] = [];
        for (const mask of asArray(t.masks)) {
          const names = asArray(mask.names);
          const values = asArray(mask.values);
          const types = asArray(mask.types);
          const block = asArray(t.blocks).find((b) => b.name === mask.name)!;
          names.forEach((name, i) => {
            if (maskParamReferencesData(types[i], 'on', values[i])) {
              fromMasks.push(mask.name + '|' + block.type + '|' + name + '=' + values[i]);
            }
          });
        }
        const actual = parsed.blockParamUsages
          .map((u) => [u.blockName, u.blockType, u.paramProperty + '=' + u.paramValue].join('|'))
          .sort();
        expect(actual).toEqual([...expectedUsages(asArray(t.blocks)), ...fromMasks].sort());
      });

      it('names every mask parameter as a scope over the blocks inside', () => {
        const wanted = asArray(t.masks).map((m) => m.name + ' :: ' + asArray(m.names).join(','));
        expect(parsed.masks.map((m) => m.blockName + ' :: ' + m.names.join(','))).toEqual(wanted);
      });

      it('holds the config sets MATLAB reports, with the same one active', () => {
        const wanted = asArray(t.configSets).map((c) => [c.name, c.active, c.class, c.sourceName]);
        expect(parsed.configSets.map((c) => [c.name, c.active, c.objectClass || 'Simulink.ConfigSet', c.sourceName])).toEqual(wanted);
      });

      it('names the models MATLAB says are referenced', () => {
        expect(parsed.modelReferences.map((r) => r.modelName)).toEqual(asArray(t.modelReferences));
      });

      it('links the dictionary MATLAB reports', () => {
        expect(parsed.dataDictionary).toBe(t.dataDictionary || null);
      });

      it(
        t.wsDataSource === 'MAT-File' ? 'names the MAT-file its workspace is kept in' : 'keeps its workspace in the model',
        () => {
          const file = t.wsDataSource === 'MAT-File' ? t.wsFileName : null;
          expect(parsed.workspaceDataSource).toBe(file);
          expect(parsed.externalDataSources).toEqual(file ? [file] : []);
        },
      );

      it('holds the workspace variables MATLAB reports', () => {
        expect(rows(model, 'workspace').map((n: any) => n.name)).toEqual(Object.keys(t.workspace));
      });

      for (const [name, v] of Object.entries(t.workspace)) {
        const node = () => rows(model, 'workspace').find((n: any) => n.name === name);

        it('workspace ' + name + ' is of the class MATLAB reports', () => {
          if (v.isobject) {
            expect(node().className).toBe(v.class);
          } else {
            expect(node().dataType).toBe(v.class);
          }
        });

        const vt = asVarTruth(name, v);
        if (expectedDisplay(vt) !== null) {
          it('workspace ' + name + ' displays as MATLAB spells it', () => {
            expect(literalMatches(node().displayValue, vt), node().displayValue).toBe(true);
          });
        }
        if (v.fields) {
          it('workspace ' + name + ' holds MATLAB’s fields, in MATLAB’s order', () => {
            const fields = node().children.map((c: any) => [c.name, c.displayValue]);
            expect(fields).toEqual(Object.entries(v.fields!).map(([f, s]) => [f, normalizeMat2str(s)]));
          });
        }
        if (v.elements !== undefined) {
          it('workspace ' + name + ' holds MATLAB’s elements', () => {
            expect(node().children.map((c: any) => c.displayValue)).toEqual(asArray(v.elements).map(normalizeMat2str));
          });
        }
        if (v.value !== undefined) {
          it('workspace ' + name + ' holds MATLAB’s Value and Description', () => {
            const value = asVarTruth(name, { class: 'double', size: [1, 1], isobject: false, disp: '', mat2str: v.value });
            expect(literalMatches(node().displayValue, value), node().displayValue).toBe(true);
            expect(node().toRow().Description).toBe(v.description);
          });
        }
      }
    });
  });
}
