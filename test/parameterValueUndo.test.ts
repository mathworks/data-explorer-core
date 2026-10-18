// Copyright 2026 The MathWorks, Inc.
//
// The session's undo of an edit of a Simulink.Parameter's Value puts back the value the edit
// replaced, not the text that value showed (F1-16).
//
// DataModel.editProperty undoes an edit by setting the property back to the text it showed
// (readPropertyValue), unless the node puts the value back itself (_restorerFor). An entry's
// own MATLAB value did since 07a50ed, and a Parameter did not. For a Parameter's Value the
// text is often not the value. A complex array shows `[1+2i 3+4i 5+6i]`, which
// MatlabValueParser does not read, so the undo was refused and dropped: MATLAB's pRow, set to
// 5 and undone, still showed 5, and the save wrote `<P Name="Value" Class="double">5.0</P>`.
// An int8, single or uint8 Value shows its numbers, which read back as a double; a uint64 one
// reads back as the nearest double; a struct shows `<1x1 struct>` and an N-D array
// `<2x2x2 int16>`, which do not read back at all; and a 1x0 complex empty shows `[ ]`, which
// reads back as a 0x0 double. Each was written so by the save after the undo.
//
// The binary dictionaries are MATLAB's (mcos/complex_binary.sldd, mcos/typed_mcos_binary.sldd,
// display/dispcat_bin.sldd), and so are their text twins. A text dictionary holds a complex
// or N-D Value as its MAT stream, which is shown and not edited (C-012), so those take no edit.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { regenerateEntryXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { parseComplexNum } from '../src/datamodel/parser/XmlUtils.js';
import ParameterNode from '../src/datamodel/node/data/ParameterNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const fixture = (name: string): ArrayBuffer => {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
};

const COMPLEX_BINARY = 'mcos/complex_binary.sldd';

function open(file: string, session = createSession()): any {
  return ingest(session, fixture(file), { filename: file.split('/').pop()! });
}

function entryOf(root: any, name: string): any {
  const entry = root.getSection('design').children.find((e: any) => e.name === name);
  expect(entry, name).toBeDefined();
  return entry;
}

/**
 * The entry as the writer writes it from the model, but its LastMod, which every edit stamps
 * and an undo leaves stamped (D2). Not as a save writes it: a save writes an unedited entry as
 * the bytes it was read from, which would compare the file's bytes before the edit with the
 * writer's after it (MATLAB's `1.0NaNi`, which the writer signs, `1.0+NaNi`). A text
 * dictionary's entry is its value's JSON.
 */
function written(root: any, entry: any): string {
  if (root.sourceFormat !== 'xml') {
    return JSON.stringify(entry.serialize().value);
  }
  return regenerateEntryXml(entry)
    .split('\n')
    .filter((line) => !line.includes('<P Name="LastMod"'))
    .join('\n');
}

/**
 * The Parameter's Value element, as the writer writes it from the model: the last of the
 * entry's, the first being the entry's own, which holds the Parameter.
 */
function valueTag(entry: any): string {
  const lines = regenerateEntryXml(entry)
    .split('\n')
    .filter((line) => line.includes('<P Name="Value"'));
  return lines[lines.length - 1].trim();
}

/** What a session shows of a Parameter's Value: its text, its class, its size and its row. */
function shown(entry: any): unknown[] {
  const value = entry._valueNode;
  return [entry.displayValue, value?.className ?? null, value?.dims ?? null, entry.children.map((c: any) => c.name)];
}

/** One element's two parts, exactly: NaN is NaN. */
function parts(text: string): [number, number] {
  const pair = parseComplexNum(text);
  expect(pair, text).not.toBeNull();
  return [Number(pair!.re), Number(pair!.im)];
}

/** A complex array's elements as numbers, in its rows' order, and its class. */
function numbersOf(node: any): { className: string; elements: [number, number][] } {
  expect(node.children.length, node.id).toBeGreaterThan(0);
  return { className: node.className, elements: node.children.map((el: any) => parts(el.displayValue)) };
}

/** What a save writes, opened again in a session of its own. */
function saveAndReopen(session: any, root: any): any {
  const saved = session.serializeSource(root.name);
  const bytes: Uint8Array = saved.kind === 'binary' ? saved.bytes : new TextEncoder().encode(saved.text);
  return ingest(createSession(), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
    filename: root.name,
  });
}

