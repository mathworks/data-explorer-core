// src/datamodel/usage/UsageIndex.ts
// Copyright 2026 The MathWorks, Inc.
//
// Which blocks use which definitions, across a SET OF FILES rather than across a session.
//
// The session answers the same question already — findUsages / BaseNode._usedByCell — but
// only about sources a host registered, because that answer is read off node trees and a
// node tree is an expensive thing to hold. So a host with a whole folder of models on disk
// cannot use it: registering every file to find out which ones use a dictionary entry
// costs a full parse and a full tree per file, permanently. data-explorer-vscode built its
// own resolver over file SUMMARIES for exactly that reason, and that resolver is what this
// module is. It belongs here: which names a model can see is MATLAB's rule about parsed
// data, not a rule about editors.
//
// A summary is small — names, links, and the block parameters — so a workspace-sized set
// is affordable and needs no session, no node trees and no singleton.
//
// There are two implementations of visibility in this package — this one over file
// summaries, and the session's over registered node trees (DataModel.resolutionOrder, which
// findUsages applies) — and they now answer alike. They did not: the session credited every
// definition a model could REACH, chased no dictionary reference, and matched a recorded
// reference case-sensitively, so for the same two files it reported a usage this module
// did not (a shadowed dictionary entry) and missed ones it did (a sub-dictionary's entry, a
// model linking `Params.SLDD`). A host showing both — data-explorer-vscode fills the column
// from this index and falls back to the session for a model it cannot find on disk — showed
// whichever engine happened to answer, which is how the shadowed usage was found.
//
// The rule below is the one both express: model workspace, then the dictionary chain, then
// the MATs, first hit wins. Two implementations remain because the INPUTS genuinely differ
// (bytes on disk versus trees in a session, and neither can be had from the other), so the
// agreement is pinned by test rather than by construction — see test/usageEngines.test.ts,
// which asks both the same question about the same files.
//
// ==> OPEN, and not the same question: a model whose WORKSPACE is sourced from a `.mat`
// (`WSDataSource: 'MAT-File'`) resolves that file last here, with the other externals,
// because both parsers merge it into `externalDataSources` and the distinction is gone by
// the time a summary is built. MATLAB would resolve it FIRST — it is the model workspace.
// It only shows when such a model also links a dictionary defining the same name, and
// closing it needs the parsers to keep the workspace file apart from the rest.
import { blockKey, blockLabel, joinBlockPath } from '../blockIdentity.js';
import { identifiersIn } from '../expressions.js';
import { basenameOf, isMatFile, isModelFile, isSlddFile, modelNameOf, refBasename } from '../fileKinds.js';
import { normalizeRefNames, readSlddContent, slddChunkContent } from '../parser/SlddContent.js';
import { parseModel } from '../parser/ModelParser.js';
import { parseMat } from '../parser/MatParser.js';
import type { ParsedMat } from '../parser/MatParser.js';
import type { ParsedSlx } from '../parser/SlxParser.js';
import type { NodeUsage } from '../../core/DataModel.js';

/** Where a name a block parameter refers to was defined. */
export type OriginKind = 'workspace' | 'sldd' | 'mat';

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
  // `sid` and `systemPath` ride along with the name because the three answer different
  // questions: the name is what a cell reads, the SID is which block it is, and the path
  // is where it is. See blockIdentity.
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
  // Keyed by refBasename, because the keys are FILE NAMES and the lookups are references
  // authored inside a model. See fileKinds.refBasename for why that is not case-sensitive.
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
  linkTarget: string;
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

// --- Summarising -------------------------------------------------------------

