// Copyright 2026 The MathWorks, Inc.
//
// A cell literal's member that opens with a sign, or with its imaginary part, typed in.
// MATLAB reads `{- 2}` as {-2}, `{1, - 2}` as {1, -2} and `{i + 1}` as {1+1i}. Since the
// complex-member change (#139) this parser refused all three, and `{i+1}` with no spaces was
// held as the char 'i+1', a value MATLAB never makes. Followed under the maintainer's ruling
// of 2026-10-18 (group G, follow-up 6): accept the sign and the `i + 1` forms as MATLAB
// does, and keep refusing arithmetic.
//
// MATLAB's rule inside braces: a `+` or `-` with whitespace after it is unary when no term
// stands before it, at the start of the row or after a comma (`{- 2}`, `{1, - 2}`), and binary
// after a term (`{[1] - 2}` is {-1}, `{'a' - 2}` is {95}). An imaginary term then a real one
// (`i + 1`, `2i - 3`) is one complex value, as the real-first `1 + 1i` is. This parser does
// no arithmetic, so a member it would have to compute stays refused.
//
// A member whose imaginary part is zero (`{0i}`, `{1 + 0i}`, `{0i + 1}`) is a real double in
// MATLAB, which drops an imaginary part that is all zero. It was held as a complex member
// (`1+0i`); under the same ruling it is now the double MATLAB makes (ZERO_IMAGINARY).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { createSession } from '../src/index.js';
import { ingest } from '../src/core/ingest.js';
import MatlabValueParser from '../src/datamodel/parser/MatlabValueParser.js';
import { formatComplexNum, parseComplexNum } from '../src/datamodel/parser/XmlUtils.js';
import '../src/datamodel/node/data/NodeClassMap.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Member = number | { re: number; im: number };

/**
 * Each literal and what MATLAB R2027a (27.1.0.3409468) makes of it: `eval` of the literal,
 * then class, complexity, size and parts. The measured row is quoted above each entry
 * (parity/matlab/probe_cell_sign_literals.m, which opens no file). MATLAB_COMPUTES's
 * `matlab` column is that probe's output too.
 */
