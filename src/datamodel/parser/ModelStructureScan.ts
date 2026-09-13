// Copyright 2026 The MathWorks, Inc.
// A model's RELATIONSHIPS, without reading the model.
//
// Every other scanner in this package reads bytes the full parser would have turned into
// a tree (see SlddScan, MatScan). This one skips nothing of the sort: it hands
// `parseModelParts` the very same code path over a SMALLER SET OF PARTS. The three fields
// below therefore agree with `parseModel` by construction rather than by re-derivation,
// and every layout-era branch — and there are three eras — is inherited instead of
// re-implemented. That is the whole design.
//
// What it buys, from `npm run perf -- --only slx` (one run; these rows move a few percent
// between runs, so read the ratio and not the last digit): over a 127-model customer corpus,
// 1600 ms of `parseModel` becomes 75 ms — 21x — for an identical answer (76 dictionary links,
// 82 references, 13 external sources either way). On the one 13 MB model in it, 605 ms becomes
// 2.0 ms; the parts read there total 1.4 KB against 13.2 MB of `simulink/systems/*.xml` that
// none of these three fields is ever read from.
//
// Agreement is checked, not asserted: 127/127 models order-sensitively in
// `perf/oracle-run.mjs`, on both inflate engines, with one negative control per structural
// part; and every model fixture in the repo in `test/modelStructureScan.test.ts`.

import { unzipEntries } from './Inflate.js';
import { isZipPackage, parseModel } from './ModelParser.js';
import { parseModelParts } from './SlxParser.js';

/**
 * What a model points AT: the dictionary it is linked to, the models it references, and
 * the external data files it names.
 *
 * Deliberately NOT a `ParsedSlx`. Handing back the partial one would be a trap: on this
 * path `blockParamUsages`, `workspace`, `configSets` and `rawContents` are all empty or
 * short — not because the model has nothing in them, but because the parts carrying them
 * were never read. A caller reading one of those off this result would get a confidently
 * wrong answer, so the type does not offer them.
 */
export interface ModelStructure {
  /** The `.sldd` this model is linked to, or null. */
  dataDictionary: string | null;
  /** Referenced models, in document order — the order is meaningful, so it is preserved. */
  modelReferences: { blockPath: string; modelName: string }[];
  /** External data files, including a MAT-file model workspace source. */
  externalDataSources: string[];
}

/**
 * The only parts the three fields above can come from, across every layout era.
 *
 * Read off `parseModelParts` rather than guessed, and each one is load-bearing: dropping
 * any single entry from this set makes a negative control in `perf/oracle-run.mjs` go red
 * against a real corpus, and a case in `test/modelStructureScan.test.ts` go red without
 * one. `metadata/coreProperties.xml` is deliberately NOT here — it carries the release,
 * creator and modified date, which none of these three fields consults, and a member no
 * control can kill is a member this set should not name.
 *
 * Exact names, because `readPart` looks parts up by exact key too (`SlxParser.ts:143`):
 * a package spelling a part differently is invisible to the full parser as well, so
 * matching loosely here would withhold nothing and imply a robustness that is not real.
 */
const STRUCTURAL_PARTS = new Set([
  // The linked dictionary, the UUID and the model-workspace MAT source. R2026b+.
  'simulink/blockDiagram.json',
  // The same three facts as `<P Name="...">` children before that, AND the inline
  // `GraphicalInterface` before R2014b. Still written by R2020a+ packages, where it is
  // small because the blocks have moved to `systems/*.xml` — which is exactly why this
  // scan wins there and does NOT win on a pre-R2020a model, where this part is the
  // whole model and there is nothing to skip.
  'simulink/blockdiagram.xml',
  // Model references: JSON from R2024b, XML from R2014b.
  'simulink/graphicalInterface.json',
  'simulink/graphicalInterface.xml',
  // External data sources.
  'simulink/ExternalDataSourceSettings.xml',
]);

const isStructuralPart = (name: string): boolean => STRUCTURAL_PARTS.has(name);

/**
 * Read a model's `dataDictionary`, `modelReferences` and `externalDataSources` without
 * paying for the rest of the model.
 *
 * Equivalent to calling `parseModel` and keeping those three fields, and that equivalence
 * is checked over a whole corpus by `perf/oracle-run.mjs` rather than argued for here.
 *
 * Dispatches on the BYTES for the same reason `parseModel` does: a `.mdl` is the same
 * part set written as text, has no zip members to filter, and must still answer
 * correctly. It falls through to the full parse — no speedup on that format, and no
 * wrong answer either.
 *
 * Takes no `warnings` out-parameter, unlike `scanSldd`. It reads a SUBSET of the parts,
 * so its warning list would be a subset too, and a short list of losses reads as "nothing
 * is missing from this model". A caller that needs the diagnostics wants `parseModel`.
 *
 * One deliberate difference from `parseModel`, on damaged files only: a package whose
 * unread parts are corrupt is opened here and refused there, because bytes that are never
 * inflated cannot fail to inflate. The three fields are still whole or the read still
 * throws; there is no path on which this returns a quietly partial answer.
 */
export function scanModelStructure(buffer: ArrayBuffer, filename: string): ModelStructure {
  const bytes = new Uint8Array(buffer);
  const parsed = isZipPackage(bytes)
    ? parseModelParts(unzipEntries(bytes, isStructuralPart), filename)
    : parseModel(buffer, filename);
  return {
    dataDictionary: parsed.dataDictionary,
    modelReferences: parsed.modelReferences,
    externalDataSources: parsed.externalDataSources,
  };
}
