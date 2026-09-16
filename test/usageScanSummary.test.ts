// Copyright 2026 The MathWorks, Inc.
//
// Summarising a dictionary or a MAT-file from a SCAN the caller already ran, and the one
// thing that has to be true of it: it is the same summary `summarizeFiles` builds from the
// bytes.
//
// `summarizeSlddScan` and `summarizeMatScan` exist because a host reads these files for its
// own indexes and then handed the bytes to `summarizeFiles`, which scanned them a second
// time — 46% of one such tier's per-dictionary CPU. Which makes two ways to summarise one
// file, and the tests that matter are the ones BETWEEN them. Not "does the new path answer
// plausibly": a summariser reachable two ways that reads a different field on one of them
// answers plausibly on both and is still wrong, and only a comparison catches it.
//
// So the shape here is an EQUALITY SWEEP: for every committed `.sldd` and `.mat` this suite
// can reach, plus the constructed shapes no fixture has,
//
//   summarizeFiles([{ srcId, filename, bytes }])  ==  summarize*Scan(scan(bytes), srcId, filename)
//
// compared whole — the `names` Sets, the map KEYS, and `slddRefs` in order. The fixtures are
// globbed rather than listed, so a dictionary added for some unrelated reason is covered by
// this the day it lands, and the globs are guarded by a count so an empty one cannot make
// every case disappear silently.
//
// AND A SECOND ASSERTION BESIDE IT, because the first one alone is now weaker than it looks:
// `summarizeFiles` was refactored to route THROUGH these functions, so the two sides share
// the code that builds the summary and a wrong rule inside it would agree with itself. So
// every swept file is also compared against a summary derived from the FULL readers —
// `readSlddContent` and `parseMat`, the parsers the scanners substitute for. Verified by
// mutation: without that, dropping `filter(Boolean)` from the summary left the whole sweep
// green. See `expectMatchesFullReader`.
//
// The refusal cases are the ones worth reading. Both scanners fall back to the full reader
// for bytes they have not been proven equivalent on, so the summary of a file that took the
// fallback must ALSO match, and a case that merely happened to take the fast path would prove
// nothing about that. For the dictionary the refusal is asserted directly, through
// `scanDataSourceXml`, so it cannot quietly stop being one; for the MAT it is not assertable
// from here and the case says so where it sits.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { scanDataSourceXml } from '../src/datamodel/parser/SlddScan.js';
import {
  buildUsageIndex,
  buildUsageIndexFromSummaries,
  isJsonTextBytes,
  mergeFileSummaries,
  normalizeRefNames,
  parseMat,
  parseModel,
  readSlddContent,
  scanMat,
  scanSldd,
  slddChunkContent,
  summarizeFiles,
  summarizeMatScan,
  summarizeParsedModel,
  summarizeSlddScan,
} from '../src/index.js';
import type { UsageFile } from '../src/index.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const MCOS = fileURLToPath(new URL('./fixtures/mcos/', import.meta.url));