const MATLAB_MAKES: { literal: string; dims: number[]; members: Member[] }[] = [
  // LIT {- 2}            -> cell [1 1] {double [1 1] [-2]}
  { literal: '{- 2}', dims: [1, 1], members: [-2] },
  // LIT {+ 2}            -> cell [1 1] {double [1 1] [2]}
  { literal: '{+ 2}', dims: [1, 1], members: [2] },
  // LIT {-  2}           -> cell [1 1] {double [1 1] [-2]}
  { literal: '{-  2}', dims: [1, 1], members: [-2] },
  // LIT {1, - 2}         -> cell [1 2] {double [1 1] [1] ; double [1 1] [-2]}
  { literal: '{1, - 2}', dims: [1, 2], members: [1, -2] },
  // LIT {1 , - 2}        -> cell [1 2] {double [1 1] [1] ; double [1 1] [-2]}
  { literal: '{1 , - 2}', dims: [1, 2], members: [1, -2] },
  // LIT {1 ,- 2}         -> cell [1 2] {double [1 1] [1] ; double [1 1] [-2]}
  { literal: '{1 ,- 2}', dims: [1, 2], members: [1, -2] },
  // LIT {1; - 2}         -> cell [2 1] {double [1 1] [1] ; double [1 1] [-2]}
  { literal: '{1; - 2}', dims: [2, 1], members: [1, -2] },
  // LIT {- 2 3}          -> cell [1 2] {double [1 1] [-2] ; double [1 1] [3]}
  { literal: '{- 2 3}', dims: [1, 2], members: [-2, 3] },
  // LIT {- 2, 3}         -> cell [1 2] {double [1 1] [-2] ; double [1 1] [3]}
  { literal: '{- 2, 3}', dims: [1, 2], members: [-2, 3] },
  // LIT {- 2 3i}         -> cell [1 2] {double [1 1] [-2] ; double complex [1 1] [0,3i]}
  { literal: '{- 2 3i}', dims: [1, 2], members: [-2, { re: 0, im: 3 }] },
  // LIT {- 2 + 3i}       -> cell [1 1] {double complex [1 1] [-2,3i]}
  { literal: '{- 2 + 3i}', dims: [1, 1], members: [{ re: -2, im: 3 }] },
  // LIT {- i}            -> cell [1 1] {double complex [1 1] [-0,-1i]}
  { literal: '{- i}', dims: [1, 1], members: [{ re: -0, im: -1 }] },
  // LIT {+ i}            -> cell [1 1] {double complex [1 1] [0,1i]}
  { literal: '{+ i}', dims: [1, 1], members: [{ re: 0, im: 1 }] },
  // LIT {- 2i}           -> cell [1 1] {double complex [1 1] [-0,-2i]}
  { literal: '{- 2i}', dims: [1, 1], members: [{ re: -0, im: -2 }] },
  // LIT {1, - 2i}        -> cell [1 2] {double [1 1] [1] ; double complex [1 1] [-0,-2i]}
  { literal: '{1, - 2i}', dims: [1, 2], members: [1, { re: -0, im: -2 }] },
  // LIT {- Inf}          -> cell [1 1] {double [1 1] [-Inf]}
  { literal: '{- Inf}', dims: [1, 1], members: [-Infinity] },
  // LIT {- NaN}          -> cell [1 1] {double [1 1] [NaN]}
  { literal: '{- NaN}', dims: [1, 1], members: [NaN] },
  // LIT {- 0}            -> cell [1 1] {double [1 1] [-0]}
  { literal: '{- 0}', dims: [1, 1], members: [-0] },
  // LIT {i + 1}          -> cell [1 1] {double complex [1 1] [1,1i]}
  { literal: '{i + 1}', dims: [1, 1], members: [{ re: 1, im: 1 }] },
  // LIT {2i - 3}         -> cell [1 1] {double complex [1 1] [-3,2i]}
  { literal: '{2i - 3}', dims: [1, 1], members: [{ re: -3, im: 2 }] },
  // LIT {i+1}            -> cell [1 1] {double complex [1 1] [1,1i]}
  { literal: '{i+1}', dims: [1, 1], members: [{ re: 1, im: 1 }] },
  // LIT {2i-3}           -> cell [1 1] {double complex [1 1] [-3,2i]}
  { literal: '{2i-3}', dims: [1, 1], members: [{ re: -3, im: 2 }] },
  // LIT {- 3; i + 1}     -> cell [2 1] {double [1 1] [-3] ; double complex [1 1] [1,1i]}
  { literal: '{- 3; i + 1}', dims: [2, 1], members: [-3, { re: 1, im: 1 }] },
  // LIT {i + 1, 2i - 3}  -> cell [1 2] {double complex [1 1] [1,1i] ; double complex [1 1] [-3,2i]}
  { literal: '{i + 1, 2i - 3}', dims: [1, 2], members: [{ re: 1, im: 1 }, { re: -3, im: 2 }] },
  // LIT {2i - 3, 4}      -> cell [1 2] {double complex [1 1] [-3,2i] ; double [1 1] [4]}
  { literal: '{2i - 3, 4}', dims: [1, 2], members: [{ re: -3, im: 2 }, 4] },
  // LIT {-2i + 3}        -> cell [1 1] {double complex [1 1] [3,-2i]}
  { literal: '{-2i + 3}', dims: [1, 1], members: [{ re: 3, im: -2 }] },
  // LIT {- 3i + 2}       -> cell [1 1] {double complex [1 1] [2,-3i]}
  { literal: '{- 3i + 2}', dims: [1, 1], members: [{ re: 2, im: -3 }] },
  // LIT {-i + 1}         -> cell [1 1] {double complex [1 1] [1,-1i]}
  { literal: '{-i + 1}', dims: [1, 1], members: [{ re: 1, im: -1 }] },
  // LIT {i + Inf}        -> cell [1 1] {double complex [1 1] [Inf,1i]}
  { literal: '{i + Inf}', dims: [1, 1], members: [{ re: Infinity, im: 1 }] },
  // LIT {i - Inf}        -> cell [1 1] {double complex [1 1] [-Inf,1i]}
  { literal: '{i - Inf}', dims: [1, 1], members: [{ re: -Infinity, im: 1 }] },
  // LIT {i + NaN}        -> cell [1 1] {double complex [1 1] [NaN,1i]}
  { literal: '{i + NaN}', dims: [1, 1], members: [{ re: NaN, im: 1 }] },
  // LIT {2j - 3}         -> cell [1 1] {double complex [1 1] [-3,2i]}
  { literal: '{2j - 3}', dims: [1, 1], members: [{ re: -3, im: 2 }] },
  // LIT {1j + 1}         -> cell [1 1] {double complex [1 1] [1,1i]}
  { literal: '{1j + 1}', dims: [1, 1], members: [{ re: 1, im: 1 }] },
  // LIT {2i - 1e3}       -> cell [1 1] {double complex [1 1] [-1000,2i]}
  { literal: '{2i - 1e3}', dims: [1, 1], members: [{ re: -1000, im: 2 }] },
  // LIT {2.5i + .5}      -> cell [1 1] {double complex [1 1] [0.5,2.5i]}
  { literal: '{2.5i + .5}', dims: [1, 1], members: [{ re: 0.5, im: 2.5 }] },
  // LIT {i - 0}          -> cell [1 1] {double complex [1 1] [0,1i]}
  { literal: '{i - 0}', dims: [1, 1], members: [{ re: 0, im: 1 }] },
  // LIT {-i - 0}         -> cell [1 1] {double complex [1 1] [-0,-1i]}
  { literal: '{-i - 0}', dims: [1, 1], members: [{ re: -0, im: -1 }] },
];

/**
 * What MATLAB computes and this parser cannot: the terms are added, a sign is applied to a
 * signed term, an array or a char, or a name is looked up. Each is refused, before this
 * change and after it. The rows after a bracketed or quoted term are the controls on "no term
 * before it": there the sign is binary, and taking it as a sign would make `{[1], -2}`.
 */
