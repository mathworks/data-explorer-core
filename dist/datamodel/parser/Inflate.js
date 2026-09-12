// src/datamodel/parser/Inflate.ts
// Copyright 2026 The MathWorks, Inc.
//
// The inflate seam. Every decompression in this package goes through here, so the
// engine behind it can be chosen at RUNTIME instead of at import time.
//
// Why this exists at all: fflate's cost is its inflate, not its zip framing. Measured
// on a 2.6 MB dictionary whose `data/chunk0.xml` inflates to 71.3 MB:
//
//   fflate unzipSync, whole archive   105.4 ms
//   fflate inflateSync, member only   103.1 ms   <- so the framing is ~2 ms
//   node:zlib inflateRawSync           20.9 ms   <- 4.9x, byte-identical
//
// and on the MAT side (236 miCOMPRESSED payloads, 8.6 MB -> 171.4 MB), fflate's
// unzlibSync is 260.6 ms against node:zlib's 76.9 ms, which is 18% of `parseMat`
// over the whole corpus. Those two facts are the whole reason for this file.
//
// WHY NOT JUST `import { inflateRawSync } from 'node:zlib'`:
//
// This package's main barrel must stay environment-neutral. The VS Code extension
// that consumes it imports ONLY the barrel — never the `./node` subpath — and it
// declares a `browser` entry point, so the very same host modules that call
// `parseMat` and `parseModel` are also bundled for the web. A static `node:` import
// anywhere reachable from the barrel breaks that bundle.
//
// So the native engine is discovered through `process.getBuiltinModule`, which is
// synchronous (our parsers are all synchronous, so `await import()` is not available
// to us) and invisible to bundlers, because it is a property lookup rather than an
// import. Where it is missing — a browser, or Node before 22.3 — detection returns
// null and every path below falls back to fflate. The fallback is not a degraded
// mode with different behaviour: it is exactly what this package did before.
//
// Equality is the load-bearing claim, and it is checked rather than asserted: over
// the whole corpus the two engines produce byte-identical output for all 32 zipped
// dictionaries, every `.slx`, and all 236 MAT payloads.
import { Unzlib, unzipSync, unzlibSync } from 'fflate';
// `undefined` means "no override, use detection"; `null` means "explicitly disabled".
// Tests need the disabled state to exercise the fallback on a machine where the
// native engine is present, which is otherwise unreachable.
let override;
let detected;
/**
 * Force the inflate engine, or pass `null` to force the fflate fallback, or
 * `undefined` to return to automatic detection.
 *
 * The Node subpath calls this so that older Node versions — where
 * `process.getBuiltinModule` does not exist but `node:zlib` obviously does — still
 * get the fast path.
 */
export function setNativeInflate(impl) {
    override = impl;
}
/** Which engine is live. Exported for diagnostics and for the perf harness. */
export function nativeInflateAvailable() {
    return activeNative() !== null;
}
function activeNative() {
    if (override !== undefined)
        return override;
    if (detected === undefined)
        detected = detectNative();
    return detected;
}
function detectNative() {
    // Read `process` off globalThis rather than referencing the global directly: in a
    // browser bundle there may be no `process` at all, and in one that shims it there
    // may be a `process` object without this method.
    const proc = globalThis.process;
    const getBuiltinModule = proc?.getBuiltinModule;
    if (typeof getBuiltinModule !== 'function')
        return null;
    let mod;
    try {
        mod = getBuiltinModule.call(proc, 'node:zlib');
    }
    catch {
        // A runtime that has the method but refuses the module (a sandbox, a polyfill)
        // is not an error condition — it just means the fallback.
        return null;
    }
    const zlib = mod;
    if (typeof zlib?.inflateRawSync !== 'function' || typeof zlib?.inflateSync !== 'function') {
        return null;
    }
    const inflateSync = zlib.inflateSync;
    // `Z_SYNC_FLUSH` as the FINISH flush is what makes a truncated input an end rather
    // than an error: zlib's default is Z_FINISH, which demands the stream's own
    // end-of-data marker and throws `unexpected end of file` without it. Read off
    // `constants` rather than hard-coded as 2, and omitted where it is missing, because
    // a polyfilled `node:zlib` may have the functions and not the table.
    const syncFlush = zlib.constants?.Z_SYNC_FLUSH;
    // Returned unwrapped: `ownExactBuffer` is applied at the seam below, so it holds for
    // an INJECTED engine too and not only for this one.
    return {
        raw: zlib.inflateRawSync,
        zlib: inflateSync,
        zlibHead: typeof syncFlush === 'number'
            ? (prefix) => inflateSync(prefix, { finishFlush: syncFlush })
            : undefined,
    };
}
/**
 * Reproduce fflate's contract: every result is a plain `Uint8Array` whose
 * `ArrayBuffer` is exactly the result and nothing more.
 *
 * This is not tidiness. `node:zlib` returns a `Buffer`, and for small payloads that
 * Buffer is a window into a shared 16 KB pool — `byteLength 2` inside a
 * `buffer.byteLength 16384`. Several callers reach straight through to the
 * ArrayBuffer (`parseMxArray(part.buffer)` in SlxParser, `readMxArrayRecords` in
 * MdlParser), and handed a pooled buffer they would read whatever else was in the
 * pool as trailing records. fflate always allocated per entry, so nothing downstream
 * was ever written to expect otherwise, and the bug would appear only on SMALL
 * parts — the ones least likely to be noticed.
 */
