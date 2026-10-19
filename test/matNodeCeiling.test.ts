// Copyright 2026 The MathWorks, Inc.
//
// The node-count ceiling of a .mat file's tree (MEM-CEIL; the maintainer's group F ruling of
// 2026-10-18, group 3: "a node-count ceiling with a source warning now, lazy expansion later,
// as its own item"). An 8 MB corpus .mat file opened as 2,016,325 nodes and 2.5 GB
// of heap with no word about it: MAX_EXPANDED_ELEMENTS caps one container's rows, and nothing
// capped the file's. Past MAT_NODE_CEILING a container is built with all its rows or with none,
// one warning on the file names the first one shown without its contents, and nothing it shows
// or copies is other than it was: its Value is the one it had, and a copy of it is the copy it
// had, byte for byte.
//
// Every case opens the file through MatNode.fromParsed, the path addMatSource takes, twice:
// once under the ceiling the case is about and once with no ceiling it can reach, which is the
// tree every file opened as before. What a cut tree shows is graded against that one. The last
// case opens other files after a .mat one, to see that the ceiling was armed for that file alone.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createSession, ingest } from '../src/index.js';
import MatNode from '../src/datamodel/node/container/MatNode.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import { buildUnderCeiling } from '../src/datamodel/node/data/matNodeCeiling.js';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { encodeMatStream } from '../src/datamodel/parser/MatWriter.js';
import { MAT_NODE_CEILING } from '../src/datamodel/display/DisplayConvention.js';
import type { ParseWarning } from '../src/datamodel/parser/ParseWarning.js';
import { CLASS, MI, cellVar, charVar, matFile, numericVar, sparseVar, structVar, u32le } from './tools/matBytes.js';

type Any = any;

/** Past any tree here: the tree as it opened before there was a ceiling. */
const NO_CEILING = Number.MAX_SAFE_INTEGER;

function open(buf: ArrayBuffer, nodeCeiling: number): { root: Any; warnings: ParseWarning[] } {
  // A parse of its own each time: fromParsed attaches what the MCOS decoder read to the
  // variables it is handed.
  const parsed = parseMat(buf);
  const root = (MatNode.fromParsed as Any)(parsed, 'f.mat', { nodeCeiling });
  return { root, warnings: parsed.warnings };
}

function nodesUnder(n: Any): Any[] {
  const out: Any[] = [];
  const walk = (x: Any): void => {
    for (const c of x.children) {
      out.push(c);
      walk(c);
    }
  };
  walk(n);
  return out;
}

/** The node at each id (the path of names from the file down), in tree order. */
function byId(root: Any): Map<string, Any> {
  return new Map(nodesUnder(root).map((n) => [n.id, n]));
}

/** What a host copies of a node (pasteVenues.copyOf), or what it was refused with. */
function copied(n: Any): string {
  try {
    return JSON.stringify(n.serialize());
  } catch (e) {
    return 'refused: ' + (e as Error).message;
  }
}

/** The node as a binary dictionary's XML spells it, or what that was refused with. */
function asXml(n: Any): string {
  try {
    return n.serializeXml('P', { Name: 'Value' }, 0);
  } catch (e) {
    return 'refused: ' + (e as Error).message;
  }
}

/**
 * Every way the cut tree differs from the uncut one, other than in the rows it does not have:
 * a row with some of its rows and not all, an object (typed, or a decoded MCOS value) missing
 * any, and at every node the Value it shows, whether it takes an editor, its Class; and at
 * every variable and at every node shown without its rows, what a copy of it is and what a
 * binary dictionary's XML of it is.
 */
function differences(cut: Any, uncut: Any): string[] {
  const whole = byId(uncut);
  const out: string[] = [];
  const graded = [...cut.children];
  for (const n of nodesUnder(cut)) {
    const u = whole.get(n.id);
    if (!u) {
      out.push(n.id + ': not in the uncut tree');
      continue;
    }
    if (n.children.length !== u.children.length) {
      if (n.children.length !== 0) {
        out.push(n.id + `: ${n.children.length} of its ${u.children.length} rows`);
      } else if (!(n instanceof MatlabVariableNode)) {
        out.push(n.id + ': a typed object, cut');
      } else if (n._isOpaque) {
        out.push(n.id + ': an MCOS object, cut');
      } else {
        graded.push(n);
      }
    }
    for (const key of ['displayValue', 'valueEditable', 'className']) {
      if (n[key] !== u[key]) {
        out.push(`${n.id}: ${key} ${JSON.stringify(n[key])}, uncut ${JSON.stringify(u[key])}`);
      }
    }
  }
  for (const n of graded) {
    const u = whole.get(n.id);
    if (copied(n) !== copied(u)) {
      out.push(`${n.id}: copied as ${copied(n).slice(0, 160)}, uncut ${copied(u).slice(0, 160)}`);
    }
    if (n instanceof MatlabVariableNode && asXml(n) !== asXml(u)) {
      out.push(`${n.id}: XML ${asXml(n).slice(0, 160)}, uncut ${asXml(u).slice(0, 160)}`);
    }
  }
  return out;
}

