// Copyright 2026 The MathWorks, Inc.
//
// An entry handed to a section with metadata that names no namespace, the way core's own API
// takes one: `section.parseEntry({ name, metadata: { uuid }, value })`. It was written with an
// empty Namespace into a binary dictionary and with none into a text one, and MATLAB refuses to
// open either file, whole: "Failed to open file", measured on R2027a with a pasted 5 in
// sparse_text, sparse_binary, char_text and char_binary. With the namespace taken from the
// section the binary files open; the text ones still did not, because MATLAB refuses a text
// dictionary whose entry lacks any of uuid, namespace, lastmod, modifiedby and isderived
// (measured on sparse_text, one file per subset; the order of the keys does not matter). So an
// entry handed in takes the section's namespace and isderived, as a host's paste supplies them,
// and in a text dictionary a lastmod and an empty modifiedby too, as addEntry stamps them. A
// value the metadata names is kept as given.
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { NS_CONFIGURATIONS, NS_DESIGN, NS_OTHER } from '../src/datamodel/SectionConstants.js';

const FILES = ['sparse/sparse_text.sldd', 'sparse/sparse_binary.sldd', 'char_text.sldd', 'char_binary.sldd'];
const SECTIONS: [string, string, string][] = [['design', NS_DESIGN, '0'], ['arch', NS_DESIGN, '1'], ['config', NS_CONFIGURATIONS, '0'], ['other', NS_OTHER, '0']];
const UUID = '00000000-0000-4000-e830-000000000001';
// The clock, frozen: a text paste is stamped with the time it was made, and a binary save
// stamps an entry with no time of its own with the time it was written. Either is this.
const NOW = '20261018T120000.000000';

function fixture(path: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${path}`, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

const filename = (path: string) => path.split('/').pop()!;

/** The metadata a saved file holds for the entry `name`: a text dictionary's as written, a binary one's as its Object's fields. */
function writtenMetadata(out: any, name: string): unknown {
  if (out.kind === 'text') {
    const parts = JSON.parse(out.text).__MW_TEXT_PARTS__;
    const entries = Object.values(parts).flatMap((part: any) => part?.__MW_TEXT_content?.entries ?? []);
    return (entries.find((e: any) => e.name === name) as any).metadata;
  }
  const xml = strFromU8(unzipSync(out.bytes)['data/chunk0.xml']);
  const object = xml.split('<Object Class="DD.ENTRY">').find((o) => o.includes(`<P Name="Name" Class="char">${name}</P>`))!;
  const field = (p: string) => new RegExp(`<P Name="${p}" Class="char">([^<]*)</P>`).exec(object)?.[1];
  return { uuid: field('UUID'), namespace: field('Namespace'), lastmod: field('LastMod'), modifiedby: field('LastModBy'), isderived: field('IsDerived') };
}

/** `rawEntry` handed to `section` of a fresh `file`, saved, and the saved file opened again. */
function pasteSaveReopen(file: string, section: string, rawEntry: Record<string, unknown>) {
  const session = createSession();
  const root: any = ingest(session, fixture(file), { filename: filename(file) });
  const node = root.getSection(section).parseEntry(rawEntry);
  const out: any = session.serializeSource(root.name);
  const reopened: any = ingest(createSession(), out.kind === 'text' ? out.text : out.bytes, { filename: filename(file) });
  const home = reopened.children.find((s: any) => s.children.some((e: any) => e.name === rawEntry.name));
  return { shown: node.metadata?.namespace, written: writtenMetadata(out, rawEntry.name as string), reopenedIn: home?.name };
}

describe('an entry handed to a section with metadata that names no namespace', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const lacking: [string, () => Record<string, unknown>][] = [
    ['metadata of a uuid alone', () => ({ name: 'pasted', metadata: { uuid: UUID }, value: 5 })],
    ['an empty namespace and isderived', () => ({ name: 'pasted', metadata: { uuid: UUID, namespace: '', isderived: '' }, value: 5 })],
  ];
  for (const file of FILES) {
    for (const [label, rawEntry] of lacking) {
      it(`${file}, ${label}: takes the section's namespace, is written with all that MATLAB reads, and reopens in that section`, () => {
        const got = SECTIONS.map(([section]) => [section, pasteSaveReopen(file, section, rawEntry())]);
        expect(got).toEqual(SECTIONS.map(([section, namespace, isderived]) => [
          section,
          { shown: namespace, written: { uuid: UUID, namespace, lastmod: NOW, modifiedby: '', isderived }, reopenedIn: section },
        ]));
      });
    }
  }

  it('the metadata handed in is not changed, and the copy holds its keys in MATLAB\'s order, then the rest', () => {
    for (const file of FILES) {
      const metadata = { uuid: UUID, extra: 'x', isderived: '0' };
      const session = createSession();
      const root: any = ingest(session, fixture(file), { filename: filename(file) });
      const node = root.getSection('config').parseEntry({ name: 'pasted', metadata, value: 5 });
      const text = file.includes('text');
      expect([metadata, node.metadata, Object.keys(node.metadata)], file).toEqual([
        { uuid: UUID, extra: 'x', isderived: '0' },
        text
          ? { uuid: UUID, namespace: NS_CONFIGURATIONS, lastmod: NOW, modifiedby: '', isderived: '0', extra: 'x' }
          : { uuid: UUID, namespace: NS_CONFIGURATIONS, isderived: '0', extra: 'x' },
        text ? ['uuid', 'namespace', 'lastmod', 'modifiedby', 'isderived', 'extra'] : ['uuid', 'namespace', 'isderived', 'extra'],
      ]);
    }
  });

  it('what the metadata names is kept as given: another section\'s namespace, a time and an author', () => {
    for (const file of FILES) {
      const metadata = { uuid: UUID, namespace: NS_OTHER, lastmod: '20250101T000000.000000', modifiedby: 'someone', isderived: '0' };
      expect(pasteSaveReopen(file, 'design', { name: 'pasted', metadata, value: 5 }), file).toEqual({ shown: NS_OTHER, written: metadata, reopenedIn: 'other' });
    }
  });

  it('a binary reader\'s time and author, pasted into a text dictionary, are its lastmod and modifiedby', () => {
    // The keys BinarySlddParser files them under; the text writer renames them (DataNode's
    // textDictionaryMetadata). A stamp of the paste's own would have replaced them.
    const metadata = { uuid: UUID, lastModifiedDate: '2025-01-01T00:00:00.000Z', lastModifiedBy: 'someone', _rawLastMod: '20250101T000000.000000' };
    for (const file of FILES.filter((f) => f.includes('text'))) {
      expect(pasteSaveReopen(file, 'design', { name: 'pasted', metadata, value: 5 }).written, file).toEqual({
        uuid: UUID, namespace: NS_DESIGN, lastmod: '20250101T000000.000000', modifiedby: 'someone', isderived: '0',
      });
    }
  });
});
