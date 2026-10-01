// Copyright 2026 The MathWorks, Inc.
// The fast dictionary reader against the general engine, on inputs nobody wrote by hand.
//
// `dictionaryXmlFast.test.ts` states one rule per case and writes the answer down. That is the
// right shape for a rule and the wrong shape for coverage: the cases there are the ones I
// thought of. This file is the other half — every binary `.sldd` fixture in the repo, and a
// seeded generator that writes documents out of the dictionary vocabulary and the hostile
// spellings around its edges.
//
// THE PROPERTY, and it is the only thing asserted here:
//
//     readDictionaryXmlFast(xml) === null
//       OR it equals readDictionaryXmlGeneric(xml) exactly — values, types, array lengths and
//          key INSERTION ORDER — and the engine did not throw.
//
// The last clause is not padding. If the fast reader accepted a document the engine throws on,
// the seam would quietly return a tree where it used to raise, and a caller that reports damage
// by catching would stop reporting it. That is a behaviour change, so it is a failure here.
//
// Why `diff` instead of `toEqual`: with a few thousand generated documents a failure has to say
// WHERE, and `toEqual`'s dump of two deep trees does not. `diff` returns the first divergent
// path, which is the only line of a fuzz failure anyone reads. It also compares key order,
// which `toEqual` ignores and which this reader could get wrong while matching on content.
//
// The generator is SEEDED. An unseeded one that fails at 02:00 and passes on re-run has told
// the morning nothing; with a fixed seed the failing document is reproducible from the printed
// seed and case index alone.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { readDictionaryXmlGeneric } from '../src/datamodel/parser/XmlReader.js';
import { readDictionaryXmlFast } from '../src/datamodel/parser/DictionaryXmlFast.js';

/**
 * The first place two trees differ, as a path — or `null` if they are indistinguishable.
 *
 * Stricter than `toEqual` in the two ways that matter here: object keys are compared IN ORDER,
 * and primitives with `Object.is`, so `7` and `'7'` are a divergence and so are `0` and `-0`.
 */
