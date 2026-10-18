/** A condition as MATLAB stores it, or why it is not written. */
export type ConditionCheck = {
    condition: string;
} | {
    reason: string;
};
/**
 * `text` as MATLAB stores it in a Simulink.VariantBank's VariantConditions, or why it is not
 * written there: a condition the parser above does not read, MATLAB's refusal of an empty one,
 * or MATLAB's refusal of an integer out of range.
 */
export declare function checkVariantCondition(text: string): ConditionCheck;
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
export declare function conditionCannotParse(text: string): boolean;
//# sourceMappingURL=variantCondition.d.ts.map