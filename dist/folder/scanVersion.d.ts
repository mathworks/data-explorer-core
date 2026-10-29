/**
 * The largest file any workspace-wide scan will read.
 *
 * V8's maximum string length (`0x1fffffe8`) — the point past which a textual dictionary
 * cannot be decoded, so scanning it cannot succeed no matter what the scan does with the
 * bytes. A host checks a file's size against this from its `stat`, BEFORE reading:
 * checking after the read is checking after the cost.
 */
export declare const MAX_SCAN_BYTES = 536870888;
/**
 * What VERSION of a file a scan would read, or `null` for one it would not read at all
 * (larger than `MAX_SCAN_BYTES`) — decided from the file's `stat` alone.
 *
 * `mtime` and `size` are whatever the host's `stat` reports (milliseconds and bytes in
 * every host so far); the token is `${mtime}:${size}`, and that exact spelling is part of
 * the contract, since a host's caches compare tokens as strings.
 *
 * `mtime:size` rather than a content hash because hashing means reading, and reading is
 * the thing a cache keyed on this exists to avoid. Such a cache is self-healing, which is
 * worth more here than precision: a file whose mtime moved is re-read even if a watcher
 * event was missed entirely. It is not COMPLETE, though: a write that preserves both mtime
 * and size is invisible to this token, so a host whose file watcher reports such a write
 * has to drop its cached copy on the event rather than on the token.
 *
 * A host whose `stat` FAILED has no version to ask about; it should treat the file as
 * unreadable (`null`, the same as oversized), not call this with a made-up stat.
 */
export declare function scanVersionOf(stat: {
    mtime: number;
    size: number;
}): string | null;
//# sourceMappingURL=scanVersion.d.ts.map