function diff(a: unknown, b: unknown, path = '$'): string | null {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path}: array vs non-array`;
    if (a.length !== b.length) return `${path}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i], `${path}[${i}]`);
      if (d !== null) return d;
    }
    return null;
  }
  const aObj = a !== null && typeof a === 'object';
  const bObj = b !== null && typeof b === 'object';
  if (aObj !== bObj) return `${path}: object vs ${aObj ? 'primitive' : 'object'}`;
  if (!aObj) {
    return Object.is(a, b) ? null : `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return `${path}: keys [${ka}] vs [${kb}]`;
  for (let i = 0; i < ka.length; i++) {
    // Positional, not by lookup: this is where a reader that emitted the right keys in the
    // wrong sequence gets caught.
    if (ka[i] !== kb[i]) return `${path}: key ${i} is '${ka[i]}' vs '${kb[i]}'`;
  }
  for (const k of ka) {
    const d = diff(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
      `${path}.${k}`,
    );
    if (d !== null) return d;
  }
  return null;
}

/**
 * The property, for one document. Returns whether the reader took it, so a caller can tell a
 * generator that produces nothing but declines from one that is actually exercising the reader.
 */
function assertEquivalent(xml: string, label: string): boolean {
  const fast = readDictionaryXmlFast(xml);
  if (fast === null) return false;
  let generic: unknown;
  try {
    generic = readDictionaryXmlGeneric(xml);
  } catch (e) {
    // Accepted where the engine throws: the seam would stop throwing, which is a behaviour
    // change and not a speedup.
    expect.fail(
      `${label}: the fast reader ACCEPTED a document the engine throws on ` +
        `(${(e as Error).message})\n  xml: ${JSON.stringify(xml)}`,
    );
  }
  const d = diff(fast, generic);
  if (d !== null) {
    expect.fail(`${label}: diverged at ${d}\n  xml: ${JSON.stringify(xml)}`);
  }
  return true;
}

// ---------------------------------------------------------------------------------------
// Part 1 — every binary `.sldd` fixture in the repo
// ---------------------------------------------------------------------------------------

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));

/** Every `.sldd` under `test/`, recursively. */
function findSldd(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findSldd(full, out);
    else if (entry.endsWith('.sldd')) out.push(full);
  }
  return out;
}

/** The XML part of a compressed-binary dictionary, or `null` if the file is the JSON format. */
function chunkXml(path: string): string | null {
  const bytes = readFileSync(path);
  // A text `.sldd` is JSON and holds no zip; the local-file-header magic is the cheap test.
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
  const part = unzipSync(new Uint8Array(bytes))['data/chunk0.xml'];
  return part === undefined ? null : new TextDecoder().decode(part);
}

describe('every binary dictionary fixture reads identically through both readers', () => {
  const binary = findSldd(TEST_DIR)
    .map((p) => [p, chunkXml(p)] as const)
    .filter((e): e is readonly [string, string] => e[1] !== null);

  // A guard on the guard: if the fixtures move or the zip detection breaks, this suite would
  // pass by testing nothing. The number only has to be a floor.
  it('finds the fixtures at all', () => {
    expect(binary.length).toBeGreaterThanOrEqual(15);
  });

  for (const [path, xml] of binary) {
    const name = path.slice(TEST_DIR.length);
    it(`${name} (${(xml.length / 1024).toFixed(0)} KB of XML)`, () => {
      // Every fixture in the repo is a document MATLAB wrote, so the reader is expected to
      // take all of them — a decline here is not a correctness failure but it is a silent
      // loss of the whole point, so it fails.
      expect(assertEquivalent(xml, name), `${name} was DECLINED by the fast reader`).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------------------
// Part 2 — generated documents
// ---------------------------------------------------------------------------------------

/** mulberry32: four lines, deterministic, and nobody has to install anything. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAGS = ['P', 'Element', 'Object', 'Field', 'DataSource'];

/** The real vocabulary, plus names outside it so the bail path is generated too. */
const ATTR_NAMES = [
  'Class',
  'Name',
  'Dimension',
  'Source',
  'PropertyType',
  'EnumerationName',
  'EnumerationType',
  'IsEnum',
  'IsComplex',
  'Encoding',
  'EncodedLength',
  'FormatVersion',
  'MinRelease',
  'Arch',
  'Unlisted',
  'x:ns',
];

/**
 * Text chunks chosen so each decides something: the coercion spellings, the padding rule, the
 * entity table and its edges, the layout-whitespace hook, and the values that only LOOK
 * coercible.
 */
const TEXTS = [
  '',
  ' ',
  '\n  ',
  // Whitespace `trim()` strips but the reader's four-character ASCII pre-scan does not — the
  // only route into `processText`'s own drop branch. Mutation testing found that branch
  // unreachable without these.
  '\f',
  '\v',
  '　',
  ' ',
  '7',
  '007',
  '-0',
  '+0',
  '0.0',
  '1.0',
  '0x1F',
  '1e3',
  '.5',
  '9007199254740993',
  '12345678901234567890123',
  'true',
  'false',
  'True',
  'e3',
  'abc',
  'a  b',
  ' 7 ',
  ' true ',
  'a>b',
  '&amp;',
  '&lt;x&gt;',
  '&quot;&apos;',
  '&amp;amp;',
  // Digit-leading AND entity-bearing: the only shape that reaches the coercion branch with
  // something to decode, so the only shape that can tell `toNumber(decoded)` from
  // `toNumber(raw)`. Mutation testing found that pair indistinguishable without these.
  '7&amp;8',
  '1&lt;2',
  '-1&gt;0',
  '.5&amp;',
  // Numeric character references, which the engine leaves standing — so the reader reads them as
  // text and these are not bails. The prohibited codepoints next to them ARE bails, and both
  // kinds belong here: the generator is the only check that the two are told apart in
  // combinations nobody wrote down, including a value carrying one of each.
  '&#65;',
  '&#xD;',
  'a&#xD;b',
  '7&#48;',
  '&#X41;',
  '&#;',
  '&#xZZ;',
  '&#1114112;',
  '&#9;',
  '&#32;',
  '&#xD7FF;',
  '&#xE000;',
  '&#1;', // deleted by the engine, so a bail
  '&#x7;',
  '&#X1;', // capital X, the spelling mutation testing caught no test reaching
  '&#xD800;',
  '&#9;&#1;a',
  '&nbsp;',
  'a & b',
  // Carriage returns, which XML normalizes (`\r\n` and a lone `\r` both become `\n`) and a reader
  // slicing the raw string does not. These are not bails — they must come back normalized — and
  // they belong in a generator because the interesting part is the COMBINATION: a CR beside a
  // reference, a CR that turns a coercible value into a padded one, a CR in layout position.
  '\r',
  '\r\n  ',
  'a\r\nb',
  'a\rb',
  'a\r\r\nb',
  '1\r',
  '&#xD;\r',
  'Simulink.Parameter',
  '[1 2]',
];

/**
 * Whitespace JavaScript's `\s` counts and XML's four do not.
 *
 * Every one of these is a separator to the engine's regexes and part of a name to this reader's
 * scanner, so wherever one can end a name the reader must decline. Kept out of `ATTR_NAMES` and
 * injected at low probability instead: at list frequency almost every document would decline and
 * the stream would stop reaching anything else.
 */
const ALIEN_WS = ['\f', '\v', ' ', ' ', '﻿'];

const ATTR_VALUES = [
  '',
  'v',
  '7',
  ' 7 ',
  'true',
  'Simulink.Signal',
  '&amp;',
  '&#65;',
  'a&#xD;b',
  '&#1;', // deleted inside an attribute value too
  "a'b",
  'a"b',
  'a>b',
  'a\nb',
  'a\r\nb',
  'a\r',
];

/** One generated document. */
function generate(rand: () => number): string {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

  const attrs = (): string => {
    let s = '';
    for (let n = Math.floor(rand() * 4); n > 0; n--) {
      const value = pick(ATTR_VALUES);
      // Quote style has to follow the content, or the generator produces nothing but
      // malformations past the first `"` and stops exercising anything else.
      const q = value.includes('"') ? "'" : rand() < 0.15 ? "'" : '"';
      const name = pick(ATTR_NAMES);
      // An `ALIEN_WS` in either place a name can end. The engine splits there and this reader
      // does not, so the engine sees one more attribute than the scanner does.
      const lead = rand() < 0.04 ? pick(ALIEN_WS) : pick([' ', '  ', '\t', '\n ']);
      const sep = rand() < 0.04 ? `${pick(ALIEN_WS)}=` : rand() < 0.1 ? ' = ' : '=';
      s += `${lead}${name}${sep}${q}${value}${q}`;
      // The same name twice. Where the split above lands inside a repeated name, the engine folds
      // the duplicate and keeps the last — so the divergence is a key COUNT rather than a key
      // value, which is the form it was first caught in.
      if (rand() < 0.03) s += `${rand() < 0.3 ? pick(ALIEN_WS) : ' '}${name}="dup"`;
    }
    return s;
  };

  const element = (depth: number): string => {
    const tag = pick(TAGS);
    const a = attrs();
    if (depth >= 4 || rand() < 0.25) {
      return rand() < 0.35 ? `<${tag}${a}${rand() < 0.5 ? ' ' : ''}/>` : `<${tag}${a}></${tag}>`;
    }
    let body = '';
    const kids = Math.floor(rand() * 4);
    if (kids === 0) {
      body = pick(TEXTS);
    } else {
      // Mixed content on purpose: no real dictionary has it, so only a generator will.
      // A CRLF indent now and then, so whole documents arrive line-ended the way a Windows editor
      // leaves them rather than only carrying a CR inside one value.
      const indent =
        rand() < 0.5 ? `${rand() < 0.15 ? '\r\n' : '\n'}${'  '.repeat(depth + 1)}` : '';
      if (rand() < 0.2) body += pick(TEXTS);
      for (let k = 0; k < kids; k++) body += indent + element(depth + 1);
      if (rand() < 0.2) body += pick(TEXTS);
      if (indent !== '') body += `\n${'  '.repeat(depth)}`;
    }
    const close = rand() < 0.1 ? `</${tag}\n >` : `</${tag}>`;
    return `<${tag}${a}>${body}${close}`;
  };

  let doc = '';
  if (rand() < 0.3) doc += `<?xml version="1.0" encoding="${pick(['utf-8', 'UTF-8'])}"?>`;
  // Hostile injections, each one a documented bail. They are generated rather than listed so
  // they land in positions a list would not think to put them in.
  if (rand() < 0.08) doc += pick(['<!-- c -->', '<!DOCTYPE DataSource>', '<?pi x?>']);
  // Processing instructions whose name merely STARTS with `xml`, and a repeat of the declaration.
  // A prefix test read all of these as the declaration; the engine keys the name it actually read,
  // and arrays a repeated key rather than overwriting it. The last one is only a repeat when the
  // line above fired, which is the point of generating it instead of listing it.
  if (rand() < 0.06) {
    doc += pick([
      '<?xmlfoo?>',
      '<?xml-stylesheet href="a.xsl"?>',
      '<?xml\fversion="1.0"?>',
      '<?xml version="1.1"?>',
    ]);
  }
  doc += element(0);
  if (rand() < 0.05) doc += pick(['<P/>', 'trailing', '</P>', '<!-- t -->']);
  return doc;
}

