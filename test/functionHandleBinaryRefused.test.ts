// Copyright 2026 The MathWorks, Inc.
//
// A function handle pasted into a binary dictionary is refused, naming the entry and the path to
// it, and nothing is written (FH-PASTE; the maintainer's group F ruling, 2026-10-18: a save the
// writer cannot spell is refused rather than written wrong).
//
// MATLAB holds a function handle in a binary dictionary only inside the hex element of a MAT
// stream: no binary dictionary in the corpus or the fixtures holds `Class="function_handle"` XML.
// This package cannot write that stream, and its XML writers spelled a handle as a number through
// their numeric tails: sparse_text.sldd's fhAlias, copied as a host copies it and pasted into
// sparse_binary.sldd, was written `<P Name="Fh" Class="function_handle">0</P>`, an entry, a cell's
// element or a struct's field holding one `>NaN<`, and an empty one `Class="function_handle"
// Dimension="0*0"/>`. MATLAB R2027a reads none of those back: getValue answers "Class
// 'function_handle' is not supported." for each, at an object's property, an entry and a cell's
// element, the empty one included.
//
// A value the package holds as its own MAT stream is not refused: a binary dictionary's fhAlias,
// read as hex, is pasted as that hex, and a text dictionary's stream of a handle is pasted as its
// own (workspaceBrowserDisplay.test.ts). Nor is a paste into a text dictionary, which holds a
// handle as its literal.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { MatBudgetError, MatWriteError } from '../src/datamodel/parser/MatWriter.js';
import { BINARY, TEXT, copyOf, sparseFixture, thrownBy } from './tools/pasteVenues.js';
import '../src/datamodel/node/data/NodeClassMap.js';

type Any = any;

const FH = { _type: 'function_handle', _value: 'sin' };
const EMPTY_FH = { _type: 'function_handle', _value: 'Matrix(0,0)' };
const ANON_FH = { _type: 'function_handle', _value: '@(x) x + 1' };

/** The refusal's whole text, for a handle described as `what` at `path` of the entry `entry`. */
const refusalText = (entry: string, path: string, what: string) =>
  `Cannot write "${entry}": ${path} is ${what}, which a binary dictionary holds only in MATLAB's MAT encoding, ` +
  'and this package cannot write that. Nothing was written.';

const open = (file: string): { session: Any; root: Any } => {
  const session = createSession();
  return { session, root: ingest(session, sparseFixture(file), { filename: file }) };
};
const designEntry = (root: Any, name: string) => root.getSection('design').children.find((e: Any) => e.name === name);

let seq = 0;
/** `value` pasted into a fresh `file` (sparse_binary.sldd unless said) as the entry `name`. */
function paste(value: unknown, name: string, file = BINARY): { session: Any; root: Any; entry: Any } {
  const { session, root } = open(file);
  const entry = root.getSection('design').parseEntry({ name, metadata: { uuid: `00000000-0000-4000-f4a5-${String(++seq).padStart(12, '0')}` }, value });
  return { session, root, entry };
}

/** The entry's XML and a save of the dictionary holding it are each refused, with exactly `text`. */
function expectRefused(session: Any, root: Any, entry: Any, text: string): void {
  const [thrown] = thrownBy(() => serializeEntryToXml(entry));
  expect(thrown).toBeInstanceOf(MatWriteError);
  // This writer has no spelling for the value, which is not the budget's refusal.
  expect(thrown).not.toBeInstanceOf(MatBudgetError);
  expect(thrown!.message).toBe(text);
  const [refused] = thrownBy(() => session.serializeSource(root.name));
  expect(refused).toBeInstanceOf(MatWriteError);
  expect(refused!.message).toBe(text);
}

