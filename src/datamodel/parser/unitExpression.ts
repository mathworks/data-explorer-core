// Copyright 2026 The MathWorks, Inc.
//
// MATLAB's check of a unit expression, the one a Simulink.ValueType's Unit and a lookup table's
// Table and Breakpoint Unit are held to (not a Parameter's, a Signal's or a BusElement's DocUnits,
// which take any text). MATLAB refuses at the assignment what this refuses, in these words, and a
// file holding such a Unit loads it as '' with no warning, so an edit that wrote one would be
// lost. Fitted to MATLAB R2027a's and R2023b's own verdicts, which agree, on 8,369 texts
// (test/fixtures/unit-expression: every probe, the words of each refusal and where it says the
// error is).
//
// What MATLAB does, as measured:
//   - The text is trimmed of white space at either end; nothing left is no unit, which it takes.
//   - A C comment's delimiters /* and */ become _, as do a control character and each of
//     " & ' < > [ \ ] { }; the refusal quotes the text so changed.
//   - A qualifier after the first @ must be one or more characters of a unit name: one empty, or
//     holding an operator or another @, is refused as an invalid expression, before anything else.
//   - The expression (before any @) is unit names joined by * and /, each with exponents (^ and a
//     number, signed, or a ratio of numbers in parentheses), and parenthesized expressions. A name
//     is a run of characters that are no space and none of * / ^ ( ) + -. White space may stand
//     beside an operator, and nowhere else: `m s` is refused at the s. An error inside parentheses
//     is reported of the text after the opening one, at the position there.
//   - Parsed, a text holding a comma, or a qualifier holding a space, is an invalid expression.

/** MATLAB's refusal of `text` as a unit expression, in its words, or null where it takes it. */
export function unitExpressionRefusal(text: string): string | null {
  const t = text.trim();
  if (t === '') {
    return null;
  }
  const u = t.replace(/\/\*|\*\//g, '_').replace(/[\x00-\x1f"&'<>[\\\]{}]/g, '_');
  const invalid = "Invalid unit expression '" + text + "' in 'Unit' property.";
  const at = u.indexOf('@');
  let base = u;
  let qualifier: string | null = null;
  if (at >= 0) {
    qualifier = u.slice(at + 1).trim();
    if (qualifier === '' || [...qualifier].some((c) => c === '@' || OPERATORS.has(c))) {
      return invalid;
    }
    base = u.slice(0, at).trim();
  }
  const error = base === '' ? null : parseError(base);
  if (error) {
    return "Encountered error while parsing unit expression '" + error.text + "' at position " + error.position + '.';
  }
  return t.includes(',') || (qualifier !== null && [...qualifier].some(isSpace)) ? invalid : null;
}

const OPERATORS = new Set(['*', '/', '^', '(', ')', '+', '-']);

function isSpace(c: string | undefined): boolean {
  return c !== undefined && /\p{Zs}/u.test(c);
}

function isNameChar(c: string | undefined): boolean {
  return c !== undefined && !isSpace(c) && !OPERATORS.has(c);
}

class UnitError {
  constructor(readonly text: string, readonly position: number) {}
}

// Where `t` is first not a unit expression, as MATLAB reports it, or null.
function parseError(t: string): UnitError | null {
  try {
    const end = expression(t, 0, true);
    return end < t.length ? new UnitError(t, end + 1) : null;
  } catch (e) {
    if (e instanceof UnitError) {
      return e;
    }
    throw e;
  }
}

// The expression of `t` from `from`: factors joined by * and /. Returns where it ends: before the
// white space after it, or, at the top, after it. Throws UnitError where it is none.
function expression(t: string, from: number, top: boolean): number {
  let i = from;
  const n = t.length;
  const fail = (at: number): never => {
    throw new UnitError(t, at + 1);
  };
  const space = () => {
    while (i < n && isSpace(t[i])) {
      i++;
    }
  };
  // The closing parenthesis of one opened, after any white space.
  const close = () => {
    space();
    if (t[i] !== ')') {
      fail(i);
    }
    i++;
  };
  const number = (): boolean => {
    const m = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(t.slice(i));
    if (!m) {
      return false;
    }
    i += m[0].length;
    return true;
  };
  // A ratio of numbers, or one in parentheses, as an exponent in parentheses holds.
  const ratio = () => {
    space();
    if (t[i] === '(') {
      i++;
      ratio();
      close();
      return;
    }
    if (!number()) {
      fail(i);
    }
    space();
    if (t[i] === '/') {
      i++;
      space();
      if (!number()) {
        fail(i);
      }
    }
  };
  const exponent = () => {
    space();
    if (t[i] === '(') {
      i++;
      ratio();
      close();
    } else if (!number()) {
      fail(i);
    }
  };
  const factor = () => {
    space();
    if (i >= n) {
      fail(i);
    }
    if (t[i] === '(') {
      // Parsed on its own, as the text after the parenthesis: an error in it is reported there.
      i = i + 1 + expression(t.slice(i + 1), 0, false);
      close();
    } else if (isNameChar(t[i])) {
      while (i < n && isNameChar(t[i])) {
        i++;
      }
    } else {
      fail(i);
    }
    for (;;) {
      const before = i;
      space();
      if (t[i] !== '^') {
        i = before;
        return;
      }
      i++;
      exponent();
    }
  };
  factor();
  for (;;) {
    const before = i;
    space();
    if (t[i] !== '*' && t[i] !== '/') {
      i = before;
      break;
    }
    i++;
    factor();
  }
  if (top) {
    space();
  }
  return i;
}
