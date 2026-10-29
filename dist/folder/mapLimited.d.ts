/**
 * How many files a scan reads at once, unless the caller says otherwise.
 *
 * Enough to keep I/O overlapping, few enough that the bytes in flight are bounded by a
 * handful of files rather than by the folder.
 */
export declare const SCAN_READ_CONCURRENCY = 8;
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
export declare function mapLimited<T, R>(items: readonly T[], fn: (item: T) => Promise<R>, limit?: number): Promise<R[]>;
//# sourceMappingURL=mapLimited.d.ts.map