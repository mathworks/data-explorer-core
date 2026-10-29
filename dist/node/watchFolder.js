// src/node/watchFolder.ts
// Copyright 2026 The MathWorks, Inc.
//
// Following a folder's changes, over `node:fs` — the other half of `listFolder`, for a host that
// shows a folder and has to know when to read it again.
//
// What a host does with a change is its own (re-read one file, rebuild a tree, re-answer a Usage
// column); what a change IS is decided here, once, with the same rules the listing uses, so that
// a host is told about exactly the files it would list: a supported file's name
// (`isSupportedPath`), outside the folders `listFolder` does not enter (`skipDirectory`). Two
// more rules are the watcher's own, and both are about how file systems report writes:
//
//   - one save is several events (a temp file, a rename over the original, an attribute
//     change), and a branch switch is thousands. So events are collected into a BURST, ended by
//     a quiet spell (`debounceMs`, 300 ms by default — the delay the vscode extension waits
//     before re-answering Usage after a write), and a host hears once per burst.
//   - an event can say less than which file changed: some platforms send none, and a folder
//     created, deleted or renamed takes every file in it along without an event per file. Such a
//     burst is reported as `onChange()` with no paths — anything may have changed — rather than
//     as the few file events that happened to arrive.
import { statSync, watch } from 'node:fs';
import { resolve } from 'node:path';
import { extOf, isSupportedPath } from '../datamodel/fileKinds.js';
import { skipDirectory } from './listFolder.js';
/** How long a burst of events must be quiet before it is reported, unless told otherwise. */
export const WATCH_DEBOUNCE_MS = 300;
/**
 * Watch the folder at `root`, recursively, and call `onChange` once per burst of changes.
 *
 * `onChange(paths)` names the supported files the burst touched — created, written, deleted or
 * renamed — as absolute paths with `/` between segments, once each, in code-unit order. Files
 * `listFolder` would not list are left out, and a burst touching only those is not reported.
 *
 * `onChange()`, with NO argument, means anything under `root` may have changed: the burst held an
 * event with no file name, or a directory was created, removed or renamed (a removed name with no
 * extension is taken for a directory, since nothing is left to ask). A host re-lists the folder.
 * The same is sent once if the watcher stops on an error.
 *
 * Never throws: a folder that cannot be watched gives a handle with `watching: false`.
 */
export function watchFolder(root, onChange, options = {}) {
    const debounceMs = options.debounceMs ?? WATCH_DEBOUNCE_MS;
    if (!Number.isFinite(debounceMs) || debounceMs < 0) {
        throw new RangeError(`watchFolder: debounceMs must be a non-negative number, got ${debounceMs}`);
    }
    const skip = options.skipDirectory ?? skipDirectory;
    const base = resolve(root).replace(/\\/g, '/').replace(/\/+$/, '');
    let watcher;
    let error;
    let disposed = false;
    let timer;
    const touched = new Set();
    let anything = false;
    const flush = () => {
        timer = undefined;
        if (disposed)
            return;
        const paths = anything ? undefined : [...touched].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        touched.clear();
        anything = false;
        onChange(paths);
    };
    const schedule = () => {
        if (timer !== undefined)
            clearTimeout(timer);
        timer = setTimeout(flush, debounceMs);
    };
    const onEvent = (eventType, name) => {
        if (disposed)
            return;
        const relative = name ? name.replace(/\\/g, '/') : '';
        if (!relative) {
            anything = true;
            return schedule();
        }
        const segments = relative.split('/').filter((s) => s.length > 0);
        // Inside a folder the listing does not enter: nothing a host lists can have changed.
        if (segments.slice(0, -1).some((segment) => skip(segment)))
            return;
        const last = segments[segments.length - 1] ?? '';
        const path = `${base}/${segments.join('/')}`;
        let isDirectory;
        try {
            isDirectory = statSync(path).isDirectory();
        }
        catch {
            isDirectory = undefined; // gone — deleted, or renamed away
        }
        if (isDirectory === true) {
            // A folder appearing (created, or renamed into place) brings its files with it. A `change`
            // on a folder is its own metadata; the files in it report themselves.
            if (skip(last) || eventType !== 'rename')
                return;
            anything = true;
        }
        else if (isSupportedPath(last)) {
            touched.add(path);
        }
        else if (isDirectory === undefined && extOf(last) === '' && !skip(last)) {
            // Gone, and named like a folder: what it held went with it.
            anything = true;
        }
        else {
            return;
        }
        schedule();
    };
    try {
        // Asked first, because `fs.watch` would follow a FILE given as the root and say nothing of it.
        if (!statSync(root).isDirectory())
            throw new Error(`watchFolder: ${root} is not a directory`);
        watcher = watch(root, { recursive: true }, onEvent);
        watcher.on('error', (err) => {
            // An `error` event with no listener would throw out of the host's event loop.
            if (disposed)
                return;
            error = err;
            watcher?.close();
            watcher = undefined;
            anything = true;
            schedule();
        });
    }
    catch (err) {
        error = err instanceof Error ? err : new Error(String(err));
    }
    return {
        get watching() {
            return watcher !== undefined && !disposed;
        },
        get error() {
            return error;
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            if (timer !== undefined)
                clearTimeout(timer);
            timer = undefined;
            watcher?.close();
            watcher = undefined;
        },
    };
}
//# sourceMappingURL=watchFolder.js.map