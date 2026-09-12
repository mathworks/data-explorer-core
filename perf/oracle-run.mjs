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
const { readSlddContent, slddChunkContent, normalizeRefNames, parseMat, scanSldd, scanMat } = core;
// The inflate seam, by a DEEP import: it is not barrel surface, and this harness is
// internal. Needed so an oracle case can pin the engine — see `mat.names.scan.fflate`.
const { setNativeInflate } = await import('../dist/datamodel/parser/Inflate.js');

/** Run `fn` with the inflate engine pinned, then hand detection back. */
function withEngine(engine, fn) {
  return (path) => {
    setNativeInflate(engine);
    try {
      return fn(path);
    } finally {
      setNativeInflate(undefined);
    }
  };
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const only = arg('only');

function readAsArrayBuffer(path) {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// THE REFERENCE. One name per entry, taken straight off the full parse, and NOT filtered:
// `parseEntry` does `getProperty(obj, 'Name') || ''` and pushes the entry regardless, so an
// entry with no readable name still occupies a position in `entries`. Dropping it here
// would have let a candidate that also drops it pass while shifting every later name by
// one against a consumer that indexes positionally — the oracle would have been blind to
// the exact class of bug it exists to catch.
const slddNames = (path) => {
  const content = slddChunkContent(readSlddContent(readAsArrayBuffer(path), []));
  const out = [];
  for (const entry of content?.entries ?? []) {
    out.push(typeof entry?.name === 'string' ? entry.name : '');
  }
  return out;
};

const slddRefs = (path) => {
  const content = slddChunkContent(readSlddContent(readAsArrayBuffer(path), []));
  return content ? normalizeRefNames(content['Dictionary References']) : [];
};

// THE CANDIDATE — the byte scanner, through the public entry point, so what is compared is
// what a consumer would actually call and not some inner function the wiring might bypass.
const scanNames = (path) => scanSldd(readAsArrayBuffer(path), []).names;
const scanRefs = (path) => scanSldd(readAsArrayBuffer(path), []).refs;

// THE MAT REFERENCE, and it is NOT filtered either: `parseMat` pushes an anonymous
// variable with `name: ''` for a matrix truncated before its own array flags, which every
// MCOS file carries one of. Same argument as `slddNames` — a candidate that drops it while
// the reference keeps it shifts every later name by one, positionally.
const matNames = (path) => parseMat(readAsArrayBuffer(path)).variables.map((v) => v.name);

// THE STEP-3 CANDIDATE, through the public entry point for the same reason as `scanNames`.
const matScanNames = (path) => scanMat(readAsArrayBuffer(path)).names;

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
  // ---- the step-2 claim: the scanner IS the full parse, for these two fields --------
  {
    name: 'sldd.names.scan',
    files: slddFiles,
    reference: slddNames,
    candidate: scanNames,
  },
  {
    name: 'sldd.refs.scan',
    files: slddFiles,
    reference: slddRefs,
    candidate: scanRefs,
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
  // ---- the step-3 claim: the scanner IS the full parse, for the name list -----------
  {
    name: 'mat.names.scan',
    files: matFiles,
    reference: matNames,
    candidate: matScanNames,
  },
  {
    // The SAME claim on the engine a browser gets. `scanMat` reads only the head of each
    // compressed record, and the head comes from a different code path per engine —
    // `inflateSync(prefix, {finishFlush: Z_SYNC_FLUSH})` natively, a streaming
    // `Unzlib.push(prefix, false)` under fflate. Two paths, one contract, so both are
    // compared against the same reference rather than against each other.
    name: 'mat.names.scan.fflate',
    files: matFiles,
    reference: matNames,
    candidate: withEngine(null, matScanNames),
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
    // Aimed at the SCANNER rather than the reference, so a `scanNames` that had somehow
    // been wired back to the full parse could not sit in the table looking green.
    name: 'control.sldd.scanDropsLastName',
    files: slddFiles,
    reference: slddNames,
    candidate: (f) => scanNames(f).slice(0, -1),
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
  {
    // Aimed at `scanMat` itself, so a scanner quietly wired back to `parseMat` could not
    // sit in the table looking green.
    name: 'control.mat.scanDropsLastName',
    files: matFiles,
    reference: matNames,
    candidate: (f) => matScanNames(f).slice(0, -1),
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