/** A miCOMPRESSED element as MATLAB writes one: unpadded, so nothing follows it to be read. */
function compressed(bytes: Uint8Array): Uint8Array {
  const z = deflateSync(bytes);
  const out = new Uint8Array(8 + z.length);
  out.set(u32le(MI.COMPRESSED), 0);
  out.set(u32le(z.length), 4);
  out.set(z, 8);
  return out;
}

const shownWithoutContents = (root: Any): Any[] =>
  nodesUnder(root).filter((n) => n instanceof MatlabVariableNode && n.children.length === 0 && n._cutByCeiling);

// ---- A file holding one of each kind of container a .mat tree builds rows for ----

const dbl = (real: number[], dimensions = [1, real.length]): Uint8Array =>
  numericVar({ name: '', cls: CLASS.DOUBLE, dimensions, real });
const chr = (text: string): Uint8Array => charVar('', text, MI.UTF16);

function everyKind(): ArrayBuffer {
  return matFile([
    numericVar({ name: 'first', cls: CLASS.DOUBLE, dimensions: [1, 8], real: [1, 2, 3, 4, 5, 6, 7, 8] }),
    structVar('sa', ['x', 'y'], [{ x: dbl([1]), y: chr('ab') }, { x: dbl([2]), y: chr('cd') }], [1, 2]),
    structVar('s1', ['a', 'b', 'c'], [{ a: dbl([1, 2, 3]), b: chr('hi'), c: cellVar('', [dbl([1]), chr('x')]) }]),
    cellVar('c', [dbl([1]), chr('ab'), dbl([1, 2, 3])]),
    cellVar('cs', [structVar('', ['a'], [{ a: dbl([1]) }]), dbl([1])]),
    cellVar('cc', [cellVar('', [dbl([1]), dbl([2])]), dbl([3])]),
    numericVar({ name: 'n', cls: CLASS.DOUBLE, dimensions: [1, 5], real: [1, 2, 3, 4, 5] }),
    numericVar({ name: 'col', cls: CLASS.INT8, dimensions: [3, 1], real: [-1, 0, 7] }),
    sparseVar({ name: 'sp', dimensions: [3, 3], ir: [0, 2], jc: [0, 1, 1, 2], real: [4, 5] }),
    numericVar({ name: 'lg', cls: CLASS.UINT8, logical: true, dimensions: [1, 4], real: [1, 0, 1, 1] }),
    numericVar({ name: 'cplx', cls: CLASS.DOUBLE, dimensions: [1, 3], real: [1, 2, 3], imag: [4, 0, -1] }),
    cellVar('ndc', [dbl([1]), dbl([2])], [1, 1, 2]),
    cellVar('nest', [cellVar('', [sparseVar({ name: '', dimensions: [1, 3], ir: [0, 0], jc: [0, 1, 1, 2], real: [6, 7] })]), dbl([1])]),
  ]);
}

