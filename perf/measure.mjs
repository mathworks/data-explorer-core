// Copyright 2026 The MathWorks, Inc.
// Timing and memory primitives for the performance harness.
//
// Three lessons from the probes that produced the plan are enforced here rather than
// left to each caller to remember:
//
//  1. A retained-memory number measured WITHOUT a collection first is garbage. The
//     same operation read 68.9 MB and 118.4 MB in two probe runs for exactly that
//     reason. So memory is reported only when --expose-gc is available.
//  2. `heapUsed` ALONE IS MISLEADING for byte-oriented work, which is what steps 1-3
//     of the plan are. A 71 MB string decoded out of a zip member moves heapUsed by
//     0.0 MB, because V8 keeps large strings and every ArrayBuffer off the JS heap.
//     Reporting heapUsed only would credit a scanner with saving nothing.
//  3. Timing and memory must be measured in SEPARATE passes. Reading memory during
//     the fastest timing sample makes the figure depend on which sample happened to
//     win, and the same scenario then reports 28.8 MB and 0.1 MB across two runs.
//
// Report best-of-N for time, not the mean: we are measuring a floor -- the cost of
// the work itself -- and the mean folds in whatever else the machine was doing.

import { performance } from 'node:perf_hooks';
import { cpus, totalmem } from 'node:os';

const gc = globalThis.gc ?? null;
export const gcAvailable = gc !== null;

// Liveness anchor for retained-memory measurement. Assigning a scenario's graph here
// AFTER the reading is what makes it live DURING the reading: V8 keeps a value alive
// until its last use, so a later store extends that range backwards over the reading.
let sink = null;

const MB = 1048576;

/** Collect, if we were started with --expose-gc. Called before every sample. */
function collect() {
  if (gc) {
    gc();
    gc(); // twice: the first pass can leave objects whose finalizers free more
  }
}

/** A scenario opting into retained-memory measurement returns exactly this shape. */
function isProbeShape(v) {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.hasOwn(v, 'probe') &&
    Object.hasOwn(v, 'retain')
  );
}

/**
 * Measure one scenario.
 *
 * A scenario returns either a plain probe value, or `{probe, retain}` when it wants
 * retained memory measured. Anything not handed back through `retain` has already
 * been collected by the time memory is read, so it reads as ~0.
 *
 * @param {() => unknown} fn work to measure
 * @param {{samples?: number, warmup?: number}} [opts]
 */
export function measure(fn, opts = {}) {
  const samples = opts.samples ?? 3;
  const warmup = opts.warmup ?? 0;

  for (let i = 0; i < warmup; i++) fn();

  // ---- pass A: time only, nothing retained ------------------------------------
  let bestMs = Infinity;
  let probe;
  for (let i = 0; i < samples; i++) {
    collect();
    const t0 = performance.now();
    const out = fn();
    const ms = performance.now() - t0;
    probe = isProbeShape(out) ? out.probe : out;
    if (ms < bestMs) bestMs = ms;
  }

  // ---- pass B: memory only, one dedicated run ----------------------------------
  let heapMB = null;
  let offHeapMB = null;
  let retained = false;
  if (gcAvailable) {
    collect();
    const m0 = process.memoryUsage();
    const out = fn();
    let hold = isProbeShape(out) ? out.retain : null;
    retained = isProbeShape(out);
    collect();
    const m1 = process.memoryUsage();
    heapMB = (m1.heapUsed - m0.heapUsed) / MB;
    offHeapMB = (m1.external - m0.external + (m1.arrayBuffers - m0.arrayBuffers)) / MB;
    // Keeps `hold` live across the reading above -- see the note on `sink`.
    sink = hold;
    hold = null;
    sink = null;
  }

  return {
    ms: bestMs,
    heapMB,
    offHeapMB,
    samples,
    probe: describeProbe(probe),
    retained,
  };
}

// A short, STABLE description of what the scenario produced. This is the
// correctness canary inside the timing harness: a change that makes something fast
// by making it wrong shows up as a changed probe, even though the oracle is what
// really checks equivalence.
function describeProbe(v) {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return v.length > 60 ? `${v.slice(0, 57)}...` : v;
  if (Array.isArray(v)) return `array(${v.length})`;
  if (v instanceof Map) return `map(${v.size})`;
  if (v instanceof Set) return `set(${v.size})`;
  if (typeof v === 'object') return `object(${Object.keys(v).length} keys)`;
  return typeof v;
}

/** Machine and runtime facts a comparison must check before trusting a diff. */
export function environment() {
  const cpu = cpus();
  return {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cpu: cpu[0]?.model ?? 'unknown',
    cpuCount: cpu.length,
    totalMemGB: Math.round(totalmem() / (1024 * MB)),
    gcExposed: gcAvailable,
  };
}
