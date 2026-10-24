// Copyright 2026 The MathWorks, Inc.
//
// The editors a MAT-file offers of an object's properties that every other source shows
// read-only (MatNode._offeredEditor, _setOffered, _offeredRestorer): a CoderInfo's Identifier and
// storage class, a Signal's Dimensions and SampleTime, a Bus's Alignment, a NumericType's mode and
// scaling, and the rest of matObjectEdit's bag editors.
//
// First the text each kind of editor takes, as it says it takes it: a number, Inf and -Inf among
// them; a row of numbers, in brackets or not, by spaces or commas; true or false, or 1 or 0. Text
// that is none of these is refused naming the property, and the file is as it was. Then, over
// every object of every Level-5 fixture, every edit an offered editor takes: undone, the save is
// the file as it was read, byte for byte; redone, it is the save of the edit again. The restorer
// puts back each key of the property bag the class's editors write, a key that was absent
// absent again, and that is what makes the undo exact.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';

const TEST_ROOT = fileURLToPath(new URL('.', import.meta.url));
const MAT_CHECK = join(TEST_ROOT, 'fixtures', 'mat-check');

function matFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (abs !== MAT_CHECK) {
        out.push(...matFilesUnder(abs));
      }
    } else if (entry.isFile() && entry.name.endsWith('.mat') && entry.name !== 'strings_v73.mat') {
      out.push(abs);
    }
  }
  return out.sort();
}

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const fileBytes = (abs: string) => arrayBufferOf(new Uint8Array(readFileSync(abs)));
const fixture = (rel: string) => fileBytes(join(TEST_ROOT, rel));
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

function opened(bytes: ArrayBuffer) {
  const session = createSession();
  const root: any = session.addMatSource('f.mat', bytes);
  const by = (n: string) => root.children.find((c: any) => c.name === n);
  const edit = (node: any, key: string, text: string) => {
    session.setActive(root, node);
    return session.editProperty(node.id, key, text);
  };
  const save = (): Uint8Array => (session.serializeSource('f.mat') as { bytes: Uint8Array }).bytes;
  return { session, root, by, edit, save };
}

/** What the Property Inspector shows of `key` on `node`, which is where these properties are shown; undefined where it shows none. */
function shownOrNone(node: any, key: string): unknown {
  const prop = (node.getPILayout() ?? []).flatMap((g: any) => g.items).find((p: any) => p.key === key);
  return prop ? node.getPropInfo(prop).displayValue : undefined;
}

function shown(node: any, key: string): unknown {
  const value = shownOrNone(node, key);
  expect(value, node.matlabPath + ' shows ' + key).toBeDefined();
  return value;
}

/** `bytes` with `key` of variable `name` edited to `text`, saved and opened again: what it shows there. */
function savedAs(bytes: ArrayBuffer, name: string, key: string, text: string): unknown {
  const { by, edit, save } = opened(bytes);
  expect(edit(by(name), key, text), name + '.' + key + ' = ' + text).toBe(true);
  const again = opened(arrayBufferOf(save()));
  return shown(again.by(name), key);
}

