import type { ParsedSlx } from '../datamodel/parser/SlxParser.js';
import { type SlxStructure } from '../datamodel/parser/SlxStructure.js';
import { type FileSummaries } from '../datamodel/usage/UsageIndex.js';
/** A candidate file, before anything has been read: what it is called and where. */
export interface SourceFile {
    uriString: string;
    path: string;
}
/**
 * How the cache reads. Two calls, and they are the whole point of it: the first is cheap
 * enough to make on every pass and the second is what that buys.
 */
export interface SourceReader {
    /**
     * An opaque token that changes when the file's content might have, or `null` for a file
     * that should not be read at all (too large, unreadable). Must not require reading the
     * file — a version that cost a read would defeat the cache it keys.
     */
    version(file: SourceFile): Promise<string | null>;
    /** The file's bytes, or `null` if it turned out to be unreadable after all. */
    bytes(file: SourceFile): Promise<ArrayBuffer | null>;
}
/** What kind of source a path names, as this package's kind tests classify it. */
export type SourceKind = 'model' | 'sldd' | 'mat' | 'prj';
/**
 * What one file yielded at the cheap tier, by kind.
 *
 * A discriminated union rather than a bag of optionals, because the kinds do not carry the
 * same thing and a consumer asking a model for a `summary` is a question with no answer, not
 * a field that happens to be missing. There is no `prj` arm: a project is classified and then
 * never cached (see the header).
 *
 * A data file carries `refs` and `names` as well as `summary`, and the three are ONE SCAN read
 * three ways — not three readings of the file. `summarizeSlddScan`/`summarizeMatScan` are this
 * package's reduction of the very scan whose `refs` and `names` sit beside it here, so the
 * artifact is the union of what its consumers need and every consumer is looking at the same
 * answer. What the
 * reduction drops is exactly what the other two fields keep:
 *
 *   `refs` — the summary's is `refs.map(refBasename)`, lowercased and stripped of
 *   directories, which is what a NAME resolves through; this is what the file actually SAYS,
 *   which is what a tree row naming an unresolved reference has to show. A dictionary naming
 *   `shared/Common.sldd` must not be reported as missing `common.sldd`: that is a file the user
 *   cannot search for and a directory the message has silently dropped. The reduction only runs
 *   in that direction, so the artifact keeps the wider list. Empty for a `.mat`, which inherits
 *   nothing.
 *
 *   `names` — the summary's is a `Set` of the non-empty ones, which is what a name RESOLVES
 *   through; this is one string per OCCURRENCE, in file order, `''` placeholders included,
 *   which is what the search index has to have. One dictionary legitimately holds two entries
 *   with the same name (Design Data and Other Data are separate namespaces — the vscode host's
 *   duplicateNameIdentity.test.ts), so a set would silently drop search hits, and a lost hit is
 *   invisible. The Set is built FROM this array, so the two cannot disagree, and the strings are
 *   shared rather than copied: this array is the scan's, and the Set holds the same string objects.
 *
 * A read this cannot recover from yields an EMPTY artifact of the right kind and not `null` —
 * empty summary, no refs, no names. That is the answer every consumer already got for such a
 * file when each of them scanned it separately and caught, and the file must stay a node in the
 * tree and a scope in the usage plan: it is still in the folder and still opens (see
 * `dataCheapOf`).
 */
export type Cheap = {
    readonly kind: 'model';
    readonly structure: SlxStructure;
} | {
    readonly kind: 'sldd';
    readonly summary: FileSummaries;
    readonly refs: readonly string[];
    readonly names: readonly string[];
} | {
    readonly kind: 'mat';
    readonly summary: FileSummaries;
    readonly names: readonly string[];
};
/** One cheap artifact and the version it was derived from. */
export interface CheapEntry {
    version: string;
    cheap: Cheap;
}
/**
 * One derivation that has STARTED and not finished, and the version it is deriving for.
 *
 * The gap a version-keyed map alone cannot close. Every tier here checks its map, misses, awaits
 * an `await bytes()`, and only then stores — so two callers that arrive before either has stored
 * both miss, both read, and both derive. Nothing is wrong with what they store (an equal artifact
 * at the same version, last writer wins), so the cost is invisible to any answer and to any test
 * that compares the map AFTERWARDS; it is invisible and it is the expensive case, because the
 * concurrent askers are exactly the ones on the folder-open path: in the vscode host, the usage
 * graph dedups by the file being VIEWED, so two restored tabs are two passes that both scope the
 * same model, and one model split across two editor panels asks twice at once.
 *
 * So the promise goes into the map BEFORE the await, and the second caller joins it rather than
 * starting again — the shape a host's usage graph uses for whole graph builds, one tier down.
 * Version-keyed like the artifact it will become: a caller asking for a version another caller is
 * not deriving must not join it.
 */
