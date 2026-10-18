// Copyright 2026 The MathWorks, Inc.
//
// A number read under an integer class, held as MATLAB reads it, and a record of every one
// that class could not hold, for the dictionary's warnings (F1-17).
//
// A dictionary's typed literal names its class and spells its numbers, and nothing makes the
// two agree: a hand edit or a host can write `{"_type": "int8", "_value": "300"}`, or 2.5, or
// Inf. MATLAB reads such a literal out of a text dictionary converted, as int8() converts a
// number: rounded to the nearest integer, a tie away from zero, saturated at the class's range,
// with NaN as 0 (measured, R2027a: int8 300 is 127, 2.5 is 3, NaN is 0; uint8 -5 is 0; int64
// 2^63 is intmax). That is toIntegerClass, the rule every writer here already follows, so the
// value is held converted from the read on. The node's literal is not converted: an untouched
// save writes it back as it was read, and MATLAB reads the value that was shown.
//
// The read paths (MatlabVariableNode.parseTypedScalar, parseTypedVector, parseTypedArray) have
// no warnings sink of their own, so each number that changed is recorded here, and
// SlddNode.parse, which builds each entry and holds the sink, takes the record after each entry
// and before it, as it takes EncodedValue's decode failures. A host's paste has no sink: what it
// records is dropped by the next entry a dictionary read builds.
import type { ParseWarning } from '../../parser/ParseWarning.js';
import { formatMatlabNum, integerConversion, isExactToken } from '../../parser/XmlUtils.js';

/** One number its class could not hold: as read, and as it is held. */
export interface UnheldInteger {
  /** The integer class, `int8` to `uint64`. */
  type: string;
  /** The number as read: a double, or a 64-bit integer's exact decimal text (parseExactNum). */
  read: number | string;
  /** What it is held as (toIntegerClass). */
  shown: number | string;
}

/** The numbers recorded since the last take: how many, and the first, all a warning names. */
export interface UnheldIntegers {
  count: number;
  first: UnheldInteger;
}

// The first and a count, not a list: one value can hold millions of such numbers, and one
// warning per entry names only the first.
let first: UnheldInteger | null = null;
let count = 0;

/**
 * A reader of numbers under integer class `type`, its conversion looked up once (for an array's
 * every element): each number comes back as MATLAB reads it under the class, and one the class
 * did not hold is recorded.
 */
export function integerReader(type: string): (read: number | string) => number | string {
  const convert = integerConversion(type);
  return (read) => {
    const shown = convert(read);
    // `read === shown` is every number a dictionary MATLAB wrote holds, -0 included. Past it,
    // a value is held if it is the same integer: a double past 2^53 that an int64 holds comes
    // back as its exact text.
    if (!heldAsRead(read, shown)) {
      if (count++ === 0) {
        first = { type, read, shown };
      }
    }
    return shown;
  };
}

/** Was `read` held by its class as it was read, `shown` being what integerReader made of it? */
export function heldAsRead(read: number | string, shown: number | string): boolean {
  return read === shown || sameInteger(read, shown);
}

function sameInteger(read: number | string, shown: number | string): boolean {
  if (typeof read === 'number' ? !Number.isInteger(read) : !isExactToken(read)) {
    return false;
  }
  return BigInt(read) === BigInt(shown);
}

/** The numbers recorded since the last call, which clears them, or null if there were none. */
export function takeUnheldIntegers(): UnheldIntegers | null {
  const taken = first && { count, first };
  first = null;
  count = 0;
  return taken;
}

/**
 * The one warning for entry `part` whose read recorded `taken`. A text dictionary's number is
 * shown as MATLAB reads that file (measured). A binary dictionary's is shown as MATLAB converts
 * a number to the class, which is what this package's binary writer writes; MATLAB's own binary
 * reader takes such text its own way (int8 300 as 44, measured), so that file's message does not
 * say "as MATLAB reads it".
 */
export function unheldIntegerWarning(part: string, taken: UnheldIntegers, textDictionary: boolean): ParseWarning {
  const { type, read, shown } = taken.first;
  const value = `the ${type} value ${formatMatlabNum(read)}`;
  const how = textDictionary ? 'as MATLAB reads it' : 'as MATLAB converts a number to its class';
  const article = type.startsWith('u') ? 'a' : 'an';
  const message = taken.count === 1
    ? `"${part}" holds ${value}, which ${article} ${type} cannot hold; it is shown ${how}, ${formatMatlabNum(shown)}.`
    : `"${part}" holds ${taken.count} values its integer class cannot hold, each shown ${how}; `
      + `the first is ${value}, shown as ${formatMatlabNum(shown)}.`;
  return { code: 'part-unreadable', message, part };
}
