import type { MaskScope } from '../maskScope.js';
import type { ParsedSlx } from '../parser/SlxParser.js';
import type { NodeUsage } from '../../core/DataModel.js';
/**
 * Where a name a block parameter refers to was defined.
 *
 * `'mask'` is the odd one out and the only one that is not a FILE: the definition is a
 * mask parameter of an enclosing masked subsystem, in the same model as the block using
 * it. See maskScope.
 */
export type OriginKind = 'mask' | 'workspace' | 'sldd' | 'mat';
/**
 * One file to index, already read.
 *
 * `srcId` is the host's key for the file and is treated as opaque — a bare name, a path or
 * a URI. It is what every answer carries back, and what `linkTarget` is built from, so it
 * is the host's own identifier that comes out, never one this package invented.
 *
 * `filename` decides how the bytes are parsed. Never the caller's say-so, and never
 * `srcId`: a URI may carry a query or fragment that a kind test would trip over.
 */
export interface UsageFile {
    srcId: string;
    filename: string;
    bytes: ArrayBuffer;
}
/** What the index needs from a model: what it defines, what it links, and what it reads. */
export interface ModelSummary {
    srcId: string;
    /** The model NAME, as a block path and a reference record spell it — `engine`. */
    name: string;
    /** Names defined in the model's own workspace, which is private to it. */
    workspaceNames: Set<string>;
    /** refBasename'd, in resolution order: the linked dictionary first, then externals. */
    slddRefs: string[];
    /** refBasename'd names of linked MAT-files. */
    matRefs: string[];
    /**
     * The model's mask workspaces — a scope INSIDE the model, ahead of everything above.
     * Unlike the three ref lists this needs no lookup elsewhere: a mask is defined in the
     * same file as the blocks that see it.
     */
    masks: MaskScope[];
    blockParams: {
        blockName: string;
        blockType: string;
        sid: string;
        systemPath: string;
        property: string;
        expression: string;
    }[];
}
/** What the index needs from a dictionary or a MAT-file: what it defines, and what it inherits. */
export interface DataSummary {
    srcId: string;
    names: Set<string>;
    /** refBasename'd dictionary references — empty for a MAT-file, which inherits nothing. */
    slddRefs: string[];
}
export interface FileSummaries {
    models: ModelSummary[];
    slddByName: Map<string, DataSummary>;
    matByName: Map<string, DataSummary>;
}
/**
 * A block parameter and where the name in it resolved — the forward direction.
 *
 * `expression` is the parameter's value as written (`2*Kp`), and `name` is the identifier
 * within it that actually resolved. They differ, and a caller that shows one while linking
 * the other is showing a name the file does not contain.
 *
 * Unresolved is a first-class answer: `name`, `originSrcId` and `kind` are all null, and
 * `linkTarget` is '' — the parameter is real and refers to something this file set does not
 * hold, which is what a model linked to a dictionary nobody opened looks like.
 */
export interface ParamOrigin {
    property: string;
    expression: string;
    name: string | null;
    originSrcId: string | null;
    kind: OriginKind | null;
    /**
     * `name@srcId` — except for `kind === 'mask'`, where the definition is a BLOCK and the
     * target is `blockKey@srcId`, the same grammar `usagesOf` answers with. A host routes
     * the two to different channels (`workspace:` versus `blocks:`) and so has to read
     * `kind` to know which it is holding.
     */
    linkTarget: string;
    /**
     * The masked subsystem whose mask workspace defined `name`, and null for every other
     * kind — the only origin that is a place in the MODEL rather than a file, so the only
     * one `originSrcId` alone cannot locate. See maskScope.
     */
    maskBlock: MaskScope | null;
}
/**
 * Usage answers over a fixed set of files.
 *
 * Immutable by construction: a file set is summarised once and the maps are built from it.
 * A host whose files changed builds another one, which is the whole invalidation story —
 * there is no cache here to get stale, and no mutation for an event to have to reach.
 */
export interface UsageIndex {
    /**
     * Every block parameter that refers to the definition `name` in the source `srcId` — the
     * reverse direction, and what a `UsedBy` cell is built from.
     *
     * Shaped as `NodeUsage`, the same as findUsages answers with, so that a host reads one
     * shape whichever resolver produced it, and so that the two can be joined when they are.
     */
    usagesOf(srcId: string, name: string): NodeUsage[];
    /**
     * Every parameter of ONE block of the model `modelSrcId`, with its origin.
     *
     * `blockKey` is the block's SID (blockIdentity.blockKey), not its name, and not the text
     * a cell shows — a model may hold four blocks named `Gain`, each with its own gain, and
     * a name would answer with all four blocks' parameters for every one of them. A host
     * has it from the block row's `_blockKey`, which ModelBlockNode.toRow publishes for
     * exactly this call.
     */
    paramsOf(modelSrcId: string, blockKey: string): ParamOrigin[];
    /** The models this index summarised, in the order they were given. */
    readonly models: readonly ModelSummary[];
}
/**
 * Parse each file into the summary its kind calls for, dispatching on the FILENAME through
 * the shared kind tests.
 *
 * A file that cannot be parsed contributes nothing rather than aborting the run: one corrupt
 * dictionary in a folder must not empty the usage answers for every other file in it. That
 * is the same policy the session applies per source, and the reason readSlddContent leaves
 * refusal to its caller.
 */
