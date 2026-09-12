// Copyright 2026 The MathWorks, Inc.
// Run the equivalence oracle over the real corpus.
//
//   node perf/oracle-run.mjs
//   node perf/oracle-run.mjs --only refs
//
// Steps 1-3 of docs/deep-work/2026-09-12-core-perf-plan.md add a CANDIDATE to each
// case below. Until then the cases still earn their keep two ways:
//
//  * they prove the reference is DETERMINISTIC. Every later comparison assumes the
//    slow path gives the same answer twice; nothing had checked that.
//  * the negative controls prove the oracle can FAIL on real files. A green oracle
//    that cannot go red is what would have blessed the MAT scanner at 8/31.

import { readFileSync } from 'node:fs';
import { filesFor, resolveCorpus, describeCorpus } from './corpus.mjs';
import { runCase, formatCase, compareBytes } from './oracle.mjs';

const core = await import('../dist/index.js');
const { readSlddContent, slddChunkContent, normalizeRefNames, parseMat } = core;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const only = arg('only');

function readAsArrayBuffer(path) {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const slddNames = (path) => {
  const content = slddChunkContent(readSlddContent(readAsArrayBuffer(path), []));
  const out = [];
  for (const entry of content?.entries ?? []) {
    if (entry?.name) out.push(entry.name);
  }
  return out;
};

const slddRefs = (path) => {
  const content = slddChunkContent(readSlddContent(readAsArrayBuffer(path), []));
  return content ? normalizeRefNames(content['Dictionary References']) : [];
};

const matNames = (path) => parseMat(readAsArrayBuffer(path)).variables.map((v) => v.name);

const corpus = resolveCorpus();
console.log(describeCorpus(corpus));
console.log();

const slddFiles = filesFor(corpus, 'sldd-corpus');
const matFiles = filesFor(corpus, 'mat-corpus');

// `expectFail` cases are negative controls: the candidate is deliberately wrong, and
// the RUN fails if the oracle reports agreement.
const CASES = [
  {
    name: 'sldd.names.deterministic',
    files: slddFiles,
    reference: slddNames,
    candidate: slddNames,
  },
  {
    name: 'sldd.refs.deterministic',
    files: slddFiles,
    reference: slddRefs,
    candidate: slddRefs,
  },
  {
    name: 'sldd.unzip.deterministic',
    files: slddFiles,
    reference: (f) => new Uint8Array(readAsArrayBuffer(f)),
    candidate: (f) => new Uint8Array(readAsArrayBuffer(f)),
    compare: compareBytes,
  },
  {
    name: 'mat.names.deterministic',
    files: matFiles,
    reference: matNames,
    candidate: matNames,
  },
  // ---- negative controls, on real files ----------------------------------------
  {
    name: 'control.sldd.dropsLastName',
    files: slddFiles,
    reference: slddNames,
    candidate: (f) => slddNames(f).slice(0, -1),
    expectFail: true,
  },
  {
    name: 'control.sldd.reordersNames',
    files: slddFiles,
    reference: slddNames,
    candidate: (f) => slddNames(f).slice().reverse(),
    expectFail: true,
  },
  {
    // The MCOS failure mode from the MAT probe, reproduced deliberately: a scanner
    // that returns the CLASS name where the variable name belongs.
    name: 'control.mat.returnsClassName',
    files: matFiles,
    reference: matNames,
    candidate: (f) => matNames(f).map(() => 'MCOS'),
    expectFail: true,
  },
];

const selected = only ? CASES.filter((c) => c.name.includes(only)) : CASES;
if (selected.length === 0) {
  console.error(`no case matches --only ${only}`);
  process.exit(2);
}

let failures = 0;
for (const spec of selected) {
  if (spec.files.length === 0) {
    console.log(`  [SKIP] ${spec.name}: corpus role empty`);
    continue;
  }
  const result = runCase(spec);
  console.log(formatCase(result));

  if (spec.expectFail) {
    if (result.equal) {
      // A negative control that passes means the comparison is not comparing.
      console.log(`      ^ CONTROL FAILED: expected disagreement, oracle reported none`);
      failures++;
    } else {
      console.log(`      ^ control behaved correctly (disagreement detected)`);
    }
  } else if (!result.equal) {
    failures++;
  }
}

console.log();
if (failures > 0) {
  console.log(`ORACLE FAIL: ${failures} case(s)`);
  process.exit(1);
}
console.log('OK: oracle green, and every negative control went red');
