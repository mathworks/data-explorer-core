// src/datamodel/parser/TomlProject.ts
// Copyright 2026 The MathWorks, Inc.
//
// The fourth project metadata format, and the only one that is not XML.
//
// R2026b's `matlab.project.DefinitionFiles.Toml` puts a project's whole definition
// into ONE hand-editable `matlab.toml` at the project root, and deletes both
// `resources/` and the `<name>.prj` marker with it. There is no content store to walk,
// no pointer/def document pairs, no entity UUIDs and no linked lists — so nothing in
// ProjectParser's machinery applies, and this is a separate reader rather than a fourth
// `Layout` in that file. What the two share is the RESULT: `ParsedProject`, so a page,
// a node tree and a host see one project shape whichever of the four it arrived as.
//
// WHAT THE FORMAT DOES NOT RECORD is the thing to keep in mind while reading this.
// MATLAB's own conversion into it warns `MATLAB:Project:Issues:LabelDataLoss`, and the
// parity corpus measures the rest: no member list, no label ownership, no label data
// type, no entity UUIDs, and the Simulink working folders survive as paths with nothing
// saying what they are for. So several fields here are empty or synthetic BY THE
// FORMAT rather than by omission, and each says so where it is built — a maintainer who
// read `files: []` as an oversight and "fixed" it by walking the project folder would
// be inventing a member list MATLAB does not have.
//
// Never throws, like every reader here, and for a sharper reason than the others: this
// is the one format a user EDITS. A number where a path belongs, a string where a table
// belongs, a key spelled the way last year's release spelled it — all of those are
// ordinary states of a real file, so every read goes through a helper that tolerates
// the wrong type, and what could not be read is said in `warnings` instead.
import { parse, TomlError } from 'smol-toml';
import { basenameOf, extOf, TOML_PROJECT_FILE } from '../fileKinds.js';
import { reasonOf } from './ParseWarning.js';
/** This reader's value for `ParsedProject.format`. See that field. */
const TOML_FORMAT = 'toml';
/**
 * The top-level keys that make a document a project definition at all.
 *
 * A file carrying none of them declares nothing, which is reported (see the
 * `source-empty` warning below) — and this is the list because it is every key this
 * reader reads. A document holding only keys NOT on it is a newer release's or a
 * hand-written future one, and that is still a project declaring settings, so it must
 * not be reported as empty; the test is "none of these", not "nothing we model".
 */
const DECLARING_KEYS = ['name', 'folders', 'dependencies', 'project', 'simulink'];
/**
 * Read a project whose entire definition is one `matlab.toml`.
 *
 * `text` is the file's content and `fallbackName` the project's name for a document
 * that records none — see `projectFallbackName`, which is where a caller gets one that
 * agrees with the rest of the package. Never throws: on a document that will not parse
 * it returns an empty project that says so in `warnings`, which is the only thing
 * separating that result from a project which genuinely holds nothing.
 */
