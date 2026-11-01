// Copyright 2026 The MathWorks, Inc.
//
// A coder setting no MAT-file or compressed-binary dictionary keeps. MATLAB saves a Parameter whose
// coder information it never set up (one copied out of a model workspace or a data dictionary) with
// CoderInfo.HasCoderInfo false, and keeps it so in a MAT-file and a binary dictionary; reading either,
// it ignores every coder setting the file holds of it (R2027a: a Storage Class core wrote there read
// back Auto, isequal to the file without it, as MATLAB's own MAT-file save drops one). The edit was
// taken and lost. Its cell now offers no editor, and the edit is refused, saying why. A text
// dictionary reads such a Parameter back with the flag true and keeps the edit, and a Parameter MATLAB
// made (the flag true) keeps every coder row, as before.
//
// test/fixtures/coder-info (make_coder_info.m, R2027a): pWs, a Parameter taken out of a model
// workspace (the flag false); pNew, one MATLAB made, with a Storage Class, an Identifier and an
// Alignment (the flag true); in a MAT-file, a binary and a text dictionary.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const DIR = 'test/fixtures/coder-info/r2027a/';
const bufferOf = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const bytesOf = (save: Any): Uint8Array => (save.kind === 'text' ? new TextEncoder().encode(save.text) : save.bytes);

/** A file of the fixture opened in a session of its own, as a host opens it; its entries by name, and its save. */
function opened(file: string) {
  const bytes = new Uint8Array(readFileSync(DIR + file));
  const session: Any = createSession();
  const root: Any = file.endsWith('.mat') ? session.addMatSource(file, bufferOf(bytes)) : ingest(session, bufferOf(bytes), { filename: file });
  const entries: Any[] = file.endsWith('.mat') ? root.children : root.children.flatMap((s: Any) => s.children ?? []);
  const entry = (name: string): Any => entries.find((e) => e.name === name);
  const save = (): Uint8Array => bytesOf(session.serializeSource(root.name));
  return { session, root, bytes, entry, save };
}

// Whether `node`'s table cell `key`, and its Property Inspector row, offer an editor.
const offered = (node: Any, key: string): boolean[] => {
  const cell = node.getProperties().find((p: Any) => p.key === key);
  const rows = (node.getPILayout?.() ?? []).flatMap((g: Any) => g.items).filter((p: Any) => p.key === key);
  return [cell, ...rows].filter(Boolean).map((p: Any) => node.getPropInfo(p).editable);
};

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

const UNKEPT = (label: string) =>
  `Cannot edit "pWs": pWs's ${label} would not be kept. This Parameter's coder settings were never set up (as when it was copied out of a model `
  + 'workspace or a data dictionary), and MATLAB ignores coder settings saved on such a Parameter. To set them, create a new Simulink.Parameter in MATLAB.';

describe('a coder setting of a Parameter whose coder information MATLAB never set up is refused, saying why', () => {
  it('in a MAT-file: its Storage Class, Identifier and Alignment, which a save would write and MATLAB ignore', () => {
    const f = opened('coder_info.mat');
    const p = f.entry('pWs');
    expect(offered(p, 'storageClass').some(Boolean), 'no editor of its Storage Class').toBe(false);
    for (const [key, value, label] of [['storageClass', 'ExportedGlobal', 'Storage Class'], ['identifier', 'pWsId', 'Identifier'], ['alignment', '8', 'Alignment']]) {
      expect(p.setProperty(key, value), key).toMatchObject({ error: true, reason: UNKEPT(label) });
    }
    // Refused through the session too, as a host edits a cell, with the same words.
    f.session.setActive(f.root, p);
    expect(f.session.editProperty(p.id, 'storageClass', 'ExportedGlobal')).toMatchObject({ error: true, reason: UNKEPT('Storage Class') });
    expect([f.root.dirty, f.session.canUndo()]).toEqual([false, false]);
    expect(sameBytes(f.save(), f.bytes), 'the file saves as it was read').toBe(true);
  });

  it('in a binary dictionary: its Storage Class and Alignment (its Identifier is shown read-only there already)', () => {
    const f = opened('coder_info_binary.sldd');
    const unedited = opened('coder_info_binary.sldd').save();
    const p = f.entry('pWs');
    expect(offered(p, 'storageClass').some(Boolean)).toBe(false);
    for (const [key, value, label] of [['storageClass', 'ExportedGlobal', 'Storage Class'], ['alignment', '8', 'Alignment']]) {
      expect(p.setProperty(key, value), key).toMatchObject({ error: true, reason: UNKEPT(label) });
    }
    expect(sameBytes(f.save(), unedited), 'the file saves as an unedited one does').toBe(true);
  });
});

