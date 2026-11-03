import type ModelNode from '../node/container/ModelNode.js';
/**
 * The bytes of the `.slx` `model` is, as it stands now: its package as read, with its Model
 * Workspace's member as the workspace's save writes it, or no member where the workspace holds no
 * variable. Throws MatWriteError, naming the model and why, for a package no save of which can be
 * written (ModelPackage.packageRefusal), for a workspace whose save is refused (MatFileWriter's refusals, in
 * its words), and for a package that does not read back holding the workspace saved.
 */
export declare function serializeModelFile(model: ModelNode): Uint8Array;
//# sourceMappingURL=ModelFileWriter.d.ts.map