export function parseTomlProject(text, fallbackName) {
    let doc;
    try {
        doc = parse(text);
    }
    catch (err) {
        return empty(fallbackName, [
            {
                code: 'source-unreadable',
                message: `${TOML_PROJECT_FILE} could not be read (${oneLineReason(err)}), ` +
                    'so this project reads as empty.',
                part: TOML_PROJECT_FILE,
            },
        ]);
    }
    if (!DECLARING_KEYS.some((key) => key in doc)) {
        return empty(fallbackName, [
            {
                code: 'source-empty',
                message: `${TOML_PROJECT_FILE} declares no project settings, so this project reads as empty.`,
                part: TOML_PROJECT_FILE,
            },
        ]);
    }
    const project = tableAt(doc, 'project');
    return {
        name: stringAt(doc, 'name') || fallbackName,
        format: TOML_FORMAT,
        // The format records no member list at all — MATLAB's own documentation of it says
        // "by default, all files in the project root folder are project files", which is a
        // rule about the FILESYSTEM and not a list in this document. So this reader cannot
        // answer which files belong, and `membersEnumerated: false` is how it says that
        // rather than reporting a project with zero members, which is a different claim.
        membersEnumerated: false,
        files: [],
        pathFolders: asStringArray(valueAt(tableAt(doc, 'folders'), 'path')),
        labels: readLabels(tableAt(project, 'labels')),
        references: readReferences(tableAt(doc, 'dependencies')),
        entryPoints: readEntryPoints(project),
        // The format has no equivalent of the XML store's EntryPointGroups: every shortcut
        // sits under one `[project.shortcuts]` table with nowhere to name a gallery group.
        entryPointGroups: [],
        workingFolders: readWorkingFolders(project, tableAt(doc, 'simulink')),
        warnings: [],
    };
}
/**
 * Why the parse failed, as ONE line.
 *
 * `reasonOf` alone is not enough here, and this is the only reader where that is true.
 * `ParseWarning.message` is documented as one host-renderable line, and smol-toml's
 * message is three or more: it appends a code excerpt with a caret under the offending
 * character, which is exactly right in a terminal and arrives in a tree row, a tooltip or
 * a notification as ASCII art with the diagnosis scrolled off. So the first line — the
 * diagnosis — is kept, the excerpt is dropped, and the position the caret was pointing at
 * is said in words instead, because a user editing this file by hand needs it.
 *
 * `reasonOf` still does the work for anything that is not a TomlError: a thrower this
 * reader did not anticipate must not become `[object Object]`.
 */
function oneLineReason(err) {
    const diagnosis = reasonOf(err).split('\n')[0].trim();
    if (err instanceof TomlError) {
        return `${diagnosis} at line ${err.line}, column ${err.column}`;
    }
    return diagnosis;
}
/**
 * The result for a document that could not be read, or that declares nothing.
 *
 * `format` is reported on both of those paths, where `ProjectParser`'s equivalent
 * (`emptyResult`) reports ''. The difference is real: a store that could not be walked
 * never said which layout it was in, whereas this format is KNOWN even when the content
 * is not — the caller dispatched on the file's NAME to get here. Blanking it would make a
 * page that titles the view with the format show no format at all, for the one reason
 * that has nothing to do with the format.
 */
function empty(name, warnings) {
    return {
        name,
        format: TOML_FORMAT,
        membersEnumerated: false,
        files: [],
        pathFolders: [],
        labels: [],
        references: [],
        entryPoints: [],
        entryPointGroups: [],
        workingFolders: [],
        warnings,
    };
}
// ---------------------------------------------------------------------------------
// Reading an edited document.
//
// Every access to `doc` goes through one of these four. They take `unknown` and answer
// with a usable value or with nothing, so the readers below contain no type tests and
// no `any` — which is what keeps "the user typed a number here" from being a throw in
// the middle of a walk, leaving a plausible-looking project missing arbitrary parts of
// itself.
/**
 * A TOML table, or null for anything else.
 *
 * The `Array.isArray` test is load-bearing, not a formality: an array of tables — which
 * is what `[[dependencies]]` writes — is an object too, and reading one AS a table
 * finds every key absent. That would report a document declaring something this reader
 * does not model as a document declaring nothing.
 */
function asTable(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value;
}
/** The raw value at `key` of a table, or undefined when there is no table or no key. */
function valueAt(table, key) {
    return table ? table[key] : undefined;
}
/** The table at `key`, or null. `null` in gives `null` out, so these chain. */
function tableAt(value, key) {
    return asTable(valueAt(asTable(value), key));
}
/** The string at `key`, or '' when it is absent, empty, or not a string. */
function stringAt(value, key) {
    const found = valueAt(asTable(value), key);
    return typeof found === 'string' ? found : '';
}
/**
 * A field that may be written as one string or as a list of them, as a list.
 *
 * MATLAB writes every one of these as a TOML array, and a user editing the file by hand
 * writes the single-entry case as a bare string about as often — `startup-files =
 * "startup.m"` is valid TOML and means exactly one thing, so refusing it would drop the
 * whole field rather than one entry of it. Non-string entries of a real array are
 * skipped and not coerced: a number where a path belongs is not a path, and
 * `String(42)` would put a member called `42` on a page.
 */