export interface InFlight<T> {
    version: string;
    promise: Promise<T>;
}
/** Cheap artifacts by uriString. Iterates in the order the pass was given its files. */
export type CheapMap = Map<string, CheapEntry>;
/**
 * The default ceiling on what `SourceCache.parsed` may retain, in estimated bytes.
 *
 * 256 MB, which is ~6.4 MB of model source at the factor above. Chosen against three measured
 * facts rather than picked round: every parse in the 37-file benchmark folder together is
 * 36.6 MB, so an ordinary folder never reaches the bound at all; ONE open 20 MB dictionary
 * already costs the window ~193 MB in a session's registered tree, which is not this cache's to
 * bound, so a cache allowed to grow past that would be the largest thing in the process for no
 * one's benefit; and a folder of large models is unbounded without it — 20 models of 5 MB would
 * retain about 4 GB.
 *
 * Deliberately NOT a user setting in any host. It is a memory-vs-re-parse trade a user has no way
 * to evaluate, the failure mode of getting it wrong is invisible (slower, never incorrect), and
 * every knob is permanent public surface. `newSourceCache` takes it as an argument so that the
 * tests can drive eviction with a small one, which is the only caller that needs another value.
 */
export declare const DEFAULT_PARSED_BUDGET_BYTES: number;
/**
 * How many recently tab-opened models are exempt from eviction.
 *
 * The one piece of information the size of an entry cannot supply: which model the user is looking
 * at. Without it, the folder pass that runs immediately after a tab opens (to answer its Usage
 * column) is a run of inserts that make the tab's own parse the least recently used entry in the
 * map — so a budget smaller than that folder evicts exactly the parse the pass is about to want,
 * and opening a dictionary and then its model goes back to two parses of the same bytes. The hint
 * comes IN from the host, because this module cannot see a tab and must not go looking for one: a
 * tab asks through the separate entry point `parsedModelForOpenTab` (the vscode host's
 * `sourceReads.parsedModelForTab` calls it). There is no `pin` OPTION on `parsedModelOf` — see
 * `parsedModelForOpenTab` for why the difference is an entry point rather than a flag.
 *
 * Two, and they cost nothing while their tabs are open: a model a tab has registered is
 * retained by the host's session anyway, so evicting its entry frees 0.5 MB of a 24 MB parse (2%,
 * measured) and buys a 675 ms re-parse. That is also why a pin is off-budget as well as
 * un-evictable (`parsedBudgetedBytes`). Two rather than one because switching back and forth
 * between two model tabs is the ordinary case; a small fixed number rather than "every open
 * tab" because a pinned entry is not evictable, and an unbounded pin set is an unbounded map
 * again by another name.
 */
export declare const PINNED_PARSES = 2;
/** One model's parse, the version it came from, and what it counts as against the budget. */
export interface ParsedEntry {
    version: string;
    parsed: ParsedSlx;
    /**
     * Estimated retained bytes — `PARSED_BYTES_PER_SOURCE_BYTE` times the source size. An
     * estimate and not a measurement: measuring a live object graph means walking it, which
     * would cost more than the parse this is accounting for.
     */
    estimated: number;
}
/**
 * What is kept between passes. An explicit value rather than module state, so a test can
 * hold a fresh one and a host names its process-wide instance at exactly one place (in the vscode
 * host, sourceReads.ts).
 */
