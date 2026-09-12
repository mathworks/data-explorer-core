// Copyright 2026 The MathWorks, Inc.
// Unit tests for the `.sldd` name/reference scanner (src/datamodel/parser/SlddScan.ts).
//
// The scanner exists to skip building the entry tree, so almost nothing here asserts a
// hand-written expected value. What it asserts instead is AGREEMENT WITH THE FULL PARSER,
// because that is the entire contract: `scanSldd` must be indistinguishable from
// `readSlddContent` for these two fields, on every input, including the ones it refuses.
// A test that pinned a literal name list would pass while the two readers disagreed.
//
// The suites come in pairs, and the pairing is the point. For each shape:
//
//   * `scanDataSourceXml` says whether the FAST PATH ran or refused, and
//   * `scanSldd` says whether the ANSWER is right either way.
//
// Only the first can fail vacuously. A single-assertion suite comparing `scanSldd` to the
// reference would stay green if every guard broke and every file fell back — the answers
// would still be right, and the 28x would be silently gone. So the accept cases assert
// that the scan really scanned, and the refuse cases assert both that the guard fired and
// that the fallback covered for it.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { scanDataSourceXml } from '../src/datamodel/parser/SlddScan.js';
import {
  normalizeRefNames,
  readSlddContent,
  scanSldd,
  slddChunkContent,
  isJsonTextBytes,
  DATA_PART_KEY,
  TEXT_CONTENT,
  TEXT_PARTS,
} from '../src/index.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

