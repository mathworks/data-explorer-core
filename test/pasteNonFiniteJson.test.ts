// Copyright 2026 The MathWorks, Inc.
//
// Ported from data-explorer-vscode test/pasteNonFiniteJson.test.ts at c73da3c, through core's copy of the
// JSON paste (src/edit/structuralEdit.ts pasteEntries). Setup changed only: the binary source is added
// to a core session instead of the global DataModel, a copied payload is the entry's serialize() (what
// the host's buildClipboardSnapshot carries) instead of that snapshot, and the JSON dictionary is a fresh
// core session over its text instead of view's getModel/invalidate. The fixtures are the same bytes.
//
// An Inf, -Inf or NaN copied into a JSON dictionary lands as itself, spelled as MATLAB spells it,
// and the one record that could still be written with a null is refused instead.
//
// A binary dictionary's reader holds a non-finite scalar as a bare number, and so does the record a
// copy of it carries (pasteNonFinite.test.ts). Core spells such a number as a text dictionary does,
// `{"_type": "double", "_value": "Inf"}`, as it takes a pasted entry in (SectionNode.parseEntry), so
// every such paste is written exactly — never with the null JSON.stringify makes of a bare Inf. The
// host's refusal of a record holding one (structuralEdit.refuseUnwrittenNumber) stays as the safety
// net for a record core hands back as it was: fabricated here, since no real copy reaches it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { createSession, parseBinarySlddParts } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { pasteEntries, sectionByName } from '../src/edit/structuralEdit.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

// vscode's test/parity/artifacts/binary/params.sldd and test-integration/fixtures/workspace/params.sldd,
// byte for byte.
const binaryZip = unzipSync(new Uint8Array(readFileSync('test/parity/artifacts/binary/params.sldd')));
const jsonText = readFileSync('test/parity/artifacts/text/params.sldd', 'utf8');
const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** One DD.ENTRY of Design Data, as MATLAB writes it, around `value`. */
const entryXml = (name: string, value: string, uuidTail: string) => `<Object Class="DD.ENTRY">
        <P Name="Name" Class="char">${name}</P>
        <P Name="UUID" Class="char">0e0e0e0e-0000-4000-8000-${uuidTail}</P>
        <P Name="Namespace" Class="char">dacaf35e-55a5-454d-a7c1-93db038a210e</P>
        <P Name="LastMod" Class="char">20261023T120000.000000</P>
        <P Name="LastModBy" Class="char">fixture</P>
        <P Name="IsDerived" Class="char">0</P>
        ${value}
    </Object>
    `;

// A non-finite number at each place a binary dictionary holds one bare: an entry's value, a
// struct's field, an object's property.
const NON_FINITE: [string, string][] = [
  ['nfInf', '<P Name="Value" Class="double">Inf</P>'],
  ['nfNegInf', '<P Name="Value" Class="double">-Inf</P>'],
  ['nfNaN', '<P Name="Value" Class="double">NaN</P>'],
  ['nfStruct', '<P Name="Value" Class="struct"><Element><P Name="a" Class="double">Inf</P></Element></P>'],
  ['nfParam', '<P Name="Value"><Element Class="Simulink.Parameter"><P Name="Value" Class="double">Inf</P></Element></P>'],
];

/** The records a copy of each carries, out of a binary dictionary, as both providers copy. */
function copied(): Map<string, Record<string, unknown>> {
  const xml = new TextDecoder().decode(binaryZip['data/chunk0.xml']);
  const at = xml.indexOf('<Object Class="DD.ENTRY">');
  const chunk = xml.slice(0, at) + NON_FINITE.map(([n, v], i) => entryXml(n, v, String(i).padStart(12, '0'))).join('') + xml.slice(at);
  const meta: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(binaryZip)) if (k !== 'data/chunk0.xml') meta[k] = v;
  const srcId = 'test://nonfinite-json-source.sldd';
  const session: any = createSession();
  const source: any = session.addDataSource(srcId, parseBinarySlddParts(chunk, meta), { path: 'params.sldd' });
  const entries = (source.children as any[]).flatMap((s: any) => s.children);
  // What the host's clipboard snapshot carries of each (buildClipboardSnapshot): its serialize().
  const payloads = NON_FINITE.map(([n]) => entries.find((e: any) => e.name === n).serialize() as Record<string, unknown>);
  return new Map(payloads.map((p) => [String(p.name), p]));
}

let seq = 0;
/** A fresh JSON dictionary's Design Data, and the text it was read from. */
function jsonDesign(): any {
  seq++;
  // A fresh core session over the JSON dictionary, as view's getModel after invalidate.
  return sectionByName(ingest(createSession(), ab(new TextEncoder().encode(jsonText)), { filename: 'params.sldd' }), 'design');
}

/** The value the pasted entry `name` has in `text`, as written. */
const written = (text: string, name: string): any =>
  JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === name).value;

describe('a non-finite number copied into a JSON dictionary', () => {
  const spelled = (text: string) => ({ _type: 'double', _value: text });

  it("is written in MATLAB's spelling, at an entry's value, a struct's field and an object's property", () => {
    const payloads = copied();
    const paste = (name: string) => written(pasteEntries(jsonText, jsonDesign(), [payloads.get(name)!]).newText, name);
    expect(paste('nfInf')).toEqual(spelled('Inf'));
    expect(paste('nfNegInf')).toEqual(spelled('-Inf'));
    expect(paste('nfNaN')).toEqual(spelled('NaN'));
    expect(paste('nfStruct')._elements[0].a).toEqual(spelled('Inf'));
    expect(paste('nfParam')._elements[0]._properties.Value).toEqual(spelled('Inf'));
  });

  it('is never refused: every one of them is pasted together', () => {
    const payloads = [...copied().values()];
    const { newText } = pasteEntries(jsonText, jsonDesign(), payloads);
    expect(newText).not.toMatch(/"(?:Value|value|a)":\s*null/);
    for (const [name] of NON_FINITE) expect(written(newText, name), name).toBeTruthy();
  });
});

describe('the safety net: a record still holding a bare non-finite number', () => {
  // A section whose parseEntry hands back a node whose record holds `value` as it is: what core
  // does with a value it does not take apart, which no real copy above reaches.
  function heldBack(value: unknown): any {
    const design = jsonDesign();
    const parse = design.parseEntry.bind(design);
    design.parseEntry = (raw: any) => {
      const node = parse(raw);
      const serialize = node.serialize.bind(node);
      node.serialize = () => ({ ...serialize(), value });
      return node;
    };
    return design;
  }

  it('is refused, naming the entry and where in it the number is, and nothing is written', () => {
    const struct = { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ gain: Infinity }], _fields: ['gain'], _mw_element_type: 'MATLABArray' };
    expect(() => pasteEntries(jsonText, heldBack(struct), [{ name: 'held', metadata: {}, value: 1 }])).toThrow(
      'Cannot paste "held" into a text dictionary: it holds Inf (in gain), which would be written there as null. Nothing was pasted.',
    );
    expect(() => pasteEntries(jsonText, heldBack(NaN), [{ name: 'bare', metadata: {}, value: 1 }])).toThrow(
      'Cannot paste "bare" into a text dictionary: it holds NaN, which would be written there as null. Nothing was pasted.',
    );
  });

  it("passes a text dictionary's own overflowing extent, which its save writes as it always has", () => {
    const value = { _array_type: 'Cell', _dimensions: [1, Infinity], _elements: [], _mw_element_type: 'MATLABArray' };
    expect(() => pasteEntries(jsonText, heldBack(value), [{ name: 'dims', metadata: {}, value: 1 }])).not.toThrow();
  });
});
