// Copyright 2026 The MathWorks, Inc.
//
// A model is parsed ONCE per content change, however many consumers want it.
//
// The duplicate work this pins out is not visible in any answer: opening a model ran a full
// `parseModel` for the rows (`DataModel.addModelSource`) and a second one for the Usage summary
// (`summarizeFiles`), on the same bytes, in the same open — 2 parses of a 120 000-block model,
// 1369 ms, where one parse is 675 ms. Opening a linked dictionary and then the model it names
// did the same thing across two opens: the dictionary's usage scope parsed the model, the tab
// then parsed it again. Both look perfect from the outside, which is why the claim has to be
// stated as a COUNT.
//
// How the count is taken, and why it is honest: `parsedModelOf` is the only place a host using this
// cache parses a model, and every parse it makes stores a NEW `{version, parsed}` entry in
// `cache.parsed`. So "which files were parsed between here and there" is the set of entries
// whose object identity moved — a structural count, taken at the call site, with no counter to
// keep in sync. Counting `parseModel` from outside instead does NOT work: `summarizeFiles` and
// `addModelSource` reach it through a relative import, and an ESM namespace binding cannot be
// reassigned. The one blind spot is stated as its own test at
// the bottom: a file the reader will not version is parsed and not kept, so it is invisible here.
//
// Counts, not milliseconds, so these hold on any machine. Over real fixture bytes, because the
// artifacts are the parsers' output and a stub would let this agree with the cache about a
// shape they do not produce.
//
// These came here from the vscode extension with the cache, as did the core half of its
// tabRoute.test.ts. Where a case only needs a folder pass, it is the two tiers a usage plan runs
// with the wanted set written out (`summarise`); the cases that ask the PLAN which models to
// summarise — a dictionary's chain reaching its model, a model outside the scope — call
// `planSummaries` itself, and came with it (the block after the tab route).
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cheapAll,
  createSession,
  fillModelSummaries,
  newSourceCache,
  parsedModelForOpenTab,
  parsedModelOf,
  planSummaries,
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

// `chain_model.slx` links `chain_top.sldd`, which references `chain_leaf.sldd` from inside its
// zip. That chain is the reported case: open the dictionary, then open the model.
const MODEL = file('chain_model.slx');
const TOP = file('chain_top.sldd');
const LEAF = file('chain_leaf.sldd');
const OTHER = file('shared_gain.slx');
const FILES = [MODEL, TOP, LEAF, OTHER, file('params.sldd'), file('nd_numeric.mat')];

let reads: string[] = [];
let stamp: Map<string, string>;

// The folder pass's reader. Its `bytes` is the read a SCAN makes.
const reader: SourceReader = {
  version: async (f) => stamp.get(f.path) ?? null,
  bytes: async (f) => {
    reads.push(f.path);
    return bytesOf(f.path.slice('/fx/'.length));
  },
};

// What a TAB does: ask the cache's tab entry point for the parse, then register it in a session —
// the two calls the vscode host makes for a model tab (`BinaryEditorProvider.post`, through view's
// `getModelForBinaryTab`). The parse's read is counted like any other.
//
// Nothing is de-registered between opens, exactly as in a host: `addModelSourceParsed` REPLACES
// the session entry for a srcId (the previous tree is deindexed first), so a re-open needs no help.
let session: Session;
async function openTab(cache: SourceCache, f: SourceFile): Promise<any> {
  const parsed = await parsedModelForOpenTab(cache, f, stamp.get(f.path) ?? null, async () => {
    reads.push(f.path);
    return bytesOf(f.path.slice('/fx/'.length));
  });
  if (!parsed) throw new Error(`no parse for ${f.path}`);
  return session.addModelSourceParsed(f.uriString, parsed);
}

/**
 * A folder pass's two tiers, as a usage plan runs them: the cheap artifact for every file, then
 * the summary of each model in `wanted`. Which models a plan wants is the plan's business and is
 * tested with it.
 */
async function summarise(cache: SourceCache, r: SourceReader, files: SourceFile[], wanted: SourceFile[]): Promise<void> {
  const cheap = await cheapAll(cache, r, files);
  await fillModelSummaries(cache, r, files, new Set(wanted.map((f) => f.uriString)), cheap);
}

