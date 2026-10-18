// Copyright 2026 The MathWorks, Inc.
import { SAVEOBJ_KEY } from '../parser/XmlUtils.js';
import { formatText } from './formatText.js';
// MATLAB's Qualifier enumeration for a Simulink.VariantBankCoderInfo, in its own spelling
// (R2027a, measured by test/fixtures/make_variantbank_r2027a.m: every other name tried, 'Restrict',
// 'Static' and 'Const Volatile' among them, is "no enumerated value"). One list, so the dropdown
// the table renders and the rule VariantBankCoderInfoNode.setProperty checks cannot drift apart.
export const QUALIFIERS = ['None', 'Const', 'Volatile', 'ConstVolatile'];
// A Simulink.VariantBankCoderInfo's Qualifier, a dropdown over MATLAB's enumeration
// (VariantBankCoderInfoNode).
export default class PropQualifier {
    static { this.key = 'Qualifier'; }
    static { this.displayName = 'Qualifier'; }
    static { this.editor = 'select'; }
    static { this.column = 'qualifier'; }
    // Read out of the saveobj envelope, or the plain property a text dictionary R2026b wrote, so
    // the "Other" group lists neither again.
    static { this.sourceKeys = [SAVEOBJ_KEY, 'Qualifier']; }
    static readOptions() {
        return [...QUALIFIERS];
    }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropQualifier.js.map