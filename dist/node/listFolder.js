// src/node/listFolder.ts
// Copyright 2026 The MathWorks, Inc.
//
// Which files in a folder Data Explorer shows, over `node:fs` — the listing a host hands the
// shared source cache and a folder hierarchy before either reads a byte.
//
// Every host that shows a folder makes this list, and every choice in it is one a host makes
// alone unless something makes it for them: which files count (this package's `isSupportedPath`,
// and nothing else — see datamodel/fileKinds.ts), which folders are not worth entering, how many
// files are too many, and what ORDER they come in. The order is the one that matters most and
// shows least: folder order decides which of two same-named dictionaries wins a name in a usage
// answer, and the order of blocks in a Usage cell, so two hosts listing one folder differently
// answer the same question differently. The vscode extension lists through `workspace.findFiles`
// and the user's `files.exclude`; this is the walk for a host that has `node:fs` instead.
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isSupportedPath } from '../datamodel/fileKinds.js';
/** The most files `listFolder` returns unless told otherwise. */
export const FOLDER_FILE_LIMIT = 10_000;
/**
 * True for a directory `listFolder` does not enter by default: a hidden one (`.git`, `.vscode`),
 * `node_modules`, and `slprj` — the folder Simulink writes its build artefacts and model
 * reference caches into, which holds generated copies of files a user did not author.
 */
export function skipDirectory(name) {
    return name.startsWith('.') || name === 'node_modules' || name === 'slprj';
}
/** Code-unit order (JavaScript's `<`): the same on every machine, unlike `localeCompare`. */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
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
export async function listFolder(root, options = {}) {
    const limit = options.limit ?? FOLDER_FILE_LIMIT;
    if (!Number.isInteger(limit) || limit < 0) {
        throw new RangeError(`listFolder: limit must be a non-negative integer, got ${limit}`);
    }
    const skip = options.skipDirectory ?? skipDirectory;
    const files = [];
    let truncated = false;
    // False once the limit is passed, so every level of the walk stops where it is.
    const walk = async (dir) => {
        let dirents;
        try {
            dirents = await readdir(dir, { withFileTypes: true });
        }
        catch {
            return true; // unreadable, or not a directory at all
        }
        const entries = [];
        for (const dirent of dirents) {
            const { name } = dirent;
            const full = join(dir, name);
            if (dirent.isDirectory()) {
                if (!skip(name))
                    entries.push({ key: `${name}/`, full, directory: true });
            }
            else if (isSupportedPath(name)) {
                if (dirent.isFile()) {
                    entries.push({ key: name, full, directory: false });
                }
                else if (dirent.isSymbolicLink() && (await isFileBehind(full))) {
                    // A link is looked behind only when its NAME is a supported file's, so a folder of
                    // links costs no `stat` for the ones that could not count anyway. A link to a
                    // directory is never entered (see above), whatever it is called.
                    entries.push({ key: name, full, directory: false });
                }
            }
        }
        entries.sort((a, b) => byCodeUnit(a.key, b.key));
        for (const entry of entries) {
            if (entry.directory) {
                if (!(await walk(entry.full)))
                    return false;
            }
            else if (files.length === limit) {
                truncated = true;
                return false;
            }
            else {
                files.push(entry.full);
            }
        }
        return true;
    };
    await walk(root);
    return { files, truncated };
}
/** True if `path` is, after following any links, a file. False for a dangling link. */
async function isFileBehind(path) {
    try {
        return (await stat(path)).isFile();
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=listFolder.js.map