describe('an offered editor takes text as its kind says, and refuses the rest naming the property', () => {
  const SIG = fixture('fixtures/mcos/Sig.mat');
  const NUMERIC = fixture('fixtures/mcos/Numeric.mat');
  const NESTED = fixture('fixtures/mcos/nested_objects.mat');

  function refused(bytes: ArrayBuffer, name: string, key: string, text: string, reason: string): void {
    const { root, by, edit, save } = opened(bytes);
    const node = by(name);
    const was = shown(node, key);
    expect(edit(node, key, text), name + '.' + key + ' = ' + JSON.stringify(text)).toMatchObject({ error: true, reason, invalidValue: text });
    expect([shown(node, key), root.dirty]).toEqual([was, false]);
    expect(sameBytes(save(), new Uint8Array(bytes))).toBe(true);
  }

  it('a row of numbers: one, Inf among them, or a row in brackets or not, by spaces or commas', () => {
    expect(shown(opened(SIG).by('Sig'), 'sampleTime')).toBe('-1');
    expect(savedAs(SIG, 'Sig', 'sampleTime', '0.5')).toBe('0.5');
    // Inf, in any case, saved as one value.
    expect(savedAs(SIG, 'Sig', 'sampleTime', ' inf ')).toBe(savedAs(SIG, 'Sig', 'sampleTime', 'Inf'));
    const row = savedAs(SIG, 'Sig', 'dimensions', '[2 3]');
    expect(row).toBe('[2 3]');
    for (const text of ['2 3', '2, 3', '[2,3]', ' [ 2  3 ] ']) {
      expect(savedAs(SIG, 'Sig', 'dimensions', text), text).toBe(row);
    }
    for (const text of ['abc', '', '[]', '2 x', '0x10']) {
      refused(SIG, 'Sig', 'sampleTime', text, 'Cannot edit "Sig": Sig.SampleTime must be a number or a row of numbers.');
    }
    // Read as numbers, and then held to MATLAB's rule for the property.
    refused(SIG, 'Sig', 'sampleTime', '-Inf', expect.stringMatching(/^Cannot edit "Sig": Sig\.SampleTime must be -1, 0, a positive double or Inf/));
    refused(SIG, 'Sig', 'dimensions', 'Inf', 'Cannot edit "Sig": Sig.Dimensions must hold positive whole numbers, or be -1: MATLAB refuses Inf.');
  });

  /** Sig's SampleTime typed as Inf: taken, what the tree shows, what the saved file shows reopened, and the refusal of text after it. Asserts nothing. */
  function infSampleTime() {
    const { by, edit, save } = opened(SIG);
    const sig = by('Sig');
    const taken = edit(sig, 'sampleTime', 'Inf');
    const shownNow = shownOrNone(sig, 'sampleTime');
    const reopened = shownOrNone(opened(arrayBufferOf(save())).by('Sig'), 'sampleTime');
    const refusal = edit(sig, 'sampleTime', 'abc') as { error?: boolean; reason?: string; invalidValue?: string; validValue?: string };
    return { taken, shown: shownNow, reopened, refusal };
  }

  it('takes a SampleTime of Inf, shows it as it saves it, and refuses text after it, handing back what it shows', () => {
    const r = infSampleTime();
    expect(r.taken).toBe(true);
    expect(typeof r.shown).toBe('string');
    expect(r.reopened).toBe(r.shown);
    expect(r.refusal).toEqual({
      error: true,
      reason: 'Cannot edit "Sig": Sig.SampleTime must be a number or a row of numbers.',
      invalidValue: 'abc',
      validValue: r.shown,
    });
  });

  // BUG: a property the schema bridge shows (schemaBridge.ts formatSchemaValue, `String(value)`)
  // spells a double Inf as JavaScript does, "Infinity", where MATLAB, the property's own rule
  // ("a positive double or Inf") and every other surface of this package spell it "Inf". So a
  // MAT-file Signal whose SampleTime is Inf, as typed here or as MATLAB saved it, shows
  // "Infinity" in the Property Inspector, before the save and after.
  it.fails('shows a SampleTime of Inf as MATLAB spells it, before and after a save', () => {
    const r = infSampleTime();
    expect({ shown: r.shown, reopened: r.reopened }).toEqual({ shown: 'Inf', reopened: 'Inf' });
  });

  // BUG: and a refused edit of it hands back "Infinity" as the valid value (MatNode offeredText,
  // `String(v)`), which is a second spelling of the same number to fix.
  it.fails('hands a SampleTime of Inf back as MATLAB spells it when an edit of it is refused', () => {
    expect(infSampleTime().refusal.validValue).toBe('Inf');
  });

  it('a number: one, and not a row', () => {
    const bus = opened(NESTED).by('busTop');
    expect(bus.className).toBe('Simulink.Bus');
    expect(shown(bus, 'alignment')).toBe('-1');
    // Brackets make a row, which a number editor does not take, even of one.
    for (const text of ['abc', '[8 16]', '8 16', '[8]', '']) {
      refused(NESTED, 'busTop', 'alignment', text, 'Cannot edit "busTop": busTop.Alignment must be a number.');
    }
    expect([savedAs(NESTED, 'busTop', 'alignment', '8'), savedAs(NESTED, 'busTop', 'alignment', ' 16 ')]).toEqual(['8', '16']);
  });

  it('true or false: as words or as 1 and 0', () => {
    const no = shown(opened(NUMERIC).by('Numeric'), 'isAlias');
    expect([no, savedAs(NUMERIC, 'Numeric', 'isAlias', 'true'), savedAs(NUMERIC, 'Numeric', 'isAlias', ' 1 ')]).toEqual(['false', 'true', 'true']);
    for (const text of ['maybe', 'yes', '2', '']) {
      refused(NUMERIC, 'Numeric', 'isAlias', text, 'Cannot edit "Numeric": Numeric.IsAlias must be true or false.');
    }
    // Set back, the save writes it as it was read.
    const { by, edit, save } = opened(NUMERIC);
    expect([edit(by('Numeric'), 'isAlias', '1'), edit(by('Numeric'), 'isAlias', '0')]).toEqual([true, true]);
    expect(shown(opened(arrayBufferOf(save())).by('Numeric'), 'isAlias')).toBe(no);
  });
});

