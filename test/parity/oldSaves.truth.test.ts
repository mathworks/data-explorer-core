// Copyright 2026 The MathWorks, Inc.
//
// What MATLAB R2027a read back of binary dictionaries core saved before two of its fixes (M4 and
// M7 of the 2026-10-13 save-fidelity plan, the last of its MATLAB read-backs), and of what core
// copies now from a binary dictionary into a text one (D15's binary-to-text reopen); held to what
// core reads and writes now.
//
// The old saves, in test/parity/oldsaves/, are untouched saves of every binary fixture holding a
// dynamic property or a struct entry of no element, and of old_saves_r2027a_binary.sldd
// (make_old_saves_r2027a.m, for the shapes no other fixture holds), made by core built at
// 50549bd^ ('pre93', before #93), at 69664b0^ ('pre69664b0', #93 less the commit that kept a
// dynamic property's Source and PropertyType) and at 90caf06^ ('pre90caf06', before the struct
// of no element was written as MATLAB writes it). Each of those cores wrote every entry of a save
// from its model. matlab/old_saves.mjs made them, and makes the pastes;
// matlab/probe_old_saves_readback.m had MATLAB open each and wrote what it read to
// matlab/old_saves_readback.truth.json.
//
// What MATLAB read:
// - M4: a dynamic property written as an ordinary one (no Source="dynamic", no PropertyType) is
//   read back as the dynamic property it was, with its value. Harmless. A save before #93 is not:
//   that core wrote every element of a mixed-class object array as the first element's class, so
//   a config set's components were all written as a Simulink.SolverCC (the target component as a
//   Simulink.CodeAppCC), and MATLAB reads a config set without the AUTOSAR target's options, and
//   a user's subclass of Simulink.Signal beside a Simulink.Signal as two of the first's class.
// - M7: a struct of no element written around an `<Element>` is read in the shape its Dimension
//   states, with no element and no warning; but that writer wrote none of the fields it declares,
//   so a 1x0 struct with fields a and b reads as a 1x0 struct with none. Lost in the file.
// - Other losses of those cores, fixed since, show in the same saves (the shaped empties and
//   enumeration values of display/dispcat_bin.sldd); they are listed here, not asked about.
// - D15: core's copy into a text dictionary of a mixed Signal array and of a config set's
//   Components (one holding an SSC.SimscapeCC, one the AUTOSAR target's dynamic properties, which
//   the text form holds among the ordinary ones) reads in MATLAB as the binary original does.
//
// The test makes the pastes again from the package's source and asks that each is still the one
// MATLAB was asked about, checks that the old saves and their originals are the files MATLAB
// read, and that core reads each old save as MATLAB does, where MATLAB and the file agree.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession, ingest } from '../../src/index.js';
import { regenerateEntryXml } from '../../src/datamodel/parser/BinarySlddSerializer.js';
import {
  BUILDS,
  EMPTIES_OLD_SAVE,
  OLD_SAVES_DIR,
  TEXT_TWIN,
  linesOf,
  objectsOf,
  pasteSources,
  pastesOf,
  shapesOf,
} from './matlab/old_saves.mjs';
import { strFromU8, unzipSync } from 'fflate';
import '../../src/datamodel/node/data/NodeClassMap.js';

