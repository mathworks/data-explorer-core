import type MatNode from '../node/container/MatNode.js';
/**
 * The bytes of the MAT-file `matNode` is, as it stands now: what was edited written fresh,
 * everything else as the bytes it was read from. Throws MatWriteError, naming the variable or
 * the file and why, for anything it cannot write as what it is (see the file header), and
 * never hands back bytes that did not read back as planned.
 */
export declare function serializeMatFile(matNode: MatNode): Uint8Array;
//# sourceMappingURL=MatFileWriter.d.ts.map