// Copyright 2026 The MathWorks, Inc.
//
// The one way a test opens a real artifact: through `ingest`, the entry point a
// host actually calls, so format sniffing is exercised too. Every parity and
// fixture test imports from here rather than reaching for a parser directly.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSession } from '../../src/index.js';
import { ingest } from '../../src/core/ingest.js';
import '../../src/datamodel/node/NodeClassMap.js';

/** Read a file relative to THIS module and hand back a detached ArrayBuffer. */
export function bytesOf(rel: string): ArrayBuffer {
  const u8 = new Uint8Array(readFileSync(fileURLToPath(new URL(rel, import.meta.url))));
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

/**
 * Ingest an artifact and return its root node. `filename` must carry the real
 * extension — ingest dispatches on it (.sldd / .slx / .mat / .prj).
 */
export function loadFile(rel: string, filename?: string): any {
  const name = filename ?? (rel.split('/').pop() as string);
  return ingest(createSession(), bytesOf(rel), { filename: name }) as any;
}

/** Every node under `root`, breadth-first. */
export function flatten(root: any): any[] {
  const out: any[] = [];
  const stack = [root];
  while (stack.length) {
    const n = stack.shift();
    if (!n) { continue; }
    out.push(n);
    if (n.children) { stack.push(...n.children); }
  }
  return out;
}

/** The node for a named entry; throws with a useful message when absent. */
export function findEntry(root: any, name: string): any {
  const hit = flatten(root).find(
    (n) => n?.name === name && !String(n?.id ?? '').startsWith('section:'),
  );
  if (!hit) {
    throw new Error(
      'no entry "' + name + '"; have: ' +
      flatten(root).map((n) => n?.name).filter(Boolean).join(', '),
    );
  }
  return hit;
}
