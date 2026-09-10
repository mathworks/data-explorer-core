// Copyright 2026 The MathWorks, Inc.
//
// The shape of this package, asserted rather than described.
//
// Everything here already holds. That is the point: these are the properties the
// package's LAYOUT provides — a browser-safe barrel, a Node-only side entry, a data
// model that does not need the session layer, an acyclic class hierarchy — and every
// one of them was, until this file, held in place by nothing but the habit of the
// people editing it. Each is a single `import` away from being lost, and none of the
// four fails in the place it was broken:
//
//   * a `node:fs` import in a parser breaks the CONSUMER's browser build
//   * a value import where a type import was breaks at BUNDLE LOAD, before any test
//   * a datamodel→core value edge silently doubles what a folder scan drags in
//   * an undeclared dependency breaks a fresh `npm install`, not this repo's tests
//
// So they are asserted here, in the repo that owns the layout, where the failure names
// the file and line that caused it. See `test/publicTypeSurface.test.ts` for the other
// half of the contract — what a consumer can NAME, as opposed to what it must not reach.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readModuleGraph, runtimeCycles, runtimeEdges, describeEdges } from './tools/moduleGraph.js';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const graph = readModuleGraph(SRC);
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
  dependencies?: Record<string, string>;
  exports: Record<string, unknown>;
};

const under = (dir: string, file: string): boolean => file === `${dir}.ts` || file.startsWith(`${dir}/`);

// A walker that silently read nothing would make every assertion below pass. These
// numbers are floors, not counts — they exist to fail if the tree moves or the parser
// stops matching, not to be updated whenever a file is added.
describe('the walker is actually reading this tree', () => {
  it('finds the modules and the imports between them', () => {
    expect(graph.files.length).toBeGreaterThan(80);
    expect(graph.files).toContain('index.ts');
    expect(graph.files).toContain('node/index.ts');
    expect(runtimeEdges(graph).length).toBeGreaterThan(200);
  });

  it('sees the `type` keyword, which every test here depends on', () => {
    // If `typeOnly` were always false the cycle test below would fail loudly, but the
    // two layering tests would fail QUIETLY — they would flag erased edges as
    // violations. This pins the distinction itself, on a known pair: `BaseNode` needs
    // `schemaBridge` as a value, and `schemaBridge` needs `BaseNode` only as a type.
    const between = (from: string, to: string) => graph.edges.filter((e) => e.from === from && e.to === to);
    const [toBridge] = between('datamodel/node/BaseNode.ts', 'datamodel/node/schemaBridge.ts');
    const [toBase] = between('datamodel/node/schemaBridge.ts', 'datamodel/node/BaseNode.ts');
    expect(toBridge?.typeOnly, 'BaseNode imports buildPILayout as a value').toBe(false);
    expect(toBase?.typeOnly, 'schemaBridge imports BaseNode as a type only').toBe(true);
  });
});

describe('the runtime module graph is acyclic', () => {
  it('has no cycle a bundler could evaluate in the wrong order', () => {
    // The node layer is a deep class hierarchy, so a cycle here is not a smell — it is
    // a crash. `class DataNode extends BaseNode` runs at module-evaluation time, and in
    // a cycle one of the two modules necessarily evaluates first and sees `undefined`:
    // "Class extends value undefined is not a constructor or null", at import, before a
    // single test body runs. Fifteen `Prop*` atoms plus `schemaBridge` reference
    // `BaseNode` for typing alone and say so with `import type`, which is what keeps
    // this at zero — a maintainer dropping one `type` keyword is the whole risk.
    const cycles = runtimeCycles(graph).map((c) => c.join(' -> '));
    expect(cycles).toEqual([]);
  });
});

describe('the main barrel stays usable in a browser', () => {
  // The consumer that matters: data-explorer-vscode ships a WEB extension bundle
  // (`npm run build:web`) that runs in the browser, with this package inlined. Node
  // builtins are separated by ENTRY POINT rather than by discipline — `./node` is a
  // second export whose whole job is to be the one place `node:fs` may appear — so the
  // separation is only real while nothing reachable from `.` reaches for a builtin.
  const builtinImports = graph.edges.filter((e) => e.specifier.startsWith('node:'));

  it('confines every node: builtin to the ./node entry', () => {
    expect(builtinImports.length, 'the ./node entry must still use some').toBeGreaterThan(0);
    const strays = builtinImports.filter((e) => !under('node', e.from));
    expect(describeEdges(strays)).toEqual([]);
  });

  it('keeps ./node a leaf, so nothing drags it into the barrel', () => {
    // The rule above is worth nothing if the barrel imports the Node entry: the
    // builtins would arrive transitively, from a file that never names one.
    const intoNode = runtimeEdges(graph).filter((e) => under('node', e.to) && !under('node', e.from));
    expect(describeEdges(intoNode)).toEqual([]);
    expect(pkg.exports['./node'], 'and it is still published as its own entry').toBeTruthy();
  });
});

describe('the data model does not need the session layer', () => {
  it('never RUNS code from core/ inside datamodel/', () => {
    // `datamodel/` is the file formats and the node classes; `core/` is the session,
    // event bus, undo stack and ingest dispatch built ON them. The dependency is meant
    // to point one way, and the barrel sells that: `buildUsageIndex` is documented as
    // answering usage over a set of files "and needs no node trees to do it", so a
    // consumer scanning a folder should not be loading a session.
    //
    // Type-only reaches upward are fine and one exists — `UsageIndex` returns
    // `NodeUsage`, which `core/DataModel` declares — which is exactly why this test
    // filters on erasure instead of on the import's text. Turning that one line into a
    // value import would both fatten every folder-scan consumer and create the cycle
    // the test above forbids, since `core/DataModel` imports `datamodel/` sixteen times.
    const upward = runtimeEdges(graph).filter((e) => under('datamodel', e.from) && under('core', e.to));
    expect(describeEdges(upward)).toEqual([]);
  });

  it('and the type-only reach upward is still just the one, named', () => {
    // Not a limit on the count — a check that the exemption above is being USED, so the
    // test cannot start passing because the layering question stopped being asked.
    const typed = graph.edges.filter((e) => e.typeOnly && under('datamodel', e.from) && e.to && under('core', e.to));
    expect(typed.map((e) => e.from)).toEqual(['datamodel/usage/UsageIndex.ts']);
  });
});

describe('every third-party import is a declared dependency', () => {
  it('names nothing that a fresh install would not provide', () => {
    // A stray import of a devDependency (or of a transitive dep that happens to be
    // hoisted into node_modules) type-checks, bundles and tests green HERE, and then
    // fails for the consumer, at install or at load. This package is consumed as a git
    // dependency with prebuilt `dist/`, so the failure lands even further from the
    // cause. `node:` builtins are covered by their own tests above.
    const declared = new Set(Object.keys(pkg.dependencies ?? {}));
    const bare = graph.edges.filter((e) => !e.specifier.startsWith('.') && !e.specifier.startsWith('node:'));
    const packageOf = (spec: string) => (spec.startsWith('@') ? spec.split('/', 2).join('/') : spec.split('/')[0]);
    const undeclared = bare.filter((e) => !declared.has(packageOf(e.specifier)));
    expect(describeEdges(undeclared)).toEqual([]);
    expect(bare.length, 'and the runtime deps are still actually used').toBeGreaterThan(0);
  });
});
