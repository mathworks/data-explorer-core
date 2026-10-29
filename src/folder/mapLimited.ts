// src/folder/mapLimited.ts
// Copyright 2026 The MathWorks, Inc.
//
// Bounded-concurrency map, for a host that reads a whole folder.
//
// A folder scan is I/O bound, so reading one file at a time makes opening a folder
// visibly slow; reading them all at once (`Promise.all` over the folder) makes every
// file's bytes coexist, so the peak is the SUM of the folder rather than the size of its
// largest few files. A folder of large dictionaries read that way took a host process to
// ~2 GB in under two seconds and killed it. Bounded concurrency is the middle: the reads
// overlap, and at most `limit` of them are in flight.
//
// Environment-independent — no fs, no timers. The caller supplies the read.

/**
 * How many files a scan reads at once, unless the caller says otherwise.
 *
 * Enough to keep I/O overlapping, few enough that the bytes in flight are bounded by a
 * handful of files rather than by the folder.
 */
export const SCAN_READ_CONCURRENCY = 8;

/**
 * `items.map(fn)` with at most `limit` calls in flight, resolving in INPUT ORDER.
 *
 * Order is part of the contract, not a side effect: a usage graph lists the blocks in a
 * cell in the order their models were summarised, and an order that depended on which
 * read finished first rendered the same cell differently between two opens. So the
 * workers write into a pre-sized array by index — never `push` in completion order.
 *
 * Rejects if any call rejects, rather than resolving a half-filled array; a caller that
 * wants an unreadable file to count as empty catches inside `fn`.
 */
export async function mapLimited<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
  limit: number = SCAN_READ_CONCURRENCY,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  // One shared cursor across all workers, so a worker that finishes early takes the
  // next item rather than waiting on a chunk boundary: one huge file in a fixed-size
  // chunk would otherwise idle the rest of its chunk's slots until it finished.
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) {
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
