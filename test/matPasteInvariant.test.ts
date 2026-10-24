// Copyright 2026 The MathWorks, Inc.
//
// The rules a paste into a MAT-file is judged by, held to one another over every entry of every
// source fixture this repo has, pasted into a MAT-file with objects and into one with none:
//
//   - the deep pasteRefusal is null exactly where pasteEntries makes the paste, and where it is not,
//     it is the refusal the paste answers, word for word (both are one making: matPaste.pasteInto);
//   - the cheap one, where it answers at all, answers the same (the making asks it first);
//   - getAdmittedTypes, the tokens a host predicts a paste or a drop by (a copy's `_array_class`, or
//     'MatlabVariable' where it has none), lists the token of every entry a paste makes, and every
//     token it lists is one of an entry some paste makes.
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zlibSync } from 'fflate';
import { cloneSubsystem, writeSubsystem } from '../src/datamodel/parser/McosSubsystemCodec.js';
import { freshWriteRefusal, serializeMatFile } from '../src/datamodel/parser/MatFileWriter.js';
import { MIXED, NONE, bufferOf, copiesOf, fixture, target } from './tools/matPaste.js';
import { createSession } from '../src/index.js';

type Any = any;

const ROOT = fileURLToPath(new URL('../', import.meta.url));
// Every dictionary and MAT-file among the fixtures a reader opens whole: the folders that hold one
// value's case each (the checker's, the cell swap's, the rules' corpora) are other suites' to read.
const DIRS = ['test/fixtures', 'test/fixtures/mcos', 'test/fixtures/display', 'test/fixtures/sparse', 'test/fixtures/complex_inf', 'test/fixtures/global', 'test/fixtures/mcos-templates/targets/r2023b', 'test/fixtures/mcos-templates/targets/r2027a', 'test/parity/artifacts/text', 'test/parity/artifacts/binary', 'test/parity/artifacts/mat'];
const SOURCES = DIRS.flatMap((d) => readdirSync(ROOT + d).filter((f) => /\.(sldd|mat)$/.test(f) && !/v73/.test(f)).map((f) => d + '/' + f));

const tokenOf = (payload: Any): string => {
  const cls = payload?.value?._array_class;
  return typeof cls === 'string' && cls !== '' ? cls : 'MatlabVariable';
};

describe('the deep pasteRefusal, the cheap one and the paste agree', () => {
  it('reads every source', () => {
    expect(SOURCES.length).toBeGreaterThan(60);
  });

  for (const into of [MIXED, NONE]) {
    it(`for every entry of every source, pasted into ${into}`, { timeout: 120_000 }, () => {
      const bytes = fixture(into);
      const admitted = target(bytes).root.getAdmittedTypes();
      const made = new Set<string>();
      let cases = 0;
      for (const source of SOURCES) {
        let copies: ReturnType<typeof copiesOf>;
        try {
          copies = copiesOf(source);
        } catch {
          continue;
        }
        for (const { entry, payload } of copies) {
          if (payload === null) continue;
          cases++;
          const what = `${source} ${entry.name}`;
          const asked = target(bytes);
          const cheap = asked.session.pasteRefusal('t.mat', payload);
          const deep = asked.session.pasteRefusal('t.mat', payload, { deep: true });
          // Asking changed nothing.
          expect([asked.events, asked.root.dirty, asked.session.canUndo()], what).toEqual([[], false, false]);
          const t = target(bytes);
          const res: Any = t.session.pasteEntries('t.mat', [payload]);
          expect(res.error ? res.reason : null, what).toBe(deep);
          if (cheap !== null) {
            expect(res.reason, what).toBe(cheap);
          }
          if (!res.error) {
            made.add(tokenOf(payload));
          }
          if (!admitted.includes(tokenOf(payload))) {
            expect(res.error, what).toBe(true);
          }
        }
      }
      expect(cases).toBeGreaterThan(1000);
      // Every token listed is made of some entry, and every entry made has a token listed.
      expect([...made].sort()).toEqual([...admitted].sort());
    });
  }
});

