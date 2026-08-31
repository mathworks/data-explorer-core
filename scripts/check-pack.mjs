// Copyright 2026 The MathWorks, Inc.
// Artifact check: the published tarball must contain ONLY dist/ (plus the npm
// defaults package.json / README / LICENSE). No src/, test/, fixtures, or notes.
// This is the leak boundary for the eventual public package.

import { execFileSync } from 'node:child_process';

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

console.log(`OK: tarball is dist-only (${files.length} files, ${(info.size / 1024).toFixed(1)} kB packed)`);