const MATLAB_COMPUTES: { literal: string; matlab: string }[] = [
  { literal: '{- 2 - 3}', matlab: 'cell [1 1] {double [1 1] [-5]}' },
  { literal: '{- 2 + 3}', matlab: 'cell [1 1] {double [1 1] [1]}' },
  { literal: '{1, - 2 - 3}', matlab: 'cell [1 2] {double [1 1] [1] ; double [1 1] [-5]}' },
  { literal: '{- -2}', matlab: 'cell [1 1] {double [1 1] [2]}' },
  { literal: '{- a}', matlab: "ERROR Unrecognized function or variable 'a'." },
  { literal: '{[1] - 2}', matlab: 'cell [1 1] {double [1 1] [-1]}' },
  { literal: "{'a' - 2}", matlab: 'cell [1 1] {double [1 1] [95]}' },
  { literal: '{"a" - 2}', matlab: 'ERROR Invalid data type. Argument must be numeric, char, or logical.' },
  { literal: '{[1 2] + 3}', matlab: 'cell [1 1] {double [1 2] [4 5]}' },
  { literal: '{- [1 2]}', matlab: 'cell [1 1] {double [1 2] [-1 -2]}' },
  { literal: "{- 'a'}", matlab: 'cell [1 1] {double [1 1] [-97]}' },
  { literal: '{1 - 2}', matlab: 'cell [1 1] {double [1 1] [-1]}' },
  { literal: '{a + b}', matlab: "ERROR Unrecognized function or variable 'a'." },
  { literal: '{1 + 2i + 3}', matlab: 'cell [1 1] {double complex [1 1] [4,2i]}' },
  { literal: '{i + 1i}', matlab: 'cell [1 1] {double complex [1 1] [0,2i]}' },
  { literal: '{i + 1 + 2}', matlab: 'cell [1 1] {double complex [1 1] [3,1i]}' },
  { literal: '{i + -1}', matlab: 'cell [1 1] {double complex [1 1] [-1,1i]}' },
  { literal: '{1 + -2i}', matlab: 'cell [1 1] {double complex [1 1] [1,-2i]}' },
  { literal: '{Infi + 1}', matlab: "ERROR Unrecognized function or variable 'Infi'." },
  // Unspaced, the same arithmetic. Each was held as one char member ('1+2', '-a'), a value MATLAB
  // never makes of it, where the spaced form beside it was refused.
  { literal: '{1+2}', matlab: 'cell [1 1] {double [1 1] [3]}' },
  { literal: '{1-2}', matlab: 'cell [1 1] {double [1 1] [-1]}' },
  { literal: '{a+b}', matlab: "ERROR Unrecognized function or variable 'a'." },
  { literal: '{a-b}', matlab: "ERROR Unrecognized function or variable 'a'." },
  { literal: '{2i+3i}', matlab: 'cell [1 1] {double complex [1 1] [0,5i]}' },
  { literal: '{1+2+3i}', matlab: 'cell [1 1] {double complex [1 1] [3,3i]}' },
  { literal: '{-a}', matlab: "ERROR Unrecognized function or variable 'a'." },
  { literal: '{+a}', matlab: "ERROR Unrecognized function or variable 'a'." },
  { literal: '{-pi}', matlab: 'cell [1 1] {double [1 1] [-3.1415926535897931]}' },
  { literal: '{-true}', matlab: 'cell [1 1] {double [1 1] [-1]}' },
  { literal: '{2*3}', matlab: 'cell [1 1] {double [1 1] [6]}' },
  { literal: '{6/2}', matlab: 'cell [1 1] {double [1 1] [3]}' },
  { literal: '{6\\2}', matlab: 'cell [1 1] {double [1 1] [0.33333333333333331]}' },
  { literal: '{2^3}', matlab: 'cell [1 1] {double [1 1] [8]}' },
  { literal: '{2.*3}', matlab: 'cell [1 1] {double [1 1] [6]}' },
  { literal: '{1, 2+3}', matlab: 'cell [1 2] {double [1 1] [1] ; double [1 1] [5]}' },
  { literal: '{2+3, 1}', matlab: 'cell [1 2] {double [1 1] [5] ; double [1 1] [1]}' },
  { literal: '{1+2; 3}', matlab: 'cell [2 1] {double [1 1] [3] ; double [1 1] [3]}' },
];

/**
 * Read as before: a sign with whitespace before it and none after starts a member, and a sign
 * inside one literal (an exponent's, a complex part's, a leading one) is that literal's own.
 */
const READ_AS_BEFORE: { literal: string; dims: number[]; members: Member[] }[] = [
  // LIT {-2}             -> cell [1 1] {double [1 1] [-2]}
  { literal: '{-2}', dims: [1, 1], members: [-2] },
  // LIT {1e+3}           -> cell [1 1] {double [1 1] [1000]}
  { literal: '{1e+3}', dims: [1, 1], members: [1000] },
  // LIT {1e-3}           -> cell [1 1] {double [1 1] [0.001]}
  { literal: '{1e-3}', dims: [1, 1], members: [0.001] },
  // LIT {1+2i}           -> cell [1 1] {double complex [1 1] [1,2i]}
  { literal: '{1+2i}', dims: [1, 1], members: [{ re: 1, im: 2 }] },
  // LIT {-2i}            -> cell [1 1] {double complex [1 1] [-0,-2i]}
  { literal: '{-2i}', dims: [1, 1], members: [{ re: -0, im: -2 }] },
  // LIT {i +1}           -> cell [1 2] {double complex [1 1] [0,1i] ; double [1 1] [1]}
  { literal: '{i +1}', dims: [1, 2], members: [{ re: 0, im: 1 }, 1] },
  // LIT {2i -3}          -> cell [1 2] {double complex [1 1] [0,2i] ; double [1 1] [-3]}
  { literal: '{2i -3}', dims: [1, 2], members: [{ re: 0, im: 2 }, -3] },
];

/**
 * A member whose imaginary part is zero: MATLAB holds it as a real double. Its arithmetic drops
 * an imaginary part that is all zero (`1 + 0i`, `0i + 1`), and a lone `0i` is real too. The real
 * part is MATLAB's sum, -0 included: `-0 + 0i` is 0, `-0 - 0i` is -0, `-0i` is -0 (the unary
 * minus of 0i) and `-0i + 0` is 0. This parser held each as a complex member (`1+0i`, `0+0i`).
 * The measured rows are probe_cell_sign_literals.m's. Its last two rows are controls, whose
 * imaginary part is not zero; they stay complex.
 */
