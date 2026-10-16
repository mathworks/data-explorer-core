/**
 * The two shapes of inflate this package needs: RAW deflate (zip members carry no
 * wrapper) and ZLIB-wrapped (MAT `miCOMPRESSED` records do).
 */
export interface NativeInflate {
    /**
     * `maxOutputLength` is the size a zip member's directory entry declares for it, passed so
     * that an engine can stop there instead of inflating whatever the bytes expand to. An
     * engine honours it by throwing node:zlib's `ERR_BUFFER_TOO_LARGE` (which is what
     * node:zlib's option of the same name does) or by returning more than that many bytes;
     * either way the member is unreadable (see `unzipEntries`). Optional, for the same reason
     * `zlibHead` is: an engine written before it existed, which ignores it, still works, and
     * pays for a lying member in memory rather than in correctness.
     */
    raw(deflated: Uint8Array, maxOutputLength?: number): Uint8Array;
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
 * node:zlib's options for an inflate held to `maxOutputLength` bytes, which throws
 * `ERR_BUFFER_TOO_LARGE` as soon as its output would pass them: for 200 MB of zeros declared
 * as 1 KB, under 1 ms and 0.05 MB of peak RSS, where the walk used to inflate all 200 MB
 * first and raise the peak by 405 MB (test/inflateBomb.test.ts). At least 1, because
 * node:zlib refuses 0 (`ERR_OUT_OF_RANGE`); a member declaring 0 bytes that inflates to 1
 * is then over by the length check instead.
 *
 * Exported for the Node subpath, which builds the same engine for hosts too old to detect it.
 */
export declare function capOf(maxOutputLength: number | undefined): {
    maxOutputLength: number;
} | undefined;
/** A member `unzipEntries` left out of its result because it could not be read, and why. */
export interface UnreadableMember {
    name: string;
    /** Completes "the member …", e.g. "inflates to more than the 3000 bytes its directory entry declares". */
    reason: string;
}
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
 *
 * A deflated member that inflates to MORE than its directory entry declares is left out of
 * the result, on every engine and every path, and is named in `unreadable` when the caller
 * passes one. It is never returned cut to the declared size, which is what both engines
 * used to do with it: the bytes and the directory disagree about what the member is, and a
 * part cut short reads as a different, wrong part — a model opened with wrong workspace
 * values and nothing to say so. The declared size is also the only bound an inflate has, so
 * it is the cap each engine inflates under, and a member declaring 1 KB of what is 200 MB
 * costs about 1 KB of memory. A caller that passes no list reads the member as absent.
 */
export declare function unzipEntries(bytes: Uint8Array, wanted?: (name: string) => boolean, unreadable?: UnreadableMember[]): Record<string, Uint8Array>;
/** A member of a zip archive as its central directory lists it, without its bytes. */
export interface ZipMemberStamp {
    name: string;
    /** The MS-DOS time and date fields, as stored. */
    dosTime: number;
    dosDate: number;
    /** 0 stored, 8 deflated. */
    method: number;
}
/**
 * Every member of a zip archive, in central-directory order, with the time, date and
 * compression method the directory records for it — what a writer needs to put a package
 * back together the way it was read. Nothing is inflated. Null for an archive this walk
 * does not understand (ZIP64, multi-disk, a truncated directory), which a caller takes as
 * "nothing known".
 */
export declare function zipMemberStamps(bytes: Uint8Array): ZipMemberStamp[] | null;
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