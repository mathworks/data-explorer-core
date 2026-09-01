// Copyright 2026 The MathWorks, Inc.
'use strict';
export function escapeXml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// A number as MATLAB spells it. Only the non-finite values differ from
// String(num), but they differ in a way that matters: MATLAB cannot read the
// JavaScript spelling 'Infinity' back, and our own MatlabValueParser rejects it
// too — so a value displayed as 'Infinity' is also an uneditable one.
export function formatMatlabNum(num) {
    if (typeof num === 'number' && !isFinite(num)) {
        return isNaN(num) ? 'NaN' : num > 0 ? 'Inf' : '-Inf';
    }
    return String(num);
}
// The inverse: a number as it appears in a .sldd, falling back to 0 for text
// that is not a number at all. parseFloat reads MATLAB's Inf/-Inf/NaN as NaN,
// and the `|| 0` idiom then silently turns each of them into zero — so the
// non-finite spellings have to be recognised before parseFloat sees them.
export function parseMatlabNum(text) {
    const t = text.trim();
    if (t === 'Inf' || t === '+Inf') {
        return Infinity;
    }
    if (t === '-Inf') {
        return -Infinity;
    }
    if (t === 'NaN') {
        return NaN;
    }
    const n = parseFloat(t);
    return isNaN(n) ? 0 : n;
}
export function formatDoubleXml(num) {
    if (!isFinite(num)) {
        return formatMatlabNum(num);
    }
    const s = String(num);
    if (!s.includes('.') && !s.includes('e') && !s.includes('E')) {
        return s + '.0';
    }
    return s;
}
export function formatNumericXml(num, type) {
    if (type === 'double' || type === 'single') {
        return formatDoubleXml(num);
    }
    return formatMatlabNum(Math.round(num));
}
// Every numeric part of a complex literal has to read as a double, so an integral
// part gains a '.0'. Match the WHOLE number rather than a trailing run of digits:
// the run-of-digits form appended '.0' to the EXPONENT, so '1e-7+2e-8i' was written
// as '1e-7.0+2e-8.0i', which is not a MATLAB literal at all. Exponents are not a
// corner case here — Number stringifies anything below 1e-6 that way, so typing an
// ordinary small value like '0.0000001+0.00000002i' into the inspector is stored as
// '1e-7+2e-8i' and reached this routine. The leading-dot alternative comes first so
// '.5' is seen as one number instead of a bare '5' that would yield '.5.0'.
export function formatComplexXml(complexStr) {
    return complexStr.replace(/\.\d+(?:[eE][+-]?\d+)?|\d+\.?\d*(?:[eE][+-]?\d+)?/g, (num) => (/[.eE]/.test(num) ? num : num + '.0'));
}
export function transposeToColumnMajor(rowMajor, rows, cols) {
    if (rows <= 1) {
        return rowMajor;
    }
    const result = new Array(rowMajor.length);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            result[c * rows + r] = rowMajor[r * cols + c];
        }
    }
    return result;
}
export function pad(indent) {
    return '    '.repeat(indent);
}
// The current time as a raw MATLAB timestamp ('YYYYMMDDThhmmss.000000') — the one
// shape both .sldd serializers write and both parsers read. Sub-second precision is
// dropped rather than converted: MATLAB writes 6 fractional digits, we have 3, and a
// timestamp that claims microseconds it does not have is worse than a rounded one.
export function matlabTimestampNow() {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '.000000');
}
//# sourceMappingURL=XmlUtils.js.map