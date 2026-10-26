// Copyright 2026 The MathWorks, Inc.
//
// Why an Add, a delete or a rename is refused, in words, from the session: addChildRefusal,
// deleteRefusal and renameRefusal. addChildTo, deleteNodeById and deleteNodesById answer a refusal
// with null or false and nothing more, so a host showed its own words, one per editor ("This item
// takes no children.", "Failed to apply edit: This item cannot have children added."). Each call
// says why, naming the row, in every format, and agrees with the operation both ways.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p));
    else if (/\.(mat|sldd)$/.test(e.name)) out.push(p);
  }
  return out.sort();
}

function opened(file: string, session = createSession()) {
  const bytes = new Uint8Array(readFileSync(file.startsWith('/') ? file : join(TEST_ROOT, '..', file)));
  const root: any = ingest(session, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { filename: file.split('/').pop()! });
  const at = (path: string) => root.flatten().find((n: any) => n.matlabPath === path && !n.isContainer);
  return { session, root, at };
}

// A refusal of each kind, as each call words it: the row it names, and why.
const SAID = {
  add: /^Cannot add to "([^"]*)": (.+)\. Nothing was added\.$/s,
  delete: /^Cannot delete "([^"]*)": (.+)\. Nothing was deleted\.$/s,
  rename: /^Cannot rename "([^"]*)": (.+)\.$/s,
};

