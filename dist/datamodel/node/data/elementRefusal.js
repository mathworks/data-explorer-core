// Copyright 2026 The MathWorks, Inc.
import { effectiveDims } from '../../display/DisplayConvention.js';
// What an element of each kind of array takes, as a refusal says it.
const TAKES = {
    number: 'one number',
    logical: 'true or false',
    string: 'one string, or a char row',
};
// What a text typed reads as, by the parser's type: as one value, and as an array of it.
const NOUNS = {
    double: ['a number', 'array'],
    logical: ['a logical', 'logical array'],
    complex: ['a complex number', 'complex array'],
    char: ['text', 'char array'],
    string: ['a string', 'string array'],
    'string-array': ['a string array', 'string array'],
    cell: ['a cell array', 'cell array'],
};
// The longest text typed a refusal quotes whole.
const QUOTED_MAX = 60;
/**
 * Why `typed`, read as `parsed` (null where it reads as no value), is no element of `array`, which
 * takes `takes` (a number, true or false, a piece of text): what an element of it takes, and what
 * the text typed is, quoted as it is shown. "Array elements must be scalar numbers" said neither,
 * of `[1 2; 3 4]` typed into one, of text, and of `[1 2` alike, and its logical and string
 * array's alike said nothing of what was typed.
 */
export function elementRefusal(typed, parsed, array, takes) {
    const what = 'an element of the ' + arrayPhrase(array) + ' takes ' + TAKES[takes];
    const text = typed.trim();
    return text === '' ? what + ', and nothing was typed' : what + ', and the text typed, ' + quoted(text) + ', is ' + typedPhrase(parsed);
}
// The array as a refusal names it: `1x3 double array`, `1x2 complex double array`, `10x10 sparse
// double array`.
function arrayPhrase(array) {
    const complex = array._isComplexValue();
    const cls = array._scalarType === 'complex' ? array._complexClass() : array._scalarType;
    return effectiveDims(array.dims).join('x') + ' ' + (array._sparse ? 'sparse ' : '') + (complex ? 'complex ' : '') + cls + ' array';
}
// The text typed, on one line, cut at QUOTED_MAX characters, in quotes no MATLAB text spells, so
// that a char's 'x' and a string's "x" show as typed.
function quoted(text) {
    const line = text.replace(/\s*[\r\n]+\s*/g, ' ');
    return '“' + (line.length > QUOTED_MAX ? line.slice(0, QUOTED_MAX - 1) + '…' : line) + '”';
}
// What a text typed reads as, as a refusal names it: `a 2x2 array`, `a string`.
function typedPhrase(parsed) {
    if (!parsed) {
        return 'no value this editor reads';
    }
    const [one, array] = NOUNS[parsed.type] ?? ['a ' + parsed.type, parsed.type + ' array'];
    if (!parsed.dims) {
        return one;
    }
    const dims = parsed.dims.join('x');
    return parsed.type === 'double' && dims === '0x0' ? 'an empty array' : 'a ' + dims + ' ' + array;
}
//# sourceMappingURL=elementRefusal.js.map