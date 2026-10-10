// Copyright 2026 The MathWorks, Inc.
//
// A complex value written into a compressed-binary dictionary, against the XML MATLAB
// itself wrote for the same value. test/fixtures/mcos/complex_binary.sldd and
// complex_objects.mat hold the same values, both authored by make_complex_fixtures.m on
// R2027a, so every complex `<P>` MATLAB wrote is the answer for three ways of writing one:
//
//   * a save that edits nothing, which rebuilds every entry from the model;
//   * a save after editing some OTHER property of the entry, which rewrites that entry
//     with its Value untouched;
//   * a Parameter out of the .mat put into the dictionary, which writes the MCOS decoder's
//     form of the value.
//
// All three used to write `Class="double" IsComplex="1">` and nothing more, whatever the
// value. MATLAB read the result back as the first element alone — [1+2i 3+4i 5+6i] as
// 1+2i, a 2x2 and a 2x2x2 likewise — and int64(complex(intmax('int64'), 1)) as a double.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import { parseComplexNum } from '../src/datamodel/parser/XmlUtils.js';
import * as NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import DataNode from '../src/datamodel/node/DataNode.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/mcos/${name}`, import.meta.url))));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const chunkOf = (zip: Uint8Array): string => new TextDecoder().decode(unzipSync(zip)['data/chunk0.xml']);

const MATLAB_CHUNK = chunkOf(fixture('complex_binary.sldd'));

/** One entry's `<Object>` block, found by its Name. */
function entryBlock(xml: string, name: string): string {
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(at, name).toBeGreaterThan(-1);
  const open = xml.lastIndexOf('<Object ', at);
  return xml.slice(open, xml.indexOf('</Object>', at));
}

/** Every complex property and element in `xml`, in order, as written. */
const complexTags = (xml: string): string[] =>
  [...xml.matchAll(/<(P|Element)\b[^>]*IsComplex="1"[^>]*(?:\/>|>[^<]*<\/\1>)/g)].map((m) => m[0]);

const ENTRIES = [...MATLAB_CHUNK.matchAll(/<P Name="Name" Class="char">([^<]+)<\/P>/g)].map((m) => m[1]);
const WITH_COMPLEX = ENTRIES.filter((n) => complexTags(entryBlock(MATLAB_CHUNK, n)).length > 0);

function openBinary(session = createSession()): { session: any; root: any } {
  const root: any = ingest(session, buffer(fixture('complex_binary.sldd')), { filename: 'complex_binary.sldd' });
  return { session, root };
}

describe('the fixture is what these tests need', () => {
  it('MATLAB wrote complex values of every shape and of more than one class into it', () => {
    const all = WITH_COMPLEX.flatMap((n) => complexTags(entryBlock(MATLAB_CHUNK, n)));
    expect(all.length).toBeGreaterThanOrEqual(30);
    for (const needle of ['Dimension="1*3"', 'Dimension="3*1"', 'Dimension="2*2"', 'Dimension="2*2*2"',
      'Class="int16"', 'Class="int64"', 'Class="int8"', 'Class="single"', 'NaN']) {
      expect(all.some((t) => t.includes(needle)), needle).toBe(true);
    }
  });
});

describe('a save that edits nothing writes every complex value back as MATLAB wrote it', () => {
  const { session, root } = openBinary();
  const out = session.serializeSource(root.name);
  const ours = chunkOf(out.bytes);

  for (const name of WITH_COMPLEX) {
    it(name, () => {
      expect(complexTags(entryBlock(ours, name))).toEqual(complexTags(entryBlock(MATLAB_CHUNK, name)));
    });
  }
});

describe('editing another property of an entry leaves its complex Value as MATLAB wrote it', () => {
  const { root } = openBinary();
  const design = root.getSection('design');
  const params = design.children.filter((e: any) => e.className === 'Simulink.Parameter' && WITH_COMPLEX.includes(e.name));

  it('covers every Parameter MATLAB wrote a complex value for', () => {
    expect(params.length).toBeGreaterThanOrEqual(20);
  });

  for (const entry of params) {
    it(entry.name, () => {
      expect(entry.setProperty('Description', 'edited')).toBe(true);
      const xml = serializeEntryToXml(entry);
      expect(xml).toContain('<P Name="Description" Class="char">edited</P>');
      expect(complexTags(xml)).toEqual(complexTags(entryBlock(MATLAB_CHUNK, entry.name)));
    });
  }
});

