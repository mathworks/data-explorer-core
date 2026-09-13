// Copyright 2026 The MathWorks, Inc.
// Run the performance scenarios and record a snapshot.
//
//   node --expose-gc perf/run.mjs --label before
//   node --expose-gc perf/run.mjs --label after-step-1 --only sldd.zip
//   node perf/compare.mjs before after-step-1
//
// --expose-gc is not required, but without it every heap number is dropped rather
// than reported unreliably, and the snapshot says so.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { resolveCorpus, describeCorpus } from './corpus.mjs';
import { measure, environment, gcAvailable } from './measure.mjs';
import { scenarios, inflateEngine, forceInflateEngine } from './scenarios.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = join(HERE, 'baselines');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

function gitLabel() {
  try {
    const rev = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
    return `${branch}-${rev}`;
  } catch {
    return 'unlabelled';
  }
}

const label = arg('label') ?? gitLabel();
const only = arg('only');

const corpus = resolveCorpus();
console.log(describeCorpus(corpus));
console.log();

if (!gcAvailable) {
  console.log('note: started without --expose-gc, so heap is not recorded this run.\n');
}

// Before `scenarios()` reads anything: importing dist/node/index.js armed the native
// engine as a side effect, and this is the only place that can put it back.
forceInflateEngine(process.env.DEX_PERF_INFLATE);

const all = scenarios(corpus);
console.log(`inflate engine: ${inflateEngine()}\n`);
const selected = only ? all.filter((s) => s.id.includes(only)) : all;

if (selected.length === 0) {
  console.error(
    only
      ? `no scenario matches --only ${only} (have: ${all.map((s) => s.id).join(', ') || 'none'})`
      : 'no scenario could run: the corpus resolved to nothing. Set DEX_PERF_CORPUS.',
  );
  process.exit(1);
}

console.log(`running ${selected.length} of ${all.length} scenario(s)\n`);
console.log(
  `  ${'scenario'.padEnd(30)}${'ms'.padStart(10)}${'heap MB'.padStart(10)}${'offheap'.padStart(10)}  probe`,
);
console.log(`  ${'-'.repeat(30)}${'-'.repeat(10)}${'-'.repeat(10)}${'-'.repeat(10)}  ${'-'.repeat(20)}`);

const results = {};
const failures = [];
for (const s of selected) {
  // Contain the blast radius: one scenario that throws must not discard the other
  // twelve measurements. A fixture being rewritten under the run threw ENOENT here
  // and cost a full snapshot. The failure is RECORDED, not swallowed -- an absent
  // scenario is treated as lost coverage by perf/compare.mjs.
  let r;
  try {
    r = measure(s.run, { samples: s.samples });
  } catch (e) {
    failures.push(`${s.id}: ${e.message}`);
    console.log(`  ${s.id.padEnd(30)}${'FAILED'.padStart(10)}  ${e.message}`);
    continue;
  }
  results[s.id] = {
    ms: Number(r.ms.toFixed(2)),
    heapMB: r.heapMB === null ? null : Number(r.heapMB.toFixed(1)),
    // Tracked separately because V8 keeps large strings and every ArrayBuffer off
    // the JS heap -- see the note in perf/measure.mjs.
    offHeapMB: r.offHeapMB === null ? null : Number(r.offHeapMB.toFixed(1)),
    samples: r.samples,
    probe: r.probe,
    role: s.role,
    what: s.what,
  };
  console.log(
    `  ${s.id.padEnd(30)}${r.ms.toFixed(1).padStart(10)}` +
      `${(r.heapMB === null ? '--' : r.heapMB.toFixed(1)).padStart(10)}` +
      `${(r.offHeapMB === null ? '--' : r.offHeapMB.toFixed(1)).padStart(10)}  ${r.probe}`,
  );
}

const snapshot = {
  label,
  // Recorded so a diff can refuse to compare runs from different machines or
  // different corpora -- both of which would make the numbers meaningless.
  environment: environment(),
  // Which decompression engine was live. Not part of `environment()` because it is a
  // property of this PACKAGE's state, not the machine's, and step 1 is precisely the
  // step that changes it.
  inflateEngine: inflateEngine(),
  corpus: {
    root: corpus.root,
    present: Object.values(corpus.roles).filter((r) => r.present).map((r) => r.id),
    missing: corpus.missing,
    knownGaps: corpus.gaps,
    // Total bytes per role: a corpus that grew makes a slowdown expected, not a bug.
    bytes: Object.fromEntries(Object.values(corpus.roles).map((r) => [r.id, r.bytes])),
  },
  scenarios: results,
};

mkdirSync(BASELINE_DIR, { recursive: true });
const out = join(BASELINE_DIR, `${label}.json`);
writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`\nsnapshot written: perf/baselines/${label}.json`);

if (corpus.gaps.length > 0) {
  console.log(
    `\nWARNING: ${corpus.gaps.join(', ')} absent -- this snapshot cannot support any ` +
      'claim about that role.',
  );
}

if (failures.length > 0) {
  console.log(`\nWARNING: ${failures.length} scenario(s) failed and are absent from the snapshot:`);
  failures.forEach((f) => console.log(`  ${f}`));
  // Non-zero: a snapshot with holes is still written (the good measurements are worth
  // keeping) but no script should treat this run as a clean baseline by accident.
  process.exitCode = 1;
}