// The binary fixture's pWs, its entry's XML changed by `change` (a crafted file, made of MATLAB's).
function craftedPws(change: (xml: string) => string): Any {
  const parts = unzipSync(new Uint8Array(readFileSync(DIR + 'coder_info_binary.sldd')));
  parts['data/chunk0.xml'] = strToU8(change(strFromU8(parts['data/chunk0.xml'])));
  const root: Any = ingest(createSession(), bufferOf(zipSync(parts)), { filename: 'crafted.sldd' });
  return root.children.flatMap((s: Any) => s.children ?? []).find((e: Any) => e.name === 'pWs');
}
// `xml` with the first `was` after pWs's entry starts made `now`.
const inPws = (xml: string, was: string, now: string) => {
  const at = xml.indexOf(was, xml.indexOf('>pWs<'));
  return xml.slice(0, at) + now + xml.slice(at + was.length);
};

describe('what an older edit left, and what was not measured', () => {
  it('an unset CoderInfo showing a storage class other than Auto (an older core edit): its Alignment offers no editor either', () => {
    const p = craftedPws((x) => inPws(x, '<P Name="StorageClass" Class="char">Auto</P>', '<P Name="StorageClass" Class="char">ExportedGlobal</P>'));
    expect(offered(p, 'alignment').some(Boolean)).toBe(false);
    expect(p.setProperty('alignment', '8')).toMatchObject({ error: true, reason: UNKEPT('Alignment') });
  });

  it('a Signal holding the unset flag is as it was: a model workspace saves none, and none was measured', () => {
    const s = craftedPws((x) => inPws(x, '<Element Class="Simulink.Parameter">', '<Element Class="Simulink.Signal">'));
    expect(s.className).toBe('Simulink.Signal');
    expect(offered(s, 'storageClass')[0]).toBe(true);
    expect(s.setProperty('storageClass', 'ExportedGlobal')).toBe(true);
  });
});

describe('every other row stays as it was', () => {
  it("of the same Parameter: its Value, Min, Max and Description take an edit, and a save writes it", () => {
    for (const file of ['coder_info.mat', 'coder_info_binary.sldd']) {
      for (const [key, value] of [['Value', '3.5'], ['Min', '-1'], ['Max', '20'], ['Description', 'edited']]) {
        const f = opened(file);
        const p = f.entry('pWs');
        expect(offered(p, key)[0], `${file} ${key} offered`).toBe(true);
        expect(p.setProperty(key, value), `${file} ${key}`).toBe(true);
        const again = file.endsWith('.mat')
          ? createSession().addMatSource('again.mat', bufferOf(f.save())).children.find((c: Any) => c.name === 'pWs')
          : (ingest(createSession(), bufferOf(f.save()), { filename: 'again.sldd' }) as Any).children.flatMap((s: Any) => s.children ?? []).find((c: Any) => c.name === 'pWs');
        const shown = again.getPropInfo(again.getProperties().find((x: Any) => x.key === key)).displayValue;
        expect(String(shown), `${file} ${key} read back`).toBe(value);
      }
    }
  });

  it('of a Parameter MATLAB made: every coder row takes an edit, in a MAT-file and in a binary dictionary', () => {
    const mat = opened('coder_info.mat').entry('pNew');
    expect([mat.setProperty('storageClass', 'ImportedExtern'), mat.setProperty('identifier', 'pNewId2'), mat.setProperty('alignment', '16')]).toEqual([true, true, true]);
    const bin = opened('coder_info_binary.sldd').entry('pNew');
    expect([bin.setProperty('storageClass', 'ImportedExtern'), bin.setProperty('alignment', '16')]).toEqual([true, true]);
  });

  it('in a text dictionary, which MATLAB reads such a Parameter out of with the flag true: its Storage Class takes the edit', () => {
    const p = opened('coder_info_text.sldd').entry('pWs');
    expect(offered(p, 'storageClass')[0]).toBe(true);
    expect(p.setProperty('storageClass', 'ExportedGlobal')).toBe(true);
  });
});