export interface SourceCache {
    /** Per file: its cheap artifact, and the version it was derived from. */
    cheap: CheapMap;
    /**
     * Per model: its `parseModel` result, and the version it was parsed from.
     *
     * The expensive artifact, and the shared one: the rows a tab shows and the Usage summary
     * for the same model are two readings of THIS object, not two parses of the same bytes.
     * Filled by whichever consumer needs the model first, which may be a tab, a dictionary's
     * usage scope, or (later) the name index.
     *
     * Bounded, and ordered least-recently-used FIRST. Insertion order is the recency order: a
     * hit re-inserts its entry at the end, so the map's own iteration order is the eviction
     * order and there is no second structure to keep in step with this one.
     */
    parsed: Map<string, ParsedEntry>;
    /**
     * Per model: its full summary. Apart from `cheap` because it is filled LATER — on the
     * first pass that finds the model worth summarising, not on the pass that first saw the
     * file. Apart from `parsed` because the two have different fill points: a tab parses a
     * model without summarising it, and both orders have to be one parse.
     *
     * NOT bounded, and not for a size reason — see the note on `parsedBudget`.
     */
    models: Map<string, {
        version: string;
        summary: FileSummaries;
    }>;
    /**
     * The ceiling on the estimated bytes the EVICTABLE part of `parsed` may retain — every entry
     * except the pins, which are off-budget for the reason `parsedBudgetedBytes` gives. So what
     * the map can hold is this number plus up to `PINNED_PARSES` parses that the host's session is
     * holding anyway.
     *
     * Per-cache rather than a module constant so a test can name a budget a two-model corpus
     * exceeds; production reads `DEFAULT_PARSED_BUDGET_BYTES` and nothing configures it.
     *
     * `parsed` is the only tier with a budget, and the other two are deliberate. `cheap` is
     * cheap: 0.06 bytes per source byte, so bounding the whole 21 MB corpus down would recover
     * 2.8 MB at the price of the folder re-read this module exists to remove. `models` is small
     * too (9.4 MB for a folder of 11), but its reason is stronger and it is a CORRECTNESS one:
     * a usage plan's `summaryOf` reads an entry back out of this map with no re-derive, so an entry
     * evicted between `fillModelSummaries` and the merge would not cost a re-parse, it would
     * silently drop that model's usages out of the answer. A bound there needs the merge to
     * re-derive on a miss first.
     */
    parsedBudget: number;
    /**
     * The uriStrings of up to `PINNED_PARSES` models a tab most recently asked for, most recent
     * LAST. Never evicted, and never charged against `parsedBudget` either — see
     * `parsedBudgetedBytes` for why sparing an entry while still counting it is a cliff.
     *
     * Written only by `parsedModelForOpenTab`, the entry point a tab's read goes through, whose
     * one caller is a host's tab adapter (the vscode host's `sourceReads.parsedModelForTab`) — this
     * module has no way to see a tab and must not grow one.
     */
    pinnedParses: string[];
    /**
     * The parses that have started and not finished, by uriString — so two consumers that ask for
     * one model at the same time are one `parseModel` and one read, not two of each. See `InFlight`
     * for the window this closes and `coalesced` for the mechanism.
     *
     * NOT charged against `parsedBudget` and not evictable, because the number to charge does not
     * exist yet: an entry's `estimated` is its source's `byteLength` times a factor, and there is no
     * byteLength before the read this entry IS. (The version token happens to carry the `stat` size
     * today, but reading a size out of it would make the budget depend on the format of a token
     * `SourceReader` calls opaque.) What that costs is a transient: K parses running at once are
     * charged only as they resolve, so the map can be over budget by their combined size until they
     * are — bounded by how many can run at once (a folder pass runs at most `SCAN_READ_CONCURRENCY`,
     * plus a tab), and no worse than before this map existed, since those same bytes and parses
     * already coexisted uncharged. Coalescing strictly LOWERS that peak: two askers for one model
     * now hold one parse where they held two. Each resolving parse runs the ordinary eviction pass,
     * so the steady state the budget describes is unchanged.
     *
     * Self-clearing: an entry is deleted when its promise settles, EITHER WAY — a rejected parse
     * that stayed here would be a permanently sticky failure, where today a corrupt file is retried
     * on the next ask.
     */
    parsing: Map<string, InFlight<ParsedSlx | null>>;
    /**
     * The same thing one tier down: the cheap artifacts being derived right now, by uriString.
     *
     * The cheap tier has no budget, so this one is only about the read. It matters for the same
     * reason the parse map does — the two folder passes that overlap on folder open (the tree's
     * `ensureGraph` when the view becomes visible, and a restored tab's usage plan) are both
     * whole-folder passes, so without this every file in the folder is read twice rather than once.
     */
    reading: Map<string, InFlight<CheapEntry | null>>;
    /**
     * How many times a caller has told this cache that some file's bytes may have changed under a
     * version that did not (`forgetSource`).
     *
     * Never read for its value, only compared: a derivation captures it before its read and stores
     * what it derived only if it has not moved since. `nothingForgottenSince` holds the reasoning,
     * which is the half of a forget that deleting map entries cannot cover.
     */
    generation: number;
}
export declare function newSourceCache(parsedBudget?: number): SourceCache;
export declare function clearSourceCache(cache: SourceCache): void;
/**
 * Drop everything held for ONE file, because its bytes may have changed under a version that did
 * not move.
 *
 * The callers are disk WATCHERS, and that is the whole reason this exists: the event is evidence
 * of a change that `mtime:size` cannot carry. In the vscode host there are two. A read-only
 * tab's watcher (`BinaryEditorProvider`'s, through `sourceReads.forgetChangedSource`) forgets on
 * every event. The workspace watcher (workspaceChange.ts, through `forgetUnseenWrite` below)
 * forgets only when the file's version after the event is one this
 * cache already holds, so an ordinary save, which moves the version, costs no forget. Without it,
 * a file no read-only tab had open stayed stale in the tree, the name index and the Usage column.
 *
 * Such a write is not exotic. `tar -xp` and `unzip -o` restore a file with its recorded mtime, and
 * restoring the same revision preserves its size too; a network or virtualised mount with 1-2 s
 * mtime granularity cannot tell two equal-size writes inside one tick apart. Every tier then
 * believes what it already holds, and nothing later corrects it: the file is fresh on disk, the
 * editor visibly repaints, and the table still shows the old content for the life of the window.
 *
 * NOT to be called from anything that fires on a REPAINT. A host's tab drops its own node
 * cache on every repost (vscode's `BinaryEditorProvider.post` does); dropping the shared parse
 * there would re-read and re-parse a file that did not change, every time — the cost sharing the
 * parse exists to remove. Only the watcher knows the bytes may actually differ.
 *
 * All three tiers, because one write exposes all three: a model's rows come off `parsed`, the
 * tree's edges off `cheap`, and the Usage column off `models`. Dropping one of them would leave
 * the table fresh and the column stale — which is precisely the narrower version of this bug that
 * existed before the tab's rows came from `parsed` at all, and half a fix is harder to reason
 * about than either whole.
 *
 * The pin goes too: a pin is a claim about an entry, so keeping one for an entry that is gone
 * spends a slot of a fixed-size ring on nothing. The byte accounting needs no adjustment at all —
 * `parsedRetainedBytes` and `parsedBudgetedBytes` are sums over the map, so deleting the entry
 * uncharges it by construction.
 *
 * What dropping a `models` entry costs, stated rather than glossed: a usage plan's `summaryOf`
 * reads that map with no re-derive on a miss (see the note on `parsedBudget` for why the tier is
 * therefore unbounded), so a forget landing between `fillModelSummaries` and the merge leaves that
 * one model out of THAT build's Usage answer instead of costing a re-parse. Accepted, because the
 * window is one build wide, the next build re-derives it, and the alternative is keeping a summary
 * of bytes the file no longer has. A re-derive-on-miss in `summaryOf` would close it and is the
 * same change bounding that tier needs — logged there, not done here.
 *
 * The in-flight entries go as well, and that is the half a delete alone would miss: a derivation
 * that started before the write read the OLD bytes, so a caller arriving after this must not JOIN
 * it and be handed exactly the content the watcher fired about. Deleting the slot does not cancel
 * that derivation — nothing can, and its own caller is still waiting for an answer — it only stops
 * anyone else joining it. What stops it STORING what it read is `nothingForgottenSince`.
 */
