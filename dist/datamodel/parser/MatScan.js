// src/datamodel/parser/MatScan.ts
// Copyright 2026 The MathWorks, Inc.
//
// Reading ONLY the variable NAMES out of a `.mat`, without decoding a single value.
//
// The same trade `SlddScan` makes, on the other format that a usage index reads: two call
// sites want a name list and pay for every element of every matrix to get it. This
// package's `summarizeFiles` builds a `Set` of names and drops the rest; the consumer's
// name index calls `parseMat` and reads `variables[].name`. Over the corpus's `.mat`
// files a full `parseMat` is 1271 ms and this is 4.4 ms — 290x — and the reason the ratio
// is that extreme is not the inflate. It is that a name lives in the first ~100 bytes of
// a record and the values live in the megabytes after it.
//
// WHERE THE TIME ACTUALLY WENT, measured rather than assumed, because it decided the
// design. Of `parseMat`'s 1271 ms, decompression is 6% (76.9 ms with node:zlib over 236
// `miCOMPRESSED` payloads, 8.6 MB of input expanding to 171.4 MB). So the win is mostly
// "do not build the values" and only a little "do not inflate them" — which is why the
// head-inflate is an optimization layered on top (`inflateZlibHead`) rather than the
// point, and why a host with no head mode still gets a ~16x scan by inflating whole
// records and walking their first bytes.
//
// WHAT IT DOES NOT DO. No class, no dimensions, no values, no warnings, and no
// `_rawBytes` — so nothing here can serve a write-back, and nothing here reports a
// truncated file. A caller that needs any of that wants `parseMat`, and the two are not
// alternatives for it.
//
// HOW EQUIVALENCE IS ESTABLISHED. `perf/oracle-run.mjs` compares this against
// `parseMat(...).variables.map(v => v.name)` over every `.mat` in the corpus, name by
// name, in order, and `test/matScan.test.ts` does the same over the repo's fixtures so
// the claim is checked by `npm test` on a machine with no corpus at all. Order is part of
// the contract: the consumer's name index is positional, so a permutation is a real
// difference even when the sets match.
//
// WHERE IT REFUSES. A scan is a bet that the bytes are shaped the way every observed file
// is shaped, and the bet here is worse than usual: a wrong NAME does not look wrong. It
// would put a variable in the index under a name that is not its own, and the usage
// answers built from it would be confidently false. So every doubt throws
// `UnscannableMat` and the single exit at the bottom hands the whole file to `parseMat` —
// slow and certainly right. The refusals are listed at each `throw`; the two worth naming
// here are:
//
//   * ANY record `parseMat` would have to REPAIR to read. A record declaring more bytes
//     than the file holds is read short by `parseMat`, which clamps every length against
//     the buffer, and it still produces a variable with a name. Reproducing a clamp means
//     reproducing a repair, and a scanner that repairs is a second reader.
//   * a name subelement whose type is not `miINT8`/`miUINT8`. `parseMatrix` decodes those
//     bytes as UTF-8 whatever the tag says, so this cannot change a name — it is a check
//     that the walk is at the right OFFSET, which is the failure a name scanner has to be
//     paranoid about.
//
// THE FAILURE THIS MODULE EXISTS TO AVOID, recorded because it is the whole reason step 3
// was its own task: a scanner written from the format's general shape — array flags, then
// dimensions, then the name — returns 'MCOS' for every object in the file. mxOPAQUE
// carries NO dimensions subelement, and what sits where dimensions would be is the class
// name. That was 13 of 31 corpus files wrong, all with the same symptom, and it was fixed
// by reading `parseOpaque` rather than by inferring the layout.
import { inflateZlibHead } from './Inflate.js';
import { parseMat } from './MatParser.js';
/**
 * Thrown when the fast path has met something it was not verified against. Never escapes
 * this module: it means "use the full parser", not "this file is bad".
 */
class UnscannableMat extends Error {
}
const MI_INT8 = 1;
const MI_UINT8 = 2;
const MI_MATRIX = 14;
const MI_COMPRESSED = 15;
const MX_OPAQUE = 17;
/**
 * How many COMPRESSED bytes of a record to hand the inflater.
 *
 * Sized against what is needed, then checked: a name is preceded by at most an 8-byte
 * matrix tag, an 8-to-16-byte array-flags subelement and an 8-to-16-byte dimensions
 * subelement, so ~60 bytes of output covers every variable in the corpus. 512 bytes IN
 * measured 1,886 bytes OUT on real records — a ~3.7x expansion at the head, where the
 * compressor has not yet built a useful dictionary — so this is roughly 30x the margin
 * needed, and costs nothing that matters against records averaging 36 KB compressed.
 *
 * Too small is not a correctness risk, only a speed one: a head that does not reach the
 * name is a refusal, and the file goes to `parseMat`.
 */
