// Copyright 2026 The MathWorks, Inc.
// Cross-repo regression gate: does the consumer still pass against THIS working tree?
//
// The consumer declares core as a git dependency pinned to a tag, so it never sees
// local work. Nothing in core's own `verify` can catch a change that compiles, passes
// core's tests, and breaks the consumer.
//
// The swap is exact rather than approximate because core publishes dist/ only
// (`files: ["dist"]`), so the installed package is dist/ plus a manifest. Replacing
// dist/ in place is therefore equivalent to installing this tree, needs no network,
// and undoes with a directory move.
//
//   node scripts/verify-consumer.mjs
//   DEX_CONSUMER=/path/to/consumer node scripts/verify-consumer.mjs
//   node scripts/verify-consumer.mjs --keep    (leave the swap in place for debugging)
//   node scripts/verify-consumer.mjs --restore <backup>   (undo a --keep)
//
// `--keep` is for running something this script does not: the consumer's
// @vscode/test-electron suite, a single vitest file, a mutation check. It needs an UNDO
// that is not a shell one-liner — the printed `rm -rf`/`mv` is fine for a human but is
// exactly the shape a sandboxed or reviewed runner refuses, which leaves node_modules
// holding an unpublished build and no supported way back. So the undo lives here, in the
// tool that made the mess, and it verifies what it is restoring before it moves anything.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const CORE = resolve(import.meta.dirname, '..');
const CONSUMER = resolve(process.env.DEX_CONSUMER ?? join(CORE, '..', 'data-explorer-vscode'));
const PKG = 'data-explorer-core';
const keep = process.argv.includes('--keep');
const restoreFrom = process.argv[process.argv.indexOf('--restore') + 1];

const say = (m) => console.log(m);
const die = (m) => {
  console.error(`verify-consumer: ${m}`);
  process.exit(1);
};

// ---- undo a --keep, then stop ---------------------------------------------------
if (process.argv.includes('--restore')) {
  const live = join(CONSUMER, 'node_modules', PKG, 'dist');
  if (!restoreFrom || restoreFrom.startsWith('--')) die('--restore needs the backup path --keep printed');
  const backup = resolve(restoreFrom);
  // Both checks matter: without them a typo'd path deletes the installed package and
  // replaces it with nothing, which looks like a broken install rather than a bad command.
  if (!existsSync(join(backup, 'index.js'))) die(`${backup} does not look like a core dist/ (no index.js)`);
  if (!existsSync(live)) die(`nothing installed at ${live}`);
  rmSync(live, { recursive: true, force: true });
  renameSync(backup, live);
  say(`restored ${live}`);
  say(`  from ${backup}`);
  process.exit(0);
}

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function runInherit(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

// ---- preconditions -------------------------------------------------------------
if (!existsSync(CONSUMER)) die(`consumer not found at ${CONSUMER} (set DEX_CONSUMER)`);
const installed = join(CONSUMER, 'node_modules', PKG);
if (!existsSync(installed)) die(`${PKG} is not installed in the consumer; run npm install there first`);

const localVersion = JSON.parse(readFileSync(join(CORE, 'package.json'), 'utf8')).version;
const installedVersion = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).version;
say(`core (local):     ${localVersion}`);
say(`core (consumer):  ${installedVersion}`);
if (localVersion !== installedVersion) {
  // Not fatal, but it means the consumer's own tests were written against a
  // different surface, so a failure may be a version gap rather than a regression.
  say(`  note: versions differ -- a failure below may be a version gap, not a regression`);
}

// The consumer must be clean going in, or "no regression" cannot be attributed.
const consumerDirty = run('git', ['status', '--porcelain'], CONSUMER).trim();
if (consumerDirty) {
  say('\nconsumer working tree is not clean:');
  say(consumerDirty.split('\n').map((l) => `  ${l}`).join('\n'));
  say('  (continuing -- the swap only touches node_modules)');
}

// ---- build this tree -----------------------------------------------------------
say('\n[1/4] building core');
runInherit('npm', ['run', 'build'], CORE);

// ---- swap dist/ in ------------------------------------------------------------
const liveDist = join(installed, 'dist');
const backup = join(mkdtempSync(join(tmpdir(), 'dex-consumer-')), 'dist.orig');
say('\n[2/4] swapping local dist/ into the consumer');
if (!existsSync(liveDist)) die(`consumer's ${PKG} has no dist/ to replace`);
renameSync(liveDist, backup);
say(`  original preserved at ${backup}`);

let failure = null;
try {
  cpSync(join(CORE, 'dist'), liveDist, { recursive: true });

  // ---- run the consumer's gate -------------------------------------------------
  say('\n[3/4] consumer typecheck');
  runInherit('npm', ['run', 'typecheck'], CONSUMER);

  say('\n[4/4] consumer tests');
  runInherit('npm', ['test'], CONSUMER);
} catch (err) {
  failure = err;
} finally {
  if (keep) {
    say(`\n--keep: local dist/ left in place; restore with\n  node scripts/verify-consumer.mjs --restore ${backup}`);
  } else {
    say('\nrestoring the consumer');
    rmSync(liveDist, { recursive: true, force: true });
    renameSync(backup, liveDist);
    say('  restored');
  }
}

if (failure) {
  console.error('\nCONSUMER FAIL -- this working tree breaks the consumer.');
  process.exit(1);
}
say('\nOK: consumer passes against the local core tree');
