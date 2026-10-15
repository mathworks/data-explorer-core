// Copyright 2026 The MathWorks, Inc.
//
// An empty cell written from the node — an entry of a binary dictionary, a cell's element, a
// struct's field — keeps its extents: a 0x3 cell is `Dimension="0*3"/>`, a 1x0 `"1*0"/>`, as
// the property writer (DataNode._cellXml) and MATLAB itself write a shaped empty cell, and as
// the binary reader reads one (BinarySlddParser, parseDims). It was `Dimension="0*0"` whatever
// the node's own dims, so a paste, a copy or any regenerated write of such an entry saved a
// different value, a 0x0 cell. A no-op save kept the entry's bytes and hid it.
import { describe, it, expect } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import NodeRegistry from '../src/datamodel/node/NodeRegistry.js';
import { regenerateChunkXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { BINARY, sparseFixture } from './tools/pasteVenues.js';

const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const cell = (dims: number[] | undefined, elements: unknown[] = []) =>
  dims ? { _array_type: 'Cell', _dimensions: dims, _elements: elements } : { _array_type: 'Cell', _elements: elements };
const parse = (raw: unknown): any => NodeRegistry.parseValue(raw, 'Value', null);
const xmlOf = (raw: unknown): string => parse(raw).serializeXml('P', { Name: 'Value' }, 0);

describe('an empty cell written from the node keeps its extents', () => {
  for (const dims of [[0, 3], [1, 0], [0, 1], [0, 3, 2]]) {
    it(`a ${dims.join('x')} cell is Dimension="${dims.join('*')}"`, () => {
      expect(xmlOf(cell(dims))).toBe(`<P Name="Value" Class="cell" Dimension="${dims.join('*')}"/>`);
    });
  }

  it('a 1x0 cell inside a cell keeps its extents too', () => {
    expect(xmlOf(cell([1, 2], [cell([1, 0]), 5]))).toBe(
      '<P Name="Value" Class="cell" Dimension="1*2">\n' +
        '    <Element Class="cell" Dimension="1*0"/>\n' +
        '    <Element Class="double">5.0</Element>\n' +
        '</P>',
    );
  });

  it('a 1x0 cell at a struct\'s field keeps its extents too', () => {
    const struct = { _array_type: 'Struct', _dimensions: [1, 1], _elements: [{ f: cell([1, 0]) }], _fields: ['f'] };
    expect(xmlOf(struct)).toContain('<P Name="f" Class="cell" Dimension="1*0"/>');
  });

  // What is not an empty's extents is written as before: a 0x0, a bag with no dims (1x1 by
  // default), and a cell whose only element was removed (dims set to 0x0 on removal).
  it('controls: a 0x0 cell, a cell bag with no _dimensions, and a cell emptied by removal stay Dimension="0*0"', () => {
    expect(xmlOf(cell([0, 0]))).toBe('<P Name="Value" Class="cell" Dimension="0*0"/>');
    expect(xmlOf(cell(undefined))).toBe('<P Name="Value" Class="cell" Dimension="0*0"/>');
    const one = parse(cell([1, 1], [7]));
    one.removeChildNode(one.children[0]);
    expect(one.serializeXml('P', { Name: 'Value' }, 0)).toBe('<P Name="Value" Class="cell" Dimension="0*0"/>');
  });
});

describe('a binary dictionary\'s empty-cell entry, regenerated, pasted and saved', () => {
  const VALUES: [string, string][] = [
    ['c03', '<P Name="Value" Class="cell" Dimension="0*3"/>'],
    ['c10', '<P Name="Value" Class="cell" Dimension="1*0"/>'],
    ['c00', '<P Name="Value" Class="cell" Dimension="0*0"/>'],
  ];
  const fragment = (name: string, n: number, value: string) =>
    `    <Object Class="DD.ENTRY">\n        <P Name="Name" Class="char">${name}</P>\n        <P Name="UUID" Class="char">00000000-0000-4000-ef41-00000000000${n}</P>\n` +
    `        <P Name="Namespace" Class="char">dacaf35e-55a5-454d-a7c1-93db038a210e</P>\n        <P Name="LastMod" Class="char">20261015T000000.000000</P>\n` +
    `        <P Name="LastModBy" Class="char"></P>\n        <P Name="IsDerived" Class="char">0</P>\n        ${value}\n    </Object>\n`;
  const valueIn = (xml: string, name: string): string => {
    const from = xml.indexOf('<P Name="Value"', xml.indexOf(`<P Name="Name" Class="char">${name}</P>`));
    return xml.slice(from, xml.indexOf('</Object>', from)).trimEnd();
  };
  const opened = () => {
    const files = unzipSync(new Uint8Array(sparseFixture(BINARY)));
    const xml = strFromU8(files['data/chunk0.xml']);
    files['data/chunk0.xml'] = strToU8(
      xml.replace('    <Object Class="DD.Dictionary">', VALUES.map(([n, v], i) => fragment(n, i, v)).join('') + '    <Object Class="DD.Dictionary">'),
    );
    const session = createSession();
    const root: any = ingest(session, buffer(zipSync(files)), { filename: BINARY });
    expect(root.warnings ?? []).toEqual([]);
    return { session, root };
  };
  const chunk = (session: any, root: any) => strFromU8(unzipSync(session.serializeSource(root.name)!.bytes!)['data/chunk0.xml']);

  it('reads each as its own size, and an untouched save writes each as read', () => {
    const { session, root } = opened();
    const design = root.getSection('design');
    expect(VALUES.map(([n]) => design.children.find((e: any) => e.name === n).dims)).toEqual([[0, 3], [1, 0], [0, 0]]);
    const saved = chunk(session, root);
    for (const [name, read] of VALUES) expect(valueIn(saved, name), name).toBe(read);
  });

  it('the writer, asked directly (regenerateChunkXml), writes each as read', () => {
    const { root } = opened();
    const regenerated = regenerateChunkXml(root);
    for (const [name, read] of VALUES) expect(valueIn(regenerated, name), name).toBe(read);
  });

  it('a copy pasted into the same dictionary is saved with the size it was copied with', () => {
    const { session, root } = opened();
    const design = root.getSection('design');
    VALUES.forEach(([name], i) => {
      const value = design.children.find((e: any) => e.name === name).serialize().value;
      design.parseEntry({ name: 'pasted_' + name, metadata: { uuid: `00000000-0000-4000-ef42-00000000000${i}` }, value });
    });
    const saved = chunk(session, root);
    for (const [name, read] of VALUES) expect(valueIn(saved, 'pasted_' + name), 'pasted_' + name).toBe(read);
  });
});