type Dynamic = { entry: string; name: string; original: string; save: string; dynamicInSave: boolean };
type Pasted = { to: string; same: boolean; why: string; shape: string; kids: string; sourceKids: string };
type Matlab = {
  opened: boolean;
  warnings: string[] | string;
  asOriginal: boolean;
  entries: { checked: number; same: number; differ: string[] | string };
  dynamic: Dynamic[] | Dynamic;
  emptyStructs: { entry: string; shape: string }[] | { entry: string; shape: string };
  pasted: Pasted[] | Pasted;
  error: string;
};
type Case = {
  kind: 'old save' | 'paste';
  build?: string;
  fixture?: string;
  file: string;
  original: string;
  source?: string;
  sha: { save: string; original: string } | string;
  pasted?: { section: string; from: string; to: string }[] | { section: string; from: string; to: string };
  dynamic: { entry: string; to: string; name: string; value: string }[] | { entry: string; to: string; name: string; value: string };
  emptyStructs?: { entry: string; dims: number[]; fields: string[] | string }[] | { entry: string; dims: number[]; fields: string[] | string };
  matlab: Matlab;
};
type Original = { file: string; opened: boolean; warnings: string[] | string; entries: number; notSelfEqual: string[] | string; shapes: { key: string; shape: string }[] };

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const TEST_DIR = at('..');
const TRUTH: { version: string; release: string; originals: Original[]; cases: Case[] } = JSON.parse(
  readFileSync(at('./matlab/old_saves_readback.truth.json'), 'utf8'),
);
/** MATLAB writes a one-element array as the element, and an empty one as []: every list as a list. */
const list = <T>(x: T[] | T | undefined): T[] => (x === undefined ? [] : ([] as T[]).concat(x));
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const ab = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const OLD = TRUTH.cases.filter((c) => c.kind === 'old save');
const PASTES = TRUTH.cases.filter((c) => c.kind === 'paste');
const oldSave = (build: string, fixture: string) => OLD.find((c) => c.build === build && c.fixture === fixture)!;
const GENERATED = `${OLD_SAVES_DIR}/old_saves_r2027a_binary.sldd`;
const savedBytes = (file: string) => new Uint8Array(readFileSync(at(`../${OLD_SAVES_DIR}/${file}`)));
const differKeys = (c: Case) => list(c.matlab.entries.differ).map((d) => d.slice(0, d.indexOf(': ')));

/** An old save, opened by core as it is now. */
function openSave(file: string) {
  const session = createSession();
  return ingest(session, ab(savedBytes(file)), { filename: file }) as any;
}
const entryOf = (root: any, section: string, name: string) => root.getSection(section).children.find((e: any) => e.name === name);

/** The value core holds for a named property anywhere in a value, and whether its element names a Source for it. */
function propertyIn(value: unknown, name: string): { value: unknown; source: unknown } | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, any>;
  if (o._properties && typeof o._properties === 'object' && name in o._properties) {
    return { value: o._properties[name], source: o._property_source?.[name] ?? null };
  }
  for (const v of Object.values(o)) {
    const found = propertyIn(v, name);
    if (found) return found;
  }
  return null;
}