export declare function forgetSource(cache: SourceCache, uriString: string): void;
/**
 * Every version this cache holds anything at for `uriString`: a finished artifact in any of the
 * three tiers, or a derivation in flight in either of the two in-flight maps.
 *
 * In flight counts, because a derivation that started before a write is the likeliest holder of
 * the old bytes. It read them before the write landed and will store them after it, under the
 * version it was started for.
 */
export declare function heldVersionsOf(cache: SourceCache, uriString: string): ReadonlySet<string>;
/**
 * `forgetSource`, but only when `version` is one `held` already names — the one change the
 * version key cannot see — and `true` when it forgot.
 *
 * Any other version is an ordinary save, and an ordinary save needs nothing from here: every tier
 * re-checks the version before it answers, so the next pass re-reads the file at its new version.
 * Forgetting it as well would bump the cache-wide `generation` and discard the stores of every
 * derivation in flight. Over a branch switch, that is every file. A `null` version (a file too
 * large to version, or one whose `stat` failed) forgets nothing either: nothing is ever stored
 * under `null`, and nothing held can match it.
 */
export declare function forgetIfVersionUnmoved(cache: SourceCache, uriString: string, held: ReadonlySet<string>, version: string | null): boolean;
/**
 * Forget what is held for `uriString` if a write a watcher reported left its version where it
 * was. `version` is the file's `stat`, taken after the event.
 *
 * What is held is read BEFORE the `stat`, in the same turn as the event, and the order matters. A
 * read-only tab showing the file has its own watcher, which forgets unconditionally and re-parses
 * (`forgetSource`, from the vscode host's `sourceReads.forgetChangedSource`). When that watcher's
 * event is handled first, it has already
 * dropped the old entries by the time this reads what is held, so nothing is held and nothing is
 * forgotten twice. A read taken after the `stat` would find the tab's new parse in flight at the
 * same version and forget that as well, which is the second re-read that forgetting on every event
 * costs. When the workspace's event is handled first, both forget, and the cost is one extra parse
 * of a file whose write the version key could not see.
 *
 * A second event for one write looks like this case too: the re-read the first event started is
 * held at the version the second one stats, so it is forgotten once more. Measured on macOS, the
 * workspace watcher reports an ordinary save once, so there an ordinary save still forgets nothing.
 * A write followed by a `utimes` (a restore) can arrive as two events.
 *
 * Nothing held means no `stat` at all: a file no consumer has read has nothing stale to forget.
 */
