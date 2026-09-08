/** Lower-cased extension INCLUDING the dot, or '' for a name with none. */
export declare function extOf(filename: string): string;
/** Last path segment, splitting on both separators so a Windows path needs no cleanup. */
export declare function basenameOf(text: string): string;
/**
 * Basename lower-cased — the key to match file names by.
 *
 * References are matched on this rather than on the name as written, because a model
 * records a linked file the way its author typed it: `Params.sldd` inside a model
 * legitimately names `params.sldd` on disk, and the file systems these live on
 * (macOS, Windows) agree with that reading. Matching exactly makes the SAME reference
 * resolve in one reader and silently not in another.
 */
export declare function refBasename(text: string): string;
/**
 * A model file name with its extension removed, or null when the name is not a model
 * file at all.
 *
 * `.slx` and `.mdl` are the one pair this package treats as two spellings of the same
 * thing (parseModel reads whichever the bytes are), and the reason this exists is that
 * a model reference is recorded with the PARENT's extension: ModelNode.addReferenceEntry
 * guesses, because a `.mdl` names its child without an extension, so the same child is
 * 'mdl_child.mdl' seen from a `.mdl` and 'mdl_child.slx' seen from a `.slx`. Resolving
 * that guess strictly would make the link dead for exactly the mixed hierarchy the
 * guess exists to serve, so the stem is what gets compared.
 *
 * It is also the model NAME as MATLAB uses it internally: a block path and a reference
 * record both name the model `engine`, never `engine.slx`.
 */
export declare function modelNameOf(name: string): string | null;
/** True if `filename` names a Simulink model, in either container. */
export declare function isModelFile(filename: string): boolean;
/** True if `filename` names a data dictionary. */
export declare function isSlddFile(filename: string): boolean;
/** True if `filename` names a MAT-file. */
export declare function isMatFile(filename: string): boolean;
/** True if `filename` names a MATLAB project. */
export declare function isProjectFile(filename: string): boolean;
//# sourceMappingURL=fileKinds.d.ts.map