function ownExactBuffer(b) {
    if (b.byteOffset === 0 && b.buffer.byteLength === b.byteLength) {
        // Already exact; just drop the Buffer wrapper, which has a different `toString`
        // and would otherwise leak Node semantics into consumers. Zero-copy.
        return b.constructor === Uint8Array ? b : new Uint8Array(b.buffer, 0, b.byteLength);
    }
    return new Uint8Array(b); // copies into an exactly sized buffer
}
// ---------------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------------
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
/**
 * Thrown internally when the archive uses something the fast walk does not implement.
 * Never escapes this module: it means "hand this to fflate", not "this file is bad".
 */
class UnsupportedArchive extends Error {
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
 */
export function unzipEntries(bytes) {
    const native = activeNative();
    // With no native engine the walk would only be fflate's inflate wearing a hat, and
    // the framing it would save is ~2 ms of 105 ms. Not worth a second code path.
    if (native === null)
        return unzipSync(bytes);
    try {
        return walkCentralDirectory(bytes, native);
    }
    catch {
        // Everything falls back, whether it was an `UnsupportedArchive` we recognised or
        // an inflate that threw: a misread on our side must not become a hard failure when
        // the engine that shipped for years can still read the file. And if fflate cannot
        // read it either, ITS throw is the one the caller sees — which is how the existing
        // diagnostics for a corrupt archive stay exactly as they were.
        return unzipSync(bytes);
    }
}
function walkCentralDirectory(bytes, native) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = findEndOfCentralDirectory(view);
    // ZIP64 moves the real counts and offsets into a different record and widens them
    // to 64 bits. Rather than implement a second addressing mode for archives that do
    // not occur in any corpus we have, refuse and let fflate handle it.
    if (eocd >= 20 && view.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR) {
        throw new UnsupportedArchive('zip64');
    }
    // Multi-disk archives address members on other volumes; there is nothing to read.
    if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) {
        throw new UnsupportedArchive('multi-disk');
    }
    const count = view.getUint16(eocd + 10, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    // 0xFFFF / 0xFFFFFFFF are the ZIP64 "look elsewhere" sentinels.
    if (count === 0xffff || centralOffset === 0xffffffff)
        throw new UnsupportedArchive('zip64 sentinel');
    const out = {};
    let p = centralOffset;
    for (let i = 0; i < count; i++) {
        if (p + 46 > view.byteLength)
            throw new UnsupportedArchive('central directory truncated');
        if (view.getUint32(p, true) !== SIG_CENTRAL)
            throw new UnsupportedArchive('central directory signature');
        const flags = view.getUint16(p + 8, true);
        const method = view.getUint16(p + 10, true);
        // Sizes are read from the CENTRAL DIRECTORY, which is authoritative even when the
        // local header defers them to a trailing data descriptor (general-purpose flag
        // bit 3). That is why bit 3 needs no special case here — the streaming writers
        // that set it still record the real sizes in the directory.
        const compressedSize = view.getUint32(p + 20, true);
        const uncompressedSize = view.getUint32(p + 24, true);
        const nameLength = view.getUint16(p + 28, true);
        const extraLength = view.getUint16(p + 30, true);
        const commentLength = view.getUint16(p + 32, true);
        const localOffset = view.getUint32(p + 42, true);
        if (flags & 0x01)
            throw new UnsupportedArchive('encrypted entry');
        if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
            throw new UnsupportedArchive('zip64 entry size');
        }
        // Bit 11 declares the name is UTF-8. Everything this package reads is written by
        // MathWorks tooling with ASCII part names, and UTF-8 decodes ASCII identically,
        // so one decoder covers both rather than pulling in a CP437 table for a case
        // that would be a guess anyway.
        const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLength));
        if (view.getUint32(localOffset, true) !== SIG_LOCAL) {
            throw new UnsupportedArchive('local header signature');
        }
        // The local header's own name and extra lengths, NOT the directory's: the two
        // extra fields routinely differ in length for the same member.
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const dataAt = localOffset + 30 + localNameLength + localExtraLength;
        if (dataAt + compressedSize > view.byteLength)
            throw new UnsupportedArchive('entry data truncated');
        const raw = bytes.subarray(dataAt, dataAt + compressedSize);
        if (method === 0) {
            // Stored. `.slice()` and not the subarray, because the entry must own its
            // buffer — see `ownExactBuffer`. Simulink writes most `.slx` parts this way:
            // one 13.8 MB model measured 347 stored members against 29 deflated.
            out[name] = raw.slice();
        }
        else if (method === 8) {
            const inflated = ownExactBuffer(native.raw(raw));
            // A length disagreement means the walk misread an offset. Better to hand the
            // whole archive to fflate than to return bytes that are confidently wrong.
            if (inflated.byteLength !== uncompressedSize) {
                throw new UnsupportedArchive('inflated size disagrees with the directory');
            }
            out[name] = inflated;
        }
        else {
            throw new UnsupportedArchive(`compression method ${method}`);
        }
        p += 46 + nameLength + extraLength + commentLength;
    }
    return out;
}
function findEndOfCentralDirectory(view) {
    // The record is at the very end unless there is an archive comment, which may be
    // up to 65535 bytes; 22 is the record's own size. Scanning further back than that
    // window risks matching the signature inside compressed data.
    const limit = Math.max(0, view.byteLength - 65557);
    for (let i = view.byteLength - 22; i >= limit; i--) {
        if (view.getUint32(i, true) === SIG_EOCD)
            return i;
    }
    throw new UnsupportedArchive('no end-of-central-directory record');
}
const utf8 = new TextDecoder();
// ---------------------------------------------------------------------------------
// ZLIB-wrapped streams (MAT miCOMPRESSED)
// ---------------------------------------------------------------------------------
/**
 * Inflate a zlib-wrapped stream — the framing MAT v5 `miCOMPRESSED` records use.
 *
 * On a fflate failure this rethrows unchanged; on a NATIVE failure it retries with
 * fflate before giving up, so a stream the old engine could read does not start
 * failing because the new one is stricter about trailing bytes.
 */
