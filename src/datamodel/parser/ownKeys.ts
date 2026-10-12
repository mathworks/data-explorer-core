// Copyright 2026 The MathWorks, Inc.

/**
 * `bag[key] = value`, for a key the FILE spells: a struct field, an object property, an
 * attribute name.
 *
 * On an ordinary object exactly one key is not a store: `__proto__`, whose assignment is
 * Object.prototype's setter. Given an object it re-parents the bag, which then inherits that
 * object's keys; given anything else it does nothing, and the key is lost. MATLAB cannot write
 * the name (an identifier starts with a letter), but a file can spell it, so here it is defined
 * as the own data property every other key becomes by assignment. The bag keeps
 * Object.prototype, as every bag a reader hands out does, so a consumer can still call
 * `bag.hasOwnProperty(…)` or compare it with `toStrictEqual`.
 *
 * Every other key is the plain assignment it was, so a reader pays one comparison per key.
 * Building the bag from pairs with `Object.fromEntries` gives the same result, but measured on
 * a binary dictionary's struct and object elements it cost about 4% of the whole open.
 */
export function setOwn<T>(bag: Record<string, T>, key: string, value: T): void {
  if (key === '__proto__') {
    Object.defineProperty(bag, key, { value, writable: true, enumerable: true, configurable: true });
  } else {
    bag[key] = value;
  }
}
