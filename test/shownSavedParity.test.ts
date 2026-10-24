// Copyright 2026 The MathWorks, Inc.
//
// What MATLAB shows of an object that it saves under other names, shown by one rule of every file
// (mcosShown.shownPropertiesOf): a Simulink.NumericType's Signedness, FractionLength and Slope, saved
// as SignednessBool, FixedExponent and SlopeAdjustmentFactor, and a Parameter's or a Signal's
// CoderInfo Identifier, saved as Alias. A MAT-file's object showed them and a dictionary's showed
// nothing of them.
//
// The same objects, written by MATLAB into a text dictionary, a binary one and a MAT-file
// (fixtures/shown-saved/make_shown_saved.m): every row of each is shown alike in the three files,
// and as MATLAB shows it. In a dictionary those rows are read-only, an edit of one refused saying
// why; a MAT-file offers an editor of them that writes the saved keys (matOfferedEdits.test.ts).
// And copied from either file into the other, as a host copies and pastes, an object shows every
// row it showed where it was copied from, before a save and after.
import { describe, it, expect } from 'vitest';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { getSectionMetadata } from '../src/datamodel/SectionConstants.js';
import { BINARY_CASES, TEXT_CASES, bufferOf, copyOf, fixture, NONE, reopened, rowsOf, sameBytes, target } from './tools/matPaste.js';

type Any = any;

const DIR = 'test/fixtures/shown-saved/';
const MAT = DIR + 'shown_saved.mat';
const TEXT = DIR + 'shown_saved_text.sldd';
const BINARY = DIR + 'shown_saved_binary.sldd';
const DICTIONARIES = [TEXT, BINARY];

// What MATLAB R2027a shows of each, read back from each of the three files (make_shown_saved.m's
// SHOWN lines), as the rows show it.
const MATLAB_SHOWS: Record<string, Record<string, string>> = {
  ntBp: { signedness: 'Signed', wordLength: '16', fractionLength: '8', slope: '0.00390625', bias: '0' },
  ntSb: { signedness: 'Unsigned', wordLength: '8', fractionLength: '2', slope: '0.375', bias: '3' },
  ntAuto: { signedness: 'Auto', wordLength: '16', fractionLength: '4', slope: '0.0625', bias: '0' },
  pId: { storageClass: 'ExportedGlobal', identifier: 'myId' },
  sId: { storageClass: 'ImportedExtern', identifier: 'ext_x' },
};
const NAMES = Object.keys(MATLAB_SHOWS);

// The rows a dictionary shows of what is saved under another name, and the refusal of an edit of each.
const SHOWN_OF_SAVED: [string, string, string][] = [
  ['ntBp', 'signedness', 'ntBp.Signedness is read-only here, shown of the SignednessBool MATLAB saves'],
  ['ntBp', 'fractionLength', 'ntBp.FractionLength is read-only here, shown of the FixedExponent MATLAB saves'],
  ['ntSb', 'slope', 'ntSb.Slope is read-only here, shown of the SlopeAdjustmentFactor and FixedExponent MATLAB saves'],
  ['ntAuto', 'signedness', 'ntAuto.Signedness is read-only here, shown of the SignednessBool MATLAB saves'],
  ['pId', 'identifier', 'pId.CoderInfo.Identifier is read-only here, shown of the CoderInfo.Alias MATLAB saves'],
  ['sId', 'identifier', 'sId.CoderInfo.Identifier is read-only here, shown of the CoderInfo.Alias MATLAB saves'],
];

/** `path` opened through a session, as a host opens it, and its entries by name. */
function opened(path: string) {
  const session = createSession();
  const root: Any = path.endsWith('.mat') ? session.addMatSource('f.mat', bufferOf(fixture(path))) : ingest(session, bufferOf(fixture(path)), { filename: path.split('/').pop()! });
  const entries: Any[] = path.endsWith('.mat') ? root.children : root.children.flatMap((s: Any) => s.children);
  const by = (name: string): Any => entries.find((e) => e.name === name);
  return { session, root, by };
}

/** What `node` shows of each row, by key. */
const shownOf = (node: Any): Record<string, string> => Object.fromEntries(rowsOf(node).map((r) => [r.slice(0, r.indexOf(' = ')), r.slice(r.indexOf(' = ') + 3)]));

