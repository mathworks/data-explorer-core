// src/folder/scanVersion.ts
// Copyright 2026 The MathWorks, Inc.
//
// How a WORKSPACE-WIDE SCAN decides which files to read, and which version of each it
// read — the half of that policy that needs no filesystem.
//
// A scan over a folder was not asked for by name: opening the folder starts it, over
// whatever files happen to be there. A tab is the opposite — the user named one file and
// is waiting for it — so a tab reads whole files and a scan must not. The cap below is not
// a heuristic about what is "too big to bother with": a textual `.sldd` above V8's maximum
// string length cannot be turned into a string at all, so no scan can read one byte of
// meaning out of it however long it waits. A file above the cap is still a file a host
// lists and opens; a scan just reads nothing from it.
//
// The `stat` and the read stay with the host, which owns the filesystem. What is here is
// the rule a host's cache keys on, so that two hosts (or two caches in one) that agree on
// a file's `stat` agree on its version.
/**
 * The largest file any workspace-wide scan will read.
 *
 * V8's maximum string length (`0x1fffffe8`) — the point past which a textual dictionary
 * cannot be decoded, so scanning it cannot succeed no matter what the scan does with the
 * bytes. A host checks a file's size against this from its `stat`, BEFORE reading:
 * checking after the read is checking after the cost.
 */
export const MAX_SCAN_BYTES = 0x1fffffe8;
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
export function scanVersionOf(stat) {
    if (stat.size > MAX_SCAN_BYTES)
        return null;
    return `${stat.mtime}:${stat.size}`;
}
//# sourceMappingURL=scanVersion.js.map