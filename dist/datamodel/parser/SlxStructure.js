// src/datamodel/parser/SlxStructure.ts
// Copyright 2026 The MathWorks, Inc.
//
// A model's three relationships, SHAPED for a host that draws them as a graph between
// files: the reference names completed to file names, a reference with no name dropped,
// and a corrupt model answering with no relationships rather than throwing (the file is
// still a node).
//
// `ModelStructure` is the raw answer — what the model records, as it records it. A graph
// resolves edges by FILENAME, so it cannot use a bare reference name, and every host that
// built one completed the names itself. That completion is made twice per model on two
// paths that must not disagree: this package makes it for the node tree
// (`ModelNode.fromParsed` → `addReferenceEntry`), and a host makes it again for its graph.
// So the graph's half lives here too, beside the scan it shapes, and calls the same
// `refModelExt` and `isModelFile` the tree does.
//
// `scanModelStructure`, not `parseModel`, for the bytes route: three fields are wanted and
// the full parse walks every block to produce them (ModelStructureScan's header has what
// that costs over a corpus). Either way it is the bytes that decide which of the
// three on-disk forms a model is, not the name: `scanModelStructure` dispatches on the ZIP
// magic exactly as `parseModel` does, so a `.mdl` is never handed to a zip reader.
//
// Cheaper still than the cheapest scan is not reading the file, which is what the second
// entry point is for: `structureFromParsed` shapes the same three fields off a `ParsedSlx`
// a host already holds. For a non-zip model `scanModelStructure` IS a `parseModel` with
// those three projected off it, so a parse is a strict superset of a scan and there is no
// third derivation here — one SHAPING function serves both routes (see `shapeStructure`).
import { isModelFile, refModelExt } from '../fileKinds.js';
import { scanModelStructure } from './ModelStructureScan.js';
/**
 * The three relationship fields, normalized for a graph — the whole difference between a
 * `ModelStructure` and an `SlxStructure`.
 *
 * ONE shaping function for both entry points, because the normalization is the part that
 * must not drift: the two routes read the same three fields from the same producer, so a
 * completion or a filter applied on one side only would make a model's edges depend on
 * which route a host happened to reach it by first. test/slxStructure.test.ts compares the
 * two routes field for field over every model fixture, which is a pin on that and not
 * merely on either route.
 */
function shapeStructure(structure, filename) {
    // The extension to complete a bare reference name with — the PARENT's own: a .mdl
    // model's references are .mdl siblings, labelling them .slx resolves to nothing, and
    // `ModelSectionNode.addReferenceEntry` completes the same names for the TREE that this
    // completes for the GRAPH.
    const ext = refModelExt(filename);
    return {
        dataDictionary: structure.dataDictionary ?? null,
        // MATLAB stores model references by bare model name ("plant"); the file on disk is
        // "plant.slx" (or "plant.mdl"). Normalize so basename resolution in a graph matches.
        // A reference carrying no usable ModelName is DROPPED rather than named (a bare '.slx'
        // resolves to nothing) or allowed to throw: reading its name unguarded would fall into
        // the catch in `extractSlxStructure` and cost the file every other relationship it
        // does have.
        modelReferences: (structure.modelReferences ?? [])
            .map((r) => r.modelName)
            .filter((n) => typeof n === 'string' && n.length > 0)
            .map((n) => (isModelFile(n) ? n : n + ext)),
        externalDataSources: structure.externalDataSources ?? [],
    };
}
/**
 * A model's relationships, read from its bytes, or all three empty for bytes that are not
 * a model at all.
 *
 * Never throws: a host building a graph over a folder wants a damaged model to be a node
 * with no edges, not a scan that stops.
 */
export function extractSlxStructure(buffer, filename) {
    try {
        // A package whose UNREAD parts are corrupt opens here and would have been refused by
        // `parseModel` — bytes that are never inflated cannot fail to inflate. So a model with
        // damaged block XML keeps the relationships it does have instead of showing none.
        return shapeStructure(scanModelStructure(buffer, filename), filename);
    }
    catch {
        return { dataDictionary: null, modelReferences: [], externalDataSources: [] };
    }
}
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
export function structureFromParsed(parsed, filename) {
    return shapeStructure(parsed, filename);
}
//# sourceMappingURL=SlxStructure.js.map