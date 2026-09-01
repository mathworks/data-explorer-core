// Copyright 2026 The MathWorks, Inc.

'use strict';

export function escapeXml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A number as MATLAB spells it. Only the non-finite values differ from
// String(num), but they differ in a way that matters: MATLAB cannot read the
// JavaScript spelling 'Infinity' back, and our own MatlabValueParser rejects it
// too — so a value displayed as 'Infinity' is also an uneditable one.
export function formatMatlabNum(num: unknown): string {
    if (typeof num === 'number' && !isFinite(num)) {
        return isNaN(num) ? 'NaN' : num > 0 ? 'Inf' : '-Inf';
    }
    return String(num);
}

// The inverse: a number as it appears in a .sldd, falling back to 0 for text
// that is not a number at all. parseFloat reads MATLAB's Inf/-Inf/NaN as NaN,
// and the `|| 0` idiom then silently turns each of them into zero — so the
// non-finite spellings have to be recognised before parseFloat sees them.
export function parseMatlabNum(text: string): number {
    const t = text.trim();
    if (t === 'Inf' || t === '+Inf') { return Infinity; }
    if (t === '-Inf') { return -Infinity; }
    if (t === 'NaN') { return NaN; }
    const n = parseFloat(t);
    return isNaN(n) ? 0 : n;
}

export function formatDoubleXml(num: number): string {
    if (!isFinite(num)) {
        return formatMatlabNum(num);
    }
    const s = String(num);
    if (!s.includes('.') && !s.includes('e') && !s.includes('E')) {
        return s + '.0';
    }
    return s;
}

export function formatNumericXml(num: number, type: string): string {
    if (type === 'double' || type === 'single') {
        return formatDoubleXml(num);
    }
    return formatMatlabNum(Math.round(num));
}

export function formatComplexXml(complexStr: string): string {
    return complexStr.replace(/(?<![.\d])(\d+)(?=[+\-i])/g, '$1.0');
}

export function transposeToColumnMajor<T>(rowMajor: T[], rows: number, cols: number): T[] {
    if (rows <= 1) { return rowMajor; }
    const result = new Array<T>(rowMajor.length);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            result[c * rows + r] = rowMajor[r * cols + c];
        }
    }
    return result;
}

export function pad(indent: number): string {
    return '    '.repeat(indent);
}

// The current time as a raw MATLAB timestamp ('YYYYMMDDThhmmss.000000') — the one
// shape both .sldd serializers write and both parsers read. Sub-second precision is
// dropped rather than converted: MATLAB writes 6 fractional digits, we have 3, and a
// timestamp that claims microseconds it does not have is worse than a rounded one.
export function matlabTimestampNow(): string {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '.000000');
}
