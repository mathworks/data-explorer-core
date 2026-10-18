// Copyright 2026 The MathWorks, Inc.
//
// An empty string, an empty function handle and an N-D empty, pasted into a text dictionary, are
// written in a spelling MATLAB reads back there with their class and size, at every place a value
// stands; and where MATLAB reads back no spelling of one with its class and size, the save is
// refused rather than written as another value (agenda follow-up 4 of group F's reviews, ruled by
// group G on 2026-10-18: "a save the writer cannot spell is refused rather than written wrong").
// Graded against what MATLAB said, not against what this package expects of itself.
//
// test/parity/matlab/probe_lossy_empties_readback.m asked MATLAB R2027a, and wrote the answers to
// lossy_empties_readback.truth.json:
//   - `self`: what MATLAB writes there for each value itself, and reads back of its own text and
//     its own binary file. The binary file is test/fixtures/lossy_empties_readback_binary.sldd,
//     and `binaryReads` is each value as MATLAB holds it: its binary writer keeps every class and
//     size, an extent past an int32 too. Its text writer keeps no N-D size (`[]`,
//     `{"_type": "int8", "_value": "[]"}`, `""`), and refuses a function handle everywhere but an
//     object's property, where it reads its own spelling back as a 1x1 handle.
//   - `candidates`: what MATLAB reads back of each candidate spelling, hand-patched into a text
//     dictionary it made, at each place: the String bag reads back as the string it is at every
//     place, and a MAT stream as the N-D empty it is; the forms a host hands in, and the bare
//     `Matrix(…)` header of an N-D one, read back as other values.
// The rule the answers give, which this grades: a value is written in a spelling MATLAB read back
// with its class and size at that place, and refused where MATLAB read back none. A spelling this
// writes that MATLAB was not asked about fails here, so a change to the writer means asking MATLAB
// again.
//
// The two routes in: a binary dictionary's value copied out of it (MATLAB's own binary file), and
// a host's `{_type, _emptyDims}`, the form an entry's empty took before the binary reader held it
// under its header, which a host still hands in.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession, ingest, MatBudgetError } from '../src/index.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Reads = { class: string; size: number[] } | { error: string } | [];
type Place = 'entry' | 'cell' | 'field' | 'param' | 'prop';
type SelfRow = { id: string; expr: string; place: Place; text: string; refused: string; textReads: Reads; binaryReads: Reads; binarySaveError: string };
type Candidate = { id: string; spelling: string; place: Place; reads: Reads };
type Held = { class: string; size: number[] };

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const TRUTH: { version: string; release: string; self: SelfRow[]; candidates: Candidate[] } = JSON.parse(
  readFileSync(at('./parity/matlab/lossy_empties_readback.truth.json'), 'utf8'),
);
const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const bytesAt = (rel: string) => new Uint8Array(readFileSync(at(rel)));
const TEXT_HOST = './fixtures/custom_object_text.sldd';
const BINARY = './fixtures/lossy_empties_readback_binary.sldd';
const entriesOf = (text: string): any[] => JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;

const PREFIX: Record<Place, string> = { entry: 'e_', cell: 'c_', field: 's_', param: 'p_', prop: 'w_' };
const PATH: Record<Place, string> = { entry: '', cell: '{1}', field: '.f', param: '.Value', prop: '.Scalar' };
const isReads = (r: Reads | undefined): r is Held => !!r && !Array.isArray(r) && 'class' in r;
const same = (r: Reads | undefined, want: Held) => isReads(r) && r.class === want.class && JSON.stringify(r.size) === JSON.stringify(want.size);
/** One spelling, as JSON compares it: MATLAB's own text has its layout, a candidate none. */
const canonical = (json: string) => JSON.stringify(JSON.parse(json));
const ownText = (s: SelfRow) => s.text !== '' && !s.text.startsWith('?');

/** What MATLAB read back of `spelling` at `place`: a candidate's, or its own spelling's; undefined if it was never asked. */
function matlabRead(spelling: string, place: Place): Reads | undefined {
  const candidate = TRUTH.candidates.find((c) => c.place === place && canonical(c.spelling) === spelling);
  if (candidate) {
    return candidate.reads;
  }
  return TRUTH.self.find((s) => s.place === place && ownText(s) && canonical(s.text) === spelling)?.textReads;
}

