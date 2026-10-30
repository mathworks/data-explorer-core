// Copyright 2026 The MathWorks, Inc.
//
// An enumeration value inside a cell or a struct, pasted into a text dictionary, is written as MATLAB
// writes it there (open-questions 14, B): test/fixtures/enum-containers/r2027a holds each value as a
// MAT-file and as MATLAB's own text dictionary of it (make_enum_containers.m). MATLAB writes a
// logical-backed one, a matlab.lang.OnOffSwitchState, as the enumerals' underlying values under
// `_enum_value`: a scalar as the JSON boolean, any other rank-2 size as the logical literal, `[1, 0]`,
// `Matrix(2,1)\n[1, 0]`, `Matrix(2,2)\n[[1, 0]; [0, 1]]`. Core spelled only an integer-backed one so,
// and wrote this one as an object with no enumerals, which MATLAB fails to read ("Invalid or deleted
// object"). One it still cannot spell as MATLAB does is refused, naming where it is, and not written.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';

type Any = any;

const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const ENUMS = 'test/fixtures/enum-containers/r2027a/';
const TEXT_TARGET = 'test/fixtures/edit-bash/r2027a/values_text.sldd';

function opened(path: string) {
  const session: Any = createSession();
  const root: Any = ingest(session, ab(new Uint8Array(readFileSync(path))), { filename: path.split('/').pop()! });
  return { session, root, design: root.children?.find((s: Any) => s.name === 'design') };
}

// The entries of a text dictionary's save, by name, as its JSON holds them.
function textEntries(text: string): Map<string, Any> {
  const parts = JSON.parse(text).__MW_TEXT_PARTS__;
  const entries = Object.values(parts).flatMap((p: Any) => p.__MW_TEXT_content?.entries ?? []);
  return new Map(entries.map((e: Any) => [e.name, e.value]));
}

// A value less the keys that carry no part of it: an element's `_id`, which MATLAB writes and core
// does not, and the `_mw_element_type` MATLAB leaves off a bag at some places and the `_fields` of a
// struct, which core writes at every one.
const NO_PART = new Set(['_id', '_mw_element_type', '_fields']);
function bare(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(bare);
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !NO_PART.has(k)).map(([k, x]) => [k, bare(x)]));
}

const MATLAB_TEXT = textEntries(readFileSync(ENUMS + 'values_text.sldd', 'utf8'));

describe('an enumeration in a cell or a struct, pasted out of a MAT-file into a text dictionary', () => {
  it.each(['cOn', 'cOff', 'cOnRow', 'cOnCol', 'cOn2x2', 'cTwo', 'sOn', 'sOn2x2', 'cGear', 'cGearRow', 'sGear'])(
    '%s is written as MATLAB writes it there',
    (name) => {
      const mat = opened(ENUMS + 'values.mat');
      const node = mat.root.children.find((v: Any) => v.name === name);
      expect(mat.session.copyRefusal(node.id, 'json')).toBeNull();
      const d = opened(TEXT_TARGET);
      d.session.setActive(d.root, d.design);
      const made = d.session.pasteEntries(d.design.id, [node.serialize()]);
      expect(made.error).toBeUndefined();
      const saved = textEntries((d.session.serializeSource(d.root.name) as Any).text).get(name);
      expect(bare(saved)).toEqual(bare(MATLAB_TEXT.get(name)));
    },
  );

  it('an empty one keeps its size, as before: `Matrix(1,0)`, which R2027a reads back as the 1x0 it is (MATLAB itself writes `[]`)', () => {
    const mat = opened(ENUMS + 'values.mat');
    const node = mat.root.children.find((v: Any) => v.name === 'cOnEmpty');
    const d = opened(TEXT_TARGET);
    d.session.setActive(d.root, d.design);
    expect(d.session.pasteEntries(d.design.id, [node.serialize()]).error).toBeUndefined();
    const saved = textEntries((d.session.serializeSource(d.root.name) as Any).text).get('cOnEmpty');
    expect(bare(saved)).toEqual({ _array_type: 'Cell', _dimensions: [1, 1], _elements: [{ _type: 'matlab.lang.OnOffSwitchState', _value: 'Matrix(1,0)' }] });
    expect(bare(MATLAB_TEXT.get('cOnEmpty'))).toEqual({ _array_type: 'Cell', _dimensions: [1, 1], _elements: [{ _type: 'matlab.lang.OnOffSwitchState', _value: '[]' }] });
  });

  it('an N-D one, whose text spelling MATLAB has not been asked for, is refused where it is', () => {
    const on = { _properties: {}, _enumeration: { name: 'on', type: 'logical', value: '1' } };
    const nd = { _array_class: 'matlab.lang.OnOffSwitchState', _dimensions: [1, 1, 2], _mw_element_type: 'MATLABArray', _elements: [on, on], _is_enum: '1' };
    const payload = { name: 'x', metadata: null, value: { _array_type: 'Cell', _dimensions: [1, 2], _elements: [1, nd], _mw_element_type: 'MATLABArray' } };
    const d = opened(TEXT_TARGET);
    const held = d.design.children.length;
    const said = 'Cannot write "x": x{2} holds a 1x1x2 matlab.lang.OnOffSwitchState, which this editor cannot write into a text dictionary as MATLAB does. Nothing was written.';
    expect(d.session.pasteRefusal(d.design.id, payload, { deep: true })).toBe(said);
    d.session.setActive(d.root, d.design);
    expect(d.session.pasteEntries(d.design.id, [payload])).toMatchObject({ error: true, reason: said });
    expect(d.design.children.length).toBe(held);
  });
});