const fhAliasFrom = (file: string) => copyOf(designEntry(open(file).root, 'fhAlias'));
const alias = (fh: unknown) => {
  const value: Any = fhAliasFrom(TEXT);
  value._elements[0]._properties.Fh = fh;
  return value;
};
const widget = (props: Record<string, unknown>) => ({
  _array_class: 'Widget',
  _dimensions: [1, 1],
  _elements: [{ _properties: props }],
  _mw_element_type: 'MATLABArray',
});
const parameterOf = (value: unknown) => ({ _array_class: 'Simulink.Parameter', _dimensions: [1, 1], _elements: [{ _properties: { Value: value } }] });
const cellOf = (...elements: unknown[]) => ({ _array_type: 'Cell', _dimensions: [1, elements.length], _elements: elements, _mw_element_type: 'MATLABArray' });
const structOf = (fields: Record<string, unknown>) => ({ _array_type: 'Struct', _dimensions: [1, 1], _elements: [fields], _fields: Object.keys(fields) });

describe("sparse_text.sldd's fhAlias, copied and pasted into a binary dictionary", () => {
  it('its XML and the save are refused, naming fhAliasX.Fh, where Fh was written Class="function_handle">0', () => {
    const value: Any = fhAliasFrom(TEXT);
    expect(value._elements[0]._properties.Fh).toEqual(FH);
    const { session, root, entry } = paste(value, 'fhAliasX');
    expectRefused(session, root, entry, refusalText('fhAliasX', 'fhAliasX.Fh', 'a function handle (@sin)'));
  });
});

describe('a function handle anywhere in a value pasted into a binary dictionary', () => {
  // Where it stands, the value holding it, and the path and the handle the refusal names.
  const PLACES: [place: string, value: unknown, path: string, what: string][] = [
    ['the entry itself', FH, 'x', 'a function handle (@sin)'],
    ['the entry itself, empty', EMPTY_FH, 'x', 'an empty function handle (0x0)'],
    ["a Simulink.Parameter's Value", parameterOf(FH), 'x.Value', 'a function handle (@sin)'],
    ["an element of the entry's cell", cellOf(FH, 5), 'x{1}', 'a function handle (@sin)'],
    ["an element of the entry's cell, empty", cellOf(5, EMPTY_FH), 'x{2}', 'an empty function handle (0x0)'],
    ["an element of the entry's N-D cell", { ...cellOf(FH, 5), _dimensions: [1, 1, 2] }, 'x{1}', 'a function handle (@sin)'],
    ["a field of the entry's struct", structOf({ f: FH, g: 2 }), 'x.f', 'a function handle (@sin)'],
    ["a field of the entry's struct, anonymous", structOf({ g: 2, f: ANON_FH }), 'x.f', 'a function handle (@(x) x + 1)'],
    ["an object's property", alias(FH), 'x.Fh', 'a function handle (@sin)'],
    ["an object's property, empty", alias(EMPTY_FH), 'x.Fh', 'an empty function handle (0x0)'],
    ["an element of a cell in a Parameter's Value", parameterOf(cellOf(FH)), 'x.Value{1}', 'a function handle (@sin)'],
    ["a field of a struct in an object's property", widget({ S: structOf({ f: FH }), n: 1 }), 'x.S.f', 'a function handle (@sin)'],
    ["an element of a cell in an object's property, empty", widget({ C: cellOf(1, EMPTY_FH), n: 1 }), 'x.C{2}', 'an empty function handle (0x0)'],
  ];
  for (const [place, value, path, what] of PLACES) {
    it(`at ${place}: its XML and the save are refused, naming ${path}`, () => {
      const { session, root, entry } = paste(JSON.parse(JSON.stringify(value)), 'x');
      expectRefused(session, root, entry, refusalText('x', path, what));
    });
  }
});

