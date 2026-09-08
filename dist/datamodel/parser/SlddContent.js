// src/datamodel/parser/SlddContent.ts
// Copyright 2026 The MathWorks, Inc.
//
// Reading a `.sldd`: which of the two on-disk formats it is, where the entries and the
// reference list sit inside the result, and what a reference means.
//
// A dictionary is either a zip (compressed-binary) or JSON text, and BOTH deserialize to
// the same in-memory shape — `__MW_TEXT_PARTS__` → `__MW_TEXT_PART__/data/chunk0` →
// `__MW_TEXT_content` — which is what lets every reader downstream be format-agnostic
// once it holds the object. Three separate readers were each doing that dispatch and that
// unwrap for themselves (ingest, SlddNode, and the usage graph in the consuming
// extension), which is three chances to gate on the FILENAME instead of the bytes and
// read a compressed dictionary as JSON, yielding a file that opens with no entries at all.
//
// So both steps live here, and so does the reference-list normalisation, which is the one
// that had actually drifted — see `normalizeRefNames`.
import { strFromU8 } from 'fflate';
import { parseBinarySldd } from './BinarySlddParser.js';
/**
 * True when these bytes open a JSON object, ignoring a leading UTF-8 BOM and any leading
 * whitespace. A binary `.sldd` is a zip, which starts with 'PK', so the first significant
 * byte cleanly separates the two forms.
 *
 * A textual `.sldd` may legitimately lead with a BOM and/or whitespace, so those are
 * skipped before sniffing for '{' — otherwise such a file is misrouted to the zip reader
 * and fails with a misleading "invalid zip data".
 */
export function isJsonTextBytes(bytes) {
    let i = 0;
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        i = 3; // UTF-8 BOM
    }
    while (i < bytes.length) {
        const b = bytes[i];
        // space, tab, LF, CR, FF, VT
        if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d || b === 0x0c || b === 0x0b) {
            i++;
            continue;
        }
        return b === 0x7b /* '{' */;
    }
    return false;
}
/**
 * The content object of a `.sldd`, whichever format its bytes are in.
 *
 * Dispatches on the BYTES, never on the extension: both spellings of a dictionary carry
 * the same one, so the name cannot tell them apart and a reader that trusts it reads the
 * wrong file silently rather than loudly.
 *
 * Throws on corrupt input — `JSON.parse` on a broken textual dictionary — and otherwise
 * reports what the read survived through `warnings`, this package's out-parameter
 * convention, so a caller can hand the SAME array on to `addDataSource` and have one file
 * report one list. Whether a warning should become a refusal is the CALLER's policy: a
 * host opening one file wants a failure banner, and a scan over a whole workspace wants
 * to skip the file and keep going. Neither is decided here.
 */
export function readSlddContent(bytes, warnings) {
    const u8 = new Uint8Array(bytes);
    if (isJsonTextBytes(u8)) {
        return JSON.parse(strFromU8(u8));
    }
    return parseBinarySldd(bytes, warnings ?? []);
}
/**
 * The dictionary content inside a read `.sldd` — the object holding `entries`,
 * `Dictionary References` and `AllowAccessBWS` — or null when the file carries no content
 * part at all.
 *
 * Null is a real answer and not a failure: MATLAB writes a dictionary with no content part
 * for a file that was never completed, and SlddNode reports that as `source-empty` rather
 * than as a parse loss.
 */
export function slddChunkContent(json) {
    const parts = json.__MW_TEXT_PARTS__;
    const chunk = parts?.['__MW_TEXT_PART__/data/chunk0'];
    return chunk?.__MW_TEXT_content ?? null;
}
/**
 * Normalise a `Dictionary References` array to plain name strings, dropping any element
 * that carries no usable name.
 *
 * A reference is stored EITHER as a bare string (`"common.sldd"`) OR as an object carrying
 * a `file` field (`{ "file": "common.sldd", ... }`), and which one a file uses is not a
 * property of the reference — it is a property of the writer. The binary reader in this
 * package emits strings; a textual dictionary is passed through as written and can hold
 * either. So a reader that accepts only strings resolves the sub-dictionaries of a
 * compressed `.sldd` and silently resolves NONE of a JSON one, for the same dictionary
 * saved twice.
 *
 * Takes `unknown` because that is what both callers hold: the field is `unknown[]` on
 * SlddNode precisely because two readers write it.
 *
 * Read-time only, deliberately. The object form is NOT rewritten to a string when a
 * dictionary is loaded, because SlddNode writes `dictionaryReferences` back out on save —
 * normalising on the way in would drop whatever else the object carried, turning a
 * display fix into a data loss.
 */
export function normalizeRefNames(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const names = [];
    for (const ref of raw) {
        const name = typeof ref === 'string'
            ? ref
            : ref && typeof ref === 'object'
                ? ref.file
                : undefined;
        if (typeof name === 'string' && name !== '') {
            names.push(name);
        }
    }
    return names;
}
//# sourceMappingURL=SlddContent.js.map