function fixtureBuffer(name: string): ArrayBuffer {
  const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/**
 * THE REFERENCE. Taken off the full parse, and deliberately NOT filtered: `parseEntry`
 * does `getProperty(obj, 'Name') || ''` and pushes the entry regardless, so an entry with
 * no readable name still holds a position in `entries`. Filtering here would let a
 * candidate that also drops it pass while shifting every later name by one.
 */
function reference(bytes: ArrayBuffer): { names: string[]; refs: string[] } {
  const content = slddChunkContent(readSlddContent(bytes, []));
  const entries = (content?.entries ?? []) as { name?: unknown }[];
  return {
    names: entries.map((e) => (typeof e?.name === 'string' ? e.name : '')),
    refs: content ? normalizeRefNames(content['Dictionary References']) : [],
  };
}

/** Whatever a call produced — a value or the message it threw. Compared as one. */
function outcome(fn: () => unknown): unknown {
  try {
    return { ok: fn() };
  } catch (e) {
    return { threw: (e as Error).message };
  }
}

/**
 * The core assertion: for these bytes the scanner and the full parser are the same
 * reader. Written over `outcome` so it also holds for input that makes BOTH fail — a
 * scanner that succeeded where the parser throws would be inventing data.
 */
function expectAgreesWithFullParse(bytes: ArrayBuffer): void {
  expect(outcome(() => scanSldd(bytes, []))).toEqual(outcome(() => reference(bytes)));
}

// ---- fixture-wide sweep -------------------------------------------------------------

// Read from disk rather than listed literally, so a dictionary fixture added for some
// unrelated reason is covered by this the day it lands.
const slddFixtures = readdirSync(FIXTURES)
  .filter((n) => n.endsWith('.sldd'))
  .sort();

describe('scanSldd — agrees with the full parser on every committed fixture', () => {
  it('found the fixtures at all', () => {
    // Guards the glob: an empty list would make every it.each below disappear silently
    // and the suite would report success having asserted nothing.
    expect(slddFixtures.length).toBeGreaterThan(15);
  });

  it.each(slddFixtures)('%s', (name) => {
    expectAgreesWithFullParse(fixtureBuffer(name));
  });

  it('covers both on-disk spellings, not just one', () => {
    // The two spellings take entirely different paths — byte scan vs JSON.parse — so a
    // sweep over 22 files of one spelling would leave half the module untested.
    const spellings = slddFixtures.map((n) => isJsonTextBytes(new Uint8Array(fixtureBuffer(n))));
    expect(spellings.filter(Boolean).length).toBeGreaterThan(0);
    expect(spellings.filter((t) => !t).length).toBeGreaterThan(0);
  });
});

describe('scanSldd — the fast path actually runs', () => {
  // Without this, every assertion above would still pass with all four guards jammed on
  // and every file falling back to the parser the scanner was written to avoid.
  const zipFixtures = slddFixtures.filter((n) => !isJsonTextBytes(new Uint8Array(fixtureBuffer(n))));

  it.each(zipFixtures)('%s is scanned, not refused', (name) => {
    const xml = chunkXml(fixtureBuffer(name));
    expect(() => scanDataSourceXml(xml)).not.toThrow();
  });

  it('scans a dictionary whose FormatVersion is not 1', () => {
    // compressed.sldd carries FormatVersion="4" with a version-1 shape. An earlier draft
    // gated on `FormatVersion="1"` and pushed this onto the slow path for no gain; the
    // guards that matter check the SHAPE. This is the test that pins that decision, and
    // the tripwire if a future version ever needs different handling.
    const bytes = fixtureBuffer('compressed.sldd');
    const xml = new TextDecoder().decode(chunkXml(bytes));
    expect(xml).toContain('FormatVersion="4"');
    expect(scanDataSourceXml(chunkXml(bytes)).names).toEqual(reference(bytes).names);
  });
});

// ---- accepted shapes ----------------------------------------------------------------

describe('scanDataSourceXml — shapes it reads directly', () => {
  it.each([
    ['a plain entry', entry('Kp'), ['Kp']],
    ['several entries, in document order', entry('A') + entry('B') + entry('C'), ['A', 'B', 'C']],
    ['a non-ASCII name', entry('Kp_é中'), ['Kp_é中']],
    // `>` is legal inside an attribute value. The tag walk skips quoted spans, so this
    // must not be read as the end of the tag.
    ['a `>` inside an attribute value', `<Object Class="DD.ENTRY"><P Name="Name" Class="char" X="a>b">Kp</P></Object>`, ['Kp']],
    // Both spellings of "no value". The reference turns each into '', and the position is
    // KEPT rather than dropped — see `reference` above.
    ['an empty name written <P></P>', `<Object Class="DD.ENTRY"><P Name="Name" Class="char"></P></Object>`, ['']],
    ['an empty name written <P/>', `<Object Class="DD.ENTRY"><P Name="Name" Class="char"/></Object>`, ['']],
    ['an unrelated object class', `<Object Class="DD.Dictionary"><P Name="AllowAccessBWS" Class="bool">1</P></Object>`, []],
    ['indentation and newlines between the tags', `<Object Class="DD.ENTRY">\n        <P Name="Name" Class="char">Kp</P>\n    </Object>`, ['Kp']],
  ])('reads %s', (_label, inner, names) => {
    expect(scanDataSourceXml(xmlBytes(inner)).names).toEqual(names);
    // ...and the parser it replaces says the same thing about the same bytes.
    expectAgreesWithFullParse(slddZip(inner));
  });

  it('keeps an empty name in position rather than dropping it', () => {
    // The sharp one. Dropping the middle entry would leave ['A','C'] — every name after
    // the hole shifted by one against a consumer that indexes positionally, which is a
    // wrong-name bug rather than a missing-name one.
    const inner = entry('A') + `<Object Class="DD.ENTRY"><P Name="Name" Class="char"/></Object>` + entry('C');
    expect(scanDataSourceXml(xmlBytes(inner)).names).toEqual(['A', '', 'C']);
    expectAgreesWithFullParse(slddZip(inner));
  });

  it('keeps scanning past a self-closing <Object/>, which has no </Object>', () => {
    // A depth counter that treated `<Object ... />` as an opening tag would sit at 1 for
    // the rest of the document and refuse the very next entry as nested. The answer would
    // still be right — the fallback would produce it — so only an assertion about the
    // FAST PATH catches this. Mutation testing is what found the gap: removing the
    // self-closing check broke no test until this one existed.
    const inner = `<Object Class="DD.Dictionary"/>${entry('Kp')}`;
    expect(scanDataSourceXml(xmlBytes(inner)).names).toEqual(['Kp']);
    expectAgreesWithFullParse(slddZip(inner));
  });

  it('reads a Subdictionary reference', () => {
    const inner = ref('child.sldd');
    expect(scanDataSourceXml(xmlBytes(inner))).toEqual({ names: [], refs: ['child.sldd'] });
    expectAgreesWithFullParse(slddZip(inner));
  });

  it('reads entries and references from the same document, each in order', () => {
    const inner = entry('A') + ref('one.sldd') + entry('B') + ref('two.sldd');
    expect(scanDataSourceXml(xmlBytes(inner))).toEqual({
      names: ['A', 'B'],
      refs: ['one.sldd', 'two.sldd'],
    });
    expectAgreesWithFullParse(slddZip(inner));
  });

  it('drops an empty Subdictionary, as normalizeRefNames does', () => {
    // Asymmetric with names ON PURPOSE, and the asymmetry is the reference's, not this
    // module's: `normalizeRefNames` filters `''` and it is what defines this field.
    const inner = `<Object Class="DD.DICTIONARYREFERENCE"><P Name="Subdictionary" Class="char"/></Object>`;
    expect(scanDataSourceXml(xmlBytes(inner)).refs).toEqual([]);
    expectAgreesWithFullParse(slddZip(inner));
  });
});

// ---- refusals ------------------------------------------------------------------------

describe('scanDataSourceXml — shapes it refuses, and the fallback that covers them', () => {
  // Each row is a shape the scanner has NOT been proven equivalent on. Two assertions
  // per row: the guard fires, AND the answer is still the parser's. The second is what
  // makes a refusal a performance choice instead of a bug.
  const REFUSED: [string, string, RegExp][] = [
    [
      // fast-xml-parser decodes entities (`processEntities` defaults on), so reading this
      // as plain bytes would yield `A&amp;B` where the parser yields `A&B`. Mirroring its
      // table is the divergence risk; refusing is free, since no corpus name has one.
      'an entity reference in a name',
      `<Object Class="DD.ENTRY"><P Name="Name" Class="char">A&amp;B</P></Object>`,
      /entity/i,
    ],
    ['CDATA where the text should be', `<Object Class="DD.ENTRY"><P Name="Name" Class="char"><![CDATA[Kp]]></P></Object>`, /CDATA|comment/i],
    [
      // The one that would INVENT an entry: a flat scan sees two DD.ENTRY tags where the
      // parser, which reads only <DataSource>'s direct children, reports one.
      'an <Object> nested inside an <Object>',
      `<Object Class="DD.ENTRY"><P Name="Name" Class="char">Outer</P>${entry('Inner')}</Object>`,
      /nested/i,
    ],
    [
      // The parser searches all direct <P> children; the scanner reads the first one. When
      // those differ, guessing would return a name from the wrong property.
      'a Name that is not the first property',
      `<Object Class="DD.ENTRY"><P Name="UUID" Class="char">u</P><P Name="Name" Class="char">Kp</P></Object>`,
      /first child/i,
    ],
    ['a self-closing <Object/> with no properties', `<Object Class="DD.ENTRY"/>`, /first child/i],
    ['an unterminated tag', `<Object Class="DD.ENTRY"><P Name="Name" Class="char`, /unterminated/i],
    ['a missing </Object>', `<Object Class="DD.ENTRY"><P Name="Name" Class="char">Kp</P>`, /unclosed/i],
  ];

  it.each(REFUSED)('refuses %s', (_label, inner, why) => {
    expect(() => scanDataSourceXml(xmlBytes(inner))).toThrow(why);
  });

  it.each(REFUSED)('still answers correctly for %s, via the full parse', (_label, inner) => {
    expectAgreesWithFullParse(slddZip(inner));
  });

  it('refuses a root element that is not <DataSource>', () => {
    const xml = `<?xml version="1.0"?><Other>${entry('Kp')}</Other>`;
    expect(() => scanDataSourceXml(new TextEncoder().encode(xml))).toThrow(/root element/i);
    expectAgreesWithFullParse(zipOf(xml));
  });

  it('falls back for a zip with no data/chunk0.xml', () => {
    const z = zipSync({ 'meta.xml': strToU8('<x/>') });
    expectAgreesWithFullParse(z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer);
  });

  it('falls back for bytes that are neither JSON nor a zip', () => {
    // The full parser's diagnostic must survive: test/ingestDispatch.test.ts matches
    // /invalid zip/i, and this module must not invent a second wording for it.
    const junk = new Uint8Array([0x50, 0x4b, 0x09, 0x09, 0x00]);
    const bytes = junk.buffer.slice(0, junk.byteLength) as ArrayBuffer;
    expectAgreesWithFullParse(bytes);
    expect(() => scanSldd(bytes, [])).toThrow();
  });
});

// ---- the json-text spelling ----------------------------------------------------------

describe('scanSldd — the json-text spelling keeps JSON.parse', () => {
  // No byte scanner for this spelling on purpose: one was written and measured at
  // 0.6-0.7x against V8's native parser. These tests pin the behaviour, not the speed.
  const textFixtures = slddFixtures.filter((n) => isJsonTextBytes(new Uint8Array(fixtureBuffer(n))));

  it('has json-text fixtures to test', () => {
    expect(textFixtures.length).toBeGreaterThan(5);
  });

  it.each(textFixtures)('%s agrees with the full read', (name) => {
    expectAgreesWithFullParse(fixtureBuffer(name));
  });

  it('reads names and refs out of a json-text dictionary', () => {
    // Also covers the `{ file }` spelling of a reference, which is the one that had
    // actually drifted in the past — normalizeRefNames accepts both.
    // Built from the exported key constants rather than typed out: a hand-written path
    // is how the first draft of this test asserted against an empty dictionary and
    // "passed" the agreement check, both readers correctly finding nothing there.
    const bytes = bufferOf(
      JSON.stringify({
        [TEXT_PARTS]: {
          [DATA_PART_KEY]: {
            [TEXT_CONTENT]: {
              entries: [{ name: 'A' }, { name: 'B' }],
              'Dictionary References': ['one.sldd', { file: 'two.sldd' }],
            },
          },
        },
      }),
    );
    expect(scanSldd(bytes, [])).toEqual({ names: ['A', 'B'], refs: ['one.sldd', 'two.sldd'] });
    expectAgreesWithFullParse(bytes);
  });

  it('reports an empty dictionary as empty rather than throwing', () => {
    const bytes = bufferOf(JSON.stringify({}));
    expect(scanSldd(bytes, [])).toEqual({ names: [], refs: [] });
    expectAgreesWithFullParse(bytes);
  });
});

// ---- helpers -------------------------------------------------------------------------

const PROLOG = '<?xml version="1.0" encoding="UTF-8"?>';
const ROOT_OPEN = '<DataSource FormatVersion="1" MinRelease="R2014a" Arch="maca64">';

function entry(name: string): string {
  return `<Object Class="DD.ENTRY"><P Name="Name" Class="char">${name}</P></Object>`;
}

function ref(file: string): string {
  return `<Object Class="DD.DICTIONARYREFERENCE"><P Name="Subdictionary" Class="char">${file}</P></Object>`;
}

/** A whole chunk0 document around `inner`, as bytes. */
function xmlBytes(inner: string): Uint8Array {
  return new TextEncoder().encode(`${PROLOG}${ROOT_OPEN}${inner}</DataSource>`);
}

/** The same document, packed as a compressed-binary `.sldd` the parsers accept. */
function slddZip(inner: string): ArrayBuffer {
  return zipOf(`${PROLOG}${ROOT_OPEN}${inner}</DataSource>`);
}

function zipOf(xml: string): ArrayBuffer {
  const z = zipSync({ 'data/chunk0.xml': strToU8(xml) });
  return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer;
}

function bufferOf(text: string): ArrayBuffer {
  const u8 = strToU8(text);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/** The chunk0 member of a compressed dictionary, for the direct-scan assertions. */
function chunkXml(bytes: ArrayBuffer): Uint8Array {
  // Deliberately fflate rather than the package's own inflate seam: a test that read the
  // member through code under test could not tell a scan bug from an unzip bug.
  return unzipSync(new Uint8Array(bytes))['data/chunk0.xml'];
}