const HEAD_INPUT_BYTES = 512;
/** A matrix tag plus an array-flags tag. Less than this cannot name anything. */
const HEAD_MINIMUM_BYTES = 16;
const decoder = new TextDecoder();
function align8(n) {
    return n + ((8 - (n % 8)) % 8);
}
/**
 * One subelement tag, in either of the format's two spellings.
 *
 * The difference from `MatParser`'s `readSubelement`, and it is the important one: that
 * function CLAMPS a declared length to what the view holds, so a truncated subelement
 * still yields a short read. This one records whether it fit and leaves the decision to
 * the caller, which always refuses. Same bytes read, opposite policy — clamping is a
 * repair, and the whole value of this module is that it never repairs anything.
 */
function readTag(view, offset) {
    if (offset + 8 > view.byteLength) {
        return { type: 0, bytes: 0, dataOffset: offset, totalSize: 8, complete: false };
    }
    const tag = view.getUint32(offset, true);
    const hi = (tag >>> 16) & 0xffff;
    const lo = tag & 0xffff;
    if (hi !== 0 && lo !== 0) {
        // Small-element form: the payload lives in the tag's own upper 4 bytes, so it is
        // present by construction — the 8-byte check above already covered it.
        return { type: lo, bytes: Math.min(hi, 4), dataOffset: offset + 4, totalSize: 8, complete: true };
    }
    const declared = view.getUint32(offset + 4, true);
    return {
        type: tag,
        bytes: declared,
        dataOffset: offset + 8,
        totalSize: 8 + align8(declared),
        complete: offset + 8 + declared <= view.byteLength,
    };
}
/**
 * The name of one `miMATRIX` body starting at `base`, mirroring `parseMatrix` and
 * `parseOpaque` subelement for subelement.
 *
 * `view` may be a HEAD — the first however-many bytes of an inflated record — which is
 * why every read is guarded by `complete` rather than by a length known in advance. A
 * subelement that runs past the end of a head is indistinguishable from one that runs
 * past the end of the record, so both refuse.
 */
function nameAt(view, base) {
    let offset = base;
    const flags = readTag(view, offset);
    if (!flags.complete)
        throw new UnscannableMat('array flags subelement is truncated');
    // `parseMatrix` returns a nameless shell for fewer than 2 flag bytes and `parseMat`
    // pushes it as an anonymous variable, so '' is agreement rather than a refusal. Sound
    // on a head too: `complete` says the declared length was read out of bytes we have,
    // and the rest of the record cannot make the file declare a different one.
    if (flags.bytes < 2)
        return '';
    offset += flags.totalSize;
    const arrayClass = view.getUint8(flags.dataOffset) & 0xff;
    // mxOPAQUE lays out array flags -> CLASS NAME, with no dimensions subelement between
    // them. See the header: skipping a dimensions subelement that is not there is what
    // returns 'MCOS' as the variable name.
    if (arrayClass !== MX_OPAQUE) {
        const dims = readTag(view, offset);
        if (!dims.complete)
            throw new UnscannableMat('dimensions subelement is truncated');
        offset += dims.totalSize;
    }
    const name = readTag(view, offset);
    if (!name.complete)
        throw new UnscannableMat('name subelement is truncated');
    if (name.type !== MI_INT8 && name.type !== MI_UINT8) {
        throw new UnscannableMat(`name subelement is type ${name.type}`);
    }
    const text = decoder.decode(new Uint8Array(view.buffer, view.byteOffset + name.dataOffset, name.bytes));
    // `parseOpaque` reads its strings through `readString`, which strips NULs; the numeric
    // path decodes the bytes raw. Two rules, mirrored rather than unified, because the job
    // is to agree with that file and not to improve on it.
    return arrayClass === MX_OPAQUE ? text.replace(/\0/g, '') : text;
}
/**
 * The whole file's names, or `UnscannableMat`.
 *
 * Every refusal is an `UnscannableMat`, INCLUDING the three that `parseMat` turns into a
 * hard error — a short file, a v7.3 file, a big-endian one. Those are refused here in one
 * word and reported by `parseMat` in its own, which is what keeps a message a caller may
 * be matching on ("MAT-file version 7.3 (HDF5) is not supported") spelled in exactly one
 * place. Duplicating it would let the two drift.
 */
