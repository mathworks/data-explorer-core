/**
 * Whether `v` is an element of a list as MATLAB writes one: a JSON object. A text dictionary is
 * JSON anyone can edit, so a bus's Elements_internal or an enumeration's Enumerals can hold a
 * `null`, a number, a string or an array where an element belongs. MATLAB never writes one.
 * Read as an element, a `null` failed the whole dictionary, and a number or a string was dropped
 * from a bus without a word and shown by an enumeration as an enumeral named "" (C-190).
 */
export declare function isElement(v: unknown): v is Record<string, unknown>;
/**
 * Say once which of `elements` are not elements (isElement), for the entry `name`, whose reader
 * shows no row for them: recorded as a value read in part (EncodedValue.recordPartialDecode),
 * which SlddNode.parse files as a `part-unreadable` warning against the entry it is reading.
 * Returns whether there were any. The reader then keeps the value as read, so an untouched save
 * writes it back whole (DataNode._keepNullElement); an edit rebuilds it from its rows, which
 * leaves them out, and the warning says so.
 *
 * `noun` is what one element is called and `owner` what holds them, for the message.
 */
export declare function reportNotElements(elements: unknown[], name: string, noun: string, owner: string): boolean;
//# sourceMappingURL=notAnElement.d.ts.map