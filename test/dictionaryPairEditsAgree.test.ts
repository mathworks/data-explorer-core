// Copyright 2026 The MathWorks, Inc.
//
// One dictionary, written by MATLAB twice, as a text (.sldd JSON) and as a binary (.sldd XML)
// file: the fixture pairs `<x>_text.sldd` / `<x>_binary.sldd` under test/fixtures. Two writers
// and two readers of one rule, which is this repo's recurring bug class: so of every value the two
// files both offer an edit of, an edit typed into it is held to one answer from both. Each is
// taken by both or by neither; once taken, both show the same; and saved and opened again, both
// show what they showed before the save.
//
// What a value offers differs between the two formats where the format says so (a text
// dictionary holds a sparse array as the MAT stream it was read as, which is shown and not edited;
// MATLAB's JSON keeps no size of an empty), and is not asked here. A complex value it holds so takes
// edits, as the binary twin's does, and so do the members of a cell or a struct it holds so (the
// C-012 ruling, revised 2026-10-24), but for a string typed into one (stringIntoTextStream).
//
// Then the one edit the sweep finds the formats disagree on, recorded as an expected failure: a
// string typed into a Simulink.Parameter's Value where the Parameter is held in a MAT stream (a
// binary dictionary's hex value) or in a MAT-file's subsystem.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { sourceJudgesValues } from '../src/datamodel/node/BaseNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const fileBytes = (abs: string) => arrayBufferOf(new Uint8Array(readFileSync(abs)));

function slddUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...slddUnder(abs));
    } else if (entry.name.endsWith('.sldd')) {
      out.push(abs);
    }
  }
  return out.sort();
}

// Every text dictionary with a binary twin of the same name, and the two MCOS pairs named otherwise.
function pairs(): [string, string][] {
  const files = slddUnder(TEST_ROOT);
  const out: [string, string][] = [];
  for (const file of files) {
    const base = file.match(/^(.*)_text\.sldd$/)?.[1];
    const twin = base ? [base + '_binary.sldd', base + '_bin.sldd'].find((b) => files.includes(b)) : undefined;
    if (twin) {
      out.push([file, twin]);
    }
  }
  out.push([join(TEST_ROOT, 'fixtures/mcos/typed_mcos.sldd'), join(TEST_ROOT, 'fixtures/mcos/typed_mcos_binary.sldd')]);
  out.push([join(TEST_ROOT, 'fixtures/mcos/complex.sldd'), join(TEST_ROOT, 'fixtures/mcos/complex_binary.sldd')]);
  return out;
}

/** Where `node` stands in its tree: each name from the root down, and which of the siblings of that name. */
function pathOf(node: any): [string, number][] {
  const path: [string, number][] = [];
  for (let n = node; n && n.parent; n = n.parent) {
    path.unshift([n.name, n.parent.children.filter((c: any) => c.name === n.name).indexOf(n)]);
  }
  return path;
}

function nodeAt(root: any, path: [string, number][]): any {
  let n = root;
  for (const [name, i] of path) {
    n = n?.children.filter((c: any) => c.name === name)[i];
  }
  return n;
}

const shownPath = (path: [string, number][]) => path.map(([name, i]) => (i ? name + '#' + i : name)).join('/');

function opened(file: string, bytes: ArrayBuffer) {
  const session = createSession();
  const root: any = ingest(session, bytes, { filename: basename(file) });
  const edit = (node: any, value: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, 'Value', value);
  };
  // The file a save writes, opened again as a host opens it.
  const reopened = (): any => {
    const out: any = session.serializeSource(root.name);
    const bytes = out.kind === 'text' ? new TextEncoder().encode(out.text) : out.bytes;
    return ingest(createSession(), arrayBufferOf(bytes), { filename: basename(file) });
  };
  return { root, edit, reopened };
}

// What is typed: a number, a char, a logical, a row, an integer, a complex number, a string, a cell.
const TYPED = ['7', "'zz'", 'true', '[1 2]', 'int8(5)', '1+2i', '"s"', '{1, "x"}'];

// A char typed into a Parameter's Value where the binary dictionary holds the Parameter in an
// encoded value: there it is the string MATLAB loads of the char row the save writes into the
// object's cell (ParameterNode, measured against MATLAB R2027a), and in the text twin's JSON the char
// it writes, the divergence DESIGN.md records (test/parameterNode.test.ts). Each is still held to
// what its own file opened again shows.
const charIntoEncodedParameter = (node: any, typed: string) => /^'.*'$/.test(typed) && node.className === 'Simulink.Parameter' && sourceJudgesValues(node);

