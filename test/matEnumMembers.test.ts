// Copyright 2026 The MathWorks, Inc.
//
// A struct or a cell of a MAT-file that holds an enumeration value takes the edits of its other
// members, as it takes them beside any other object of the file. MATLAB stores an enumeration
// value as a class-17 element whose fourth part is an instance struct, not the handle every other
// object holds (MatParser.enumerationInstanceOf), and a save writes the struct or the cell fresh
// with that element as it was read (MatFileWriter.objectElementOf), which names the class and the
// enumerals in the file's subsystem, which no save renumbers. Before, the element was refused for
// having no handle, so every edit of the container was refused: E1 of the 2026-10-26 edit bash.
//
// The fixtures are MATLAB's (fixtures/mat-enum-members/make_enum_members.m, R2027a and R2023b,
// compressed and not), and every edit taken here was made by MATLAB too on the original and loaded
// equal (isequaln, class and size of the edited value, no load warning, MATLAB's re-save equal),
// with a control caught, but for what MATLAB and this package do alike everywhere: a real number
// typed into an int8 member keeps its class (classAfterEdit), and a cell emptied by deletes.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { parseMat, opaqueElementOf } from '../src/datamodel/parser/MatParser.js';
import { sourceEditRefusal } from '../src/datamodel/node/BaseNode.js';
import { mcosEnumerationOf } from '../src/datamodel/node/mcosPlace.js';
import { isEnumBag } from '../src/datamodel/parser/XmlUtils.js';
import MatNode from '../src/datamodel/node/container/MatNode.js';
import MatlabVariableNode from '../src/datamodel/node/data/MatlabVariableNode.js';
import { bufferOf, sameBytes } from './tools/matPaste.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES = ['r2027a', 'r2023b'].flatMap((r) => ['enum_members.mat', 'enum_members_nc.mat'].map((f) => `fixtures/mat-enum-members/${r}/${f}`));
const bytesOf = (path: string) => new Uint8Array(readFileSync(TEST_ROOT + path));

function matsUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...matsUnder(p));
    else if (e.name.endsWith('.mat') && e.name !== 'strings_v73.mat') out.push(p);
  }
  return out.sort();
}

/** A file opened through a session, as a host opens one, and what a host does to it. */
function opened(bytes: Uint8Array) {
  const session = createSession();
  const root: any = session.addMatSource('m.mat', bufferOf(bytes));
  const at = (path: string): any => root.flatten().find((n: any) => n.matlabPath === path);
  const edit = (path: string, key: string, value: string) => {
    const node = at(path);
    session.setActive(root, node);
    return session.editProperty(node.id, key, value);
  };
  const save = (): Uint8Array => (session.serializeSource('m.mat') as { bytes: Uint8Array }).bytes;
  const undo = () => {
    session.setActive(root, null);
    session.undo();
  };
  const redo = () => {
    session.setActive(root, null);
    session.redo();
  };
  return { session, root, at, edit, save, undo, redo };
}

/** Every MAT-file fixture under test/ that opens, opened, with its path under test/ and its bytes. */
function* everyFixtureOpened(): Generator<ReturnType<typeof opened> & { file: string; bytes: Uint8Array }> {
  for (const path of matsUnder(TEST_ROOT)) {
    const bytes = new Uint8Array(readFileSync(path));
    let o: ReturnType<typeof opened>;
    try {
      o = opened(bytes);
    } catch {
      continue;
    }
    yield { ...o, file: path.slice(TEST_ROOT.length), bytes };
  }
}

/** Every row of the tree: its path, class and text, as a reopen is held to. */
const rowsOf = (root: any): string[] => root.flatten().map((n: any) => [n.matlabPath, n.className, JSON.stringify(n.toRow().Value)].join(' '));

// An enumeration value's node, as its bag says (ObjectNode), and not an element row of one.
const isEnumeration = (n: any) => isEnumBag(n.serial?._rawVal) && !isEnumBag(n.parent?.serial?._rawVal);
// An object of the file a struct or a cell holds: an enumeration value, a typed object, a string.
const isObject = (n: any) => !(n instanceof MatlabVariableNode) || n._isOpaque;
const holds = (n: any, what: (c: any) => boolean): boolean => n.children.some((c: any) => what(c) || (!isObject(c) && holds(c, what)));
const isContainer = (n: any) => n instanceof MatlabVariableNode && !n._isOpaque && (n._kind === 'cell' || n._scalarType === 'struct');

