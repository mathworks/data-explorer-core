// Copyright 2026 The MathWorks, Inc.

import { SAVEOBJ_KEY } from '../parser/XmlUtils.js';
import { formatText } from './formatText.js';

// MATLAB's Qualifier enumeration for a Simulink.VariantBankCoderInfo, in its own spelling
// (R2027a, measured by test/fixtures/make_variantbank_r2027a.m: every other name tried, 'Restrict',
// 'Static' and 'Const Volatile' among them, is "no enumerated value"). One list, so the dropdown
// the table renders and the rule VariantBankCoderInfoNode.setProperty checks cannot drift apart.
export const QUALIFIERS: readonly string[] = ['None', 'Const', 'Volatile', 'ConstVolatile'];

// A Simulink.VariantBankCoderInfo's Qualifier, a dropdown over MATLAB's enumeration
// (VariantBankCoderInfoNode).
export default class PropQualifier {
    static key = 'Qualifier';
    static displayName = 'Qualifier';
    static editor = 'select';
    static column = 'qualifier';
    // Read out of the saveobj envelope, or the plain property a text dictionary R2026b wrote, so
    // the "Other" group lists neither again.
    static sourceKeys = [SAVEOBJ_KEY, 'Qualifier'];

    static readOptions(): string[] {
        return [...QUALIFIERS];
    }

    static format = formatText;
}