export declare function forgetUnseenWrite(cache: SourceCache, uriString: string, version: () => Promise<string | null>): Promise<boolean>;
/**
 * Every estimated byte `cache.parsed` holds, PINS INCLUDED — the true total.
 *
 * What the budget is compared against is `parsedBudgetedBytes`, and the two differ by exactly
 * the pins. Both are worth being able to ask for: a pinned byte is still a retained byte, it is
 * just not one this policy can decide about, so a diagnostic or a test wants this number and the
 * eviction loop wants the other one.
 */
export declare function parsedRetainedBytes(cache: SourceCache): number;
/**
 * What `cache.parsed` currently claims against its budget: the total above, minus the pins.
 *
 * A pin is off-budget as well as un-evictable, and the two go together. Charging an entry that
 * eviction cannot reach makes the budget a bound on a number the policy has no way to lower: the
 * moment the pins alone exceed it, every later insert finds itself over, evicts every non-pinned
 * entry it can reach, and is STILL over — so the map degenerates to {the pins, the newest} and
 * each folder pass re-parses the whole folder, which is the regression this cache exists to
 * remove. A cliff, not a gradient, and invisible: still correct, just slow. At the shipped
 * default that is one open model of ~6.5 MB of source, or two open tabs of ~3.3 MB each.
 *
 * It is also a double count. A pin is a model a TAB asked for, and that tab hands the same
 * `ParsedSlx` to a session (`addModelSourceParsed`), whose `ModelNode.fromParsed` keeps its
 * `rawContents`, `zipEntries`, `workspace`, `blockParamUsages` and `masks` BY REFERENCE for as long
 * as that source is registered — which is the whole of what a parse retains. So the bytes a pinned
 * entry claims here are bytes the process is holding whether this map keeps the entry or not:
 * measured, dropping it frees 0.5 MB of a 24 MB parse (2%) and buys a 675 ms re-parse.
 *
 * The trade stated plainly: the map may retain the budget PLUS up to `PINNED_PARSES` parses.
 * Bounded by construction, and those parses are the ones the host's session already owns.
 */
export declare function parsedBudgetedBytes(cache: SourceCache): number;
/**
 * Which kind `path` is, or `null` for one no reader here knows.
 *
 * Every branch is one of this package's kind tests, for the reason datamodel/fileKinds.ts
 * gives: the kind is a property of the FORMAT, the parsers dispatch on these same tests, and a host
 * keeping a second opinion is how `Params.SLDD` came to be discovered and then classified as
 * nothing.
 *
 * `null` rather than a default, which is the trap this replaces: a classifier that answered
 * "dictionary" for anything it did not recognise was safe only for as long as the caller's
 * glob happened to exclude projects, and a `.prj` reaching it would have been summarised as
 * a dictionary — a read of a marker file, an empty summary, and a project in the usage graph.
 *
 * `'prj'` is therefore a kind this classifier NAMES and the cache never stores an artifact for,
 * and those are two different statements. Answering `null` for a project instead would put it
 * back in the same bucket as `notes.txt` — an extension the glob offers that nothing here has
 * an opinion about — and the next kind added to the list would land in that bucket silently.
 * `cheapOf` drops it explicitly, before any read.
 *
 * test/fileKindLists.test.ts pins the extension LIST against the kind tests, but it never
 * imports this function, so it cannot see the third copy of the rule that this dispatch is. That
 * pin is test/sourceCache.test.ts, which derives its cases from SUPPORTED_EXTS and requires every
 * supported extension to name a kind here: a format added to the list without a branch here
 * fails there, rather than becoming a file the glob finds, the tree lists, and this pass
 * silently answers `null` for.
 */