/** The plain members of the containers of `root` holding what `what` says, at any depth, with no rows of their own. */
function plainMembersBeside(root: any, what: (c: any) => boolean): string[] {
  const out = new Set<string>();
  for (const n of root.flatten()) {
    if (isContainer(n) && holds(n, what)) {
      for (const c of n.children) {
        if (!isObject(c) && c.children.length === 0) out.add(c.matlabPath);
      }
    }
  }
  return [...out];
}

/** A text for `node`'s Value that is not the one it shows, of its kind. */
function textFor(node: any): string {
  const shown = String(node.toRow().Value);
  if (node._scalarType === 'logical') return shown === 'true' ? 'false' : 'true';
  if (node._scalarType === 'char') return "'zq'";
  if (node._scalarType === 'string') return '"zq"';
  return /i$/.test(shown) ? '4+5i' : '42';
}

/**
 * The edit of `path`'s Value in `bytes`, through the session: taken, saved, reopened as the rows
 * showed it, saved after its undo as the file was read, and after its redo as the edit's save.
 * What went otherwise, or null.
 */
function editedEverywhere(bytes: Uint8Array, path: string, text: string, key = 'Value'): string | null {
  const { root, edit, save, undo, redo } = opened(bytes);
  const r = edit(path, key, text);
  if (r !== true) return 'refused: ' + JSON.stringify(r);
  const shown = rowsOf(root);
  let saved: Uint8Array;
  try {
    saved = save();
  } catch (e) {
    return 'taken, and the save refused it: ' + (e as Error).message;
  }
  const back = rowsOf(opened(saved).root);
  if (JSON.stringify(back) !== JSON.stringify(shown)) return 'reopened otherwise: ' + JSON.stringify(back.filter((x) => !shown.includes(x)).slice(0, 3));
  undo();
  if (!sameBytes(save(), bytes)) return 'undone, the save is not the file as read';
  redo();
  return sameBytes(save(), saved) ? null : "redone, the save is not the edit's";
}

describe('the enumeration-member fixtures', () => {
  it('open with no warning, each enumeration value a node built of its element', () => {
    for (const file of FIXTURES) {
      const { root } = opened(bytesOf(file));
      expect(root.warnings ?? [], file).toEqual([]);
      const enumerations = root.flatten().filter(isEnumeration).map((n: any) => n.matlabPath);
      // Scalars, arrays and an empty, in a struct field, a cell, a struct array, at depth 4; and
      // the two at the top.
      expect(enumerations, file).toEqual([
        'sEnum.e', 'cEnum{1}', 'cEnumCol{1}', 'c2x2Enum{1,1}', 'c2x2Enum{2,2}', 'sEnumVec.e', 'cEnumVec{1}', 'sEnumEmpty.e',
        'sCellEnum.inner{1}', 'cStructEnum{1}.e', 'deepEnum.a.b{1}.e', 'saEnum(1).e', 'saEnum(2).e', 'gearInStruct.g',
        'gearInCell{1}', 'enumAndParam.e', 'enumAndString.e', 'topEnum', 'topGear',
      ]);
      // Each one recorded as the enumeration value of the file it was built of.
      for (const n of root.flatten().filter(isEnumeration)) {
        expect(mcosEnumerationOf(n)?.className, file + ' ' + n.matlabPath).toBe(n.className);
      }
    }
  });
});

