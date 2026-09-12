// Copyright 2026 The MathWorks, Inc.
// Leak check: no internal MathWorks references may reach the tree. The package is
// public-bound, so this guards the boundary before any publish. `git grep` scans
// every tracked file — including the committed dist/ (shipped so the git dependency
// resolves without an install-time build) and package-lock.json, where internal
// Artifactory `resolved` URLs regress if `npm install` runs against the internal
// registry.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `data-explorer-ts` is the internal codename for the vendored subsystem; it must
// never surface in the public tree (the public name is "data explorer").
const NEEDLES = ['insidelabs', 'ipws', 'mw-npm-repository', 'gitlab', 'data-explorer-ts'];

// Every phase runs, and the exit code is decided at the END. An early process.exit(0)
// on the no-match path silently skipped the corpus phase below, so a planted corpus
// path went undetected — a check that cannot fail is worse than no check.
let failed = false;
if (!checkNeedles()) failed = true;
if (!checkCorpusPaths()) failed = true;
process.exit(failed ? 1 : 0);

// Use git grep so it respects .gitignore (skips node_modules, dist, *.tgz).
// This script is excluded from its own scan — it necessarily contains the
// needle strings as literals.
function checkNeedles() {
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
      return true;
    }
    throw e;
  }

  if (hits.trim()) {
    console.error('LEAK FAIL — internal references found:');
    console.error(hits);
    return false;
  }
  console.log('OK: no internal references found');
  return true;
}

// ---------------------------------------------------------------------------------
// Second needle set, derived rather than listed: the performance corpus.
//
// Real dictionaries are named after the customers they came from, so those names
// cannot be written down here — putting them in a tracked file to forbid them would
// BE the leak. Instead the needles come from perf/corpus.local.json, which is
// gitignored, and the assertion is that none of its paths appear in a tracked file.
// perf/corpus.mjs therefore declares only the SHAPE of each role.
//
// Known limit: with no manifest (a fresh clone, or CI) there is nothing to derive
// from and this phase is a no-op. That is acceptable because it runs exactly where
// the risk lives — the machine that actually holds the corpus.
function checkCorpusPaths() {
  const manifest = join(dirname(fileURLToPath(import.meta.url)), '..', 'perf', 'corpus.local.json');
  if (!existsSync(manifest)) {
    console.log('OK: no perf corpus manifest, so no corpus paths to check');
    return true;
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch (e) {
    console.error(`LEAK CHECK INCONCLUSIVE — perf/corpus.local.json is unreadable: ${e.message}`);
    return false;
  }

  // Both the relative path and the bare filename: a tracked file could name either,
  // and the filename alone is the part that carries the customer's name.
  //
  // A needle must look like a path or a filename — it has to contain a separator or
  // an extension. Bare single-segment names are skipped because they are ordinary
  // words as often as not: a `dirs` entry of "complex" matched a hundred lines of
  // prose across src/ and dist/ and made the whole check useless. The consequence is
  // that a single-segment directory name is NOT guarded, so it must not be one that
  // identifies anybody; the skipped ones are printed rather than dropped in silence.
  const needles = new Set();
  const skipped = [];
  const consider = (rel) => {
    if (typeof rel !== 'string' || rel.length === 0) return;
    if (rel.includes('/') || rel.includes('.')) needles.add(rel);
    else skipped.push(rel);
    const base = basename(rel);
    if (base !== rel && base.includes('.')) needles.add(base);
  };
  for (const rel of Object.values(parsed.files ?? {})) consider(rel);
  for (const rel of Object.values(parsed.dirs ?? {})) consider(rel);

  if (skipped.length > 0) {
    console.log(
      `note: not guarding ${skipped.length} single-segment name(s) — too generic to ` +
        `grep for: ${skipped.join(', ')}`,
    );
  }
  if (needles.size === 0) {
    console.log('OK: perf corpus manifest names no guardable paths');
    return true;
  }

  const args = ['grep', '-nI', '-F'];
  for (const n of needles) args.push('-e', n);
  args.push('--', '.', ':(exclude)scripts/leak-check.mjs');

  let corpusHits = '';
  try {
    corpusHits = execFileSync('git', args, { encoding: 'utf8' });
  } catch (e) {
    if (e.status === 1) {
      console.log(`OK: none of ${needles.size} corpus path(s) appear in a tracked file`);
      return true;
    }
    throw e;
  }

  if (corpusHits.trim()) {
    console.error('LEAK FAIL — a performance-corpus path reached a tracked file:');
    console.error(corpusHits);
    console.error(
      'Move it into perf/corpus.local.json and refer to the role id instead. Those\n' +
        'filenames identify the customers the dictionaries came from.',
    );
    return false;
  }
  console.log(`OK: none of ${needles.size} corpus path(s) appear in a tracked file`);
  return true;
}