function scanNames(bytes) {
    if (bytes.length < 128)
        throw new UnscannableMat('shorter than the 128-byte header');
    const header = decoder.decode(bytes.subarray(0, 116)).trim();
    if (header.startsWith('MATLAB 7.3 MAT-file'))
        throw new UnscannableMat('v7.3 is HDF5');
    // 'IM', the little-endian indicator, byte by byte rather than decoded.
    if (bytes[126] !== 0x49 || bytes[127] !== 0x4d)
        throw new UnscannableMat('not little-endian');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const names = [];
    let offset = 128;
    while (offset < bytes.length) {
        // The file ends INSIDE a record tag. `parseMat` warns and stops with the variables it
        // already has, so stopping with the same list is agreement — the warning is the only
        // thing lost, and this module produces none by design.
        if (offset + 8 > bytes.length)
            break;
        const dataType = view.getUint32(offset, true);
        const numBytes = view.getUint32(offset + 4, true);
        // The format's own end-of-variables marker.
        if (dataType === 0 && numBytes === 0)
            break;
        if (offset + 8 + numBytes > bytes.length) {
            throw new UnscannableMat(`record at byte ${offset} declares more bytes than the file holds`);
        }
        if (dataType === MI_COMPRESSED) {
            let head;
            try {
                head = inflateZlibHead(bytes.subarray(offset + 8, offset + 8 + numBytes), HEAD_INPUT_BYTES);
            }
            catch {
                // `parseMat` warns and reads on, having lost exactly one variable. Refusing
                // instead of skipping is what keeps that warning reaching the caller, and keeps
                // the name list from silently losing an entry every later index depends on.
                throw new UnscannableMat(`compressed record at byte ${offset} would not inflate`);
            }
            if (head.byteLength < HEAD_MINIMUM_BYTES) {
                throw new UnscannableMat(`compressed record at byte ${offset} inflated to a head too short to read`);
            }
            const headView = new DataView(head.buffer, head.byteOffset, head.byteLength);
            // `parseMat` warns and pushes NOTHING for a compressed record holding something
            // other than a matrix, so a skip here would be right and a refusal is merely
            // safe — chosen because no corpus file has one and an untested branch that
            // silently drops a name is not worth owning.
            if (headView.getUint32(0, true) !== MI_MATRIX) {
                throw new UnscannableMat(`compressed record at byte ${offset} does not hold a matrix`);
            }
            names.push(nameAt(headView, 8));
        }
        else if (dataType === MI_MATRIX) {
            names.push(nameAt(view, offset + 8));
        }
        else {
            throw new UnscannableMat(`data element of type ${dataType} at byte ${offset} is not a variable`);
        }
        offset += 8 + numBytes;
    }
    return names;
}
/**
 * The variable names of a `.mat`, in file order.
 *
 * Equivalent to `parseMat(bytes).variables.map(v => v.name)`, and that equivalence is
 * checked over the corpus by `perf/oracle-run.mjs` and over the fixtures by
 * `test/matScan.test.ts` rather than argued for here.
 *
 * Throws whatever `parseMat` throws for a file that is not a readable v5 MAT-file,
 * because on every path it cannot scan it calls `parseMat` and lets it speak. What it
 * does NOT forward is `parseMat`'s `warnings`: a name list has nowhere to put them, and
 * the caller this replaced (`UsageIndex.matSummary`) discarded them too. A caller that
 * wants the diagnostics wants the full parse.
 */
export function scanMat(bytes) {
    try {
        return { names: scanNames(new Uint8Array(bytes)) };
    }
    catch (err) {
        // A non-`UnscannableMat` error is a BUG in the walk above, not a file this module
        // declined, and it is rethrown so it cannot hide as an unexplained slow path. The
        // walk is written so none is reachable: every DataView read is behind a bounds check
        // in `readTag` or behind `complete`.
        if (!(err instanceof UnscannableMat))
            throw err;
    }
    return { names: parseMat(bytes).variables.map((v) => v.name) };
}
//# sourceMappingURL=MatScan.js.map