describe('a struct or a cell of a MAT-file holding an enumeration value', () => {
  it('offers and takes every edit of its plain members, saved, reopened, undone and redone exactly', { timeout: 120_000 }, () => {
    const wrong: string[] = [];
    const counts: number[] = [];
    for (const file of FIXTURES) {
      const bytes = bytesOf(file);
      const { root, at } = opened(bytes);
      const paths = plainMembersBeside(root, isEnumeration);
      for (const path of paths) {
        const node = at(path);
        if (node.toRow()._valueEditable !== true) {
          wrong.push(file + ' ' + path + ': not offered');
          continue;
        }
        const why = editedEverywhere(bytes, path, textFor(node));
        if (why) wrong.push(file + ' ' + path + ': ' + why);
      }
      counts.push(paths.length);
    }
    expect(wrong).toEqual([]);
    expect(counts).toEqual([26, 26, 26, 26]);
  });

  it('takes a member typed as a string, and a string member typed otherwise, beside it', () => {
    // A string is an object of the file: made one, it is added to the subsystem, which the
    // enumeration value's element names by its rows, kept.
    const edits: [string, string][] = [
      ['sEnum.c', '"newstr"'], ['sEnum.d', '"s"'], ['cEnum{3}', '"q"'], ['gearInCell{2}', '"w2"'], ['deepEnum.a.b{2}', '"deep"'],
      ['enumAndString.s', '5'], ['enumAndString.s', '"other"'], ['enumAndParam.p', '7'],
    ];
    for (const file of FIXTURES) {
      for (const [path, text] of edits) {
        expect(editedEverywhere(bytesOf(file), path, text), file + ' ' + path + ' = ' + text).toBeNull();
      }
    }
  });

  it('renames each of its fields, the enumeration value\'s included, and of a struct array\'s elements', () => {
    for (const file of FIXTURES) {
      for (const path of ['sEnum.e', 'sEnum.d', 'deepEnum.a.b{1}.e', 'cStructEnum{1}.d', 'saEnum(1).e', 'saEnum(2).d', 'gearInStruct.g']) {
        const name = path.replace(/^.*\./, '') + '_r';
        expect(editedEverywhere(bytesOf(file), path, name, 'Name'), file + ' ' + path).toBeNull();
      }
    }
  });

  it('takes an Add and a Delete of a member, saved and reopened as the rows show; undone, the value as read', () => {
    for (const file of FIXTURES) {
      const bytes = bytesOf(file);
      const original = rowsOf(opened(bytes).root);
      const cases: [string, (o: ReturnType<typeof opened>) => unknown][] = [
        ['Add to sEnum', (o) => o.session.addChildTo(o.at('sEnum').id)],
        ['Add to cEnum', (o) => o.session.addChildTo(o.at('cEnum').id)],
        ['Add to cEnumCol', (o) => o.session.addChildTo(o.at('cEnumCol').id)],
        ['Add to deepEnum.a.b{1}', (o) => o.session.addChildTo(o.at('deepEnum.a.b{1}').id)],
        ['Delete cEnum{2}', (o) => o.session.deleteNodeById(o.at('cEnum{2}').id)],
        ['Delete cEnum{1}, the enumeration value', (o) => o.session.deleteNodeById(o.at('cEnum{1}').id)],
        ['Delete sCellEnum.inner{2}', (o) => o.session.deleteNodeById(o.at('sCellEnum.inner{2}').id)],
        ['Delete gearInCell{1}', (o) => o.session.deleteNodeById(o.at('gearInCell{1}').id)],
      ];
      for (const [what, act] of cases) {
        const o = opened(bytes);
        o.session.setActiveContext(o.root);
        expect(act(o), file + ' ' + what).toBeTruthy();
        const shown = rowsOf(o.root);
        expect(rowsOf(opened(o.save()).root), file + ' ' + what).toEqual(shown);
        // Undone, the file is saved as the value it was read as, written fresh (the bytes of an
        // undone Add or Delete are not kept, beside an object or not).
        o.undo();
        expect(rowsOf(opened(o.save()).root), file + ' ' + what + ', undone').toEqual(original);
      }
    }
  });

  it('refuses an edit of the enumeration value itself, naming it, and changes nothing', () => {
    const bytes = bytesOf(FIXTURES[0]);
    const refusals: Record<string, string> = {};
    for (const path of ['sEnum.e', 'cEnum{1}', 'sEnumVec.e', 'sEnumVec.e(2)', 'deepEnum.a.b{1}.e', 'saEnum(2).e', 'gearInStruct.g']) {
      const { root, at, edit, save } = opened(bytes);
      expect(at(path).toRow()._valueEditable, path).toBe(false);
      const r: any = edit(path, 'Value', at(path).toRow().Value === 'off' ? 'on' : 'off');
      refusals[path] = r.reason;
      expect(root.dirty, path).toBeFalsy();
      expect(sameBytes(save(), bytes), path).toBe(true);
    }
    const why = (entry: string, path: string, cls = 'matlab.lang.OnOffSwitchState') =>
      `Cannot edit "${entry}": ${path} is a value of the enumeration ${cls}, which a save writes only as it was read, so its edit cannot be saved.`;
    expect(refusals).toEqual({
      'sEnum.e': why('sEnum', 'sEnum.e'),
      'cEnum{1}': why('cEnum', 'cEnum{1}'),
      'sEnumVec.e': why('sEnumVec', 'sEnumVec.e'),
      'sEnumVec.e(2)': why('sEnumVec', 'sEnumVec.e(2)'),
      'deepEnum.a.b{1}.e': why('deepEnum', 'deepEnum.a.b{1}.e'),
      'saEnum(2).e': why('saEnum', 'saEnum(2).e'),
      'gearInStruct.g': why('gearInStruct', 'gearInStruct.g', 'GearMode'),
    });
  });

  it('whose element is not one this package writes back is refused, in the same words cut by the node ceiling or not', () => {
    // The enumeration value's element in an uncompressed file, its flags byte given a bit MATLAB
    // does not set: it still reads as the value, and is not the element this package writes for it.
    const file = bytesOf('fixtures/mat-enum-members/r2027a/enum_members_nc.mat');
    const parsed = parseMat(bufferOf(file));
    const variable = (name: string) => parsed.variables.find((v) => v.name === name)!;
    const at = (element: Uint8Array) => element.byteOffset - file.byteOffset;
    const cases: [string, string, number][] = [
      ['cEnum', 'cEnum{1}', at(opaqueElementOf((variable('cEnum').value as any[])[0])!)],
      ['sEnum', 'sEnum.e', at((variable('sEnum').fields!.e as any)._rawBytes)],
    ];
    for (const [name, path, offset] of cases) {
      const damaged = file.slice();
      damaged[offset + 17] |= 0x02;
      const said = [false, true].map((cut) => {
        const root: any = MatNode.fromParsed(parseMat(bufferOf(damaged)), 'f.mat', cut ? { nodeCeiling: 0 } : {});
        const node = root.children.find((c: any) => c.name === name);
        expect(!!node._cutByCeiling, name).toBe(cut);
        return sourceEditRefusal(node, 'Value');
      });
      const why = `Cannot edit "${name}": ${path} holds an object whose element is not one this package writes back as it was read, so a save could not write it as it is.`;
      expect(said, name).toEqual([why, why]);
    }
  });
});