/** Edit the entry's Value to `text` through the session, as a host does. */
function edit(session: any, root: any, entry: any, text: string): unknown {
  session.setActive(root, entry);
  return session.editProperty(entry.id, 'Value', text);
}

// MATLAB's complex arrays, as complex_binary.sldd holds them: a row, a row with Inf and NaN
// parts, a row with one NaN element, a column and a matrix.
const COMPLEX_ARRAYS: [name: string, text: string, tag: string][] = [
  ['pRow', '[1+2i 3+4i 5+6i]', '<P Name="Value" Class="double" IsComplex="1" Dimension="1*3">1.0+2.0i 3.0+4.0i 5.0+6.0i</P>'],
  [
    'pNonFinite',
    '[Inf-Infi NaN+1i 1NaNi -Inf+2i]',
    '<P Name="Value" Class="double" IsComplex="1" Dimension="1*4">Inf-Infi NaN+1.0i 1.0+NaNi -Inf+2.0i</P>',
  ],
  ['pMixedNF', '[1+2i NaN+0i 3-4i]', '<P Name="Value" Class="double" IsComplex="1" Dimension="1*3">1.0+2.0i NaN+0.0i 3.0-4.0i</P>'],
  ['pCol', '[1+2i; 3+4i; 5+6i]', '<P Name="Value" Class="double" IsComplex="1" Dimension="3*1">1.0+2.0i 3.0+4.0i 5.0+6.0i</P>'],
  ['pMat', '[1+2i 3+4i; 5+6i 7+8i]', '<P Name="Value" Class="double" IsComplex="1" Dimension="2*2">1.0+2.0i 5.0+6.0i 3.0+4.0i 7.0+8.0i</P>'],
];

describe("undoing an edit of a Parameter's complex array Value restores it, in a binary dictionary", () => {
  for (const [name, text, tag] of COMPLEX_ARRAYS) {
    it(name, () => {
      const session = createSession();
      const root = open(COMPLEX_BINARY, session);
      const entry = entryOf(root, name);
      const before = { written: written(root, entry), shown: shown(entry), numbers: numbersOf(entry.children[0]) };
      expect([entry.displayValue, valueTag(entry)]).toEqual([text, tag]);

      expect(edit(session, root, entry, '5'), name).toBe(true);
      expect([entry.displayValue, valueTag(entry)]).toEqual(['5', '<P Name="Value" Class="double">5.0</P>']);

      session.undo();
      expect(shown(entry), `${name}, undone`).toEqual(before.shown);
      expect(written(root, entry), `${name}, undone`).toBe(before.written);
      expect(numbersOf(entry.children[0]), `${name}, undone`).toEqual(before.numbers);
      expect(entry.children[0].parent, `${name}, undone`).toBe(entry);
      // An undone edit leaves the entry Modified and stamped, as every edit does (D2).
      expect(entry.status, `${name}, undone`).toBe('Modified');

      session.redo();
      expect([entry.displayValue, valueTag(entry)], `${name}, redone`).toEqual(['5', '<P Name="Value" Class="double">5.0</P>']);

      session.undo();
      expect(shown(entry), `${name}, undone again`).toEqual(before.shown);
      expect(written(root, entry), `${name}, undone again`).toBe(before.written);
    });
  }

  it('and the file saved after every edit is undone opens with the values an untouched save does', () => {
    const fresh = createSession();
    const untouched = saveAndReopen(fresh, open(COMPLEX_BINARY, fresh));
    const session = createSession();
    const root = open(COMPLEX_BINARY, session);
    for (const [name] of COMPLEX_ARRAYS) {
      expect(edit(session, root, entryOf(root, name), '5'), name).toBe(true);
    }
    for (let i = 0; i < COMPLEX_ARRAYS.length; i++) {
      session.undo();
    }
    const reopened = saveAndReopen(session, root);
    for (const [name, text] of COMPLEX_ARRAYS) {
      const entry = entryOf(reopened, name);
      expect(entry.displayValue, name).toBe(text);
      expect(numbersOf(entry.children[0]), name).toEqual(numbersOf(entryOf(untouched, name).children[0]));
    }
  });

  it('as it already did for a complex scalar, whose text is its value', () => {
    const session = createSession();
    const root = open(COMPLEX_BINARY, session);
    const entry = entryOf(root, 'pScalar');
    const before = written(root, entry);
    expect(edit(session, root, entry, '5')).toBe(true);
    session.undo();
    expect(entry.displayValue).toBe('3+4i');
    expect(written(root, entry)).toBe(before);
  });
});

