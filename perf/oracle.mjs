// Copyright 2026 The MathWorks, Inc.
// The equivalence oracle: a fast path is only allowed to exist if it produces
// exactly what the slow path produced.
//
// This is the piece that separates step 2 from step 3 in
// docs/deep-work/2026-09-12-core-perf-plan.md. Both use the same technique -- read
// the bytes directly instead of building a tree -- and the sldd scanner checks
// 31,345/31,345 while the MAT scanner checks 18/31. Without an oracle those two
// look like the same claim.
//
// Everything here is deliberately dumb: exact comparison, no normalization, no
// "close enough". A fast path that needs the comparison loosened is a fast path
// that changes behaviour, and that is a decision for a human, not for this file.

/** How many divergences to record before summarizing. Enough to see a pattern. */
const MAX_REPORTED = 5;

/**
 * Compare two ordered sequences element by element.
 *
 * Order matters: consumers index into these lists (`namesFromSldd` feeds a name
 * index whose entries are positional), so a permutation is a real difference even
 * when the sets are equal. Set-equality is reported separately so a caller can
 * SEE that the only fault was order.
 *
 * @param {unknown[]} expected from the reference implementation
 * @param {unknown[]} actual from the candidate
 * @returns {{equal: boolean, total: number, matched: number, lengthDiffers: boolean,
 *            sameSet: boolean, divergences: {index: number, expected: unknown, actual: unknown}[],
 *            divergenceCount: number}}
 */
export function compareSequences(expected, actual) {
  const total = Math.max(expected.length, actual.length);
  const divergences = [];
  let matched = 0;
  let divergenceCount = 0;

  for (let i = 0; i < total; i++) {
    if (i < expected.length && i < actual.length && Object.is(expected[i], actual[i])) {
      matched++;
      continue;
    }
    divergenceCount++;
    if (divergences.length < MAX_REPORTED) {
      divergences.push({
        index: i,
        expected: i < expected.length ? expected[i] : '<missing>',
        actual: i < actual.length ? actual[i] : '<missing>',
      });
    }
  }

  // Only meaningful for primitives, which is what every current caller compares.
  const sameSet =
    expected.length === actual.length &&
    new Set(expected).size === new Set([...expected, ...actual]).size;

  return {
    equal: divergenceCount === 0,
    total,
    matched,
    lengthDiffers: expected.length !== actual.length,
    sameSet,
    divergences,
    divergenceCount,
  };
}

/**
 * Compare two byte sequences. Used by step 1, where the requirement is not
 * "equivalent" but literally byte-identical inflate output.
 */
export function compareBytes(expected, actual) {
  const a = expected instanceof Uint8Array ? expected : new Uint8Array(expected);
  const b = actual instanceof Uint8Array ? actual : new Uint8Array(actual);
  if (a.byteLength !== b.byteLength) {
    return {
      equal: false,
      total: Math.max(a.byteLength, b.byteLength),
      matched: 0,
      lengthDiffers: true,
      firstDiff: Math.min(a.byteLength, b.byteLength),
      reason: `length ${a.byteLength} vs ${b.byteLength}`,
    };
  }
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) {
      return {
        equal: false,
        total: a.byteLength,
        matched: i,
        lengthDiffers: false,
        firstDiff: i,
        reason: `byte ${i}: 0x${a[i].toString(16)} vs 0x${b[i].toString(16)}`,
      };
    }
  }
  return { equal: true, total: a.byteLength, matched: a.byteLength, lengthDiffers: false, firstDiff: -1, reason: '' };
}

/**
 * Run one oracle case over a set of files.
 *
 * A file the reference itself cannot read is NOT a failure -- 9 of 40 `.mat`
 * fixtures are v7.3, where `parseMat` throws today and contributes zero names.
 * Those are counted as `skipped` so they cannot inflate a pass rate.
 *
 * @param {{name: string, files: string[], reference: (f: string) => unknown[],
 *          candidate: (f: string) => unknown[], compare?: Function}} spec
 */
export function runCase(spec) {
  const compare = spec.compare ?? compareSequences;
  const perFile = [];
  let filesEqual = 0;
  let filesDiffer = 0;
  let skipped = 0;
  let elementsTotal = 0;
  let elementsMatched = 0;

  for (const file of spec.files) {
    let expected;
    try {
      expected = spec.reference(file);
    } catch (err) {
      skipped++;
      perFile.push({ file, status: 'skipped', reason: `reference threw: ${messageOf(err)}` });
      continue;
    }

    let actual;
    try {
      actual = spec.candidate(file);
    } catch (err) {
      // The CANDIDATE throwing is a real failure -- the reference managed it.
      filesDiffer++;
      perFile.push({ file, status: 'threw', reason: `candidate threw: ${messageOf(err)}` });
      continue;
    }

    const result = compare(expected, actual);
    elementsTotal += result.total;
    elementsMatched += result.matched;
    if (result.equal) {
      filesEqual++;
      perFile.push({ file, status: 'equal', total: result.total });
    } else {
      filesDiffer++;
      perFile.push({ file, status: 'differs', ...result });
    }
  }

  return {
    name: spec.name,
    equal: filesDiffer === 0,
    filesEqual,
    filesDiffer,
    skipped,
    filesConsidered: filesEqual + filesDiffer,
    elementsTotal,
    elementsMatched,
    perFile,
  };
}

function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}

/** Format one case result for a terminal. */
export function formatCase(result) {
  const lines = [];
  const verdict = result.equal ? 'PASS' : 'FAIL';
  lines.push(
    `  [${verdict}] ${result.name}: ${result.filesEqual}/${result.filesConsidered} files identical, ` +
      `${result.elementsMatched}/${result.elementsTotal} elements` +
      (result.skipped > 0 ? `, ${result.skipped} skipped (reference could not read)` : ''),
  );
  for (const f of result.perFile) {
    if (f.status === 'equal' || f.status === 'skipped') continue;
    const short = f.file.split('/').pop();
    if (f.status === 'threw') {
      lines.push(`      ${short}: ${f.reason}`);
      continue;
    }
    lines.push(
      `      ${short}: ${f.matched}/${f.total} matched` +
        (f.lengthDiffers ? ' (LENGTH differs)' : '') +
        (f.sameSet ? ' (same set, wrong ORDER)' : ''),
    );
    for (const d of f.divergences ?? []) {
      lines.push(`        #${d.index} expected ${JSON.stringify(d.expected)} got ${JSON.stringify(d.actual)}`);
    }
    if (f.divergenceCount > (f.divergences?.length ?? 0)) {
      lines.push(`        ... ${f.divergenceCount - f.divergences.length} more`);
    }
  }
  return lines.join('\n');
}