/** Every spelling MATLAB was asked about at `place` that it read back as `want`: its own, and each candidate's. */
function spellingsKeeping(want: Held, place: Place): string[] {
  return [
    ...TRUTH.self.filter((s) => s.place === place && ownText(s) && same(s.textReads, want)).map((s) => canonical(s.text)),
    ...TRUTH.candidates.filter((c) => c.place === place && same(c.reads, want)).map((c) => canonical(c.spelling)),
  ];
}

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

/** The node at `place` of `entry`, reopened. */
function nodeAt(entry: any, place: Place): any {
  const child = (n: any, c: string) => n?.children?.find((x: any) => x.name === c);
  switch (place) {
    case 'entry':
      return entry;
    case 'cell':
      return entry?.children?.[0];
    case 'field':
      return child(entry, 'f');
    case 'param':
      return entry?._valueNode ?? child(entry, 'Value');
    case 'prop':
      return child(entry, 'Scalar');
  }
}

type Outcome = { written: string; reopened: unknown[] } | { refused: string; message: string };

/**
 * `payload` pasted alone into a fresh text dictionary's section `section`, saved and reopened; or
 * the refusal, of the save or of the paste itself (an N-D string's, SectionNode.parseEntry).
 */
function pasteInto(section: 'design' | 'other', payload: any, place: Place): Outcome {
  const session = createSession();
  const txt: any = ingest(session, buffer(bytesAt(TEXT_HOST)), { filename: 'custom_object_text.sldd' });
  const into = txt.getSection(section);
  let text: string;
  try {
    into.parseEntry({ ...payload, metadata: { ...into.children[0].metadata, uuid: '00000000-0000-4000-a900-000000000001' } });
    text = session.serializeSource(txt.name)!.text!;
  } catch (e) {
    return { refused: (e as Error).name, message: (e as Error).message };
  }
  const value = entriesOf(text).find((e) => e.name === payload.name).value;
  const again: any = ingest(createSession(), buffer(strToU8(text)), { filename: 'reopened_text.sldd' });
  const entry = again.children.flatMap((s: any) => s.children).find((e: any) => e.name === payload.name);
  const node = nodeAt(entry, place);
  return { written: JSON.stringify(valueAt(value, place)), reopened: [node?.className, node?.dims] };
}

/**
 * What is wrong with `outcome` for a value MATLAB holds as `want` at `place` of entry `name`: it
 * is written in a spelling MATLAB read back as `want` and reopens here as `want`, where MATLAB read
 * back such a spelling; it is refused, naming the entry and the path, where MATLAB read back none.
 */
function graded(name: string, place: Place, want: Held, outcome: Outcome): string | null {
  const keeping = spellingsKeeping(want, place);
  const label = `${name} at ${place} (${want.class} ${want.size.join('x')})`;
  if ('refused' in outcome) {
    if (keeping.length > 0) {
      return `${label}: refused (${outcome.message}), where MATLAB reads back ${keeping[0]}`;
    }
    const opens = `Cannot write "${name}": ${name}${PATH[place]} is `;
    return /^Mat(?:Budget|Write)Error$/.test(outcome.refused) && outcome.message.startsWith(opens) && outcome.message.endsWith(' Nothing was written.')
      ? null
      : `${label}: refused as ${outcome.refused}: ${outcome.message}`;
  }
  if (keeping.length === 0) {
    return `${label}: written ${outcome.written.slice(0, 80)}, which MATLAB reads back as ${JSON.stringify(matlabRead(outcome.written, place) ?? 'never asked')}; MATLAB reads back no spelling of it`;
  }
  if (!keeping.includes(outcome.written)) {
    return `${label}: written ${outcome.written.slice(0, 80)}, which MATLAB reads back as ${JSON.stringify(matlabRead(outcome.written, place) ?? 'never asked')}`;
  }
  if (JSON.stringify(outcome.reopened) !== JSON.stringify([want.class, want.size])) {
    return `${label}: reopens here as ${JSON.stringify(outcome.reopened)}`;
  }
  return null;
}

