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
// ==> DIVERGENCE, to be closed. This is currently the SECOND implementation of visibility
// in this package, and the two do not agree. `modelCanSee` (DataModel.ts), which findUsages
// applies, differs from `resolveName` below in three ways:
//
//   - SHADOWING. modelCanSee credits every visible definition of a name, so a block reading
//     `Kp` collects a usage against the model workspace's `Kp` AND the linked dictionary's.
//     MATLAB resolves one: the workspace shadows the dictionary, which shadows the MAT. Only
//     the winner is a real usage; the others are claims about code that does not run.
//   - CHAINING. resolveDictionaryReferences is documented as one level, not a chain, so a
//     definition in a SUB-dictionary of the linked dictionary is invisible to findUsages.
//     MATLAB sees it, and so does this module.
//   - CASE. openSourceNamed matches a reference exactly, so a model that links
//     `Params.SLDD` resolves nothing against `params.sldd` — the bug this module's
//     refBasename keying exists to avoid.
//
// Both must end up calling one rule; this file is the one that has it right, and it is the
// direction to move in. Until then, the two are named at both sites rather than left to be
// found by whoever next sees the column disagree with itself.
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
  blockParams: { blockName: string; blockType: string; property: string; expression: string }[];
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
  /** Every parameter of the block `blockName` in the model `modelSrcId`, with its origin. */
  paramsOf(modelSrcId: string, blockName: string): ParamOrigin[];
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
const forwardKey = (modelSrcId: string, blockName: string): string => `${modelSrcId}\n${blockName}`;

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
        const key = reverseKey(resolved.srcId, name);
        const usages = reverse.get(key) ?? [];
        if (!usages.some((u) => u.blockName === param.blockName && u.modelSrcId === model.srcId)) {
          usages.push({
            blockName: param.blockName,
            blockType: param.blockType,
            paramProperty: param.property,
            paramValue: param.expression,
            modelSrcId: model.srcId,
            // The forward grammar reversed, the same target findUsages produces, so a host
            // resolves a usage the same way whichever resolver answered it.
            linkTarget: `${param.blockName}@${model.srcId}`,
          });
        }
        reverse.set(key, usages);
      }

      const params = forward.get(forwardKey(model.srcId, param.blockName)) ?? [];
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
      forward.set(forwardKey(model.srcId, param.blockName), params);
    }
  }

  return {
    models,
    usagesOf: (srcId, name) => reverse.get(reverseKey(srcId, name)) ?? [],
    paramsOf: (modelSrcId, blockName) => forward.get(forwardKey(modelSrcId, blockName)) ?? [],
  };
}
