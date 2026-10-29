// Copyright 2026 The MathWorks, Inc.
//
// ONE scan of a data file, read three ways — asserted to say what three separate readings of it
// said, over every `.sldd` and `.mat` fixture in this repo, in both on-disk spellings.
//
// The summary half of the vscode extension's usageScanEquality.test.ts, which came here with the
// cache. Its other half — the name index's records over the same scan, and an unsaved buffer kept
// out of the cache — is about that host's name search and stays with it.
//
// The cheap tier used to read a dictionary three times: `summarizeFiles` scanned it for the usage
// summary, a reference reader scanned it again for the reference list, and the name index scanned
// it a third time for the entry names. Now `dataCheapOf` scans once and the artifact carries all
// three (src/folder/sourceCache.ts). That is a speed change whose whole risk is in the ANSWERS: every one of
// the three is consumed somewhere a wrong answer is invisible — a tree edge that is simply not
// drawn, a search that simply does not find a name, a Usage cell that simply says nothing. So this
// suite is the equality, per fixture, in the style a scoped usage graph's equality test uses: exhaustive over the corpus rather than illustrative, and read from the directory so
// a fixture added for some other suite is covered here too.
//
// Each of the three is checked against TWO things, and the second is what makes the suite worth
// running:
//
//   * the route it replaced — for `refs`, the retired regex over the raw text, inlined below
//     because the function is gone. Its answers are the shipped answers of every vscode release
//     before the shared scan.
//   * an independent ORACLE built from the FULL readers — `readSlddContent` and `parseMat`, which
//     decode the whole file and share no code with the scanners (the fast paths, that is; a
//     scanner falls back to the full reader for what it has not been proven on). This is the half that cannot pass
//     vacuously: `summarizeSlddScan` and the artifact now come from the same scan by construction,
//     so comparing them to each other would agree even if the scan itself were wrong.
//     test/usageScanSummary.test.ts makes exactly this argument for the summariser, and records a
//     mutation (dropping `filter(Boolean)`) that its shared-code sweep missed and its full-reader
//     oracle caught. Same shape here, one layer up.
//
// The names oracle is ORDERED and includes the `''` placeholders, which is stronger than
// usageScanSummary's (it compares the summary's deduped Set). That is deliberate: a host's search
// index is the consumer of `Cheap.names`, its contract is one record per OCCURRENCE, and a Set round-trip
// anywhere on that path is invisible to every other assertion here.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  cheapOne,
  isJsonTextBytes,
  isMatFile,
  isSlddFile,
  newSourceCache,
  normalizeRefNames,
  parseMat,
  readSlddContent,
  refBasename,
  scanSldd,
  slddChunkContent,
  type Cheap,
  type ParseWarning,
  type SourceCache,
  type SourceFile,
  type SourceReader,
} from '../src/index.js';

const ROOT = import.meta.dirname;

// Every data-file fixture under test/, at any depth: test/fixtures (the unit corpus), its
// mcos/ subdirectory (MAT-files holding objects, which is where the `''` placeholder lives) and
// test/parity/artifacts/{text,binary} (MATLAB-generated, the same dictionaries in both formats).
// Read from the directory rather than listed, and by core's own extension tests rather than by
// a suffix written here, so this walks exactly the set the extension would pick up.
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (isSlddFile(e.name) || isMatFile(e.name)) out.push(relative(ROOT, full).split(sep).join('/'));
  }
  return out;
}

const CORPUS = walk(ROOT).sort();
const SLDD = CORPUS.filter(isSlddFile);
const MAT = CORPUS.filter(isMatFile);

/**
 * One dictionary that is BUILT and not read, and the two reasons it has to be — both of them
 * measured over the corpus rather than assumed (see the counting sweep below).
 *
 * No fixture in the corpus holds two entries with the SAME name, and that is exactly the property
 * `Cheap.names` exists for: Design Data and Other Data are separate namespaces, so pasting `Array`
 * from one into the other keeps the name (core's duplicateNameIdentity test), and the search
 * index's contract is one record per OCCURRENCE. A deduped array would satisfy every other
 * assertion in this file.
 *
 * No dictionary fixture holds an UNNAMED entry either — every `''` placeholder in the corpus comes
 * from a MAT-file, where the anonymous trailing element of an MCOS file supplies them in quantity.
 * So the ordered `names` array and the summary's filtered Set are indistinguishable over the
 * dictionaries on disk, which is the other thing this file is here to tell apart.
 *
 * Built rather than committed because a real one takes MATLAB to produce, and the shape a textual
 * dictionary carries is small enough to write: the three-key `__MW_TEXT_PARTS__` wrapper core's
 * readers look inside. It joins the corpus sweeps below, so it gets the same full-reader oracle
 * every fixture gets — which is what makes it evidence rather than a hand-written expectation.
 */
