/** True if `bytes` begins with the ZIP local-file-header magic (PK\x03\x04). */
export declare function isZipBytes(bytes: Uint8Array): boolean;
export declare const STRING_DECODE_LIMIT = 536870888;
/** True if `bytes` is too large to decode into a single JS string (V8 limit). */
export declare function exceedsStringDecodeLimit(bytes: Uint8Array): boolean;
/**
 * True if `text` is well-formed JSON.
 *
 * Every JSON .sldd write is a text splice, and the splice helpers parse with
 * jsonc-parser, which is deliberately tolerant: it recovers from a missing brace
 * or a stray character and still reports an entry span. That tolerance is right
 * for READING text the user is mid-way through typing, but a splice computed
 * against a recovered parse writes back text that was never valid and now has a
 * chunk cut out of it. So each write path checks the document parses strictly
 * FIRST, and reports rather than edits when it does not.
 */
export declare function parsesAsJson(text: string): boolean;
/**
 * True if the bytes are an editable JSON .sldd: not a zip archive AND valid
 * JSON. Binary/zip .sldd and non-JSON content return false (→ read-only view).
 * Content too large to decode also returns false (→ handled upstream), so this
 * never attempts a decode that would throw.
 */
export declare function isEditableJsonSlddBytes(bytes: Uint8Array): boolean;
export declare const TEXT_SYNC_LIMIT: number;
/** True if `bytes` is too large for VS Code to sync as an editable TextDocument. */
export declare function exceedsTextSyncLimit(bytes: Uint8Array): boolean;
//# sourceMappingURL=slddFormat.d.ts.map