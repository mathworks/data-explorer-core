/** A binary dictionary's package, read: its data part decoded, and every other member's bytes. */
export interface BinarySlddPackage {
    /** The dictionary's data part, decoded (vscode's `chunkOf`). */
    chunkXml: string;
    /** Every other member (vscode's `passThroughParts`). */
    parts: Record<string, Uint8Array>;
}
/**
 * Read a binary dictionary's bytes into the data part's text and the other members: what vscode's
 * binary editor holds of a file it opens, reverts or reloads (readDisk). A zip with no data part is
 * refused, as there: `Missing data/chunk0.xml in binary SLDD`. A file that is no zip throws fflate's
 * own error.
 */
export declare function readBinarySlddPackage(bytes: Uint8Array): BinarySlddPackage;
/**
 * The package's bytes for `chunkXml` around the pass-through `parts`, as vscode's binary editor
 * writes a save (`level` 6) or a hot-exit backup (`level` 1): the parts in their own order, the data
 * part last, zipped by fflate with the options given and its own defaults otherwise (each member
 * stamped with the time of the write).
 */
export declare function writeBinarySlddPackage(chunkXml: string, parts: Record<string, Uint8Array>, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9): Uint8Array;
//# sourceMappingURL=BinarySlddPackage.d.ts.map