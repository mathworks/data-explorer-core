// Copyright 2026 The MathWorks, Inc.
//
// What the binary writers write from the model is escaped, all of it: an entry's UUID,
// Namespace, LastMod and IsDerived as its Name, LastModBy and Value always were
// (BinarySlddSerializer.regenerateEntryXml), and the DataSource attributes of a chunk generated
// whole (generatedChunkXml). The reader decodes XML's references in every one of them, so a
// UUID read from `x&amp;y` is `x&y`; written back as it stood, that was a bare `&`, a `<` that
// starts no tag, or a `</P>` that closes the element early, and a document no XML reader takes.
// An entry is written from the model when it is edited, added or pasted, and in a chunk whose
// pairing is refused; a chunk is generated whole when its DataSource has nowhere to put an entry.
//
// Well-formed here is strict: fast-xml-parser's XMLValidator, and, for the two things it lets
// through, every `&` a reference and no `<` in an attribute value.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { XMLValidator } from 'fast-xml-parser';
import { createSession } from '../src/index.js';
import { parseBinarySlddParts } from '../src/datamodel/parser/BinarySlddParser.js';
import { regenerateChunkXml, regenerateEntryXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import { NS_DESIGN } from '../src/datamodel/SectionConstants.js';
import '../src/datamodel/node/data/NodeClassMap.js';

// A rename stamps the entry with the time now: frozen, so a run is reproducible.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const DECL = '<?xml version="1.0" encoding="UTF-8"?>';
const DICTIONARY = '    <Object Class="DD.Dictionary">\n        <P Name="AccessBaseWorkspace" Class="logical">0</P>\n    </Object>\n';
const chunk = (body: string): string =>
  `${DECL}\n<DataSource FormatVersion="1" MinRelease="R2014a" Arch="maca64">\n${body}${DICTIONARY}</DataSource>\n`;

/** An entry as MATLAB writes one, with the text of each metadata line given as it stands in the file. */
function entryXml(name: string, meta: { uuid?: string; namespace?: string; lastMod?: string; lastModBy?: string; isDerived?: string } = {}): string {
  return '    <Object Class="DD.ENTRY">\n'
    + `        <P Name="Name" Class="char">${name}</P>\n`
    + `        <P Name="UUID" Class="char">${meta.uuid ?? 'u-' + name}</P>\n`
    + `        <P Name="Namespace" Class="char">${meta.namespace ?? NS_DESIGN}</P>\n`
    + `        <P Name="LastMod" Class="char">${meta.lastMod ?? '20260101T000000.000000'}</P>\n`
    + `        <P Name="LastModBy" Class="char">${meta.lastModBy ?? 'u'}</P>\n`
    + `        <P Name="IsDerived" Class="char">${meta.isDerived ?? '0'}</P>\n`
    + '        <P Name="Value" Class="double">1.0E+6</P>\n'
    + '    </Object>\n';
}

function fromChunk(xml: string): { session: any; root: any } {
  const session = createSession();
  const root: any = session.addDataSource('mem://' + Math.random().toString(36).slice(2), parseBinarySlddParts(xml, {}), { path: 'x.sldd' });
  return { session, root };
}
const savedChunk = (session: any, root: any): string =>
  new TextDecoder().decode(unzipSync(session.serializeSource(root.name).bytes)['data/chunk0.xml']);
const entries = (root: any): any[] => root.children.flatMap((s: any) => s.children);

/** Why `xml` is not well-formed, strictly; empty when it is. */
function malformed(xml: string): string[] {
  const out: string[] = [];
  const verdict = XMLValidator.validate(xml);
  if (verdict !== true) out.push(`XMLValidator: ${verdict.err.msg}`);
  const markup = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, '');
  for (const m of markup.matchAll(/&(?!(?:lt|gt|amp|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);)/g)) {
    out.push(`a bare & at ${m.index}: ${JSON.stringify(markup.slice(m.index - 20, m.index + 20))}`);
  }
  for (const m of markup.matchAll(/<[A-Za-z_:][-\w.:]*((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g)) {
    if (m[1].includes('<')) out.push(`a < in an attribute value: ${m[0]}`);
  }
  return out;
}

describe('the binary writers escape every metadata field they write', () => {
  it('a UUID and a Namespace that hold `&` and `<`, written from the model when the entry is renamed', () => {
    // The check refuses what it is here to refuse, and takes every reference XML has.
    expect(malformed('<a>x&amp;y &lt; &#38; &#x26;</a>')).toEqual([]);
    expect(malformed('<a>x&y</a>')).not.toEqual([]);
    expect(malformed('<a><b>x</b></b></a>')).not.toEqual([]);
    const xml = chunk(entryXml('a', { uuid: 'u&amp;1&lt;2', namespace: 'ns&amp;x&lt;y' }) + entryXml('b'));
    expect(malformed(xml)).toEqual([]);
    const { session, root } = fromChunk(xml);
    const [a] = entries(root);
    expect([a.metadata.uuid, a.metadata.namespace]).toEqual(['u&1<2', 'ns&x<y']);
    expect(a.setProperty('Name', 'aRenamed')).toBe(true);
    const out = savedChunk(session, root);
    expect(malformed(out)).toEqual([]);
    expect(out).toContain('<P Name="UUID" Class="char">u&amp;1&lt;2</P>');
    expect(out).toContain('<P Name="Namespace" Class="char">ns&amp;x&lt;y</P>');
    const back = entries(fromChunk(out).root).find((e: any) => e.name === 'aRenamed');
    expect([back.metadata.uuid, back.metadata.namespace]).toEqual(['u&1<2', 'ns&x<y']);
  });

  it('an IsDerived whose CDATA section holds `</P>`, written from the model when the entry is renamed', () => {
    const xml = chunk(entryXml('a', { isDerived: '<![CDATA[</P>]]>' }) + entryXml('b'));
    expect(malformed(xml)).toEqual([]);
    const { session, root } = fromChunk(xml);
    const [a] = entries(root);
    expect(a.metadata.isderived).toBe('</P>');
    expect(a.setProperty('Name', 'aRenamed')).toBe(true);
    const out = savedChunk(session, root);
    expect(malformed(out)).toEqual([]);
    expect(out).toContain('<P Name="IsDerived" Class="char">&lt;/P&gt;</P>');
    expect(entries(fromChunk(out).root).find((e: any) => e.name === 'aRenamed').metadata.isderived).toBe('</P>');
  });

  // A rename stamps LastMod afresh, so a LastMod is written as read only where the entry is not
  // edited and still written from the model: in a chunk whose pairing is refused, which a
  // comment after the entries makes it, and which every save writes from the model whole.
  it('a LastMod that holds `&` and `<`, in a chunk a save that edits nothing writes from the model', () => {
    const xml = chunk(entryXml('a', { lastMod: '20260101T000000.000000&amp;&lt;x' }) + '    <!-- a note -->\n');
    expect(malformed(xml)).toEqual([]);
    const { session, root } = fromChunk(xml);
    expect(entries(root)[0].metadata._rawLastMod).toBe('20260101T000000.000000&<x');
    const out = savedChunk(session, root);
    expect(out).toBe(regenerateChunkXml(root));
    expect(malformed(out)).toEqual([]);
    expect(out).toContain('<P Name="LastMod" Class="char">20260101T000000.000000&amp;&lt;x</P>');
    expect(entries(fromChunk(out).root)[0].metadata._rawLastMod).toBe('20260101T000000.000000&<x');
  });

  it('a pasted record whose UUID, Namespace, LastMod and IsDerived hold `&`, `<` and `>`', () => {
    const { session, root } = fromChunk(chunk(entryXml('a')));
    const metadata = { uuid: 'p&q', namespace: 'n<s', lastmod: 'l>m&', modifiedby: 'b&y', isderived: '<0>' };
    const pasted = root.getSection('design').parseEntry({ name: 'pasted', value: { _type: 'double', _value: '1' }, metadata });
    const out = savedChunk(session, root);
    expect(malformed(out)).toEqual([]);
    expect(regenerateEntryXml(pasted)).toContain(
      '<P Name="UUID" Class="char">p&amp;q</P>\n'
      + '        <P Name="Namespace" Class="char">n&lt;s</P>\n'
      + '        <P Name="LastMod" Class="char">l&gt;m&amp;</P>\n'
      + '        <P Name="LastModBy" Class="char">b&amp;y</P>\n'
      + '        <P Name="IsDerived" Class="char">&lt;0&gt;</P>\n',
    );
    const back = entries(fromChunk(out).root).find((e: any) => e.name === 'pasted');
    expect([back.metadata.uuid, back.metadata.namespace, back.metadata._rawLastMod, back.metadata.lastModifiedBy, back.metadata.isderived])
      .toEqual(['p&q', 'n<s', 'l>m&', 'b&y', '<0>']);
  });

  it('DataSource attributes that hold `"`, `&` and `<`, written when a self-closed DataSource is generated whole', () => {
    // XMLValidator takes a bare `&` and a `<` in an attribute value; the check does not.
    expect(malformed('<a b="x&y"/>')).not.toEqual([]);
    expect(malformed('<a b="x<y"/>')).not.toEqual([]);
    const xml = `${DECL}\n<DataSource FormatVersion="1&amp;" MinRelease="R2014a&lt;" Arch="a&quot;b"/>`;
    expect(malformed(xml)).toEqual([]);
    const { session, root } = fromChunk(xml);
    expect(root._dataSourceAttrs).toEqual({ FormatVersion: '1&', MinRelease: 'R2014a<', Arch: 'a"b' });
    root.addEntry('Simulink.Parameter', 'pFirst', 'design');
    const out = savedChunk(session, root);
    expect(malformed(out)).toEqual([]);
    expect(out).toContain('<DataSource FormatVersion="1&amp;" MinRelease="R2014a&lt;" Arch="a&quot;b">');
    const back = fromChunk(out).root;
    expect(back._dataSourceAttrs).toEqual(root._dataSourceAttrs);
    expect(entries(back).map((e: any) => e.name)).toEqual(['pFirst']);
  });
});
