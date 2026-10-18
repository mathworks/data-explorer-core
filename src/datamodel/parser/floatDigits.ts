// Copyright 2026 The MathWorks, Inc.

// A finite double or single as MATLAB spells it in a compressed-binary dictionary's XML,
// measured (R2027a, test/numbers/make_number_battery.m: 2,109 doubles and 1,807
// singles of random magnitude and sign, and the edges, none of them spelled otherwise):
//
//   * a double is C's `%.15g` where that is the same double, and `%.17g` where it is not,
//     which always is: 0.1 is `0.1`, 1/3 `0.33333333333333331`, pi `3.1415926535897931`;
//   * a single is `%.6g` where that is the same float32, else `%.9g`, else `%.10g`, a
//     candidate past realmax('single') not counting, so that only +-realmax('single') takes
//     ten digits: `0.1`, `3.14159274`, `3.402823466E+38`. That is the rule MatParser's
//     singleDigits reads a .mat single by (C-033), measured there on 4,082 bit patterns;
//   * the digits are rounded as C rounds them, to the nearer and an exact tie to the even
//     digit: 1125899906842624.25 is `1125899906842624.2`, the single 1000000.125
//     `1000000.12`. toPrecision takes a tie away from zero;
//   * the layout is `%g`'s: an exponent where the decimal exponent X of the first digit is
//     below -4 or at least the digit count P, trailing zeros dropped. Then MATLAB's own: an
//     integral mantissa gains `.0`, and the exponent is `E+n` or `E-n` with no leading
//     zero, so 1e-5 is `1.0E-5`, 1e15 `1.0E+15`, 2^53 `9007199254740992.0` (`%.17g`, which
//     takes no exponent below 1e17), the single 1e6 `1.0E+6`, -0 `-0.0`.
//
// A text dictionary's literal is another spelling (`0.00001`, `1.0e+6F`), which this is not.

/** A positive number's significant digits, the first non-zero, and that digit's decimal exponent. */
interface Digits {
    digits: string;
    exp: number;
}

// The smallest normal double, realmin. Below it a double has fewer than 53 bits, and its
// shortest text says nothing about its fifteen-digit one.
const DBL_MIN = 2.2250738585072014e-308;

// The largest finite single, realmax('single').
const FLT_MAX = 3.4028234663852886e38;

/**
 * `ax`, positive and finite, to `p` significant digits as C's printf rounds it: to the
 * nearer, an exact tie to the even digit. toExponential rounds a tie away from zero, and
 * only a value of exactly `p + 1` significant digits, the last a 5, is a tie: then its own
 * text at `p + 1` digits ends in that 5, which is looked for before the exact digits are.
 * Every significant digit of a double up to a hundred is in toExponential(99), which a tie
 * at seventeen has all of.
 */
function roundedDigits(ax: number, p: number): Digits {
    const away = ax.toExponential(p - 1);
    const e = away.indexOf('e');
    const next = ax.toExponential(p);
    if (next.charAt(next.indexOf('e') - 1) === '5') {
        const all = ax.toExponential(99);
        const ae = all.indexOf('e');
        const d = all.slice(0, ae).replace('.', '');
        // An exact tie whose last kept digit is even goes to `ax` cut to `p` digits.
        if (d[p] === '5' && /^0*$/.test(d.slice(p + 1)) && Number(d[p - 1]) % 2 === 0) {
            return { digits: d.slice(0, p), exp: Number(all.slice(ae + 1)) };
        }
    }
    return { digits: away.slice(0, e).replace('.', ''), exp: Number(away.slice(e + 1)) };
}

/**
 * The digits of JavaScript's shortest text of `ax`, positive and finite: `0.001234` is
 * 1234 at -3, `1e+21` is 1 at 21. Trailing zeros are not digits.
 */
function shortestDigits(ax: number): Digits {
    const s = String(ax);
    const i = s.indexOf('e');
    const mantissa = i >= 0 ? s.slice(0, i) : s;
    const dot = mantissa.indexOf('.');
    const whole = dot >= 0 ? mantissa.slice(0, dot) : mantissa;
    const all = dot >= 0 ? whole + mantissa.slice(dot + 1) : whole;
    let lead = 0;
    while (all.charAt(lead) === '0') {
        lead++;
    }
    let end = all.length;
    while (end > lead + 1 && all.charAt(end - 1) === '0') {
        end--;
    }
    return { digits: all.slice(lead, end), exp: whole.length - 1 - lead + (i >= 0 ? Number(s.slice(i + 1)) : 0) };
}

/** The number `d` names. */
const valueOf = (d: Digits): number => Number(d.digits[0] + '.' + d.digits.slice(1) + 'e' + d.exp);

/** `d` laid out as `%g` at `p` digits lays it out, and then as MATLAB does (see above). */
function layout(negative: boolean, d: Digits, p: number): string {
    let end = d.digits.length;
    while (end > 1 && d.digits.charAt(end - 1) === '0') {
        end--;
    }
    const digits = d.digits.slice(0, end);
    let text: string;
    if (d.exp < -4 || d.exp >= p) {
        text = digits[0] + '.' + (end > 1 ? digits.slice(1) : '0') + (d.exp < 0 ? 'E-' : 'E+') + Math.abs(d.exp);
    } else if (d.exp >= 0) {
        text = end > d.exp + 1 ? digits.slice(0, d.exp + 1) + '.' + digits.slice(d.exp + 1) : digits.padEnd(d.exp + 1, '0') + '.0';
    } else {
        text = '0.' + '0'.repeat(-d.exp - 1) + digits;
    }
    return negative ? '-' + text : text;
}

/**
 * The finite number `x` as MATLAB writes it into a binary dictionary under class `cls`: the
 * double, or the single `x` is, already a float32 (see above). Not for an infinity or a NaN,
 * which have words of their own.
 */
export function matlabFloatText(x: number, cls: 'double' | 'single'): string {
    if (x === 0) {
        return Object.is(x, -0) ? '-0.0' : '0.0';
    }
    const negative = x < 0;
    const ax = negative ? -x : x;
    if (cls === 'single') {
        for (const p of [6, 9, 10]) {
            const d = roundedDigits(ax, p);
            const v = valueOf(d);
            if (v <= FLT_MAX && Math.fround(v) === ax) {
                return layout(negative, d, p);
            }
        }
        return layout(negative, roundedDigits(ax, 9), 9);
    }
    // A normal double's shortest text is its fifteen-digit one when it has fifteen digits or
    // fewer, and when it has more no fifteen-digit text is the double. Either way that is
    // decided without rounding it twice; a subnormal's is not.
    if (ax >= DBL_MIN) {
        const shortest = shortestDigits(ax);
        return shortest.digits.length <= 15 ? layout(negative, shortest, 15) : layout(negative, roundedDigits(ax, 17), 17);
    }
    const fifteen = roundedDigits(ax, 15);
    return valueOf(fifteen) === ax ? layout(negative, fifteen, 15) : layout(negative, roundedDigits(ax, 17), 17);
}