describe("MATLAB's read-back of core's older binary saves (M4, M7) and of its binary-to-text copies (D15)", () => {
  it("the truth is MATLAB R2027a's, and every save opened and read with no error or warning", () => {
    expect(TRUTH.release).toBe('2027a');
    expect(OLD.length).toBe(Object.keys(BUILDS).length * 3);
    expect(PASTES.length).toBe(7);
    expect(TRUTH.cases.filter((c) => c.matlab.error !== '' || !c.matlab.opened || list(c.matlab.warnings).length > 0).map((c) => c.file)).toEqual([]);
    expect(list(TRUTH.originals).filter((o) => !o.opened || list(o.warnings).length > 0).map((o) => o.file)).toEqual([]);
  });

  it('the old saves in the tree are the files MATLAB read, of the originals it read them against', () => {
    for (const c of OLD) {
      const s = c.sha as { save: string; original: string };
      expect([c.file, sha(savedBytes(c.file))]).toEqual([c.file, s.save]);
      const original = at(`../${c.fixture}`);
      if (existsSync(original)) {
        expect([c.fixture, sha(new Uint8Array(readFileSync(original)))]).toEqual([c.fixture, s.original]);
      }
    }
  });

  it('core still makes each paste MATLAB was asked about', () => {
    const { cases } = pastesOf({ createSession, ingest }, pasteSources(TEST_DIR), new Uint8Array(readFileSync(at(`../${TEXT_TWIN}`))));
    const asked = (c: Case) => [c.file, c.source, list(c.pasted), list(c.dynamic), c.sha];
    expect(cases.map(asked)).toEqual(PASTES.map(asked));
  });

  describe('M4: a dynamic property a save wrote as an ordinary one', () => {
    const dynamic = shapesOf(new Uint8Array(readFileSync(at(`../${GENERATED}`)))).dynamic;

    it("is how the save before #93's last commit spells the AUTOSAR target's options, where the original and a later save keep Source and PropertyType", () => {
      expect(dynamic.map((d: { name: string }) => d.name)).toEqual([
        'AutosarMatrixIOAsArray',
        'AutosarCompilerAbstraction',
        'AutosarMaxShortNameLength',
        'DisableAUTOSARRoutinesHostLibrary',
        'AutosarSchemaVersion',
      ]);
      for (const build of ['pre93', 'pre69664b0']) {
        for (const line of linesOf(savedBytes(oldSave(build, GENERATED).file), dynamic)) {
          expect(line).toMatch(/^<P Name="\w+" Class="(char|double)">[^<]*<\/P>$/);
        }
      }
      for (const line of linesOf(savedBytes(oldSave('pre90caf06', GENERATED).file), dynamic)) {
        expect(line).toMatch(/^<P Name="\w+" Source="dynamic" PropertyType="[^"]+" Class="(char|double)">[^<]*<\/P>$/);
      }
    });

    it('MATLAB reads as the dynamic property it was, with its value, and the config set as the original', () => {
      for (const build of ['pre69664b0', 'pre90caf06']) {
        const c = oldSave(build, GENERATED);
        expect(list(c.matlab.dynamic).map((d) => [d.name, d.save, d.dynamicInSave])).toEqual(list(c.matlab.dynamic).map((d) => [d.name, d.original, true]));
        expect(differKeys(c).filter((k) => k.startsWith('config|'))).toEqual([]);
      }
    });

    it('core reads each with the value MATLAB reads; as an ordinary property, there being nothing in the file to say it is not', () => {
      const values = new Map(list(oldSave('pre69664b0', GENERATED).matlab.dynamic).map((d) => [d.name, d.save]));
      for (const [build, source] of [
        ['pre69664b0', null],
        ['pre90caf06', 'dynamic'],
      ] as const) {
        const value = entryOf(openSave(oldSave(build, GENERATED).file), 'config', 'csAutosar').serialize().value;
        for (const { name } of dynamic) {
          const read = propertyIn(JSON.parse(JSON.stringify(value)), name)!;
          expect([name, String(read.value), (read.source as { source?: string } | null)?.source ?? null]).toEqual([name, values.get(name), source]);
        }
      }
    });

    it("but a save before #93 wrote a mixed array's elements as the first's class: MATLAB reads the config sets and the Signal arrays otherwise, and no AUTOSAR option", () => {
      const c = oldSave('pre93', GENERATED);
      expect(list(c.matlab.dynamic).map((d) => [d.name, d.save, d.dynamicInSave])).toEqual(dynamic.map((d: { name: string }) => [d.name, '<configset:diagnostics:PropNotExist>', false]));
      expect(differKeys(c).filter((k) => !k.startsWith('design|'))).toEqual(['other|holdsBase', 'other|holdsMixed', 'config|csAutosar', 'config|csSimscape']);
      // What that save wrote: the objects' classes in each entry, in order, the char cells aside.
      const classes = (bytes: Uint8Array, entry: string) =>
        [...new Map(objectsOf(strFromU8(unzipSync(bytes)['data/chunk0.xml']))).get(entry)!.matchAll(/<Element Class="([^"]+)">/g)]
          .map((m) => m[1])
          .filter((k) => k !== 'char' && !/^Simulink(\.LoggingInfo|\.CoderInfo|CSC\.)/.test(k));
      const original = new Uint8Array(readFileSync(at(`../${GENERATED}`)));
      expect(classes(original, 'holdsMixed')).toEqual(['NdHolder', 'dexdata.DerivedSignal', 'Simulink.Signal']);
      expect(classes(savedBytes(c.file), 'holdsMixed')).toEqual(['NdHolder', 'dexdata.DerivedSignal', 'dexdata.DerivedSignal']);
      expect(classes(original, 'csAutosar').slice(9, 11)).toEqual(['Simulink.CodeAppCC', 'Simulink.STFCustomTargetCC']);
      expect(classes(savedBytes(c.file), 'csAutosar').slice(1, 11)).toEqual([...Array(8).fill('Simulink.SolverCC'), 'Simulink.CodeAppCC', 'Simulink.CodeAppCC']);
      expect(classes(savedBytes(oldSave('pre69664b0', GENERATED).file), 'csAutosar')).toEqual(classes(original, 'csAutosar'));
    });
  });

  describe('M7: a struct entry of no element a save wrote around an <Element>, without its fields', () => {
    const BUILT = ['pre93', 'pre69664b0', 'pre90caf06'];
    const FIXTURES = ['fixtures/display/dispcat_bin.sldd', 'parity/artifacts/binary/cases.sldd', GENERATED];

    it('is how each of those saves spells every one of them, where the original states its fields', () => {
      for (const build of BUILT) {
        for (const fixture of FIXTURES) {
          const c = oldSave(build, fixture);
          const original = list(c.emptyStructs);
          const saved = shapesOf(savedBytes(c.file)).emptyStructs;
          expect(saved.map((s: { entry: string; dims: number[]; fields: string[]; aroundElement: boolean }) => [s.entry, s.dims, s.fields, s.aroundElement])).toEqual(
            original.map((s) => [s.entry, s.dims, [], true]),
          );
        }
      }
      const declared = FIXTURES.flatMap((f) => list(oldSave('pre90caf06', f).emptyStructs).filter((s) => list(s.fields).length > 0).map((s) => [s.entry, list(s.fields)]));
      expect(declared).toEqual([
        ['dx_struct_0x0_fields', ['a']],
        ['dx_struct_1x0', ['a']],
        ['sE10ab', ['a', 'b']],
      ]);
    });

    it('MATLAB reads in the shape its Dimension states, with no element; the fields are lost, and nothing else of it', () => {
      for (const build of BUILT) {
        for (const fixture of FIXTURES) {
          const c = oldSave(build, fixture);
          expect(list(c.matlab.emptyStructs).map((s) => [s.entry, s.shape])).toEqual(list(c.emptyStructs).map((s) => [s.entry, `struct[${s.dims.join(' ')}]{}`]));
          const lost = list(c.emptyStructs)
            .filter((s) => list(s.fields).length > 0)
            .map((s) => `design|${s.entry}`);
          const fine = list(c.emptyStructs)
            .filter((s) => list(s.fields).length === 0)
            .map((s) => `design|${s.entry}`);
          expect(differKeys(c).filter((k) => lost.includes(k))).toEqual(lost);
          expect(differKeys(c).filter((k) => fine.includes(k))).toEqual([]);
        }
        // A struct entry's field of no element went out the same way: sHolds.e, a 0x0 struct with field a.
        const holds = list(oldSave(build, GENERATED).matlab.entries.differ).find((d) => d.startsWith('design|sHolds: '));
        expect(holds).toContain('e:struct[0 0]<>{}');
        expect(holds).toContain('wanted struct[1 1]<x,e,none>{x:double[1 1]=1,e:struct[0 0]<a>{}');
      }
    });

    it('core reads each as MATLAB does: in the shape the Dimension states, with no row and no field, and writes it so', () => {
      for (const build of BUILT) {
        for (const fixture of FIXTURES) {
          const c = oldSave(build, fixture);
          const root = openSave(c.file);
          for (const s of list(c.matlab.emptyStructs)) {
            const entry = entryOf(root, 'design', s.entry);
            const value = JSON.parse(JSON.stringify(entry.serialize().value));
            const dims = s.shape.slice('struct['.length, s.shape.indexOf(']')).split(' ').map(Number);
            expect([s.entry, entry.displayValue, entry.children.length, value._dimensions, value._fields]).toEqual([s.entry, `<${dims.join('x')} struct>`, 0, dims, []]);
            expect(regenerateEntryXml(entry)).toContain(`<P Name="Value" Class="struct" Dimension="${dims.join('*')}"/>`);
          }
        }
      }
    });

    it("and core's copy of each into a text dictionary reads in MATLAB as the old save does; a 0x0x2 as 0x0, as a copy of the original and MATLAB's own text save of it read", () => {
      const fromOld = PASTES.find((c) => c.source === EMPTIES_OLD_SAVE)!;
      const fromOriginal = PASTES.find((c) => list(c.pasted)[0]?.from === 'sE00' && c.source !== EMPTIES_OLD_SAVE)!;
      for (const c of [fromOld, fromOriginal]) {
        expect(differKeys(c)).toEqual([]);
        expect(list(c.matlab.pasted).filter((p) => !p.same).map((p) => [p.to, p.shape])).toEqual([['sE002Pasted', 'struct[0 0]{}']]);
      }
      expect(list(fromOld.matlab.pasted).map((p) => [p.to, p.shape])).toEqual([
        ['sE00Pasted', 'struct[0 0]{}'],
        ['sE02Pasted', 'struct[0 2]{}'],
        ['sE20Pasted', 'struct[2 0]{}'],
        ['sE002Pasted', 'struct[0 0]{}'],
        ['sE10abPasted', 'struct[1 0]{}'],
        ['sHoldsPasted', 'struct[1 1]{x,e,none}'],
      ]);
      const twin = list(TRUTH.originals).find((o) => o.file === 'orig_old_saves_r2027a_text.sldd')!;
      expect(list(twin.shapes).find((s) => s.key === 'design|sE002')!.shape).toBe('struct[0 0]{}');
    });
  });

  it("the other losses of those saves, each fixed since, are a shaped empty's shape and an enumeration value", () => {
    // dispcat_bin.sldd holds every shaped empty: a cell, char or string of no element lost its
    // extents (each since kept, in one form at an entry, a property and a cell), and before #93
    // an enumeration value at an entry its enumeral (kept since 146cb64), and a 0x2 char its shape.
    const shaped = ['dx_cell_0x3', 'dx_cell_1x0', 'dx_char_1x0', 'dx_string_0x0', 'dx_string_1x0', 'str_0x3'];
    const enums = ['dx_char_0x2', 'en_i32_high', 'en_i32_vec', 'en_sl_red', 'en_sl_vec', 'p_enum'];
    const m7 = ['dx_struct_0x0_fields', 'dx_struct_1x0'];
    const dispcat = 'fixtures/display/dispcat_bin.sldd';
    for (const [build, keys] of [
      ['pre93', [...shaped, ...enums, ...m7]],
      ['pre69664b0', [...shaped, ...enums, ...m7]],
      ['pre90caf06', [...shaped, ...m7]],
    ] as const) {
      expect([build, [...differKeys(oldSave(build, dispcat))].sort()]).toEqual([build, keys.map((k) => `design|${k}`).sort()]);
      expect([build, differKeys(oldSave(build, 'parity/artifacts/binary/cases.sldd'))]).toEqual([build, []]);
    }
  });

  describe("D15: core's copy of a mixed-class object array from a binary dictionary into a text one", () => {
    const pasted = (to: string) => PASTES.flatMap((c) => list(c.matlab.pasted).filter((p) => p.to === to));

    it('reads in MATLAB as the binary original, every other entry as it was', () => {
      for (const c of PASTES.filter((c) => c.source !== EMPTIES_OLD_SAVE && list(c.pasted)[0]?.from !== 'sE00')) {
        expect([c.file, c.matlab.asOriginal, differKeys(c)]).toEqual([c.file, true, []]);
      }
    });

    it("a user's subclass of Simulink.Signal beside a Simulink.Signal, either first, as a Simulink.Signal array of each element's own class", () => {
      expect(pasted('holdsMixedPasted').map((p) => [p.same, p.kids, p.sourceKids])).toEqual(
        Array(2).fill([true, 'Simulink.Signal[1 2]{dexdata.DerivedSignal,Simulink.Signal}', 'Simulink.Signal[1 2]{dexdata.DerivedSignal,Simulink.Signal}']),
      );
      expect(pasted('holdsBasePasted').map((p) => [p.same, p.kids, p.sourceKids])).toEqual(
        Array(2).fill([true, 'Simulink.Signal[1 2]{Simulink.Signal,dexdata.DerivedSignal}', 'Simulink.Signal[1 2]{Simulink.Signal,dexdata.DerivedSignal}']),
      );
    });

    it("a config set's Components, as a Simulink.ConfigComponent array, an SSC.SimscapeCC among them", () => {
      for (const p of pasted('csSimscapePasted')) {
        expect([p.same, p.kids === p.sourceKids, p.kids]).toEqual([true, true, expect.stringMatching(/^Simulink\.ConfigComponent\[10 1\]\{Simulink\.SolverCC,.*,SSC\.SimscapeCC\}$/)]);
      }
    });

    it("the AUTOSAR target's dynamic properties, which the text form holds among the ordinary ones, as the dynamic properties they were", () => {
      for (const c of PASTES.filter((c) => list(c.dynamic).length > 0)) {
        expect(list(c.matlab.dynamic).map((d) => [d.name, d.save === d.original, d.dynamicInSave])).toEqual(list(c.dynamic).map((d) => [d.name, true, true]));
      }
      expect(PASTES.filter((c) => list(c.dynamic).length > 0).length).toBe(2);
    });
  });
});
