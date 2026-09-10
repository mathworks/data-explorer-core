// src/datamodel/parser/SlddParts.ts
// Copyright 2026 The MathWorks, Inc.
//
// WHERE A DICTIONARY'S ENTRIES LIVE — one set of names, three writers and three readers.
//
// A `.sldd` keeps every entry it has in ONE part. In a compressed-binary dictionary that
// part is a zip member, `data/chunk0.xml`; in a textual one it is a nested key inside the
// JSON, `__MW_TEXT_PARTS__` -> `__MW_TEXT_PART__/data/chunk0` -> `__MW_TEXT_content`. Both
// spellings name the same part, which is why the same `chunk0` appears in both and why
// they are derived from one base here rather than written twice.
//
// These were literals at every site, and the sites are on both sides of a rule that
// nothing checks:
//
//   * `parseBinarySldd` LOOKS UP the zip member, and copies every OTHER member into
//     `__zipMetadata` as pass-through. `serializeBinarySldd` writes that bag back and then
//     puts the member in. Those two names have to be the same string or a save either
//     drops the entries or ships two copies of them — and the exclusion is spelled as a
//     `!==`, so drift shows up as a valid zip with the wrong contents, not as a throw.
//   * The binary reader and `SlddNode.serializeJson` both WRITE the nested JSON path, and
//     `slddChunkContent` is the only thing that reads it. A writer that drifted would hand
//     back a content object the reader answers `null` for, which SlddNode reports as
//     `source-empty`: the dictionary opens, names no entries, and looks like a file the
//     user had created and not filled in. SlddContent's own header records that this
//     already happened once, when three readers each did the unwrap for themselves.
//   * Two of the reader's warnings QUOTE the part name to the user. ScCatalog says why
//     that matters for `SC_PART` and it is the same here: a message naming a different
//     string from the one that was looked up is a lie no reader can detect.
//
// Published from the barrel for the reason `SC_PART`/`SC_PART_XML` are. A host owns the
// open document — the zip members it must preserve byte-for-byte, the raw JSON text it
// splices offsets into — and this package cannot do either of those for it, so the host
// navigates the same part and must name it identically. data-explorer-vscode does, in its
// writable-binary editor and in the two scanners that walk the JSON path over raw text.
//
// The tests deliberately keep spelling these strings out. A test that asked the constant
// what the constant is would pass for any value; the literals in the fixtures and the
// round-trip suites are what pin these to the bytes MATLAB actually writes.
/**
 * The dictionary's data part, without an extension — the shared stem of both spellings
 * below, and the reason `chunk0` appears in a zip member name and in a JSON key.
 *
 * The `0` is MATLAB's, not a placeholder this package fills in, and it does not become a
 * loop once a dictionary gets big enough. R2027a was asked for two deliberately extreme
 * dictionaries — 120 entries of `rand(120,120)` (36.8 MB as text, 15.8 MB zipped) and
 * 20,000 scalar entries — in both on-disk formats, and all four wrote exactly one data
 * part. Chunking by payload size or by entry count is not a behaviour this MATLAB has.
 *
 * That is measured for one release, though, so the reader stays conservative rather than
 * asserting: a package that also held a `chunk1.xml` is read for chunk zero and carries
 * the rest through untouched as pass-through metadata, so a future chunking scheme would
 * make those entries invisible rather than lose them on the next save.
 */
export const DATA_PART = 'data/chunk0';
/**
 * The data part as a member of a compressed-binary (zip) dictionary. The `.xml` suffix is
 * part of the member name, so this is the string to look a member up by, to exclude from
 * the pass-through bag, and to name in a warning about it.
 */
export const DATA_PART_XML = `${DATA_PART}.xml`;
/** The parts bag of a deserialized dictionary — the first step of the JSON path. */
export const TEXT_PARTS = '__MW_TEXT_PARTS__';
/**
 * The data part's key INSIDE that bag — the second step. It is the part name with
 * MATLAB's `__MW_TEXT_PART__/` prefix on it, and note that the prefix already ends in a
 * separator, so this is not a path join with `DATA_PART_XML`: the JSON key carries no
 * `.xml`.
 */
export const DATA_PART_KEY = `__MW_TEXT_PART__/${DATA_PART}`;
/**
 * The content wrapper inside the part — the third and last step, whose value is the object
 * holding `entries`, `Dictionary References` and `AllowAccessBWS`.
 */
export const TEXT_CONTENT = '__MW_TEXT_content';
//# sourceMappingURL=SlddParts.js.map