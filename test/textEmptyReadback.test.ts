// Copyright 2026 The MathWorks, Inc.
//
// A binary dictionary's classed or shaped empty, pasted into a text dictionary, is written in the
// spelling MATLAB reads back there with its class and its size, at every place a value stands:
// an entry, a cell's element, a struct field, a Simulink.Parameter's Value and an object's
// property. Graded against what MATLAB said, not against what this package expects of itself.
//
// test/parity/matlab/probe_text_empty_readback.m asked MATLAB R2027a (the 1A-TEXT, CELL-EMPTIES-87
// and D8 measurements of 2026-10-18) two things, and wrote the answers to
// text_empty_readback.truth.json:
//   - `self`: what MATLAB writes there for each empty itself, and reads back of its own text and
//     its own binary file. The binary file is test/fixtures/text_empty_readback_binary.sldd, and
//     `binaryReads` is each value as MATLAB holds it: its binary writer keeps every class and size.
//     Its text writer keeps none of the sizes: `{"_type": "int8", "_value": "[]"}` for an int8
//     0x3, `[]` for a double 0x2, `""` for a char 0x2.
//   - `candidates`: what MATLAB reads back of each candidate spelling, hand-patched into a text
//     dictionary it made, at each place.
// A spelling this writes that MATLAB was not asked about fails here, so a change to the writer
// means asking MATLAB again.
//
// The rule MATLAB's answers give (MatWriter.heldTextSpelling):
//   - a numeric, logical or enumeration empty: `{"_type": cls, "_value": "Matrix(r,c)"}`, and its
//     0x0 MATLAB's own spelling, `[]` for a double and `{"_type": cls, "_value": "[]"}` otherwise;
//   - a char: the shaped char's literal, `{"_type": "mxchar", "_value": "Matrix(0,2)\n[]"}`, and
//     its 0x0 `""` (a Parameter's Value turns any char into a string, so there it is moot);
//   - an object array's empty, which MATLAB reads back right in no spelling, its own included:
//     what MATLAB writes, `[]` at an object's property or a Parameter's Value and
//     `{"_type": cls, "_value": "[]"}` in a cell or a struct field. MATLAB reads its own file back
//     as a char 0x0 in a cell, a default 1x1 Simulink.Parameter, or with the field gone, and this
//     reads it back with its class (at 0x0).
//   - an N-D one: as it was (a char's `""`, MATLAB's own spelling of one).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8 } from 'fflate';
import { createSession, ingest } from '../src/index.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Reads = { class: string; size: number[] } | { error: string } | [];
type SelfRow = { id: string; expr: string; place: Place; text: string; refused: string; textReads: Reads; binaryReads: Reads };
type Candidate = { spelling: string; place: Place; reads: Reads };
type Place = 'entry' | 'cell' | 'field' | 'param' | 'prop';

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const TRUTH: { version: string; release: string; self: SelfRow[]; candidates: Candidate[] } = JSON.parse(
  readFileSync(at('./parity/matlab/text_empty_readback.truth.json'), 'utf8'),
);
const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const bytesAt = (rel: string) => new Uint8Array(readFileSync(at(rel)));

const PREFIX: Record<Place, string> = { entry: 'e_', cell: 'c_', field: 's_', param: 'p_', prop: 'w_' };
const OBJECT_CLASSES = new Set(['WidgetPart', 'Simulink.Parameter']);
const isReads = (r: Reads): r is { class: string; size: number[] } => !!r && !Array.isArray(r) && 'class' in r;
/** One spelling, as JSON compares it: MATLAB's own text has its layout, a candidate none. */
const canonical = (json: string) => JSON.stringify(JSON.parse(json));

/** The value at `place` of an entry's value, as the text dictionary holds it. */
function valueAt(value: any, place: Place): unknown {
  switch (place) {
    case 'entry':
      return value;
    case 'cell':
      return value._elements[0];
    case 'field':
      return value._elements[0].f;
    case 'param':
    case 'prop':
      return value._elements[0]._properties[place === 'param' ? 'Value' : 'Scalar'];
  }
}

/** What MATLAB read back of `spelling` at `place`: a candidate's, or its own spelling's; undefined if it was never asked. */
function matlabRead(spelling: string, place: Place): Reads | undefined {
  const candidate = TRUTH.candidates.find((c) => c.place === place && canonical(c.spelling) === spelling);
  if (candidate) {
    return candidate.reads;
  }
  return TRUTH.self.find((s) => s.place === place && s.text !== '' && !s.text.startsWith('?') && canonical(s.text) === spelling)?.textReads;
}

