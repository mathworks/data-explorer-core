// Copyright 2026 The MathWorks, Inc.
// Artifact check: nothing reachable from the MAIN barrel may statically import a
// `node:` builtin.
//
// The VS Code extension that consumes this package declares a `browser` entry point
// and imports ONLY `data-explorer-core`, never the `./node` subpath. Its bundler
// resolves every static import in that graph at build time, so ONE `import ... from
// 'node:zlib'` in a module the barrel reaches turns a working web extension into a
// build error — or worse, a bundle that ships a shim and fails at runtime.
//
// Nothing in the type system says so, and no test would catch it: the Node test run
// resolves `node:` builtins perfectly happily. It is an invariant about the SHAPE of
// the module graph, which is why it is checked here against built output.
//
// `dist/node/` is exempt by design: it is fenced out of the browser bundle by the
// package's `exports` conditions, and being the filesystem entry point is the whole
// reason it exists.
//
// What is deliberately NOT flagged: the string `'node:zlib'` passed to
// `process.getBuiltinModule` in datamodel/parser/Inflate.js. That is a property lookup
// on a runtime object, invisible to a bundler, and it is precisely the mechanism that
// lets the barrel reach zlib on Node without a static import. So this check must match
// import STATEMENTS, not the substring — a grep for `node:` reports 40+ false hits from
// `{ node: child }` object literals and prose in comments.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';

const DIST = resolve(import.meta.dirname, '..', 'dist');
const ENTRY = join(DIST, 'index.js');

/** Static `import`/`export ... from` specifiers, plus `require()` and `import()`. */
function specifiersIn(source) {
  const out = [];
  // Strip line and block comments first, so a `node:zlib` mentioned in prose — this
  // package comments heavily — is not read as code.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g, // bare side-effect import
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of code.matchAll(re)) out.push(m[1]);
  }
  return out;
}

// Walk the graph from the barrel rather than scanning every file: a `node:` import in
// a module nothing reaches is not a bundling problem, and dist/node/index.js is
// exactly such a module.
const visited = new Set();
const offenders = [];
const queue = [ENTRY];

while (queue.length > 0) {
  const file = queue.pop();
  if (visited.has(file)) continue;
  visited.add(file);

  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    console.error(`BROWSER-SAFE FAIL — cannot read ${relative(DIST, file)}; run the build first`);
    process.exit(1);
  }

  for (const spec of specifiersIn(source)) {
    if (spec.startsWith('node:')) {
      offenders.push({ file: relative(DIST, file), spec });
      continue;
    }
    if (!spec.startsWith('.')) continue; // a bare package name; not ours to walk
    const target = resolve(dirname(file), spec);
    // tsc emits extensioned relative specifiers, so this resolves directly. Tolerate
    // an extensionless one rather than silently stopping the walk there.
    for (const candidate of [target, `${target}.js`, join(target, 'index.js')]) {
      try {
        if (statSync(candidate).isFile()) {
          queue.push(candidate);
          break;
        }
      } catch {
        /* try the next spelling */
      }
    }
  }
}

if (offenders.length > 0) {
  console.error('BROWSER-SAFE FAIL — `node:` builtins reachable from the main barrel:');
  for (const { file, spec } of offenders) console.error(`  ${file} imports ${spec}`);
  console.error('\nThe VS Code web extension bundles this graph. Reach the builtin through');
  console.error('`process.getBuiltinModule` with an fflate fallback (see parser/Inflate.js),');
  console.error('or move the code to the `./node` subpath.');
  process.exit(1);
}

// A walk that reached almost nothing would pass this check vacuously — which is how a
// broken resolver turns a guard into decoration. Assert it actually got somewhere.
const MIN_REACHED = 50;
if (visited.size < MIN_REACHED) {
  console.error(
    `BROWSER-SAFE FAIL — walked only ${visited.size} modules from the barrel, expected ` +
      `at least ${MIN_REACHED}. The specifier resolution is probably broken, so this ` +
      `check proved nothing.`,
  );
  process.exit(1);
}

// The counterpart claim: the Node subpath IS allowed its builtins, and if it stopped
// having any, the fast-inflate arming has quietly gone missing.
const nodeSubpath = readFileSync(join(DIST, 'node', 'index.js'), 'utf8');
const nodeBuiltins = specifiersIn(nodeSubpath).filter((s) => s.startsWith('node:'));
if (nodeBuiltins.length === 0) {
  console.error('BROWSER-SAFE FAIL — dist/node/index.js imports no `node:` builtin at all.');
  process.exit(1);
}

console.log(
  `OK: ${visited.size} modules reachable from the barrel, none importing a \`node:\` builtin ` +
    `(dist/node/index.js uses ${nodeBuiltins.length}, by design)`,
);