const ZERO_IMAGINARY: { literal: string; dims: number[]; members: Member[] }[] = [
  // LIT {0i}             -> cell [1 1] {double [1 1] [0]}
  { literal: '{0i}', dims: [1, 1], members: [0] },
  // LIT {0j}             -> cell [1 1] {double [1 1] [0]}
  { literal: '{0j}', dims: [1, 1], members: [0] },
  // LIT {-0i}            -> cell [1 1] {double [1 1] [-0]}
  { literal: '{-0i}', dims: [1, 1], members: [-0] },
  // LIT {+0i}            -> cell [1 1] {double [1 1] [0]}
  { literal: '{+0i}', dims: [1, 1], members: [0] },
  // LIT {- 0i}           -> cell [1 1] {double [1 1] [-0]}
  { literal: '{- 0i}', dims: [1, 1], members: [-0] },
  // LIT {+ 0i}           -> cell [1 1] {double [1 1] [0]}
  { literal: '{+ 0i}', dims: [1, 1], members: [0] },
  // LIT {0.0i}           -> cell [1 1] {double [1 1] [0]}
  { literal: '{0.0i}', dims: [1, 1], members: [0] },
  // LIT {.0i}            -> cell [1 1] {double [1 1] [0]}
  { literal: '{.0i}', dims: [1, 1], members: [0] },
  // LIT {0.i}            -> cell [1 1] {double [1 1] [0]}
  { literal: '{0.i}', dims: [1, 1], members: [0] },
  // LIT {0e3i}           -> cell [1 1] {double [1 1] [0]}
  { literal: '{0e3i}', dims: [1, 1], members: [0] },
  // LIT {0e-3i}          -> cell [1 1] {double [1 1] [0]}
  { literal: '{0e-3i}', dims: [1, 1], members: [0] },
  // LIT {1e-400i}        -> cell [1 1] {double [1 1] [0]}
  { literal: '{1e-400i}', dims: [1, 1], members: [0] },
  // LIT {1 + 0i}         -> cell [1 1] {double [1 1] [1]}
  { literal: '{1 + 0i}', dims: [1, 1], members: [1] },
  // LIT {1+0i}           -> cell [1 1] {double [1 1] [1]}
  { literal: '{1+0i}', dims: [1, 1], members: [1] },
  // LIT {1 - 0i}         -> cell [1 1] {double [1 1] [1]}
  { literal: '{1 - 0i}', dims: [1, 1], members: [1] },
  // LIT {1-0i}           -> cell [1 1] {double [1 1] [1]}
  { literal: '{1-0i}', dims: [1, 1], members: [1] },
  // LIT {-1 + 0i}        -> cell [1 1] {double [1 1] [-1]}
  { literal: '{-1 + 0i}', dims: [1, 1], members: [-1] },
  // LIT {- 1 + 0i}       -> cell [1 1] {double [1 1] [-1]}
  { literal: '{- 1 + 0i}', dims: [1, 1], members: [-1] },
  // LIT {-1-0i}          -> cell [1 1] {double [1 1] [-1]}
  { literal: '{-1-0i}', dims: [1, 1], members: [-1] },
  // LIT {0 + 0i}         -> cell [1 1] {double [1 1] [0]}
  { literal: '{0 + 0i}', dims: [1, 1], members: [0] },
  // LIT {0+0i}           -> cell [1 1] {double [1 1] [0]}
  { literal: '{0+0i}', dims: [1, 1], members: [0] },
  // LIT {-0 + 0i}        -> cell [1 1] {double [1 1] [0]}
  { literal: '{-0 + 0i}', dims: [1, 1], members: [0] },
  // LIT {-0+0i}          -> cell [1 1] {double [1 1] [0]}
  { literal: '{-0+0i}', dims: [1, 1], members: [0] },
  // LIT {-0 - 0i}        -> cell [1 1] {double [1 1] [-0]}
  { literal: '{-0 - 0i}', dims: [1, 1], members: [-0] },
  // LIT {-0-0i}          -> cell [1 1] {double [1 1] [-0]}
  { literal: '{-0-0i}', dims: [1, 1], members: [-0] },
  // LIT {- 0 - 0i}       -> cell [1 1] {double [1 1] [-0]}
  { literal: '{- 0 - 0i}', dims: [1, 1], members: [-0] },
  // LIT {Inf + 0i}       -> cell [1 1] {double [1 1] [Inf]}
  { literal: '{Inf + 0i}', dims: [1, 1], members: [Infinity] },
  // LIT {-Inf - 0i}      -> cell [1 1] {double [1 1] [-Inf]}
  { literal: '{-Inf - 0i}', dims: [1, 1], members: [-Infinity] },
  // LIT {NaN + 0i}       -> cell [1 1] {double [1 1] [NaN]}
  { literal: '{NaN + 0i}', dims: [1, 1], members: [NaN] },
  // LIT {NaN - 0i}       -> cell [1 1] {double [1 1] [NaN]}
  { literal: '{NaN - 0i}', dims: [1, 1], members: [NaN] },
  // LIT {1 + 0j}         -> cell [1 1] {double [1 1] [1]}
  { literal: '{1 + 0j}', dims: [1, 1], members: [1] },
  // LIT {2.5 - 0.0i}     -> cell [1 1] {double [1 1] [2.5]}
  { literal: '{2.5 - 0.0i}', dims: [1, 1], members: [2.5] },
  // LIT {1e3 + 0e2i}     -> cell [1 1] {double [1 1] [1000]}
  { literal: '{1e3 + 0e2i}', dims: [1, 1], members: [1000] },
  // LIT {1 + 1e-400i}    -> cell [1 1] {double [1 1] [1]}
  { literal: '{1 + 1e-400i}', dims: [1, 1], members: [1] },
  // LIT {1 +0i}          -> cell [1 2] {double [1 1] [1] ; double [1 1] [0]}
  { literal: '{1 +0i}', dims: [1, 2], members: [1, 0] },
  // LIT {0i + 1}         -> cell [1 1] {double [1 1] [1]}
  { literal: '{0i + 1}', dims: [1, 1], members: [1] },
  // LIT {0i+1}           -> cell [1 1] {double [1 1] [1]}
  { literal: '{0i+1}', dims: [1, 1], members: [1] },
  // LIT {0i - 1}         -> cell [1 1] {double [1 1] [-1]}
  { literal: '{0i - 1}', dims: [1, 1], members: [-1] },
  // LIT {0i-1}           -> cell [1 1] {double [1 1] [-1]}
  { literal: '{0i-1}', dims: [1, 1], members: [-1] },
  // LIT {-0i + 1}        -> cell [1 1] {double [1 1] [1]}
  { literal: '{-0i + 1}', dims: [1, 1], members: [1] },
  // LIT {- 0i + 1}       -> cell [1 1] {double [1 1] [1]}
  { literal: '{- 0i + 1}', dims: [1, 1], members: [1] },
  // LIT {-0i - 1}        -> cell [1 1] {double [1 1] [-1]}
  { literal: '{-0i - 1}', dims: [1, 1], members: [-1] },
  // LIT {0i + 0}         -> cell [1 1] {double [1 1] [0]}
  { literal: '{0i + 0}', dims: [1, 1], members: [0] },
  // LIT {0i - 0}         -> cell [1 1] {double [1 1] [0]}
  { literal: '{0i - 0}', dims: [1, 1], members: [0] },
  // LIT {-0i - 0}        -> cell [1 1] {double [1 1] [-0]}
  { literal: '{-0i - 0}', dims: [1, 1], members: [-0] },
  // LIT {-0i + 0}        -> cell [1 1] {double [1 1] [0]}
  { literal: '{-0i + 0}', dims: [1, 1], members: [0] },
  // LIT {0i + Inf}       -> cell [1 1] {double [1 1] [Inf]}
  { literal: '{0i + Inf}', dims: [1, 1], members: [Infinity] },
  // LIT {0i - Inf}       -> cell [1 1] {double [1 1] [-Inf]}
  { literal: '{0i - Inf}', dims: [1, 1], members: [-Infinity] },
  // LIT {0i + NaN}       -> cell [1 1] {double [1 1] [NaN]}
  { literal: '{0i + NaN}', dims: [1, 1], members: [NaN] },
  // LIT {0j + 2}         -> cell [1 1] {double [1 1] [2]}
  { literal: '{0j + 2}', dims: [1, 1], members: [2] },
  // LIT {0.0i + .5}      -> cell [1 1] {double [1 1] [0.5]}
  { literal: '{0.0i + .5}', dims: [1, 1], members: [0.5] },
  // LIT {0i +1}          -> cell [1 2] {double [1 1] [0] ; double [1 1] [1]}
  { literal: '{0i +1}', dims: [1, 2], members: [0, 1] },
  // LIT {1, 0i}          -> cell [1 2] {double [1 1] [1] ; double [1 1] [0]}
  { literal: '{1, 0i}', dims: [1, 2], members: [1, 0] },
  // LIT {0i, 1 + 0i}     -> cell [1 2] {double [1 1] [0] ; double [1 1] [1]}
  { literal: '{0i, 1 + 0i}', dims: [1, 2], members: [0, 1] },
  // LIT {0i; 1 + 0i}     -> cell [2 1] {double [1 1] [0] ; double [1 1] [1]}
  { literal: '{0i; 1 + 0i}', dims: [2, 1], members: [0, 1] },
  // LIT {1 + 0i, 2i + 1} -> cell [1 2] {double [1 1] [1] ; double complex [1 1] [1,2i]}
  { literal: '{1 + 0i, 2i + 1}', dims: [1, 2], members: [1, { re: 1, im: 2 }] },
  // LIT {1, - 0i}        -> cell [1 2] {double [1 1] [1] ; double [1 1] [-0]}
  { literal: '{1, - 0i}', dims: [1, 2], members: [1, -0] },
  // LIT {1 + 0.5i}       -> cell [1 1] {double complex [1 1] [1,0.5i]}
  { literal: '{1 + 0.5i}', dims: [1, 1], members: [{ re: 1, im: 0.5 }] },
  // LIT {0.5i + 1}       -> cell [1 1] {double complex [1 1] [1,0.5i]}
  { literal: '{0.5i + 1}', dims: [1, 1], members: [{ re: 1, im: 0.5 }] },
];