describe('a Parameter from a .mat is written into a binary dictionary as MATLAB writes the same value there', () => {
  const session = createSession();
  const mat: any = ingest(session, buffer(fixture('complex_objects.mat')), { filename: 'complex_objects.mat' });
  const { root } = openBinary(session);
  const design = root.getSection('design');
  const shared = mat.children.filter((v: any) => /Parameter$/.test(v.className) && WITH_COMPLEX.includes(v.name));

  // Where the decoder's spelling is not MATLAB's binary text for the same number: it is
  // the shortest decimal that is the double, and MATLAB writes seventeen digits.
  const DIGITS_DIFFER = new Set(['pThird']);

  it('covers every Parameter both files hold', () => {
    expect(shared.map((v: any) => v.name)).toEqual(expect.arrayContaining(['pRow', 'pMat', 'pNd', 'pInt64', 'pInt16Row', 'pNonFinite']));
    expect(shared.length).toBeGreaterThanOrEqual(20);
  });

  let seq = 0;
  for (const variable of shared) {
    it(variable.name, () => {
      const payload: any = JSON.parse(JSON.stringify(variable.serialize()));
      payload.name = variable.name + '_fromMat';
      payload.metadata = { uuid: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` };
      const node = design.parseEntry(payload);
      const ours = complexTags(serializeEntryToXml(node));
      const matlab = complexTags(entryBlock(MATLAB_CHUNK, variable.name));
      if (!DIGITS_DIFFER.has(variable.name)) {
        expect(ours).toEqual(matlab);
        return;
      }
      // The same tags around the same numbers.
      const body = (t: string) => t.replace(/^.*?>|<\/\w+>$/g, '');
      expect(ours.map((t) => t.replace(body(t), ''))).toEqual(matlab.map((t) => t.replace(body(t), '')));
      ours.forEach((t, k) => {
        expect(body(t)).not.toBe(body(matlab[k]));
        expect(parseComplexNum(body(t))).toEqual(parseComplexNum(body(matlab[k])));
      });
    });
  }
});

describe('the writers state what the value is', () => {
  const xmlOf = (envelope: Record<string, unknown>) =>
    (NodeRegistry.parseValue(envelope, 'Value', null) as DataNode).serializeXml('P', { Name: 'Value' }, 0);

  it('the node writer: an integer class, as integers, and every extent', () => {
    expect(xmlOf({ _type: 'cdata', _value: '1+2i 3-4i', _dimensions: [1, 2], _class: 'int16' })).toBe(
      '<P Name="Value" Class="int16" IsComplex="1" Dimension="1*2">1+2i 3-4i</P>',
    );
    expect(xmlOf({ _type: 'cdata', _value: '3-4i', _class: 'int8' })).toBe('<P Name="Value" Class="int8" IsComplex="1">3-4i</P>');
    expect(xmlOf({ _type: 'cdata', _value: '0.5+1.5i 2.5-3.5i', _dimensions: [2, 1], _class: 'single' })).toBe(
      '<P Name="Value" Class="single" IsComplex="1" Dimension="2*1">0.5+1.5i 2.5-3.5i</P>',
    );
    // A double says nothing, and its parts read as doubles.
    expect(xmlOf({ _type: 'cdata', _value: '1+2i 3-4i', _dimensions: [1, 2] })).toBe(
      '<P Name="Value" Class="double" IsComplex="1" Dimension="1*2">1.0+2.0i 3.0-4.0i</P>',
    );
    // An edited scalar is a double, as the literal typed for it is in MATLAB.
    const edited: any = NodeRegistry.parseValue({ _type: 'cdata', _value: '3-4i', _class: 'int8' }, 'Value', null);
    expect(edited.setProperty('Value', '5+6i')).toBe(true);
    expect(edited.serializeXml('P', { Name: 'Value' }, 0)).toBe('<P Name="Value" Class="double" IsComplex="1">5.0+6.0i</P>');
  });

  it('the property writer: a scalar with no Dimension, an N-D with all of it, an empty closed', () => {
    const prop = (v: Record<string, unknown>) => DataNode.serializePropertyXml('V', v, 0, null);
    expect(prop({ _type: 'cdata', _value: '3+4i' })).toBe('<P Name="V" Class="double" IsComplex="1">3.0+4.0i</P>');
    expect(prop({ _type: 'cdata', _value: '1+1i 2+2i', _dimensions: [1, 1, 2] })).toBe(
      '<P Name="V" Class="double" IsComplex="1" Dimension="1*1*2">1.0+1.0i 2.0+2.0i</P>',
    );
    expect(prop({ _type: 'cdata', _value: '9223372036854775807+1i', _class: 'int64' })).toBe(
      '<P Name="V" Class="int64" IsComplex="1">9223372036854775807+1i</P>',
    );
    expect(prop({ _type: 'cdata', _value: '', _dimensions: [1, 0] })).toBe('<P Name="V" Class="double" IsComplex="1" Dimension="1*0"/>');
    // MATLAB's own words for the non-finite parts, whichever reader's text it is.
    expect(prop({ _type: 'cdata', _value: '1+Infinityi NaN+0i', _dimensions: [1, 2] })).toBe(
      '<P Name="V" Class="double" IsComplex="1" Dimension="1*2">1.0+Infi NaN+0.0i</P>',
    );
  });

  it('an entry whose complex text the reader shows quoted is saved as that text, not as a char', () => {
    // MATLAB's own body for pNonFinite (complex_binary.sldd), as an entry's value rather
    // than a Parameter's. parseCdata does not read it as numbers and shows it quoted
    // (MatlabVariableNode._isOwnNonFiniteText says why); the node writer then spelled
    // what it showed, `Class="char">Inf-Infi NaN+1.0i …`, so an unedited save changed the
    // class of MATLAB's value. The same text inside a Parameter was always replayed.
    const tag = '<P Name="Value" Class="double" IsComplex="1" Dimension="1*4">Inf-Infi NaN+1.0i 1.0NaNi -Inf+2.0i</P>';
    const DECL = '<?xml version="1.0" encoding="UTF-8"?>';
    const xml =
      `${DECL}\n<DataSource FormatVersion="1" MinRelease="R2014a">\n    <Object Class="DD.ENTRY">\n` +
      `        <P Name="Name" Class="char">zNonFinite</P>\n        ${tag}\n    </Object>\n</DataSource>`;
    const root: any = createSession().addDataSource('mem://complexQuoted', parseBinarySlddParts(xml, {}), { path: 'q.sldd' });
    const entry = root.getSection('design').children[0];
    expect([entry.displayValue, entry.className]).toEqual(["'Inf-Infi NaN+1.0i 1.0NaNi -Inf+2.0i'", 'char']);
    expect(complexTags(serializeEntryToXml(entry))).toEqual([tag]);
    // And a rename, which leaves the value as it was.
    expect(entry.setProperty('Name', 'zNonFiniteRenamed')).toBe(true);
    expect(complexTags(serializeEntryToXml(entry))).toEqual([tag]);
  });

  it('a complex element of a cell inside an object\'s property is written as one, not as `Class="cdata"`', () => {
    // A Parameter whose Value is {1+2i, int16([3+4i 5-6i])}. Before, a save wrote each
    // element as `<Element Class="cdata">1</Element>`: a class MATLAB has no reader for,
    // holding the real part of the first element alone.
    const DECL = '<?xml version="1.0" encoding="UTF-8"?>';
    const value =
      '<P Name="Value" Class="cell" Dimension="1*2">' +
      '<Element Class="double" IsComplex="1">1.0+2.0i</Element>' +
      '<Element Class="int16" IsComplex="1" Dimension="1*2">3+4i 5-6i</Element></P>';
    const xml =
      `${DECL}\n<DataSource FormatVersion="1" MinRelease="R2014a">\n    <Object Class="DD.ENTRY">\n` +
      `        <P Name="Name" Class="char">pCell</P>\n` +
      `        <P Name="Value" Class="Simulink.Parameter"><Element Class="Simulink.Parameter">${value}` +
      `<P Name="Description" Class="char">d</P></Element></P>\n    </Object>\n</DataSource>`;
    const root: any = createSession().addDataSource('mem://complexCell', parseBinarySlddParts(xml, {}), { path: 'c.sldd' });
    const entry = root.getSection('design').children[0];
    expect(entry.displayValue).toBe('{1+2i, [3+4i 5-6i]}');
    const out = serializeEntryToXml(entry);
    expect(out).not.toContain('Class="cdata"');
    expect(complexTags(out)).toEqual([
      '<Element Class="double" IsComplex="1">1.0+2.0i</Element>',
      '<Element Class="int16" IsComplex="1" Dimension="1*2">3+4i 5-6i</Element>',
    ]);
  });
});
