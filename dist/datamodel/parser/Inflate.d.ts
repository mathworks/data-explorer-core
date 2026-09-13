/**
 * The two shapes of inflate this package needs: RAW deflate (zip members carry no
 * wrapper) and ZLIB-wrapped (MAT `miCOMPRESSED` records do).
 */
export interface NativeInflate {
    raw(deflated: Uint8Array): Uint8Array;
    zlib(wrapped: Uint8Array): Uint8Array;
    /**
     * Inflate as much as a PREFIX of a zlib stream allows, treating the missing tail as
     * the end of the input rather than as corruption.
     *
     * Optional, and the reason it is optional is that an engine is INJECTED by
     * `src/node/index.ts` and by tests: one written before this method existed must keep
     * working. Where it is absent `inflateZlibHead` inflates the whole stream instead —
     * slower, never wrong.
     */
    zlibHead?(prefix: Uint8Array): Uint8Array;
}
/**
 * Force the inflate engine, or pass `null` to force the fflate fallback, or
 * `undefined` to return to automatic detection.
 *
 * The Node subpath calls this so that older Node versions — where
 * `process.getBuiltinModule` does not exist but `node:zlib` obviously does — still
 * get the fast path.
 */
export declare function setNativeInflate(impl: NativeInflate | null | undefined): void;
/** Which engine is live. Exported for diagnostics and for the perf harness. */
export declare function nativeInflateAvailable(): boolean;
/**
 * Every entry of a zip archive, by name, exactly as `fflate.unzipSync` returns them —
 * including zero-length entries for directory members, which fflate emits and which
 * an archive written by another tool may well contain.
 *
 * Falls back to fflate for anything the walk does not handle, and for anything that
 * looks wrong. Falling back on a malformed archive is deliberate: fflate then raises
 * the SAME diagnostic this package raised before, so error messages callers already
 * match on do not shift under them.
 *
 * `wanted`, when given, names the members the caller will actually read, and the rest are
 * never materialized. What that buys over filtering the RESULT map is mostly memory, and
 * the honest numbers are worth writing down because the time saving is the smaller half:
 * reading the five structural members of `.slx` models (`ModelStructureScan`) materializes
 * 1.80 MB against 44.85 MB over a 127-model corpus, and 1.4 KB against 13.2 MB on the one
 * 13 MB model in it. In wall clock that is 18x on that model and only 1.3x over the whole
 * sweep — because Simulink STORES most parts (that corpus: 3061 stored members against
 * 1817 deflated) and copying a stored member is cheap next to inflating one.
 *
 * So: pass a filter to avoid holding 25x the bytes, not because the read is slow.
 */
export declare function unzipEntries(bytes: Uint8Array, wanted?: (name: string) => boolean): Record<string, Uint8Array>;
/**
 * Inflate a zlib-wrapped stream — the framing MAT v5 `miCOMPRESSED` records use.
 *
 * On a fflate failure this rethrows unchanged; on a NATIVE failure it retries with
 * fflate before giving up, so a stream the old engine could read does not start
 * failing because the new one is stricter about trailing bytes.
 */
export declare function inflateZlib(wrapped: Uint8Array): Uint8Array;
/**
 * The BEGINNING of a zlib-wrapped stream, inflated from no more than `maxInputBytes` of
 * its compressed bytes.
 *
 * For `MatScan`, which needs the first ~100 bytes of each `miCOMPRESSED` record — an
 * array-flags subelement, a dimensions subelement and a name — out of records that
 * inflate to megabytes. Over the corpus's 236 payloads that is 8.6 MB of input expanding
 * to 171.4 MB when inflated whole, against 512 bytes per record here.
 *
 * WHAT THE CALLER GETS, and it is deliberately weak: *at least* something, or a throw.
 * The length is whatever the engine chose to emit, NOT `maxInputBytes` worth and not a
 * fixed size — deflate's block structure decides it, and a stream may also simply end
 * inside the prefix, in which case this is the whole thing. So a caller must treat a
 * short result as "ask for more or give up" and never as "the record is truncated". It
 * may also be LONGER than the prefix implies in the other direction: 512 compressed
 * bytes of MAT record measured 1,886 bytes out.
 *
 * Falls back to inflating the whole stream — never to failing — when the engine has no
 * head mode, when the head mode throws, or when the fflate path produces nothing. That
 * fallback is what lets `MatScan` treat this as an optimization rather than a second
 * format reader with its own failure modes.
 */
export declare function inflateZlibHead(wrapped: Uint8Array, maxInputBytes: number): Uint8Array;
//# sourceMappingURL=Inflate.d.ts.map