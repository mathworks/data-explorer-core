import type { ParseWarning } from './ParseWarning.js';
/**
 * True when these bytes open a JSON object, ignoring a leading UTF-8 BOM and any leading
 * whitespace. A binary `.sldd` is a zip, which starts with 'PK', so the first significant
 * byte cleanly separates the two forms.
 *
 * A textual `.sldd` may legitimately lead with a BOM and/or whitespace, so those are
 * skipped before sniffing for '{' — otherwise such a file is misrouted to the zip reader
 * and fails with a misleading "invalid zip data".
 */
export declare function isJsonTextBytes(bytes: Uint8Array): boolean;
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
export declare function readSlddContent(bytes: ArrayBuffer, warnings?: ParseWarning[]): Record<string, unknown>;
/**
 * The dictionary content inside a read `.sldd` — the object holding `entries`,
 * `Dictionary References` and `AllowAccessBWS` — or null when the file carries no content
 * part at all.
 *
 * Null is a real answer and not a failure: MATLAB writes a dictionary with no content part
 * for a file that was never completed, and SlddNode reports that as `source-empty` rather
 * than as a parse loss.
 */
export declare function slddChunkContent(json: Record<string, unknown>): Record<string, unknown> | null;
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
export declare function normalizeRefNames(raw: unknown): string[];
//# sourceMappingURL=SlddContent.d.ts.map