describe('generated documents are read identically or declined', () => {
  // Three seeds rather than one: a single stream can get unlucky about which branches it
  // reaches, and three is still instant.
  for (const seed of [1, 20260930, 0x5eed]) {
    it(`seed ${seed}: 2000 documents`, () => {
      const rand = rng(seed);
      let accepted = 0;
      for (let i = 0; i < 2000; i++) {
        if (assertEquivalent(generate(rand), `seed ${seed} case ${i}`)) accepted++;
      }
      // The generator has to actually reach the reader. Without this the suite would pass
      // gloriously on a generator that emitted nothing but DOCTYPEs.
      expect(accepted, 'documents the fast reader accepted').toBeGreaterThan(400);
    });
  }

  it('also reads a document shaped like a real dictionary entry', () => {
    // The generator above is adversarial and produces shapes MATLAB never writes. This one is
    // the shape it always writes, so the common path is covered by something other than luck —
    // and it must be ACCEPTED, which is why its values are drawn from a list with none of
    // `TEXTS`'s deliberate bails in it.
    const rand = rng(99);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    const values = ['', '0', '7', '1.5', '-1', 'true', 'false', 'double', 'auto', 'inherit', ' pad '];
    let xml = '<?xml version="1.0" encoding="utf-8"?>\n<DataSource FormatVersion="1" Arch="maci64">';
    for (let e = 0; e < 300; e++) {
      xml += `\n  <Element Name="p${e}">`;
      xml += `\n    <Object Class="${pick(['Simulink.Parameter', 'Simulink.Signal', 'Simulink.AliasType'])}">`;
      for (const prop of ['Value', 'Min', 'Max', 'DataType', 'Description', 'Unit']) {
        xml += `\n      <P Name="${prop}" Dimension="[1 1]">${pick(values)}</P>`;
      }
      xml += '\n    </Object>\n  </Element>';
    }
    xml += '\n</DataSource>';
    expect(assertEquivalent(xml, 'dictionary-shaped'), 'was declined').toBe(true);
  });
});
