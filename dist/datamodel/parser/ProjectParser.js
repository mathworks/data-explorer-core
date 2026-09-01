// Copyright 2026 The MathWorks, Inc.
import { XMLParser } from 'fast-xml-parser';
const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
});
const PROJECT_PREFIX = 'resources/project/';
function toArray(v) {
    if (v === undefined || v === null) {
        return [];
    }
    return Array.isArray(v) ? v : [v];
}
/**
 * Parse a MATLAB/Simulink Project content store.
 *
 * `files` maps POSIX relpaths (relative to the project root) to file text.
 * Only entries under `resources/project/` are read. Never throws: on any
 * failure it returns a minimally-populated result with the fallback name.
 */
export function parseProject(files, projectName) {
    const result = {
        name: projectName,
        files: [],
        pathFolders: [],
        labels: [],
        references: [],
    };
    try {
        // Index every parseable Info doc by its relpath (project-relative).
        const index = new Map();
        for (const [relPath, content] of Object.entries(files)) {
            if (!relPath.startsWith(PROJECT_PREFIX)) {
                continue;
            }
            if (!relPath.endsWith('.xml')) {
                continue;
            }
            const info = parseInfo(content);
            if (info) {
                // Store keyed relative to resources/project/ for simpler dir math.
                index.set(relPath.slice(PROJECT_PREFIX.length), info);
            }
        }
        if (index.size === 0) {
            return result;
        }
        // The `root/` directory holds the top-level entry pointers.
        const rootEntities = readDir(index, 'root');
        // Project name: the def whose pointer has location="ProjectData" type="Info".
        for (const ent of rootEntities) {
            if (ent.pointer?.['@_location'] === 'ProjectData' && ent.pointer?.['@_type'] === 'Info') {
                const name = ent.def?.['@_Name'];
                if (name) {
                    result.name = name;
                }
            }
        }
        // Some stores also carry the name on a bare def <Info Name="MyProj"/> whose
        // pointer has no matching location; take it if we still have the fallback.
        if (result.name === projectName) {
            for (const ent of rootEntities) {
                const name = ent.def?.['@_Name'];
                if (name && !ent.pointer?.['@_type']) {
                    result.name = name;
                    break;
                }
            }
        }
        for (const ent of rootEntities) {
            const type = ent.pointer?.['@_type'];
            if (type === 'Files') {
                result.files = readFiles(index, ent.hash);
            }
            else if (type === 'ProjectPath') {
                result.pathFolders = readPathFolders(index, ent.hash);
            }
            else if (type === 'Categories') {
                result.labels = readCategories(index, ent.hash);
            }
            else if (type === 'Reference') {
                // A genuine project->project reference living directly in root.
                const ref = resolveReference(ent);
                if (ref) {
                    result.references.push(ref);
                }
            }
        }
        // References may also live in their own top-level collection outside the
        // ProjectPath collection. Scan any root entry whose dir contains
        // type="Reference" children (but skip the ProjectPath collection itself).
        for (const ent of rootEntities) {
            if (ent.pointer?.['@_type'] === 'ProjectPath') {
                continue;
            }
            const children = readDir(index, ent.hash);
            for (const child of children) {
                if (child.pointer?.['@_type'] === 'Reference') {
                    const ref = resolveReference(child);
                    if (ref) {
                        result.references.push(ref);
                    }
                }
            }
        }
        result.files.sort((a, b) => a.path.localeCompare(b.path));
        result.pathFolders.sort((a, b) => a.localeCompare(b));
        return result;
    }
    catch {
        return {
            name: projectName,
            files: [],
            pathFolders: [],
            labels: [],
            references: [],
        };
    }
}
function parseInfo(content) {
    try {
        const doc = xmlParser.parse(content);
        const info = doc?.Info;
        if (info === undefined || info === null) {
            return null;
        }
        // An empty element parses to '' — normalize to an empty object.
        if (typeof info !== 'object') {
            return {};
        }
        return info;
    }
    catch {
        return null;
    }
}
/**
 * Read all pointer/def entities in a directory (relative to resources/project/).
 * Groups files by hash/stem, treating `p`/`_sp` as pointers and `d`/`_sd` as defs.
 */
function readDir(index, dir) {
    if (!dir) {
        return [];
    }
    const prefix = dir + '/';
    const byHash = new Map();
    for (const [relPath, info] of index.entries()) {
        if (!relPath.startsWith(prefix)) {
            continue;
        }
        const rest = relPath.slice(prefix.length);
        // Only immediate children (no further nesting).
        if (rest.includes('/')) {
            continue;
        }
        const parsed = parseChildName(rest);
        if (!parsed) {
            continue;
        }
        const { hash, isPointer } = parsed;
        let ent = byHash.get(hash);
        if (!ent) {
            ent = { hash, pointer: null, def: null };
            byHash.set(hash, ent);
        }
        if (isPointer) {
            ent.pointer = info;
        }
        else {
            ent.def = info;
        }
    }
    return [...byHash.values()];
}
/**
 * Given a child filename like `8AEH..._sp.xml` or `qaw0...p.xml`, return the
 * hash (stem before the suffix) and whether it is a pointer. Null when the stem
 * carries none of the four recognized suffixes — a file in the store that is not
 * half of a pointer/def pair, which readDir skips.
 *
 * PRECONDITION: `name` ends in `.xml`. parseProject's index only admits `.xml`
 * paths, and readDir only asks about entries of that index, so re-checking here
 * would be a branch no input can take.
 */
