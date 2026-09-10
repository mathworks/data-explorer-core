/**
 * The dictionary's data part, without an extension — the shared stem of both spellings
 * below, and the reason `chunk0` appears in a zip member name and in a JSON key.
 *
 * The `0` is MATLAB's, not a placeholder this package fills in: every dictionary written
 * so far keeps all of its entries in chunk zero. A package that also held a `chunk1.xml`
 * would be read for chunk zero and carry the rest through untouched as pass-through
 * metadata, which is the conservative answer — the entries would be invisible, not lost.
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
 */
export declare const TEXT_CONTENT = "__MW_TEXT_content";
//# sourceMappingURL=SlddParts.d.ts.map