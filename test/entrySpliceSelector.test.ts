// Copyright 2026 The MathWorks, Inc.
//
// Which entry a host's splice of a binary dictionary's chunk text lands on, when two entries share
// a name: `Kp` in Design Data and `Kp` in Other Data, which a binary dictionary holds as two
// entries of one name in two namespaces. One rule, said in two places: xmlEntrySplice.
// findEntryObjectSpan (the span a host deletes or replaces) and BinarySlddSerializer.
// spliceEntryObject (the entry a host writes an edit into) both match the name first and let the
// UUID break the tie, and a UUID neither entry holds falls back to the first of the name. So the
// two answer with the same entry, every time, and the edit of the second `Kp` is written over the
// second, and nothing else of the chunk moves.
//
// spliceEntryObject reads a chunk with the structure-aware scan a save uses, and one that scan
// cannot vouch for (an entry closed `</Object >`, which XML allows) with findEntryObjectSpan: the
// same entry either way. And keptPartsViolations holds an entry with no bytes it was read from to
// nothing, as it says.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unzipSync } from 'fflate';
import * as core from '../src/index.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import { findEntryElementSpan, findEntryObjectSpan } from '../src/datamodel/parser/xmlEntrySplice.js';
import { NS_DESIGN, NS_OTHER } from '../src/datamodel/SectionConstants.js';
import '../src/datamodel/node/data/NodeClassMap.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-23T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const DECL = '<?xml version="1.0" encoding="UTF-8"?>';
const DICTIONARY = '    <Object Class="DD.Dictionary">\n        <P Name="AccessBaseWorkspace" Class="logical">0</P>\n    </Object>\n';

function entryXml(name: string, uuid: string, namespace: string, value: number, close = '</Object>'): string {
  return '    <Object Class="DD.ENTRY">\n'
    + `        <P Name="Name" Class="char">${name}</P>\n`
    + `        <P Name="UUID" Class="char">${uuid}</P>\n`
    + `        <P Name="Namespace" Class="char">${namespace}</P>\n`
    + '        <P Name="LastMod" Class="char">20260101T000000.000000</P>\n'
    + '        <P Name="LastModBy" Class="char">u</P>\n'
    + '        <P Name="IsDerived" Class="char">0</P>\n'
    + `        <P Name="Value" Class="double">${value}.0</P>\n`
    + `    ${close}\n`;
}
const chunk = (body: string): string => `${DECL}\n<DataSource FormatVersion="1" MinRelease="R2014a">\n${body}${DICTIONARY}</DataSource>\n`;

// Two `Kp`s, Design Data's first, and an entry of another name between them.
const TWO_KP = chunk(entryXml('Kp', 'u-design', NS_DESIGN, 1) + entryXml('Ki', 'u-ki', NS_DESIGN, 2) + entryXml('Kp', 'u-other', NS_OTHER, 3));

function fromChunk(xml: string): { session: any; root: any } {
  const session = core.createSession();
  const root: any = session.addDataSource('mem://' + Math.random().toString(36).slice(2), parseBinarySlddParts(xml, {}), { path: 'x.sldd' });
  session.setActiveContext(root);
  return { session, root };
}

const kpOf = (root: any, section: string): any => root.getSection(section).children.find((e: any) => e.name === 'Kp');
const sliceOf = (xml: string, span: { offset: number; length: number }): string => xml.slice(span.offset, span.offset + span.length);

