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
    modelReferences: {
        blockPath: string;
        modelName: string;
    }[];
    /** External data files, including a MAT-file model workspace source. */
    externalDataSources: string[];
}
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
export declare function scanModelStructure(buffer: ArrayBuffer, filename: string): ModelStructure;
//# sourceMappingURL=ModelStructureScan.d.ts.map