// Copyright 2026 The MathWorks, Inc.
//
// The parser's own policy about which block parameters become rows, restated.
//
// Which of MATLAB's block parameters surface as Modeling Elements is OUR rule, not
// MATLAB's: a parameter surfaces when its value could name workspace data. This is
// stated here — deliberately, the way matlab/expect.ts restates the display
// constants — so an expectation is an independent statement of the rule rather than
// a reading of the implementation. If the two ever disagree, that disagreement is
// the finding.
//
// It lives in a module of its own because three suites hold files to it: the `.mdl`
// container parity suite, the `.slx` layout parity suite, and the mask suite. One
// statement they all read cannot drift out of step with itself; three copies could.
import type { MdlBlockTruth } from './matlab/loadTruth.js';

const NUMERIC = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const NON_FINITE = /^[+-]?(inf|nan)$/i;
const IDENTIFIER = /[A-Za-z_]\w*/;
// Cosmetic/structural properties never count. Only the ones these corpora set are
// listed; the full blocklist lives in the parser.
const COSMETIC = new Set(['Position', 'ShowName', 'ZOrder']);

/** Whether a VALUE could name workspace data, whatever wrote it. */
export function valueReferencesData(value: string): boolean {
  if (!value || NUMERIC.test(value) || NON_FINITE.test(value)) { return false; }
  if (value === 'on' || value === 'off') { return false; }
  return IDENTIFIER.test(value);
}

export function referencesData(prop: string, value: string): boolean {
  if (COSMETIC.has(prop)) { return false; }
  return valueReferencesData(value);
}

// A MASK parameter is the same policy with the property test swapped for two others,
// and the difference is not ours to choose: `Simulink.findVars` resolves a mask
// parameter's value only when the parameter is an expression-valued TYPE and is marked
// evaluated, and it credits the value to the MASKED BLOCK. Measured, not read off the
// format — test/parity/matlab/probe_mask_types.m for the types, probe_evaluate.m for
// the flag. The blocklist above does NOT apply: a mask parameter's name is chosen by
// the mask's author, so a mask really named `Position` carries none of the meaning the
// block property of that name has.
const EXPRESSION_MASK_TYPES = new Set(['edit', 'slider', 'dial', 'spinbox', 'min', 'max']);

export function maskParamReferencesData(type: string, evaluate: string, value: string): boolean {
  if (!EXPRESSION_MASK_TYPES.has(type.trim().toLowerCase())) { return false; }
  if (evaluate === 'off') { return false; }
  return valueReferencesData(value);
}

/**
 * A block label MATLAB wrapped across lines is one flat cell. MATLAB reports the
 * name with its real newline; a `.mdl` writes `\n` and a `.slx` writes `&#xA;`.
 */
export function flatLabel(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** `Name|Type|Prop=Value` for every parameter row MATLAB's own model implies. */
export function expectedUsages(blocks: MdlBlockTruth[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    for (const [prop, value] of Object.entries(block.params || {})) {
      if (referencesData(prop, value)) {
        out.push(flatLabel(block.name) + '|' + block.type + '|' + prop + '=' + value);
      }
    }
  }
  return out.sort();
}