export declare function summarizeFiles(files: UsageFile[]): FileSummaries;
/**
 * The model branch of `summarizeFiles`, over a structure the caller has ALREADY parsed.
 *
 * A host that shows a model's rows ran `parseModel` on those bytes to build them, and
 * `summarizeFiles` runs it again on the same bytes to summarise the same model — a second
 * full parse per model open, spent to learn nothing the caller was not holding. This takes
 * the parse instead of the bytes; nothing else about the summary changes.
 *
 * The answer is a whole `FileSummaries` holding just this one model rather than a bare
 * `ModelSummary`, so it is exactly what `summarizeFiles([{ srcId, filename, bytes }])`
 * returns for a model and `mergeFileSummaries` folds it in beside the dictionaries and
 * MAT-files summarised the ordinary way. usageIndex.test.ts pins that equality per fixture,
 * because two ways to summarise a model is the shape a drift takes.
 *
 * `filename` is still required and is still not `srcId`: the model NAME comes off the
 * basename (see `modelSummary`), and that is the name a block path and every reference
 * record spell.
 *
 * No per-file `try` here, unlike `summarizeFiles`: there is no file to be unreadable. A
 * caller with a parse in hand has already been told whether the bytes were readable, and
 * swallowing a throw would hand back an empty answer for a model that HAD been parsed.
 */
export declare function summarizeParsedModel(parsed: ParsedSlx, srcId: string, filename: string): FileSummaries;
/**
 * Where the name `name` resolves for a block of `model` sitting at `systemPath`, or null
 * if it does not.
 *
 * MATLAB's order, and the FIRST hit wins: the mask workspaces of the masked subsystems
 * this block is inside (innermost out), then the model's own workspace, then the linked
 * dictionary and any dictionary it references transitively, then linked MAT-files. Each
 * scope SHADOWS the ones after it — the block reads one value, so only one definition is
 * used, and crediting both would put a usage on a definition whose value never reaches
 * the block.
 *
 * `systemPath` is where the resolution is being done FROM, and it defaults to the root
 * for a caller that has no block in mind. It is only the mask scope that needs it — the
 * other three are properties of the model as a whole — but that is exactly the fact this
 * signature had to learn: which names a block can see depends on where the block is, not
 * only on which model it is in.
 *
 * Dictionary references are chased breadth-first with a seen-set, because a dictionary
 * hierarchy is a graph a user can make cyclic and a cycle here would not terminate.
 */
export declare function resolveName(model: ModelSummary, name: string, slddByName: Map<string, DataSummary>, matByName: Map<string, DataSummary>, systemPath?: string): {
    kind: OriginKind;
    srcId: string;
    maskBlock?: MaskScope;
} | null;
/**
 * Fold per-file summaries into one, as though `summarizeFiles` had been given the files
 * together — so a caller that summarised a folder one file at a time gets the same answers
 * as one that summarised it in a single call.
 *
 * The order of `parts` is the order of the files. It matters: `slddByName` and `matByName`
 * are keyed by `refBasename`, so two dictionaries of that basename in different folders
 * collide and the LAST one assigned wins, and `resolveName` looks that key up. Folding in a
 * different order — or letting an earlier part keep the key — would answer differently for
 * the same folder, which is why this is here and not left to each caller's loop.
 *
 * A caller keeping summaries per file is why this exists: the parse is what a usage index
 * costs, and it is the only part worth keeping. Rebuilding the maps from kept summaries is
 * a pass over already-parsed block parameters.
 */
export declare function mergeFileSummaries(parts: readonly FileSummaries[]): FileSummaries;
/**
 * Build the index over a set of files.
 *
 * Both directions come out of one pass over the block parameters, because they are one
 * traversal read two ways — a second pass could disagree with the first about what
 * resolved.
 */
export declare function buildUsageIndex(files: UsageFile[]): UsageIndex;
/**
 * The second half of `buildUsageIndex`, over summaries a caller already holds.
 *
 * Reachable on its own so that a host can parse each file ONCE across many index builds:
 * it keeps the summaries, and rebuilds the maps from them when its file set or its query
 * scope changes. What it must NOT do is build the maps itself — the mask rule and the
 * resolution order below are this package's, and a host's own copy of a resolution rule is
 * how a `UsedBy` cell came to invent a usage for any entry named `mode`.
 */
export declare function buildUsageIndexFromSummaries(summaries: FileSummaries): UsageIndex;
//# sourceMappingURL=UsageIndex.d.ts.map