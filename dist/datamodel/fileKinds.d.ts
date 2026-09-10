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
/**
 * The extension to complete a bare model-reference name with, given the name of the
 * model that RECORDS the reference.
 *
 * A model file names its references without an extension, so the bare name has to be
 * completed before it can be used as a link target or matched against a file on disk.
 * It takes the PARENT's own extension: a reference is far likelier to be the same
 * generation of file as the model referencing it — a legacy `.mdl` hierarchy is legacy
 * throughout — and a `.mdl` model whose children were all labelled `.slx` would link to
 * nothing.
 *
 * This is published for the same reason `isModelFile` is. The guess is made TWICE for
 * every model opened, on two paths that must not disagree: this package completes it for
 * the node tree (`ModelNode.fromParsed` → `addReferenceEntry`), and a host completes it
 * again for whatever index it builds over `parseModel`'s raw `modelReferences` — a usage
 * graph resolves edges by filename, so it cannot use the bare name either. When the two
 * copies drift, the tree row and the graph edge name two different files for one
 * reference, and the row you can see stops agreeing with the link that resolves.
 */
export declare function refModelExt(parentFilename: string): string;
/** True if `filename` names a data dictionary. */
export declare function isSlddFile(filename: string): boolean;
/** True if `filename` names a MAT-file. */
export declare function isMatFile(filename: string): boolean;
/** True if `filename` names a MATLAB project. */
export declare function isProjectFile(filename: string): boolean;
/**
 * A project file name with its `.prj` removed — the project's NAME, as distinct from the
 * file it is stored in.
 *
 * `parseProject` takes this rather than a filename, because it is what a project calls
 * itself: the name appears in a `.prj`'s own metadata and is the fallback when that
 * metadata is missing or unreadable. So every caller of `parseProject` has to make this
 * reduction first, and — like `refModelExt` — it is made on two paths that must not
 * disagree: this package makes it when adding a project source to a session, and a host
 * makes it again for whatever index it builds directly over `parseProject`. The name is
 * user-visible on both (a tree row and a graph group label), so a drift between the two
 * shows up as one project appearing under two names.
 *
 * Total rather than nullable, unlike `modelNameOf`: that one returns null to mean "not a
 * model, do not compare stems", whereas the answer wanted here is always a label. A name
 * with no `.prj` to strip is returned unchanged.
 */
export declare function projectNameOf(filename: string): string;
//# sourceMappingURL=fileKinds.d.ts.map