// Values whose text reads back as another value, or not at all: each, edited and undone, is
// written as it was before the edit, and shows what it showed.
const NOT_THEIR_TEXT: [file: string, name: string, what: string][] = [
  [COMPLEX_BINARY, 'pInt16Row', 'an int16 complex row'],
  [COMPLEX_BINARY, 'pSingleCol', 'a single complex column'],
  [COMPLEX_BINARY, 'pInt8', 'an int8 complex scalar, which read back as a double'],
  [COMPLEX_BINARY, 'pInt64', 'an int64 complex scalar, which read back as the nearest double'],
  [COMPLEX_BINARY, 'pThird', "a double whose 17 digits read back as the shortest text's"],
  [COMPLEX_BINARY, 'pNd', 'an N-D complex array, shown as its size and class'],
  [COMPLEX_BINARY, 'pStruct', 'a struct, shown as its size and class'],
  ['mcos/typed_mcos_binary.sldd', 'pInt8', 'an int8 scalar, which read back as a double'],
  ['mcos/typed_mcos_binary.sldd', 'pSingleRow', 'a single row'],
  ['mcos/typed_mcos_binary.sldd', 'pUint8Mat', 'a uint8 matrix'],
  ['mcos/typed_mcos_binary.sldd', 'pUint64Max', 'the largest uint64, which read back as the nearest double'],
  ['mcos/typed_mcos_binary.sldd', 'pInt16Nd', 'an N-D int16 array'],
  ['mcos/typed_mcos.sldd', 'pInt8', 'an int8 scalar, in a text dictionary'],
  ['mcos/typed_mcos.sldd', 'pSingleRow', 'a single row, in a text dictionary'],
  ['mcos/typed_mcos.sldd', 'pInt32Col', 'an int32 column, in a text dictionary'],
  ['mcos/typed_mcos.sldd', 'pUint64Max', 'the largest uint64, in a text dictionary'],
  ['mcos/complex.sldd', 'pStruct', 'a struct, in a text dictionary'],
  // The Parameter twin of undoRestoresValue.test.ts's empties: a 1x0 complex empty shows
  // `[ ]`, which read back as a 0x0 double, and was written `Class="double" Dimension="0*0"`.
  ['display/dispcat_bin.sldd', 'dx_param_complex_1x0', 'a 1x0 complex empty'],
  // A Parameter whose Value is MATLAB's default, which a text dictionary does not write: set
  // back from its `[ ]`, it was written as `"Value": []`.
  ['display/dispcat_text.sldd', 'dx_param_empty', 'a default Value the file does not hold, in a text dictionary'],
];

describe("undoing an edit of a Parameter's Value whose text is not its value restores it", () => {
  for (const [file, name, what] of NOT_THEIR_TEXT) {
    it(`${file}: ${name}, ${what}`, () => {
      const session = createSession();
      const root = open(file, session);
      const entry = entryOf(root, name);
      const before = { written: written(root, entry), shown: shown(entry) };
      expect(edit(session, root, entry, '5'), name).toBe(true);
      expect(entry.displayValue, name).toBe('5');
      session.undo();
      expect(shown(entry), `${name}, undone`).toEqual(before.shown);
      expect(written(root, entry), `${name}, undone`).toBe(before.written);
      session.redo();
      expect(entry.displayValue, `${name}, redone`).toBe('5');
      session.undo();
      expect(written(root, entry), `${name}, undone again`).toBe(before.written);
      // And the file saved now opens with the value an untouched save opens with.
      const fresh = createSession();
      const untouched = entryOf(saveAndReopen(fresh, open(file, fresh)), name);
      const reopened = entryOf(saveAndReopen(session, root), name);
      expect(shown(reopened), `${name}, saved and reopened`).toEqual(shown(untouched));
    });
  }

  it('and every Parameter of these dictionaries, edited and undone, is written as it was', () => {
    for (const file of new Set(NOT_THEIR_TEXT.map(([f]) => f))) {
      const session = createSession();
      const root = open(file, session);
      for (const entry of root.getSection('design').children) {
        if (!(entry instanceof ParameterNode)) {
          continue;
        }
        const before = written(root, entry);
        if (edit(session, root, entry, '5') !== true) {
          continue;
        }
        session.undo();
        expect(written(root, entry), `${file}: ${entry.name}`).toBe(before);
      }
    }
  });
});