/**
 * A complex part compared sign-blind on zero: this package spells a part of -0 as 0
 * (formatComplexNum), as it does for `{-i}`, whose real part MATLAB also holds as -0.
 * A double member is compared exactly, -0 included.
 */
const part = (n: unknown): unknown => (typeof n === 'number' ? n + 0 : n);

/** One member as the parser holds it, in the form of a MATLAB_MAKES member, or the raw value when it is neither. */
function memberOf(raw: any): unknown {
  if (typeof raw === 'number') {
    return raw;
  }
  // A complex member is the complex-text bag a binary dictionary's reader gives one.
  if (raw && typeof raw === 'object' && raw._type === 'cdata' && typeof raw._value === 'string') {
    const parts = parseComplexNum(raw._value);
    return parts ? { re: part(parts.re), im: part(parts.im) } : raw;
  }
  return raw;
}

const expected = (m: Member): unknown => (typeof m === 'number' ? m : { re: part(m.re), im: part(m.im) });

/**
 * A member as the table shows its row: the Class column and the Value. A double of -0
 * shows as `0`, as `{-0}` always has (the display is this package's, not MATLAB's).
 */
const shownAs = (m: Member): [string, string] =>
  typeof m === 'number'
    ? ['double', m === Infinity ? 'Inf' : m === -Infinity ? '-Inf' : String(m)]
    : ['double (complex)', formatComplexNum(part(m.re), m.im)];