// Into a binary dictionary (open-questions 14, C), measured in R2027a: MATLAB stores an enumeration
// value by its enumerals' names (`IsEnum`, `EnumerationName`), and stores a cell or a struct holding a
// logical-backed one, a matlab.lang.OnOffSwitchState (no Simulink enumeration class), as one MAT stream.
// So two do not land as MATLAB would, and are refused, naming where they are: a logical-backed one,
// which core wrote with `IsEnum` and MATLAB reads back as the char 'on' (or, empty, a double with the
// warning "Invalid Simulink enumeration class"); and any one spelled as a text dictionary spells it,
// which names no enumeral, and which core wrote as an empty object of the class. An integer-backed one
// out of a MAT-file or a binary dictionary is written as MATLAB writes it, and lands, as before.
const BINARY_TARGET = 'test/fixtures/edit-bash/r2027a/values_binary.sldd';

function refusedIntoBinary(payload: Any, said: string): void {
  const d = opened(BINARY_TARGET);
  const held = d.design.children.length;
  expect(d.session.pasteRefusal(d.design.id, payload, { deep: true })).toBe(said);
  d.session.setActive(d.root, d.design);
  expect(d.session.pasteEntries(d.design.id, [payload])).toMatchObject({ error: true, reason: said });
  expect(d.design.children.length).toBe(held);
}

describe('an enumeration in a cell or a struct, pasted into a binary dictionary', () => {
  const logical = (at: string, size: string) =>
    at + ' holds a ' + size + ' matlab.lang.OnOffSwitchState, which this editor cannot write into a binary dictionary as MATLAB does (MATLAB stores it as a MAT stream)';
  it.each([
    ['cOn', 'cOn{1}', '1x1'],
    ['cOff', 'cOff{1}', '1x1'],
    ['cOnRow', 'cOnRow{1}', '1x2'],
    ['cOnCol', 'cOnCol{1}', '2x1'],
    ['cOn2x2', 'cOn2x2{1}', '2x2'],
    ['cOnEmpty', 'cOnEmpty{1}', '1x0'],
    ['cTwo', 'cTwo{1}', '1x1'],
    ['sOn', 'sOn.v', '1x1'],
    ['sOn2x2', 'sOn2x2.v', '2x2'],
  ])('%s, a logical-backed one out of a MAT-file, is refused at %s', (name, at, size) => {
    const mat = opened(ENUMS + 'values.mat');
    const node = mat.root.children.find((v: Any) => v.name === name);
    expect(mat.session.copyRefusal(node.id, 'xml')).toBe('Cannot copy "' + name + '" into a binary dictionary: ' + logical(at, size) + '. Nothing was copied.');
    refusedIntoBinary(node.serialize(), 'Cannot write "' + name + '": ' + logical(at, size) + '. Nothing was written.');
  });

  const spelled = (at: string, cls: string) =>
    at + ' holds a ' + cls + ' as a text dictionary spells one, which names no enumeral, and a binary dictionary stores each by its name';
  it.each([
    ['cOn', 'cOn{1}', 'matlab.lang.OnOffSwitchState'],
    ['cOnRow', 'cOnRow{1}', 'matlab.lang.OnOffSwitchState'],
    ['sOn', 'sOn.v', 'matlab.lang.OnOffSwitchState'],
    ['cGear', 'cGear{1}', 'GearMode'],
    ['cGearRow', 'cGearRow{1}', 'GearMode'],
    ['sGear', 'sGear.v', 'GearMode'],
  ])('%s, out of a text dictionary, is refused at %s', (name, at, cls) => {
    const text = opened(ENUMS + 'values_text.sldd');
    const node = text.design.children.find((e: Any) => e.name === name);
    expect(text.session.copyRefusal(node.id, 'xml')).toBe('Cannot copy "' + name + '" into a binary dictionary: ' + spelled(at, cls) + '. Nothing was copied.');
    refusedIntoBinary(node.serialize(), 'Cannot write "' + name + '": ' + spelled(at, cls) + '. Nothing was written.');
  });

  it("and so is a text dictionary's Parameter whose Value is one, at its Value", () => {
    const value = { _enum_value: { _type: 'int32', _value: '-1' }, _id: '2', _object_class: 'GearMode' };
    const payload = { name: 'pGear', metadata: null, value: { _array_class: 'Simulink.Parameter', _dimensions: [1, 1], _elements: [{ _id: '1', _properties: { Value: value } }], _mw_element_type: 'MATLABArray' } };
    refusedIntoBinary(payload, 'Cannot write "pGear": ' + spelled('pGear.Value', 'GearMode') + '. Nothing was written.');
  });

  it.each(['cGear', 'cGearRow', 'sGear'])('%s, an integer-backed one out of a MAT-file, is pasted as before', (name) => {
    const mat = opened(ENUMS + 'values.mat');
    const node = mat.root.children.find((v: Any) => v.name === name);
    expect(mat.session.copyRefusal(node.id, 'xml')).toBeNull();
    const d = opened(BINARY_TARGET);
    d.session.setActive(d.root, d.design);
    expect(d.session.pasteEntries(d.design.id, [node.serialize()]).error).toBeUndefined();
  });
});
