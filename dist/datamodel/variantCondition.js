// Copyright 2026 The MathWorks, Inc.
//
// One variant condition of a Simulink.VariantBank, checked before it is written and spelled as
// MATLAB stores it.
//
// MATLAB parses every condition a bank is given and keeps it in its own spelling: 'V==1' is
// stored as 'V == 1', '(W>0)&&~X' as 'W > 0 && ~X' (measured, R2027a 27.1.0.3409468, by
// test/fixtures/make_variantbank_r2027a.m). A condition it cannot parse is refused by the setter,
// and a dictionary holding one loads the WHOLE bank as defaults, with no warning. So nothing is
// written here that has not been parsed first, and what is written is MATLAB's spelling.
//
// The parser is deliberately smaller than MATLAB's, so that every condition it takes is one
// MATLAB was measured to take, spelled the way MATLAB was measured to spell it:
//   - a name, dotted for an enumeration ('V', 'E.A', 'v.w.x'), not a MATLAB keyword (MATLAB
//     refuses 'end==1') and not a name MATLAB has a value for (true, false, i, j, Inf, NaN, pi,
//     eps);
//   - a whole number from -2147483648 to 2147483647, inside a comparison only. MATLAB refuses
//     an integer past what its integer type holds ('V==1234567890123'), rewrites 0x1F as 31
//     and 1e3 as 1000, and keeps a decimal to six digits ('V == 3.14159' for 3.14159265358979),
//     so a hex, an exponent or a decimal is not read here;
//   - one comparison, ==, ~=, <, >, <= or >=, between two of those. A chain is not read:
//     MATLAB spells 'V>W>1' as '(V > W) > 1' and 'V==(W<1)' as 'V == W < 1', which is a
//     different condition;
//   - &&, || and ~ over comparisons, names and parentheses. A negated name is not compared:
//     '~V==1' is (~V)==1 to MATLAB, which is easy to misread.
// The single & and |, arithmetic, function calls, strings, a ';' or a comment are not read either,
// though MATLAB takes them. Refusing a condition MATLAB would have taken costs an edit; writing
// one it would not costs the bank. 'V==1i' crashed MATLAB outright.
//
// MATLAB's spelling, which `print` reproduces: one space either side of a binary operator, none
// after ~; no parentheses but those it needs, which are around an && under || or an || under &&,
// around the right operand of a chain of one operator ('V && (W && X)', as parsed), and around
// anything but a name under ~ ('~(V == 1)', '~(~V)').
import { validateMatlabName } from './matlabName.js';
const COMPARISONS = new Set(['==', '~=', '<', '>', '<=', '>=']);
// Names MATLAB has a value for, which its parser may read as that value rather than as a name:
// it refuses a bare 'true', and 'V==1i' crashed it, so none of them is read here.
const VALUE_NAMES = new Set(['true', 'false', 'i', 'j', 'Inf', 'inf', 'NaN', 'nan', 'pi', 'eps']);
const INT_MAX = 2147483647;
// MATLAB's own refusal of an empty condition, verbatim.
function emptyReason() {
    return "Invalid variant condition '' for Simulink.VariantBank.";
}
function unreadReason(text) {
    return `'${text}' is not a variant condition this editor can check, so it is not written: it reads names, `
        + 'whole numbers, one comparison (==, ~=, <, >, <= or >=) at a time, and &&, || and ~ with parentheses.';
}
// MATLAB's own refusal of an integer its integer type does not hold, verbatim.
function rangeReason(token, text) {
    return `Unsupported numeric value '${token}' in variant condition expression '${text}'. `
        + 'Only integers that can fit into the integer type for this system are allowed.';
}
class Refused extends Error {
}
function tokenize(text) {
    const tokens = [];
    let i = 0;
    while (i < text.length) {
        const ch = text.charAt(i);
        if (ch === ' ') {
            i++;
            continue;
        }
        const two = text.slice(i, i + 2);
        if (two === '==' || two === '~=' || two === '<=' || two === '>=' || two === '&&' || two === '||') {
            tokens.push(two);
            i += 2;
            continue;
        }
        if ('<>~-()'.includes(ch)) {
            tokens.push(ch);
            i++;
            continue;
        }
        const name = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*/.exec(text.slice(i));
        if (name) {
            // A dot that does not start another name ('E.', 'E..A') is left for the check below.
            tokens.push(name[0]);
            i += name[0].length;
            continue;
        }
        const digits = /^[0-9]+/.exec(text.slice(i));
        if (digits) {
            tokens.push(digits[0]);
            i += digits[0].length;
            continue;
        }
        throw new Refused();
    }
    return tokens;
}
function isName(token) {
    return token !== undefined && /^[A-Za-z]/.test(token);
}
function isDigits(token) {
    return token !== undefined && /^[0-9]/.test(token);
}
class Parser {
    constructor(tokens, text) {
        this.tokens = tokens;
        this.text = text;
        this.at = 0;
    }
    peek() {
        return this.tokens[this.at];
    }
    next() {
        return this.tokens[this.at++];
    }
    expect(token) {
        if (this.next() !== token) {
            throw new Refused();
        }
    }
    parse() {
        const cond = this.or();
        if (this.at !== this.tokens.length) {
            throw new Refused();
        }
        return cond;
    }
    or() {
        let left = this.and();
        while (this.peek() === '||') {
            this.next();
            left = { kind: 'logical', op: '||', left, right: this.and() };
        }
        return left;
    }
    and() {
        let left = this.unit();
        while (this.peek() === '&&') {
            this.next();
            left = { kind: 'logical', op: '&&', left, right: this.unit() };
        }
        return left;
    }
    // An operand of && or ||: a negation, a parenthesised condition, or a comparison or a name.
    unit() {
        const token = this.peek();
        if (token === '~') {
            this.next();
            return this.negated();
        }
        if (token === '(') {
            return this.group();
        }
        const left = this.operand();
        if (!COMPARISONS.has(this.peek() ?? '')) {
            // A number alone is no condition here (MATLAB takes '1'; nothing needs it).
            if (left.kind !== 'name') {
                throw new Refused();
            }
            return left;
        }
        const op = this.next();
        const right = this.operand();
        if (COMPARISONS.has(this.peek() ?? '')) {
            throw new Refused();
        }
        return { kind: 'compare', op, left, right };
    }
    // What follows a ~: another negation, a parenthesised condition, or a name that is not then
    // compared.
    negated() {
        const token = this.peek();
        let operand;
        if (token === '~') {
            this.next();
            operand = this.negated();
        }
        else if (token === '(') {
            operand = this.group();
        }
        else if (isName(token)) {
            operand = this.name(this.next());
        }
        else {
            throw new Refused();
        }
        if (COMPARISONS.has(this.peek() ?? '')) {
            throw new Refused();
        }
        return { kind: 'not', operand };
    }
    group() {
        this.expect('(');
        const inner = this.or();
        this.expect(')');
        if (COMPARISONS.has(this.peek() ?? '')) {
            throw new Refused();
        }
        return inner;
    }
    // One side of a comparison: a name, or a whole number with an optional minus.
    operand() {
        const token = this.next();
        if (isName(token)) {
            return this.name(token);
        }
        if (token === '-') {
            const digits = this.next();
            if (!isDigits(digits)) {
                throw new Refused();
            }
            const value = this.integer(digits, '-');
            return { kind: 'number', text: value === '0' ? '0' : '-' + value };
        }
        if (isDigits(token)) {
            return { kind: 'number', text: this.integer(token, '') };
        }
        throw new Refused();
    }
    name(token) {
        for (const part of token.split('.')) {
            if (validateMatlabName(part) !== null || VALUE_NAMES.has(part)) {
                throw new Refused();
            }
        }
        return { kind: 'name', text: token };
    }
    // The digits' value, spelled as MATLAB spells it ('01' is 1).
    integer(digits, sign) {
        const trimmed = digits.replace(/^0+(?=[0-9])/, '');
        // MATLAB's integer type is int32 here: 2147483647 and -2147483648 are taken, one past either
        // is refused, as 4294967295 is.
        if (trimmed.length > 10 || Number(trimmed) > INT_MAX + (sign === '-' ? 1 : 0)) {
            throw new RangeRefusal(sign + digits, this.text);
        }
        return trimmed;
    }
}
class RangeRefusal extends Refused {
    constructor(token, text) {
        super();
        this.token = token;
        this.text = text;
    }
}
function print(cond) {
    switch (cond.kind) {
        case 'name':
        case 'number':
            return cond.text;
        case 'compare':
            return `${print(cond.left)} ${cond.op} ${print(cond.right)}`;
        case 'not':
            return cond.operand.kind === 'name' ? '~' + cond.operand.text : `~(${print(cond.operand)})`;
        case 'logical': {
            const left = cond.left.kind === 'logical' && cond.left.op !== cond.op ? `(${print(cond.left)})` : print(cond.left);
            const right = cond.right.kind === 'logical' ? `(${print(cond.right)})` : print(cond.right);
            return `${left} ${cond.op} ${right}`;
        }
    }
}
/**
 * `text` as MATLAB stores it in a Simulink.VariantBank's VariantConditions, or why it is not
 * written there: a condition the parser above does not read, MATLAB's refusal of an empty one,
 * or MATLAB's refusal of an integer out of range.
 */
