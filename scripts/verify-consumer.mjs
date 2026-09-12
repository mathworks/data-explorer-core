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

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const CORE = resolve(import.meta.dirname, '..');
const CONSUMER = resolve(process.env.DEX_CONSUMER ?? join(CORE, '..', 'data-explorer-vscode'));
const PKG = 'data-explorer-core';
const keep = process.argv.includes('--keep');

const say = (m) => console.log(m);
const die = (m) => {
  console.error(`verify-consumer: ${m}`);
  process.exit(1);
};

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
    say(`\n--keep: local dist/ left in place; restore with\n  rm -rf ${liveDist} && mv ${backup} ${liveDist}`);
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