describe('a .mat file past its node ceiling', () => {
  it('is 500,000 nodes by default', () => {
    expect(MAT_NODE_CEILING).toBe(500_000);
  });

  it('builds each container with all its rows or none, within the ceiling, and says which once', () => {
    // (a) A 1x3 cell of 1x2000 structs of two fields: 18,004 nodes uncut. Depth first, the
    // first struct is whole, and the two after it are shown without their contents.
    const field = (k: number): Record<string, Uint8Array> => ({ x: dbl([k]), y: dbl([-k]) });
    const struct2000 = structVar('', ['x', 'y'], Array.from({ length: 2000 }, (_, k) => field(k)), [1, 2000]);
    const file = matFile([compressed(cellVar('c', [struct2000, struct2000, struct2000]))]);
    const uncut = open(file, NO_CEILING);
    const cut = open(file, 10_000);
    expect(nodesUnder(uncut.root).length).toBe(18_004);
    expect(nodesUnder(cut.root).length).toBeLessThanOrEqual(10_000);
    expect(differences(cut.root, uncut.root)).toEqual([]);
    expect(shownWithoutContents(cut.root).map((n) => n.matlabPath)).toEqual(['c{2}', 'c{3}']);
    expect(cut.warnings.filter((w) => w.code === 'part-not-expanded')).toEqual([
      {
        code: 'part-not-expanded',
        part: 'c{2}',
        message:
          '"c{2}" and 1 other value are shown without their contents: this file holds more than 10,000 values to ' +
          'show. Copying one copies it whole.',
      },
    ]);
    expect(uncut.warnings).toEqual([]);
  });

  it('shows and copies every kind of container it cuts as it did uncut, at every ceiling', () => {
    // (b) and (c), at every ceiling from none at all to the whole tree: struct arrays, a 1x1
    // struct, cells (one nested, one holding a struct, one N-D, one holding a cell that holds a
    // sparse array), and numeric, int, logical, complex and sparse arrays. A cell's Value is
    // the literal of its elements, which a cut cell has no rows for, and whether it takes an
    // editor is whether that literal is its value.
    const file = everyKind();
    const uncut = open(file, NO_CEILING).root;
    const total = nodesUnder(uncut).length;
    expect(total).toBe(72);
    const cutAt: number[] = [];
    for (let ceiling = 0; ceiling <= total; ceiling++) {
      const { root, warnings } = open(file, ceiling);
      expect(differences(root, uncut), `ceiling ${ceiling}`).toEqual([]);
      expect(nodesUnder(root).length, `ceiling ${ceiling}`).toBeLessThanOrEqual(Math.max(ceiling, uncut.children.length));
      const cut = shownWithoutContents(root);
      expect(warnings.filter((w) => w.code === 'part-not-expanded').length, `ceiling ${ceiling}`).toBe(cut.length > 0 ? 1 : 0);
      if (cut.length > 0) {
        cutAt.push(ceiling);
      }
    }
    // Something was cut at every ceiling short of the tree: the comparisons above graded it.
    expect(cutAt).toEqual(Array.from({ length: total }, (_, k) => k));
    // At 21, the thirteen variables and the rows of `first`, everything after `first` is shown
    // without its contents, and the cell literals are still the literals.
    const { root, warnings } = open(file, 21);
    expect(shownWithoutContents(root).map((n) => n.name)).toEqual(['sa', 's1', 'c', 'cs', 'cc', 'n', 'col', 'sp', 'lg', 'cplx', 'ndc', 'nest']);
    const variable = (name: string): Any => root.children.find((v: Any) => v.name === name);
    expect(['c', 'cs', 'cc', 'n'].map((name) => [variable(name).displayValue, variable(name).valueEditable])).toEqual([
      ["{1, 'ab', [1 2 3]}", true],
      ['{<1x1 struct>, 1}', false],
      ['{{1, 2}, 3}', true],
      ['[1 2 3 4 5]', true],
    ]);
    expect(warnings[0].message).toBe(
      '"sa" and 11 other values are shown without their contents: this file holds more than 21 values to show. ' +
        'Copying one copies it whole.',
    );
  });

  it('takes no Add into a container shown without its contents, and a Value typed over one replaces it', () => {
    // An added row would be the container's only one, and the value it holds is not in its
    // rows: Add is withheld. A Value typed in whole is the value, rows and all.
    const file = everyKind();
    const uncut = open(file, NO_CEILING).root.children.find((v: Any) => v.name === 'n');
    const n = open(file, 10).root.children.find((v: Any) => v.name === 'n');
    expect([uncut.canAddChild(), n.children.length, n.canAddChild()]).toEqual([true, 0, false]);
    expect(n.setProperty('Value', '[7 8 9]')).toBe(true);
    expect([n.children.length, n.canAddChild(), n.displayValue, JSON.parse(copied(n)).value]).toEqual([3, true, '[7 8 9]', [7, 8, 9]]);
  });

  it('hands over a renamed variable it cut as its value under its new name', () => {
    // MatNode.getVariables collects a .mat file's variables for a writer, each its `_var`. A
    // variable renamed is edited, and its variable is rebuilt from its rows; one shown without
    // its rows is the variable it was read as, under the new name.
    const file = everyKind();
    const uncut = open(file, NO_CEILING).root;
    const cut = open(file, 10).root;
    const s1 = (root: Any): Any => root.children.find((v: Any) => v.name === 's1');
    expect([s1(uncut).children.length, s1(cut).children.length]).toEqual([3, 0]);
    for (const root of [uncut, cut]) {
      expect(s1(root).setProperty('Name', 's2')).toBe(true);
    }
    const handed = (root: Any): Any => root.getVariables().find((v: Any) => v.name === 's2');
    expect(handed(cut)).toBeDefined();
    expect(Array.from(encodeMatStream(handed(cut)))).toEqual(Array.from(encodeMatStream(handed(uncut))));
    expect(Object.keys(handed(cut).fields)).toEqual(['a', 'b', 'c']);
  });

  it('shows a container it cut whose rows cannot be built as the file shows it uncut, not decoded', () => {
    // A complex element whose flags word names no class (255) has no value, and building it
    // throws: uncut, the variable holding it is shown not decoded, and its copy is refused
    // (MatNode.fromParsed). Cut, nothing builds it while the file opens, and the cell shows,
    // and is copied, as the value its rows would have made, which is that one.
    const damaged = numericVar({ name: '', cls: CLASS.DOUBLE, dimensions: [1, 1], real: [3], imag: [4] }).slice();
    new DataView(damaged.buffer).setUint32(16, 0xffffffff, true);
    const file = matFile([numericVar({ name: 'first', cls: CLASS.DOUBLE, dimensions: [1, 4], real: [1, 2, 3, 4] }), cellVar('bad', [damaged, dbl([5])])]);
    const uncut = open(file, NO_CEILING).root;
    expect([nodesUnder(uncut).length, uncut.children[1].displayValue]).toEqual([6, '<1x2 cell, not decoded>']);
    expect(open(file, 6).root.children[1]._cutByCeiling).toBe(2);
    for (const ceiling of [0, 6]) {
      const { root } = open(file, ceiling);
      expect(differences(root, uncut), `ceiling ${ceiling}`).toEqual([]);
      expect(root.children[1].displayValue).toBe('<1x2 cell, not decoded>');
    }
  });

  it('builds an MCOS object\'s typed node whole, and counts what it holds', () => {
    // ParamMat.mat holds one Simulink.Parameter, whose typed node holds its Value and that
    // Value's six element rows; a 1x3 cell follows it here. The Parameter is never cut, and its
    // seven rows are spent before the cell's three are asked for.
    const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL('fixtures/mcos/ParamMat.mat', import.meta.url))));
    const withCell = new Uint8Array([...u8, ...cellVar('c9', [dbl([1]), dbl([2]), dbl([3])])]);
    const file = withCell.buffer as ArrayBuffer;
    const shape = (ceiling: number): [string[], number, number] => {
      const { root } = open(file, ceiling);
      const [param, c9] = root.children;
      return [root.children.map((v: Any) => v.constructor.name), nodesUnder(param).length, c9.children.length];
    };
    expect(shape(NO_CEILING)).toEqual([['ParameterNode', 'MatlabVariableNode'], 7, 3]);
    expect(shape(12)).toEqual([['ParameterNode', 'MatlabVariableNode'], 7, 3]);
    expect(shape(11)).toEqual([['ParameterNode', 'MatlabVariableNode'], 7, 0]);
    expect(shape(0)).toEqual([['ParameterNode', 'MatlabVariableNode'], 7, 0]);
  });

  it('cuts no repo fixture differently from how it shows it uncut, and leaves every typed object whole', { timeout: 120_000 }, () => {
    // Every .mat in the repo, graded against itself opened with no ceiling: the strings, MCOS
    // objects and shared object graphs this file builds no example of.
    const root = fileURLToPath(new URL('.', import.meta.url));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, e.name);
        if (e.isDirectory()) walk(abs);
        else if (e.name.endsWith('.mat') && e.name !== 'strings_v73.mat') files.push(abs);
      }
    };
    walk(join(root, 'fixtures'));
    walk(join(root, 'parity', 'artifacts'));
    expect(files.length).toBeGreaterThanOrEqual(30);
    let cutFiles = 0;
    for (const f of files.sort()) {
      const u8 = new Uint8Array(readFileSync(f));
      const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
      const uncut = open(buf, NO_CEILING).root;
      const total = nodesUnder(uncut).length;
      // Every ceiling, for a file small enough, so that every container in it is met with its
      // rows and without them, under one with its rows; for the three shared-object graphs of
      // 24,000 nodes and more, none and half.
      const ceilings = total <= 300 ? Array.from({ length: total + 1 }, (_, k) => k) : [0, Math.floor(total / 2)];
      for (const ceiling of ceilings) {
        const { root: cut, warnings } = open(buf, ceiling);
        expect(differences(cut, uncut), `${f} at ${ceiling}`).toEqual([]);
        const shown = shownWithoutContents(cut);
        expect(warnings.filter((w) => w.code === 'part-not-expanded').map((w) => w.part), `${f} at ${ceiling}`).toEqual(
          shown.length > 0 ? [shown[0].matlabPath] : [],
        );
        if (shown.length > 0 && ceiling === 0) {
          cutFiles++;
        }
      }
    }
    expect(cutFiles).toBeGreaterThanOrEqual(10);
  });

  it('opens a file under its ceiling as it always did, with no warning', () => {
    // (e) Under the ceiling nothing changes.
    const file = everyKind();
    const { root, warnings } = open(file, 72);
    expect([nodesUnder(root).length, shownWithoutContents(root).length, warnings]).toEqual([72, 0, []]);
    const session: Any = createSession().addMatSource('k.mat', file);
    expect([nodesUnder(session).length, session.warnings]).toEqual([72, undefined]);
  });

  it('opens the 1x300,000 struct of F1-1 within the default ceiling, and says so on the source', { timeout: 120_000 }, () => {
    // (d) One field held per element: 600,001 nodes as it opened before, past 500,000. Its
    // elements and their fields are one container's rows, built together or not at all.
    const elements = Array.from({ length: 300_000 }, (_, k) => ({ v: dbl([k]) }));
    const file = matFile([compressed(structVar('big', ['v'], elements, [1, 300_000]))]);
    const opened: Any = createSession().addMatSource('big.mat', file);
    expect(nodesUnder(opened).length).toBeLessThanOrEqual(500_000);
    const big = opened.children[0];
    expect([big.displayValue, big.children.length]).toEqual(['<1x300000 struct>', 0]);
    expect(opened.warnings).toEqual([
      {
        code: 'part-not-expanded',
        part: 'big',
        message:
          '"big" is shown without its contents: this file holds more than 500,000 values to show. Copying it copies ' +
          'it whole.',
      },
    ]);
    // A host that parsed the file itself and hands over a parse without a warnings list (an
    // older one) still hears it.
    const parsed: Any = parseMat(file);
    delete parsed.warnings;
    const fromHost: Any = createSession().addMatSourceParsed('big.mat', parsed);
    expect(fromHost.warnings.map((w: ParseWarning) => w.code)).toEqual(['part-not-expanded']);
    // And its copy is the whole struct.
    const value = JSON.parse(copied(big)).value;
    expect([value._dimensions, value._elements.length, value._elements[299_999]]).toEqual([[1, 300_000], 300_000, { v: 299_999 }]);
  });

  it('is armed only while a .mat file is built: what opens after one used up, or after a build that threw, is whole', () => {
    // matNodeCeiling arms the ceiling for one .mat file's tree and sets it back in a finally.
    // Nothing else is built under it: a text dictionary's cdata and a binary one's hex, each a
    // value read out of a MAT stream, and a model's workspace. Each holds sparse arrays, built
    // with their rows as a .mat file's are. A ceiling left armed, used up, would build them
    // with none.
    // Each opened on its own: how many nodes, how many of them a MAT stream's value built with
    // rows, and which have none (`_cutByCeiling`).
    const others = (): [string, number, number, string[]][] =>
      ['sparse_text.sldd', 'sparse_binary.sldd', 'sparse_ws.slx'].map((name) => {
        const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL('fixtures/sparse/' + name, import.meta.url))));
        const source: Any = ingest(createSession(), u8.buffer as ArrayBuffer, { filename: name });
        const nodes = nodesUnder(source);
        const withRows = nodes.filter((n) => n._matVar && n.children.length > 0).length;
        return [name, nodes.length, withRows, nodes.filter((n) => n._cutByCeiling).map((n) => n.matlabPath)];
      });
    const before = others();
    for (const [name, , withRows, cut] of before) {
      expect([name, withRows > 0, cut]).toEqual([name, true, []]);
    }

    // A .mat file whose ceiling is used up: everything after its first variable has no rows.
    const { root, warnings } = open(everyKind(), 21);
    expect([shownWithoutContents(root).length, warnings.map((w) => w.code)]).toEqual([12, ['part-not-expanded']]);
    expect(others()).toEqual(before);

    // A build that throws after it used up its ceiling: the throw reaches the caller, and the
    // ceiling is not left armed.
    const parsed = parseMat(everyKind());
    const thrown = (): unknown =>
      buildUnderCeiling(21, () => {
        const node = new MatNode('threw.mat');
        MatNode._addVariables(node, parsed);
        expect(shownWithoutContents(node).length).toBe(12);
        throw new Error('the build failed');
      });
    expect(thrown).toThrow('the build failed');
    expect(others()).toEqual(before);
  });
});
