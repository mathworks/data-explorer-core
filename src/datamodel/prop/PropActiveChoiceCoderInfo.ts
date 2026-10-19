// Copyright 2026 The MathWorks, Inc.

import { SAVEOBJ_KEY } from '../parser/XmlUtils.js';
import { formatText } from './formatText.js';

// A Simulink.VariantBank's ActiveChoiceCoderInfo: the name of the Simulink.VariantBankCoderInfo
// that applies to the active choice of the bank (VariantBankNode).
export default class PropActiveChoiceCoderInfo {
    static key = 'ActiveChoiceCoderInfo';
    static displayName = 'Active Choice Coder Info';
    static editor = 'text';
    static column = 'activeChoiceCoderInfo';
    // Read out of the saveobj envelope, or the plain property a text dictionary R2026b wrote, so
    // the "Other" group lists neither again.
    static sourceKeys = [SAVEOBJ_KEY, 'ActiveChoiceCoderInfo'];

    static format = formatText;
}
