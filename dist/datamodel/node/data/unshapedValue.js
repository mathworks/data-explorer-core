// A hand edit can leave an object of any size; the row and the warning show its start.
const SHOWN_MAX = 60;
/**
 * The JSON `value` is, cut at SHOWN_MAX characters. A value JSON cannot spell, which only a host
 * can hand in (a bigint in it), is named by its first keys. Never throws.
 */
export function unshapedText(value) {
    let text;
    try {
        text = JSON.stringify(value);
    }
    catch {
        text = undefined;
    }
    if (text === undefined) {
        const keys = Object.keys(value);
        text = '{' + keys.slice(0, 5).map((k) => JSON.stringify(k)).join(', ') + (keys.length > 5 ? ', ...' : '') + '}';
    }
    return text.length > SHOWN_MAX ? text.slice(0, SHOWN_MAX) + '...' : text;
}
/** The first object recorded since the last take, the node holding it and its text, and how many there were. */
let first = null;
let count = 0;
/** Record one object of no shape MATLAB writes, held by the node `at`. */
export function recordUnshapedValue(at, value) {
    if (count++ === 0) {
        first = { at, text: unshapedText(value) };
    }
}
/** The objects recorded since the last call, which clears them, or null if there were none. */
export function takeUnshapedValues() {
    const taken = first && { count, path: first.at.matlabPath, text: first.text };
    first = null;
    count = 0;
    return taken;
}
/** The one warning for entry `part` whose read recorded `taken`. */
export function unshapedValueWarning(part, taken) {
    const at = taken.path === part ? '' : ` at ${taken.path}`;
    const message = taken.count === 1
        ? `"${part}" holds ${taken.text}${at}, which is not a value MATLAB writes; it is shown as read.`
        : `"${part}" holds ${taken.count} values that are not values MATLAB writes; the first is ${taken.text}${at}, `
            + 'and each is shown as read.';
    return { code: 'part-unreadable', message, part };
}
//# sourceMappingURL=unshapedValue.js.map