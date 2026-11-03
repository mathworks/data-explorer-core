import type ModelNode from '../node/container/ModelNode.js';
/**
 * The bytes of the `.slx` `model` is, as it stands now: its package as read, with its Model
 * Workspace's member as the workspace's save writes it, or no member where the workspace holds no
 * variable, and the active configuration set marked where another was made active. Throws
 * MatWriteError, naming the model and why, for a package no save of which can be written
 * (ModelPackage.packageRefusal), for a workspace whose save is refused (MatFileWriter's refusals, in
 * its words), for a mark that cannot be moved (ActiveConfigMark), and for a package that does not
 * read back holding the workspace saved and the set made active.
 */
export declare function serializeModelFile(model: ModelNode): Uint8Array;
//# sourceMappingURL=ModelFileWriter.d.ts.map