function asStringArray(value) {
    if (typeof value === 'string') {
        return [value];
    }
    if (Array.isArray(value)) {
        return value.filter((entry) => typeof entry === 'string');
    }
    return [];
}
/**
 * A file's basename with its last extension removed — the entry point's `name`.
 *
 * The three XML layouts record a `Name` attribute beside the `File` one and MATLAB
 * writes the stem into it, so `startup_one.m` is the entry point `startup_one` in all
 * four formats. This document has only the path, so the name is derived — and it is
 * derived to the same string, which is what lets the parity suite compare the two
 * parses field by field instead of per format.
 */
function stemOf(file) {
    const base = basenameOf(file);
    const ext = extOf(base);
    // A name that is ALL extension (`.m`, `.gitignore`) has no stem to take, and an
    // empty name is not something a gallery can show, so the basename stands in.
    return ext && ext.length < base.length ? base.slice(0, -ext.length) : base;
}
// ---------------------------------------------------------------------------------
// The collections.
/**
 * `[dependencies]` as project->project references.
 *
 * Only an entry whose value is a table carrying a string `path` is one, and everything
 * else is skipped SILENTLY — which is deliberate and is the one place in this file
 * where a warning would be wrong. `[dependencies]` is also where a MATLAB PACKAGE
 * dependency goes, with a version constraint rather than a path (`someToolbox =
 * "^1.2"`), so a bare string there is a valid entry of a kind this package does not
 * model, not a malformed reference. Warning on it would put a count on every project
 * that depends on a package — and a count that fires on healthy files is a count a
 * host learns to hide.
 */
function readReferences(dependencies) {
    const out = [];
    for (const [key, value] of Object.entries(dependencies ?? {})) {
        const path = stringAt(value, 'path');
        if (!path) {
            continue;
        }
        // The key is both `id` and `name`, where the XML layouts carry a UUID and a
        // basename. It is the only identity the format records, and it is the name MATLAB
        // shows — a dependency is referred to by its key, not by the folder it resolves to.
        out.push({ id: key, name: key, path });
    }
    return out;
}
/**
 * The startup files, the shutdown files, and the shortcuts — in that order.
 *
 * NO SORTING, which is the one thing worth stating positively here. `entryPoints` is
 * documented as already being in run order, and in the XML layouts that order exists
 * only as a linked list: each entry names its predecessor in a nested `<Extension
 * Name="StartUpPrev">`, spelled two different ways for the first entry, and
 * `orderEntryPoints` is the walk that recovers it. A TOML array IS ordered, so the
 * order is simply the order the keys were read in, and that whole mechanism has no
 * counterpart in this file.
 *
 * The ids are SYNTHETIC. The XML layouts carry MATLAB's own UUID for each entry point
 * and this format carries none, so these are built from the kind and the file (or the
 * shortcut's key) to be unique within one parse — and that is all they are. They are
 * not stable across a rename, and nothing may persist one as a handle on an entry
 * point: renaming `startup_one.m` changes its id, where in an XML store it would not.
 */
