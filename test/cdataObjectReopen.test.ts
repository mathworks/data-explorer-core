// Copyright 2026 The MathWorks, Inc.
//
// An MCOS object a binary dictionary holds as hex, pasted into a text dictionary, saved and
// opened again: it opens as the object it was.
//
// MATLAB writes an entry as hex when its value holds a sparse array or a function handle,
// and an object rides in the stream with its subsystem: a Simulink.Parameter whose Value is
// sparse, an alias type with a function-handle property, a struct or a cell of objects.
// Pasted into a text dictionary such an entry is written as the cdata of the same stream
// (MatWriter.textDictionaryForm), which MATLAB reads back as the object. This package's own
// text reader did not: MatlabVariableNode.parseCdata built the stream's variable without its
// subsystem, where parseEncoded decodes it (attachMcosDecoded). So it reopened as an opaque
// `<1x1 Simulink.Parameter>`, with no Value row and no properties, and as a plain variable
// it refused the edits a Parameter takes ("A MATLAB Variable has no Description"). A struct
// or a cell holding objects reopened with each of them so.
//
// Reopened now, the entry is the node its binary twin is. It is read-only, as the binary
// twin is, but for an allow-listed property of a Simulink.Parameter or a Simulink.Signal in
// it, whose edit a save writes into the stream's subsystem (slddStreamObjects.test.ts). A save
// of it unedited writes the cdata it was read from, and a copy back into a binary dictionary
// is the hex MATLAB wrote.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import { serializeEntryToXml } from '../src/datamodel/parser/BinarySlddSerializer.js';
import '../src/datamodel/node/data/NodeClassMap.js';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/sparse/${name}`, import.meta.url))));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const chunkOf = (zip: Uint8Array): string => new TextDecoder().decode(unzipSync(zip)['data/chunk0.xml']);

const open = (session: any, bytes: Uint8Array, filename: string): any => ingest(session, buffer(bytes), { filename });
const subtree = (node: any): any[] => [node, ...node.children.flatMap(subtree)];

/** Every row under an entry as it is shown: where it stands under the entry, its class and its value. */
const rows = (entry: any): string[] =>
  subtree(entry).map((n: any) => `${n.id.slice(entry.id.length)} ${n.constructor.name} ${n.className} ${n.displayValue}`);

/** An entry's Value element, exactly as written. */
function valueTag(xml: string, name: string): string {
  const at = xml.indexOf('<P Name="Name" Class="char">' + name + '</P>');
  expect(at, name).toBeGreaterThan(-1);
  const from = xml.indexOf('<P Name="Value"', at);
  return xml.slice(from, xml.indexOf('</P>', from) + 4);
}

const ENCODED_REASON = /is stored as an encoded MATLAB value that this editor can show but not write/;

// The binary dictionaries and their MATLAB-written text twins, and the hex entries in each
// whose stream holds an MCOS object.
const VENUES = [
  { binary: 'sparse_binary.sldd', text: 'sparse_text.sldd', objects: ['fhAlias', 'pSp', 'pSpComplex', 'pSpLogical'] },
  { binary: 'hexobj_binary.sldd', text: 'hexobj_text.sldd', objects: ['anonAlias', 'holder', 'objs', 'objsCell', 'pTall'] },
];

/**
 * The venue's object entries pasted into its text twin as a host pastes them (the entry's own
 * serialize(), deep-copied, under a fresh name and uuid), the text dictionary saved, and the
 * saved file opened again in a session of its own.
 */
function pastedAndReopened(venue: (typeof VENUES)[number]) {
  const session = createSession();
  const binary = open(session, fixture(venue.binary), venue.binary);
  const text = open(session, fixture(venue.text), venue.text);
  let seq = 0;
  for (const name of venue.objects) {
    const source = binary.getSection('design').children.find((e: any) => e.name === name);
    const payload: any = JSON.parse(JSON.stringify(source.serialize()));
    payload.name = name + 'Pasted';
    payload.metadata = { ...payload.metadata, uuid: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` };
    text.getSection('design').parseEntry(payload);
  }
  const saved = session.serializeSource(text.name).text as string;
  const reopenedSession = createSession();
  const reopened = open(reopenedSession, new TextEncoder().encode(saved), venue.text);
  return { binary, saved, reopenedSession, reopened };
}

const entryOf = (root: any, name: string): any => root.getSection('design').children.find((e: any) => e.name === name);

describe('the fixtures are what these tests need', () => {
  for (const venue of VENUES) {
    it(`${venue.binary}: its hex entries holding an MCOS object are these`, () => {
      const design = open(createSession(), fixture(venue.binary), venue.binary).getSection('design');
      const objects = design.children
        .filter((e: any) => e._encoded && subtree(e).some((n: any) => n.constructor.name !== 'MatlabVariableNode'))
        .map((e: any) => e.name);
      expect(objects.sort()).toEqual([...venue.objects].sort());
    });
  }
});