const DUPS = 'synthetic/duplicate_names.sldd';
const synthetic = new Map<string, ArrayBuffer>([
  [
    DUPS,
    new TextEncoder().encode(
      JSON.stringify({
        __MW_TEXT_PARTS__: {
          '__MW_TEXT_PART__/data/chunk0': {
            __MW_TEXT_content: {
              entries: [{ name: 'Kp' }, { name: 'Kp' }, {}, { name: 'Uo' }, { name: 'Ki' }],
              'Dictionary References': ['Shared/Common.sldd'],
            },
          },
        },
      }),
    ).buffer as ArrayBuffer,
  ],
]);

// What every sweep iterates: the directory, plus the one dictionary the directory cannot supply.
const DICTS = [...SLDD, DUPS];
const DATA = [...CORPUS, DUPS];

function bytesOf(name: string): ArrayBuffer {
  const built = synthetic.get(name);
  if (built) return built;
  const b = readFileSync(join(ROOT, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

// A fixture as the cache sees one. The uri carries the fixture's whole relative path because
// several basenames repeat across the corpus (three `params.sldd`, two `signals.mat`); the PATH
// keeps the real basename, which is what core keys a summary by.
const asFile = (name: string): SourceFile => ({ uriString: `file:///fx/${name}`, path: `/fx/${name}` });
const fixtureOf = (file: SourceFile): string => file.path.slice('/fx/'.length);

const reader: SourceReader = {
  version: async (file) => `v1:${file.path}`,
  bytes: async (file) => bytesOf(fixtureOf(file)),
};

async function cheapOf(cache: SourceCache, name: string): Promise<Cheap> {
  const entry = await cheapOne(cache, reader, asFile(name));
  if (!entry) throw new Error(`no cheap artifact for ${name}`);
  return entry.cheap;
}

/**
 * The reference list as every release before this one read it: core's format sniff, then the
 * regex for a textual dictionary and `scanSldd` for a compressed one.
 *
 * A verbatim inline of the retired `refsFromSlddBytes`/`extractReferences` (git history has the
 * originals). Inlined rather than kept in `src/`, because a function no shipping code calls is
 * dead weight that still has to be maintained — but its ANSWERS are the ones users have been
 * getting, so they are worth pinning once against the reader that replaced it.
 *
 * The compressed arm is the same `scanSldd` the new route runs, so on those fixtures the equality
 * below holds by construction; the textual arm is where the routes genuinely differ, and the
 * corpus guard checks both spellings are present in quantity.
 */
function retiredRefs(bytes: ArrayBuffer): string[] {
  const u8 = new Uint8Array(bytes);
  if (!isJsonTextBytes(u8)) return scanSldd(bytes).refs;
  const match = new TextDecoder().decode(u8).match(/"Dictionary References"\s*:\s*(\[[^\]]*\])/);
  if (!match) return [];
  try {
    return normalizeRefNames(JSON.parse(match[1]));
  } catch {
    return [];
  }
}

// --- the oracles: the FULL readers, which share no code with the scanners -------------------

/**
 * A dictionary's content the expensive way: decode the entire file, then take the one key — or
 * `null` for a file the full read could not recover, which files `source-unreadable` and answers
 * an empty dictionary. The cache refuses the same files (`dataCheapOf`), so the oracle does too.
 */
function fullContent(bytes: ArrayBuffer): Record<string, unknown> | null {
  const warnings: ParseWarning[] = [];
  const content = readSlddContent(bytes, warnings);
  return warnings.some((w) => w.code === 'source-unreadable') ? null : slddChunkContent(content);
}

function fullSlddRefs(bytes: ArrayBuffer): string[] {
  const content = fullContent(bytes);
  return content ? normalizeRefNames(content['Dictionary References']) : [];
}

/**
 * Every entry's name, in file order, `''` where an entry has no readable one — the shape
 * `scanSldd` reports, derived from the full parse instead.
 *
 * The placeholder is core's contract and not an accident: a caller indexing POSITIONALLY would be
 * shifted by one without it (nameExtract.ts).
 */
function fullSlddNames(bytes: ArrayBuffer): string[] {
  const entries = (fullContent(bytes)?.entries ?? []) as { name?: unknown }[];
  return entries.map((e) => (typeof e?.name === 'string' ? e.name : ''));
}

function fullMatNames(bytes: ArrayBuffer): string[] {
  return parseMat(bytes).variables.map((v) => (typeof v?.name === 'string' ? v.name : ''));
}

/**
 * True for a file the FULL reader cannot read at all — it throws, or (a dictionary) recovers to
 * an empty one with `source-unreadable`. There is nothing to compare such a file's artifact WITH,
 * so the sweeps below skip it, and the block after them holds it to the one answer it is owed.
 */
function refusedByFullReader(name: string): boolean {
  const bytes = bytesOf(name);
  try {
    if (isMatFile(name)) {
      parseMat(bytes);
      return false;
    }
    return fullContent(bytes) === null;
  } catch {
    return true;
  }
}
const READABLE_DICTS = DICTS.filter((n) => !refusedByFullReader(n));
const READABLE_MAT = MAT.filter((n) => !refusedByFullReader(n));

describe('the corpus this suite sweeps', () => {
  it('holds data files of both kinds, in both on-disk spellings', () => {
    // A guard on the test itself: every sweep below iterates the corpus, so an empty or
    // one-format corpus would pass all of them while asserting nothing.
    expect(SLDD.length).toBeGreaterThan(15);
    expect(MAT.length).toBeGreaterThan(5);
    // The pairs that exist precisely to be the same dictionary twice.
    expect(SLDD).toContain('fixtures/rt_text.sldd');
    expect(SLDD).toContain('fixtures/rt_bin.sldd');
    expect(SLDD).toContain('parity/artifacts/text/params.sldd');
    expect(SLDD).toContain('parity/artifacts/binary/params.sldd');
    // And the split is real, by core's sniff rather than by the file names above.
    const textual = SLDD.filter((n) => isJsonTextBytes(new Uint8Array(bytesOf(n))));
    expect(textual.length).toBeGreaterThan(5);
    expect(SLDD.length - textual.length).toBeGreaterThan(5);
  });
});

describe('a dictionary’s RAW references, one scan against the two readers it replaced', () => {
  it('matches the retired regex route on every fixture', async () => {
    const cache = newSourceCache();
    for (const name of DICTS) {
      const cheap = await cheapOf(cache, name);
      if (cheap.kind !== 'sldd') throw new Error(`${name} is not a dictionary to this cache`);
      expect(cheap.refs, name).toEqual(retiredRefs(bytesOf(name)));
    }
  });

  it('matches the full reader on every fixture', async () => {
    const cache = newSourceCache();
    for (const name of READABLE_DICTS) {
      const cheap = await cheapOf(cache, name);
      if (cheap.kind !== 'sldd') throw new Error(`${name} is not a dictionary to this cache`);
      expect(cheap.refs, name).toEqual(fullSlddRefs(bytesOf(name)));
    }
  });

  it('is not comparing empty reference lists', async () => {
    // Non-vacuity for both sweeps above: most fixtures reference nothing, and equality over a
    // corpus of empty lists is no evidence at all. `chain_top.sldd` is the compressed one whose
    // reference lives inside the zip, and the parity dictionaries are MATLAB's own.
    const cache = newSourceCache();
    const refsOf = async (name: string): Promise<readonly string[]> => {
      const cheap = await cheapOf(cache, name);
      return cheap.kind === 'sldd' ? cheap.refs : [];
    };
    expect(await refsOf('folder-fixtures/chain_top.sldd')).toEqual(['chain_leaf.sldd']);
    expect(await refsOf('parity/artifacts/text/params.sldd')).toContain('common.sldd');
    expect(await refsOf('parity/artifacts/binary/params.sldd')).toContain('common.sldd');
  });

  it('keeps the literal spelling the summary lower-cases away', async () => {
    // WHY the artifact carries `refs` at all rather than reading them back off the summary: the
    // summary's list is `refs.map(refBasename)`, which is what a NAME resolves through, and the
    // tree needs what the file SAYS. Both come off the same scan, so this is the one property
    // that would survive them being confused for each other.
    const cache = newSourceCache();
    for (const name of DICTS) {
      const cheap = await cheapOf(cache, name);
      if (cheap.kind !== 'sldd') throw new Error(`${name} is not a dictionary to this cache`);
      const summary = cheap.summary.slddByName.get(refBasename(`/fx/${name}`));
      expect(summary?.slddRefs, name).toEqual(cheap.refs.map(refBasename));
    }
  });
});

describe('a data file’s usage summary, against one built by the FULL reader', () => {
  // The summariser now runs on the cheap tier's scan instead of on its own read of the file. Core
  // owns the reduction (`summarizeSlddScan`/`summarizeMatScan`, the same call `summarizeFiles`
  // makes), so what is at risk here is what this host hands it — the scan, the srcId and the
  // filename — and a wrong srcId silently re-keys every Usage answer that resolves through the
  // summary. The expected object is spelled out from the full parse for that reason: it is the
  // whole `DataSummary`, so nothing about it can be right by construction.
  it('gives every dictionary the summary its full parse implies', async () => {
    const cache = newSourceCache();
    for (const name of READABLE_DICTS) {
      const file = asFile(name);
      const cheap = await cheapOf(cache, name);
      if (cheap.kind !== 'sldd') throw new Error(`${name} is not a dictionary to this cache`);
      expect([...cheap.summary.slddByName.keys()], name).toEqual([refBasename(file.path)]);
      expect(cheap.summary.slddByName.get(refBasename(file.path)), name).toEqual({
        srcId: file.uriString,
        names: new Set(fullSlddNames(bytesOf(name)).filter((n) => n !== '')),
        slddRefs: fullSlddRefs(bytesOf(name)).map(refBasename),
      });
      // A dictionary contributes no models and no MAT-files, whichever route built it.
      expect(cheap.summary.models, name).toEqual([]);
      expect(cheap.summary.matByName.size, name).toBe(0);
    }
  });

  it('gives every MAT-file the summary its full parse implies', async () => {
    const cache = newSourceCache();
    for (const name of READABLE_MAT) {
      const file = asFile(name);
      const cheap = await cheapOf(cache, name);
      if (cheap.kind !== 'mat') throw new Error(`${name} is not a MAT-file to this cache`);
      expect([...cheap.summary.matByName.keys()], name).toEqual([refBasename(file.path)]);
      expect(cheap.summary.matByName.get(refBasename(file.path)), name).toEqual({
        srcId: file.uriString,
        names: new Set(fullMatNames(bytesOf(name)).filter((n) => n !== '')),
        // A MAT-file inherits nothing, and this is not a field the scan could fill.
        slddRefs: [],
      });
      expect(cheap.summary.models, name).toEqual([]);
      expect(cheap.summary.slddByName.size, name).toBe(0);
    }
  });

  it('is not comparing empty summaries', async () => {
    const cache = newSourceCache();
    const namesOf = async (name: string): Promise<Set<string>> => {
      const cheap = await cheapOf(cache, name);
      if (cheap.kind === 'model') return new Set();
      const data = [...cheap.summary.slddByName.values(), ...cheap.summary.matByName.values()][0];
      return new Set(data?.names ?? []);
    };
    expect(await namesOf('folder-fixtures/params.sldd')).toContain('Kp');
    expect(await namesOf('parity/artifacts/binary/params.sldd')).toContain('gravity');
    expect(await namesOf('folder-fixtures/nd_numeric.mat')).toContain('Nd4');
  });
});

describe('a file no full reader can read is an EMPTY artifact, not a dropped one', () => {
  // The answer `dataCheapOf` owes such a file, and the reason it is not `null`: the file is still
  // in the folder, so it must stay a node in a host's tree and a source in a usage plan's scope.
  // Swept rather than picked, so a fixture added later that no reader can read is held to it too.
  it('names the files it is about', () => {
    // A guard on the test below: an empty list would pass it while asserting nothing. Today the one
    // such fixture is a v7.3 (HDF5) MAT-file, which no reader in this package parses.
    expect(DATA.filter(refusedByFullReader)).toEqual(['fixtures/strings_v73.mat']);
  });

  it('gives each of them an empty summary, no references and no names', async () => {
    const cache = newSourceCache();
    for (const name of DATA.filter(refusedByFullReader)) {
      const cheap = await cheapOf(cache, name);
      expect(cheap.kind, name).toBe(isMatFile(name) ? 'mat' : 'sldd');
      if (cheap.kind === 'model') continue;
      expect(cheap.names, name).toEqual([]);
      if (cheap.kind === 'sldd') expect(cheap.refs, name).toEqual([]);
      expect(cheap.summary.models, name).toEqual([]);
      expect(cheap.summary.slddByName.size + cheap.summary.matByName.size, name).toBe(0);
    }
  });
});

describe('the occurrence-ordered names the search index reads', () => {
  // `Cheap.names` is the scan's own array — one string per entry, in file order, placeholders
  // included — and the summary's `Set` is built from it. Every property that distinguishes the two
  // is asserted here, because nothing else in this repo can see the difference: a Set round-trip
  // on this path would drop a duplicate search hit and no other test would move.
  it('is what the full parse lists, in order, for every dictionary', async () => {
    const cache = newSourceCache();
    for (const name of READABLE_DICTS) {
      const cheap = await cheapOf(cache, name);
      if (cheap.kind !== 'sldd') throw new Error(`${name} is not a dictionary to this cache`);
      expect(cheap.names, name).toEqual(fullSlddNames(bytesOf(name)));
    }
  });

  it('is what the full parse lists, in order, for every MAT-file', async () => {
    const cache = newSourceCache();
    for (const name of READABLE_MAT) {
      const cheap = await cheapOf(cache, name);
      if (cheap.kind !== 'mat') throw new Error(`${name} is not a MAT-file to this cache`);
      expect(cheap.names, name).toEqual(fullMatNames(bytesOf(name)));
    }
  });

  it('really does carry duplicates and empty placeholders', async () => {
    // Non-vacuity for the two sweeps above, and the measurement that justifies `DUPS` existing:
    // the fixtures on disk supply the `''` placeholder in quantity (every MAT-file holding an
    // MCOS object carries a trailing anonymous element) and a duplicate name in a few MAT-files
    // built to hold one — but no DICTIONARY on disk carries either, so over the directory alone
    // a deduped or filtered array would pass every dictionary assertion in this file.
    const counted = async (list: readonly string[]) => {
      const cache = newSourceCache();
      let duplicates = 0;
      let placeholders = 0;
      for (const name of list) {
        const cheap = await cheapOf(cache, name);
        if (cheap.kind === 'model') continue;
        if (new Set(cheap.names).size < cheap.names.length) duplicates++;
        if (cheap.names.includes('')) placeholders++;
      }
      return { duplicates, placeholders };
    };
    const fixtures = await counted(CORPUS);
    expect(fixtures.placeholders).toBeGreaterThan(0);
    expect(fixtures.duplicates).toBeGreaterThan(0);
    // And none of them is a dictionary's — which is why `DUPS` is one, carrying both.
    expect(await counted(SLDD)).toEqual({ duplicates: 0, placeholders: 0 });
    expect(await counted([DUPS])).toEqual({ duplicates: 1, placeholders: 1 });
  });

  it('keeps a duplicate name twice, and the placeholder, where the summary keeps neither', async () => {
    // The same facts stated as the answers themselves, on the one dictionary that has both. All
    // three fields come off one scan, so this is the reduction being visible: the array is what
    // the file holds, in order, and the Set is what a name resolves through.
    const cache = newSourceCache();
    const cheap = await cheapOf(cache, DUPS);
    if (cheap.kind !== 'sldd') throw new Error('expected a dictionary');
    expect(cheap.names).toEqual(['Kp', 'Kp', '', 'Uo', 'Ki']);
    expect([...(cheap.summary.slddByName.get('duplicate_names.sldd')?.names ?? [])]).toEqual([
      'Kp',
      'Uo',
      'Ki',
    ]);
  });

  it('hands the search index the SAME strings, not copies of them', async () => {
    // The other half of "no second copy": the array is core's own and the Set holds the same
    // string objects, so a folder of dictionaries costs one array of names and not two. Object
    // identity is the only way to state it, and `Object.is` on an interned short string proves
    // nothing — so this is checked on the array, which is what a defensive copy would clone.
    const cache = newSourceCache();
    const first = await cheapOf(cache, 'folder-fixtures/params.sldd');
    const second = await cheapOf(cache, 'folder-fixtures/params.sldd');
    if (first.kind !== 'sldd' || second.kind !== 'sldd') throw new Error('expected dictionaries');
    expect(second.names).toBe(first.names);
    expect(second.refs).toBe(first.refs);
  });
});