describe('what a MAT-file admits', () => {
  it("'MatlabVariable' and each object class a paste makes, which a copied string and a Constant are under", () => {
    for (const into of [MIXED, NONE, 'test/fixtures/mcos-templates/targets/r2027a/none.mat']) {
      expect(target(fixture(into)).root.getAdmittedTypes(), into).toEqual([
        'MatlabVariable',
        'Simulink.Parameter',
        'Simulink.Signal',
        'Simulink.Bus',
        'Simulink.NumericType',
        'Simulink.AliasType',
        'Simulink.ValueType',
      ]);
    }
    // A string, a dictionary's and a MAT-file's, and an Architectural Data Constant carry no
    // `_array_class`: their token is 'MatlabVariable'.
    const strings = [
      ...copiesOf('test/parity/artifacts/text/cases.sldd'),
      ...copiesOf('test/parity/artifacts/binary/cases.sldd'),
      ...copiesOf('test/parity/artifacts/mat/cases.mat'),
    ].filter((c) => c.entry.className === 'string');
    expect(strings.length).toBeGreaterThan(5);
    const constant = copiesOf('test/fixtures/arch.sldd').filter((c) => c.entry.kind === 'Constant');
    expect(constant.length).toBeGreaterThan(0);
    for (const { payload } of [...strings, ...constant]) expect(tokenOf(payload)).toBe('MatlabVariable');
  });

  it('only plain values from a file whose objects are of a blob version no edit was measured on, and nothing from one no save can write', () => {
    // The file with its subsystem's blob made version 5.0 (as test/matCreate.test.ts makes it).
    const bytes = fixture('test/fixtures/mcos-templates/targets/r2023b/param.mat');
    const objects = target(bytes).root._mcosSubsystem() as Any;
    const sub = cloneSubsystem(objects.records) as Any;
    sub.blob.major = 5;
    const flags = sub.aliases.flags.slice();
    flags[8] = 13;
    sub.packages = { ...sub.aliases, flags, entries: sub.aliases.entries.map(() => 0) };
    const stream = zlibSync(writeSubsystem(sub), { level: 6 });
    const head = bytes.subarray(0, objects.record.offset);
    const tag = new Uint8Array(8);
    new DataView(tag.buffer).setUint32(0, 15, true);
    new DataView(tag.buffer).setUint32(4, stream.length, true);
    const v5 = target(new Uint8Array([...head, ...tag, ...stream]));
    expect(v5.root.getAdmittedTypes()).toEqual(['MatlabVariable']);
    const p = copiesOf('test/parity/artifacts/text/cases.sldd').find((c) => c.entry.name === 'aParam')!.payload;
    expect(v5.session.pasteRefusal('t.mat', p)).toMatch(/^Cannot paste "aParam" into "t\.mat": it is a Simulink\.Parameter, and the file's objects are of a blob version no edit was measured on\. Nothing was pasted\.$/);
    expect((v5.session.pasteEntries('t.mat', [{ name: 'n', metadata: null, value: 1 }]) as Any).nodes).toHaveLength(1);
  });
});

describe("the save's own read-back, which a paste runs on the element it would write", () => {
  // Every variable of every MAT-file fixture, written fresh by a save as an edited value is: where
  // that save writes it, the paste's dry run of the same write (MatFileWriter.freshWriteRefusal)
  // refuses nothing, and it never throws.
  const MAT_DIRS = [...DIRS, 'test/fixtures/mat-check', 'test/fixtures/mat-cellswap', 'test/fixtures/mat-edits-gate', 'test/fixtures/mat-field-rename', 'test/fixtures/mat-allowlist'];
  const files = [...new Set(MAT_DIRS.flatMap((d) => readdirSync(ROOT + d).filter((f) => f.endsWith('.mat') && !/v73/.test(f)).map((f) => d + '/' + f)))];

  it('refuses nothing a save writes fresh', { timeout: 120_000 }, () => {
    let written = 0;
    for (const path of files) {
      let root: Any;
      try {
        root = createSession().addMatSource('m.mat', bufferOf(fixture(path)));
      } catch {
        continue;
      }
      if (root.readOnly) continue;
      for (const v of root.children.slice()) {
        if (typeof v._matStream !== 'function') continue;
        // Edited, as a save tells one it writes fresh (MatFileWriter.editOf), the file otherwise as read.
        const marks = [v.status, v._valueEdited, v._plainEdited];
        Object.assign(v, { status: 'Modified', _valueEdited: true, _plainEdited: true });
        let saved: boolean;
        try {
          serializeMatFile(root);
          saved = true;
        } catch {
          saved = false;
        }
        [v.status, v._valueEdited, v._plainEdited] = marks;
        let dry: unknown;
        expect(() => (dry = freshWriteRefusal(v, root.headerBytes)), `${path} ${v.name}`).not.toThrow();
        if (saved) {
          written++;
          expect(dry, `${path} ${v.name}`).toBeNull();
        }
      }
    }
    expect(written).toBeGreaterThan(200);
  });
});
