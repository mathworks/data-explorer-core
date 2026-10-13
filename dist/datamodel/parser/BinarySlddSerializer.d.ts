import type SlddNode from '../node/container/SlddNode.js';
import type DataNode from '../node/DataNode.js';
export declare function serializeBinarySldd(slddNode: SlddNode): ArrayBuffer;
/**
 * The whole `data/chunk0.xml` of a dictionary: in the frame it was read in when there is
 * one, with every unedited entry as the bytes it was read from; otherwise generated, as
 * `regenerateChunkXml` does, still keeping an unedited entry's bytes where it has them.
 */
export declare function buildDataChunkXml(slddNode: SlddNode): string;
/**
 * The whole chunk written from the model: a fixed prolog, every entry regenerated in
 * section order, then the dictionary-level objects. Internal, and not what a save writes;
 * it is the writers' whole-document entry point, for the tests that exercise them and for
 * the fidelity census (scripts/save-fidelity.mjs).
 */
export declare function regenerateChunkXml(slddNode: SlddNode): string;
/**
 * One entry's `<Object>` as a line: four spaces, the object, a newline. An unedited entry
 * whose bytes the reader verified is those bytes; any other is regenerated.
 */
export declare function serializeEntryToXml(entryNode: DataNode): string;
/**
 * One entry's `<Object>` line written from the model, whatever bytes it was read from.
 * Internal: the writers' entry point, for their tests and the fidelity census.
 */
export declare function regenerateEntryXml(entryNode: DataNode): string;
//# sourceMappingURL=BinarySlddSerializer.d.ts.map