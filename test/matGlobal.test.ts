// Copyright 2026 The MathWorks, Inc.
//
// A variable saved as global stays global when a save writes it again.
//
// `save` marks a variable declared global by bit 0x04 of its array flags' flags byte (the flags
// word 0x0406 for a global double), on its top-level element and on no element nested in it, and
// `load(f)` declares it global again: measured against MATLAB R2027a by
// fixtures/global/make_global_fixtures.m, which wrote global_v7.mat and global_v6.mat (gD, gS,
// gC, gI global; plain not) and read each back by `whos -file` and by a `load` inside a function.
// The flag is the workspace variable's, not its value's. No reader layer held it, so a value edit,
// which writes the variable fresh, wrote it as not global, and `load(f)` no longer declared it
// (MATLAB's verdict on the save, the MAT-file gate's global_* cases); a rename, which writes the
// element it was read as, kept it. The reader now holds it (MatVariable.isGlobal), and the save
// sets it on the element it writes for a variable that had it (MatFileWriter.globalAsRead).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzlibSync } from 'fflate';
import { parseMat, type MatRecord, type MatVariable } from '../src/datamodel/parser/MatParser.js';
import { createSession } from '../src/index.js';
import { elementValue } from './tools/matElements.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const arrayBufferOf = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const fixture = (name: string) => arrayBufferOf(new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/global/' + name, import.meta.url)))));
const GLOBALS = ['gC', 'gD', 'gI', 'gS'];

function elementOf(record: MatRecord): Uint8Array {
  const view = new DataView(record.bytes.buffer, record.bytes.byteOffset, record.bytes.byteLength);
  return view.getUint32(0, true) === 15 ? unzlibSync(record.bytes.subarray(8, 8 + view.getUint32(4, true))) : record.bytes;
}

/** Each record's name and whether its element is global, by the bytes and by the reader. */
const globalsOf = (bytes: ArrayBuffer | Uint8Array) => {
  const parsed = parseMat(bytes instanceof Uint8Array ? arrayBufferOf(bytes) : bytes);
  return parsed.records.map((r) => [r.name, elementValue(elementOf(r)).global, !!r.variable?.isGlobal]);
};

/** Every variable nested in `v`, at any depth. */
function nested(v: MatVariable): MatVariable[] {
  const out: MatVariable[] = [];
  const walk = (x: MatVariable) => {
    for (const held of Object.values(x.fields ?? {})) {
      for (const one of Array.isArray(held) ? held : [held]) {
        out.push(one);
        walk(one);
      }
    }
    if (x.className === 'cell' && Array.isArray(x.value)) {
      for (const one of x.value as MatVariable[]) {
        out.push(one);
        walk(one);
      }
    }
  };
  walk(v);
  return out;
}

function opened(name: string) {
  const session = createSession();
  const root: any = session.addMatSource(name, fixture(name));
  const at = (...labels: string[]) => {
    let node = root.children.find((c: any) => c.name === labels[0]);
    for (const label of labels.slice(1)) node = node.children.find((c: any) => c.displayName === label);
    return node;
  };
  const edit = (node: any, prop: string, value: string) => {
    session.setActive(root, node);
    expect(session.editProperty(node.id, prop, value), prop + ' ' + value).toBe(true);
  };
  const save = () => (session.serializeSource(name) as { bytes: Uint8Array }).bytes;
  return { session, root, at, edit, save };
}

describe.each(['global_v7.mat', 'global_v6.mat'])('%s, as MATLAB saved it', (file) => {
  it('the reader holds the global flag of each variable that has it, and of nothing nested in one', () => {
    expect(globalsOf(fixture(file))).toEqual([
      ['gD', true, true],
      ['gS', true, true],
      ['gC', true, true],
      ['gI', true, true],
      ['plain', false, false],
    ]);
    for (const v of parseMat(fixture(file)).variables) {
      expect(nested(v).filter((x) => x.isGlobal).map((x) => v.name), v.name).toEqual([]);
    }
  });

  it('each global edited is written fresh, global, and the rest as it was', () => {
    const { at, edit, save } = opened(file);
    edit(at('gD', 'gD(2)'), 'Value', '20');
    edit(at('gS', 'a'), 'Value', '5');
    edit(at('gC', 'gC{1}'), 'Value', '40');
    edit(at('gI'), 'Value', '-8');
    edit(at('plain'), 'Value', '10');
    const saved = save();
    expect(globalsOf(saved)).toEqual(globalsOf(fixture(file)));
    const parsed = parseMat(arrayBufferOf(saved));
    const v = (n: string) => parsed.variables.find((x) => x.name === n)!;
    expect([v('gD').value, (v('gS').fields!.a as MatVariable).value, (v('gC').value as MatVariable[])[0].value, v('gI').className, v('gI').value, v('plain').value]).toEqual([
      [1, 20, 3],
      5,
      40,
      'int16',
      -8,
      10,
    ]);
    // Nothing nested in a global written fresh is global, as in MATLAB's own element.
    for (const name of GLOBALS) {
      expect(nested(v(name)).filter((x) => x.isGlobal), name).toEqual([]);
    }
    // A -v6 file stays one: no record compressed.
    expect(parsed.records.some((r) => r.compressed)).toBe(file === 'global_v7.mat');
  });

  it('a global renamed stays global, one deleted is gone, and one added is not global', () => {
    const { root, at, edit, save, session } = opened(file);
    edit(at('gD'), 'Name', 'gD2');
    session.setActive(root, at('gI'));
    expect(session.deleteNodeById(at('gI').id)).toBe(true);
    root.execAddEntry(undefined, 'added');
    expect(globalsOf(save())).toEqual([
      ['gD2', true, true],
      ['gS', true, true],
      ['gC', true, true],
      ['plain', false, false],
      ['added', false, false],
    ]);
  });
});
