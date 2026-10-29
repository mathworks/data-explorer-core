// Copyright 2026 The MathWorks, Inc.
//
// `SourceCache.parsed` is BOUNDED, and dropping an entry from it costs a re-parse and never an
// answer.
//
// Those are two claims and the second is the load-bearing one. A parse of a 120 000-block model
// retains ~36 MB (~40 bytes per source byte, measured), and without a bound a host's first global
// search leaves an entry for EVERY model in the folder, so an unbounded map is a
// folder-sized leak. Bounding it is only safe because every entry is version-keyed and every
// consumer of one re-derives on a miss: a starved cache must give the same rows and the same
// summaries as a roomy one, and differ only in what it read to get them.
// That equality is what the middle group here asserts, in both directions — equal answers AND a
// witness that eviction really happened, so the comparison cannot pass vacuously.
//
// The numbers are derived from `entry.estimated` rather than written down, because the point is
// the POLICY: a budget in BYTES (a big model displaces two small ones), recency that a hit
// refreshes (not insertion age), and the two exemptions that keep it from evicting the answer it
// is about to return — the entry just stored, and the models a tab pinned. A pin is off-budget as
// well as un-evictable, and both halves are asserted: sparing an entry while still charging it
// makes the budget a cliff that collapses the tier for the whole folder.
//
// Over real fixture bytes, like every other test of this cache: the artifacts are the parsers'
// output, and a stub would let this agree with the cache about a shape they do not produce.
//
// These came here from the vscode extension with the cache, less two cases that compare a
// consumer's answer rather than the cache's: the name index's records stay with its name scan in
// that host, and the usage plan's summaries go with the plan. Where a case here needs a folder
// pass, it is the two tiers a usage plan runs, with every model wanted.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_PARSED_BUDGET_BYTES,
  PINNED_PARSES,
  cheapAll,
  clearSourceCache,
  createSession,
  fillModelSummaries,
  newSourceCache,
  parsedBudgetedBytes,
  parsedModelForOpenTab,
  parsedModelOf,
  parsedRetainedBytes,
  type Session,
  type SourceCache,
  type SourceFile,
  type SourceReader,
} from '../src/index.js';

const dir = join(import.meta.dirname, 'folder-fixtures');