describe("display/nested_handles.mat's handles in a struct, a cell and a struct array, copied and pasted into a binary dictionary", () => {
  const mat = new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/display/nested_handles.mat', import.meta.url))));
  const variable = (name: string): Any => {
    const root: Any = ingest(createSession(), mat.buffer.slice(mat.byteOffset, mat.byteOffset + mat.byteLength) as ArrayBuffer, { filename: 'nested_handles.mat' });
    const found: Any[] = [];
    const walk = (n: Any) => (n.name === name && n.parent?.parent === null ? found.push(n) : (n.children || []).forEach(walk));
    walk(root);
    expect(found, name).toHaveLength(1);
    return found[0];
  };
  // The first handle each is written to holds the refusal.
  const VARIABLES: [name: string, path: string, what: string][] = [
    ['s_fh', 'p.named', 'a function handle (@sin)'],
    ['c_fh', 'p{1}', 'a function handle (@sin)'],
    ['deep_fh', 'p.inner.h', 'a function handle (@cos)'],
    ['sa_fh', 'p(1).h', 'a function handle (@sin)'],
  ];
  for (const [name, path, what] of VARIABLES) {
    it(`${name}: its XML and the save are refused, naming ${path}`, () => {
      const { session, root, entry } = paste(copyOf(variable(name)), 'p');
      expectRefused(session, root, entry, refusalText('p', path, what));
    });
  }

  it("a text dictionary's MAT stream of one of them, at a Parameter's Value, is refused, naming x.Value", async () => {
    // The node the property writer reads the stream back into (DataNode._detachedXml) writes
    // itself: no stream of its own is written below an entry, so it was `Class="function_handle">NaN`.
    const { parseMat } = await import('../src/datamodel/parser/MatParser.js');
    const { matStreamOfElement } = await import('../src/datamodel/parser/MatWriter.js');
    const { uuencode } = await import('../src/datamodel/parser/CdataCodec.js');
    const s: Any = parseMat(mat.buffer.slice(mat.byteOffset, mat.byteOffset + mat.byteLength) as ArrayBuffer).variables.find((v: Any) => v.name === 's_fh');
    const stream = { _type: 'cdata', _value: uuencode(matStreamOfElement(s.fields.named._rawBytes)!) };
    const { session, root, entry } = paste(parameterOf(stream), 'x');
    expectRefused(session, root, entry, refusalText('x', 'x.Value', 'a function handle (@sin)'));
  });

  it('the empty one in s_fh is refused too, where it was written Class="function_handle" Dimension="0*0"/>', () => {
    const value: Any = copyOf(variable('s_fh'));
    expect(value._elements[0].none).toEqual(EMPTY_FH);
    const { session, root, entry } = paste(structOf({ none: value._elements[0].none, num: 3 }), 'p');
    expectRefused(session, root, entry, refusalText('p', 'p.none', 'an empty function handle (0x0)'));
  });
});

describe('controls: what is not refused', () => {
  it("sparse_binary.sldd's fhAlias, read as hex, is pasted into a binary dictionary as that hex, saved, and reopens as @sin", () => {
    const { session, root, entry } = paste(fhAliasFrom(BINARY), 'fhAliasB');
    expect(serializeEntryToXml(entry)).toMatch(/<P Name="Value" Class="dexsparse\.FhAlias" Encoding="hex" EncodedLength="\d+">/);
    const saved = session.serializeSource(root.name);
    expect(strFromU8(unzipSync(saved.bytes)['data/chunk0.xml'])).not.toContain('Class="function_handle"');
    const again: Any = ingest(createSession(), saved.bytes.buffer.slice(saved.bytes.byteOffset, saved.bytes.byteOffset + saved.bytes.byteLength), { filename: BINARY });
    const fh = designEntry(again, 'fhAliasB').children.find((c: Any) => c.name === 'Fh');
    expect([fh.className, fh.displayValue]).toEqual(['function_handle', '@sin']);
  });

  it('a binary dictionary holding a handle, saved untouched, is written', () => {
    const { session, root } = open(BINARY);
    expect(thrownBy(() => session.serializeSource(root.name))[0]).toBeNull();
  });

  it('pasted into a text dictionary, a handle is saved as its literal', () => {
    const { session, root } = paste(fhAliasFrom(TEXT), 'fhAliasT', TEXT);
    const entries = JSON.parse(session.serializeSource(root.name).text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries;
    expect(entries.find((e: Any) => e.name === 'fhAliasT').value._elements[0]._properties.Fh).toEqual(FH);
  });
});
