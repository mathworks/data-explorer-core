// Copyright 2026 The MathWorks, Inc.
//
// A CoderInfo MATLAB R2024b and earlier save as a 'handle' opaque (McosParser), copied out of the
// MAT-file and pasted into a dictionary. The copy carried its StorageClass, Identifier and Alignment
// alone, and the dictionary loaded the rest as its defaults: MATLAB R2027a loaded 13 of the 28
// objects these fixtures hold, pasted so, warning that "the package that defines custom storage
// classes has been changed since this MAT-file was saved, from 'Simulink' to ''", and crashed
// loading a Breakpoint copied out of an R2024b MAT-file. And the reader's mark went with it: the
// pasted entry refused every edit of its storage class, and its text dictionary's JSON held the key.
//
// Now the copy carries every property the opaque saves, which is all of them, as R2027a's own
// CoderInfo is decoded (McosSubsystemCodec.handleObjectOf), and a dictionary takes the value
// without the mark (McosParser.withoutHandleMarks). Measured on 2026-10-24: the 28, and the 4
// objects of two R2027a MAT-files, pasted into a text and a binary dictionary as a host pastes
// them, loaded in MATLAB R2027a with no warning, of the class they were, every property isequaln
// to the source MAT-file's and each of the CoderInfo's equal; and so did the 28 pasted into a
// binary dictionary MATLAB R2023b made, loaded in R2023b.
//
// One the reader cannot read whole (a property saved in a form it does not read, a LoggingInfo
// that saves any) is marked (McosParser.HANDLE_UNREAD_KEY), and refused into a dictionary, naming
// why: a copy must not change what MATLAB loads.
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { unzlibSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { getSectionMetadata } from '../src/datamodel/SectionConstants.js';
import { HANDLE_UNREAD_KEY } from '../src/datamodel/parser/McosParser.js';
import { descriptorCell, handleObjectOf, isHandleOpaque, readHandleOpaque, readSubsystem, writeHandleOpaque } from '../src/datamodel/parser/McosSubsystemCodec.js';
import { MCOS_TEMPLATES } from '../src/datamodel/parser/mcosTemplates.js';
import { fixtureSubsystems } from './tools/mcosFixtureSubsystems.js';
import { BINARY_CASES, TEXT_CASES, bufferOf, fixture } from './tools/matPaste.js';

type Any = any;

const HANDLE_DIR = 'test/fixtures/mcos-handle/';
const HANDLE_MATS = ['r2023b', 'r2024b'].flatMap((r) => readdirSync(HANDLE_DIR + r).map((f) => HANDLE_DIR + r + '/' + f));
// An R2027a MAT-file's CoderInfo, MCOS-decoded, which the handle's is held to.
const R2027A = 'test/fixtures/shown-saved/shown_saved.mat';
const HAS_CODER_INFO = /^Simulink\.(Parameter|Signal|LookupTable|Breakpoint)$/;

/** Every 'handle' opaque value cell of the fixtures' subsystems and of the shipped templates, read once. */
let opaques: { where: string; cell: Uint8Array }[] | null = null;
function handleOpaques(): { where: string; cell: Uint8Array }[] {
  opaques = opaques ?? readOpaques();
  return opaques;
}

function readOpaques(): { where: string; cell: Uint8Array }[] {
  const subsystems: { where: string; bytes: Uint8Array }[] = [...fixtureSubsystems()];
  for (const name of Object.keys(MCOS_TEMPLATES)) {
    subsystems.push({ where: 'template ' + name, bytes: unzlibSync(Buffer.from(MCOS_TEMPLATES[name].subsystem, 'base64')) });
  }
  const out: { where: string; cell: Uint8Array }[] = [];
  for (const s of subsystems) {
    const r = readSubsystem(s.bytes);
    if (r.ok) {
      r.subsystem.values.forEach((cell, k) => isHandleOpaque(cell) && out.push({ where: s.where + ' cell ' + k, cell }));
    }
  }
  return out;
}

/** Every object of `path` holding a CoderInfo, and its copy as a host makes one (serialize(), cloned). */
function copiesIn(path: string): { entry: Any; session: Any; copy: Any }[] {
  const session = createSession();
  const root: Any = session.addMatSource(path, bufferOf(fixture(path)));
  return root.children.filter((e: Any) => HAS_CODER_INFO.test(e.className)).map((entry: Any) => ({ entry, session, copy: structuredClone(entry.serialize()) }));
}

const coderInfoOf = (copy: Any): Any => copy.value._elements[0]._properties.CoderInfo;

describe("a 'handle' opaque read whole", () => {
  it('every CoderInfo the tree holds: the properties an R2027a CoderInfo saves, its CustomAttributes an object', { timeout: 120_000 }, () => {
    const r2027a = Object.keys(coderInfoOf(copiesIn(R2027A)[0].copy)._properties).filter((k) => k !== 'Identifier').sort();
    let coderInfos = 0;
    for (const { where, cell } of handleOpaques()) {
      const read = handleObjectOf(cell);
      expect(read.ok, where).toBe(true);
      if (!read.ok) continue;
      if (read.className === 'Simulink.LoggingInfo') {
        // R2023b's LoggingInfo: every one in the tree saves nothing, the default.
        expect(read.properties, where).toEqual({});
        continue;
      }
      coderInfos++;
      expect([read.className, Object.keys(read.properties).sort()], where).toEqual(['Simulink.CoderInfo', r2027a]);
      expect(read.properties.CustomAttributes, where).toEqual({ _object_class: 'SimulinkCSC.AttribClass_Simulink_Default', _properties: {} });
      expect([read.properties.CSCPackageName, read.properties.HasCoderInfo, read.properties.IsCSCPackageOverridden], where).toEqual(['Simulink', true, false]);
    }
    // Measured when this was written: 132.
    expect(coderInfos).toBeGreaterThanOrEqual(132);
  });

  it('refuses one saving a property in a form it does not read, naming it', { timeout: 120_000 }, () => {
    const { cell } = handleOpaques().find(({ cell }) => (handleObjectOf(cell) as Any).className === 'Simulink.CoderInfo')!;
    const h = readHandleOpaque(cell);
    if (!h.ok) throw new Error(h.message);
    const b = h.opaque.blob;
    const alias = b.pvLists[b.objects[1].pvList].find((t) => b.strings[t.name] === 'Alias')!;
    expect(alias.flag).toBe(1);
    // Alias as two objects, which no CoderInfo saves.
    h.opaque.values[alias.value] = descriptorCell({ dims: [2, 1], ids: [2, 2], classIndex: null });
    expect(handleObjectOf(writeHandleOpaque(h.opaque))).toMatchObject({ ok: false, reason: 'unsupported', message: 'the Simulink.CoderInfo saves Alias as other than text, a logical, a number or one object' });
  });
});

describe('an object of an R2024b or earlier MAT-file, copied', () => {
  it('carries its CoderInfo as an R2027a MAT-file holds one: every property, by the same names', () => {
    // And the Identifier a Parameter's and a Signal's show of its Alias (mcosShown.shownPropertiesOf).
    const saved = (ci: Any) => Object.keys(ci._properties).filter((k) => k !== 'Identifier').sort();
    const r2027a = saved(coderInfoOf(copiesIn(R2027A)[0].copy));
    let copied = 0;
    for (const path of HANDLE_MATS) {
      for (const { entry, copy } of copiesIn(path)) {
        copied++;
        const ci = coderInfoOf(copy);
        const label = path + ' ' + entry.name;
        expect(saved(ci), label).toEqual(r2027a);
        expect('Identifier' in ci._properties, label).toBe(entry.className === 'Simulink.Parameter' || entry.className === 'Simulink.Signal');
        expect([ci._properties.CSCPackageName, ci._properties.CustomStorageClass, ci._properties.ParameterOrSignal], label).toEqual([
          'Simulink',
          'Default',
          entry.className === 'Simulink.Signal' ? 'Signal' : 'Parameter',
        ]);
        expect(ci[HANDLE_UNREAD_KEY], label).toBeUndefined();
      }
    }
    expect(copied).toBe(28);
  });

  it('pasted into a text and a binary dictionary as a host pastes one: no mark of the reader, its storage class edited, and saved whole', () => {
    const [{ copy }] = copiesIn(HANDLE_DIR + 'r2023b/exp_ci_pexp_id.mat');
    for (const file of [TEXT_CASES, BINARY_CASES]) {
      const session = createSession();
      const root: Any = ingest(session, bufferOf(fixture(file)), { filename: 'cases.sldd' });
      const section = root.getSection('design');
      const raw = structuredClone(copy);
      raw.metadata = { uuid: '00000000-0000-4000-8000-000000000001', ...getSectionMetadata(section.name) };
      const node = section.parseEntry(raw);
      session.setActive(root, node);
      expect(JSON.stringify(node.serial._properties), file).not.toContain('_handleOpaque');
      expect(session.editProperty(node.id, 'storageClass', 'ImportedExtern'), file).toBe(true);
      const out: Any = session.serializeSource(root.name);
      if (out.kind === 'text') {
        expect(out.text).not.toMatch(/_handleOpaque|_handleUnread/);
      }
      const bytes = out.kind === 'text' ? new TextEncoder().encode(out.text) : new Uint8Array(out.bytes);
      const again: Any = ingest(createSession(), bufferOf(bytes), { filename: 'cases.sldd' });
      const back = again.children.flatMap((s: Any) => s.children).find((e: Any) => e.name === 'p');
      const ci = back.serial._properties.CoderInfo;
      const props = ci._properties ?? ci._elements[0]._properties;
      expect([props.StorageClass, props.Alias, props.CSCPackageName, props.CustomStorageClass, props.ParameterOrSignal], file).toEqual(['ImportedExtern', 'g_p', 'Simulink', 'Default', 'Parameter']);
    }
  });

  it('one not read whole is refused into a dictionary, naming why, and copied otherwise', () => {
    const [{ entry, session }] = copiesIn(HANDLE_DIR + 'r2023b/exp_ci_pexp_id.mat');
    entry.serial._properties.CoderInfo[HANDLE_UNREAD_KEY] = 'its Simulink.CoderInfo saves Alias as two objects';
    const why = "its CoderInfo is MATLAB's own handle data, which was not read whole (its Simulink.CoderInfo saves Alias as two objects), and a dictionary would hold the rest as its defaults";
    expect(session.copyRefusal(entry.id)).toBeNull();
    expect(session.copyRefusal(entry.id, 'json')).toBe('Cannot copy "p" into a text dictionary: ' + why + '. Nothing was copied.');
    expect(session.copyRefusal(entry.id, 'xml')).toBe('Cannot copy "p" into a binary dictionary: ' + why + '. Nothing was copied.');
    // And a host's paste of it, which builds the entry where copyRefusal does.
    const root: Any = ingest(createSession(), bufferOf(fixture(TEXT_CASES)), { filename: 'cases.sldd' });
    const raw = { ...structuredClone(entry.serialize()), metadata: { uuid: '00000000-0000-4000-8000-000000000002' } };
    expect(() => root.getSection('design').parseEntry(raw)).toThrow('Cannot write "p": ' + why + '. Nothing was written.');
  });
});