describe('an empty string, an empty function handle or an N-D empty pasted into a text dictionary', () => {
  it("the truth is MATLAB's, and its binary file holds every value it saves there", () => {
    expect(TRUTH.release).toBe('2027a');
    expect(TRUTH.self.length).toBe(85);
    expect(TRUTH.candidates.length).toBe(85);
    // MATLAB saves no N-D string in a binary dictionary, and a function handle is kept out of it.
    const ids = [...new Set(TRUTH.self.map((s) => s.id))];
    const absent = ids.filter((id) => TRUTH.self.every((s) => s.id !== id || !isReads(s.binaryReads)));
    expect(absent).toEqual(['Str022', 'Fh00', 'Fh10']);
  });

  it("copied out of a binary dictionary, is written as MATLAB reads it back with its class and size, or refused where MATLAB reads back none", () => {
    const bin: any = ingest(createSession(), buffer(bytesAt(BINARY)), { filename: 'lossy_empties_readback_binary.sldd' });
    const entries = new Map<string, any>();
    for (const section of ['design', 'other'] as const) {
      for (const e of bin.getSection(section).children) {
        entries.set(e.name, [section, e]);
      }
    }
    const rows = TRUTH.self.filter(
      // A Parameter's Value turns any char into a string in MATLAB, whatever its spelling; EnND, a
      // non-empty N-D enumeration, is the probe's control for the bag MATLAB writes for one
      // (MatWriter.enumTextForm), which nothing here changes.
      (s) => isReads(s.binaryReads) && !(s.place === 'param' && s.id.startsWith('Ch')) && s.id !== 'EnND',
    );
    expect(rows.length).toBe(56);
    const wrong: string[] = [];
    for (const s of rows) {
      const name = PREFIX[s.place] + s.id;
      const [section, entry] = entries.get(name);
      const payload = JSON.parse(JSON.stringify(entry.serialize()));
      const problem = graded(name, s.place, s.binaryReads as Held, pasteInto(section, payload, s.place));
      if (problem) {
        wrong.push(problem);
      }
    }
    expect(wrong).toEqual([]);
  });

  // The host's forms, at each place: as an entry, a struct field, a cell's element, and Widget's
  // Scalar, which MATLAB holds in Other Data.
  const widget = entriesOf(strFromU8(bytesAt(TEXT_HOST))).find((e) => e.name === 'widget');
  const wrapped = (place: Place, v: unknown): unknown => {
    switch (place) {
      case 'cell':
        return { _array_type: 'Cell', _dimensions: [1, 1], _elements: [v], _mw_element_type: 'MATLABArray' };
      case 'field':
        return { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ f: v }], _fields: ['f'], _mw_element_type: 'MATLABArray' };
      case 'prop': {
        const w = JSON.parse(JSON.stringify(widget.value));
        w._elements[0]._properties.Scalar = v;
        return w;
      }
      default:
        return v;
    }
  };
  const HOST: { _type: string; _emptyDims: number[] }[] = [
    { _type: 'string', _emptyDims: [0, 3] },
    { _type: 'string', _emptyDims: [0, 0] },
    { _type: 'string', _emptyDims: [1, 0] },
    { _type: 'function_handle', _emptyDims: [1, 0] },
    { _type: 'function_handle', _emptyDims: [0, 0] },
    // An N-D one was a MAT stream at every place before, and refused past an int32; so it stays.
    { _type: 'double', _emptyDims: [0, 2, 2] },
    { _type: 'logical', _emptyDims: [0, 1, 2] },
    { _type: 'char', _emptyDims: [0, 0, 2] },
    { _type: 'double', _emptyDims: [0, 2, 2147483648] },
    // A function handle's at every rank.
    { _type: 'function_handle', _emptyDims: [0, 0, 2] },
  ];
  const HOST_PLACES: Place[] = ['entry', 'cell', 'field', 'prop'];

  it("a host's `{_type, _emptyDims}` is written as MATLAB reads it back with its class and size, or refused where MATLAB reads back none", () => {
    const wrong: string[] = [];
    for (const v of HOST) {
      for (const place of HOST_PLACES) {
        const name = 'h_' + place;
        const outcome = pasteInto(place === 'prop' ? 'other' : 'design', { name, value: wrapped(place, JSON.parse(JSON.stringify(v))) }, place);
        const problem = graded(name, place, { class: v._type, size: v._emptyDims }, outcome);
        if (problem) {
          wrong.push(JSON.stringify(v) + ' ' + problem);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('and so is its copy out of a binary dictionary, which carries its class and size, and a string\'s once that dictionary is saved', () => {
    // A copy is what a host pastes: `entry.serialize()`. Out of a binary dictionary, a host's
    // string or function handle empty was copied as `[]`, a double 0x0, whichever dictionary it
    // was then pasted into. Saved there, a string's is `Class="string" Dimension="0*3"/>`, which
    // the binary reader holds under its header, and an N-D one's `Dimension="0*2*2"`, which MATLAB
    // reads back as what it is in no text spelling; a function handle's save is refused (FH-PASTE).
    const copiesOut = (values: typeof HOST) => {
      const session = createSession();
      const bin: any = ingest(session, buffer(bytesAt(BINARY)), { filename: 'lossy_empties_readback_binary.sldd' });
      const design = bin.getSection('design');
      const copies = values.map((v, k) => {
        const pasted = design.parseEntry({ name: 'h' + k, metadata: { ...design.children[0].metadata, uuid: '00000000-0000-4000-a910-' + String(k + 1).padStart(12, '0') }, value: { ...v } });
        return JSON.parse(JSON.stringify(pasted.serialize()));
      });
      return { session, bin, copies };
    };
    const strings = HOST.filter((v) => v._type === 'string');
    const handles = HOST.filter((v) => v._type === 'function_handle');
    const saved = [...strings, { _type: 'string', _emptyDims: [0, 2, 2] }];
    const { session, bin, copies } = copiesOut(saved);
    const resaved: any = ingest(createSession(), buffer(session.serializeSource(bin.name)!.bytes!), { filename: 'resaved.sldd' });
    const resavedCopies = saved.map((v, k) => JSON.parse(JSON.stringify(resaved.getSection('design').children.find((e: any) => e.name === 'h' + k).serialize())));
    const cases: [{ _type: string; _emptyDims: number[] }, number, any][] = [
      ...strings.map((v, k) => [v, k, copies[k]] as [typeof v, number, any]),
      ...saved.map((v, k) => [v, k, resavedCopies[k]] as [typeof v, number, any]),
      ...handles.map((v, k) => [v, k, copiesOut(handles).copies[k]] as [typeof v, number, any]),
    ];
    const wrong: string[] = [];
    for (const [v, k, copy] of cases) {
      const problem = graded('h' + k, 'entry', { class: v._type, size: v._emptyDims }, pasteInto('design', copy, 'entry'));
      if (problem) {
        wrong.push(JSON.stringify(v) + ' ' + problem);
      }
    }
    expect(cases.length).toBe(10);
    expect(wrong).toEqual([]);
  });

  it('the refusal of an empty function handle says what it is and why', () => {
    const outcome = pasteInto('design', { name: 'h', value: wrapped('field', { _type: 'function_handle', _emptyDims: [1, 0] }) }, 'field');
    expect(outcome).toEqual({
      refused: 'MatBudgetError',
      message: 'Cannot write "h": h.f is an empty function handle (1x0), and a text dictionary has no spelling of it that MATLAB reads back as it is. Nothing was written.',
    });
  });

  it('but a text dictionary holding one of them as a host handed it in is saved unedited as the same file', () => {
    // As it was written there at a field and in a cell, which is how it was written before. As an
    // entry or an object's property, it was rewritten `[]` by a save that edited nothing.
    const json = JSON.parse(strFromU8(bytesAt(TEXT_HOST)));
    const held: any[] = json.__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    // Each is an entry of the last section, after its last entry, as a save lists them.
    const proto = held[held.length - 1];
    let n = 0;
    for (const v of HOST.slice(0, 5)) {
      for (const place of HOST_PLACES) {
        held.push({ ...proto, name: 'z' + ++n + place, metadata: { ...proto.metadata, uuid: '00000000-0000-4000-a920-' + String(n).padStart(12, '0') }, value: wrapped(place, { ...v }) });
      }
    }
    const file = JSON.stringify(json, null, '\t');
    const session = createSession();
    const root: any = ingest(session, buffer(strToU8(file)), { filename: 'held_text.sldd' });
    const saved = session.serializeSource(root.name)!.text!;
    const zValues = (t: string) => entriesOf(t).filter((e) => e.name.startsWith('z')).map((e) => [e.name, e.value]);
    expect(zValues(saved)).toEqual(zValues(file));
    expect(saved === file).toBe(true);
  });

  /** A Simulink.Parameter, MATLAB's own, copied out of its binary dictionary, holding `v` as its Value. */
  const inParameter = (v: unknown, dims: number[]): unknown => {
    const bin: any = ingest(createSession(), buffer(bytesAt(BINARY)), { filename: 'lossy_empties_readback_binary.sldd' });
    const p = JSON.parse(JSON.stringify(bin.getSection('design').children.find((e: any) => e.name === 'p_D022').serialize().value));
    p._elements[0]._properties.Value = v;
    p._elements[0]._properties.Dimensions = dims;
    return p;
  };
  const hostAt = (place: Place, v: unknown, dims: number[]): Outcome =>
    pasteInto(place === 'prop' ? 'other' : 'design', { name: 'h_' + place, value: place === 'param' ? inParameter(v, dims) : wrapped(place, v) }, place);

  it("a host's empty string with a trailing 1 is written as the one without it, which MATLAB reads back with its class and size", () => {
    // A trailing 1 is no extent: MATLAB's size of a 0x3x1 string is 0x3, and every other class is
    // written at its dims without it (MatWriter.effectiveDims). Written with it, `_dimensions` was
    // a spelling MATLAB was never asked about, and the value reopened here as a 0x3x1.
    const wrong: string[] = [];
    for (const dims of [[0, 3, 1], [1, 0, 1], [0, 0, 1, 1]]) {
      const two = dims.slice(0, 2);
      for (const place of HOST_PLACES) {
        const problem = graded('h_' + place, place, { class: 'string', size: two }, hostAt(place, { _type: 'string', _emptyDims: dims }, dims));
        if (problem) {
          wrong.push(dims.join('x') + ' ' + problem);
        }
      }
      // At a Parameter's Value MATLAB reads every spelling of an empty string back as a double 0x0
      // (Str03 at param), so there is no spelling to grade it by: it is written as the one without the 1.
      const atValue = (d: number[]) => JSON.stringify(hostAt('param', { _type: 'string', _emptyDims: d }, two));
      if (atValue(dims) !== atValue(two)) {
        wrong.push(dims.join('x') + ' at param: ' + atValue(dims) + ', where without the 1: ' + atValue(two));
      }
    }
    expect(wrong).toEqual([]);
  });

  it("a host's N-D empty string is refused at every place, a Parameter's Value too, and named as the string it is", () => {
    // MATLAB reads back no text spelling of an N-D string (Str022): it refuses one in a cell, a
    // field and at a Value, and reads its own text back as another value at an entry and a property.
    const wrong: string[] = [];
    for (const dims of [[0, 0, 2], [0, 3, 2]]) {
      for (const place of [...HOST_PLACES, 'param'] as Place[]) {
        const name = 'h_' + place;
        const outcome = hostAt(place, { _type: 'string', _emptyDims: dims }, dims);
        const problem = graded(name, place, { class: 'string', size: dims }, outcome);
        const message = `Cannot write "${name}": ${name}${PATH[place]} is a ${dims.join('x')} string, which a text dictionary holds only as its MAT stream, and that stream cannot be written: no MAT class for "string". Nothing was written.`;
        if (problem || !('refused' in outcome) || outcome.refused !== 'MatWriteError' || outcome.message !== message) {
          wrong.push(dims.join('x') + ' at ' + place + ': ' + (problem ?? JSON.stringify(outcome)));
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