function bytesOf(name: string): ArrayBuffer {
  const b = readFileSync(join(dir, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

const file = (name: string): SourceFile => ({ uriString: `file:///fx/${name}`, path: `/fx/${name}` });
const nameOf = (f: SourceFile): string => f.path.slice('/fx/'.length);

// Six models of different sizes, smallest first, so "a big one displaces two small ones" is a
// case these fixtures can actually make.
const SMALL = file('chain_model.slx'); // 684 bytes
const NEXT = file('shared_gain.slx'); // 715 bytes
const MID = file('model_with_refs.slx'); // 869 bytes
const BIG = file('sid_blocks.slx'); // 980 bytes
const PAIR = file('shadow_pair.slx'); // 955 bytes
const WS = file('shadow_ws.slx'); // 946 bytes
const MODELS = [SMALL, NEXT, MID, BIG, PAIR, WS];
const FILES = [...MODELS, file('chain_top.sldd'), file('chain_leaf.sldd'), file('params.sldd')];

let reads: string[] = [];
let stamp: Map<string, string>;

const reader: SourceReader = {
  version: async (f) => stamp.get(f.path) ?? null,
  bytes: async (f) => {
    reads.push(f.path);
    return bytesOf(nameOf(f));
  },
};

/** Ask for one model's parse the way a folder pass does — no pin. */
const scanParse = (cache: SourceCache, f: SourceFile): Promise<unknown> =>
  parsedModelOf(cache, f, stamp.get(f.path) ?? null, () => reader.bytes(f));

/**
 * What a TAB does — ask the cache's tab entry point, then register the parse in a session (the
 * vscode host's `sourceReads.parsedModelForTab`, then view's registration).
 *
 * `pin = false` reaches the cache the way a FOLDER PASS does, which is the control several tests
 * below need: same sequence, same budget, no pin, and the regression the pin exists to stop.
 */
let session: Session;
async function openTab(cache: SourceCache, f: SourceFile, pin = true): Promise<any> {
  const ask = pin ? parsedModelForOpenTab : parsedModelOf;
  const parsed = await ask(cache, f, stamp.get(f.path) ?? null, () => reader.bytes(f));
  if (!parsed) throw new Error(`no parse for ${f.path}`);
  return session.addModelSourceParsed(f.uriString, parsed);
}

/** The rows a tab shows. */
const rows = (node: any): unknown[] => session.rowsOf(node);

/** A folder pass that summarises every model in it — what an unscoped usage plan runs. */
async function summariseAll(cache: SourceCache): Promise<void> {
  const cheap = await cheapAll(cache, reader, FILES);
  await fillModelSummaries(cache, reader, FILES, new Set(FILES.map((f) => f.uriString)), cheap);
}

const keys = (cache: SourceCache): string[] => [...cache.parsed.keys()];
const estimateOf = (cache: SourceCache, f: SourceFile): number =>
  cache.parsed.get(f.uriString)?.estimated ?? 0;
const readsOf = (f: SourceFile): number => reads.filter((p) => p === f.path).length;

/** The estimated bytes `files` cost, taken from an unbounded cache — the budgets are built of these. */
async function estimates(files: readonly SourceFile[]): Promise<number[]> {
  const cache = newSourceCache();
  const out: number[] = [];
  for (const f of files) {
    await scanParse(cache, f);
    out.push(estimateOf(cache, f));
  }
  return out;
}

beforeEach(() => {
  reads = [];
  session = createSession();
  stamp = new Map(FILES.map((f) => [f.path, `v1:${f.path}`]));
});

describe('the bound is enforced', () => {
  it('keeps the map inside its budget across a folder of models', async () => {
    // A budget the size of the two models the pass ends on, so what survives is decided by the
    // policy rather than by these fixtures happening to be the same size.
    const [pair, ws] = await estimates([PAIR, WS]);
    const cache = newSourceCache(pair + ws);
    reads = [];

    for (const f of MODELS) await scanParse(cache, f);

    // Every model was answered — six reads, six parses — and two are retained, not six.
    expect(reads.length).toBe(MODELS.length);
    expect(parsedRetainedBytes(cache)).toBeLessThanOrEqual(cache.parsedBudget);
    expect(cache.parsed.size).toBeLessThan(MODELS.length);
    // The survivors are the most recent, and the map's own order is the recency order.
    expect(keys(cache)).toEqual([PAIR.uriString, WS.uriString]);
  });

  it('spends the budget in BYTES, so one big model displaces two small ones', async () => {
    // The discriminating case against an entry-COUNT bound, which is the obvious wrong policy
    // here: a cap of two entries would evict exactly one per insert, forever. Bytes evict as
    // many as the newcomer costs.
    const [small, next, , big] = await estimates([SMALL, NEXT, MID, BIG]);
    expect(big).toBeGreaterThan(small);
    const cache = newSourceCache(small + next);

    await scanParse(cache, SMALL);
    await scanParse(cache, NEXT);
    expect(keys(cache)).toEqual([SMALL.uriString, NEXT.uriString]);

    await scanParse(cache, BIG);

    expect(keys(cache)).toEqual([BIG.uriString]);
    expect(parsedRetainedBytes(cache)).toBe(big);
  });

  it('estimates a model from its source size, not per entry', async () => {
    const cache = newSourceCache();
    await scanParse(cache, SMALL);
    await scanParse(cache, BIG);
    const bytes = (f: SourceFile): number => bytesOf(nameOf(f)).byteLength;

    // Bigger source, bigger claim, and by the same ratio — the two entries are otherwise alike,
    // so a per-entry or rounded-up estimate would make them equal.
    expect(estimateOf(cache, BIG)).toBeGreaterThan(estimateOf(cache, SMALL));
    expect(estimateOf(cache, SMALL) / bytes(SMALL)).toBe(estimateOf(cache, BIG) / bytes(BIG));
    // And it claims MORE than the file, which is the whole reason there is a budget: a parse is
    // an expansion of the bytes, not a copy of them.
    expect(estimateOf(cache, SMALL)).toBeGreaterThan(bytes(SMALL));
  });

  it('spends the budget at the MEASURED expansion factor, not an arbitrary multiple', async () => {
    // `PARSED_BYTES_PER_SOURCE_BYTE` is a MEASUREMENT — forced-GC `heapUsed` deltas over a
    // benchmark corpus and these fixtures, ~40 retained bytes per source byte. Nothing else in this suite can see it: every budget here is derived from
    // `entry.estimated`, so the file is invariant to the factor and a value of 400 passes all of
    // it. Yet the factor is what decides how much SOURCE the shipped 256 MB budget buys — 6.4 MB
    // at 40x, 640 KB at 400x, where the 36.6 MB benchmark folder would thrash.
    //
    // So a band around the measurement rather than the number itself: wide enough that a
    // re-measurement landing anywhere in the measured range (23-40x on real models) is not a
    // failure, narrow enough that a typo or a guess is. Moving it is re-measuring, and not something
    // to widen this band for.
    const cache = newSourceCache();
    await scanParse(cache, BIG);
    const factor = estimateOf(cache, BIG) / bytesOf(nameOf(BIG)).byteLength;

    expect(factor).toBeGreaterThanOrEqual(20);
    expect(factor).toBeLessThanOrEqual(80);
  });

  it('caches a model larger than the whole budget rather than dropping the answer', async () => {
    // A budget is a steady-state target, not a promise the process can keep against one model
    // bigger than it. Sparing the entry just stored is what makes the pass that asked still get
    // a cache out of it — the alternative is evicting the answer being returned and re-parsing
    // it on the very next ask.
    const cache = newSourceCache(1);
    const parsed = await scanParse(cache, BIG);

    expect(parsed).toBeTruthy();
    expect(keys(cache)).toEqual([BIG.uriString]);
    expect(parsedRetainedBytes(cache)).toBeGreaterThan(cache.parsedBudget);

    // Bounded exemption, though: the NEXT model does not join it.
    await scanParse(cache, SMALL);
    expect(keys(cache)).toEqual([SMALL.uriString]);
  });

  it('ships a budget nothing configures, big enough that an ordinary folder never reaches it', async () => {
    // The number is justified in src/folder/sourceCache.ts against the measurement; what this pins is that
    // production gets it by DEFAULT, and that this suite's own starved budgets are the exception.
    expect(newSourceCache().parsedBudget).toBe(DEFAULT_PARSED_BUDGET_BYTES);
    const cache = newSourceCache();
    for (const f of MODELS) await scanParse(cache, f);
    expect(keys(cache).sort()).toEqual(MODELS.map((f) => f.uriString).sort());
  });
});

describe('an eviction costs a re-derive and changes no answer', () => {
  it('gives a tab the same rows from a starved cache as from a roomy one', async () => {
    const roomy = newSourceCache();
    const starved = newSourceCache((await estimates([SMALL]))[0]);

    const rowsFrom = async (cache: SourceCache): Promise<unknown> => {
      // Open the model, do a folder's worth of other work, then come back to it. Unpinned on
      // purpose: this is the eviction case, and the tab's rows must survive it.
      await openTab(cache, SMALL, false);
      for (const f of [NEXT, MID, BIG]) await scanParse(cache, f);
      return rows(await openTab(cache, SMALL, false));
    };

    reads = [];
    const before = await rowsFrom(roomy);
    const roomyReads = readsOf(SMALL);
    reads = [];
    const after = await rowsFrom(starved);

    expect(before).toEqual(after);
    expect(rows(await openTab(roomy, SMALL, false)).length).toBeGreaterThan(0);
    // Non-vacuous: the starved run re-read and re-parsed the model the roomy one still had.
    expect(roomyReads).toBe(1);
    expect(readsOf(SMALL)).toBe(2);
  });

  it('re-derives a model whose entry was evicted, with no error and no empty answer', async () => {
    // The claim at its narrowest, on the one function every consumer above reaches it through.
    const cache = newSourceCache((await estimates([SMALL]))[0]);
    const first: any = await scanParse(cache, SMALL);
    await scanParse(cache, BIG);
    expect(cache.parsed.has(SMALL.uriString)).toBe(false);

    const second: any = await scanParse(cache, SMALL);

    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(second.blockParamUsages).toEqual(first.blockParamUsages);
    expect(second.blockParamUsages.length).toBeGreaterThan(0);
  });
});

describe('recency is the eviction order, not age', () => {
  it('protects an old entry that was used again, and evicts the one that was not', async () => {
    // Room for the entry under test plus the newcomer, so exactly ONE eviction is due and the
    // question is only which entry it takes.
    const [small, mid] = await estimates([SMALL, MID]);
    const cache = newSourceCache(small + mid);
    await scanParse(cache, SMALL);
    await scanParse(cache, NEXT);

    // A HIT on the older entry. Nothing is read, nothing is parsed — the only effect this can
    // have is on the order, which is exactly what is under test.
    reads = [];
    await scanParse(cache, SMALL);
    expect(reads).toEqual([]);
    expect(keys(cache)).toEqual([NEXT.uriString, SMALL.uriString]);

    await scanParse(cache, MID);

    // Age alone would have evicted SMALL, the first one in. Recency evicts NEXT.
    expect(cache.parsed.has(SMALL.uriString)).toBe(true);
    expect(cache.parsed.has(NEXT.uriString)).toBe(false);
  });

  it('counts a re-parse at a new version as a use, not as the entry it replaced', async () => {
    const [small, next] = await estimates([SMALL, NEXT]);
    const cache = newSourceCache(small + next);
    await scanParse(cache, SMALL);
    await scanParse(cache, NEXT);

    stamp.set(SMALL.path, `v2:${SMALL.path}`);
    await scanParse(cache, SMALL);

    // A plain `set` on a key a Map already holds leaves its position alone, so without the
    // delete-then-set a refreshed entry would keep the position of the stale one it replaced.
    expect(keys(cache)).toEqual([NEXT.uriString, SMALL.uriString]);
  });
});

describe('the tab pin is what keeps the folder pass from thrashing', () => {
  it('parses an open model once across the tab and the folder pass behind it', async () => {
    // Case A, under a budget the folder exceeds. The tab opens the model, and the pass that
    // answers that same tab's Usage column then touches every other model in the folder —
    // leaving the tab's own parse least-recently-used, and about to be wanted again.
    const cache = newSourceCache((await estimates([SMALL]))[0]);
    reads = [];

    await openTab(cache, SMALL);
    await summariseAll(cache);
    const shown = rows(await openTab(cache, SMALL));

    expect(shown.length).toBeGreaterThan(0);
    // ONE read of the model in the whole sequence, and it is the tab's own. The folder pass reads
    // nothing of it: the cheap tier takes its three relationship fields off the parse the tab is
    // holding, and the summary tier's parse is a hit that the pin is what protects.
    expect(readsOf(SMALL)).toBe(1);
    expect(cache.parsed.has(SMALL.uriString)).toBe(true);
  });

  it('re-parses it when the pin is absent — the control for the test above', async () => {
    // Same budget, same sequence, `pin` dropped. This is the regression the pin exists to stop,
    // and stating it here is what keeps the test above from passing for some other reason: the
    // folder pass evicts the unpinned entry, so the second open reads and parses the file again —
    // two reads against the pinned sequence's one.
    const cache = newSourceCache((await estimates([SMALL]))[0]);
    reads = [];

    await openTab(cache, SMALL, false);
    await summariseAll(cache);
    await openTab(cache, SMALL, false);

    expect(readsOf(SMALL)).toBe(2);
    expect(cache.pinnedParses).toEqual([]);
  });

  it('keeps a pinned parse off the budget, so a folder that fitted keeps fitting', async () => {
    // The pins are spared from eviction AND not charged, and the second half is what this pins.
    // Charging them made the budget a bound on a number the policy cannot lower: with the pins
    // alone over it, every insert evicted every non-pinned entry it could reach and was still
    // over, so the map degenerated to {the pins, the newest} and every folder pass re-parsed the
    // whole folder — the regression this cache exists to remove, arriving silently the first
    // time a user opened a large model.
    const FOLDER = [SMALL, NEXT, MID];
    const fits = (await estimates(FOLDER)).reduce((a, b) => a + b, 0);
    const cache = newSourceCache(fits);

    // Two tabs, which is the whole pin ring, and then a folder pass the budget exactly holds.
    for (const f of [BIG, PAIR]) await openTab(cache, f);
    for (const f of FOLDER) await scanParse(cache, f);
    reads = [];
    for (const f of FOLDER) await scanParse(cache, f);

    // A second identical pass is free. Charged pins re-read all three, every pass, forever.
    expect(reads).toEqual([]);
    expect(cache.pinnedParses).toEqual([BIG.uriString, PAIR.uriString]);
    // Off-budget is not unobservable: the reported total is over the budget by exactly the pins,
    // so what the process retains is still a number a diagnostic can ask for.
    expect(parsedBudgetedBytes(cache)).toBeLessThanOrEqual(cache.parsedBudget);
    expect(parsedRetainedBytes(cache)).toBeGreaterThan(cache.parsedBudget);
    expect(parsedRetainedBytes(cache) - parsedBudgetedBytes(cache)).toBe(
      estimateOf(cache, BIG) + estimateOf(cache, PAIR),
    );
  });

  it('does not spend a pin slot on a model it cannot cache', async () => {
    // A tab over MAX_SCAN_BYTES, or one whose `stat` failed, is versionless: still parsed,
    // because the user named the file and is waiting for it, and deliberately not cached. A slot
    // spent on it would pin a uri the map holds no entry for, and leave the next real tab a ring
    // of one.
    const cache = newSourceCache();
    stamp.delete(SMALL.path);

    const node = await openTab(cache, SMALL);

    expect(node).toBeTruthy();
    expect(cache.parsed.size).toBe(0);
    expect(cache.pinnedParses).toEqual([]);
  });

  it('holds a bounded number of pins, and lets an older tab go', async () => {
    // A budget with no room for even ONE unpinned entry, which is what makes "the displaced tab
    // is evictable again" a claim this cache has to act on: the pins are off-budget, so a budget
    // the size of one model would simply have had room for the tab that fell out of the ring.
    const cache = newSourceCache((await estimates([SMALL]))[0] - 1);
    for (const f of [SMALL, NEXT, MID]) await openTab(cache, f);

    // A fixed ring, most recent last. Unbounded pinning would be an unbounded map by another
    // name, since a pinned entry cannot be evicted.
    expect(PINNED_PARSES).toBe(2);
    expect(cache.pinnedParses).toEqual([NEXT.uriString, MID.uriString]);
    // And the tab that fell out of the ring is evictable again: only the two pins survive.
    expect(keys(cache).sort()).toEqual([NEXT.uriString, MID.uriString].sort());
  });

  it('re-pins a tab the user came back to', async () => {
    // Same budget as above, and for the same reason: no room for an unpinned entry, so the tab
    // that leaves the ring is the one eviction takes.
    const cache = newSourceCache((await estimates([SMALL]))[0] - 1);
    for (const f of [SMALL, NEXT, MID]) await openTab(cache, f);
    await openTab(cache, SMALL);

    expect(cache.pinnedParses).toEqual([MID.uriString, SMALL.uriString]);
    expect(cache.parsed.has(NEXT.uriString)).toBe(false);
  });

  it('drops the pins when the cache is cleared', async () => {
    // A host clears the cache when a workspace folder is removed, which has just invalidated
    // the paths those tabs were named by. A pin left behind is a uri nothing can evict for the rest
    // of the session — the one way a fixed-size ring could still leak.
    const cache = newSourceCache();
    await openTab(cache, SMALL);
    expect(cache.pinnedParses).toEqual([SMALL.uriString]);

    clearSourceCache(cache);

    expect(cache.pinnedParses).toEqual([]);
    expect(cache.parsed.size).toBe(0);
  });
});
