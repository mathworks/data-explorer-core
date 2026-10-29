// Copyright 2026 The MathWorks, Inc.
//
// The `data-explorer-core/fileKinds` entry (src/fileKinds.ts), held to the one property it
// exists for: importing it loads ONE module of this package and nothing else.
//
// The consumer is a host process that asks which files Data Explorer opens and never parses
// one — an Electron main process filtering an Open dialog. Through the barrel that question
// bundled all of core (855 KB for a handful of string tests). Nothing in the type system
// notices the entry growing an import, and nothing at runtime fails when it does: the
// bundle just quietly fills up again. So the graph is asserted here, against src/, and
// scripts/smoke.mjs asserts the same of the BUILT entry, resolved by its package name.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readModuleGraph, describeEdges } from './tools/moduleGraph.js';
import * as entry from '../src/fileKinds.js';
import * as kinds from '../src/datamodel/fileKinds.js';
import * as barrel from '../src/index.js';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const graph = readModuleGraph(SRC);
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
  exports: Record<string, { types: string; default: string }>;
};

describe('the fileKinds entry', () => {
  it('is published as its own subpath, pointing at what src/fileKinds.ts builds to', () => {
    // tsconfig maps src/ onto dist/ one for one, so the build of src/fileKinds.ts IS
    // dist/fileKinds.js. A target spelled any other way would resolve to a file this
    // repo does not build, and the subpath would fail only for the consumer.
    expect(pkg.exports['./fileKinds']).toEqual({
      types: './dist/fileKinds.d.ts',
      default: './dist/fileKinds.js',
    });
  });

  it('reaches datamodel/fileKinds.ts and nothing else', () => {
    // Every edge counts here, `import type` included: a type-only edge is erased by tsc,
    // but it is how an import that is NOT erased usually begins.
    const out = graph.edges.filter((e) => e.from === 'fileKinds.ts');
    expect(out.map((e) => e.to)).toEqual(['datamodel/fileKinds.ts']);
  });

  it('reaches a module that imports nothing at all', () => {
    // The half that makes the entry zero-dependency rather than one-dependency: the
    // module it re-exports must not reach for the rest of the package (or for fflate,
    // or for a `node:` builtin, which would also break a browser host).
    const out = graph.edges.filter((e) => e.from === 'datamodel/fileKinds.ts');
    expect(describeEdges(out)).toEqual([]);
  });

  it('publishes every export of the module, so the entry and the module cannot drift', () => {
    // The entry lists its names rather than `export *`, so that a helper added to the
    // module is a decision to publish rather than an accident. This is where that
    // decision is forced: a new export fails here until it is either listed in
    // src/fileKinds.ts or deliberately kept out (and this test changed to say so).
    expect(Object.keys(entry).sort()).toEqual(Object.keys(kinds).sort());
  });

  it('hands out the barrel’s own values, not copies of them', () => {
    // A host may import the kinds from here in one process and from the barrel in
    // another; the answer to "is this a dictionary?" must not depend on which.
    for (const [name, value] of Object.entries(entry)) {
      expect((barrel as Record<string, unknown>)[name], `${name} on the barrel`).toBe(value);
    }
  });
});