function heldTo(kind: keyof typeof SAID, text: string, row: string): string | null {
  const m = SAID[kind].exec(text);
  if (!m) return 'not said as ' + kind + ' refusals are';
  if (m[1] !== row) return 'names "' + m[1] + '", not the row "' + row + '"';
  // Neither an unworded gate's answer nor a sentence of its own inside the clause.
  if (/^refused$|\bundefined\b|\bnull\b|Cannot \w+ "|\.\s+Nothing/.test(m[2])) return 'says "' + m[2] + '"';
  return null;
}

describe('every row of every fixture: the refusals agree with the operations', () => {
  it('an Add, a delete and a rename are refused exactly where the call says why, in its words', () => {
    let rows = 0;
    let added = 0;
    let deleted = 0;
    let refusedAdd = 0;
    let refusedDelete = 0;
    let refusedRename = 0;
    const wrong: string[] = [];
    for (const file of filesUnder(TEST_ROOT)) {
      let o: ReturnType<typeof opened>;
      try {
        o = opened(file);
      } catch {
        continue;
      }
      const { session, root } = o;
      const short = file.slice(TEST_ROOT.length);
      for (const id of root.flatten().slice(0, 400).map((n: any) => n.id)) {
        // The node the id names now: an undone delete may rebuild the rows of what it collapsed.
        const node: any = session.findNodeById(id);
        if (!node) continue;
        rows++;
        const row = node.matlabPath || node.name;
        const named = (kind: string, why: string) => wrong.push(short + ' ' + kind + ' ' + row + ': ' + why);
        const add = session.addChildRefusal(id);
        if (add) {
          refusedAdd++;
          const bad = heldTo('add', add, row);
          if (bad) named('add', bad);
        }
        const child = session.addChildTo(id);
        if (!!child === !!add) named('add', 'the call says ' + JSON.stringify(add) + ' and addChildTo ' + (child ? 'added' : 'refused'));
        if (child) {
          added++;
          session.setActive(root, null);
          session.undo();
        }
        const del = session.deleteRefusal(id);
        if (del) {
          refusedDelete++;
          const bad = heldTo('delete', del, row);
          if (bad) named('delete', bad);
        }
        const gone = session.deleteNodeById(id);
        if (gone === !!del) named('delete', 'the call says ' + JSON.stringify(del) + ' and deleteNodeById ' + (gone ? 'deleted' : 'refused'));
        if (gone) {
          deleted++;
          session.setActive(root, null);
          session.undo();
        }
        const ren = session.renameRefusal(id);
        if (ren) {
          refusedRename++;
          const bad = heldTo('rename', ren, row);
          if (bad) named('rename', bad);
        }
        const live: any = session.findNodeById(id) ?? node;
        if (!ren !== live.nameEditable && !live.isContainer) named('rename', 'the call says ' + JSON.stringify(ren) + ' and nameEditable is ' + live.nameEditable);
      }
    }
    expect(wrong).toEqual([]);
    // At least what was measured when this was written.
    expect(rows).toBeGreaterThanOrEqual(15500);
    expect(added).toBeGreaterThanOrEqual(1700);
    expect(deleted).toBeGreaterThanOrEqual(7900);
    expect(refusedAdd).toBeGreaterThanOrEqual(13000);
    expect(refusedDelete).toBeGreaterThanOrEqual(7000);
    expect(refusedRename).toBeGreaterThanOrEqual(10000);
  }, 240_000);
});

describe('the same value in a MAT-file, a text and a binary dictionary', () => {
  // The parity cases, written by MATLAB with the same variables in each format.
  const A = 'test/parity/artifacts/';
  const formats = { mat: opened(A + 'mat/cases.mat'), json: opened(A + 'text/cases.sldd'), bin: opened(A + 'binary/cases.sldd') };
  // Where the formats differ, and why: a text dictionary holds an N-D cell or struct as a MAT
  // stream it shows and does not edit.
  const KNOWN = /^(cellNd|structNd)\b/;

  it('is refused in the same words wherever the formats agree', () => {
    const said: Record<string, Record<string, string>> = {};
    for (const [format, { session, root }] of Object.entries(formats)) {
      for (const n of root.flatten()) {
        if (n.isContainer) continue;
        const r = (said[n.matlabPath] ??= {});
        r[format] = [session.addChildRefusal(n.id), session.deleteRefusal(n.id), session.renameRefusal(n.id)].join(' | ');
      }
    }
    const differ = Object.entries(said)
      .filter(([, r]) => r.mat !== undefined && r.json !== undefined && r.bin !== undefined && !(r.mat === r.json && r.json === r.bin))
      .map(([path]) => path);
    expect(differ.filter((p) => !KNOWN.test(p))).toEqual([]);
    expect(Object.keys(said).length).toBeGreaterThan(200);
  });

  it('names the row and says why, and what to do where the value takes its text typed over', () => {
    for (const { session, at } of Object.values(formats)) {
      expect(session.addChildRefusal(at('scalarD').id)).toBe(
        'Cannot add to "scalarD": it is shown whole (1x1 double), with no rows of its own: type the whole value over it instead. Nothing was added.',
      );
      expect(session.addChildRefusal(at('charStr').id)).toBe(
        'Cannot add to "charStr": it is shown whole (1x4 char), with no rows of its own: type the whole value over it instead. Nothing was added.',
      );
      expect(session.deleteRefusal(at('mat2x3(1,1)').id)).toBe(
        'Cannot delete "mat2x3(1,1)": "mat2x3" is a 2x3 double array, which an element deleted would make a 1x5 row, as MATLAB\'s x(k) = [] does: type the whole value of "mat2x3" instead. Nothing was deleted.',
      );
      expect(session.renameRefusal(at('mat2x3(1,1)').id)).toBe('Cannot rename "mat2x3(1,1)": it is an element of "mat2x3", named by where it stands there.');
      expect(session.addChildRefusal(at('rowVec').id)).toBeNull();
      expect(session.deleteRefusal(at('rowVec(2)').id)).toBeNull();
    }
  });
});

describe('refusals of rows the session cannot find', () => {
  it('says no row of the id is open', () => {
    const { session } = opened('test/parity/artifacts/mat/cases.mat');
    expect(session.addChildRefusal('nowhere/x')).toBe('Cannot add to "nowhere/x": no row of that id is open. Nothing was added.');
    expect(session.deleteRefusal('nowhere/x')).toBe('Cannot delete "nowhere/x": no row of that id is open. Nothing was deleted.');
    expect(session.renameRefusal('nowhere/x')).toBe('Cannot rename "nowhere/x": no row of that id is open.');
    expect(session.deleteRefusal(['nowhere/x', 'nowhere/y'])).toBe('Cannot delete: no row of those ids is open. Nothing was deleted.');
  });

  it('says why a variable two of which have one name is not told apart', () => {
    const { session, root } = opened('test/fixtures/mat-check/duplicate-name-earlier-copy.mat');
    const twin = root.children.find((n: any) => root.children.filter((m: any) => m.name === n.name).length > 1);
    const why = 'another row of the file has the same name, and nothing tells which one is meant';
    expect(session.deleteRefusal(twin.id)).toBe('Cannot delete "' + twin.name + '": ' + why + '. Nothing was deleted.');
    expect(session.deleteNodeById(twin.id)).toBe(false);
    expect(session.deleteRefusal([twin.id])).toBe('Cannot delete "' + twin.name + '": ' + why + '. Nothing was deleted.');
  });
});

describe('a delete of many rows at once', () => {
  it('is refused only where it deletes none of them, as deleteNodesById', () => {
    const { session, root, at } = opened('test/parity/artifacts/text/cases.sldd');
    const members = [at('mat2x3(1,1)').id, at('rowVec(2)').id];
    // Members only: a batch deletes entries, and passes over the rest.
    expect(session.deleteRefusal(members)).toBe(
      'Cannot delete "mat2x3(1,1)": only entries are deleted together, and it is part of one. Nothing was deleted.',
    );
    expect(session.deleteNodesById(members)).toBe(false);
    const entries = [at('scalarD').id, at('rowVec').id];
    expect(session.deleteRefusal([...members, ...entries])).toBeNull();
    expect(session.deleteNodesById([...members, ...entries])).toBe(true);
    expect(root.flatten().some((n: any) => n.matlabPath === 'scalarD')).toBe(false);
  });

  it('of two files is refused, each file being undone on its own', () => {
    const session = createSession();
    const mat = opened('test/parity/artifacts/mat/cases.mat', session);
    const json = opened('test/parity/artifacts/text/cases.sldd', session);
    const ids = [mat.at('scalarD').id, json.at('scalarD').id];
    expect(session.deleteRefusal(ids)).toBe('Cannot delete rows of two files at once: each file is deleted from, and undone, on its own. Nothing was deleted.');
    expect(session.deleteNodesById(ids)).toBe(false);
  });
});

describe('a rename of a name that takes none', () => {
  it('is refused by editProperty in the words renameRefusal says', () => {
    for (const file of ['test/parity/artifacts/text/cases.sldd', 'test/parity/artifacts/binary/cases.sldd']) {
      const { session, root, at } = opened(file);
      const element = at('cellFlat{2}');
      session.setActive(root, element);
      const refused: any = session.editProperty(element.id, 'Name', 'renamed');
      expect(refused.reason).toBe(session.renameRefusal(element.id));
      expect(refused.reason).toBe('Cannot rename "cellFlat{2}": it is an element of "cellFlat", named by where it stands there.');
    }
  });
});

describe('the same values written by MATLAB as MAT-files and dictionaries (the edit-bash fixtures)', () => {
  const E = 'test/fixtures/edit-bash/';
  // Where the formats differ, and why: a sparse array is a text dictionary's MAT stream and a binary
  // dictionary's encoded value; an enumeration in a container a binary dictionary's encoded value.
  const KNOWN = /^(spMatrix|enumOn)/;
  for (const [release, files] of [['r2027a', ['values.mat', 'values_text.sldd', 'values_binary.sldd']], ['r2023b', ['values.mat', 'values_binary.sldd']]] as const) {
    it(`${release}: are refused an Add, a delete and a rename in the same words wherever the formats agree`, () => {
      const said: Record<string, Record<string, string>> = {};
      for (const file of files) {
        const { session, root } = opened(E + release + '/' + file);
        for (const n of root.flatten()) {
          if (n.isContainer) continue;
          (said[n.matlabPath] ??= {})[file] = [session.addChildRefusal(n.id), session.deleteRefusal(n.id), session.renameRefusal(n.id)].join(' | ');
        }
      }
      const held = Object.entries(said).filter(([, r]) => files.every((f) => r[f] !== undefined));
      const differ = held.filter(([, r]) => files.some((f) => r[f] !== r[files[0]])).map(([path]) => path);
      expect(differ.filter((p) => !KNOWN.test(p))).toEqual([]);
      expect(held.length).toBeGreaterThan(250);
    });
  }

  it('say a 0x0 struct takes no field, as MATLAB refuses one (emptyDotAssignment)', () => {
    for (const file of ['mat/cases.mat', 'text/cases.sldd', 'binary/cases.sldd']) {
      const { session, at } = opened('test/parity/artifacts/' + file);
      expect(session.addChildRefusal(at('structEmpty').id)).toBe(
        'Cannot add to "structEmpty": it is a 0x0 struct, which has no element to hold a field\'s value. Nothing was added.',
      );
    }
  });
});

describe('an Add of an entry, into a section of a dictionary or a MAT-file', () => {
  it('is refused exactly where addEntryRefusal(section) says why, for every class a section takes and others', () => {
    let added = 0;
    let refused = 0;
    const wrong: string[] = [];
    const files = filesUnder(TEST_ROOT).filter((f) => !/[\\/](mcos|mat-check)[\\/]/.test(f)).slice(0, 400);
    for (const file of files) {
      let o: ReturnType<typeof opened>;
      try {
        o = opened(file);
      } catch {
        continue;
      }
      const { session, root } = o;
      const containers: any[] = root.constructor.name === 'MatNode' ? [root] : root.children.filter((c: any) => c.isContainer);
      for (const container of containers) {
        const id = container === root ? root.name : container.id;
        const classes = container === root ? [undefined, 'MatlabStruct', 'Simulink.Parameter', 'string', 'NoSuchClass'] : [...container.getAllowedTypes().slice(0, 3), 'Simulink.ServiceBus', 'NoSuchClass'];
        for (const cls of classes) {
          for (const name of [undefined, '1bad']) {
            const why = session.addEntryRefusal(id, cls, name);
            session.setActive(root, null);
            const node = session.addEntry(container.name, cls as string, name);
            const short = file.slice(TEST_ROOT.length) + ' ' + id + ' ' + cls + ' ' + name;
            if (!!node === !!why) wrong.push(short + ': the call says ' + JSON.stringify(why) + ' and addEntry ' + (node ? 'added' : 'refused'));
            if (why && !/^Cannot add (a|an) .+ to "[^"]+": .+\.$/s.test(why)) wrong.push(short + ': says ' + why);
            if (node) {
              added++;
              session.setActive(root, null);
              session.undo();
            } else {
              refused++;
            }
          }
        }
      }
    }
    expect(wrong).toEqual([]);
    // At least what was measured when this was written: 1888 added and undone, 3120 refused.
    expect(added).toBeGreaterThanOrEqual(1800);
    expect(refused).toBeGreaterThanOrEqual(3000);
  }, 240_000);

  it('names the section a class belongs in, and a name MATLAB cannot load', () => {
    const { session, root } = opened('test/parity/artifacts/text/cases.sldd');
    const design = root.children.find((c: any) => c.name === 'design');
    expect(session.addEntryRefusal(design.id, 'Simulink.ServiceBus')).toBe(
      'Cannot add a Simulink.ServiceBus to "Design Data": the section holds no entry of that class, which "Architectural Data" does.',
    );
    expect(session.addEntryRefusal(design.id, 'Simulink.Parameter', '1bad')).toMatch(/^Cannot add a Simulink.Parameter to "Design Data": '1bad' is not a name MATLAB can load \(.+\)\.$/);
    expect(session.addEntryRefusal(design.id, 'Simulink.Parameter')).toBeNull();
    expect(session.addEntryRefusal('nowhere/design', 'Simulink.Parameter')).toBe('Cannot add a Simulink.Parameter to "nowhere/design": no section or file of that id is open.');
    const mat = opened('test/parity/artifacts/mat/cases.mat');
    expect(mat.session.addEntryRefusal(mat.root.name, 'NoSuchClass')).toMatch(/^Cannot add a NoSuchClass to "cases.mat": /);
    expect(mat.session.addEntryRefusal(mat.root.name)).toBeNull();
  });
});
