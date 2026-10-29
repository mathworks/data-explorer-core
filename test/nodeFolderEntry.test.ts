// Copyright 2026 The MathWorks, Inc.
//
// The `data-explorer-core/node/folder` entry (src/node/folder.ts), held to the one property it
// exists for: it reaches no module of the data model.
//
// Its consumer is the process that holds a folder and parses none of it — an Electron main
// process listing and reading for a sandboxed page. Through `./node` those reads cost the whole
// package (857 KB of main bundle against 7 KB), and nothing fails when an entry starts reaching
// the data model again: the bundle just fills up. So the closure is asserted here over src/,
// type-only edges included, and scripts/smoke.mjs asserts the same of the BUILT entry, resolved
// by its package name.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readModuleGraph, describeEdges, type ModuleEdge } from './tools/moduleGraph.js';
import * as entry from '../src/node/folder.js';
import * as reads from '../src/node/folderReads.js';
import * as listing from '../src/node/listFolder.js';
import * as nodeEntry from '../src/node/index.js';

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

describe('the node/folder entry', () => {
  it('is published as its own subpath, pointing at what src/node/folder.ts builds to', () => {
    expect(pkg.exports['./node/folder']).toEqual({
      types: './dist/node/folder.d.ts',
      default: './dist/node/folder.js',
    });
  });

  it('reaches the file-kind tests, the scan version, the store walk and its own modules, nothing else', () => {
    // Exactly this set, so that a module joining it is a decision someone makes here rather than
    // a bundle that grows. Every edge counts, `import type` included: a type-only edge is erased
    // by tsc, but it is how an import that is NOT erased usually begins, and its declarations are
    // what a host's type checker loads.
    expect(closureOf('node/folder.ts').modules).toEqual([
      'datamodel/fileKinds.ts',
      'folder/projectStore.ts',
      'folder/scanVersion.ts',
      'folder/sourceReader.ts',
      'node/folder.ts',
      'node/folderReads.ts',
      'node/listFolder.ts',
    ]);
  });

  it('reaches no module of the data model or the session', () => {
    // The property the set above implies, stated as the failure a reader would want named: the
    // one `datamodel/` module allowed is fileKinds, which imports nothing, and `core/` is out.
    const strays = closureOf('node/folder.ts').modules.filter(
      (m) => (m.startsWith('datamodel/') && m !== 'datamodel/fileKinds.ts') || m.startsWith('core/'),
    );
    expect(strays).toEqual([]);
  });

  it('imports no third-party package, only node: builtins', () => {
    // fflate is the package's own dependency and the first thing a parser reaches for; the
    // entry's process should not load it to list a folder.
    const notBuiltin = closureOf('node/folder.ts').bare.filter((e) => !e.specifier.startsWith('node:'));
    expect(describeEdges(notBuiltin)).toEqual([]);
  });

  it('publishes every export of the modules it fronts', () => {
    // The entry lists its names rather than `export *`; a function added to either module is a
    // decision to publish, and this is where it is forced.
    expect(Object.keys(entry).sort()).toEqual([...Object.keys(reads), ...Object.keys(listing)].sort());
  });

  it('hands out the ./node entry’s own values, not copies of them', () => {
    // A host may list in main through this entry and load in a worker through `./node`; the two
    // must be one implementation.
    for (const [name, value] of Object.entries(entry)) {
      expect((nodeEntry as Record<string, unknown>)[name], `${name} on ./node`).toBe(value);
    }
  });
});