// A string typed into a member of a cell or a struct the text dictionary holds whole as a MAT stream,
// which takes edits of plain values (the C-012 ruling, revised 2026-10-24): MatWriter has no class
// for a string, so the text dictionary refuses it, naming the member and the stream, where the binary
// twin's XML spells it. The one format limit the sweep meets.
const STREAM_STRING = /is held in the MAT stream of .*: it would hold a string, which a MAT stream there holds only to be shown\.$/;
const stringIntoTextStream = (typed: string, tr: unknown, br: unknown) =>
  br === true && /"/.test(typed) && STREAM_STRING.test((tr as { reason?: string } | null)?.reason ?? '');

// What an edited row shows once its file is saved and opened again: what it showed. But for a real
// number typed into an element of a complex array, which is that number with an imaginary part of 0:
// the row shows the number, and the file opened again the complex number, in both formats alike.
const reopenedAs = (node: any): string[] => {
  const shown = String(node.displayValue);
  return node.parent?._kind === 'array' && node.parent._isComplexValue?.() && !/i$/.test(shown) ? [shown, shown + '+0i'] : [shown];
};

describe('a text and a binary dictionary of the same values take the same edits of them', () => {
  it('every edit both offer: taken by both or neither, shown the same, and reopened as shown', { timeout: 180_000 }, () => {
    let both = 0;
    let taken = 0;
    let streamStrings = 0;
    for (const [textFile, binaryFile] of pairs()) {
      const textBytes = fileBytes(textFile);
      const binaryBytes = fileBytes(binaryFile);
      const probe = opened(binaryFile, binaryBytes).root;
      for (const t of opened(textFile, textBytes).root.flatten() as any[]) {
        const path = pathOf(t);
        const b = nodeAt(probe, path);
        if (!t.parent || !b || !t.valueEditable || !b.valueEditable || t.children.length > 0) {
          continue;
        }
        both++;
        for (const typed of TYPED) {
          const label = basename(textFile) + ' ' + shownPath(path) + ' = ' + typed;
          const text = opened(textFile, textBytes);
          const binary = opened(binaryFile, binaryBytes);
          const [tn, bn] = [nodeAt(text.root, path), nodeAt(binary.root, path)];
          const [tr, br] = [text.edit(tn, typed), binary.edit(bn, typed)];
          if (stringIntoTextStream(typed, tr, br)) {
            streamStrings++;
            continue;
          }
          expect(br === true, label + ': ' + JSON.stringify({ text: tr, binary: br })).toBe(tr === true);
          if (tr !== true) {
            continue;
          }
          taken++;
          expect(bn.displayValue, label).toBe(charIntoEncodedParameter(bn, typed) ? tn.displayValue.replace(/^'(.*)'$/, '"$1"') : tn.displayValue);
          expect(reopenedAs(tn), label + ' (text, reopened)').toContain(nodeAt(text.reopened(), path)?.displayValue);
          expect(reopenedAs(bn), label + ' (binary, reopened)').toContain(nodeAt(binary.reopened(), path)?.displayValue);
        }
      }
    }
    // What the sweep met: that many values both offer an edit of, and that many edits taken.
    expect(both).toBeGreaterThanOrEqual(400);
    expect(taken).toBeGreaterThanOrEqual(1500);
    // nd_text.sldd's C and s, each member typed "s" and {1, "x"}: 40 when this was written.
    expect(streamStrings).toBeGreaterThanOrEqual(30);
  });
});