/** The model summary the expensive tier holds for `f`. */
const summaryOf = (cache: SourceCache, f: SourceFile): any => cache.models.get(f.uriString)?.summary.models[0];

/** The rows a tab shows. */
const rows = (node: any): unknown[] => session.rowsOf(node);

/** Which model each parsed entry currently is, by object identity — the parse ledger. */
const ledger = (cache: SourceCache): Map<string, unknown> =>
  new Map([...cache.parsed].map(([uri, entry]) => [uri, entry]));

/** The files parsed between two ledgers: a new entry, or an entry that was replaced. */
function parsedBetween(before: Map<string, unknown>, after: Map<string, unknown>): string[] {
  return [...after]
    .filter(([uri, entry]) => before.get(uri) !== entry)
    .map(([uri]) => uri)
    .sort();
}

const modelReads = (): string[] => reads.filter((p) => p.endsWith('.slx') || p.endsWith('.mdl'));

beforeEach(() => {
  reads = [];
  session = createSession();
  stamp = new Map(FILES.map((f) => [f.path, `v1:${f.path}`]));
});

describe('opening a model parses it once, not once per consumer', () => {
  it('parses the opened model exactly once between the rows and the Usage summary', async () => {
    const cache = newSourceCache();

    // The tab: rows.
    const node = await openTab(cache, MODEL);
    expect(rows(node).length).toBeGreaterThan(0);
    expect(parsedBetween(new Map(), ledger(cache))).toEqual([MODEL.uriString]);

    // The same open's Usage column, which is the second consumer and used to be the second
    // parse. It is a whole folder pass, so it wants this model's relationships for the CHEAP
    // tier as well — and those three fields are read off the parse the tab just made, so the
    // pass neither parses the model again nor reads it.
    const mid = ledger(cache);
    await summarise(cache, reader, FILES, [MODEL]);
    expect(parsedBetween(mid, ledger(cache))).toEqual([]);
    expect(summaryOf(cache, MODEL).srcId).toBe(MODEL.uriString);

    // One parse, and both consumers are reading it: the registered tree holds the parse's own
    // `rawContents` object and the summary holds its own `masks` array. A second parse would
    // have produced equal-but-distinct objects for both, which no deep comparison would catch.
    const parsed = (cache.parsed.get(MODEL.uriString) as { parsed: any }).parsed;
    expect(parsed.rawContents).toBeTruthy();
    expect(node.rawContents).toBe(parsed.rawContents);
    expect(parsed.masks).toBeTruthy();
    expect(summaryOf(cache, MODEL).masks).toBe(parsed.masks);

    // ONE read of the model in the whole open — the tab's own. It was three when the two
    // consumers each parsed for themselves and the cheap tier scanned the bytes a third time, and
    // two once the parse was shared; the last one goes because the cheap tier's three fields are
    // already inside that parse (sourceCache's `cheapOf`, SlxStructure's `structureFromParsed`).
    expect(modelReads().filter((p) => p === MODEL.path).length).toBe(1);
  });

});

