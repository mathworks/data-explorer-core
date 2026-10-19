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
/**
 * Say that the entry `name` holds `value`, which is not a list (an array), where its list of
 * elements belongs: a hand edit can leave a number, a string, an object or a `null` there, which
 * MATLAB never writes. Read as a list, any but the `null` failed the whole dictionary (`forEach is
 * not a function`), and the `null` opened with nothing said and an untouched save wrote the list
 * as `[]`. The reader shows no element for it, and keeps the value as read, as reportNotElements
 * says; recorded the same way, so it is one `part-unreadable` warning against the entry.
 */
export declare function reportNotAList(value: unknown, name: string, noun: string, owner: string): void;
//# sourceMappingURL=notAnElement.d.ts.map