import { type EntrySelector } from './entrySelector.js';
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
 * whose bytes the reader verified is those bytes; an edited one is those bytes with what was
 * edited written from the model, laid out as the chunk it was read from is; any other is
 * regenerated.
 */
export declare function serializeEntryToXml(entryNode: DataNode): string;
/**
 * One entry's `<Object>` line written from the model, whatever bytes it was read from.
 * Internal: the writers' entry point, for their tests and the fidelity census, and the text
 * (C, and B for the bytes as read) an edited entry is merged from (mergedEntry).
 */
export declare function regenerateEntryXml(entryNode: DataNode): string;
/**
 * Where the text written for one entry, `writtenObject` (its `<Object>…</Object>`, as a host holds
 * it in the chunk it is about to save), changes what nobody edited, by path: empty when it keeps
 * every part of the bytes the entry was read from that the model has not changed. An entry nobody
 * edited must be exactly those bytes. An edited one may differ from them only where the model
 * differs from what the bytes read as, and in its Name and LastMod lines (EntryMerge.keptPartsOf):
 * read with a structure-aware scan of the text, never with the reader, which can lose what the
 * writer loses. Empty for an entry with no bytes it was read from, which nothing holds it to, and
 * for one whose bytes the scan cannot read (a processing instruction inside it, say): empty then
 * means unchecked, not kept, and a save gate has to check that case for itself.
 * A binary save gate refuses a save this finds anything in (the maintainer's D12 addendum).
 */
export declare function keptPartsViolations(entryNode: DataNode, writtenObject: string): string[];
/**
 * `chunkXml` with one entry's `<Object>…</Object>` replaced by what a save writes for it now
 * (entryObjectXml: its bytes, merged with the edit, or regenerated), laid out as the chunk is, and
 * every byte around it as it was; null when the chunk holds no such entry. The entry is found by
 * `selectorBefore`, the name (and, where two share it, the UUID) it has in the chunk, which a
 * rename has changed in the model; the entry's own by default. Found by the structure-aware scan
 * a save reads spans with (BinarySlddParser.entrySpans), or, in a chunk that scan cannot vouch
 * for, by findEntryObjectSpan. For a host that keeps a chunk as text and splices each edit into
 * it: the whitespace before and after the object is the chunk's, so no edit moves it.
 */
export declare function spliceEntryObject(chunkXml: string, entryNode: DataNode, selectorBefore?: string | EntrySelector): string | null;
//# sourceMappingURL=BinarySlddSerializer.d.ts.map