describe('two consumers that ask at the SAME TIME parse once', () => {
  // The half of "once per content change" a map of finished parses cannot cover, and the half the
  // ledger above is blind to by construction: two callers that both miss, both read and both parse
  // store two equal entries at one version, so the FINAL map shows one identity change either way.
  // What tells them apart is what was read, and which object each caller got back.
  //
  // Every test here fires the second ask without awaiting the first — that is the whole scenario,
  // and an `await` between them would turn each of them into the cache-hit case already pinned
  // above.
  const askFor = (cache: SourceCache, f: SourceFile): Promise<any> =>
    parsedModelOf(cache, f, stamp.get(f.path) ?? null, () => reader.bytes(f));

  it('reads and parses once for two consumers in flight together, and hands both the same object', async () => {
    const cache = newSourceCache();
    const first = askFor(cache, MODEL);
    const second = askFor(cache, MODEL);
    const [a, b] = await Promise.all([first, second]);

    // One read, where two callers each reading for themselves is two — the bytes are the larger
    // half of the cost on this path, and a 13.8 MB model read twice is what the thunk exists to
    // avoid.
    expect(reads).toEqual([MODEL.path]);
    // The same object, not an equal one: distinct parses are what a deep comparison cannot see,
    // and what both consumers then hold BY REFERENCE (the registered tree's `rawContents`, the
    // summary's `masks`), so two of them is two retained copies as well as two parses.
    expect(a).toBe(b);
    expect(a).toBe((cache.parsed.get(MODEL.uriString) as { parsed: any }).parsed);
    expect(parsedBetween(new Map(), ledger(cache))).toEqual([MODEL.uriString]);
  });

  it('parses once when one model is opened in two panels at once', async () => {
    // A host that lets one model be split across two panels (vscode's
    // `supportsMultipleEditorsPerDocument`) has two tabs posting for one uri. Both call the tab
    // entry point, neither has finished when the other starts.
    const cache = newSourceCache();
    const [a, b] = await Promise.all([openTab(cache, MODEL), openTab(cache, MODEL)]);

    expect(reads).toEqual([MODEL.path]);
    // Both trees really are holding the one shared parse: `ModelNode.fromParsed` keeps
    // `rawContents` by reference, so an equal-but-distinct object would be a second parse. (Whether
    // the second panel re-uses the first one's TREE as well is the host's node cache, not this
    // one's — the vscode host's view keeps one node per uri.)
    const held = (cache.parsed.get(MODEL.uriString) as { parsed: any }).parsed.rawContents;
    expect(a.rawContents).toBe(held);
    expect(b.rawContents).toBe(held);
    expect(parsedBetween(new Map(), ledger(cache))).toEqual([MODEL.uriString]);
  });

  it('forgets a parse that FAILED, so the next ask retries it instead of joining the failure', async () => {
    // The cost of getting this wrong is worse than the duplicate work it removes: a rejected parse
    // left in the in-flight map is one every later caller at that version joins, so a file that
    // would not read once would never read again — where the version key otherwise retries it on
    // the next ask, and a corrupt model recovers the moment it is fixed.
    const cache = newSourceCache();
    const junk = (): Promise<ArrayBuffer> => Promise.resolve(new TextEncoder().encode('PK not a zip').buffer);
    const version = stamp.get(MODEL.path) ?? null;
    const first = parsedModelOf(cache, MODEL, version, junk);
    const second = parsedModelOf(cache, MODEL, version, junk);

    // Both callers see the failure — a joined parse is joined for its throw as well as its answer,
    // which is what lets a tab still show its "Failed to parse" banner.
    await expect(first).rejects.toThrow();
    await expect(second).rejects.toThrow();
    expect(cache.parsing.size).toBe(0);

    // The same file, the same version, real bytes: parsed, not re-joined to the rejection.
    const parsed = await parsedModelOf(cache, MODEL, version, () => reader.bytes(MODEL));
    expect(parsed).toBeTruthy();
  });

  it('does NOT join two versionless asks, which is the same rule as never keeping them', async () => {
    // A file the reader will not version is parsed for its caller and shared with nobody. There is
    // no key to coalesce on: two callers with no version can be shown to want the same PATH, never
    // the same bytes, and handing the second one a parse of whatever the first happened to read
    // would be a guess where every other entry in this module is a version check. So it costs one
    // parse per caller, exactly as it did before there was an in-flight map — reachable only above
    // MAX_SCAN_BYTES or after a failed `stat`.
    const cache = newSourceCache();
    const [a, b] = await Promise.all([
      parsedModelOf(cache, MODEL, null, () => reader.bytes(MODEL)),
      parsedModelOf(cache, MODEL, null, () => reader.bytes(MODEL)),
    ]);

    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    expect(cache.parsed.size).toBe(0);
    expect(cache.parsing.size).toBe(0);
  });
});

describe('a second open of an unchanged model parses nothing', () => {
  it('re-registers the tree from the parse it already had', async () => {
    const cache = newSourceCache();
    const first = await openTab(cache, MODEL);
    const afterFirst = ledger(cache);
    reads = [];

    const second = await openTab(cache, MODEL);

    expect(parsedBetween(afterFirst, ledger(cache))).toEqual([]);
    expect(reads).toEqual([]);
    // A new tree each time — a host's own node cache was dropped — built from the one parse.
    // Rows equal, nodes distinct.
    expect(second).not.toBe(first);
    expect(rows(second)).toEqual(rows(first));
  });
});

