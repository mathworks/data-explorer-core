// Copyright 2026 The MathWorks, Inc.
//
// A binary dictionary's chunk the reader reads although it does not close its `<DataSource>`,
// saved. A save writes a chunk in the frame it was read in, its entries at their own places,
// and regenerates only the dictionary-level objects after them when they changed, up to the
// `</DataSource>` it keeps the text after. A chunk with no `</DataSource>` has no such place, so
// it is written whole by the writers, changed or not: a document that closes, with every entry
// and the dictionary-level object in it, and that reads back as the session showed it. The
// reader is what gives the frame up: it frames no chunk its markup scan cannot vouch for (an
// unclosed root is one) or whose last entry no `</DataSource>` follows (BinarySlddParser.
// entryFrame), so the writer's own check for the close tag (framedChunkXml) is a second guard
// that a chunk the reader read does not reach.

import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import * as core from '../src/index.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import { NS_DESIGN } from '../src/datamodel/SectionConstants.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const ENTRY = '    <Object Class="DD.ENTRY">\n'
  + '        <P Name="Name" Class="char">Kp</P>\n'
  + '        <P Name="UUID" Class="char">u-kp</P>\n'
  + `        <P Name="Namespace" Class="char">${NS_DESIGN}</P>\n`
  + '        <P Name="LastMod" Class="char">20260101T000000.000000</P>\n'
  + '        <P Name="LastModBy" Class="char">u</P>\n'
  + '        <P Name="IsDerived" Class="char">0</P>\n'
  + '        <P Name="Value" Class="double">1.0</P>\n'
  + '    </Object>\n';
const OPEN = '<?xml version="1.0" encoding="UTF-8"?>\n<DataSource FormatVersion="1" MinRelease="R2014a">\n';
const DICTIONARY = '    <Object Class="DD.Dictionary">\n        <P Name="AccessBaseWorkspace" Class="logical">0</P>\n    </Object>\n';
const UNCLOSED = OPEN + ENTRY + DICTIONARY;

function open(xml: string): { session: any; root: any; srcId: string } {
  const session = core.createSession();
  const srcId = 'mem://' + Math.random().toString(36).slice(2);
  const root: any = session.addDataSource(srcId, parseBinarySlddParts(xml, {}), { path: 'x.sldd' });
  return { session, root, srcId };
}
const savedChunk = (session: any, srcId: string): string => new TextDecoder().decode(unzipSync(session.serializeSource(srcId).bytes)['data/chunk0.xml']);

describe('a chunk with no </DataSource>', () => {
  it('is read, its entry and its dictionary object', () => {
    const { root } = open(UNCLOSED);
    expect(root.getSection('design').children.map((e: any) => [e.name, e.Value])).toEqual([['Kp', 1]]);
    expect(root.allowAccessBWS).toBe(false);
  });

  it('saved unchanged, is written whole too, closed, its entry as the writers write it', () => {
    const { session, srcId } = open(UNCLOSED);
    const saved = savedChunk(session, srcId);
    expect(saved).toBe(UNCLOSED + '</DataSource>');
  });

  it('saved with its dictionary object changed, is written whole, and closes', () => {
    const { session, root, srcId } = open(UNCLOSED);
    root.allowAccessBWS = true;
    const saved = savedChunk(session, srcId);
    expect(saved.trimEnd().endsWith('</DataSource>')).toBe(true);
    expect(saved).toContain('<P Name="AccessBaseWorkspace" Class="logical">1</P>');
    expect(saved.split('<Object Class="DD.ENTRY">').length - 1).toBe(1);
    const { root: again } = open(saved);
    expect(again.getSection('design').children.map((e: any) => [e.name, e.Value, e.metadata.uuid])).toEqual([['Kp', 1, 'u-kp']]);
    expect(again.allowAccessBWS).toBe(true);
  });

  it('and no entries, saved with its dictionary object changed, is written whole, and closes', () => {
    const { session, root, srcId } = open(OPEN + DICTIONARY);
    expect(root.getSection('design').children).toEqual([]);
    root.allowAccessBWS = true;
    const saved = savedChunk(session, srcId);
    expect(saved.trimEnd().endsWith('</DataSource>')).toBe(true);
    const { root: again } = open(saved);
    expect(again.allowAccessBWS).toBe(true);
    expect(again.getSection('design').children).toEqual([]);
    // Unchanged, it is written closed as well, and otherwise as it was read.
    const kept = open(OPEN + DICTIONARY);
    expect(savedChunk(kept.session, kept.srcId)).toBe(OPEN + DICTIONARY + '</DataSource>');
  });

  it('closed, and saved with the same change, keeps its entry\'s bytes and regenerates only what follows them', () => {
    const closed = UNCLOSED + '</DataSource>\n';
    const { session, root, srcId } = open(closed);
    root.allowAccessBWS = true;
    const saved = savedChunk(session, srcId);
    expect(saved).toContain(ENTRY);
    expect(saved).toBe(closed.replace('logical">0<', 'logical">1<'));
  });
});
