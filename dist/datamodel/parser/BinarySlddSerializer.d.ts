import type SlddNode from '../node/container/SlddNode.js';
import type DataNode from '../node/DataNode.js';
export declare function serializeBinarySldd(slddNode: SlddNode): ArrayBuffer;
export declare function buildDataChunkXml(slddNode: SlddNode): string;
/**
 * The whole chunk written from the model: a fixed prolog, every entry regenerated in
 * section order, then the dictionary-level objects. Internal: the writers' whole-document
 * entry point, for the tests that exercise them and for the fidelity census
 * (scripts/save-fidelity.mjs).
 */
export declare function regenerateChunkXml(slddNode: SlddNode): string;
/** One entry's `<Object>` as a line: four spaces, the object, a newline. */
export declare function serializeEntryToXml(entryNode: DataNode): string;
/**
 * One entry's `<Object>` line written from the model. Internal: the writers' entry point,
 * for their tests and the fidelity census.
 */
export declare function regenerateEntryXml(entryNode: DataNode): string;
//# sourceMappingURL=BinarySlddSerializer.d.ts.map