export function inflateZlib(wrapped) {
    const native = activeNative();
    if (native === null)
        return unzlibSync(wrapped);
    try {
        return ownExactBuffer(native.zlib(wrapped));
    }
    catch {
        return unzlibSync(wrapped);
    }
}
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
export function inflateZlibHead(wrapped, maxInputBytes) {
    const prefix = wrapped.byteLength <= maxInputBytes ? wrapped : wrapped.subarray(0, maxInputBytes);
    const native = activeNative();
    if (native !== null) {
        if (native.zlibHead === undefined)
            return inflateZlib(wrapped);
        try {
            return ownExactBuffer(native.zlibHead(prefix));
        }
        catch {
            return inflateZlib(wrapped);
        }
    }
    return fflateHead(prefix) ?? unzlibSync(wrapped);
}
/**
 * fflate's answer to the same question, which only its STREAMING decompressor can give.
 *
 * Both one-shot spellings were tried and neither works: `unzlibSync(prefix)` throws
 * `unexpected EOF` on a truncated stream, and `unzlibSync(whole, { out })` with a
 * bounded output buffer throws `offset is out of bounds` when the stream outgrows it.
 * `Unzlib.push(prefix, false)` says "more may follow", which is exactly the claim a
 * prefix makes, so it emits what it has and does not object to the rest being absent.
 *
 * Returns null rather than throwing, because every failure here has the same answer —
 * inflate the whole stream — and null is the shape that says so once.
 */
function fflateHead(prefix) {
    const chunks = [];
    let total = 0;
    try {
        const stream = new Unzlib((chunk) => {
            // COPIED, not kept: fflate hands out views into a buffer it goes on to reuse and
            // resize, so a retained subarray can change under the caller. `ownExactBuffer`
            // cannot help here — the aliasing is fflate's, not the wrapper's.
            const owned = chunk.slice();
            chunks.push(owned);
            total += owned.byteLength;
        });
        stream.push(prefix, false);
    }
    catch {
        return null;
    }
    if (total === 0)
        return null;
    if (chunks.length === 1)
        return chunks[0];
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.byteLength;
    }
    return out;
}
//# sourceMappingURL=Inflate.js.map