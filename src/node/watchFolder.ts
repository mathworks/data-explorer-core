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
import { statSync, watch, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import { extOf, isSupportedPath } from '../datamodel/fileKinds.js';
import { skipDirectory } from './listFolder.js';

/** How long a burst of events must be quiet before it is reported, unless told otherwise. */
export const WATCH_DEBOUNCE_MS = 300;

export interface WatchFolderOptions {
  /** Milliseconds of quiet that end a burst. Defaults to `WATCH_DEBOUNCE_MS`. */
  debounceMs?: number;
  /**
   * Which directories, by name, are not followed. Defaults to `skipDirectory`, the same rule
   * `listFolder` uses — pass the same function to both if you change it.
   */
  skipDirectory?: (name: string) => boolean;
}

export interface FolderWatch {
  /**
   * True while the folder is being followed. False when watching it could not start (a root
   * that is missing or not a directory, a platform without recursive `fs.watch` — Linux before
   * Node 20) or stopped on an error; `error` says why. A host that is not watching still has the
   * folder; it just has to read it again some other way to see a change.
   */
  readonly watching: boolean;
  /** Why `watching` is false, if it is for a reason other than `dispose`. */
  readonly error: Error | undefined;
  /** Stop: the pending burst is dropped, the watcher closed, and `onChange` never called again. */
  dispose(): void;
}

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
export function watchFolder(
  root: string,
  onChange: (paths?: string[]) => void,
  options: WatchFolderOptions = {},
): FolderWatch {
  const debounceMs = options.debounceMs ?? WATCH_DEBOUNCE_MS;
  if (!Number.isFinite(debounceMs) || debounceMs < 0) {
    throw new RangeError(`watchFolder: debounceMs must be a non-negative number, got ${debounceMs}`);
  }
  const skip = options.skipDirectory ?? skipDirectory;
  // What a reported path starts with: the root, absolute, with `/` between segments, and one `/`
  // after it. `resolve` drops trailing separators from every path but a filesystem root (`/`,
  // `C:\`), which keeps its one — so that is the only case already ending in `/`.
  const resolved = resolve(root).replace(/\\/g, '/');
  const prefix = resolved.endsWith('/') ? resolved : `${resolved}/`;

  let watcher: FSWatcher | undefined;
  let error: Error | undefined;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const touched = new Set<string>();
  let anything = false;

  const flush = (): void => {
    timer = undefined;
    if (disposed) return;
    const paths = anything ? undefined : [...touched].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    touched.clear();
    anything = false;
    onChange(paths);
  };
  const schedule = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  const onEvent = (eventType: string, name: string | null): void => {
    if (disposed) return;
    const relative = name ? name.replace(/\\/g, '/') : '';
    if (!relative) {
      anything = true;
      return schedule();
    }
    const segments = relative.split('/').filter((s) => s.length > 0);
    // Inside a folder the listing does not enter: nothing a host lists can have changed.
    if (segments.slice(0, -1).some((segment) => skip(segment))) return;
    const last = segments[segments.length - 1] ?? '';
    const path = `${prefix}${segments.join('/')}`;
    let isDirectory: boolean | undefined;
    try {
      isDirectory = statSync(path).isDirectory();
    } catch {
      isDirectory = undefined; // gone — deleted, or renamed away
    }
    if (isDirectory === true) {
      // A folder appearing (created, or renamed into place) brings its files with it. A `change`
      // on a folder is its own metadata; the files in it report themselves.
      if (skip(last) || eventType !== 'rename') return;
      anything = true;
    } else if (isSupportedPath(last)) {
      touched.add(path);
    } else if (isDirectory === undefined && extOf(last) === '' && !skip(last)) {
      // Gone, and named like a folder: what it held went with it.
      anything = true;
    } else {
      return;
    }
    schedule();
  };

  try {
    // Asked first, because `fs.watch` would follow a FILE given as the root and say nothing of it.
    if (!statSync(root).isDirectory()) throw new Error(`watchFolder: ${root} is not a directory`);
    watcher = watch(root, { recursive: true }, onEvent);
    watcher.on('error', (err: Error) => {
      // An `error` event with no listener would throw out of the host's event loop.
      if (disposed) return;
      error = err;
      watcher?.close();
      watcher = undefined;
      anything = true;
      schedule();
    });
  } catch (err) {
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
      if (disposed) return;
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      watcher?.close();
      watcher = undefined;
    },
  };
}