function modelSummary(parsed: ParsedSlx, srcId: string, filename: string): ModelSummary {
  const externals = parsed.externalDataSources ?? [];
  return {
    srcId,
    // The bare model name, off the BASENAME: a caller hands over whatever path it has, and
    // a model is named `engine` in a block path and in every reference recorded to it —
    // never `/work/models/engine`. Stripping the extension without stripping the directory
    // makes a host label a usage cell with a path it then cannot match anything against.
    name: modelNameOf(basenameOf(filename)) ?? basenameOf(filename),
    workspaceNames: new Set((parsed.workspace ?? []).map((v) => v.name).filter(Boolean)),
    // The linked dictionary first, because that is the order MATLAB resolves in and
    // resolveName takes the first hit. The kind tests are the shared, case-insensitive ones
    // (fileKinds) because these strings are whatever the MODEL recorded: `EXTRADICT.SLDD` is
    // a real dictionary link, and a stricter test classifies it as neither dictionary nor
    // MAT and drops the link entirely.
    slddRefs: [
      ...(parsed.dataDictionary ? [refBasename(parsed.dataDictionary)] : []),
      ...externals.filter(isSlddFile).map(refBasename),
    ],
    matRefs: externals.filter(isMatFile).map(refBasename),
    blockParams: (parsed.blockParamUsages ?? []).map((u) => ({
      blockName: u.blockName,
      blockType: u.blockType,
      sid: u.sid ?? '',
      systemPath: u.systemPath ?? '',
      property: u.paramProperty,
      expression: u.paramValue,
    })),
  };
}

function slddSummary(srcId: string, json: Record<string, unknown>): DataSummary {
  const content = slddChunkContent(json);
  const names = new Set<string>();
  const slddRefs: string[] = [];
  if (content) {
    for (const entry of (content.entries as Record<string, unknown>[]) ?? []) {
      const name = entry?.name as string | undefined;
      if (name) {
        names.add(name);
      }
    }
    slddRefs.push(...normalizeRefNames(content['Dictionary References']).map(refBasename));
  }
  return { srcId, names, slddRefs };
}

