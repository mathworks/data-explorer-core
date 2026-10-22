// Copyright 2026 The MathWorks, Inc.
//
// The 'handle' opaque MATLAB R2024b and earlier save a Simulink.CoderInfo as (and R2023b a Signal's
// LoggingInfo): read whole into records and written back, and a CoderInfo's StorageClass,
// Identifier and Alignment read and edited as MATLAB's own edit writes them.
//
//   - Every 'handle' opaque the test tree and the shipped templates hold reads and writes back byte
//     for byte, and a CoderInfo written again unedited is the same bytes.
//   - The edits MATLAB R2023b and R2024b made (test/fixtures/mcos-handle, cases.json): the codec's
//     edit of each original's CoderInfo is MATLAB's own cell, and through the subsystem it verifies,
//     and is MATLAB's subsystem where cases.json says so.
//   - What it refuses, and that a subsystem takes the edited cell only when told to.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzlibSync } from 'fflate';
import { parseMat } from '../src/datamodel/parser/MatParser.js';
import { objectIdOf, valueCellOf } from '../src/datamodel/parser/McosSubsystemEdit.js';
import {
  cloneSubsystem,
  editHandleCoderInfo,
  handleCoderInfoOf,
  isHandleOpaque,
  propertiesOf,
  readHandleOpaque,
  readSubsystem,
  replaceValueCell,
  setProperty,
  verifySubsystem,
  writeHandleOpaque,
  writeSubsystem,
  type McosSubsystemRecords,
} from '../src/datamodel/parser/McosSubsystemCodec.js';
import { MCOS_TEMPLATES } from '../src/datamodel/parser/mcosTemplates.js';
import { MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { fixtureSubsystems, matSubsystemOf } from './tools/mcosFixtureSubsystems.js';

const GOLDEN = fileURLToPath(new URL('./fixtures/mcos-handle/', import.meta.url));
const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

function read(bytes: Uint8Array): McosSubsystemRecords {
  const r = readSubsystem(bytes);
  if (!r.ok) throw new Error(`${r.reason}: ${r.message}`);
  return r.subsystem;
}

/** The subsystem of the shipped template of `className`: one default object, MATLAB R2023b's. */
const templateSubsystem = (className: string): McosSubsystemRecords => read(unzlibSync(Buffer.from(MCOS_TEMPLATES[className].subsystem, 'base64')));

/** Every 'handle' opaque value cell of the fixtures' subsystems and of the shipped templates. */
const OPAQUES: { where: string; cell: Uint8Array }[] = [];
for (const f of fixtureSubsystems()) {
  const r = readSubsystem(f.bytes);
  if (!r.ok) continue;
  r.subsystem.values.forEach((cell, k) => isHandleOpaque(cell) && OPAQUES.push({ where: `${f.where} cell ${k}`, cell }));
}
for (const name of Object.keys(MCOS_TEMPLATES)) {
  templateSubsystem(name).values.forEach((cell, k) => isHandleOpaque(cell) && OPAQUES.push({ where: `template ${name} cell ${k}`, cell }));
}

/** A template's CoderInfo: the subsystem, its object 1's CoderInfo value index, and the cell. */
function templateCoderInfo(className: string): { s: McosSubsystemRecords; k: number; cell: Uint8Array } {
  const s = templateSubsystem(className);
  const k = propertiesOf(s, 1).find((p) => p.savedName === 'CoderInfo')!.value;
  return { s, k, cell: s.values[k] };
}

describe("every 'handle' opaque the test tree holds", () => {
  it('is found in the fixtures and the templates', () => {
    // Measured when this was written: 63, 50 of them a CoderInfo and 13 a Signal's LoggingInfo.
    expect(OPAQUES.length).toBeGreaterThanOrEqual(63);
  });

  it('reads whole and writes back byte for byte', () => {
    const wrong = OPAQUES.flatMap((o) => {
      const r = readHandleOpaque(o.cell);
      if (!r.ok) return [`${o.where}: ${r.reason}: ${r.message}`];
      return same(writeHandleOpaque(r.opaque), o.cell) ? [] : [`${o.where}: writes back as other bytes`];
    });
    expect(wrong).toEqual([]);
  });

  it("is, for a CoderInfo, its own bytes when written again unedited as MATLAB writes one; and refused, for another class, by name", () => {
    let coderInfos = 0;
    const others = new Set<string>();
    for (const o of OPAQUES) {
      const shown = handleCoderInfoOf(o.cell);
      const edited = editHandleCoderInfo(o.cell, {});
      if (shown.ok) {
        expect(edited.ok && same(edited.cell, o.cell), o.where).toBe(true);
        coderInfos++;
      } else {
        expect(shown.reason, o.where).toBe('unsupported');
        expect(edited).toEqual(shown);
        others.add(/holds a (\S+),/.exec(shown.message)?.[1] ?? shown.message);
      }
    }
    expect(coderInfos).toBeGreaterThanOrEqual(50);
    expect([...others]).toEqual(['Simulink.LoggingInfo']);
  });

  it("shows a default CoderInfo's settings as MATLAB's defaults", () => {
    for (const className of ['Simulink.Parameter', 'Simulink.Signal', 'Simulink.LookupTable', 'Simulink.Breakpoint']) {
      expect(handleCoderInfoOf(templateCoderInfo(className).cell), className).toEqual({ ok: true, settings: { StorageClass: 'Auto', Identifier: '', Alignment: -1 } });
    }
  });
});

// ---- The edits MATLAB judged ---------------------------------------------------------------------

interface HandleCase {
  name: string;
  release: string;
  original: string;
  matlabSave: string;
  variable: string;
  statements: string[];
  edits: { StorageClass?: string; Identifier?: string; Alignment?: number };
  sameSubsystem: boolean;
}

const CASES: { matlabVersions: Record<string, string>; cases: HandleCase[] } = JSON.parse(readFileSync(join(GOLDEN, 'cases.json'), 'utf8'));

const arrayBufferOf = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

/** A .mat's subsystem, and the CoderInfo of the object variable `variable` names. */
function coderInfoIn(file: string, variable: string): { bytes: Uint8Array; s: McosSubsystemRecords; id: number; k: number; cell: Uint8Array } {
  const mat = new Uint8Array(readFileSync(join(GOLDEN, file)));
  const bytes = matSubsystemOf(mat)!;
  const s = read(bytes);
  const id = objectIdOf(parseMat(arrayBufferOf(mat)).variables.find((v) => v.name === variable)!.mcosHandle, 0)!;
  const k = propertiesOf(s, id).find((p) => p.savedName === 'CoderInfo')!.value;
  return { bytes, s, id, k, cell: s.values[k] };
}

describe('the edits MATLAB R2023b and R2024b judged', () => {
  it('are the probe this suite is held to', () => {
    expect(Object.values(CASES.matlabVersions).join(' ')).toMatch(/R2023b.*R2024b/);
    expect(CASES.cases.length).toBe(12);
    expect(new Set(CASES.cases.flatMap((c) => Object.keys(c.edits)))).toEqual(new Set(['StorageClass', 'Identifier', 'Alignment']));
  });

  for (const c of CASES.cases) {
    describe(`${c.release} ${c.name}: ${c.statements.join(' ')}`, () => {
      const original = coderInfoIn(c.original, c.variable);
      const matlab = coderInfoIn(c.matlabSave, c.variable);
      const edited = editHandleCoderInfo(original.cell, c.edits);

      it("writes MATLAB's own CoderInfo, byte for byte", () => {
        expect(edited.ok && same(edited.cell, matlab.cell)).toBe(true);
      });

      it('which shows the settings edited', () => {
        const shown = edited.ok ? handleCoderInfoOf(edited.cell) : null;
        expect(shown?.ok && shown.settings).toMatchObject(c.edits);
      });

      it(`takes it into the subsystem, which verifies against the one read${c.sameSubsystem ? " and is MATLAB's" : ''}`, () => {
        const s = cloneSubsystem(original.s);
        replaceValueCell(s, original.k, (edited as { cell: Uint8Array }).cell, { handleOpaque: true });
        const bytes = writeSubsystem(s);
        expect(verifySubsystem(bytes, s, original.s)).toEqual({ ok: true });
        expect(same(bytes, matlab.bytes)).toBe(c.sameSubsystem);
      });
    });
  }
});

// ---- What it refuses -----------------------------------------------------------------------------

describe('what it refuses', () => {
  const signal = templateSubsystem('Simulink.Signal');
  const loggingInfo = signal.values[propertiesOf(signal, 1).find((p) => p.savedName === 'LoggingInfo')!.value];

  it("an opaque of another class, a Signal's LoggingInfo", () => {
    expect(isHandleOpaque(loggingInfo)).toBe(true);
    expect(readHandleOpaque(loggingInfo).ok).toBe(true);
    expect(handleCoderInfoOf(loggingInfo)).toMatchObject({ ok: false, reason: 'unsupported', message: expect.stringContaining('Simulink.LoggingInfo') });
    expect(editHandleCoderInfo(loggingInfo, { StorageClass: 'ExportedGlobal' })).toMatchObject({ ok: false, reason: 'unsupported' });
  });

  it("a cell that is not a 'handle' opaque", () => {
    const value = valueCellOf({ name: '', className: 'double', dimensions: [1, 1], value: 1, isComplex: false, isLogical: false, fields: null });
    expect(isHandleOpaque(value)).toBe(false);
    expect(readHandleOpaque(value)).toMatchObject({ ok: false, reason: 'malformed' });
    expect(editHandleCoderInfo(value, {})).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('a CoderInfo that saves no such property', () => {
    const r = readHandleOpaque(templateCoderInfo('Simulink.Parameter').cell);
    if (!r.ok) throw new Error(r.message);
    const list = r.opaque.blob.pvLists[r.opaque.blob.objects[1].pvList];
    list.splice(list.findIndex((t) => r.opaque.blob.strings[t.name] === 'Alignment'), 1);
    const cell = writeHandleOpaque(r.opaque);
    expect(editHandleCoderInfo(cell, { Alignment: 8 })).toMatchObject({ ok: false, reason: 'unsupported', message: expect.stringContaining('Alignment') });
  });

  it('a blob section no MATLAB-written one holds', () => {
    const r = readHandleOpaque(templateCoderInfo('Simulink.Parameter').cell);
    if (!r.ok) throw new Error(r.message);
    r.opaque.blob.removedProps = [];
    expect(() => writeHandleOpaque(r.opaque)).toThrow(MatWriteError);
  });

  it('a storage class no edit was measured writing: Custom, a custom one, a misspelt one', () => {
    const cell = templateCoderInfo('Simulink.Parameter').cell;
    for (const StorageClass of ['Custom', 'ExportedGlobalStruct', 'exportedglobal', '', 'toString']) {
      expect(editHandleCoderInfo(cell, { StorageClass, Identifier: 'x' }), StorageClass).toMatchObject({ ok: false, reason: 'unsupported', message: expect.stringContaining('storage class') });
    }
  });

  it('any edit of a CoderInfo whose storage class is one no edit was measured under: Custom, Const', () => {
    for (const held of ['Custom', 'Const']) {
      // The template's CoderInfo, its storage class saved as `held`, as a string index.
      const r = readHandleOpaque(templateCoderInfo('Simulink.Parameter').cell);
      if (!r.ok) throw new Error(r.message);
      const b = r.opaque.blob;
      const t = b.pvLists[b.objects[1].pvList].find((x) => b.strings[x.name] === 'StorageClass')!;
      b.strings.push(held);
      t.value = b.strings.length - 1;
      const cell = writeHandleOpaque(r.opaque);
      expect(handleCoderInfoOf(cell)).toMatchObject({ ok: true, settings: { StorageClass: held } });
      for (const edits of [{ Identifier: 'x' }, { Alignment: 8 }, { StorageClass: 'Auto' }, {}]) {
        expect(editHandleCoderInfo(cell, edits), `${held} ${JSON.stringify(edits)}`).toMatchObject({
          ok: false,
          reason: 'unsupported',
          message: `the CoderInfo's storage class is "${held}", under which no edit was measured; those measured are Auto, ExportedGlobal, ImportedExtern, ImportedExternPointer, SimulinkGlobal, Model default`,
        });
      }
    }
  });

  it("writes 'Model default' as MATLAB saves it, SimulinkGlobal", () => {
    const cell = templateCoderInfo('Simulink.Parameter').cell;
    const a = editHandleCoderInfo(cell, { StorageClass: 'Model default' });
    const b = editHandleCoderInfo(cell, { StorageClass: 'SimulinkGlobal' });
    expect(a.ok && b.ok && same(a.cell, b.cell)).toBe(true);
    expect(a.ok && handleCoderInfoOf(a.cell)).toMatchObject({ ok: true, settings: { StorageClass: 'SimulinkGlobal' } });
  });

  it('no other value: whether MATLAB takes one is the caller to judge', () => {
    const edited = editHandleCoderInfo(templateCoderInfo('Simulink.Parameter').cell, { StorageClass: 'ExportedGlobal', Identifier: 'bad name', Alignment: 3 });
    const shown = edited.ok ? handleCoderInfoOf(edited.cell) : null;
    expect(shown?.ok && shown.settings).toEqual({ StorageClass: 'ExportedGlobal', Identifier: 'bad name', Alignment: 3 });
  });
});

describe('a subsystem takes an edited CoderInfo only when told to', () => {
  it('replacing the opaque only with handleOpaque, and only with an opaque of its class', () => {
    const { s, k, cell } = templateCoderInfo('Simulink.Parameter');
    const edited = editHandleCoderInfo(cell, { StorageClass: 'ExportedGlobal' });
    if (!edited.ok) throw new Error(edited.message);
    const original = cloneSubsystem(s);
    expect(() => replaceValueCell(s, k, edited.cell)).toThrow(/object reference/);
    expect(() => setProperty(s, 1, 'CoderInfo', edited.cell)).toThrow(/object reference/);
    const value = valueCellOf({ name: '', className: 'double', dimensions: [1, 1], value: 1, isComplex: false, isLogical: false, fields: null });
    expect(() => replaceValueCell(s, k, value, { handleOpaque: true })).toThrow(/'handle' opaque/);
    const signal = templateSubsystem('Simulink.Signal');
    const loggingInfo = signal.values[propertiesOf(signal, 1).find((p) => p.savedName === 'LoggingInfo')!.value];
    expect(() => replaceValueCell(s, k, loggingInfo, { handleOpaque: true })).toThrow(/'handle' opaque/);
    expect(setProperty(s, 1, 'CoderInfo', edited.cell, undefined, { handleOpaque: true })).toMatchObject({ op: 'swap', valueIndex: k });
    expect(same(s.values[k], edited.cell)).toBe(true);
    expect(verifySubsystem(writeSubsystem(s), s, original)).toEqual({ ok: true });
  });
});

describe('what a damaged opaque gives instead of an error', () => {
  /** An miMATRIX element of `parts`, each a sub-element (type, payload), long tags, padded to 8. */
  const element = (parts: [number, Uint8Array][]): Uint8Array => {
    const subs = parts.map(([type, payload]) => {
      const out = new Uint8Array(8 + payload.length + ((8 - (payload.length % 8)) % 8));
      const view = new DataView(out.buffer);
      view.setUint32(0, type, true);
      view.setUint32(4, payload.length, true);
      out.set(payload, 8);
      return out;
    });
    const n = subs.reduce((a, x) => a + x.length, 0);
    const out = new Uint8Array(8 + n);
    new DataView(out.buffer).setUint32(0, 14, true);
    new DataView(out.buffer).setUint32(4, n, true);
    subs.reduce((at, x) => (out.set(x, at), at + x.length), 8);
    return out;
  };
  const withAlias = (alias: Uint8Array): Uint8Array => {
    const r = readHandleOpaque(templateCoderInfo('Simulink.Parameter').cell);
    if (!r.ok) throw new Error(r.message);
    const t = r.opaque.blob.pvLists[r.opaque.blob.objects[1].pvList].find((x) => r.opaque.blob.strings[x.name] === 'Alias')!;
    r.opaque.values[t.value] = alias;
    return writeHandleOpaque(r.opaque);
  };

  it('shows a long Identifier stored a byte a character, which MATLAB never writes, without overflowing', () => {
    const n = 400000;
    const alias = element([[6, Uint8Array.of(4, 0, 0, 0, 0, 0, 0, 0)], [5, new Uint8Array(new Int32Array([1, n]).buffer)], [1, new Uint8Array(0)], [2, new Uint8Array(n).fill(0x41)]]);
    const shown = handleCoderInfoOf(withAlias(alias));
    expect(shown.ok && shown.settings.Identifier.length).toBe(n);
  });

  it('edits no value cell two triples name, which would edit both', () => {
    const r = readHandleOpaque(templateCoderInfo('Simulink.Parameter').cell);
    if (!r.ok) throw new Error(r.message);
    const list = r.opaque.blob.pvLists[r.opaque.blob.objects[1].pvList];
    const alias = list.find((x) => r.opaque.blob.strings[x.name] === 'Alias')!;
    list.find((x) => r.opaque.blob.strings[x.name] === 'HasCoderInfo')!.value = alias.value;
    const cell = writeHandleOpaque(r.opaque);
    expect(handleCoderInfoOf(cell).ok).toBe(true);
    expect(editHandleCoderInfo(cell, { Identifier: 'g_x' })).toMatchObject({ ok: false, reason: 'unsupported', message: expect.stringContaining('one value cell') });
  });
});
