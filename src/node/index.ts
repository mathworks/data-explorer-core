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

export function loadDirectory(session: Session, dir: string): ISourceNode[] {
  const names = readdirSync(dir).filter((n) => SUPPORTED.has(extname(n).toLowerCase())).sort();
  const out: ISourceNode[] = [];
  for (const name of names) {
    try {
      out.push(loadFromPath(session, join(dir, name)));
    } catch (err) {
      // Skip unreadable/unparseable files but keep going; surface to stderr for CLI visibility.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`loadDirectory: skipped ${name}: ${msg}`);
    }
  }
  return out;
}
