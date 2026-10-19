// Copyright 2026 The MathWorks, Inc.
import { SAVEOBJ_KEY } from '../parser/XmlUtils.js';
import { formatText } from './formatText.js';
// A Simulink.VariantBank's ActiveChoiceCoderInfo: the name of the Simulink.VariantBankCoderInfo
// that applies to the active choice of the bank (VariantBankNode).
export default class PropActiveChoiceCoderInfo {
    static { this.key = 'ActiveChoiceCoderInfo'; }
    static { this.displayName = 'Active Choice Coder Info'; }
    static { this.editor = 'text'; }
    static { this.column = 'activeChoiceCoderInfo'; }
    // Read out of the saveobj envelope, or the plain property a text dictionary R2026b wrote, so
    // the "Other" group lists neither again.
    static { this.sourceKeys = [SAVEOBJ_KEY, 'ActiveChoiceCoderInfo']; }
    static { this.format = formatText; }
}
//# sourceMappingURL=PropActiveChoiceCoderInfo.js.map