export declare function sourceKind(path: string): SourceKind | null;
/**
 * ONE file's cheap artifact, from the cache when it already holds one at that version.
 *
 * The whole tier for one file, and `cheapAll` below is this function over a folder — not a
 * second spelling of it. Both callers therefore get the same version check, the same
 * `coalesced` join and the same `forgetSource` guard, which is the point of it being one
 * function: a per-file caller that wrote its own would be the vscode host's recurring bug class in
 * the tier that exists to remove it, and the ways to get it subtly wrong are all invisible
 * afterwards (see `coalesced` and `nothingForgottenSince`).
 *
 * `null` for a file this pass cannot produce an artifact for: one the reader will not version
 * (too large, unreachable), one whose bytes it will not hand over, a `.prj`, or an extension
 * nothing here reads. A corrupt file is NOT one of those — it gets an empty artifact, see
 * `dataCheapOf`.
 *
 * The entry a joining or hitting caller gets is the SAME object, not an equal one, which is what
 * lets a consumer hold an artifact and know it is holding the cache.
 */
export declare function cheapOne(cache: SourceCache, reader: SourceReader, file: SourceFile): Promise<CheapEntry | null>;
/**
 * The cheap artifact for every file in `files`, re-using what has not changed.
 *
 * One `version` per candidate, and `bytes` only on a miss — so a pass over a folder already
 * seen is a folder of `stat`s. Not even on every miss: a MODEL whose parse this cache already
 * holds at that version has its structure read off the parse, so the pass that answers a freshly
 * opened tab's Usage column does not read the file that tab has just parsed (see `cheapOf`).
 *
 * Files come back in `files` ORDER, which is load-bearing twice over and not merely tidy:
 * folder order decides which of two same-named dictionaries wins a basename collision, and
 * it is the order the blocks in a Usage cell are listed in. Unreadable and oversized files
 * are dropped, as every scan here drops them — the file is still a node, it just has nothing
 * to say.
 *
 * One read per file per content change holds ACROSS OVERLAPPING PASSES too, not only across
 * sequential ones: a miss goes through `coalesced`, so the second of two passes that reach the
 * same file at the same moment joins the first one's read instead of making its own. Which is the
 * case on folder open, where the tree's build and a restored tab's usage plan are independent
 * async flows over the same folder.
 */
