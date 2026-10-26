// Copyright 2026 The MathWorks, Inc.
//
// A container the node ceiling built without its rows (MatlabVariableNode._cutByCeiling) is
// edited and saved as it is with them. Its edit is judged, and its save written, from the
// variable it was read as (MatFileWriter.shortVariableIn, notPlainIn), where a container with
// its rows is judged from them (shortIn, unwritableAt): one rule, two paths. So each case opens
// the file twice, with every row and under a ceiling of 0, which cuts every container, and holds
// the two to one answer: the gate (sourceEditRefusal) says the same of each, and a save of an
// edit forced around the gate refuses in the same words, or writes a value that reads back the
// same (variableDifference).
//
// First every Level-5 fixture, none of which is damaged; then containers read short out of a
// damaged record, at every depth, which the fixtures hold none of: a save would write each
// element it does not hold as an empty double, so each is refused, in the gate's words.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { serializeMatFile, variableDifference } from '../src/datamodel/parser/MatFileWriter.js';
import { MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { sourceEditRefusal } from '../src/datamodel/node/BaseNode.js';
import MatNode from '../src/datamodel/node/container/MatNode.js';
import '../src/index.js';
import { CLASS, cellVar, matFile, numericVar, structVar } from './tools/matBytes.js';

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));

// Every `.mat` under test/, as matEditGate.test.ts sweeps them, MATLAB's verdict corpus included:
// the -v7.3 one aside, which is HDF5.
function matFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...matFilesUnder(abs));
    } else if (entry.isFile() && entry.name.endsWith('.mat') && entry.name !== 'strings_v73.mat') {
      out.push(abs);
    }
  }
  return out.sort();
}

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const fileBytes = (abs: string) => arrayBufferOf(new Uint8Array(readFileSync(abs)));
const scalar = (name: string, value: number) => numericVar({ name, cls: CLASS.DOUBLE, dimensions: [1, 1], real: [value] });

/** `bytes` as addMatSource builds it: whole, or under a ceiling of 0, which cuts every container. */
function tree(bytes: ArrayBuffer, cut: boolean): any {
  return MatNode.fromParsed(parseMat(bytes), 'f.mat', cut ? { nodeCeiling: 0 } : {});
}

/** The save of `root`, or the refusal it throws. */
function saved(root: any): { bytes: Uint8Array } | { refused: string } {
  try {
    return { bytes: serializeMatFile(root) };
  } catch (e) {
    if (e instanceof MatWriteError) {
      return { refused: e.message };
    }
    throw e;
  }
}

/**
 * What the gate says of an edit of the value of variable `i` of `bytes`, and what the save of
 * that edit forced around the gate (the variable marked edited, which is what every edit does)
 * writes or refuses: of the tree with every row, and of the cut one.
 */
function judged(bytes: ArrayBuffer, i: number) {
  return [false, true].map((cut) => {
    const root = tree(bytes, cut);
    const node = root.children[i];
    const gate = sourceEditRefusal(node, 'Value');
    node._markModified();
    return { node, gate, save: saved(root) };
  });
}

// E1 of the 2026-10-26 edit bash, pinned as it is until it is fixed: a struct or cell holding an
// enumeration value refuses every edit of its Value, and in other words when the node ceiling cut
// it. By container, what the gate says of each tree; the save of each refuses in the same words.
const ENUM = 'is a matlab.lang.OnOffSwitchState, which this package cannot write into a MAT-file.';
const HANDLE = 'holds an object whose handle this package could not read, so a save could not write it as it is.';
const E1 = new Map(
  ['r2023b', 'r2027a'].flatMap((release) =>
    [
      ['enumOnInStruct', 'enumOnInStruct.v'],
      ['enumOnInCell', 'enumOnInCell{1}'],
    ].map(([name, member]): [string, { whole: string; cut: string }] => [
      `fixtures/edit-bash/${release}/values.mat: ${name}`,
      { whole: `Cannot edit "${name}": ${member} ${ENUM}`, cut: `Cannot edit "${name}": ${member} ${HANDLE}` },
    ]),
  ),
);