/** Every value MATLAB put in its binary dictionary, pasted into a text dictionary, saved and reopened. */
function pasteAll() {
  const session = createSession();
  const bin: any = ingest(session, buffer(bytesAt('./fixtures/text_empty_readback_binary.sldd')), { filename: 'text_empty_readback_binary.sldd' });
  const txt: any = ingest(session, buffer(bytesAt('./fixtures/custom_object_text.sldd')), { filename: 'custom_object_text.sldd' });
  let k = 0;
  for (const name of ['design', 'other']) {
    const into = txt.getSection(name);
    for (const e of bin.getSection(name).children) {
      const payload: any = JSON.parse(JSON.stringify(e.serialize()));
      payload.metadata = { ...into.children[0].metadata, uuid: '00000000-0000-4000-f000-' + String(++k).padStart(12, '0') };
      into.parseEntry(payload);
    }
  }
  const text = session.serializeSource(txt.name)!.text!;
  const saved = new Map<string, unknown>();
  for (const e of JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries) {
    saved.set(e.name, e.value);
  }
  const reopened: any = ingest(createSession(), buffer(strToU8(text)), { filename: 'reopened_text.sldd' });
  return { saved, reopened };
}

/** The node at `place` of entry `name` in a reopened dictionary. */
function nodeAt(root: any, name: string, place: Place): any {
  const entry = root.children.flatMap((s: any) => s.children).find((e: any) => e.name === name);
  const child = (n: any, c: string) => n.children.find((x: any) => x.name === c);
  switch (place) {
    case 'entry':
      return entry;
    case 'cell':
      return entry.children[0];
    case 'field':
      return child(entry, 'f');
    case 'param':
      // A Parameter holds a Value of `[]`, its default, with no node of its own.
      return entry._valueNode ?? (Array.isArray(entry.Value) && entry.Value.length === 0 ? { className: 'double', dims: [0, 0] } : null);
    case 'prop':
      return child(entry, 'Scalar');
  }
}

describe('a text dictionary is given the spelling MATLAB reads back for an empty', () => {
  const rows = TRUTH.self.filter((s) => isReads(s.binaryReads));
  const { saved, reopened } = pasteAll();
  const spelled = (s: SelfRow) => {
    const value = saved.get(PREFIX[s.place] + s.id);
    expect(value, s.id + ' at ' + s.place + ' was pasted').toBeDefined();
    return JSON.stringify(valueAt(value, s.place));
  };

  it('the truth is MATLAB\'s, and holds every value at every place it accepts', () => {
    expect(TRUTH.release).toBe('2027a');
    expect(rows.length).toBe(82);
    expect(TRUTH.candidates.length).toBe(105);
  });

  it('each spelling written is one MATLAB was asked about at that place', () => {
    const unasked = rows.filter((s) => matlabRead(spelled(s), s.place) === undefined).map((s) => `${s.id} at ${s.place}: ${spelled(s)}`);
    expect(unasked).toEqual([]);
  });

  it('a numeric, logical, enumeration or char empty reads back in MATLAB with its class and size', () => {
    const lost: string[] = [];
    for (const s of rows) {
      const original = s.binaryReads as { class: string; size: number[] };
      // An object array's empty has no spelling MATLAB reads back (the next case); a char at a
      // Parameter's Value is a string in MATLAB, whatever its spelling; an N-D one is as it was.
      if (OBJECT_CLASSES.has(original.class) || (s.place === 'param' && original.class === 'char') || original.size.length > 2) {
        continue;
      }
      const reads = matlabRead(spelled(s), s.place);
      if (!reads || !isReads(reads) || reads.class !== original.class || JSON.stringify(reads.size) !== JSON.stringify(original.size)) {
        lost.push(`${s.id} at ${s.place}: ${spelled(s)} reads ${JSON.stringify(reads)}, was ${JSON.stringify(original)}`);
      }
    }
    expect(lost).toEqual([]);
  });

  it('an object array\'s empty, which MATLAB reads back right in no spelling, is spelled as MATLAB spells it', () => {
    const objects = rows.filter((s) => OBJECT_CLASSES.has((s.binaryReads as { class: string }).class));
    expect(objects.map((s) => s.id + ' ' + s.place)).toEqual(
      ['Parts0', 'Parts10', 'Params0', 'Params00'].flatMap((id) => ['cell', 'field', 'prop'].map((p) => id + ' ' + p)),
    );
    for (const s of objects) {
      expect(spelled(s), `${s.id} at ${s.place}`).toBe(canonical(s.text));
    }
  });

  it('and reopens here with the class and size MATLAB holds, an object array\'s empty with its class where its spelling states one', () => {
    const wrong: string[] = [];
    for (const s of rows) {
      const original = s.binaryReads as { class: string; size: number[] };
      if ((s.place === 'param' && original.class === 'char') || original.size.length > 2) {
        continue;
      }
      const node = nodeAt(reopened, PREFIX[s.place] + s.id, s.place);
      const object = OBJECT_CLASSES.has(original.class);
      // `[]` states no class, so it is the double 0x0 here that it is in MATLAB.
      const expected = object
        ? s.place === 'prop'
          ? ['double', [0, 0]]
          : [original.class, [0, 0]]
        : [original.class, original.size];
      const got = [node?.className, node?.dims];
      if (JSON.stringify(got) !== JSON.stringify(expected)) {
        wrong.push(`${s.id} at ${s.place}: ${JSON.stringify(got)}, MATLAB ${JSON.stringify(expected)}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
