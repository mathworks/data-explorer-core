// Copyright 2026 The MathWorks, Inc.
// Leak check: no internal MathWorks references may reach the tree. The package is
// public-bound, so this guards the boundary before any publish. dist/ is generated
// from src/, so scanning src/test/config/scripts is sufficient. package-lock.json
// is scanned too — it is where internal Artifactory `resolved` URLs regress if
// `npm install` is ever run against the internal registry.

import { execFileSync } from 'node:child_process';

// `data-explorer-ts` is the internal codename for the vendored subsystem; it must
// never surface in the public tree (the public name is "data explorer").
const NEEDLES = ['insidelabs', 'ipws', 'mw-npm-repository', 'gitlab', 'data-explorer-ts'];

// Use git grep so it respects .gitignore (skips node_modules, dist, *.tgz).
// This script is excluded from its own scan — it necessarily contains the
// needle strings as literals.
let hits = '';
try {
  hits = execFileSync(
    'git',
    ['grep', '-nI', '-E', NEEDLES.join('|'), '--', '.', ':(exclude)scripts/leak-check.mjs'],
    { encoding: 'utf8' },
  );
} catch (e) {
  // git grep exits 1 when there are no matches — that's the success case.
  if (e.status === 1) {
    console.log('OK: no internal references found');
    process.exit(0);
  }
  throw e;
}

if (hits.trim()) {
  console.error('LEAK FAIL — internal references found:');
  console.error(hits);
  process.exit(1);
}
console.log('OK: no internal references found');
