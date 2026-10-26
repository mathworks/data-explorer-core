// Copyright 2026 The MathWorks, Inc.

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
export function textDictionaryJson(value: unknown, indent: string | number = '\t'): string {
  const counts = new WeakSet<object>();
  let respelled = false;
  const text = JSON.stringify(
    value,
    function (this: unknown, key: string, v: unknown): unknown {
      if (key === '_dimensions' && Array.isArray(v)) {
        counts.add(v);
      }
      if (typeof v === 'number' && Number.isFinite(v) && !(Array.isArray(this) && counts.has(this))) {
        const spelled = jsonNumberText(v);
        if (spelled !== JSON.stringify(v)) {
          respelled = true;
          return NUMBER_MARK + spelled;
        }
      }
      return v;
    },
    indent,
  );
  return respelled ? text.replace(MARKED_NUMBER, '$1') : text;
}

/**
 * A finite double as MATLAB writes it in a text dictionary's JSON (textDictionaryJson): as
 * JSON.stringify does, with a fraction of zero on an integer of a million or more, and with no
 * plus sign in an exponent. -0 is 0 (JSON has no spelling of it, nor has MATLAB's text dictionary).
 */
export function jsonNumberText(x: number): string {
  const s = JSON.stringify(x);
  if (/^-?\d+$/.test(s) && Math.abs(x) >= 1e6) {
    return s + '.0';
  }
  return s.replace('e+', 'e');
}

// A number respelled, held as a string in the text JSON.stringify writes, and the text it is then
// put back as. U+0001, which JSON.stringify writes escaped, starts no string a dictionary holds.
const NUMBER_MARK = '\u0001number:';
const MARKED_NUMBER = /"\\u0001number:(-?[\d.]+(?:e-?\d+)?)"/g;
