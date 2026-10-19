// Copyright 2026 The MathWorks, Inc.

import { recordPartialDecode } from '../../parser/EncodedValue.js';

/**
 * Whether `v` is an element of a list as MATLAB writes one: a JSON object. A text dictionary is
 * JSON anyone can edit, so a bus's Elements_internal or an enumeration's Enumerals can hold a
 * `null`, a number, a string or an array where an element belongs. MATLAB never writes one.
 * Read as an element, a `null` failed the whole dictionary, and a number or a string was dropped
 * from a bus without a word and shown by an enumeration as an enumeral named "" (C-190).
 */
export function isElement(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// How the warning names what stood where an element belongs: as the file spells it, where
// that is short.
function spelled(v: unknown): string {
    if (v === null || v === undefined) {
        return 'null';
    }
    if (Array.isArray(v)) {
        return 'an array';
    }
    if (typeof v === 'string') {
        return v.length <= 24 ? JSON.stringify(v) : 'a string';
    }
    if (typeof v === 'object') {
        return 'an object';
    }
    return String(v);
}

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
export function reportNotElements(elements: unknown[], name: string, noun: string, owner: string): boolean {
    const found: string[] = [];
    elements.forEach(function (v, i) {
        if (!isElement(v)) {
            found.push(`${spelled(v)} at position ${i + 1}`);
        }
    });
    if (found.length === 0) {
        return false;
    }
    const one = found.length === 1;
    recordPartialDecode(
        `"${name}" lists ${found.length} ${noun}${one ? ' that is not one' : `s that are not ${noun}s`} `
            + `(${found.join(', ')}); ${one ? 'it is' : 'they are'} not shown, and an edit to the ${owner} `
            + `drops ${one ? 'it' : 'them'} from the file.`,
    );
    return true;
}

/**
 * Say that the entry `name` holds `value`, which is not a list (an array), where its list of
 * elements belongs: a hand edit can leave a number, a string, an object or a `null` there, which
 * MATLAB never writes. Read as a list, any but the `null` failed the whole dictionary (`forEach is
 * not a function`), and the `null` opened with nothing said and an untouched save wrote the list
 * as `[]`. The reader shows no element for it, and keeps the value as read, as reportNotElements
 * says; recorded the same way, so it is one `part-unreadable` warning against the entry.
 */
export function reportNotAList(value: unknown, name: string, noun: string, owner: string): void {
    recordPartialDecode(
        `"${name}" holds ${spelled(value)} where its list of ${noun}s belongs; it is not shown, `
            + `and an edit to the ${owner} drops it from the file.`,
    );
}