describe('a version bump re-parses exactly the file that moved', () => {
  it('re-parses one model and keeps the other', async () => {
    const cache = newSourceCache();
    // Every model in the folder summarised — what an unscoped usage plan does — so there are two
    // parses to tell apart.
    await summarise(cache, reader, FILES, FILES);
    expect([...cache.parsed.keys()].sort()).toEqual([MODEL.uriString, OTHER.uriString].sort());
    const before = ledger(cache);

    stamp.set(OTHER.path, `v2:${OTHER.path}`);
    await summarise(cache, reader, FILES, FILES);

    expect(parsedBetween(before, ledger(cache))).toEqual([OTHER.uriString]);
  });

  it('re-parses for a tab whose file moved under it, and hands the tab the new tree', async () => {
    const cache = newSourceCache();
    const first = await openTab(cache, MODEL);
    const before = ledger(cache);

    // What an external edit looks like to the cache: the version moved. Nothing had to be
    // invalidated for this — the entry key IS the content version, which is why a host's tab
    // drops its own node and leaves this cache alone.
    stamp.set(MODEL.path, `v2:${MODEL.path}`);
    reads = [];
    const second = await openTab(cache, MODEL);

    expect(parsedBetween(before, ledger(cache))).toEqual([MODEL.uriString]);
    expect(reads).toEqual([MODEL.path]);
    expect(second.rawContents).not.toBe(first.rawContents);
  });
});

describe('what the count cannot see', () => {
  it('parses, and does not keep, a model the reader will not version', async () => {
    // The blind spot in the method above, stated rather than left implicit. A file over the
    // scan cap has no version to key an entry by, and a tab must still open it — so it is
    // parsed on every open and counted nowhere. `scanVersionOf` returns null for exactly this.
    const cache = newSourceCache();
    const parsed = await parsedModelOf(cache, MODEL, null, async () => bytesOf('chain_model.slx'));
    expect(parsed).toBeTruthy();
    expect(cache.parsed.size).toBe(0);
  });

  it('summarises a model it cannot parse as nothing, without failing the folder', async () => {
    // The guard that moved when the parse moved: it used to live inside `summarizeFiles`, per
    // file. One corrupt model in a folder must not empty the Usage
    // answers for every other file in it.
    const cache = newSourceCache();
    const corrupt = file('corrupt.slx');
    stamp.set(corrupt.path, `v1:${corrupt.path}`);
    const bad: SourceReader = {
      version: reader.version,
      bytes: async (f) =>
        f.path === corrupt.path ? new TextEncoder().encode('PK not a zip').buffer : reader.bytes(f),
    };
    const files = [...FILES, corrupt];
    await summarise(cache, bad, files, files);
    expect(cache.models.get(corrupt.uriString)?.summary.models).toEqual([]);
    // The rest of the folder answered as usual.
    expect(summaryOf(cache, MODEL)?.srcId).toBe(MODEL.uriString);
    expect(summaryOf(cache, OTHER)?.srcId).toBe(OTHER.uriString);
  });
});

// The core half of the vscode host's tabRoute.test.ts. WHICH route a tab takes — the shared parse
// for a model, its own bytes for anything else — is the host's decision (view's
// `getModelForBinaryTab`) and stays tested there. What the cache owes a model tab is that the
// parse it hands back is the very object it holds, so the registered tree and every other
// consumer read one parse: an equal-but-distinct object here is the fingerprint of a second
// parse, which a deep row comparison cannot see.
describe('a model tab registers the very parse the cache holds', () => {
  // Both model flavours, because the branch a host takes is `isModelFile` and a `.mdl` is text: a
  // dispatch that had quietly become "is it a zip" would show up here.
  for (const name of ['chain_model.slx', '../parity/artifacts/mdltext/mdltext.mdl']) {
    it(`for ${name.split('/').pop()}`, async () => {
      const f = file(name);
      const cache = newSourceCache();
      stamp.set(f.path, `v1:${f.path}`);
      const node = await openTab(cache, f);

      expect(reads).toEqual([f.path]);
      const held = cache.parsed.get(f.uriString) as { parsed: any };
      expect(held.parsed.rawContents).toBeTruthy();
      expect(node.rawContents).toBe(held.parsed.rawContents);
      expect(cache.pinnedParses).toEqual([f.uriString]);
      expect(rows(node).length).toBeGreaterThan(0);
    });
  }
});

