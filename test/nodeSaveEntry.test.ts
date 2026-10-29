// Copyright 2026 The MathWorks, Inc.
//
// The `data-explorer-core/node/save` entry (src/node/save.ts), held to what it exists for: a save
// over the user's file in a process that loads none of the data model — an Electron main process
// writing what a sandboxed page edited. Through `./node` the same functions bring the parsers and
// the session with them. So the closure is asserted here over src/, type-only edges included, and
// scripts/smoke.mjs asserts the same of the BUILT entry, resolved by its package name.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readModuleGraph, describeEdges, type ModuleEdge } from './tools/moduleGraph.js';
import * as entry from '../src/node/save.js';
import * as nodeEntry from '../src/node/index.js';
import * as barrel from '../src/index.js';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const graph = readModuleGraph(SRC);
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
  exports: Record<string, { types: string; default: string }>;
};

/** Every module `from` reaches, following EVERY edge — a type-only one included. */
function closureOf(from: string): { modules: string[]; bare: ModuleEdge[] } {
  const seen = new Set<string>([from]);
  const bare: ModuleEdge[] = [];
  const queue = [from];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    for (const edge of graph.edges.filter((e) => e.from === file)) {
      if (edge.to === null) bare.push(edge);
      else if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return { modules: [...seen].sort(), bare };
}

describe('the node/save entry', () => {
  it('is published as its own subpath, pointing at what src/node/save.ts builds to', () => {
    expect(pkg.exports['./node/save']).toEqual({ types: './dist/node/save.d.ts', default: './dist/node/save.js' });
  });

  it('reaches the replace and its own module, nothing else', () => {
    expect(closureOf('node/save.ts').modules).toEqual(['folder/safeReplace.ts', 'node/save.ts']);
  });

  it('imports no third-party package, only node: builtins', () => {
    const notBuiltin = closureOf('node/save.ts').bare.filter((e) => !e.specifier.startsWith('node:'));
    expect(describeEdges(notBuiltin)).toEqual([]);
  });

  it('hands out ./node’s own values, and the barrel’s own rules', () => {
    for (const [name, value] of Object.entries(entry)) {
      expect((nodeEntry as Record<string, unknown>)[name], `${name} on ./node`).toBe(value);
    }
    expect(entry.replaceFile).toBe(barrel.replaceFile);
    expect(entry.sameFile).toBe(barrel.sameFile);
  });

  it('binds Node’s own fs/promises', async () => {
    expect(entry.nodeSaveFs).toBe(await import('node:fs/promises'));
  });
});
