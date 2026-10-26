/**
 * A text dictionary's JSON, as MATLAB writes its numbers: what a save writes (DataModel's
 * serializeSource), and what a host that splices one entry's text into a dictionary it holds as
 * text writes for the entry (its `serialize()` record).
 *
 * JSON.stringify spells a double with no fraction as an integer literal, and MATLAB's reader takes
 * an integer literal for an integer: a double of 18446744073709551615 went out as
 * `18446744073709552000`, -2^63 as `-9223372036854776000`, past what a 64-bit integer holds, and
 * MATLAB R2027a could not open the dictionary at all (SLDD:sldd:OpenFailed). MATLAB writes such a
 * double with a fraction of zero, from a magnitude of a million up (`1000000.0`, 999999 bare;
 * `18446744073709552000.0`), and an exponent with no plus sign (`1e300`), measured on what R2027a
 * saves. So is every number here, but an extent of `_dimensions`, which is a count.
 */
export declare function textDictionaryJson(value: unknown, indent?: string | number): string;
/**
 * A finite double as MATLAB writes it in a text dictionary's JSON (textDictionaryJson): as
 * JSON.stringify does, with a fraction of zero on an integer of a million or more, and with no
 * plus sign in an exponent. -0 is 0 (JSON has no spelling of it, nor has MATLAB's text dictionary).
 */
export declare function jsonNumberText(x: number): string;
//# sourceMappingURL=TextDictionaryJson.d.ts.map