describe('a hex object pasted into a text dictionary reopens as the object it was', () => {
  for (const venue of VENUES) {
    const { binary, saved, reopened } = pastedAndReopened(venue);
    for (const name of venue.objects) {
      it(`${venue.binary} ${name}: the same rows as in the binary dictionary`, () => {
        const written = JSON.parse(saved).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find(
          (e: any) => e.name === name + 'Pasted',
        ).value;
        // Written as one stream, which is what the reader below has to read.
        expect(written._type).toBe('cdata');
        expect(rows(entryOf(reopened, name + 'Pasted'))).toEqual(rows(entryOf(binary, name)));
      });
    }
  }

  it('a Parameter among them has its Value row back', () => {
    const { reopened } = pastedAndReopened(VENUES[0]);
    const pSp = entryOf(reopened, 'pSpPasted');
    expect(pSp.constructor.name).toBe('ParameterNode');
    expect(pSp.displayValue).toBe('<3x3 sparse double>');
    expect(pSp.children.map((c: any) => [c.name, c.displayValue])).toEqual([['Value', '<3x3 sparse double>']]);
  });
});

describe('reopened, it is read-only, as it is in the binary dictionary: only its name edits, and an object\'s property a save writes', () => {
  // As in the binary dictionary (hexObjectFixtures.test.ts): an allow-listed property of a
  // Simulink.Parameter or a Simulink.Signal that MATLAB stored a value for takes an edit, which a save
  // writes into the stream's subsystem (slddStreamObjects.test.ts), and every other property of those
  // two, and anything under a sparse Value of one, is refused by the rules. Everything else is
  // refused with the words an encoded value always had.
  const TAKEN: Record<string, string[]> = { 'objs.sig': ['Min'], 'objs.prm': ['Value'], 'objsCell{2}': ['Min'], 'objsCell{7}': ['Value'] };
  const ruled = (node: any, path: string): boolean =>
    /^Simulink\.(Parameter|Signal)$/.test(node.className) || /^(pSp|pSpComplex|pSpLogical|pTall)\.Value\b/.test(path);
  for (const venue of VENUES) {
    const { reopened } = pastedAndReopened(venue);
    for (const name of venue.objects) {
      it(`${venue.binary} ${name}`, () => {
        const entry = entryOf(reopened, name + 'Pasted');
        for (const node of subtree(entry)) {
          const path = name + node.matlabPath.slice(entry.matlabPath.length);
          const taken = TAKEN[path] ?? [];
          const label = `${name}: ${node.id} (${node.constructor.name})`;
          expect(node.valueEditable, label).toBe(taken.includes('Value'));
          expect(node.nameEditable, label).toBe(node === entry);
          expect(typeof node.canAddChild === 'function' ? node.canAddChild() : false, label).toBe(false);
          expect(typeof node.canRemoveChild === 'function' ? node.canRemoveChild() : false, label).toBe(false);
          for (const prop of ['Value', 'Description', 'DataType', 'Min']) {
            const result = node.setProperty(prop, '1');
            if (taken.includes(prop)) {
              expect(result, `${label} ${prop}`).toBe(true);
            } else if (ruled(node, path)) {
              expect(result, `${label} ${prop}`).toMatchObject({ error: true });
            } else {
              expect(result, `${label} ${prop}`).toMatchObject({ error: true, reason: expect.stringMatching(ENCODED_REASON) });
            }
          }
        }
      });
    }
  }
});

describe('a save of the reopened dictionary writes the cdata it read, and a copy back is MATLAB\'s hex', () => {
  for (const venue of VENUES) {
    it(`${venue.binary}: saved again untouched, the same text`, () => {
      const { saved, reopenedSession, reopened } = pastedAndReopened(venue);
      expect(reopenedSession.serializeSource(reopened.name).text).toBe(saved);
    });

    it(`${venue.binary}: renamed, each is saved with the stream it was read with`, () => {
      const { saved, reopenedSession, reopened } = pastedAndReopened(venue);
      const valueOf = (text: string, name: string): unknown =>
        JSON.parse(text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === name).value;
      for (const name of venue.objects) {
        expect(entryOf(reopened, name + 'Pasted').setProperty('Name', name + 'Renamed'), name).toBe(true);
      }
      const resaved = reopenedSession.serializeSource(reopened.name).text;
      for (const name of venue.objects) {
        expect(valueOf(resaved, name + 'Renamed'), name).toEqual(valueOf(saved, name + 'Pasted'));
      }
    });

    it(`${venue.binary}: copied back into the binary dictionary, the element MATLAB wrote`, () => {
      const { reopened } = pastedAndReopened(venue);
      const session = createSession();
      const binary = open(session, fixture(venue.binary), venue.binary);
      const matlab = chunkOf(fixture(venue.binary));
      for (const name of venue.objects) {
        const payload: any = JSON.parse(JSON.stringify(entryOf(reopened, name + 'Pasted').serialize()));
        payload.name = name + 'Back';
        const back = binary.getSection('design').parseEntry(payload);
        expect(valueTag(serializeEntryToXml(back), name + 'Back'), name).toBe(valueTag(matlab, name));
      }
    });
  }
});