describe('a cell member that opens with a sign or its imaginary part is what MATLAB makes of it', () => {
  it.each(MATLAB_MAKES)('$literal parses to the members MATLAB holds', ({ literal, dims, members }) => {
    const parsed = MatlabValueParser.parse(literal);
    expect(parsed, literal).not.toBeNull();
    expect(parsed!.type).toBe('cell');
    expect(parsed!.dims).toEqual(dims);
    expect((parsed!.value as unknown[]).map(memberOf)).toEqual(members.map(expected));
  });

  it('holds an imaginary-first member as the complex-text bag every complex member takes', () => {
    expect((MatlabValueParser.parse('{i + 1}')!.value as unknown[])[0]).toEqual({ _type: 'cdata', _value: '1+1i' });
    expect((MatlabValueParser.parse('{2i-3}')!.value as unknown[])[0]).toEqual({ _type: 'cdata', _value: '-3+2i' });
  });

  it.each(MATLAB_COMPUTES)('$literal is refused, since MATLAB computes it ($matlab)', ({ literal }) => {
    expect(MatlabValueParser.parse(literal), literal).toBeNull();
  });

  it.each(READ_AS_BEFORE)('$literal is read as before', ({ literal, dims, members }) => {
    const parsed = MatlabValueParser.parse(literal);
    expect(parsed, literal).not.toBeNull();
    expect(parsed!.dims).toEqual(dims);
    expect((parsed!.value as unknown[]).map(memberOf)).toEqual(members.map(expected));
  });

  it('refuses a lone sign, which MATLAB cannot read either', () => {
    // LIT {-}              -> ERROR Error: Unexpected '}'. When calling a function or indexing a variable, use parentheses. Otherwise, check for mismatched delimiters.
    // LIT {+}              -> (the same)
    // Held as the char '-' or '+' before, a value MATLAB never makes of the text.
    for (const literal of ['{-}', '{+}']) {
      expect(MatlabValueParser.parse(literal), literal).toBeNull();
    }
  });

  it('keeps a bare word, which holds no operator, as the text it was', () => {
    // LIT {abc}            -> ERROR Unrecognized function or variable 'abc'.
    // MATLAB looks the name up. This reader holds it as text the table can show, as it always
    // has (cellElementShape.test.ts); only a span that would have to be computed is refused.
    expect(MatlabValueParser.parse('{abc}')).toEqual({ type: 'cell', value: ['abc'], dims: [1, 1] });
    expect(MatlabValueParser.parse('{a_b, c1}')).toEqual({ type: 'cell', value: ['a_b', 'c1'], dims: [1, 2] });
    // The operator check is on the bare member alone, not on the row it sits in: a word beside a
    // member that holds a sign, an exponent, a quoted '-' or a signed array element is still text,
    // and that member is read as it always was.
    expect(MatlabValueParser.parse('{abc, -2}')).toEqual({ type: 'cell', value: ['abc', -2], dims: [1, 2] });
    expect(MatlabValueParser.parse('{abc, 1e-3}')).toEqual({ type: 'cell', value: ['abc', 0.001], dims: [1, 2] });
    expect(MatlabValueParser.parse("{abc, 'x-y'}")).toEqual({ type: 'cell', value: ['abc', 'x-y'], dims: [1, 2] });
    expect(MatlabValueParser.parse('{abc, [1 -2]}')).toEqual({ type: 'cell', value: ['abc', [1, -2]], dims: [1, 2] });
    expect(MatlabValueParser.parse('{-2, abc}')).toEqual({ type: 'cell', value: [-2, 'abc'], dims: [1, 2] });
  });

  it.each(ZERO_IMAGINARY)('$literal holds the real double MATLAB makes of a zero imaginary part', ({ literal, dims, members }) => {
    const parsed = MatlabValueParser.parse(literal);
    expect(parsed, literal).not.toBeNull();
    expect(parsed!.dims).toEqual(dims);
    // A real member is a number, compared exactly: a -0 is MATLAB's -0.
    expect((parsed!.value as unknown[]).map(memberOf)).toEqual(members.map(expected));
  });

  it('holds a zero imaginary part in a nested cell as a real double too', () => {
    // LIT {{0i}}           -> cell [1 1] {cell [1 1] {double [1 1] [0]}}
    // LIT {{1 + 0i}}       -> cell [1 1] {cell [1 1] {double [1 1] [1]}}
    // LIT {{0i + 1}}       -> cell [1 1] {cell [1 1] {double [1 1] [1]}}
    for (const [literal, real] of [['{{0i}}', 0], ['{{1 + 0i}}', 1], ['{{0i + 1}}', 1]] as const) {
      expect((MatlabValueParser.parse(literal)!.value as unknown[])[0], literal).toEqual({
        _array_type: 'Cell',
        _dimensions: [1, 1],
        _elements: [real],
        _mw_element_type: 'MATLABArray',
      });
    }
  });

  it('leaves a zero imaginary part at the top level as it was, and a complex array member refused', () => {
    // LIT 0i               -> double [1 1] [0]
    // LIT -0i              -> double [1 1] [-0]
    // LIT 1 + 0i           -> double [1 1] [1]
    // LIT 1+0i             -> double [1 1] [1]
    // LIT 0i + 1           -> double [1 1] [1]
    // MATLAB makes a real double at the top level too. The change is for a cell's member only:
    // the top level is what an element of a complex array takes (MatlabVariableNode.
    // _setConstrainedValue), which has to stay complex, and what a complex value shown as
    // `1+0i` is set back from (complexNegativeZeroShown.test.ts).
    expect(MatlabValueParser.parse('0i')).toEqual({ type: 'complex', value: '0+0i' });
    expect(MatlabValueParser.parse('-0i')).toEqual({ type: 'complex', value: '0+0i' });
    expect(MatlabValueParser.parse('1 + 0i')).toEqual({ type: 'complex', value: '1+0i' });
    expect(MatlabValueParser.parse('1+0i')).toEqual({ type: 'complex', value: '1+0i' });
    expect(MatlabValueParser.parse('0i + 1')).toBeNull();
    // LIT {[0i 1]}         -> cell [1 1] {double [1 2] [0 1]}
    // LIT {[1+0i 2]}       -> cell [1 1] {double [1 2] [1 2]}
    // An array literal reads a complex member now (complexArrayInput.test.ts), and one whose every
    // imaginary part is zero is the real double MATLAB makes of it, in a cell as anywhere.
    expect(MatlabValueParser.parse('{[0i 1]}')).toEqual({ type: 'cell', value: [[0, 1]], dims: [1, 1] });
    expect(MatlabValueParser.parse('{[1+0i 2]}')).toEqual({ type: 'cell', value: [[1, 2]], dims: [1, 1] });
  });

  it('leaves the top level as it was: refused, not read; and reads an array as MATLAB does', () => {
    // The ruling is about cell literals, and the top level is refused before and after, so nothing
    // is written wrong.
    for (const literal of ['- 2', 'i + 1', '2i - 3']) {
      expect(MatlabValueParser.parse(literal), literal).toBeNull();
    }
    // An array's members are split by a cell's rule now (complexArrayInput.test.ts): `[- 2]` is
    // -2, `[1, - 2]` [1 -2] and `[i + 1]` 1+1i, as MATLAB R2027a reads them.
    expect(MatlabValueParser.parse('[- 2]')).toEqual({ type: 'double', value: [-2], dims: [1, 1] });
    expect(MatlabValueParser.parse('[1, - 2]')).toEqual({ type: 'double', value: [1, -2], dims: [1, 2] });
    expect(MatlabValueParser.parse('[i + 1]')).toEqual({ type: 'complex', value: '1+1i' });
  });
});

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));
const buffer = (u8: Uint8Array): ArrayBuffer => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const entryOf = (root: any, name: string): any => root.getSection('design').children.find((e: any) => e.name === name);

