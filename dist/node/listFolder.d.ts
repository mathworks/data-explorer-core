/** The most files `listFolder` returns unless told otherwise. */
export declare const FOLDER_FILE_LIMIT = 10000;
/**
 * True for a directory `listFolder` does not enter by default: a hidden one (`.git`, `.vscode`),
 * `node_modules`, and `slprj` — the folder Simulink writes its build artefacts and model
 * reference caches into, which holds generated copies of files a user did not author.
 */
export declare function skipDirectory(name: string): boolean;
export interface ListFolderOptions {
    /** The most files to return (a non-negative integer). Defaults to `FOLDER_FILE_LIMIT`. */
    limit?: number;
    /** Which directories, by name, the walk does not enter. Defaults to `skipDirectory`. */
    skipDirectory?: (name: string) => boolean;
}
export interface FolderListing {
    /**
     * The supported files under the root, as absolute paths joined with the platform's separator,
     * in the order described on `listFolder`.
     */
    files: string[];
    /**
     * True when the folder holds MORE supported files than `files` does: the walk stopped at the
     * limit with at least one left over. False means `files` is all of them.
     */
    truncated: boolean;
}
/**
 * Every supported file under `root`, in a stable order, up to a limit.
 *
 * ORDER: code-unit order of each file's path RELATIVE to `root`, with `/` between segments —
 * the same on every platform and every filesystem, whatever order a directory lists in. So
 * `a-b.slx` comes before `a/x.slx` (`-` sorts before `/`), and `Z.sldd` before `a.sldd`.
 *
 * THE LIMIT keeps the FIRST files in that order, so which files a capped listing holds is as
 * stable as the order: the walk visits each directory's entries sorted as their paths will sort
 * (a directory's name with its `/`, a file's name bare), which makes depth-first order the
 * listing's order, and it can stop at the limit without having to list the rest. `truncated`
 * says whether it did.
 *
 * WHAT COUNTS: a file whose NAME passes `isSupportedPath` — every extension on `SUPPORTED_EXTS`
 * and every name on `SUPPORTED_NAMES`, in any case. A link to a file counts as the file. A link
 * to a directory is NOT entered: following directory links is how a walk loops or leaves the
 * folder it was given. A hidden FILE counts; only directories are skipped (`skipDirectory`).
 *
 * Never throws for the folder's contents: a `root` that is missing or not a directory lists
 * nothing, and a directory or entry that cannot be read is passed over.
 */
export declare function listFolder(root: string, options?: ListFolderOptions): Promise<FolderListing>;
//# sourceMappingURL=listFolder.d.ts.map