describe('a container the node ceiling cut is gated and saved as it is with its rows', () => {
  it('in every fixture: the same verdict, the same refusal, or a value that reads back the same', { timeout: 120_000 }, () => {
    let cut = 0;
    const metE1: string[] = [];
    for (const file of matFilesUnder(TEST_ROOT)) {
      const bytes = fileBytes(file);
      try {
        parseMat(bytes);
      } catch {
        continue;
      }
      const count = tree(bytes, false).children.length;
      for (let i = 0; i < count; i++) {
        const [whole, shown] = judged(bytes, i);
        if (!shown.node._cutByCeiling) {
          continue;
        }
        cut++;
        const label = file.slice(TEST_ROOT.length) + ': ' + whole.node.name;
        const pinned = E1.get(label);
        if (pinned) {
          expect([whole.gate, shown.gate], label).toEqual([pinned.whole, pinned.cut]);
          for (const t of [whole, shown]) {
            expect((t.save as { refused?: string }).refused, label).toBe(t.gate!.replace(/^Cannot edit/, 'Cannot write') + ' Nothing was written.');
          }
          metE1.push(label);
          continue;
        }
        expect(shown.gate, label).toBe(whole.gate);
        // And the gate is the writer, in each tree.
        for (const t of [whole, shown]) {
          expect('refused' in t.save, label + ': ' + t.gate).toBe(t.gate !== null);
        }
        if ('refused' in whole.save) {
          expect((shown.save as { refused: string }).refused, label).toBe(whole.save.refused);
        } else {
          const back = (s: ReturnType<typeof saved>) => parseMat(arrayBufferOf((s as { bytes: Uint8Array }).bytes)).variables[i];
          expect(variableDifference(back(whole.save), back(shown.save), whole.node.name), label).toBeNull();
        }
      }
    }
    // The fixtures hold that many containers to cut, and the sweep met them.
    expect(cut).toBeGreaterThanOrEqual(500);
    expect(metE1.sort()).toEqual([...E1.keys()].sort());
  });
});

describe('a container read short, at any depth, cut or not', () => {
  const short = cellVar('', [scalar('', 1)], [1, 3]);
  const SHORT = 'is a 1x3 cell holding 1 of the 3 elements it declares, and a save would write the ones it does not hold as empty';
  const cases: [string, Uint8Array, string][] = [
    ['a cell', cellVar('c', [scalar('', 1)], [1, 3]), 'c ' + SHORT],
    ["a struct's field", structVar('s', ['a', 'b'], [{ a: short, b: scalar('', 2) }]), 's.a ' + SHORT],
    ['a cell in a cell', cellVar('n', [cellVar('', [short], [1, 1])], [1, 1]), 'n{1}{1} ' + SHORT],
    ["a field of an element of a struct array", structVar('t', ['a'], [{ a: scalar('', 2) }, { a: short }], [1, 2]), 't(2).a ' + SHORT],
    ['a cell none of whose elements could be read', cellVar('e', [], [1, 3]), 'e is a 1x3 cell none of whose 3 elements could be read, so there is no value of it to write'],
    ['a struct array none of whose elements could be read', structVar('f', ['a'], [], [1, 3]), 'f is a 1x3 struct none of whose 3 elements could be read, so there is no value of it to write'],
  ];
  for (const [what, element, why] of cases) {
    it(`${what}: refused by the gate and by the save in the same words, with its rows or without`, () => {
      const bytes = matFile([element, scalar('ok', 1)]);
      for (const { node, gate, save } of judged(bytes, 0)) {
        expect(gate).toBe('Cannot edit "' + node.name + '": ' + why + '.');
        expect(save).toEqual({ refused: 'Cannot write "' + node.name + '": ' + why + '. Nothing was written.' });
      }
      // The variable beside it takes its edit, and the file is written.
      const root = tree(bytes, true);
      root.children[1]._markModified();
      expect('bytes' in saved(root)).toBe(true);
    });
  }

  it('a struct array read short: refused by both, the cut one naming the field it was read short in', () => {
    // MatParser reads a struct array field by field, so what it holds short is a field's run of
    // elements, which the cut tree's judge (shortVariableIn) names; the tree with rows has one row
    // per element it read, and names none. Both refuse the same edit, of the same count.
    const bytes = matFile([structVar('u', ['a'], [{ a: scalar('', 2) }], [1, 3])]);
    const [whole, shown] = judged(bytes, 0);
    const why = 'u is a 1x3 struct array holding 1 of the 3 elements it declares';
    expect(whole.gate).toBe('Cannot edit "u": ' + why + ', and a save would write the ones it does not hold as empty.');
    expect(shown.gate).toBe('Cannot edit "u": ' + why + ' in its field a, and a save would write the ones it does not hold as empty.');
    for (const t of [whole, shown]) {
      expect((t.save as { refused: string }).refused).toBe(t.gate!.replace(/^Cannot edit/, 'Cannot write').replace(/\.$/, '. Nothing was written.'));
    }
  });
});
