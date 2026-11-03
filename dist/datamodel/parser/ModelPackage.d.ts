/** Where a `.slx` keeps its model workspace from R2019b: MATLAB's getByteStreamFromArray of a struct of the variables. */
export declare const WORKSPACE_STREAM_PART = "simulink/modelWorkspace.mxarray";
/** Where a `.slx` kept it before R2019b: a whole MAT-file. */
export declare const WORKSPACE_MAT_PART = "simulink/modelworkspace.mat";
/**
 * MATLAB's getByteStreamFromArray(struct()): a workspace of no variables, which is what a model
 * that keeps its own workspace and holds no part for it has (measured on R2027a,
 * test/parity/matlab/probe_workspace_stream.m).
 */
export declare const EMPTY_WORKSPACE: Uint8Array;
/** The part a package names the type of each of its parts in. */
export declare const CONTENT_TYPES = "[Content_Types].xml";
/** The part a package names its own parts in, a model's workspace part among them. */
export declare const ROOT_RELS = "_rels/.rels";
/** What a model is to its package: its name, its format, and the parts it was read with. */
export interface ModelPackage {
    name: string;
    sourceFormat: string;
    _zipEntries: Record<string, Uint8Array> | null;
}
/**
 * Why no save of `model`'s package can be written, as a clause, or null where one can: it is no
 * `.slx` (a `.mdl` is text, which this package does not write), it was opened without its parts or
 * without the list of its members (a host's parse handed over without them), a member the list
 * names is not among its parts (one that could not be read, or named `__proto__`), or a part's
 * bytes were handed away since.
 */
export declare function packageRefusal(model: ModelPackage): string | null;
/** Whether `bytes` are a view of a buffer a host has handed away (transferred) since. */
export declare function handedAway(bytes: Uint8Array): boolean;
//# sourceMappingURL=ModelPackage.d.ts.map