// The cases that need the usage PLAN to decide which models to summarise. A model outside the
// opened file's scope must not be parsed for it, and a model reached from a dictionary's chain is
// parsed once whichever opens first: these are the scope rule and the cache agreeing.
describe('the usage plan parses what its scope names, once', () => {
  it('parses a model NOT in the opened model’s scope zero times', async () => {
    // The scope rule this must not undo: a model resolves through its own chain, so another
    // model in the folder is never parsed for it. It is versioned and cheaply scanned only.
    const cache = newSourceCache();
    await openTab(cache, MODEL);
    await planSummaries(cache, reader, FILES, MODEL.uriString);
    expect([...cache.parsed.keys()]).toEqual([MODEL.uriString]);
  });

  it('is one parse across opening a dictionary and then its model, not one each', async () => {
    // The reported case. Opening `chain_leaf.sldd` has to summarise `chain_model.slx` to answer
    // "what uses ChainVar" — a full parse, on the dictionary's behalf. Opening the model next then
    // parsed the same bytes again for its rows.
    const cache = newSourceCache();

    await planSummaries(cache, reader, FILES, LEAF.uriString);
    const afterDict = ledger(cache);
    expect(parsedBetween(new Map(), afterDict)).toEqual([MODEL.uriString]);
    const held = cache.parsed.get(MODEL.uriString) as { parsed: any };

    reads = [];
    const node = await openTab(cache, MODEL);

    // Nothing parsed, and nothing read either: the tab's own read is skipped on a hit, so a
    // 13.8 MB model already parsed for a dictionary costs a `stat`.
    expect(parsedBetween(afterDict, ledger(cache))).toEqual([]);
    expect(reads).toEqual([]);
    // And the rows really came from that parse rather than from a fresh one.
    expect(node.rawContents).toBe(held.parsed.rawContents);
    expect(rows(node).length).toBeGreaterThan(0);
  });

  it('registers nothing in a session for a model parsed on a dictionary’s behalf', async () => {
    // Retaining a parse is not registering it. A model reachable from an opened dictionary is
    // parsed, and its tree stays unbuilt until a TAB asks for it — otherwise the registry holds
    // nodes `findNodeById` resolves selections into with no view to show them.
    const cache = newSourceCache();
    await planSummaries(cache, reader, FILES, LEAF.uriString);
    expect(cache.parsed.has(MODEL.uriString)).toBe(true);
    expect(session.hasDataSource(MODEL.uriString)).toBe(false);
  });

  it('parses a shared model once when two restored tabs plan their usage at the same time', async () => {
    // A host that dedups usage builds by the file being VIEWED (the vscode host does) runs two
    // whole-folder passes for two files open in two editor groups, and both scope
    // `chain_model.slx` — one because it IS the file, one because the chain from
    // `chain_leaf.sldd` reaches it. Restoring such a window starts them together.
    const cache = newSourceCache();
    const [forModel, forLeaf] = await Promise.all([
      planSummaries(cache, reader, FILES, MODEL.uriString),
      planSummaries(cache, reader, FILES, LEAF.uriString),
    ]);

    // Two reads of the model across BOTH passes — one for the cheap tier's structure and one for
    // the parse, which is what a single pass costs. Four is what two independent passes cost.
    expect(modelReads().filter((p) => p === MODEL.path).length).toBe(2);
    expect(parsedBetween(new Map(), ledger(cache))).toEqual([MODEL.uriString]);
    // And both plans are answering out of that one parse, not out of one each.
    const parsed = (cache.parsed.get(MODEL.uriString) as { parsed: any }).parsed;
    const planned = (s: Awaited<ReturnType<typeof planSummaries>>): any =>
      s.models.find((m) => m.srcId === MODEL.uriString);
    expect(planned(forModel).masks).toBe(parsed.masks);
    expect(planned(forLeaf).masks).toBe(parsed.masks);
  });
});
