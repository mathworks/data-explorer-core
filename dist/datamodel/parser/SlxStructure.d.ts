import type { ParsedSlx } from './SlxParser.js';
/** A model's relationships, keyed by FILE name, for a graph between files. */
export interface SlxStructure {
    /** The linked data dictionary (basename or path, as the model records it), or null. */
    dataDictionary: string | null;
    /** Referenced models, extension included, in document order. */
    modelReferences: string[];
    /** External `.mat` / `.sldd` data source names. */
    externalDataSources: string[];
}
/**
 * A model's relationships, read from its bytes, or all three empty for bytes that are not
 * a model at all.
 *
 * Never throws: a host building a graph over a folder wants a damaged model to be a node
 * with no edges, not a scan that stops.
 */
export declare function extractSlxStructure(buffer: ArrayBuffer, filename: string): SlxStructure;
/**
 * The same structure, read off a model a host has ALREADY parsed — no bytes, no scan.
 *
 * A `ParsedSlx` carries `dataDictionary`, `modelReferences` and `externalDataSources` and
 * they are the same three fields, from the same code: for a non-zip model
 * `scanModelStructure` IS a `parseModel` with those three projected off it. So a host
 * holding a parse for the version it wants a structure for has already paid for this
 * answer, and reading the file again to scan it would be a read for 0.1 ms of work.
 *
 * No `try` of its own, and the asymmetry is the point rather than an omission. What the
 * other route's catch is about is the BYTES — a buffer that is not a package, an archive
 * that will not walk — and a caller holding a `ParsedSlx` is past every one of those: this
 * package produced it. The shaping itself reads three fields whose absence the `??`s and
 * the filter above already answer for, so there is nothing left here for a catch to
 * convert into an all-empty structure, and one that did would hide a broken invariant
 * rather than a damaged file.
 */
export declare function structureFromParsed(parsed: ParsedSlx, filename: string): SlxStructure;
//# sourceMappingURL=SlxStructure.d.ts.map