/**
 * `payload` pasted into the dictionary `path` as a host pastes one (the extension's
 * prepareEntryForPaste): a clone, given a UUID and its section's namespace, read by the section, and
 * written by the dictionary's save; the entry made, and the dictionary opened again.
 */
function pastedIntoDictionary(path: string, payload: Any, uuid: string) {
  const { session, root } = opened(path);
  const section = root.getSection('design');
  const raw = structuredClone(payload);
  raw.name = section._uniqueName(raw.name);
  raw.metadata = { ...(raw.metadata ?? {}), uuid, ...getSectionMetadata(section.name) };
  // parseEntry adds the entry it reads to the section.
  const node = section.parseEntry(raw);
  section._markSourceDirty();
  const out: Any = session.serializeSource(root.name);
  const bytes = out.kind === 'text' ? new TextEncoder().encode(out.text) : new Uint8Array(out.bytes);
  const again: Any = ingest(createSession(), bufferOf(bytes), { filename: path.split('/').pop()! });
  return { node, again: again.children.flatMap((s: Any) => s.children).find((e: Any) => e.name === raw.name) };
}

describe('what MATLAB saves under other names, shown alike in a text dictionary, a binary one and a MAT-file', () => {
  it('every row of each object, in the three files, and as MATLAB shows it', () => {
    const files = [MAT, TEXT, BINARY].map(opened);
    for (const name of NAMES) {
      const [mat, text, binary] = files.map((f) => f.by(name));
      expect(mat?.name, name).toBe(name);
      expect(rowsOf(text), name).toEqual(rowsOf(mat));
      expect(rowsOf(binary), name).toEqual(rowsOf(mat));
      expect(shownOf(mat), name).toMatchObject(MATLAB_SHOWS[name]);
    }
  });

  it('in a dictionary, read-only: an edit of one is refused saying why, and nothing is changed', () => {
    for (const file of DICTIONARIES) {
      for (const [name, key, why] of SHOWN_OF_SAVED) {
        const { session, root, by } = opened(file);
        const node = by(name);
        const was = shownOf(node)[key];
        const typed = key === 'signedness' ? 'Unsigned' : key === 'identifier' ? 'zz' : '4';
        session.setActive(root, node);
        expect(session.editProperty(node.id, key, typed), file + ' ' + name + '.' + key).toEqual({
          error: true,
          reason: 'Cannot edit "' + name + '": ' + why + '.',
          invalidValue: typed,
          validValue: was,
        });
        expect([shownOf(node)[key], root.dirty], file + ' ' + name + '.' + key).toEqual([was, false]);
        // A text dictionary saves as it was read (a binary one's archive is written anew).
        const out: Any = session.serializeSource(root.name);
        if (out.kind === 'text') {
          expect(sameBytes(new TextEncoder().encode(out.text), fixture(file)), file + ' ' + name + '.' + key + ': saved as read').toBe(true);
        }
      }
    }
  });
});

describe('an object copied between a MAT-file and a dictionary shows the rows it showed where it was copied from', () => {
  it('copied out of the MAT-file and pasted into a text and a binary dictionary, before a save and after', () => {
    const mat = opened(MAT);
    for (const file of [TEXT_CASES, BINARY_CASES]) {
      NAMES.forEach((name, i) => {
        const copied = mat.by(name);
        const { node, again } = pastedIntoDictionary(file, copyOf(copied), '00000000-0000-4000-8000-00000000000' + i);
        expect(rowsOf(node), file + ' ' + name).toEqual(rowsOf(copied));
        expect(rowsOf(again), file + ' ' + name + ' (reopened)').toEqual(rowsOf(copied));
      });
    }
  });

  it('copied out of a text and a binary dictionary and pasted into a MAT-file, before a save and after', () => {
    for (const file of DICTIONARIES) {
      const dictionary = opened(file);
      for (const name of NAMES) {
        const copied = dictionary.by(name);
        const t = target(fixture(NONE));
        const res: Any = t.session.pasteEntries('t.mat', [copyOf(copied)]);
        expect(res.error, file + ' ' + name + ': ' + res.reason).toBeUndefined();
        const [node] = res.nodes;
        expect(rowsOf(node), file + ' ' + name).toEqual(rowsOf(copied));
        const again = reopened(t.save()).children.find((c: Any) => c.name === name);
        expect(rowsOf(again), file + ' ' + name + ' (reopened)').toEqual(rowsOf(copied));
      }
    }
  });
});
