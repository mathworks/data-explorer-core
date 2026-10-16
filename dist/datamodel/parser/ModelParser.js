// Copyright 2026 The MathWorks, Inc.
import { parseSlx } from './SlxParser.js';
import { parseMdl } from './MdlParser.js';
// The two ways a zip begins. One holding anything begins with its first entry's
// local-file header, `PK\x03\x04`. One holding nothing has no entry to begin with, so it
// is only its end-of-central-directory record, `PK\x05\x06`: 22 bytes, then the archive
// comment if there is one.
const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EMPTY_ARCHIVE = [0x50, 0x4b, 0x05, 0x06];
const END_RECORD_LENGTH = 22;
// The record's two entry counts, uint16 little-endian: on this disk (8) and in all (10).
const END_RECORD_COUNTS = [8, 9, 10, 11];
/**
 * Is this a ZIP OPC package — i.e. a `.slx` rather than either `.mdl` spelling?
 *
 * Exported so that the structural scanner dispatches on the SAME test this file does.
 * Two copies of the magic bytes is two places for the answer to drift, and a scanner
 * that disagreed with `parseModel` about the format would route a file to a reader it
 * is not for.
 *
 * A zip with no entries is a package too. It holds no Simulink part, so it opens as a
 * model whose sections are all empty, as a zip holding only files that are not model
 * parts already did (the maintainer's ruling of 2026-10-16 on C-223). Tested on the
 * local header alone, it failed this sniff, reached the classic `.mdl` reader as text,
 * and was refused there as "Not a Simulink model".
 *
 * Only a whole record that counts no entries is one, though. The signature alone is not:
 * both zip readers (Inflate's walk and fflate's) search back from the end for it, find it
 * at offset 0 in such bytes, and read whatever follows as its counts and offsets, so any
 * bytes that began `PK\x05\x06` opened as an empty model, where they had been refused as
 * not a model. Its comment length (offset 20) is not checked, since neither reader
 * checks it.
 */
export function isZipPackage(bytes) {
    const begins = (magic) => magic.every((byte, i) => bytes[i] === byte);
    if (begins(ZIP_LOCAL_HEADER)) {
        return true;
    }
    return (begins(ZIP_EMPTY_ARCHIVE) && bytes.length >= END_RECORD_LENGTH && END_RECORD_COUNTS.every((i) => bytes[i] === 0));
}
/**
 * Open a Simulink model, whichever of its on-disk forms it is in.
 *
 * A `.slx` is a ZIP OPC package; a `.mdl` is the same package written as text, or
 * the classic pre-R2012 brace format. All three produce the same ParsedSlx.
 *
 * The BYTES decide, not the extension. Both extensions are in daily use for both
 * generations of content — `save_system` to `<name>.slx` beside a `<name>.mdl` is an
 * in-place format upgrade, models get renamed by hand, and a mislabelled file should
 * open rather than fail with "invalid zip data" from a parser it was never for. The
 * same reasoning already routes a textual vs. binary `.sldd` in `ingest`.
 */
export function parseModel(buffer, filename) {
    return isZipPackage(new Uint8Array(buffer)) ? parseSlx(buffer, filename) : parseMdl(buffer, filename);
}
//# sourceMappingURL=ModelParser.js.map