// Copyright 2026 The MathWorks, Inc.
//
// A number typed into a single is the single MATLAB makes of it, shown as a single read from a file
// is shown: the decimal MATLAB writes that float32 with (floatDigits.matlabFloatText, the rule a
// .mat's single is read by). single(9007199254740993) is 2^53, which MATLAB writes 9.00719925E+15,
// and single(3.14159265358979) is 3.14159274. Held as the double typed, the edit showed
// 9007199254740992 and 3.14159265358979, and the file saved and opened again 9007199250000000 and
// 3.14159274 (a text dictionary 9007199254740992, written as the double it held). The same after the
// edit and after the reopen, in every format.
import { describe, it, expect } from 'vitest';
import { EDIT_BASH_FORMATS, openEditBash, reopened, shownRow, typeInto, undo } from './tools/editBash.js';

const CASES: [path: string, text: string, shown: string, whole: string][] = [
  ['sglRow(1)', '9007199254740993', '9007199250000000', '[9007199250000000 -2.5]'],
  ['sglRow(1)', '3.14159265358979', '3.14159274', '[3.14159274 -2.5]'],
  ['sglRow(2)', '-0.1', '-0.1', '[0.1 -0.1]'],
  ['sLeaves.sglRow(2)', '1e39', 'Inf', '[0.1 Inf]'],
  ['sgl', '9007199254740993', '9007199250000000', '9007199250000000'],
  ['sglRow', '[9007199254740993 3.14159265358979]', '[9007199250000000 3.14159274]', '[9007199250000000 3.14159274]'],
];

describe.each(EDIT_BASH_FORMATS)('a number typed into a single, %s', (format) => {
  it.each(CASES)('%s typed %s shows the single, after the edit and after a reopen', (path, text, shown, whole) => {
    const o = openEditBash(format);
    const before = shownRow(o, path);
    expect(typeInto(o, path, 'Value', text)).toBe(true);
    const holder = path.replace(/\(\d+\)$/, '');
    expect(shownRow(o, path)?.Value).toBe(shown);
    expect(shownRow(o, holder)?.Value).toBe(whole);
    const again = reopened(o);
    expect(shownRow(again, path)).toEqual(shownRow(o, path));
    expect(shownRow(again, holder)).toEqual(shownRow(o, holder));
    undo(o);
    expect(shownRow(o, path)).toEqual(before);
  });
});
