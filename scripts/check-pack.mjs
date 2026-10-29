// Copyright 2026 The MathWorks, Inc.
// Artifact check: the published tarball must contain ONLY dist/ (plus the npm
// defaults package.json / README / LICENSE). No src/, test/, fixtures, or notes.
// This is the leak boundary for the eventual public package.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
const [info] = JSON.parse(raw);
const files = info.files.map((f) => f.path);

const allowedTop = new Set(['package.json', 'README.md', 'LICENSE', 'LICENSE.md', 'LICENSE.txt']);
const offenders = files.filter((p) => !p.startsWith('dist/') && !allowedTop.has(p));

if (offenders.length > 0) {
  console.error('PACK FAIL — unexpected files in tarball:');
  offenders.forEach((p) => console.error('  ' + p));
  process.exit(1);
}

// And the other direction: every file the `exports` map names must SHIP. A subpath whose
// target is missing from the tarball installs cleanly and fails at the consumer's first
// import — the one place no check here would see it — so each entry's `types` and
// `default` are looked up in the same file list.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const targets = Object.entries(pkg.exports).flatMap(([subpath, conditions]) =>
  Object.values(conditions).map((target) => [subpath, target.replace(/^\.\//, '')]),
);
const unshipped = targets.filter(([, target]) => !files.includes(target));
if (unshipped.length > 0) {
  console.error('PACK FAIL — exports name files the tarball does not carry:');
  unshipped.forEach(([subpath, target]) => console.error(`  ${subpath} -> ${target}`));
  process.exit(1);
}

console.log(
  `OK: tarball is dist-only (${files.length} files, ${(info.size / 1024).toFixed(1)} kB packed), ` +
    `and carries all ${targets.length} export targets of ${Object.keys(pkg.exports).length} subpaths`,
);
