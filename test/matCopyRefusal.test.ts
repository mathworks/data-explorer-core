// Copyright 2026 The MathWorks, Inc.
//
// Whether an entry can be copied, for the kind of dictionary it is to land in (session.copyRefusal),
// held to what then happens to the copy: over every variable of every MAT-file fixture, a copy not
// refused serializes, and pasted into a text and into a binary dictionary as a host pastes one
// (SectionNode.parseEntry), the dictionary saves (serializeSource); a copy refused says so naming
// the variable. And the refusals themselves: what serialize() refuses (a value not decoded), what a
// binary dictionary's writer refuses (a function handle), and a MAT-file's empty that a copy does not
// spell. A copy is carried as the value it is (structuredClone, as a host carries one), so a bare Inf
// or a -0 in it is no refusal.
import { describe, it, expect, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { BINARY, TEXT, sparseFixture } from './tools/pasteVenues.js';
import { BINARY_CASES, MIXED, TEXT_CASES, bufferOf, fixture, reopened, target } from './tools/matPaste.js';

type Any = any;

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MAT_DIRS = ['test/fixtures', 'test/fixtures/mcos', 'test/fixtures/display', 'test/fixtures/sparse', 'test/fixtures/complex_inf', 'test/fixtures/global', 'test/fixtures/mcos-templates/targets/r2023b', 'test/fixtures/mcos-templates/targets/r2027a', 'test/parity/artifacts/mat'];
const MAT_FILES = MAT_DIRS.flatMap((d) => readdirSync(ROOT + d).filter((f) => f.endsWith('.mat') && !/v73/.test(f)).map((f) => d + '/' + f));

let seq = 0;
/** `payload` pasted into a fresh `file` (a text or a binary dictionary) as a host pastes one, the dictionary saved, and the entry as it reopens. */
function pasteIntoDictionary(file: string, payload: Any): Any {
  const session = createSession();
  const root: Any = ingest(session, sparseFixture(file), { filename: file });
  const metadata = payload.metadata ?? { uuid: `00000000-0000-4000-c0de-${String(++seq).padStart(12, '0')}` };
  const name = 'pasted_' + seq;
  root.getSection('design').parseEntry({ name, metadata, value: structuredClone(payload.value) });
  const saved: Any = session.serializeSource(root.name);
  return ingest(createSession(), saved.kind === 'text' ? saved.text : saved.bytes, { filename: file }).getSection('design').children.find((e: Any) => e.name === name);
}

const open = (path: string) => {
  const session = createSession();
  const root: Any = ingest(session, fixture(path), { filename: path.split('/').pop()! });
  const entries: Any[] = root.constructor.name === 'MatNode' ? root.children : root.children.flatMap((s: Any) => s.children);
  return { session, root, by: (name: string) => entries.find((e) => e.name === name) };
};

describe('every variable of every MAT-file: a copy not refused lands where it is meant for', () => {
  it('reads the MAT-files', () => {
    expect(MAT_FILES.length).toBeGreaterThan(30);
  });

  for (const path of MAT_FILES) {
    it(path, () => {
      const session = createSession();
      let root: Any;
      try {
        root = session.addMatSource('m.mat', bufferOf(fixture(path)));
      } catch {
        return;
      }
      for (const v of root.children) {
        const refused = session.copyRefusal(v.id);
        if (refused !== null) {
          expect(refused, v.name).toMatch(new RegExp(`^Cannot copy "${v.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
          expect(refused, v.name).toMatch(/\. Nothing was copied\.$/);
          continue;
        }
        const payload = structuredClone(v.serialize());
        for (const [target, file] of [['json', TEXT], ['xml', BINARY]] as const) {
          const into = session.copyRefusal(v.id, target);
          if (into === null) {
            expect(() => pasteIntoDictionary(file, payload), `${v.name} into ${target}`).not.toThrow();
          } else {
            expect(into, v.name).toMatch(new RegExp(`^Cannot copy "${v.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" into a (text|binary) dictionary: `));
          }
        }
      }
    });
  }
});

describe('what a copy is refused for', () => {
  it('a function handle copies, and pastes into a text dictionary, but into no binary one', () => {
    const m = open('test/fixtures/display/dispcat_opaque.mat');
    const fh = m.by('fh_sin');
    expect([m.session.copyRefusal(fh.id), m.session.copyRefusal(fh.id, 'json')]).toEqual([null, null]);
    expect(m.session.copyRefusal(fh.id, 'xml')).toBe(
      'Cannot copy "fh_sin" into a binary dictionary: fh_sin is a function handle (@sin), which a binary dictionary holds only in '
        + "MATLAB's MAT encoding, and this package cannot write that. Nothing was copied.",
    );
    expect(() => pasteIntoDictionary(TEXT, structuredClone(fh.serialize()))).not.toThrow();
  });

  it("an empty of a class or a size a MAT-file's copy does not spell, which would paste as a double 0x0", () => {
    const m = open('test/fixtures/display/dispcat.mat');
    for (const [name, what] of [
      ['dx_int8_0x3', 'its class reads back as double where int8 was written'],
      ['dx_logical_1x0', 'its class reads back as double where logical was written'],
      ['dx_double_1x0', 'its size reads back as 0x0 where 1x0 was written'],
      ['dx_char_0x2', 'its size reads back as 0x0 where 0x2 was written'],
    ]) {
      expect(m.session.copyRefusal(m.by(name).id), name).toBe(`Cannot copy "${name}": what a copy carries of it reads back as another value (${name}: ${what}). Nothing was copied.`);
    }
    // An empty a copy spells as it is copies.
    const t = createSession();
    const root: Any = t.addMatSource('m.mat', bufferOf(fixture('test/parity/artifacts/mat/cases.mat')));
    expect(t.copyRefusal(root.children.find((c: Any) => c.name === 'emptyD').id)).toBeNull();
  });

  it("a binary dictionary's Inf and NaN, held as bare numbers, copy, and land as what they are", () => {
    const b = open(BINARY_CASES);
    for (const [name, value] of [['infP', Infinity], ['infN', -Infinity], ['nanV', NaN]] as const) {
      const entry = b.by(name);
      expect([b.session.copyRefusal(entry.id), b.session.copyRefusal(entry.id, 'xml')], name).toEqual([null, null]);
      const back = pasteIntoDictionary(BINARY, structuredClone(entry.serialize()));
      expect(Object.is(back.serialize().value, value), name).toBe(true);
      // Into a text dictionary, which spells it as MATLAB does, and reads it back as it.
      expect(pasteIntoDictionary(TEXT, structuredClone(entry.serialize())).displayValue, name).toBe(name === 'nanV' ? 'NaN' : value > 0 ? 'Inf' : '-Inf');
      // And into a MAT-file.
      const t = target(fixture(MIXED));
      const res: Any = t.session.pasteEntries('t.mat', [structuredClone(entry.serialize())]);
      const again = reopened(t.save()).children.find((c: Any) => c.name === name);
      expect([res.nodes?.[0]?.name, again?.displayValue], name).toEqual([name, name === 'nanV' ? 'NaN' : value > 0 ? 'Inf' : '-Inf']);
    }
    const t = open(TEXT_CASES);
    for (const name of ['infP', 'infN', 'nanV']) expect(t.session.copyRefusal(t.by(name).id), name).toBeNull();
  });

  it('a -0 copies: the copy holds it as the value it is', () => {
    const m = open('test/parity/artifacts/mat/cases.mat');
    const v = m.by('rowVec');
    m.session.setActive(m.root, v);
    expect(m.session.editProperty(v.id, 'Value', '[-0 1 -0]')).toBe(true);
    expect(Object.is(v.serialize().value[0], -0)).toBe(true);
    expect([m.session.copyRefusal(v.id), m.session.copyRefusal(v.id, 'xml')]).toEqual([null, null]);
  });

  it("a binary dictionary's char 1x0, read as the 1x0 it is, copied as one, and landing as one in every venue", () => {
    const b = open('test/fixtures/display/dispcat_bin.sldd');
    const e = b.by('dx_char_1x0');
    expect([e.className, e._dims]).toEqual(['char', [1, 0]]);
    // A binary dictionary writes it with its Dimension="1*0", as MATLAB does (binaryEmptyChar.test.ts).
    expect([b.session.copyRefusal(e.id), b.session.copyRefusal(e.id, 'json'), b.session.copyRefusal(e.id, 'xml')]).toEqual([null, null, null]);
    // Into a text dictionary, a binary one and a MAT-file, the 1x0 it is.
    expect(pasteIntoDictionary(TEXT, structuredClone(e.serialize()))._dims).toEqual([1, 0]);
    expect(pasteIntoDictionary(BINARY, structuredClone(e.serialize()))._dims).toEqual([1, 0]);
    const t = target(fixture(MIXED));
    t.session.pasteEntries('t.mat', [structuredClone(e.serialize())]);
    expect(reopened(t.save()).children.find((c: Any) => c.name === 'dx_char_1x0')._var.dimensions).toEqual([1, 0]);
    // A 0x0 and a 0x2 are what they were.
    expect([b.by('dx_char_0x0')._dims, b.by('dx_char_0x2')._dims]).toEqual([[1, 1], [0, 2]]);
  });

  it("a dictionary entry whose copy would read back as another value is refused, as a MAT-file variable's is", () => {
    const b = open(BINARY_CASES);
    const e = b.by('mat2x3');
    const spy = vi.spyOn(e, 'serialize').mockImplementation(() => ({ name: 'mat2x3', metadata: e.metadata, value: [1, 2, 3] }));
    try {
      expect(b.session.copyRefusal(e.id)).toBe('Cannot copy "mat2x3": what a copy carries of it reads back as another value (mat2x3: its size reads back as 1x3 where 2x3 was written). Nothing was copied.');
    } finally {
      spy.mockRestore();
    }
    expect(b.session.copyRefusal(e.id)).toBeNull();
  });

  it('what serialize() refuses: a value not decoded', () => {
    const m = open('test/fixtures/mcos/complex_objects.mat');
    const refusals = m.root.children.map((v: Any) => m.session.copyRefusal(v.id)).filter(Boolean);
    for (const r of refusals) expect(r).toMatch(/^Cannot copy "[^"]+": .+\. Nothing was copied\.$/);
    // A MAT-file's undecoded variable, made as the reader makes one.
    const u = open('test/parity/artifacts/mat/cases.mat');
    const node = u.root.children[0];
    node._undecoded = true;
    node._matVar = { ...node._matVar, undecoded: 'its data was cut short' };
    expect(u.session.copyRefusal(node.id)).toMatch(/^Cannot copy "kp": .*not decoded.*\. Nothing was copied\.$/);
  });

  it('an id that names no entry', () => {
    const m = open('test/fixtures/mcos-templates/targets/r2027a/mixed.mat');
    expect(m.session.copyRefusal('nope')).toBe('Cannot copy "nope": no entry of that id is open. Nothing was copied.');
    const element = m.by('b0').children[0];
    expect(m.session.copyRefusal(element.id)).toBe(`Cannot copy "${element.name}": only an entry or a variable is copied, whole. Nothing was copied.`);
  });

  it("a dictionary's entries: every one of the text and the binary cases, held to the same", () => {
    for (const path of [TEXT_CASES, BINARY_CASES]) {
      const d = open(path);
      for (const e of d.root.children.flatMap((s: Any) => s.children)) {
        const refused = d.session.copyRefusal(e.id);
        if (refused !== null) {
          expect(refused, e.name).toMatch(new RegExp(`^Cannot copy "${e.name}": `));
          continue;
        }
        for (const [target, file] of [['json', TEXT], ['xml', BINARY]] as const) {
          if (d.session.copyRefusal(e.id, target) === null) {
            expect(() => pasteIntoDictionary(file, structuredClone(e.serialize())), `${path} ${e.name} into ${target}`).not.toThrow();
          }
        }
      }
    }
  });
});