function parseChildName(name) {
    const stem = name.slice(0, -'.xml'.length);
    if (stem.endsWith('_sp')) {
        return { hash: stem.slice(0, -'_sp'.length), isPointer: true };
    }
    if (stem.endsWith('_sd')) {
        return { hash: stem.slice(0, -'_sd'.length), isPointer: false };
    }
    if (stem.endsWith('p')) {
        return { hash: stem.slice(0, -1), isPointer: true };
    }
    if (stem.endsWith('d')) {
        return { hash: stem.slice(0, -1), isPointer: false };
    }
    return null;
}
/**
 * Read the Files collection. Members are File entities; each File entity's own
 * dir holds its children as pointer/def pairs: a DIR_SIGNIFIER marks a folder,
 * and any nested type="File" children are themselves project files (recurse).
 */
function readFiles(index, filesHash) {
    const out = [];
    const seen = new Set();
    const members = readDir(index, filesHash);
    for (const member of members) {
        collectFile(index, member, out, seen);
    }
    return out;
}
function collectFile(index, entity, out, seen) {
    if (entity.pointer?.['@_type'] !== 'File') {
        return;
    }
    const path = entity.pointer['@_location'];
    if (!path) {
        return;
    }
    // Guard against cycles / repeated hashes.
    if (seen.has(entity.hash)) {
        return;
    }
    seen.add(entity.hash);
    const children = readDir(index, entity.hash);
    let isFolder = false;
    const labels = [];
    const fileChildren = [];
    for (const child of children) {
        const ctype = child.pointer?.['@_type'];
        if (ctype === 'DIR_SIGNIFIER') {
            isFolder = true;
        }
        else if (ctype === 'File') {
            fileChildren.push(child);
        }
    }
    // Labels for this file live on the File entity's own def.
    if (entity.def) {
        collectLabels(entity.def, labels);
    }
    out.push({ path, isFolder, labels: dedupe(labels) });
    // Recurse into nested File children (folder contents).
    for (const child of fileChildren) {
        collectFile(index, child, out, seen);
    }
}
/** Collect all Label UUIDs from an Info def's nested <Category><Label/> nodes. */
function collectLabels(def, into) {
    for (const category of toArray(def.Category)) {
        for (const label of toArray(category.Label)) {
            const uuid = label['@_UUID'];
            if (uuid) {
                into.push(uuid);
            }
        }
    }
}
function dedupe(arr) {
    return [...new Set(arr)];
}
/**
 * Read the ProjectPath collection. Each entry is a type="Reference" pointer
 * whose def carries `Ref="<folder>"`; that Ref is the path folder name.
 */
function readPathFolders(index, hash) {
    const out = [];
    const entries = readDir(index, hash);
    for (const ent of entries) {
        if (ent.pointer?.['@_type'] !== 'Reference') {
            continue;
        }
        const ref = ent.def?.['@_Ref'];
        if (ref) {
            out.push(ref);
        }
    }
    return out;
}
/**
 * Read the Categories collection into a flat label catalog. Each Category dir
 * holds type="Label" entries; the label display name is the def's Name.
 */
function readCategories(index, hash) {
    const out = [];
    const categories = readDir(index, hash);
    for (const cat of categories) {
        if (cat.pointer?.['@_type'] !== 'Category') {
            continue;
        }
        // Category display name: def Name, else the pointer location (the id).
        const categoryName = cat.def?.['@_Name'] || cat.pointer?.['@_location'] || '';
        const labelEntries = readDir(index, cat.hash);
        for (const labelEnt of labelEntries) {
            if (labelEnt.pointer?.['@_type'] !== 'Label') {
                continue;
            }
            const id = labelEnt.pointer?.['@_location'] || '';
            const name = labelEnt.def?.['@_Name'] || id || '';
            if (name) {
                out.push({ id, category: categoryName, name });
            }
        }
    }
    return out;
}
/**
 * Resolve a genuine project->project reference. Name is the basename of the
 * Ref path when present, else the UUID location.
 */
function resolveReference(ent) {
    const ref = ent.def?.['@_Ref'];
    const location = ent.pointer?.['@_location'] || '';
    const id = location || ref || '';
    if (!id) {
        return null;
    }
    let name = null;
    if (ref) {
        const parts = ref.split(/[/\\]/).filter((p) => p.length > 0);
        name = parts.length > 0 ? parts[parts.length - 1] : ref;
    }
    return { id, name };
}
//# sourceMappingURL=ProjectParser.js.map