describe("a string typed into a Simulink.Parameter's Value", () => {
  interface Typed {
    className: string;
    taken: unknown;
    shown: string;
    reopened: string | undefined;
  }

  /** The Parameter `find` finds in the tree of `file`, its Value typed as `"s"`, saved and opened again. Asserts nothing. */
  function stringValue(file: string, find: (root: any) => any): Typed {
    const { root, edit, reopened } = opened(file, fileBytes(file));
    const node = find(root);
    const taken = edit(node, '"s"');
    return { className: node.className, taken, shown: node.displayValue, reopened: nodeAt(reopened(), pathOf(node))?.displayValue };
  }

  /** The same of a MAT-file, through the session as a host opens one. */
  function matStringValue(file: string, find: (root: any) => any, typed = '"s"'): Typed {
    const session = createSession();
    const root: any = session.addMatSource('f.mat', fileBytes(file));
    const node = find(root);
    session.setActive(root, node);
    const taken = session.editProperty(node.id, 'Value', typed);
    const saved = (session.serializeSource('f.mat') as { bytes: Uint8Array }).bytes;
    const again: any = createSession().addMatSource('g.mat', arrayBufferOf(saved));
    return { className: node.className, taken, shown: node.displayValue, reopened: nodeAt(again, pathOf(node))?.displayValue };
  }

  const at = (path: [string, number][]) => (root: any) => nodeAt(root, path);
  const IN_STRUCT: [string, number][] = [['design', 0], ['objs', 0], ['prm', 0]];
  const IN_CELL: [string, number][] = [['design', 0], ['objsCell', 0], ['7', 0]];
  const TEXT = join(TEST_ROOT, 'fixtures/sparse/hexobj_text.sldd');
  const BINARY = join(TEST_ROOT, 'fixtures/sparse/hexobj_binary.sldd');
  const inStructOf = (root: any) => (root.flatten() as any[]).find((n) => n.className === 'Simulink.Parameter' && n.parent !== root);

  // Each case once, by name: the venues the edit is held in.
  const CASES: Record<string, () => Typed> = {
    "a text dictionary's struct value": () => stringValue(TEXT, at(IN_STRUCT)),
    "a text dictionary's cell value": () => stringValue(TEXT, at(IN_CELL)),
    "a binary dictionary's hex struct value": () => stringValue(BINARY, at(IN_STRUCT)),
    "a binary dictionary's hex cell value": () => stringValue(BINARY, at(IN_CELL)),
    'a MAT-file variable': () => matStringValue(join(TEST_ROOT, 'fixtures/mcos/Param.mat'), (root) => root.children[0]),
    "a MAT-file struct's field": () => matStringValue(join(TEST_ROOT, 'fixtures/mcos/nested_objects.mat'), inStructOf),
  };
  const results = new Map<string, Typed>();
  const result = (venue: string): Typed => {
    if (!results.has(venue)) {
      results.set(venue, CASES[venue]());
    }
    return results.get(venue)!;
  };

  // What the expected failures below stand on, held as it is now: so that each of them can fail
  // only at the read-back it names, and passes once that is fixed.
  for (const venue of Object.keys(CASES)) {
    it(`in ${venue}: is taken, shown as the string, and the file opened again holds the Parameter`, () => {
      const r = result(venue);
      expect([r.className, r.taken, r.shown]).toEqual(['Simulink.Parameter', true, '"s"']);
      expect(typeof r.reopened).toBe('string');
    });
  }

  it("in a text dictionary, is reopened as the string the tree shows, in a struct and in a cell", () => {
    expect([result("a text dictionary's struct value").reopened, result("a text dictionary's cell value").reopened]).toEqual(['"s"', '"s"']);
  });

  // Held in a binary dictionary's hex value (mcosStreamEdit) or in a MAT-file's objects, the save
  // writes the Value cell as the char row 's' (McosEditRules: "a char row, which MATLAB loads as a
  // string scalar"), and the file opened again shows the string "s" MATLAB loads of it (measured
  // against MATLAB R2027a: class string; mcosShown.withParameterValueShown), as the text twin's does.
  // A char typed there is the string MATLAB loads of it, before the save and after.
  it('in a MAT-file, a char typed is the string MATLAB loads of the char row its save writes', () => {
    for (const [file, find] of [[join(TEST_ROOT, 'fixtures/mcos/Param.mat'), (root: any) => root.children[0]], [join(TEST_ROOT, 'fixtures/mcos/nested_objects.mat'), inStructOf]] as const) {
      const r = matStringValue(file, find, "'zz'");
      expect([r.taken, r.shown, r.reopened], file).toEqual([true, '"zz"', '"zz"']);
    }
  });

  for (const venue of ["a binary dictionary's hex struct value", "a binary dictionary's hex cell value", 'a MAT-file variable', "a MAT-file struct's field"]) {
    it(`in ${venue}, is reopened as the string the tree shows`, () => {
      expect(result(venue).reopened).toBe('"s"');
    });
  }
});
