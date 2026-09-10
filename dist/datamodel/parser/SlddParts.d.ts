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
export declare const DATA_PART = "data/chunk0";
/**
 * The data part as a member of a compressed-binary (zip) dictionary. The `.xml` suffix is
 * part of the member name, so this is the string to look a member up by, to exclude from
 * the pass-through bag, and to name in a warning about it.
 */
export declare const DATA_PART_XML = "data/chunk0.xml";
/** The parts bag of a deserialized dictionary — the first step of the JSON path. */
export declare const TEXT_PARTS = "__MW_TEXT_PARTS__";
/**
 * The data part's key INSIDE that bag — the second step. It is the part name with
 * MATLAB's `__MW_TEXT_PART__/` prefix on it, and note that the prefix already ends in a
 * separator, so this is not a path join with `DATA_PART_XML`: the JSON key carries no
 * `.xml`.
 */
export declare const DATA_PART_KEY = "__MW_TEXT_PART__/data/chunk0";
/**
 * The content wrapper inside the part — the third and last step, whose value is the object
 * holding `entries`, `Dictionary References` and `AllowAccessBWS`.
 *
 * The wrapper is MATLAB's for EVERY text part, not just the data one: `arch.sldd` carries
 * three parts (`data/chunk0`, `simulink/ArchitecturePart` and the System Composer
 * interfaceDictionary) and each is wrapped in this same key. So the catalog reader
 * (`SlddNode._parseSystemComposer`) unwraps its own part with this constant too, and the
 * name it is combined with — `DATA_PART_KEY` or `__MW_TEXT_PART__/${SC_PART}` — is what
 * says WHICH part is being unwrapped.
 */
export declare const TEXT_CONTENT = "__MW_TEXT_content";
//# sourceMappingURL=SlddParts.d.ts.map