const FORMATS = [
  { format: 'text', file: 'cellarr_text.sldd' },
  { format: 'binary', file: 'cellarr_binary.sldd' },
] as const;

/** The dictionary MATLAB wrote with `cCplx = {1 + 2i}` (probe_cell_arrays.m), opened, with cCplx selected. */
function openCCplx(file: string): { session: any; root: any; entry: any } {
  const session = createSession();
  const root = ingest(session, buffer(fixture(file)), { filename: file }) as any;
  const entry = entryOf(root, 'cCplx');
  session.setActive(root, entry);
  return { session, root, entry };
}

/** Save, and reopen what was saved. */
function saveAndReopen(session: any, root: any, file: string): { saved: any; reopened: any } {
  const saved = session.serializeSource(root.name);
  const bytes = saved.kind === 'text' ? strToU8(saved.text) : saved.bytes;
  const reopened = ingest(createSession(), buffer(bytes), { filename: file }) as any;
  return { saved, reopened };
}

/** The saved text dictionary's JSON value for an entry. */
const textValue = (saved: any, name: string): any =>
  JSON.parse(saved.text).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find((e: any) => e.name === name).value;

/** The saved (or read) binary dictionary's `<P Name="Value">` for an entry. */
function binaryValue(bytes: Uint8Array, name: string): string {
  const xml = strFromU8(unzipSync(bytes)['data/chunk0.xml']);
  const object = xml.split('<Object Class="DD.ENTRY">').find((o) => o.includes(`<P Name="Name" Class="char">${name}</P>`))!;
  return object.match(/<P Name="Value"[\s\S]*?<\/P>/)![0];
}

/** Each member's row as the table shows it. */
const rows = (entry: any): [string, string][] => entry.children.map((c: any) => [c.toRow().Class, String(c.displayValue)]);