function bytesOf(path: string): ArrayBuffer {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

const fixtureBytes = (rel: string): ArrayBuffer => bytesOf(fileURLToPath(new URL(`./fixtures/${rel}`, import.meta.url)));
const artifact = (rel: string): ArrayBuffer =>
  bytesOf(fileURLToPath(new URL(`./parity/artifacts/${rel}`, import.meta.url)));

// A distinct srcId, never equal to the filename: the two are separate arguments and the
// summary carries them differently — the srcId verbatim, the map key off the basename
// case-folded — so a case where they coincided would let either stand in for the other.
const file = (name: string, bytes: ArrayBuffer, srcId = `src:${name}`): UsageFile => ({
  srcId,
  filename: name,
  bytes,
});

// ---- the two assertions -------------------------------------------------------------

/**
 * THE CONTRACT, for a dictionary: summarising the bytes and summarising a scan of those
 * bytes produce the same `FileSummaries`, compared whole.
 *
 * `toEqual` is what makes this worth writing — it walks into the `Map` and the `Set`, so a
 * wrong KEY (the basename rule) fails here just as a wrong name does, and `slddRefs` is an
 * array so its ORDER is compared too. That order is contract: `resolveName` walks it and
 * takes the first hit.
 */
function expectSlddPathsAgree(f: UsageFile): void {
  expect(summarizeSlddScan(scanSldd(f.bytes), f.srcId, f.filename)).toEqual(summarizeFiles([f]));
}

function expectMatPathsAgree(f: UsageFile): void {
  expect(summarizeMatScan(scanMat(f.bytes), f.srcId, f.filename)).toEqual(summarizeFiles([f]));
}

/**
 * AND THE ORACLE, without which the equality above is by construction rather than by test.
 *
 * `summarizeFiles` now routes THROUGH these functions — that is the point of the refactor,
 * one implementation and not two — so the two sides of the equality share the code that
 * builds the summary and could only differ in which bytes were scanned and how the key was
 * spelled. A wrong `names` rule would agree with itself perfectly. Verified by mutation:
 * dropping `filter(Boolean)` and `refBasename` from the summary left the whole sweep green.
 *
 * So the sweep also compares against a summary derived from the FULL readers — the parsers
 * the scanners substitute for — with the two rules spelled out here rather than imported:
 * the `''` placeholder a scan keeps for position is not a name, and a reference is matched
 * by basename case-folded. That is an independent derivation, and it is what makes the
 * sweep able to fail.
 */
function expectMatchesFullReader(f: UsageFile, kind: 'sldd' | 'mat'): void {
  const key = f.filename.toLowerCase(); // every swept file is named by its bare basename
  if (kind === 'mat') {
    expect(summarizeMatScan(scanMat(f.bytes), f.srcId, f.filename).matByName.get(key)).toEqual({
      srcId: f.srcId,
      names: new Set(parseMat(f.bytes).variables.map((v) => v.name).filter((n) => n !== '')),
      slddRefs: [],
    });
    return;
  }
  const content = slddChunkContent(readSlddContent(f.bytes, []));
  const entries = (content?.entries ?? []) as { name?: unknown }[];
  expect(summarizeSlddScan(scanSldd(f.bytes), f.srcId, f.filename).slddByName.get(key)).toEqual({
    srcId: f.srcId,
    names: new Set(entries.map((e) => (typeof e?.name === 'string' ? e.name : '')).filter((n) => n !== '')),
    slddRefs: (content ? normalizeRefNames(content['Dictionary References']) : []).map((r) =>
      (r.split(/[\\/]/).pop() || r).toLowerCase(),
    ),
  });
}

// ---- fixture-wide sweep, dictionaries -------------------------------------------------

const slddFixtures = readdirSync(FIXTURES).filter((n) => n.endsWith('.sldd')).sort();

// The parity artifacts are the same two dictionaries MATLAB wrote in BOTH spellings, and
// they are the largest committed ones — so they are the sweep's realistic input, where the
// hand-built cases below are its sharp one.
const slddArtifacts = ['binary/cases.sldd', 'binary/params.sldd', 'text/cases.sldd', 'text/params.sldd'];

describe('summarizeSlddScan — the same summary summarizeFiles builds, on every committed dictionary', () => {
  it('found the fixtures, in both spellings', () => {
    // Guards the glob twice over: an empty list would make every case below disappear
    // while the suite reported success, and a list of only one spelling would leave the
    // zip-or-JSON fork — the one place the two readers differ most — untested.
    expect(slddFixtures.length).toBeGreaterThan(15);
    const zipped = slddFixtures.map((n) => !isJsonTextBytes(new Uint8Array(fixtureBytes(n))));
    expect(zipped.filter(Boolean).length).toBeGreaterThan(0);
    expect(zipped.filter((z) => !z).length).toBeGreaterThan(0);
  });

  it.each(slddFixtures)('agrees on fixtures/%s', (name) => {
    const f = file(name, fixtureBytes(name));
    expectSlddPathsAgree(f);
    expectMatchesFullReader(f, 'sldd');
  });

  it.each(slddArtifacts)('agrees on artifacts/%s', (rel) => {
    const f = file(rel.split('/')[1], artifact(rel), `src:${rel}`);
    expectSlddPathsAgree(f);
    expectMatchesFullReader(f, 'sldd');
  });

  it('is not comparing empty summaries', () => {
    // The sweep is worthless if every dictionary summarises to nothing, so the two
    // artifacts are pinned as carrying real names — in both spellings, since a reader that
    // returned nothing for one of them would agree with itself perfectly.
    for (const rel of ['binary/cases.sldd', 'text/cases.sldd']) {
      const names = summarizeSlddScan(scanSldd(artifact(rel)), 'src', 'cases.sldd').slddByName.get('cases.sldd')?.names;
      expect(names?.size, rel).toBeGreaterThan(3);
    }
  });
});

// ---- constructed dictionaries ---------------------------------------------------------

/** A textual `.sldd` defining `names` and referencing `refs`, as usageIndex.test.ts builds one. */
function slddBytes(names: string[], refs: unknown[] = []): ArrayBuffer {
  const u8 = strToU8(
    JSON.stringify({
      __MW_TEXT_PARTS__: {
        '__MW_TEXT_PART__/data/chunk0': {
          __MW_TEXT_content: {
            entries: names.map((name) => ({ name, class: 'Simulink.Parameter' })),
            'Dictionary References': refs,
            AllowAccessBWS: false,
          },
        },
      },
    }),
  );
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

const CHUNK_PART = 'data/chunk0.xml';
const chunkXmlText = (body: string): string =>
  '<?xml version="1.0" encoding="UTF-8"?>\n'
  + `<DataSource FormatVersion="1" MinRelease="R2014a" Arch="maca64">\n${body}\n</DataSource>`;

/**
 * A real compressed `.sldd`, unzipped, its data part replaced, rezipped — the technique
 * usageIndex.test.ts and parseWarnings.test.ts use, so the bytes under test differ from a
 * file MATLAB wrote in exactly the one way the case is about and the entries come back
 * through the real binary reader.
 */
function binarySlddWithChunk(body: string): ArrayBuffer {
  const entries = unzipSync(new Uint8Array(fixtureBytes('compressed.sldd')));
  expect(Object.keys(entries)).toContain(CHUNK_PART); // the fixture really holds it
  entries[CHUNK_PART] = strToU8(chunkXmlText(body));
  const zipped = zipSync(entries);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

const xmlEntry = (name: string): string => `<Object Class="DD.ENTRY"><P Name="Name" Class="char">${name}</P></Object>`;
const xmlRef = (name: string): string =>
  `<Object Class="DD.DICTIONARYREFERENCE"><P Name="Subdictionary" Class="char">${name}</P></Object>`;

describe('summarizeSlddScan — the shapes no committed fixture has', () => {
  // Every one of these is a shape the two paths could disagree on and no fixture exercises:
  // references at all (no committed dictionary has one), an entry with no name, and the
  // degenerate empty document.
  const CASES: [what: string, load: () => UsageFile][] = [
    [
      // Both spellings of a reference and a mixed-case one, because the summary's `slddRefs`
      // is `refs.map(refBasename)` — the fold that makes `Sub.SLDD` resolve — and an empty
      // reference that `normalizeRefNames` drops, which is where the two paths could differ
      // by one position.
      'a textual dictionary with references, in both spellings and mixed case',
      () => file('top.sldd', slddBytes(['Kp', 'Ki'], ['LEAF.SLDD', { file: 'other/Mid.sldd' }, ''])),
    ],
    [
      // Entries the scanner reports as `''`, which both paths must drop from the Set while
      // the scan keeps them in position. A case with the unnamed entry FIRST, so a path that
      // dropped it late would shift the rest.
      'a compressed dictionary with unnamed entries around a named one',
      () =>
        file(
          'holes.sldd',
          binarySlddWithChunk(
            `<Object Class="DD.ENTRY"><P Name="Value" Class="double">1</P></Object>`
            + xmlEntry('aParam')
            + `<Object Class="DD.ENTRY"><P Name="Name" Class="char"/></Object>`,
          ),
        ),
    ],
    [
      'a compressed dictionary with entries and references in one document',
      () => file('both.sldd', binarySlddWithChunk(xmlEntry('A') + xmlRef('one.sldd') + xmlEntry('B') + xmlRef('two.sldd'))),
    ],
    ['a dictionary defining nothing at all', () => file('empty.sldd', slddBytes([]))],
    [
      // A JSON file short of the shape a dictionary has — a partial write really produces
      // this, and both paths owe the empty summary rather than a throw on either.
      'valid JSON that is not a dictionary',
      () => file('notadict.sldd', (() => {
        const u8 = strToU8(JSON.stringify({ nothing: true }));
        return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
      })()),
    ],
  ];

  for (const [what, load] of CASES) {
    it(`agrees on ${what}`, () => {
      expectSlddPathsAgree(load());
    });
  }

  it('really is comparing summaries with the awkward parts in them', () => {
    // The equalities above would hold vacuously if the scanner returned nothing for these,
    // so the two fields they were chosen for are pinned by value: references folded and in
    // order, and the unnamed entries absent from a Set that still holds the named one.
    const refs = CASES[0][1]();
    expect(summarizeSlddScan(scanSldd(refs.bytes), refs.srcId, refs.filename).slddByName.get('top.sldd')).toEqual({
      srcId: 'src:top.sldd',
      names: new Set(['Kp', 'Ki']),
      slddRefs: ['leaf.sldd', 'mid.sldd'],
    });

    const holes = CASES[1][1]();
    const summary = summarizeSlddScan(scanSldd(holes.bytes), holes.srcId, holes.filename).slddByName.get('holes.sldd');
    expect(scanSldd(holes.bytes).names).toEqual(['', 'aParam', '']); // the scan keeps the positions
    expect(summary?.names).toEqual(new Set(['aParam'])); // the summary does not
  });

  it('agrees for a dictionary the fast path REFUSES and the full reader recovers', () => {
    // The case the fallback exists for, and the reason it is asserted rather than assumed:
    // `scanSldd` hands a document it has not been proven equivalent on to
    // `readSlddContent`, so what `summarizeSlddScan` is given for such a file is the full
    // reader's answer — and it still has to be the summary `summarizeFiles` builds. An
    // entity in a name is the documented refusal (fast-xml-parser decodes `&amp;`, reading
    // the bytes plainly would not).
    const body = xmlEntry('A&amp;B') + xmlEntry('plain');
    expect(() => scanDataSourceXml(strToU8(chunkXmlText(body)))).toThrow(/entity/i);
    const refused = file('entity.sldd', binarySlddWithChunk(body));
    // The recovery really happened — the decoded name, not the raw bytes.
    expect(scanSldd(refused.bytes).names).toEqual(['A&B', 'plain']);
    expectSlddPathsAgree(refused);
  });

  it('keys on the basename case-folded, and carries the srcId verbatim', () => {
    // The key rule is the one thing a caller cannot pass in, so it is pinned directly: a
    // reference authored as `Params.SLDD` inside a model has to find a file stored under a
    // directory path, and the srcId — the host's own identifier, a URI as often as a path —
    // has to come back out untouched.
    const summaries = summarizeSlddScan(scanSldd(slddBytes(['Kp'])), 'vscode://x/Params.SLDD?v=2', '/work/dicts/Params.SLDD');
    expect([...summaries.slddByName.keys()]).toEqual(['params.sldd']);
    expect(summaries.slddByName.get('params.sldd')?.srcId).toBe('vscode://x/Params.SLDD?v=2');
    // And the same file through `summarizeFiles`, so the key rule is not two rules.
    expect(summaries).toEqual(
      summarizeFiles([
        { srcId: 'vscode://x/Params.SLDD?v=2', filename: '/work/dicts/Params.SLDD', bytes: slddBytes(['Kp']) },
      ]),
    );
  });

  it('holds nothing but the one dictionary', () => {
    // The other two halves of the `FileSummaries` are empty, which is what lets a caller
    // fold this in beside a model it parsed and a MAT it scanned.
    const only = summarizeSlddScan(scanSldd(slddBytes(['Kp'])), 'src', 'a.sldd');
    expect(only.models).toEqual([]);
    expect(only.matByName.size).toBe(0);
    expect(only.slddByName.size).toBe(1);
  });
});

// ---- fixture-wide sweep, MAT-files ----------------------------------------------------

const matFixtures = [
  ...readdirSync(FIXTURES).filter((n) => n.endsWith('.mat')).map((n) => n),
  ...readdirSync(MCOS).filter((n) => n.endsWith('.mat')).map((n) => `mcos/${n}`),
].sort();

describe('summarizeMatScan — the same summary summarizeFiles builds, on every committed MAT-file', () => {
  it('found the fixtures at all', () => {
    // `strings_v73.mat` is in this list on purpose and is the one file here neither reader
    // can read: it is HDF5, both paths refuse it, and the case for that is at the bottom.
    expect(matFixtures.length).toBeGreaterThan(10);
  });

  it.each(matFixtures.filter((n) => !n.endsWith('_v73.mat')))('agrees on fixtures/%s', (rel) => {
    const f = file(rel.split('/').pop()!, fixtureBytes(rel), `src:${rel}`);
    expectMatPathsAgree(f);
    expectMatchesFullReader(f, 'mat');
  });

  it('agrees on artifacts/mat/cases.mat', () => {
    const f = file('cases.mat', artifact('mat/cases.mat'));
    expectMatPathsAgree(f);
    expectMatchesFullReader(f, 'mat');
  });

  it('is not comparing empty summaries', () => {
    // `strings.mat` holds eleven named variables and the unnamed MCOS element — so this
    // pins both that the sweep has substance and that the placeholder is dropped.
    const names = summarizeMatScan(scanMat(fixtureBytes('strings.mat')), 'src', 'strings.mat').matByName.get('strings.mat')?.names;
    expect(names?.size).toBe(11);
    expect(names?.has('')).toBe(false);
    expect(scanMat(fixtureBytes('strings.mat')).names).toContain(''); // which the scan itself keeps
  });

  it('agrees for a truncated file, where the answer is the repaired read', () => {
    // The MAT half of the recovery case: a file cut inside its last record. `parseMat`
    // clamps every declared length against the buffer and hands back the names it could
    // reach; `scanMat` will not reproduce a repair, so what comes out for these bytes is
    // that clamped answer — six names on the intact file, five here — and the summary of it
    // must still be the summary either path builds.
    //
    // That the fast path REFUSED rather than agreeing by luck is not assertable from here:
    // the fallback returns `parseMat`'s answer, so the two are indistinguishable in the
    // result. matScan.test.ts asserts it directly, by counting inflations through the
    // native-inflate seam. What this case owes is the equality, on bytes that took that
    // path.
    const whole = fixtureBytes('sparse_cases.mat');
    const cut = new Uint8Array(whole).subarray(0, whole.byteLength - 24).slice().buffer as ArrayBuffer;
    expect(scanMat(whole).names).toHaveLength(6);
    expect(parseMat(cut).variables.map((v) => v.name)).toEqual(scanMat(cut).names);
    expect(scanMat(cut).names).toHaveLength(5); // a comparison with something in it
    expectMatPathsAgree(file('sparse_cases.mat', cut));
  });

  it('holds nothing but the one MAT-file, and inherits nothing', () => {
    const only = summarizeMatScan(scanMat(fixtureBytes('mcos/Numeric.mat')), 'src', 'Numeric.mat');
    expect(only.models).toEqual([]);
    expect(only.slddByName.size).toBe(0);
    // A MAT-file references no dictionary — the field exists because `DataSummary` is one
    // shape for both kinds, and for this kind it is always empty.
    expect(only.matByName.get('numeric.mat')?.slddRefs).toEqual([]);
  });
});

// ---- the two paths that cannot be compared, and why -----------------------------------

describe('bytes no reader can read', () => {
  it.each([
    ['a dictionary that is neither a zip nor JSON', 'junk.sldd', () => scanSldd(strToU8('not a zip').buffer as ArrayBuffer)],
    ['a MAT-file MATLAB wrote as HDF5', 'strings_v73.mat', () => scanMat(fixtureBytes('strings_v73.mat'))],
  ])('has no summary to compare for %s, because there is no scan', (_what, name, scan) => {
    // The one place the paths cannot be equal, and the same asymmetry `summarizeParsedModel`
    // has: `summarizeFiles` drops an unreadable file silently (its per-file catch), while
    // these functions are never reached for one — the caller's own scan threw first and it
    // has nothing to hand over. So the summary they do not produce is the summary
    // `summarizeFiles` does not produce either.
    expect(scan).toThrow();
    const bytes = name === 'junk.sldd' ? (strToU8('not a zip').buffer as ArrayBuffer) : fixtureBytes(name);
    expect(summarizeFiles([file(name, bytes)])).toEqual({
      models: [],
      slddByName: new Map(),
      matByName: new Map(),
    });
  });
});

// ---- composition ----------------------------------------------------------------------

describe('a whole workspace summarised from what the caller already holds', () => {
  // A real model MATLAB wrote, so the parse is not a construction of this file's: mdlcases.mdl
  // links `mdlparams.sldd`, defines `inner`, `span` and `tau` in its own workspace, and its
  // blocks read `Kp`, `Ki`, `inner`, `[tau 1]` and `span`. Which makes `Kp` resolve in the
  // linked dictionary and `Ki` only through the reference that dictionary carries — so the
  // chain the SCAN's own `refs` supplied is load-bearing in the answers below.
  const model = file('mdlcases.mdl', artifact('mdl/mdlcases.mdl'));
  const top = file('mdlparams.sldd', slddBytes(['Kp'], ['leaf.sldd']));
  const leaf = file('leaf.sldd', slddBytes(['Ki']));
  const mat = file('extra.mat', fixtureBytes('mcos/Numeric.mat'));
  const parts = () => [
    summarizeParsedModel(parseModel(model.bytes, model.filename), model.srcId, model.filename),
    summarizeSlddScan(scanSldd(top.bytes), top.srcId, top.filename),
    summarizeSlddScan(scanSldd(leaf.bytes), leaf.srcId, leaf.filename),
    summarizeMatScan(scanMat(mat.bytes), mat.srcId, mat.filename),
  ];

  it('folds into the summaries summarizeFiles builds over the same four files', () => {
    // The reason all three of these return a `FileSummaries` rather than a bare summary: the
    // model is the file the host parsed for its own rows, the dictionaries and the MAT are
    // files it scanned for its own indexes, and the parts fold together — models in file
    // order, maps keyed alike — into what one pass over the four files produces.
    expect(mergeFileSummaries(parts())).toEqual(summarizeFiles([model, top, leaf, mat]));
  });

  it('answers what buildUsageIndex answers from the bytes', () => {
    const composed = buildUsageIndexFromSummaries(mergeFileSummaries(parts()));
    const whole = buildUsageIndex([model, top, leaf, mat]);

    // Not a vacuous comparison: one name resolves in the linked dictionary and one down its
    // reference, and both directions of the index have entries to compare.
    expect(whole.usagesOf(top.srcId, 'Kp')).toHaveLength(1);
    expect(whole.usagesOf(leaf.srcId, 'Ki')).toHaveLength(1);
    expect(whole.paramsOf(model.srcId, '1')).not.toEqual([]);

    expect(composed.models).toEqual(whole.models);
    for (const [srcId, name] of [
      [top.srcId, 'Kp'],
      [leaf.srcId, 'Ki'],
      [model.srcId, 'tau'],
      [mat.srcId, 'Numeric'],
    ] as const) {
      expect(composed.usagesOf(srcId, name)).toEqual(whole.usagesOf(srcId, name));
    }
    for (const sid of ['1', '2', '3', '6', '8']) {
      expect(composed.paramsOf(model.srcId, sid)).toEqual(whole.paramsOf(model.srcId, sid));
    }
  });
});