function matSummary(srcId: string, parsed: ParsedMat): DataSummary {
  return {
    srcId,
    names: new Set(parsed.variables.map((v) => v.name).filter(Boolean)),
    slddRefs: [],
  };
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
export function summarizeFiles(files: UsageFile[]): FileSummaries {
  const models: ModelSummary[] = [];
  const slddByName = new Map<string, DataSummary>();
  const matByName = new Map<string, DataSummary>();
  for (const file of files) {
    try {
      if (isModelFile(file.filename)) {
        models.push(modelSummary(parseModel(file.bytes, file.filename), file.srcId, file.filename));
      } else if (isMatFile(file.filename)) {
        matByName.set(refBasename(file.filename), matSummary(file.srcId, parseMat(file.bytes)));
      } else if (isSlddFile(file.filename)) {
        matByName.delete(refBasename(file.filename)); // never both; last write wins per kind
        slddByName.set(refBasename(file.filename), slddSummary(file.srcId, readSlddContent(file.bytes)));
      }
    } catch {
      /* unreadable file contributes nothing */
    }
  }
  return { models, slddByName, matByName };
}

// --- Resolving ---------------------------------------------------------------

/**
 * Where the name `name` resolves for the model `model`, or null if it does not.
 *
 * MATLAB's order, and the FIRST hit wins: the model's own workspace, then the linked
 * dictionary and any dictionary it references transitively, then linked MAT-files. A
 * workspace variable SHADOWS a dictionary entry of the same name — the block reads one
 * value, so only one definition is used, and crediting both would put a usage on an entry
 * whose value never reaches the block.
 *
 * Dictionary references are chased breadth-first with a seen-set, because a dictionary
 * hierarchy is a graph a user can make cyclic and a cycle here would not terminate.
 */
export function resolveName(
  model: ModelSummary,
  name: string,
  slddByName: Map<string, DataSummary>,
  matByName: Map<string, DataSummary>,
): { kind: OriginKind; srcId: string } | null {
  if (model.workspaceNames.has(name)) {
    return { kind: 'workspace', srcId: model.srcId };
  }

  const seen = new Set<string>();
  const queue = [...model.slddRefs];
  while (queue.length > 0) {
    const ref = queue.shift()!;
    if (seen.has(ref)) {
      continue;
    }
    seen.add(ref);
    const sldd = slddByName.get(ref);
    if (!sldd) {
      continue;
    }
    if (sldd.names.has(name)) {
      return { kind: 'sldd', srcId: sldd.srcId };
    }
    queue.push(...sldd.slddRefs);
  }

  for (const ref of model.matRefs) {
    const mat = matByName.get(ref);
    if (mat?.names.has(name)) {
      return { kind: 'mat', srcId: mat.srcId };
    }
  }
  return null;
}

const reverseKey = (srcId: string, name: string): string => `${srcId}\n${name}`;
// Keyed by the block's KEY (its SID), which is what paramsOf is asked with. Keying this by
// name merged every same-named block in a model: in f14.slx one lookup of `Gain` answered
// with four different blocks' gains.
const forwardKey = (modelSrcId: string, blockKey: string): string => `${modelSrcId}\n${blockKey}`;

/**
 * Build the index over a set of files.
 *
 * Both directions come out of one pass over the block parameters, because they are one
 * traversal read two ways — a second pass could disagree with the first about what
 * resolved.
 */
export function buildUsageIndex(files: UsageFile[]): UsageIndex {
  const { models, slddByName, matByName } = summarizeFiles(files);
  const reverse = new Map<string, NodeUsage[]>();
  const forward = new Map<string, ParamOrigin[]>();

  for (const model of models) {
    for (const param of model.blockParams) {
      // Which block this is, and what it reads as — see blockIdentity. The target carries
      // the key, the cell shows the label, and for most blocks they are the same string.
      const key = blockKey(param.blockName, param.sid);
      const label = blockLabel(param.blockName, param.sid);
      const target = `${key}@${model.srcId}`;
      // Where the block is, for a cell that must otherwise print the same word twice for
      // two different blocks. Joined here rather than carried whole from the parser so
      // that the label a user reads and the path it sits at cannot disagree.
      const path = joinBlockPath(param.systemPath, label);
      // A Set: an expression can name the same definition twice (`Kp + Kp`), and that is ONE
      // place it is referenced, not two.
      const names = [...new Set(identifiersIn(param.expression))];
      let origin: { kind: OriginKind; srcId: string; name: string } | null = null;
      for (const name of names) {
        const resolved = resolveName(model, name, slddByName, matByName);
        if (!resolved) {
          continue;
        }
        // The first name that resolves is the parameter's origin for the FORWARD answer,
        // which is about the parameter as a whole and can only point at one place. The
        // reverse answer credits every name that resolved, because `Kp*Ki` really is a usage
        // of both.
        if (!origin) {
          origin = { ...resolved, name };
        }
        const index = reverseKey(resolved.srcId, name);
        const usages = reverse.get(index) ?? [];
        // One entry per BLOCK, and `target` identifies the block and its model together —
        // which is the old two-field test made exact. Two blocks named `Gain` using the
        // same variable are two usages of it, and used to collapse into one link that
        // could only reach whichever came first.
        if (!usages.some((u) => u.linkTarget === target)) {
          usages.push({
            blockName: label,
            blockPath: path,
            blockType: param.blockType,
            paramProperty: param.property,
            paramValue: param.expression,
            modelSrcId: model.srcId,
            // The forward grammar reversed, the same target findUsages produces, so a host
            // resolves a usage the same way whichever resolver answered it.
            linkTarget: target,
          });
        }
        reverse.set(index, usages);
      }

      const params = forward.get(forwardKey(model.srcId, key)) ?? [];
      params.push({
        property: param.property,
        expression: param.expression,
        name: origin?.name ?? null,
        originSrcId: origin?.srcId ?? null,
        kind: origin?.kind ?? null,
        // `name@srcId`, this package's one link grammar — never a display string, and never
        // a channel prefix. A host that routes `workspace:` or `blocks:` targets prefixes
        // this itself, which is what it already does with the targets nodes produce.
        linkTarget: origin ? `${origin.name}@${origin.srcId}` : '',
      });
      forward.set(forwardKey(model.srcId, key), params);
    }
  }

  return {
    models,
    usagesOf: (srcId, name) => reverse.get(reverseKey(srcId, name)) ?? [],
    paramsOf: (modelSrcId, key) => forward.get(forwardKey(modelSrcId, key)) ?? [],
  };
}
