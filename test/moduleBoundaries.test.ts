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
import type { ModuleEdge } from './tools/moduleGraph.js';
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

// The same edges, counted by FOLDER instead of by file: one edge per importer's
// directory → target's directory, self-edges dropped (a folder depending on itself is
// what a folder is for). A view of the graph above, not a second graph.
const dirOf = (file: string): string => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.');

const directoryEdges = (): Map<string, ModuleEdge[]> => {
  const byPair = new Map<string, ModuleEdge[]>();
  for (const e of runtimeEdges(graph)) {
    const [from, to] = [dirOf(e.from), dirOf(e.to)];
    if (from === to) continue;
    byPair.set(`${from} -> ${to}`, [...(byPair.get(`${from} -> ${to}`) ?? []), e]);
  }
  return byPair;
};

describe('the directory graph is acyclic too', () => {
  it('has no folder pair that imports both ways round', () => {
    // Weaker than the file-level rule above and worth its own test, because it is the
    // one the file level cannot see: a directory cycle can exist while every FILE
    // stays acyclic, and it did here until `NodeClassMap` moved. It bundles and runs
    // perfectly — the cost is paid later, by whoever tries to lift a folder out into
    // its own package and finds the dependency points both ways. A DAG of folders is
    // the precondition for ever splitting this package up, and it is cheap to hold
    // and expensive to restore, so it is asserted now rather than rediscovered then.
    //
    // Two folders on one side of a cycle usually means a file is filed in the wrong
    // one: the fix is a `git mv`, not an interface. `NodeClassMap` enumerates the
    // subclasses in `node/data/`, so it belongs beside them; sitting in `node/` with
    // the base classes it imported DOWNWARD 24 times, against the layering, and one
    // move deleted the cycle without inverting anything.
    const pairs = directoryEdges();
    const projected = {
      files: [...new Set(graph.files.map(dirOf))],
      edges: [...pairs.keys()].map((pair) => {
        const [from, to] = pair.split(' -> ');
        return { from, to, specifier: to, typeOnly: false, line: 0 };
      }),
    };
    // Named down to the import, because "a cycle exists" is not something a reader can
    // act on: the actionable fact is which line to reconsider. Capped per leg — a leg
    // can hold dozens of imports and any one of them locates the folder pair.
    const cycles = runtimeCycles(projected).map((cycle) =>
      cycle
        .map((dir, i) => {
          const pair = `${dir} -> ${cycle[(i + 1) % cycle.length]}`;
          const causes = describeEdges(pairs.get(pair) ?? []);
          const shown = causes.slice(0, 3).join(', ');
          return `${pair} via ${shown}${causes.length > 3 ? ` (+${causes.length - 3} more)` : ''}`;
        })
        .join('\n    '),
    );
    expect(cycles).toEqual([]);
  });
});

describe('the seams that are already clean stay clean', () => {
  // Three folders import NOTHING outside themselves, and a fourth — 7600 lines of
  // parsers, the bulk of the package — imports exactly one module outside itself.
  // Nothing forced that and nothing but this test keeps it.
  //
  // Why these four and not a rule for every folder: they are the seams a package split
  // would cut FIRST, because for them it is nearly free. `datamodel/node/` is larger
  // still (9400 lines) but is entangled with the session, the props and the schema, so
  // bounding it would mean inventing interfaces; these four need only an `export`.
  //
  // When this fails, the new import is the thing to look at, not the test. Ask whether
  // the caller can pass the value in instead — a parser being handed what it needs is
  // usually the cheaper shape anyway. Widening the allowed set is a legitimate answer,
  // but it should be a decision someone made, not a number someone updated.
  const outboundFrom = (dir: string): Array<ModuleEdge & { to: string }> => {
    // A misspelled folder matches no file, so every filter here would return nothing
    // and every assertion would pass on an empty list. Prove the folder is real first.
    expect(graph.files.filter((f) => under(dir, f)).length, `${dir} holds modules`).toBeGreaterThan(0);
    return runtimeEdges(graph).filter((e) => under(dir, e.from) && !under(dir, e.to));
  };

  it('keeps datamodel/schema/ self-contained', () => {
    // The schema is the DECLARATION of what a class's properties are and how they lay
    // out; it answers from its own tables. An import here would mean a declaration had
    // started asking a parser or a node what it should say. `schema/index.ts`'s own
    // header already claims this ("the seed of a future standalone `dex-schema`
    // package; dependencies point INTO it only") — this is that claim, checked.
    expect(describeEdges(outboundFrom('datamodel/schema'))).toEqual([]);
  });

  it('keeps datamodel/display/ self-contained', () => {
    // Formatting values for a column: total functions on data handed to them. Reaching
    // out would mean a formatter had started fetching what it formats.
    expect(describeEdges(outboundFrom('datamodel/display'))).toEqual([]);
  });

  it('keeps datamodel/parser/ reaching for nothing but blockIdentity', () => {
    // The one allowed edge, twice: `MdlParser` and `SlxParser` both have to name what
    // kind of block they just read, and `datamodel/blockIdentity.ts` is the shared
    // table they name it against. Allowing it widens the seam by nothing measurable —
    // that module imports nothing at all, so it travels alone.
    const allowed = 'datamodel/blockIdentity.ts';
    const strays = outboundFrom('datamodel/parser').filter((e) => e.to !== allowed);
    expect(describeEdges(strays)).toEqual([]);
    // Not a count of them — a check that the exemption is still USED, so the test
    // cannot start passing because the seam quietly stopped existing.
    expect(outboundFrom('datamodel/parser').length, `and ${allowed} is still reached`).toBeGreaterThan(0);
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