describe('two entries of one name', () => {
  it('are read as two, one in each section', () => {
    const { root } = fromChunk(TWO_KP);
    expect(kpOf(root, 'design').metadata.uuid).toBe('u-design');
    expect(kpOf(root, 'other').metadata.uuid).toBe('u-other');
  });

  it('findEntryObjectSpan finds each by its UUID, and the first of the name for a UUID neither holds', () => {
    const design = findEntryObjectSpan(TWO_KP, { name: 'Kp', uuid: 'u-design' })!;
    const other = findEntryObjectSpan(TWO_KP, { name: 'Kp', uuid: 'u-other' })!;
    expect(sliceOf(TWO_KP, design)).toContain('u-design');
    expect(sliceOf(TWO_KP, other)).toContain('u-other');
    expect(other.offset).toBeGreaterThan(design.offset);
    expect(findEntryObjectSpan(TWO_KP, { name: 'Kp', uuid: 'u-nobody' })).toEqual(design);
    expect(findEntryObjectSpan(TWO_KP, 'Kp')).toEqual(design);
    // And the span a delete removes is the second's line, the first left as it was.
    const gone = findEntryElementSpan(TWO_KP, { name: 'Kp', uuid: 'u-other' })!;
    const after = TWO_KP.slice(0, gone.offset) + TWO_KP.slice(gone.offset + gone.length);
    expect(after).toBe(chunk(entryXml('Kp', 'u-design', NS_DESIGN, 1) + entryXml('Ki', 'u-ki', NS_DESIGN, 2)));
  });

  it('spliceEntryObject writes the edit of the second over the second, and every other byte as it was', () => {
    const { root } = fromChunk(TWO_KP);
    const other = kpOf(root, 'other');
    expect(other.setProperty('Value', '7')).toBe(true);
    const spliced = core.spliceEntryObject(TWO_KP, other)!;
    expect(spliced).not.toBeNull();
    // Where findEntryObjectSpan says the second `Kp` is, and only there.
    const span = findEntryObjectSpan(TWO_KP, { name: 'Kp', uuid: 'u-other' })!;
    const written = spliced.slice(span.offset, spliced.length - (TWO_KP.length - span.offset - span.length));
    expect(spliced).toBe(TWO_KP.slice(0, span.offset) + written + TWO_KP.slice(span.offset + span.length));
    expect(written).toContain('<P Name="UUID" Class="char">u-other</P>');
    expect(written).toContain('<P Name="Value" Class="double">7.0</P>');
    // Read again, the edit is the second's, and the first is the value it was.
    const { root: again } = fromChunk(spliced);
    expect(kpOf(again, 'other').Value).toBe(7);
    expect(kpOf(again, 'design').Value).toBe(1);
  });

  it('spliceEntryObject, given a UUID neither holds, lands on the first of the name, as findEntryObjectSpan does', () => {
    const { root } = fromChunk(TWO_KP);
    const other = kpOf(root, 'other');
    expect(other.setProperty('Value', '7')).toBe(true);
    const spliced = core.spliceEntryObject(TWO_KP, other, { name: 'Kp', uuid: 'u-nobody' })!;
    const first = findEntryObjectSpan(TWO_KP, { name: 'Kp', uuid: 'u-nobody' })!;
    expect(spliced.startsWith(TWO_KP.slice(0, first.offset))).toBe(true);
    expect(spliced.endsWith(TWO_KP.slice(first.offset + first.length))).toBe(true);
    expect(spliced.slice(first.offset)).not.toContain('u-design');
  });
});

describe('a chunk the structure-aware scan cannot vouch for', () => {
  // Ki closed `</Object >`: well-formed XML, which the reader reads, but not the close MATLAB writes.
  const UNCLEAN = chunk(entryXml('Kp', 'u-kp', NS_DESIGN, 1) + entryXml('Ki', 'u-ki', NS_DESIGN, 2, '</Object >') + entryXml('Kd', 'u-kd', NS_DESIGN, 3));

  it('is read whole', () => {
    const { root } = fromChunk(UNCLEAN);
    expect(root.getSection('design').children.map((e: any) => [e.name, e.Value])).toEqual([['Kp', 1], ['Ki', 2], ['Kd', 3]]);
  });

  it('takes a splice of an entry by findEntryObjectSpan, with every byte around it as it was', () => {
    const { root } = fromChunk(UNCLEAN);
    const kp = root.getSection('design').children[0];
    expect(kp.setProperty('Value', '5')).toBe(true);
    const spliced = core.spliceEntryObject(UNCLEAN, kp)!;
    expect(spliced).not.toBeNull();
    const span = findEntryObjectSpan(UNCLEAN, 'Kp')!;
    expect(spliced.startsWith(UNCLEAN.slice(0, span.offset))).toBe(true);
    expect(spliced.endsWith(UNCLEAN.slice(span.offset + span.length))).toBe(true);
    expect(spliced).toContain('</Object >');
    const { root: again } = fromChunk(spliced);
    expect(again.getSection('design').children.map((e: any) => [e.name, e.Value])).toEqual([['Kp', 5], ['Ki', 2], ['Kd', 3]]);
  });
});

describe('keptPartsViolations', () => {
  it('holds an entry with no bytes it was read from to nothing', () => {
    const { session, root } = fromChunk(TWO_KP);
    const added = root.getSection('design').parseEntry({ name: 'Kn', metadata: { uuid: 'u-kn' }, value: 4 });
    expect(core.keptPartsViolations(added, 'anything at all')).toEqual([]);
    // And what the save writes for it is the writers' own text, which reads back as the value.
    const saved = new TextDecoder().decode(unzipSync(session.serializeSource(root.name).bytes)['data/chunk0.xml']);
    const { root: again } = fromChunk(saved);
    expect(again.getSection('design').children.find((e: any) => e.name === 'Kn').Value).toBe(4);
  });
});