function readEntryPoints(project) {
    const out = [];
    for (const kind of ['StartUp', 'Shutdown']) {
        const key = kind === 'StartUp' ? 'startup-files' : 'shutdown-files';
        for (const file of asStringArray(valueAt(project, key))) {
            // An entry naming no file is skipped, which is the XML reader's own guard
            // (`if (!file && !name)`) reached by a different route: the name here is derived
            // from the file, so an empty path leaves nothing to show and nothing to open.
            if (!file) {
                continue;
            }
            out.push({
                id: `${kind}:${file}`,
                name: stemOf(file),
                file,
                kind,
                // Startup and shutdown files are not shortcuts: MATLAB runs them and does not
                // list them in the Shortcuts gallery, which is what `visible` answers.
                visible: false,
                groupId: '',
            });
        }
    }
    for (const [name, value] of Object.entries(asTable(valueAt(project, 'shortcuts')) ?? {})) {
        // A shortcut's path comes from a `{ path = "main.m" }` table and ALSO from a bare
        // `main = "main.m"`, where the same shape under `[dependencies]` is skipped. The
        // asymmetry is in the formats, not here: under `shortcuts` there is nothing else a
        // string beside a key could mean, and under `dependencies` there is (a version
        // constraint — see readReferences).
        const file = typeof value === 'string' ? value : stringAt(value, 'path');
        // Kept even with no path resolved, unlike a startup file with no path: the KEY is
        // the shortcut's name, so there is still a gallery entry the project declared, and
        // dropping it would make a shortcut written in a shape this reader does not know
        // disappear rather than read as a shortcut that needs its target fixed.
        out.push({ id: `Basic:${name}`, name, file, kind: 'Basic', visible: true, groupId: '' });
    }
    return out;
}
/**
 * The folders the project designates for a purpose, under the XML store's own keys.
 *
 * In EXACTLY this order, which is why they are written out one at a time rather than
 * looped: `parseProject` sorts its working folders by key, and these three keys sort
 * into precisely this sequence, so emitting them in it is what lets the parity suite
 * compare a TOML parse against an XML parse array-to-array with no sort on either side.
 * A fourth key added later belongs in its sorted position, not at the end.
 *
 * The keys are the STORE's spelling and not this file's: `ProjectWorkingFolder.key` is
 * documented as the raw purpose name, hosts match on it, and a format that spells the
 * cache folder `cache-folder` must not hand a host a second name for one purpose.
 */
function readWorkingFolders(project, simulink) {
    const out = [];
    const add = (key, ref) => {
        // Only when the source is a non-empty string. A purpose the project did not
        // designate has no entry at all, where an entry with an empty `ref` would read as
        // the project ROOT having been designated for it.
        if (ref) {
            out.push({ key, ref });
        }
    };
    add('ProjectStartupFolder', stringAt(project, 'startup-folder'));
    add('SimulinkCacheFolder', stringAt(simulink, 'cache-folder'));
    add('SimulinkCodeGenFolder', stringAt(simulink, 'codegen-folder'));
    return out;
}
/**
 * `[project.labels.<Category>]` as the label catalog, with the files each was declared
 * against.
 *
 * `readOnly: false` on every one of them is not a reading of an attribute. The format
 * records no ownership at all, and MATLAB's conversion into it drops the built-in
 * read-only `Classification` category entirely — the parity corpus measures that, along
 * with the `LabelDataLoss` warning MATLAB raises saying so. So every label a document
 * in this format can carry is one the project itself declared, which is exactly what
 * `readOnly: false` means to the page that draws a built-in label differently.
 *
 * In FILE ORDER, and not sorted as the XML reader sorts its catalog. The two orders are
 * not the same kind of thing: a store's order is its directory order, which means
 * nothing and differed between layouts, where this one is the order a person wrote the
 * categories down in.
 */
function readLabels(labels) {
    const out = [];
    for (const [category, value] of Object.entries(labels ?? {})) {
        const table = asTable(value);
        if (!table) {
            continue;
        }
        for (const [name, declared] of Object.entries(table)) {
            // `Category/Name` for an id, where the XML layouts carry a UUID: synthetic, like
            // the entry-point ids, and unique because TOML cannot write one category or one
            // label key twice.
            out.push({
                id: `${category}/${name}`,
                category,
                name,
                readOnly: false,
                declaredFiles: asStringArray(declared),
            });
        }
    }
    return out;
}
//# sourceMappingURL=TomlProject.js.map