export function checkVariantCondition(text) {
    if (text === '') {
        return { reason: emptyReason() };
    }
    // Spaces only: MATLAB refuses a condition broken over two lines, and a tab is not needed.
    const trimmed = text.replace(/^ +| +$/g, '');
    if (trimmed === '') {
        return { reason: unreadReason(text) };
    }
    try {
        return { condition: print(new Parser(tokenize(trimmed), text).parse()) };
    }
    catch (e) {
        if (e instanceof RangeRefusal) {
            return { reason: rangeReason(e.token, e.text) };
        }
        if (e instanceof Refused) {
            return { reason: unreadReason(text) };
        }
        throw e;
    }
}
/**
 * Whether `text`, read from a file, is a condition MATLAB cannot parse whatever its grammar:
 * empty or blank (MATLAB: "Invalid variant condition ''" and "Parsing of expression failed"),
 * broken over lines, with unbalanced parentheses, starting or ending with a binary operator
 * ('V ==', '&& V'), or holding a `!`, a `<>` or a lone `=` ('V=1'), each of which MATLAB was
 * measured to refuse. A bank holding one is read by MATLAB as defaults (make_variantbank_r2027a.m),
 * which the dictionary's warnings say.
 *
 * Narrower than `checkVariantCondition` on purpose. That one decides what an edit may WRITE, and
 * refuses whatever it cannot vouch for; this one decides what to say about what a file HOLDS, and
 * a condition outside the editor's language that MATLAB wrote ('V == 1 & W == 2', 'V == 1.5') is
 * read correctly and is no defect of the file. A text with a quote in it is not judged past the
 * blank and the line break, since a quoted operator is no operator.
 */
export function conditionCannotParse(text) {
    if (text.trim() === '' || /[\r\n]/.test(text)) {
        return true;
    }
    if (/['"]/.test(text)) {
        return false;
    }
    // A trailing ';' and a comment are taken by MATLAB ('V==1;', 'V==1 %c').
    const body = text.replace(/%.*$/, '').replace(/;\s*$/, '').trim();
    if (body === '') {
        return true;
    }
    let depth = 0;
    for (const ch of body) {
        depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
        if (depth < 0) {
            return true;
        }
    }
    if (depth !== 0) {
        return true;
    }
    if (/[!]|<>|(?<![=~<>])=(?!=)/.test(body)) {
        return true;
    }
    return /^(==|~=|<=|>=|&&|\|\||[<>&|*/^])/.test(body) || /(==|~=|<=|>=|&&|\|\||[<>&|*/^~+\-(])$/.test(body);
}
//# sourceMappingURL=variantCondition.js.map