// The keys an offered editor is asked of: matObjectEdit's bag editors, and the CoderInfo columns
// of a Parameter and a Signal.
const KEYS = [
  'identifier', 'storageClass', 'alignment', 'dimensions', 'initialValue', 'sampleTime', 'samplingMode', 'dataScope', 'headerFile',
  'preserveElementDimensions', 'dataTypeMode', 'signedness', 'wordLength', 'fractionLength', 'slope', 'bias', 'dataTypeOverride', 'isAlias',
];

/** A value for an editor of `editor` other than `now`, by what the editor offers; the first the edit takes is used. */
function candidates(editor: { editor: string; options?: string[] }, key: string, now: string): string[] {
  if (editor.editor === 'select') {
    return (editor.options ?? []).filter((o) => o !== now);
  }
  return key === 'identifier' || key === 'headerFile' || key === 'initialValue' ? ['zz', 'zz.h'] : ['2', '8', '[2 3]', '0.5'];
}

describe('every edit an offered editor takes, undone and redone', () => {
  it('saves as the file was read, and then as the edit again, over every object of every fixture', { timeout: 120_000 }, () => {
    let offered = 0;
    let taken = 0;
    for (const file of matFilesUnder(TEST_ROOT)) {
      const bytes = fileBytes(file);
      const probe = opened(bytes).root;
      const nodes: any[] = probe.flatten();
      // Which (node, key) each fixture offers an editor of, asked once of a tree of its own.
      const pairs: [number, string][] = [];
      nodes.forEach((n, i) => {
        const entry = probe._entryOf(n);
        for (const key of entry ? KEYS : []) {
          if (probe._offeredEditor(entry, n, key)) {
            pairs.push([i, key]);
          }
        }
      });
      for (const [i, key] of pairs) {
        offered++;
        const { session, root, edit, save } = opened(bytes);
        const node = root.flatten()[i];
        const label = file.slice(TEST_ROOT.length) + ': ' + node.matlabPath + '.' + key;
        const editor = root._offeredEditor(root._entryOf(node), node, key);
        const now = String(shownOrNone(node, key) ?? '');
        if (!candidates(editor, key, now).some((text) => edit(node, key, text) === true)) {
          continue;
        }
        taken++;
        const first = save();
        session.undo();
        expect(sameBytes(save(), new Uint8Array(bytes)), label + ': undone').toBe(true);
        session.redo();
        expect(sameBytes(save(), first), label + ': redone').toBe(true);
      }
    }
    // What the sweep met: the fixtures' objects offer that many editors, and most take an edit.
    expect(offered).toBeGreaterThanOrEqual(2000);
    expect(taken).toBeGreaterThanOrEqual(1500);
  });
});
