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
    // Read out of the saveobj envelope, so the "Other" group does not list the envelope again.
    static sourceKeys = [SAVEOBJ_KEY];

    static format = formatText;
}