for (const { format, file } of FORMATS) {
  describe(`a cell member that opens with a sign or its imaginary part, typed in, ${format} dictionary`, () => {
    it.each(MATLAB_MAKES)('$literal, typed as the Value, holds MATLAB\'s members', ({ literal, dims, members }) => {
      const { session, entry } = openCCplx(file);
      expect(session.editProperty(entry.id, 'Value', literal), literal).toBe(true);
      expect(entry.children).toHaveLength(dims[0] * dims[1]);
      expect(rows(entry)).toEqual(members.map(shownAs));
    });

    // MATLAB R2027a read back the dictionaries this package saved after these two edits, in
    // both formats (a one-off read-back of those two saved files, which opened nothing else):
    //   READ g6_text.sldd   cCplx  -> cell [1 4] {double [1 1] [1] ; double [1 1] [-2] ; double complex [1 1] [1,1i] ; double complex [1 1] [-3,2i]}
    //   READ g6_binary.sldd cCplx  -> (the same)
    //   READ g6_text.sldd   cStr   -> cell [2 2] {double complex [1 1] [-2,3i] ; double complex [1 1] [Inf,1i] ; double complex [1 1] [3,-2i] ; double [1 1] [0]}
    //   READ g6_binary.sldd cStr   -> cell [2 2] {double complex [1 1] [-2,3i] ; double complex [1 1] [Inf,1i] ; double complex [1 1] [3,-2i] ; double [1 1] [-0]}
    // The text form's 0 for `- 0` is that format's own: MATLAB writes {-0} there as `0` too.
    it('saves {1, - 2, i + 1, 2i - 3} as MATLAB writes each member, and reopens it the same', () => {
      const { session, root, entry } = openCCplx(file);
      expect(session.editProperty(entry.id, 'Value', '{1, - 2, i + 1, 2i - 3}')).toBe(true);
      const shown = [['double', '1'], ['double', '-2'], ['double (complex)', '1+1i'], ['double (complex)', '-3+2i']];
      expect(rows(entry)).toEqual(shown);

      const { saved, reopened } = saveAndReopen(session, root, file);
      if (format === 'text') {
        // The reals bare, as MATLAB writes them; a complex member as a MAT stream, never its text.
        const elements = textValue(saved, 'cCplx')._elements;
        expect(elements.slice(0, 2)).toEqual([1, -2]);
        for (const element of elements.slice(2)) {
          expect(element._type).toBe('cdata');
          expect(element._value).not.toMatch(/^[-+\d.]+[+-][\d.]+i$/);
        }
      } else {
        const value = binaryValue(saved.bytes, 'cCplx');
        expect(value.match(/<Element[\s\S]*?<\/Element>/g)).toEqual([
          '<Element Class="double">1.0</Element>',
          '<Element Class="double">-2.0</Element>',
          '<Element Class="double" IsComplex="1">1.0+1.0i</Element>',
          '<Element Class="double" IsComplex="1">-3.0+2.0i</Element>',
        ]);
      }
      expect(rows(entryOf(reopened, 'cCplx'))).toEqual(shown);
    });

    it('saves the 2x2 {- 2 + 3i, -2i + 3; i + Inf, - 0} column-major, as MATLAB read it back', () => {
      const session = createSession();
      const root = ingest(session, buffer(fixture(file)), { filename: file }) as any;
      const entry = entryOf(root, 'cStr');
      session.setActive(root, entry);
      expect(session.editProperty(entry.id, 'Value', '{- 2 + 3i, -2i + 3; i + Inf, - 0}')).toBe(true);
      // MATLAB's read-back, column-major: -2+3i, Inf+1i, 3-2i, -0.
      const matlab: Member[] = [{ re: -2, im: 3 }, { re: Infinity, im: 1 }, { re: 3, im: -2 }, -0];
      expect(rows(entry)).toEqual(matlab.map(shownAs));

      const { saved, reopened } = saveAndReopen(session, root, file);
      if (format === 'text') {
        const value = textValue(saved, 'cStr');
        expect(value._dimensions).toEqual([2, 2]);
        expect(value._elements.map((e: any) => (typeof e === 'object' ? e._type : e))).toEqual(['cdata', 'cdata', 'cdata', 0]);
      } else {
        expect(binaryValue(saved.bytes, 'cStr').match(/<Element[\s\S]*?<\/Element>/g)).toEqual([
          '<Element Class="double" IsComplex="1">-2.0+3.0i</Element>',
          '<Element Class="double" IsComplex="1">Inf+1.0i</Element>',
          '<Element Class="double" IsComplex="1">3.0-2.0i</Element>',
          '<Element Class="double">-0.0</Element>',
        ]);
      }
      expect(rows(entryOf(reopened, 'cStr'))).toEqual(matlab.map(shownAs));
    });

    it('writes {2i + 1}, cCplx\'s own value typed imaginary first, as the bytes MATLAB wrote for it', () => {
      const { session, root, entry } = openCCplx(file);
      expect(session.editProperty(entry.id, 'Value', '{2i + 1}')).toBe(true);
      const { saved } = saveAndReopen(session, root, file);
      if (format === 'text') {
        const matlab = JSON.parse(strFromU8(fixture(file))).__MW_TEXT_PARTS__['__MW_TEXT_PART__/data/chunk0'].__MW_TEXT_content.entries.find(
          (e: any) => e.name === 'cCplx',
        ).value;
        expect(textValue(saved, 'cCplx')._elements).toEqual(matlab._elements);
      } else {
        const element = (bytes: Uint8Array): string => binaryValue(bytes, 'cCplx').match(/<Element[\s\S]*?<\/Element>/)![0];
        expect(element(saved.bytes)).toBe(element(fixture(file)));
      }
    });

    it.each(ZERO_IMAGINARY)('$literal, typed as the Value, holds a zero imaginary part as MATLAB does', ({ literal, dims, members }) => {
      const { session, entry } = openCCplx(file);
      expect(session.editProperty(entry.id, 'Value', literal), literal).toBe(true);
      expect(entry.children).toHaveLength(dims[0] * dims[1]);
      expect(rows(entry)).toEqual(members.map(shownAs));
    });

    // A real member is written as every real member is: bare in a text dictionary, and
    // `<Element Class="double">` in a binary one, `-0.0` for a -0. MATLAB read those spellings
    // back as these doubles above (`{1, - 2, ...}` and the `- 0` of cStr).
    it('saves {0i + 1, - 0i, 1 + 0i, 2i + 1} with the real members MATLAB makes, and reopens it the same', () => {
      const { session, root, entry } = openCCplx(file);
      expect(session.editProperty(entry.id, 'Value', '{0i + 1, - 0i, 1 + 0i, 2i + 1}')).toBe(true);
      const shown = [['double', '1'], ['double', '0'], ['double', '1'], ['double (complex)', '1+2i']];
      expect(rows(entry)).toEqual(shown);

      const { saved, reopened } = saveAndReopen(session, root, file);
      if (format === 'text') {
        // The text form writes a -0 as 0, as MATLAB does there.
        const elements = textValue(saved, 'cCplx')._elements;
        expect(elements.slice(0, 3)).toEqual([1, 0, 1]);
        expect(elements[3]._type).toBe('cdata');
      } else {
        expect(binaryValue(saved.bytes, 'cCplx').match(/<Element[\s\S]*?<\/Element>/g)).toEqual([
          '<Element Class="double">1.0</Element>',
          '<Element Class="double">-0.0</Element>',
          '<Element Class="double">1.0</Element>',
          '<Element Class="double" IsComplex="1">1.0+2.0i</Element>',
        ]);
      }
      expect(rows(entryOf(reopened, 'cCplx'))).toEqual(shown);
    });

    it('refuses a sign after a term and a member it would have to compute, leaving the value as it was', () => {
      for (const literal of ['{[1] - 2}', "{'a' - 2}", '{- 2 - 3}', '{i + 1i}', '{- -2}', '{1+2}', '{a+b}', '{-a}', '{2i+3i}']) {
        const { session, entry } = openCCplx(file);
        const result = session.editProperty(entry.id, 'Value', literal);
        expect(result, literal).toMatchObject({ error: true, reason: 'Invalid MATLAB expression' });
        expect(entry.displayValue).toBe('{1+2i}');
        expect(rows(entry)).toEqual([['double (complex)', '1+2i']]);
      }
    });
  });
}