export declare function cheapAll(cache: SourceCache, reader: SourceReader, files: readonly SourceFile[]): Promise<CheapMap>;
/**
 * One model's parse, from the cache when it already holds one for `version`.
 *
 * The single place a model's DISK bytes are parsed for a host using this cache, which is what makes
 * "once per content change" checkable: a `parsed` entry that is a NEW object is one `parseModel`,
 * and one that is the same object is none. Every consumer of a model's detail goes through here —
 * the tab that registers its rows, the usage tier that summarises it, the name index that scans it
 * for search — so the count is a property of this map and not of an agreement between callers.
 *
 * "Disk bytes" is the exact qualification, and the one exception is deliberate rather than missed:
 * a host's name search parses an open document's UNSAVED buffer itself (vscode's `nameScan`),
 * because search has to offer the name the user has just typed. Those bytes are not on disk, so no
 * `stat` versions them and nothing here could key them — the reason that override layers OVER this
 * cache instead of folding into it.
 *
 * `bytes` is a thunk and not an ArrayBuffer, because on a hit the bytes must not be read
 * either: a re-opened 13.8 MB model that nothing has touched should cost a `stat`.
 *
 * "However many consumers" includes SIMULTANEOUS ones, and that half is `coalesced`: the second
 * caller to ask for a version nobody has finished parsing joins the first caller's parse, so its
 * own `bytes` thunk is never called. Without it the two most expensive asks in a host are
 * the ones that double up — two restored tabs in two editor groups run two usage plans that both
 * scope the same model, and one model split across two panels asks twice at once — and the
 * duplication is invisible afterwards, because both callers store an equal entry at the same
 * version.
 *
 * `version` of `null` means the file cannot be keyed — the reader refuses to version it (over the
 * scan cap, or unreadable at `stat` time). Two separate things follow, and each needs its own
 * reason. It cannot be CACHED, because an entry keyed by nothing is an entry no later `stat` could
 * re-check, so it would never be refreshed and never evicted for being wrong. It is nevertheless
 * PARSED whenever a caller has bytes for it, because the cap is not a claim that the file is too
 * big to parse: `MAX_SCAN_BYTES` is V8's maximum string length, the point past which a TEXTUAL file
 * cannot be turned into a string at all (see scanVersion.ts), and a zipped `.slx` that size parses
 * perfectly well — the parser reads the archive without decoding it whole. A tab reads eagerly for
 * that reason: the user named this file and is waiting for it, and refusing here would answer them
 * with an empty table for a file that opens.
 *
 * Throws whatever `parseModel` throws. Its callers differ about that on purpose: a tab turns
 * it into the "Failed to parse" banner the user is waiting for, and a folder pass drops the
 * file (see below).
 *
 * This is the FOLDER-PASS way in. A tab asks through `parsedModelForOpenTab`, which is the same
 * call plus the pin — see there for why that difference exists and why it is a separate function
 * rather than a flag every caller has to get right.
 *
 * Every miss is a re-read and a re-parse and NOT an error: an evicted entry costs the caller
 * exactly what a first ask costs it, which is why bounding this map is a cost decision and
 * never a correctness one. That is a claim about every caller, so it is pinned by a test that
 * compares the answers a full cache and a thrashing one give (test/parsedBudget.test.ts).
 */
export declare function parsedModelOf(cache: SourceCache, file: SourceFile, version: string | null, bytes: () => Promise<ArrayBuffer | null>): Promise<ParsedSlx | null>;
/**
 * The same parse, asked for by a TAB: `parsedModelOf` plus the pin that keeps it evictable last.
 *
 * A separate function and not a `pin` flag on `parsedModelOf`, because a flag is a rule every
 * caller has to remember and there is exactly one caller that should
 * (a host's tab adapter; in the vscode host, `sourceReads.parsedModelForTab`). Naming the tab
 * path here also means the unit suites that hand-copy that adapter's inner sequence copy a CALL
 * rather than a decision — the pin cannot fall out of one of the copies and leave
 * them agreeing with each other about a host that thrashes.
 *
 * What the pin is for is on `PINNED_PARSES`: a tab's model is the one thing the size of an entry
 * cannot identify, and the folder pass that answers that same tab's Usage column runs straight
 * after it, leaving it least-recently-used and about to be wanted again.
 */
export declare function parsedModelForOpenTab(cache: SourceCache, file: SourceFile, version: string | null, bytes: () => Promise<ArrayBuffer | null>): Promise<ParsedSlx | null>;
/**
 * Summarise the models in `wanted` that are not already summarised at their current version.
 *
 * This is the expensive tier, and the whole reason the cheap one exists: a model outside
 * `wanted` is never parsed, and one inside it is parsed once per change rather than once per
 * consumer. `wanted` may name files of any kind; only models are summarised.
 *
 * Through `summarizeParsedModel` over the SHARED parse rather than `summarizeFiles` over the bytes,
 * which is the same code — `summarizeFiles` routes its own model branch through that export — with
 * the parse lifted out where it can be shared with the tab. So a model already parsed for its rows
 * is summarised here for free, and one summarised here is registered by the tab for free.
 *
 * The per-file `try` is not defensive: it is the guard that used to live INSIDE
 * `summarizeFiles`, and it has to be here now that the parse is. A folder holding one corrupt
 * model must not empty the Usage answers for every other file in it — which is what a throw
 * escaping this pass would do, since the graph build above it has one failure mode and it is
 * "no graph". The empty summary is cached like any other, so the corrupt file is not
 * re-parsed on every build; a changed version re-tries it, as for any file.
 */
export declare function fillModelSummaries(cache: SourceCache, reader: SourceReader, files: readonly SourceFile[], wanted: ReadonlySet<string>, cheap: CheapMap): Promise<void>;
//# sourceMappingURL=sourceCache.d.ts.map