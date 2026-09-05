// src/node/index.ts
// Copyright 2026 The MathWorks, Inc.
//
// Node-only entry: the ONLY part of the package that touches the filesystem.
// `path -> bytes`, then hand off to core's universal ingest(). Fenced out of the
// browser bundle by package.json `exports` conditions, so core proper stays fs-free.

import { readFileSync, statSync, readdirSync } from 'node:fs';
import { basename, join, extname } from 'node:path';
// Side-effect import: registers node classes so SectionNode.addEntry and
// NodeRegistry value-parsing work when consumers import ONLY from this subpath.
import '../datamodel/node/NodeClassMap.js';
import { createSession as _createSession } from '../core/DataModel.js';
import { ingest } from '../core/ingest.js';
import type { Session } from '../core/DataModel.js';
import type { ISourceNode } from '../core/NodeInterfaces.js';
import { reasonOf, type ParseWarning } from '../datamodel/parser/ParseWarning.js';

const SUPPORTED = new Set(['.sldd', '.slx', '.mdl', '.mat', '.prj']);

// Re-export createSession so Node consumers can import everything from one place.
export const createSession = _createSession;

export function loadFromPath(session: Session, path: string): ISourceNode {
  const buf = readFileSync(path);
  const stat = statSync(path);
  return ingest(session, buf, {
    filename: basename(path),
    meta: { path, size: stat.size, lastModified: stat.mtimeMs, fileHandle: null },
  });
}

/**
 * Every supported file in `dir` that opened, and — in `skipped`, when the caller brings
 * somewhere to put them — the ones that did not.
 *
 * One corrupt file in a folder must cost that file and nothing else, which is what the
 * try/catch is for. But a skip is not nothing: silence makes a folder look as though it
 * simply held fewer files. This used to say so with `console.error`, which is the one
 * channel a host cannot work around — it cannot be captured, routed to a UI, localized or
 * turned off, and a library has no business writing to a consumer's stderr. The two CLIs
 * in this repo now print it themselves, which is where the decision to write to a
 * terminal belongs.
 *
 * `ParseWarning` rather than a type of its own, though nothing here parsed: a skipped file
 * is exactly `source-unreadable` — "reading the source failed outright and was recovered
 * from" — and a host already knows how to render one. What it does NOT have is a node to
 * hang itself on, because the source never opened, and that is the whole reason this comes
 * back beside the sources instead of attached to one.
 *
 * Optional and trailing, so every existing caller keeps compiling and keeps its behaviour
 * minus the stderr write. Same shape as SlddNode.parse's sink.
 */
export function loadDirectory(session: Session, dir: string, skipped?: ParseWarning[]): ISourceNode[] {
  const names = readdirSync(dir).filter((n) => SUPPORTED.has(extname(n).toLowerCase())).sort();
  const out: ISourceNode[] = [];
  for (const name of names) {
    try {
      out.push(loadFromPath(session, join(dir, name)));
    } catch (err) {
      // The basename, not the joined path: it is what the caller listed, and what a
      // message about "this folder" should name.
      skipped?.push({
        code: 'source-unreadable',
        message: `${name} could not be opened and was skipped (${reasonOf(err)})`,
        part: name,
      });
    }
  }
  return out;
}