describe('every struct and cell of every MAT-file fixture holding an object of the file', () => {
  it('passes each enumeration value it holds through as the element it was read as', { timeout: 120_000 }, () => {
    let enumerations = 0;
    const refused: string[] = [];
    for (const { file, root } of everyFixtureOpened()) {
      for (const n of root.flatten()) {
        if (isEnumeration(n) && n.parent !== root && isContainer(n.parent)) {
          enumerations++;
          const member = MatlabVariableNode._objectMemberOf(n);
          if (!member || !('element' in member)) refused.push(file + ' ' + n.matlabPath + ': ' + JSON.stringify(member));
        }
      }
    }
    expect(refused).toEqual([]);
    // 17 in each enumeration-member fixture, 2 in each edit-bash values.mat.
    expect(enumerations).toBeGreaterThanOrEqual(4 * 17 + 2 * 2);
  });

  it('takes every edit of a plain member beside it, saved, reopened, undone and redone exactly', { timeout: 300_000 }, () => {
    const wrong: string[] = [];
    let taken = 0;
    for (const { file, bytes, root, at } of everyFixtureOpened()) {
      for (const path of plainMembersBeside(root, isObject)) {
        const node = at(path);
        // Not offered: a struct with no fields, or 0x0, whose row is not a value of its own.
        if (node.toRow()._valueEditable !== true) {
          if (node._scalarType !== 'struct') wrong.push(file + ' ' + path + ': not offered');
          continue;
        }
        taken++;
        const why = editedEverywhere(bytes, path, textFor(node));
        if (why) wrong.push(file + ' ' + path + ': ' + why);
      }
    }
    expect(wrong).toEqual([]);
    // At least what was measured when this was written: 104 beside an enumeration value, 182 beside
    // another object.
    expect(taken).toBeGreaterThanOrEqual(286);
  });
});
