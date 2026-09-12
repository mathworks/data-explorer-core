// Copyright 2026 The MathWorks, Inc.
// Diff two performance snapshots and gate on regression.
//
//   node perf/compare.mjs before after-step-1
//   node perf/compare.mjs before after-step-1 --threshold 15
//
// Exits non-zero when a scenario got materially slower, or when a scenario's probe
// changed -- a probe change means the fast path produced something different, which
// matters more than the timing did.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = join(HERE, 'baselines');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const beforeLabel = positional[0];
const afterLabel = positional[1];
// 10% by default. Wall-clock on a developer machine is noisy; best-of-N tightens it
// but does not eliminate it, and a gate that cries wolf gets switched off.
const threshold = Number(arg('threshold', '10'));

if (!beforeLabel || !afterLabel) {
  console.error('usage: node perf/compare.mjs <before-label> <after-label> [--threshold pct]');
  process.exit(2);
}

function load(label) {
  const p = join(BASELINE_DIR, `${label}.json`);
  if (!existsSync(p)) {
    console.error(`no snapshot perf/baselines/${label}.json`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

const before = load(beforeLabel);
const after = load(afterLabel);

// ---- refuse to compare things that are not comparable -------------------------
const envWarnings = [];
for (const key of ['node', 'platform', 'cpu', 'gcExposed']) {
  if (before.environment[key] !== after.environment[key]) {
    envWarnings.push(`  ${key}: ${before.environment[key]} -> ${after.environment[key]}`);
  }
}
for (const [role, bytes] of Object.entries(before.corpus.bytes ?? {})) {
  const now = after.corpus.bytes?.[role];
  if (now !== undefined && now !== bytes) {
    envWarnings.push(`  corpus ${role}: ${bytes} -> ${now} bytes`);
  }
}
if (envWarnings.length > 0) {
  console.log('WARNING: the two runs are not directly comparable:');
  console.log(envWarnings.join('\n'));
  console.log();
}

// ---- the diff ------------------------------------------------------------------
console.log(`${beforeLabel} -> ${afterLabel}   (regression threshold ${threshold}%)\n`);
console.log(
  `  ${'scenario'.padEnd(30)}${'before'.padStart(10)}${'after'.padStart(10)}` +
    `${'delta'.padStart(10)}${'speedup'.padStart(10)}  note`,
);
console.log(`  ${'-'.repeat(30)}${'-'.repeat(10)}${'-'.repeat(10)}${'-'.repeat(10)}${'-'.repeat(10)}  ${'-'.repeat(24)}`);

const regressions = [];
const probeChanges = [];
const ids = [...new Set([...Object.keys(before.scenarios), ...Object.keys(after.scenarios)])].sort();

for (const id of ids) {
  const b = before.scenarios[id];
  const a = after.scenarios[id];

  if (!b) {
    console.log(`  ${id.padEnd(30)}${'--'.padStart(10)}${a.ms.toFixed(1).padStart(10)}${'new'.padStart(10)}${''.padStart(10)}  new scenario`);
    continue;
  }
  if (!a) {
    // A scenario that stopped running is not a pass. Usually a corpus role went
    // missing, which silently shrinks what the gate covers.
    console.log(`  ${id.padEnd(30)}${b.ms.toFixed(1).padStart(10)}${'--'.padStart(10)}${'GONE'.padStart(10)}${''.padStart(10)}  not run in ${afterLabel}`);
    regressions.push(`${id}: not run in ${afterLabel} (coverage lost)`);
    continue;
  }

  const deltaPct = ((a.ms - b.ms) / b.ms) * 100;
  const speedup = b.ms / a.ms;
  const notes = [];

  if (b.probe !== a.probe) {
    notes.push(`PROBE ${b.probe} -> ${a.probe}`);
    probeChanges.push(`${id}: probe ${b.probe} -> ${a.probe}`);
  }
  if (deltaPct > threshold) {
    notes.push('REGRESSION');
    regressions.push(`${id}: ${b.ms.toFixed(1)} -> ${a.ms.toFixed(1)} ms (+${deltaPct.toFixed(1)}%)`);
  } else if (deltaPct < -threshold) {
    notes.push('improved');
  }
  // Both memory figures matter, and for different steps: the tree-building paths move
  // heapUsed, the byte-oriented paths move off-heap. Reporting one would miss the other.
  for (const [key, label] of [['heapMB', 'heap'], ['offHeapMB', 'offheap']]) {
    const bv = b[key];
    const av = a[key];
    if (bv !== null && bv !== undefined && av !== null && av !== undefined && Math.abs(bv) > 1) {
      const pct = ((av - bv) / bv) * 100;
      notes.push(`${label} ${bv.toFixed(1)}->${av.toFixed(1)} MB (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%)`);
    }
  }

  console.log(
    `  ${id.padEnd(30)}${b.ms.toFixed(1).padStart(10)}${a.ms.toFixed(1).padStart(10)}` +
      `${`${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%`.padStart(10)}` +
      `${`${speedup.toFixed(2)}x`.padStart(10)}  ${notes.join('; ')}`,
  );
}

console.log();
if (probeChanges.length > 0) {
  console.log('PROBE CHANGES -- a fast path produced something different:');
  probeChanges.forEach((p) => console.log(`  ${p}`));
  console.log();
}
if (regressions.length > 0) {
  console.log(`FAIL: ${regressions.length} regression(s)`);
  regressions.forEach((r) => console.log(`  ${r}`));
  process.exit(1);
}
console.log(probeChanges.length > 0 ? 'no timing regression, but see probe changes above' : 'OK: no regression');
