/**
 * The two shapes of inflate this package needs: RAW deflate (zip members carry no
 * wrapper) and ZLIB-wrapped (MAT `miCOMPRESSED` records do).
 */
export interface NativeInflate {
    raw(deflated: Uint8Array): Uint8Array;
    zlib(wrapped: Uint8Array): Uint8Array;
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
 */
export declare function unzipEntries(bytes: Uint8Array): Record<string, Uint8Array>;
/**
 * Inflate a zlib-wrapped stream — the framing MAT v5 `miCOMPRESSED` records use.
 *
 * On a fflate failure this rethrows unchanged; on a NATIVE failure it retries with
 * fflate before giving up, so a stream the old engine could read does not start
 * failing because the new one is stricter about trailing bytes.
 */
export declare function inflateZlib(wrapped: Uint8Array): Uint8Array;
//# sourceMappingURL=Inflate.d.ts.map